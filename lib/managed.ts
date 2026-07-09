// Server-only managed-tier core (Phase 1): email + 6-digit OTP sign-in,
// domain→tier resolution, the 30-day session cookie, and per-user
// reserve-then-settle spend metering. Replaces the Phase-0 invited-access
// gate (lib/demo.ts — whitelist + magic link); the signed-token and SMTP
// machinery is ported from there unchanged (it was red-teamed 2026-07-08).
//
// Trust model:
// - The session cookie is a stateless HMAC token {sub, email, purpose, exp}
//   signed with AUTH_SECRET — but AUTHORIZATION is re-derived from the
//   database on every use (email_overrides / allowed_domains), so removing a
//   domain or override revokes outstanding sessions immediately, exactly like
//   the old whitelist re-check.
// - OTP codes: 6 digits, single-use, 10-minute expiry, at most 5 verify
//   attempts — attempts and send-rate are enforced in Postgres (durable
//   across serverless cold starts; the old in-memory limiter guards IPs only).
//   Stored as HMAC-SHA256(AUTH_SECRET, email:code) — a leaked DB row alone
//   cannot be brute-forced offline without the signing secret.
// - Domain ELIGIBILITY is public product behaviour (the UI documents which
//   providers qualify), so request/verify responses may say "this domain is
//   BYOK-only" — unlike the old whitelist, that leaks nothing personal.
//
// Nothing in this module may be imported by client components — it reads
// AUTH_SECRET, DATABASE_URL, SMTP creds, and DEMO_GATEWAY_API_KEY.

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { cookies } from 'next/headers';
import { createTransport } from 'nodemailer';
import { dbConfigured, query, sgtDay, sgtMonth, withTransaction } from './db';
import { TIER_ALLOWANCE_USD, TIER_MODELS, isTier, type ManagedStatus, type Tier } from './tiers';
import { PROVIDER_CONFIG } from './providers';

/** httpOnly cookie holding the signed managed-session token. */
export const MANAGED_SESSION_COOKIE = 'paces_session';
/** Managed sessions last 30 days, then the user signs in again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** OTP codes die after 10 minutes (plan §3). */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** A code dies after this many wrong entries (10^6 combos can't be walked). */
export const OTP_MAX_ATTEMPTS = 5;
/** Codes emailed per address per hour (durable, counted in otp_codes). */
export const OTP_EMAIL_SEND_LIMIT = 5;
/**
 * Per-IP send ceiling (in-memory, best-effort): deliberately looser —
 * hospital NAT puts many users behind one IP, and x-forwarded-for is only
 * meaningful behind a trusted proxy (Vercel). The durable per-email limit is
 * the real bound.
 */
export const OTP_IP_SEND_LIMIT = 30;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The managed door exists only when fully configured: a signing secret, the
 * database (tiers, OTP state, ledger), and the server-held gateway key to
 * spend. Anything less and every managed endpoint fails closed with generic
 * responses (never an error that reveals server configuration).
 */
export function managedEnabled(): boolean {
  return Boolean(process.env.AUTH_SECRET) && dbConfigured() && managedGatewayKey() !== null;
}

/**
 * The server-held Vercel AI Gateway key the managed door spends. Env var name
 * kept from Phase 0 (already set on prod). Same handling rules as a BYOK key:
 * straight into the SDK constructor, never stored, logged, or echoed.
 */
export function managedGatewayKey(): string | null {
  return process.env[PROVIDER_CONFIG.gateway.demoEnvVar]?.trim() || null;
}

/** Global managed-spend backstop per SGT day, USD (plan §4.4). */
export function managedDailyCapUsd(): number {
  const raw = Number(process.env.MANAGED_DAILY_CAP_USD ?? '5');
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

// ---------------------------------------------------------------------------
// Email normalisation / masking (ported verbatim from lib/demo.ts)
// ---------------------------------------------------------------------------

/** Lowercased, trimmed email — or null if the input isn't a plausible address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Mask for status display only (the value is always the caller's OWN verified
 * email, so this is PII hygiene, not a security boundary). Shows one char of
 * the local part and partially obscures the domain — a fixed shape regardless
 * of local-part length, so a two-char local part ("ab@…") doesn't reveal its
 * whole self. "candidate@gmail.com" -> "c***@g***.com".
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const maskedDomain = dot > 0 ? `${domain[0]}***${domain.slice(dot)}` : `${domain[0] ?? ''}***`;
  return `${local[0] ?? ''}***@${maskedDomain}`;
}

/** The domain part of a normalized email ("gmail.com"). */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

/**
 * A stable, OPAQUE per-user token derived from the user id — surfaced in
 * ManagedStatus so the client can detect an identity change (and wipe the
 * local History store on a shared device) without exposing the raw users.id.
 * HMAC'd with AUTH_SECRET; non-colliding across users, reveals nothing.
 */
export function opaqueUserId(sub: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(`history-owner:${sub}`).digest('base64url').slice(0, 22);
}

// ---------------------------------------------------------------------------
// Signed session tokens (HMAC machinery ported verbatim from lib/demo.ts;
// the payload gains `sub` — the users.id — and a new disjoint purpose, so no
// legacy demo_session or link token can ever validate here)
// ---------------------------------------------------------------------------

const TOKEN_PURPOSE = 'managed_session';

interface SessionPayload {
  /** users.id (pg returns BIGINT as string — kept as string everywhere) */
  sub: string;
  email: string;
}

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Constant-time string equality. Both sides are hashed first so lengths always
 * match (timingSafeEqual throws on length mismatch, and the length itself must
 * not leak timing either).
 */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Signed session token for a verified user, or null when AUTH_SECRET is unset. */
export function createSessionToken(userId: string, email: string): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, email, purpose: TOKEN_PURPOSE, exp: Date.now() + SESSION_TTL_MS }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify signature (constant-time), purpose, and expiry; returns the embedded
 * identity or null. Deliberately silent about WHY a token failed.
 */
export function verifySessionToken(token: unknown): SessionPayload | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return null;
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(sign(payloadB64, secret), signature)) return null;

  let parsed: { sub?: unknown; email?: unknown; purpose?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.purpose !== TOKEN_PURPOSE) return null;
  if (typeof parsed.exp !== 'number' || Date.now() >= parsed.exp) return null;
  if (typeof parsed.sub !== 'string' || !parsed.sub) return null;
  if (typeof parsed.email !== 'string' || !parsed.email) return null;
  return { sub: parsed.sub, email: parsed.email };
}

/** Identity of a valid managed session on the current request, or null. */
export async function readManagedSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(MANAGED_SESSION_COOKIE)?.value;
  if (!raw) return null;
  return verifySessionToken(raw);
}

// ---------------------------------------------------------------------------
// Tier resolution — the authorization decision, ALWAYS live from the DB
// ---------------------------------------------------------------------------

export interface TierGrant {
  tier: Tier;
  allowanceUsd: number;
}

/**
 * What the managed door owes this email right now: a per-address override
 * first (with its optional custom allowance), else the domain allow-lists,
 * else null (BYOK only). Checked at OTP request, OTP verify, AND every
 * examiner call — the DB rows are the single source of authorization.
 */
export async function resolveTier(email: string): Promise<TierGrant | null> {
  const override = await query<{ tier: string; monthly_allowance_usd: string | null }>(
    'SELECT tier, monthly_allowance_usd FROM email_overrides WHERE email = $1',
    [email]
  );
  if (override.rows[0] && isTier(override.rows[0].tier)) {
    const tier = override.rows[0].tier;
    const custom = override.rows[0].monthly_allowance_usd;
    return { tier, allowanceUsd: custom !== null ? Number(custom) : TIER_ALLOWANCE_USD[tier] };
  }
  const domain = await query<{ tier: string }>(
    'SELECT tier FROM allowed_domains WHERE domain = $1',
    [emailDomain(email)]
  );
  if (domain.rows[0] && isTier(domain.rows[0].tier)) {
    const tier = domain.rows[0].tier;
    return { tier, allowanceUsd: TIER_ALLOWANCE_USD[tier] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// In-memory IP rate limiting (best-effort brake, ported from lib/demo.ts —
// the durable per-email bound lives in otp_codes)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map<string, number[]>();

function ipRateOk(ip: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 1000) {
    for (const [k, hits] of rateBuckets) {
      if (hits.every((t) => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  const live = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  rateBuckets.set(ip, live);
  if (live.length >= OTP_IP_SEND_LIMIT) return false;
  live.push(now);
  return true;
}

/** Best-effort client IP for rate limiting (first x-forwarded-for hop). */
export function requestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

// ---------------------------------------------------------------------------
// OTP request / verify
// ---------------------------------------------------------------------------

function hashOtp(email: string, code: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('base64url');
}

/**
 * Send the code via SMTP. Dev without SMTP: log the code to the server
 * console so the flow can be exercised end-to-end. Production with missing/
 * partial SMTP: loud error WITHOUT the code (a live credential must never
 * land in deployment logs). Never throws.
 */
async function sendOtpEmail(email: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || '587');
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Logging a live code requires a DELIBERATE opt-in (MANAGED_LOG_OTP=1), not
    // merely a non-production NODE_ENV — so a preview/staging/default env can
    // never silently start writing real codes to logs.
    if (process.env.MANAGED_LOG_OTP === '1' && process.env.NODE_ENV !== 'production') {
      console.log(`[managed] SMTP not configured — sign-in code for ${email}: ${code}`);
      return;
    }
    console.error(
      `[managed] SMTP not (fully) configured — sign-in code NOT sent to ${email} (set MANAGED_LOG_OTP=1 in dev to log codes)`
    );
    return;
  }

  try {
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      // Bound every phase so a slow/hanging MX can't pin the serverless
      // invocation (the send is awaited before the response returns).
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 8_000,
    });
    await transporter.sendMail({
      from: `"PACES Buddy" <${user}>`,
      to: email,
      subject: `${code} is your PACES Buddy sign-in code`,
      text: `Hello,\n\nYour PACES Buddy sign-in code is:\n\n    ${code}\n\nType it into the app within 10 minutes. If you did not request this email, just ignore it — nobody can sign in without the code.\n`,
    });
  } catch (err) {
    console.error(
      '[managed] Failed to send sign-in code:',
      err instanceof Error ? err.message : 'unknown error'
    );
  }
}

export type OtpRequestResult = 'sent' | 'byok_only' | 'rate_limited' | 'unavailable';

/**
 * Step 1: issue a code. Domain-ineligible addresses get 'byok_only' (public
 * config, not personal data). Every prior unconsumed code for the address is
 * invalidated — exactly one code is live per email at a time.
 */
export async function requestOtp(email: string, ip: string): Promise<OtpRequestResult> {
  if (!managedEnabled()) return 'unavailable';
  if (!ipRateOk(ip)) return 'rate_limited';

  const grant = await resolveTier(email);
  if (!grant) return 'byok_only';

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  // The send-count check and the insert run in ONE transaction under a
  // per-email advisory lock, so concurrent requests for the same address can't
  // read-then-write their way past OTP_EMAIL_SEND_LIMIT (a plain SELECT-count
  // then INSERT races across serverless instances). pg_advisory_xact_lock
  // releases at commit/rollback and works under pgbouncer transaction pooling.
  const issued = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
    const sent = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_codes
       WHERE email = $1 AND created_at > now() - interval '1 hour'`,
      [email]
    );
    if ((sent.rows[0]?.n ?? 0) >= OTP_EMAIL_SEND_LIMIT) return false;
    // Exactly one live code per email: retire any unconsumed prior codes.
    await client.query(
      'UPDATE otp_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL',
      [email]
    );
    await client.query(
      'INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
      [email, hashOtp(email, code), new Date(Date.now() + OTP_TTL_MS)]
    );
    return true;
  });
  if (!issued) return 'rate_limited';

  await sendOtpEmail(email, code);
  return 'sent';
}

export type OtpVerifyResult =
  | { ok: true; sessionToken: string; tier: Tier }
  | { ok: false; reason: 'invalid' | 'unavailable' };

/**
 * Step 2: verify a typed code and mint the session. The attempt counter is
 * consumed ATOMICALLY BEFORE the hash comparison (a wrong guess and a right
 * guess both burn an attempt; ≤5 total per code), the code is single-use via
 * a conditional consume, and eligibility is re-checked so a domain removed
 * between request and verify cannot sign in. All failures collapse to
 * 'invalid' — no oracle for which check failed.
 */
export async function verifyOtp(email: string, code: string): Promise<OtpVerifyResult> {
  if (!managedEnabled()) return { ok: false, reason: 'unavailable' };
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'invalid' };

  const latest = await query<{ id: string; code_hash: string }>(
    `SELECT id, code_hash FROM otp_codes
     WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  const row = latest.rows[0];
  if (!row) return { ok: false, reason: 'invalid' };

  // Burn an attempt first; 0 rows updated ⇒ the code is already dead.
  const attempt = await query(
    'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL RETURNING id',
    [row.id, OTP_MAX_ATTEMPTS]
  );
  if (attempt.rowCount === 0) return { ok: false, reason: 'invalid' };

  if (!safeEqual(row.code_hash, hashOtp(email, code))) {
    return { ok: false, reason: 'invalid' };
  }

  // Single-use: the conditional consume wins for exactly one concurrent caller.
  const consumed = await query(
    'UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id',
    [row.id]
  );
  if (consumed.rowCount === 0) return { ok: false, reason: 'invalid' };

  const grant = await resolveTier(email);
  if (!grant) return { ok: false, reason: 'invalid' };

  const user = await query<{ id: string }>(
    `INSERT INTO users (email, domain, tier, last_sign_in_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (email) DO UPDATE
       SET domain = EXCLUDED.domain, tier = EXCLUDED.tier, last_sign_in_at = now()
     RETURNING id`,
    [email, emailDomain(email), grant.tier]
  );
  const sessionToken = createSessionToken(user.rows[0].id, email);
  if (!sessionToken) return { ok: false, reason: 'unavailable' };
  return { ok: true, sessionToken, tier: grant.tier };
}

// ---------------------------------------------------------------------------
// Status + metering
// ---------------------------------------------------------------------------

/**
 * Make sure this month's meter row exists and reflects the CURRENT allowance
 * (tier/override edits apply mid-month; spent/reserved are never touched).
 */
async function ensureBalance(userId: string, period: string, allowanceUsd: number): Promise<void> {
  await query(
    `INSERT INTO user_balances (user_id, period, allowance_usd) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, period) DO UPDATE SET allowance_usd = EXCLUDED.allowance_usd`,
    [userId, period, allowanceUsd]
  );
}

/**
 * The client's whole view of the managed session (GET /api/auth/status). We
 * ensure this month's balance row exists (the meter needs it), but the spend
 * numbers are NOT returned — users aren't shown their credit (owner decision).
 */
export async function getManagedStatus(): Promise<ManagedStatus> {
  if (!managedEnabled()) return { active: false };
  const session = await readManagedSession();
  if (!session) return { active: false };
  const grant = await resolveTier(session.email);
  if (!grant) return { active: false };

  await ensureBalance(session.sub, sgtMonth(), grant.allowanceUsd);
  return {
    active: true,
    id: opaqueUserId(session.sub),
    email: maskEmail(session.email),
    tier: grant.tier,
    models: [...TIER_MODELS[grant.tier]],
  };
}

export type ReserveResult = 'ok' | 'user_cap' | 'global_cap';

/**
 * The outcome of a reserve PLUS the exact period/day keys the reservation was
 * booked against. settleSpend MUST be handed these same keys — recomputing
 * them at settle time would use a different period/day for a call that crossed
 * an SGT midnight/month boundary between reserve and settle, stranding the
 * reservation in the old bucket and losing the charge (review 2026-07-09).
 */
export interface ReserveOutcome {
  result: ReserveResult;
  period: string;
  day: string;
}

/**
 * Atomic pre-call gate (plan §7): move `estUsd` into reserved_usd IFF the
 * user's remaining allowance covers it, and the global daily backstop too —
 * one transaction, so a rejected global check rolls the user reservation back.
 * The allowance refresh (tier/override edits apply mid-month) runs INSIDE the
 * same transaction so the gate reads an allowance written in this transaction.
 * period/day are frozen from a single `now` and returned for the settle.
 */
export async function reserveSpend(
  userId: string,
  estUsd: number,
  allowanceUsd: number
): Promise<ReserveOutcome> {
  const now = new Date();
  const period = sgtMonth(now);
  const day = sgtDay(now);
  const result = await withTransaction(async (client) => {
    // Fold the balance upsert in-transaction: the reserve gate must not read
    // an allowance a concurrent edit is mid-writing outside this transaction.
    await client.query(
      `INSERT INTO user_balances (user_id, period, allowance_usd) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, period) DO UPDATE SET allowance_usd = EXCLUDED.allowance_usd`,
      [userId, period, allowanceUsd]
    );
    const user = await client.query(
      `UPDATE user_balances SET reserved_usd = reserved_usd + $3
       WHERE user_id = $1 AND period = $2
         AND (allowance_usd - spent_usd - reserved_usd) >= $3
       RETURNING user_id`,
      [userId, period, estUsd]
    );
    if (user.rowCount === 0) {
      throw new ReserveRejected('user_cap');
    }
    await client.query('INSERT INTO global_spend (day) VALUES ($1) ON CONFLICT (day) DO NOTHING', [
      day,
    ]);
    const globe = await client.query(
      `UPDATE global_spend SET reserved_usd = reserved_usd + $2
       WHERE day = $1 AND ($3 - spent_usd - reserved_usd) >= $2
       RETURNING day`,
      [day, estUsd, managedDailyCapUsd()]
    );
    if (globe.rowCount === 0) {
      throw new ReserveRejected('global_cap');
    }
    return 'ok' as const;
  }).catch((err) => {
    if (err instanceof ReserveRejected) return err.result;
    throw err;
  });
  return { result, period, day };
}

class ReserveRejected extends Error {
  constructor(public readonly result: 'user_cap' | 'global_cap') {
    super(result);
  }
}

export interface SettleUsage {
  model: string;
  action: 'chat' | 'mark';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** provider response id — settlement idempotency key (null on error settles) */
  generationId: string | null;
}

/**
 * Post-call settle against the SAME period/day the reservation was booked
 * against (passed in from reserveSpend — never recomputed here; see
 * ReserveOutcome). Releases the reservation and moves the ACTUAL cost into
 * spent_usd + the append-only ledger, idempotent on generationId (the ledger
 * INSERT is the guard). On an upstream error pass usage=null: the reservation
 * is released and nothing is charged.
 *
 * Never throws — a settle failure after a delivered examiner reply must not
 * become a user-facing error. On failure it logs loudly and then makes a
 * best-effort RELEASE of just the reservation (so a failed success-settle does
 * not strand the estimate for the rest of the period); if even that fails, the
 * reservation self-clears at period end and the gateway balance still bounds
 * real spend.
 */
export async function settleSpend(
  userId: string,
  estUsd: number,
  usage: SettleUsage | null,
  period: string,
  day: string
): Promise<void> {
  const actualUsd = usage ? usage.costUsd : 0;
  try {
    await withTransaction(async (client) => {
      if (usage) {
        const inserted = await client.query(
          `INSERT INTO usage_events
             (user_id, model, action, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, generation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (generation_id) WHERE generation_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            userId,
            usage.model,
            usage.action,
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheReadTokens,
            usage.cacheWriteTokens,
            actualUsd,
            usage.generationId,
          ]
        );
        // Already settled under this generationId (retry): the money moved on
        // the first settle. Still RELEASE this call's held reservation (the
        // early return previously stranded it), but never touch spent_usd.
        if (usage.generationId !== null && inserted.rowCount === 0) {
          await releaseReservation(client, userId, estUsd, period, day);
          return;
        }
      }
      await client.query(
        `UPDATE user_balances
         SET reserved_usd = GREATEST(reserved_usd - $3, 0), spent_usd = spent_usd + $4
         WHERE user_id = $1 AND period = $2`,
        [userId, period, estUsd, actualUsd]
      );
      await client.query(
        `UPDATE global_spend
         SET reserved_usd = GREATEST(reserved_usd - $2, 0), spent_usd = spent_usd + $3
         WHERE day = $1`,
        [day, estUsd, actualUsd]
      );
    });
  } catch (err) {
    console.error(
      '[managed] settle failed — ledger/balance may under-count this call:',
      err instanceof Error ? err.message : 'unknown error'
    );
    // Best-effort release so a failed settle does not hold the estimate for
    // the rest of the period. Separate transaction; if it also fails the
    // reservation clears at period reset.
    try {
      await withTransaction((client) => releaseReservation(client, userId, estUsd, period, day));
    } catch {
      // give up — period reset is the final backstop
    }
  }
}

/** Release just the held reservation (never spent_usd) on both meters. */
async function releaseReservation(
  client: PoolClient,
  userId: string,
  estUsd: number,
  period: string,
  day: string
): Promise<void> {
  await client.query(
    `UPDATE user_balances SET reserved_usd = GREATEST(reserved_usd - $3, 0)
     WHERE user_id = $1 AND period = $2`,
    [userId, period, estUsd]
  );
  await client.query(
    `UPDATE global_spend SET reserved_usd = GREATEST(reserved_usd - $2, 0) WHERE day = $1`,
    [day, estUsd]
  );
}
