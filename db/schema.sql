-- PACES app — managed-tier schema (Phase 1). Idempotent: every statement is
-- IF NOT EXISTS / ON CONFLICT DO NOTHING, so scripts/migrate.mjs can re-run it
-- safely. Applied to the Neon Postgres the Vercel Marketplace integration
-- provisions (DATABASE_URL), or any plain Postgres in dev.
--
-- Design (binding spec: ../_MANAGED_TIER_PLAN.md §7):
-- - usage_events is the APPEND-ONLY audit ledger; user_balances is the MUTABLE
--   per-user meter the atomic reserve/settle updates. Never merge them.
-- - Periods are calendar months in Asia/Singapore ('YYYY-MM' text keys,
--   computed app-side); the global backstop keys on SGT days ('YYYY-MM-DD').
-- - allowed_domains + email_overrides are OWNER-EDITABLE CONFIG (psql/console
--   edits apply on the next sign-in / next examiner call — no redeploy).

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  -- Tier at last sign-in (display/audit); authorization re-derives the tier
  -- live from email_overrides/allowed_domains at every use, so an allow-list
  -- edit revokes or upgrades outstanding sessions immediately.
  tier TEXT NOT NULL CHECK (tier IN ('public', 'institutional')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sign_in_at TIMESTAMPTZ
);

-- The two allow-lists (plan §2): consumer providers -> 'public',
-- SG-healthcare domains -> 'institutional'. Anything not listed (and not in
-- email_overrides) cannot use the managed door at all — BYOK only.
CREATE TABLE IF NOT EXISTS allowed_domains (
  domain TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('public', 'institutional')),
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-address grants outside the domain lists (e.g. the pre-Phase-1 invited
-- users, whose gmail addresses would otherwise demote to the public tier).
-- monthly_allowance_usd NULL = the tier's default cap.
CREATE TABLE IF NOT EXISTS email_overrides (
  email TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK (tier IN ('public', 'institutional')),
  monthly_allowance_usd NUMERIC(8, 4),
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per issued 6-digit code. Codes are stored as HMAC-SHA256 hashes
-- (never plaintext); single-use (consumed_at), ~10 min expiry, and at most 5
-- verify attempts — attempts are counted HERE (durably) so serverless cold
-- starts can't reset them. Doubles as the durable send-rate record (count
-- rows per email per hour).
CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_email_created_idx
  ON otp_codes (email, created_at DESC);

-- Append-only audit ledger; one row per settled upstream call. generation_id
-- is the provider's response id — the partial unique index makes settlement
-- idempotent (a retried settle can't double-charge).
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id),
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  model TEXT NOT NULL,
  action TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL,
  cache_read_tokens INT NOT NULL,
  cache_write_tokens INT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  generation_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_generation_idx
  ON usage_events (generation_id) WHERE generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_user_ts_idx
  ON usage_events (user_id, ts DESC);

-- The mutable per-user monthly meter. reserve-then-settle:
--   reserve: UPDATE ... SET reserved_usd = reserved_usd + est
--            WHERE (allowance_usd - spent_usd - reserved_usd) >= est
--   settle:  reserved_usd -= est (floored at 0), spent_usd += actual
-- allowance_usd is refreshed from config at every ensure (tier/override edits
-- apply mid-month).
CREATE TABLE IF NOT EXISTS user_balances (
  user_id BIGINT NOT NULL REFERENCES users (id),
  period TEXT NOT NULL,
  allowance_usd NUMERIC(8, 4) NOT NULL,
  reserved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  spent_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- Study-history sync (owner decision 2026-07-09): a SIGNED-IN user's archived
-- encounters are stored server-side so their history follows them across
-- devices. This is a deliberate, scoped exception to the app's otherwise
-- stateless backend — ONLY logged-in users, ONLY their own already-client-side
-- data (case meta + stem + their transcript; NO hidden answer key ever touches
-- the client blob, so nothing spoiler-bearing is stored here). Records are
-- immutable snapshots keyed by the client's own id; `deleted` is a tombstone so
-- a delete on one device propagates (and a stale device can't resurrect it).
CREATE TABLE IF NOT EXISTS study_history (
  user_id BIGINT NOT NULL REFERENCES users (id),
  client_id TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS study_history_user_idx
  ON study_history (user_id, archived_at DESC);

-- Global daily backstop (plan §4.4): bounds total managed spend per SGT day
-- regardless of per-user math. The cap itself is the MANAGED_DAILY_CAP_USD
-- env var (checked in the same conditional UPDATE), not a column.
CREATE TABLE IF NOT EXISTS global_spend (
  day TEXT PRIMARY KEY,
  reserved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  spent_usd NUMERIC(10, 6) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Seeds (config rows — safe to re-run; edits made later in the DB win because
-- ON CONFLICT DO NOTHING never overwrites an existing row)
-- ---------------------------------------------------------------------------

-- Public tier: major consumer email providers ONLY (a curated ALLOW-list —
-- blocks disposable-domain farming better than any deny-list; plan §2).
INSERT INTO allowed_domains (domain, tier, note) VALUES
  ('gmail.com',      'public', 'consumer allow-list'),
  ('googlemail.com', 'public', 'consumer allow-list (gmail alias domain)'),
  ('outlook.com',    'public', 'consumer allow-list'),
  ('hotmail.com',    'public', 'consumer allow-list'),
  ('live.com',       'public', 'consumer allow-list'),
  ('yahoo.com',      'public', 'consumer allow-list'),
  ('yahoo.com.sg',   'public', 'consumer allow-list'),
  ('icloud.com',     'public', 'consumer allow-list'),
  ('me.com',         'public', 'consumer allow-list (icloud alias domain)')
ON CONFLICT (domain) DO NOTHING;

-- Institutional tier: Singapore public-healthcare domains — MOHH/MOH + the
-- three clusters (SingHealth, NUHS, NHG) and their major hospitals (owner
-- decision 2026-07-09: include all major SG hospitals, e.g. NTFGH, AH).
-- Receiving the OTP at the domain IS the proof of affiliation. ⚠️ Owner-curated
-- — add/remove with a plain INSERT/DELETE, no redeploy. NB tiers are UNIFORM
-- right now (both get DeepSeek + US$1), so 'institutional' vs 'public' is just
-- bookkeeping (which emails may register free) until re-differentiated.
INSERT INTO allowed_domains (domain, tier, note) VALUES
  ('mohh.com.sg',       'institutional', 'MOH Holdings'),
  ('moh.gov.sg',        'institutional', 'Ministry of Health'),
  ('ihis.com.sg',       'institutional', 'Synapxe / IHiS'),
  ('duke-nus.edu.sg',   'institutional', 'Duke-NUS'),
  -- SingHealth cluster
  ('singhealth.com.sg', 'institutional', 'SingHealth cluster'),
  ('sgh.com.sg',        'institutional', 'SingHealth — Singapore GH'),
  ('cgh.com.sg',        'institutional', 'SingHealth — Changi GH'),
  ('kkh.com.sg',        'institutional', 'SingHealth — KKH'),
  ('skh.com.sg',        'institutional', 'SingHealth — Sengkang GH'),
  ('nccs.com.sg',       'institutional', 'SingHealth — National Cancer Centre'),
  ('nhcs.com.sg',       'institutional', 'SingHealth — National Heart Centre'),
  ('snec.com.sg',       'institutional', 'SingHealth — National Eye Centre'),
  ('nni.com.sg',        'institutional', 'SingHealth — National Neuroscience Inst'),
  ('ndcs.com.sg',       'institutional', 'SingHealth — National Dental Centre'),
  -- NUHS cluster
  ('nuhs.edu.sg',       'institutional', 'NUHS cluster'),
  ('nuh.com.sg',        'institutional', 'NUHS — National University Hospital'),
  ('ntfgh.com.sg',      'institutional', 'NUHS — Ng Teng Fong GH'),
  ('ah.com.sg',         'institutional', 'NUHS — Alexandra Hospital'),
  -- NHG cluster
  ('nhg.com.sg',        'institutional', 'NHG cluster'),
  ('ttsh.com.sg',       'institutional', 'NHG — Tan Tock Seng'),
  ('ktph.com.sg',       'institutional', 'NHG — Khoo Teck Puat'),
  ('wh.com.sg',         'institutional', 'NHG — Woodlands Health'),
  ('imh.com.sg',        'institutional', 'NHG — Institute of Mental Health'),
  ('nsc.com.sg',        'institutional', 'NHG — National Skin Centre'),
  ('ncid.sg',           'institutional', 'NHG — National Centre for Infectious Diseases')
ON CONFLICT (domain) DO NOTHING;

-- The two pre-Phase-1 invited users (were on DEMO_WHITELIST): their gmail
-- addresses would land in the public tier — keep their Sonnet access.
INSERT INTO email_overrides (email, tier, note) VALUES
  ('arthurjyong@gmail.com', 'institutional', 'app owner'),
  ('k.teohk@gmail.com',     'institutional', 'invited consultant')
ON CONFLICT (email) DO NOTHING;
