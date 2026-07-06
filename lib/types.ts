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

export const MODEL_ALLOWLIST = [
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
] as const;

export const DEFAULT_MODEL: (typeof MODEL_ALLOWLIST)[number] = 'claude-sonnet-4-6';

export const MODEL_LABELS: Record<(typeof MODEL_ALLOWLIST)[number], string> = {
  'claude-sonnet-4-6': 'Sonnet 4.6 (recommended)',
  'claude-opus-4-8': 'Opus 4.8 (deeper marking, ~5× cost)',
  'claude-haiku-4-5-20251001': 'Haiku 4.5 (cheapest, lighter viva)',
};

/** Client sends the user's Anthropic key in this header on every /api/examiner call. */
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
}
