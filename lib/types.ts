// Shared contract for the PACES AI-examiner MVP.
// Every module codes against these types; do not fork or duplicate them.

export type SkillId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Grade = 0 | 1 | 2;

export type EncounterType = 'examination' | 'communication' | 'consultation';

export interface CaseMeta {
  /** "<sitting>__<encounterNo>": carousel "2024-03_CGH_Cx__4", library "LIB_<collection>__12" */
  id: string;
  /** stable OPAQUE case code from ../_index/case_ids.json ("c0001"…) — the user-facing case ID,
   *  shown as "#c0001"; survives renames/moves, carries no content or provenance meaning */
  caseCode: string;
  /** source directory name: a dated sitting ("2024-03_CGH_Cx") or a synthetic "LIB_<collection>" */
  sitting: string;
  /** human label — hospital + month for carousels ("CGH · Mar 2024"; same-month sittings share a
   *  label and merge in the picker) or the pooled type bank for standalone cases
   *  ("Consult bank" / "Communication bank" / "Examination bank" — provenance is internal only) */
  sittingLabel: string;
  /** carousel: encounter 1..8 within the sitting; library: sequential display number within its
   *  pooled bank (the stable id keys off the collection FILE number instead — never this) */
  encounterNo: number;
  /** 1..5 */
  station: number;
  /** "Respiratory" | "Cardiovascular" | "Neurology" | "Abdominal" | "Communication" | "Consultation" */
  specialty: string;
  encounterType: EncounterType;
  skills: SkillId[];
  /** e.g. "6 min exam + 4 min Q&A" */
  timing: string;
  /** SPOILER-FREE: built from filename metadata only, never from the case H1 title */
  displayTitle: string;
  /** filename relative to content/cases/, e.g. "2024-03_CGH_Cx__4_Station3_Cardiovascular.md" */
  file: string;
  /** clinical theme / topic — e.g. "endocrine", "ophthalmology". An ATTRIBUTE, not a station;
   *  safe for the client (same granularity as specialty). May be undefined if themes not built. */
  theme?: string;
  /** matched canonical grounding notes (slugs without .md); may be empty */
  canonicalSlugs: string[];
}

export interface Manifest {
  builtAt: string;
  caseCount: number;
  cases: CaseMeta[];
}

/**
 * Spoiler-safe projection of CaseMeta — the ONLY meta shape that may leave the
 * server (invariant 1). `canonicalSlugs` is derived from the case H1 title, so
 * the slugs name the hidden diagnosis (invariant 4's rationale); `file` is
 * filename-derived and non-spoiler but the client never uses it. Both stay
 * server-side.
 */
export type PublicCaseMeta = Omit<CaseMeta, 'canonicalSlugs' | 'file'>;

/** Manifest as served by GET /api/manifest — cases projected to PublicCaseMeta. */
export interface PublicManifest {
  builtAt: string;
  caseCount: number;
  cases: PublicCaseMeta[];
}

/** Public case payload (GET /api/case/[id]) — the ONLY case content the client may ever receive. */
export interface PublicCase {
  meta: PublicCaseMeta;
  /** markdown of the "## Candidate stem" section ONLY */
  stem: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExaminerRequest {
  caseId: string;
  /** must be in MODEL_ALLOWLIST; defaults to DEFAULT_MODEL */
  model?: string;
  /** full transcript, held by the client; stateless backend */
  messages: ChatMessage[];
  action: 'chat' | 'mark';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Server-side clinical-image record for one case (from content/case_images.json,
 * keyed by caseCode). The `id`/`region` are examiner-facing only; only a
 * RevealedImage (url + caption) may reach the client, and only via a chat reveal.
 */
export interface CaseImage {
  /** opaque marker id the examiner emits, e.g. "im01" (carries no diagnosis) */
  id: string;
  /** public asset URL, e.g. "/case-images/im01.jpeg" */
  url: string;
  /** SIGN-level caption (spoiler-safe — describes the finding, not the diagnosis) */
  caption: string;
  /** examination region that unlocks it (hands, fundus, …) */
  region: string;
}

/** A clinical photo revealed to the candidate mid-encounter (client-safe subset of CaseImage). */
export interface RevealedImage {
  url: string;
  caption: string;
}

export interface ExaminerChatResponse {
  reply: string;
  /** count only — never echo kb queries or matched slugs to the client (spoiler risk) */
  kbLookups: number;
  usage: TokenUsage;
  /** photos the examiner revealed this turn (findings-gated; empty/omitted if none) */
  images?: RevealedImage[];
}

export interface SkillMark {
  skill: SkillId;
  grade: Grade;
  justification: string;
}

export interface MarkSheet {
  skills: SkillMark[];
  total: number;
  maxTotal: number;
  overallImpression: string;
  biggestImprovement: string;
}

export interface ExaminerMarkResponse {
  marksheet: MarkSheet;
  usage: TokenUsage;
}

export interface ApiError {
  error: string;
}

/** term (lowercased) -> canonical slugs (without .md) */
export type KbLookup = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Model / provider registry (client-safe — labels and ids only; base URLs and
// server-held key config live in the server-only lib/providers.ts)
// ---------------------------------------------------------------------------

/**
 * Providers the backend can call. Every entry exposes an
 * Anthropic-Messages-compatible endpoint, so the same @anthropic-ai/sdk client
 * serves all of them — the server only switches baseURL + API key by the
 * selected model (the client never controls a URL; see SPEC.md).
 *
 * `gateway` = Vercel AI Gateway: ONE key + ONE top-up that fans out (at zero
 * markup) to Claude + DeepSeek models. It is the managed door's only provider
 * (Phase 0, 2026-07-09; metered per-user in Phase 1). `openrouter` (Phase 1)
 * is the promoted BYOK aggregator — one user key reaches Claude + GPT +
 * DeepSeek via OpenRouter's Anthropic-Messages endpoint. The remaining direct
 * providers (deepseek/moonshot/minimax) stay wired server-side for BYOK-direct
 * + as the off-Vercel escape hatch, but are not offered in MODELS.
 */
export type ProviderId = 'gateway' | 'anthropic' | 'openrouter' | 'deepseek' | 'moonshot' | 'minimax';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** where a user creates an API key for this provider (shown in Settings) */
  keyConsoleUrl: string;
  keyPlaceholder: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'gateway', label: 'Vercel AI Gateway', keyConsoleUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys', keyPlaceholder: 'vck_…' },
  { id: 'anthropic', label: 'Anthropic', keyConsoleUrl: 'https://console.anthropic.com/', keyPlaceholder: 'sk-ant-…' },
  { id: 'openrouter', label: 'OpenRouter', keyConsoleUrl: 'https://openrouter.ai/settings/keys', keyPlaceholder: 'sk-or-…' },
  { id: 'deepseek', label: 'DeepSeek', keyConsoleUrl: 'https://platform.deepseek.com/', keyPlaceholder: 'sk-…' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', keyConsoleUrl: 'https://platform.moonshot.ai/', keyPlaceholder: 'sk-…' },
  { id: 'minimax', label: 'MiniMax', keyConsoleUrl: 'https://platform.minimax.io/', keyPlaceholder: '…' },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  // The registry is a fixed literal covering every ProviderId — find can't miss.
  return PROVIDERS.find((p) => p.id === id) as ProviderInfo;
}

export interface ModelInfo {
  /**
   * Registry id — what the client selects, stores, and sends; unique across
   * ALL providers. Usually also the upstream wire id; where the same upstream
   * slug exists under two providers (gateway vs OpenRouter both use
   * "anthropic/claude-sonnet-4.6"), the registry id is prefixed and `wireId`
   * carries the real slug.
   */
  id: string;
  provider: ProviderId;
  /** picker label; includes a rough per-case cost hint (the user's cost dial) */
  label: string;
  /** upstream model id, when it differs from the registry id */
  wireId?: string;
}

/**
 * The offered models (Phase 1, 2026-07-09).
 * - gateway — the MANAGED door (server key, login-gated, per-user metered;
 *   which of the two a signed-in user may run is tier-gated server-side) AND
 *   available to a BYOK gateway key. Slugs + list prices verified live on the
 *   gateway models API 2026-07-09 (zero markup: Sonnet 4.6 $3/$15 per M,
 *   DeepSeek V4 Pro $0.435/$0.87 per M; both 1M context).
 * - anthropic — BYOK-direct Claude lineup (the user's own Anthropic key).
 * - openrouter — BYOK curated shortlist (one OpenRouter key reaches Claude +
 *   GPT + DeepSeek; deliberately NOT the full 300-model catalog). Slugs
 *   verified on the OpenRouter models API 2026-07-09.
 */
export const MODELS: readonly ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4.6', provider: 'gateway', label: 'Claude Sonnet 4.6 (premium · ~$0.30/case)' },
  { id: 'deepseek/deepseek-v4-pro', provider: 'gateway', label: 'DeepSeek V4 Pro (budget · ~$0.02/case)' },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6 (premium · ~$0.30/case)' },
  { id: 'claude-opus-4-8', provider: 'anthropic', label: 'Claude Opus 4.8 (top marking · ~$1.50/case)' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5 (fast · ~$0.10/case)' },
  { id: 'openrouter/anthropic/claude-sonnet-4.6', provider: 'openrouter', wireId: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (premium · ~$0.30/case)' },
  { id: 'openrouter/openai/gpt-5.5', provider: 'openrouter', wireId: 'openai/gpt-5.5', label: 'GPT-5.5 (premium)' },
  { id: 'openrouter/deepseek/deepseek-v4-pro', provider: 'openrouter', wireId: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro (budget · ~$0.02/case)' },
];

export const MODEL_ALLOWLIST: readonly string[] = MODELS.map((m) => m.id);

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

/** Provider of an allowlisted model id; undefined for anything else. */
export function modelProvider(model: string): ProviderId | undefined {
  return MODELS.find((m) => m.id === model)?.provider;
}

/** Upstream wire id for an allowlisted registry id (falls back to the id itself). */
export function modelWireId(model: string): string {
  const entry = MODELS.find((m) => m.id === model);
  return entry?.wireId ?? model;
}

/** Client sends the SELECTED MODEL'S PROVIDER API key in this header on every /api/examiner call. */
export const API_KEY_HEADER = 'x-user-api-key';

// ---------------------------------------------------------------------------
// Managed access (email + 6-digit OTP sign-in, domain-tiered — Phase 1;
// replaces the Phase-0 whitelist/magic-link "invited access"). Tier names,
// caps, per-tier model lists, and the /api/auth/status shape live in
// lib/tiers.ts (client-safe); the server core is lib/managed.ts.
// ---------------------------------------------------------------------------

/** POST /api/auth/request response body. */
export interface AuthRequestResponse {
  /**
   * 'sent'        — a code is on its way (for ANY address on an eligible
   *                 domain; whether an account exists is never revealed).
   * 'byok_only'   — the domain is on neither allow-list: managed access is
   *                 not available, use your own API key (domain eligibility
   *                 is public product behaviour, not personal data).
   */
  status: 'sent' | 'byok_only';
  message: string;
}

/** POST /api/auth/verify success body (the session cookie rides on the response). */
export interface AuthVerifyResponse {
  ok: true;
}
