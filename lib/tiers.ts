// Managed-tier contract shared by client and server (client-safe: names,
// caps, and model lists only — no keys, no URLs, no per-user data).
//
// The two tiers (binding spec: ../_MANAGED_TIER_PLAN.md §2, locked with the
// owner 2026-07-09):
// - public        — major consumer email providers; DeepSeek only; US$1/mo.
// - institutional — approved SG-healthcare domains;  Sonnet + DeepSeek; US$2/mo.
// Which bucket an email falls in lives in the DATABASE (allowed_domains +
// email_overrides — owner-editable without a redeploy); this module only
// fixes what each tier MEANS.

export type Tier = 'public' | 'institutional';

export const TIER_LABELS: Record<Tier, string> = {
  public: 'Public',
  institutional: 'Institutional',
};

/** Default monthly USD allowance per tier (email_overrides may raise it per user). */
export const TIER_ALLOWANCE_USD: Record<Tier, number> = {
  public: 1,
  institutional: 2,
};

/**
 * Models each tier may run on the server-held gateway key. These are MODELS
 * registry ids (all provider 'gateway' — the managed door only ever routes
 * through the Vercel AI Gateway).
 */
export const TIER_MODELS: Record<Tier, readonly string[]> = {
  public: ['deepseek/deepseek-v4-pro'],
  institutional: ['anthropic/claude-sonnet-4.6', 'deepseek/deepseek-v4-pro'],
};

export function isTier(value: unknown): value is Tier {
  return value === 'public' || value === 'institutional';
}

/** GET /api/auth/status response — the client's whole view of the managed session. */
export interface ManagedStatus {
  active: boolean;
  /** masked, e.g. "a***@gmail.com" — the full address never leaves the server */
  email?: string;
  tier?: Tier;
  /** MODELS ids the session may run on the server key (tier-filtered) */
  models?: string[];
  /** this calendar month's meter, USD (allowance may be a per-user override) */
  allowanceUsd?: number;
  spentUsd?: number;
  reservedUsd?: number;
  /** period key, e.g. "2026-07" (calendar month, Asia/Singapore) */
  period?: string;
}
