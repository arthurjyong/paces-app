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
 * Providers the backend can call. All non-Anthropic entries expose an
 * Anthropic-Messages-compatible endpoint, so the same @anthropic-ai/sdk client
 * serves every provider — the server only switches baseURL + API key by the
 * selected model (the client never controls a URL; see SPEC.md).
 */
export type ProviderId = 'anthropic' | 'deepseek' | 'moonshot' | 'minimax';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** where a user creates an API key for this provider (shown in Settings) */
  keyConsoleUrl: string;
  keyPlaceholder: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', keyConsoleUrl: 'https://console.anthropic.com/', keyPlaceholder: 'sk-ant-…' },
  { id: 'deepseek', label: 'DeepSeek', keyConsoleUrl: 'https://platform.deepseek.com/', keyPlaceholder: 'sk-…' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', keyConsoleUrl: 'https://platform.moonshot.ai/', keyPlaceholder: 'sk-…' },
  { id: 'minimax', label: 'MiniMax', keyConsoleUrl: 'https://platform.minimax.io/', keyPlaceholder: '…' },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  // The registry is a fixed literal covering every ProviderId — find can't miss.
  return PROVIDERS.find((p) => p.id === id) as ProviderInfo;
}

export interface ModelInfo {
  /** wire model id sent upstream — unique across ALL providers by convention */
  id: string;
  provider: ProviderId;
  /** picker label; includes a rough per-case cost hint (the user's cost dial) */
  label: string;
}

export const MODELS: readonly ModelInfo[] = [
  { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Sonnet 4.6 (recommended · ~$0.30/case)' },
  { id: 'claude-opus-4-8', provider: 'anthropic', label: 'Opus 4.8 (deeper marking · ~5× cost)' },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', label: 'Haiku 4.5 (lighter viva · ~$0.10/case)' },
  // Budget tier — Anthropic-compatible endpoints; ids + pricing doc-verified
  // 2026-07-08 (do NOT use the deepseek-chat/reasoner aliases: hard-deprecated
  // 2026-07-24).
  { id: 'deepseek-v4-flash', provider: 'deepseek', label: 'DeepSeek V4 Flash (cheapest · ~$0.01/case)' },
  { id: 'deepseek-v4-pro', provider: 'deepseek', label: 'DeepSeek V4 Pro (budget · ~$0.02/case)' },
  { id: 'kimi-k2.6', provider: 'moonshot', label: 'Kimi K2.6 (best budget roleplay · ~$0.15/case)' },
  { id: 'MiniMax-M3', provider: 'minimax', label: 'MiniMax M3 (~$0.06/case)' },
];

export const MODEL_ALLOWLIST: readonly string[] = MODELS.map((m) => m.id);

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Provider of an allowlisted model id; undefined for anything else. */
export function modelProvider(model: string): ProviderId | undefined {
  return MODELS.find((m) => m.id === model)?.provider;
}

/** Client sends the SELECTED MODEL'S PROVIDER API key in this header on every /api/examiner call. */
export const API_KEY_HEADER = 'x-user-api-key';

// ---------------------------------------------------------------------------
// Demo access (whitelisted magic-link sign-in — see SPEC.md "Demo access")
// ---------------------------------------------------------------------------

/**
 * POST /api/demo/request ALWAYS answers 200 with exactly this message, whether
 * or not the email is whitelisted (no email enumeration — the text must stay
 * byte-identical for every input, but it may still be helpful).
 */
export const DEMO_REQUEST_MESSAGE =
  'If this address has been invited, a sign-in link is on its way — check your inbox and spam folder. The link works for 15 minutes. No email? Check the address is exactly the one the app owner invited, then send again.';

/** POST /api/demo/request response body. */
export interface DemoRequestResponse {
  message: string;
}

/**
 * GET /api/demo/status response. `email` is masked (e.g. "c***@example.com") —
 * the full address never leaves the server.
 */
export interface DemoStatus {
  active: boolean;
  email?: string;
  /**
   * Providers the invited-access server key covers (present only when active).
   * Lets the client warn before a model whose provider has no server-held key
   * is used keylessly. Absent/empty ⇒ assume the historical Anthropic-only setup.
   */
  providers?: ProviderId[];
}
