// Managed-tier contract shared by client and server (client-safe: names,
// caps, and model lists only — no keys, no URLs, no per-user data).
//
// The two tiers (kept in the schema for future differentiation, but as of
// 2026-07-09 they are UNIFORM per the owner: every free/managed user gets
// DeepSeek only, US$1, and the model name is NOT surfaced to them — "free
// practice"). Which bucket an email falls in lives in the DATABASE
// (allowed_domains + email_overrides — owner-editable without a redeploy);
// this module only fixes what each tier MEANS. A per-user override
// (email_overrides.monthly_allowance_usd) is how the owner grants more to an
// individual who's asked for it.

export type Tier = 'public' | 'institutional';

export const TIER_LABELS: Record<Tier, string> = {
  public: 'Public',
  institutional: 'Institutional',
};

/** Default monthly USD credit per tier (email_overrides may raise it per user, on request). */
export const TIER_ALLOWANCE_USD: Record<Tier, number> = {
  public: 1,
  institutional: 1,
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
