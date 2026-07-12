// Voice dictation (Lab experiment 1) — the client/server SHARED contract.
// Client-safe: limits and wire shapes only. Keys, per-minute rates, and
// provider URLs live server-side in lib/stt.ts (never import that here).
// Full design: SPEC.md "Voice dictation (Lab)".

/** Client-side recording cap. Bounds cost per clip AND keeps the upload well
 *  under Vercel's 4.5 MB function body limit even at Safari's 192 kbps AAC
 *  default (iOS has a history of ignoring audioBitsPerSecond). */
export const MAX_RECORD_SECONDS = 120;

/**
 * Hard byte ceiling on one uploaded clip (client guard + server cap).
 * 3 MiB, sized by the TIGHTEST downstream limit, not by Vercel's 4.5 MB
 * inbound one (review 2026-07-12): the gateway lane re-encodes the clip as
 * base64 (×4/3), and the AI Gateway rejects bodies over ~4.5 MB — so a clip
 * must stay under ~3.3 MiB to survive that leg. 3 MiB still clears the
 * worst realistic take: 120 s of Safari's default 192 kbps AAC ≈ 2.88 MB.
 */
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;

/**
 * Longest clip we will transcribe. The client auto-stops at
 * MAX_RECORD_SECONDS; the server re-derives the duration from the container
 * itself (lib/audioDuration.ts) and refuses anything past this BEFORE
 * touching a key — bytes alone do not bound duration (a low-bitrate clip can
 * pack hours into a few MB, which the provider would bill for).
 */
export const MAX_CLIP_SECONDS = MAX_RECORD_SECONDS + 30;

/** Ceiling on the client-supplied bias context. Whisper's prompt window is
 *  ~224 tokens — ~600 chars of glossary is already at that budget, and longer
 *  input is truncated upstream anyway. */
export const MAX_STT_PROMPT_CHARS = 600;

export interface SttModelPublic {
  id: string;
  label: string;
}

/** GET /api/transcribe (session-gated) — what this deployment can run. */
export interface TranscribeStatus {
  models: SttModelPublic[];
  maxSeconds: number;
  maxBytes: number;
  maxPromptChars: number;
}

/** POST /api/transcribe success payload. costUsd is the settled cost of THIS
 *  clip (public list-price arithmetic — the user's balance stays hidden). */
export interface TranscribeOk {
  text: string;
  durationSeconds: number | null;
  modelId: string;
  latencyMs: number;
  costUsd: number;
  warnings?: string[];
}
