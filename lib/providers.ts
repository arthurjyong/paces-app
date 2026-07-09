// Server-only provider configuration for the multi-provider adapter.
//
// Every provider in the registry speaks the Anthropic Messages API, so the
// backend keeps a single @anthropic-ai/sdk code path and switches ONLY the
// baseURL + API key per provider. Two rules keep this safe:
// - The client never supplies a URL: the provider is derived server-side from
//   the allowlisted model id (lib/types.ts MODELS), and the baseURL comes from
//   this fixed map. A request can only ever reach one of the hosts below.
// - Keys (BYOK header or the server-held invited-access keys named here)
//   follow invariant 2 unchanged: straight into the SDK constructor, never
//   stored, logged, or echoed — regardless of provider.
//
// Capability flags are doc-verified against each provider's official
// Anthropic-compatibility documentation, 2026-07-08 (adversarially re-verified
// by a second research pass; see _APP_HANDOFF.md §multi-provider):
// - DeepSeek (api-docs.deepseek.com/guides/anthropic_api): forced tool_choice
//   supported; cache_control accepted-but-ignored (their prefix caching is
//   automatic); only the STRING form of `system` is documented.
// - Moonshot (docs at platform.kimi.ai — 301 from platform.moonshot.ai —
//   "Use Kimi in Claude Code" guide): Bearer auth is the
//   documented path; tool_choice semantics undefined → assume unforceable;
//   caching automatic; thinking is ON by default for kimi-k2.6 (reasoning
//   bills as output at $4/M) → disable it.
// - MiniMax (platform.minimax.io OpenAPI spec): tool_choice enum is exactly
//   ["auto","none"] → no forced tool; system-as-array + cache_control
//   supported but caching is also automatic for M3 — flattening is fine.
//
// Nothing in this module may be imported by client components (it names the
// DEMO_* env vars and, via demoKeyForProvider, reads them).

import type { ProviderId } from './types';

interface ProviderServerConfig {
  /**
   * Anthropic-compatible endpoint for the SDK — ALWAYS explicit (never
   * undefined: the SDK would then read ANTHROPIC_BASE_URL from the env, and
   * a stray env var must not be able to redirect traffic).
   */
  baseURL: string;
  /**
   * How the endpoint authenticates: 'x-api-key' = the SDK's apiKey option
   * (Anthropic default); 'bearer' = the SDK's authToken option
   * (Authorization: Bearer — Moonshot documents only this).
   */
  auth: 'x-api-key' | 'bearer';
  /** env var holding the server-held invited-access key for this provider */
  demoEnvVar: string;
  /**
   * Weaker-instruction-following models drift on the reveal discipline over a
   * long encounter; for these providers the backend appends a short reminder
   * to the LAST user turn of every chat call (transiently, server-side — the
   * client transcript is never mutated).
   */
  revealReminder: boolean;
  /**
   * True when the endpoint honours tool_choice:{type:'tool'} — marking uses
   * the forced submit_marksheet tool. False → the strict-JSON marking path
   * (same shared validation either way; lib/marksheet.ts).
   */
  forcedToolChoice: boolean;
  /**
   * True → flatten the two cache_control system blocks into one plain string
   * for this provider (array form undocumented on some compat endpoints, and
   * their prompt caching is automatic — the blocks buy nothing there).
   */
  systemAsString: boolean;
  /** True → send thinking:{type:'disabled'} (providers where it defaults ON). */
  thinkingOff: boolean;
}

export const PROVIDER_CONFIG: Record<ProviderId, ProviderServerConfig> = {
  // Vercel AI Gateway — the managed "one key, one top-up, zero markup" path
  // (Phase 0, 2026-07-09). Anthropic-Messages surface at ai-gateway.vercel.sh
  // (SDK appends /v1/messages; live 401 on a bad key confirmed). It fronts BOTH
  // offered models: anthropic/claude-sonnet-4.6 and deepseek/deepseek-v4-pro.
  // - forcedToolChoice: both underlying models honour it (Claude + DeepSeek).
  // - systemAsString false: keep the two cache_control blocks — the gateway is
  //   Anthropic-shaped and passes caching through to Sonnet (where $3/M input
  //   makes it real money); it translates/ignores for DeepSeek.
  // - revealReminder true: harmless for Sonnet, guards DeepSeek's weaker IF.
  gateway: {
    baseURL: 'https://ai-gateway.vercel.sh',
    auth: 'x-api-key',
    demoEnvVar: 'DEMO_GATEWAY_API_KEY',
    revealReminder: true,
    forcedToolChoice: true,
    systemAsString: false,
    thinkingOff: false,
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com',
    auth: 'x-api-key',
    demoEnvVar: 'DEMO_ANTHROPIC_API_KEY',
    revealReminder: false,
    forcedToolChoice: true,
    systemAsString: false,
    thinkingOff: false,
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/anthropic',
    auth: 'x-api-key',
    demoEnvVar: 'DEMO_DEEPSEEK_API_KEY',
    revealReminder: true,
    forcedToolChoice: true,
    systemAsString: true,
    thinkingOff: false,
  },
  moonshot: {
    baseURL: 'https://api.moonshot.ai/anthropic',
    auth: 'bearer',
    demoEnvVar: 'DEMO_MOONSHOT_API_KEY',
    revealReminder: true,
    forcedToolChoice: false,
    systemAsString: true,
    thinkingOff: true,
  },
  minimax: {
    baseURL: 'https://api.minimax.io/anthropic',
    auth: 'x-api-key',
    demoEnvVar: 'DEMO_MINIMAX_API_KEY',
    revealReminder: true,
    forcedToolChoice: false,
    systemAsString: true,
    thinkingOff: false,
  },
};

/** The server-held invited-access key for a provider, or null if not configured. */
export function demoKeyForProvider(provider: ProviderId): string | null {
  return process.env[PROVIDER_CONFIG[provider].demoEnvVar]?.trim() || null;
}

/** Providers with a server-held invited-access key configured. */
export function demoProviders(): ProviderId[] {
  return (Object.keys(PROVIDER_CONFIG) as ProviderId[]).filter(
    (p) => demoKeyForProvider(p) !== null
  );
}
