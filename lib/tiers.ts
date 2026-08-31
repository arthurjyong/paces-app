// Managed-tier contract shared by client and server (client-safe: names,
// caps, and model lists only — no keys, no URLs, no per-user data).
//
// The two tiers share the model list (DeepSeek only, name NOT surfaced to
// users — "free practice") but differ on allowance since 2026-08-31 (owner
// decision): public US$1/month, institutional effectively uncapped — the
// global MANAGED_DAILY_CAP_USD backstop is then their only spend gate.
// Which bucket an email falls in lives in the DATABASE
// (allowed_domains + email_overrides — owner-editable without a redeploy);
// this module only fixes what each tier MEANS. A per-user override
// (email_overrides.monthly_allowance_usd) is how the owner grants more to an
// individual who's asked for it.

export type Tier = 'public' | 'institutional';

export const TIER_LABELS: Record<Tier, string> = {
  public: 'Public',
  institutional: 'Institutional',
};

/** Default monthly USD credit per tier (email_overrides may raise it per user, on request).
 * institutional 9999 = "no monthly cap" (owner decision 2026-08-31): it must stay
 * within user_balances.allowance_usd NUMERIC(8,4), and the global daily cap is
 * unreachable long before it — do NOT use Infinity (unstorable in the column). */
export const TIER_ALLOWANCE_USD: Record<Tier, number> = {
  public: 1,
  institutional: 9999,
};

/**
 * Models each tier may run on the server-held gateway key (MODELS registry
 * ids, all provider 'gateway'). Uniform DeepSeek for now — the free experience
 * never names the model; the picker shows "Free practice".
 */
export const TIER_MODELS: Record<Tier, readonly string[]> = {
  public: ['deepseek/deepseek-v4-pro'],
  institutional: ['deepseek/deepseek-v4-pro'],
};

export function isTier(value: unknown): value is Tier {
  return value === 'public' || value === 'institutional';
}

/** Error text of the recall-case gate, shared by /api/case and /api/examiner
 *  (client-safe: shown to users verbatim). */
export const RECALL_LOCKED_ERROR =
  'Past-exam recall cases unlock with an institutional sign-in. Sign in with your hospital email (MOHH, cluster or hospital address) and try again.';

/**
 * GET /api/auth/status response — the client's whole view of the managed
 * session. Deliberately does NOT include the spend meter: users are never told
 * how much credit they have (owner decision 2026-07-09) — when they run out
 * they simply get a "used up your free credit" error at call time.
 */
export interface ManagedStatus {
  active: boolean;
  /** stable OPAQUE per-user token (HMAC of the user id) — lets the client detect an identity change and wipe the local History store on a shared device; not the raw id, reveals nothing */
  id?: string;
  /** masked, e.g. "a***@gmail.com" — the full address never leaves the server */
  email?: string;
  tier?: Tier;
  /** MODELS ids the session may run on the server key (tier-filtered) — used by the client to route the call, never displayed by model name */
  models?: string[];
}
