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
 * `gateway` = Vercel AI Gateway: the MANAGED door's server-side provider —
 * ONE operator key that fans out (zero markup) to the tier's free models
 * (Phase 0; metered per-user in Phase 1). It is NEVER a BYOK option — a user
 * reaches it by signing in, not by pasting a key. `anthropic` = the BYOK door:
 * the user's own Claude key (Sonnet / Opus / Haiku). The other direct providers
 * (deepseek/moonshot/minimax) stay wired server-side as an off-Vercel escape
 * hatch but are not offered in MODELS or surfaced in the UI.
 */
export type ProviderId = 'gateway' | 'anthropic' | 'deepseek' | 'moonshot' | 'minimax';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** where a user creates an API key for this provider (shown in Settings) */
  keyConsoleUrl: string;
  keyPlaceholder: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'gateway', label: 'Vercel AI Gateway', keyConsoleUrl: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys', keyPlaceholder: 'vck_…' },
  // BYOK is Claude only: the "Get a key" link and placeholder speak Claude.
  { id: 'anthropic', label: 'Claude', keyConsoleUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…' },
  { id: 'deepseek', label: 'DeepSeek', keyConsoleUrl: 'https://platform.deepseek.com/', keyPlaceholder: 'sk-…' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', keyConsoleUrl: 'https://platform.moonshot.ai/', keyPlaceholder: 'sk-…' },
  { id: 'minimax', label: 'MiniMax', keyConsoleUrl: 'https://platform.minimax.io/', keyPlaceholder: '…' },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  // The registry is a fixed literal covering every ProviderId — find can't miss.
  return PROVIDERS.find((p) => p.id === id) as ProviderInfo;
}

export interface ModelInfo {
  /** registry id — what the client selects, stores, and sends; also the upstream wire id */
  id: string;
  provider: ProviderId;
  /** plain model name for the picker (no jargon — the audience is clinicians) */
  label: string;
}

/**
 * The offered models (Phase 1, picker simplified 2026-07-09 per Arthur).
 * - gateway — the MANAGED door's free model (server key, login-gated, per-user
 *   metered). The free tier is UNIFORM (DeepSeek V4 Pro only; see TIER_MODELS
 *   in lib/tiers.ts) and its model name is never shown to the user. NOT a
 *   selectable BYOK option — reached only by signing in. Gateway Sonnet was
 *   removed 2026-07-09 (no tier runs it — re-add here + in TIER_MODELS to
 *   re-differentiate a tier later; its price row stays in lib/pricing.ts).
 * - anthropic — the BYOK door: the user's own Claude key. Sonnet 4.6 is the
 *   default; Opus 4.8 and Haiku 4.5 are the options. (OpenRouter and a
 *   BYOK gateway key were dropped 2026-07-09 — BYOK users bring Claude.)
 */
export const MODELS: readonly ModelInfo[] = [
  { id: 'deepseek/deepseek-v4-pro', provider: 'gateway', label: 'DeepSeek V4 Pro' },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-8', provider: 'anthropic', label: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5' },
];

export const MODEL_ALLOWLIST: readonly string[] = MODELS.map((m) => m.id);

/** The BYOK default (Claude Sonnet 4.6 on the user's own key); signed-in users are switched to their free tier model client-side. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Provider of an allowlisted model id; undefined for anything else. */
export function modelProvider(model: string): ProviderId | undefined {
  return MODELS.find((m) => m.id === model)?.provider;
}

/** BYOK Claude models (the anthropic-direct lineup), in picker order. */
export const BYOK_MODELS: readonly ModelInfo[] = MODELS.filter((m) => m.provider === 'anthropic');

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

// ---------------------------------------------------------------------------
// Public SEO landing pages (name-free revision content served at /[slug]).
// Authored offline (see _SEO_NOTES.md + scripts/build-content.mjs), stored as
// content/landing/<slug>.json, rendered statically. These carry NO hidden case
// material — they are public revision pages ABOUT named conditions/stations,
// deliberately decoupled from the opaque case bank (no case codes, no answer
// keys). Shape mirrors the workflow's PAGE_SCHEMA.
// ---------------------------------------------------------------------------

export type LandingKind = 'format' | 'hub' | 'condition';

export interface LandingSection {
  heading: string;
  /** body paragraphs; may contain **bold** inline markers (no other markdown) */
  paragraphs?: string[];
  /** bullet items; may contain **bold** inline markers */
  bullets?: string[];
}

export interface LandingFaq {
  question: string;
  answer: string;
}

export interface LandingPage {
  /** URL slug (also the filename stem); the page renders at /<slug> */
  slug: string;
  kind: LandingKind;
  /** the <title> (layout appends " — PACES Buddy") */
  title: string;
  /** meta description, ~150 chars */
  metaDescription: string;
  /** visible page heading */
  h1: string;
  /** lede paragraph under the h1 */
  intro: string;
  sections: LandingSection[];
  faq?: LandingFaq[];
  /** internal links to other landing slugs (validated against on-disk slugs at load) */
  relatedSlugs: string[];
  /** one-line invitation to practise in the app */
  practiceCta: string;
  /** reference search phrases (not rendered) */
  keywords: string[];
}
