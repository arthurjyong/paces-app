// Server-only speech-to-text lanes for the Lab dictation experiment
// (/api/transcribe). Two lanes, BOTH managed-door-only — SPEC invariant 9
// applies in full: no anonymous STT path, no BYOK STT lane, key reachable only
// behind a valid session + live tier + successful reservation.
//
// - groq    — whisper-large-v3 (the owner's proven Spokenly model) + turbo,
//             OpenAI-compatible multipart at api.groq.com, DEMO_GROQ_API_KEY.
//             Bills a minimum of 10 s per request.
// - gateway — OpenAI transcription models through the Vercel AI Gateway's v4
//             transcription endpoint, spending the SAME DEMO_GATEWAY_API_KEY
//             as the examiner. NOTE: the endpoint requires the
//             ai-gateway-protocol-version + ai-transcription-model-
//             specification-version headers (verified live 2026-07-12 — the
//             docs example omits both and the call 400s without them). STT on
//             the gateway is beta with gradual rollout; if this team's catalog
//             doesn't include the models yet the call fails and the route maps
//             it to a generic 502.
//
// STT pricing is deterministic per audio minute, so settle = duration × rate.
// The reserve estimate prices RESERVE_MINUTES (5 min) — comfortably past the
// UI's 2-minute cap, which the route ALSO enforces server-side by reading the
// duration out of the container before any key is touched
// (lib/audioDuration.ts). Bytes alone never bounded duration, and the provider
// bills the audio it receives, so that pre-call bound is what makes the
// estimate a true upper bound (SPEC: metering is a HARD bound).

import { managedGatewayKey } from './managed';
import type { SttModelPublic } from './stt-shared';

export interface SttModelInfo {
  id: string;
  label: string;
  provider: 'groq' | 'gateway';
  /** USD per audio minute — zero-markup list prices, verified 2026-07-12. */
  ratePerMinUsd: number;
  /** Provider bills at least this many seconds per request. */
  minBilledSeconds: number;
}

/**
 * Registry order = picker order. whisper-large-v3 (full model) first: the
 * owner's own-voice evidence is that distilled variants miss rare medical
 * terms, so turbo is a cost-check arm, not the default.
 */
export const STT_MODELS: readonly SttModelInfo[] = [
  {
    id: 'whisper-large-v3',
    label: 'Whisper large-v3 (Groq)',
    provider: 'groq',
    ratePerMinUsd: 0.111 / 60,
    minBilledSeconds: 10,
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper large-v3 turbo (Groq)',
    provider: 'groq',
    ratePerMinUsd: 0.04 / 60,
    minBilledSeconds: 10,
  },
  {
    id: 'openai/whisper-1',
    label: 'Whisper v2 (OpenAI via Gateway)',
    provider: 'gateway',
    ratePerMinUsd: 0.006,
    minBilledSeconds: 0,
  },
  {
    id: 'openai/gpt-4o-transcribe',
    label: 'GPT-4o Transcribe (OpenAI via Gateway)',
    provider: 'gateway',
    ratePerMinUsd: 0.006,
    minBilledSeconds: 0,
  },
];

export function sttModelInfo(id: unknown): SttModelInfo | undefined {
  return STT_MODELS.find((m) => m.id === id);
}

/** The server-held key for a lane, or null when that lane is unconfigured.
 *  Same handling rules as every server key: straight into the request,
 *  never stored, logged, or echoed. */
export function sttKeyFor(model: SttModelInfo): string | null {
  if (model.provider === 'groq') return process.env.DEMO_GROQ_API_KEY?.trim() || null;
  return managedGatewayKey();
}

/** The lanes this deployment can actually run (per-lane key present). */
export function availableSttModels(): SttModelPublic[] {
  return STT_MODELS.filter((m) => sttKeyFor(m) !== null).map((m) => ({
    id: m.id,
    label: m.label,
  }));
}

/**
 * Headroom over the enforced clip length (MAX_CLIP_SECONDS = 2.5 min): the
 * container duration is sniffed BEFORE the call, so the only slack the
 * estimate must absorb is a container that under-reports (fragmented MP4 with
 * no duration, a forged header). 5 minutes is 2× the enforced ceiling.
 */
const RESERVE_MINUTES = 5;

/** Pre-call reserve estimate — a genuine upper bound (floor matches the
 *  examiner estimate's floor). */
export function estimateTranscribeUsd(model: SttModelInfo): number {
  return Math.max(model.ratePerMinUsd * RESERVE_MINUTES, 0.005);
}

/** Actual USD for a settled clip from the provider-reported duration. */
export function actualTranscribeUsd(model: SttModelInfo, durationSeconds: number): number {
  const billed = Math.max(durationSeconds, model.minBilledSeconds);
  return (billed / 60) * model.ratePerMinUsd;
}

export interface SttResult {
  text: string;
  durationSeconds: number | null;
  /** provider response id for settle idempotency, when one is exposed */
  generationId: string | null;
  warnings: string[];
}

export type SttErrorKind = 'auth' | 'too_large' | 'bad_audio' | 'rate' | 'timeout' | 'other';

/** Typed upstream failure — the route maps `kind` to a FIXED client string;
 *  upstream response text never leaves the server. */
export class SttUpstreamError extends Error {
  constructor(public readonly kind: SttErrorKind) {
    super(`stt upstream: ${kind}`);
  }
}

/**
 * Upstream deadline. Deliberately well under the route's maxDuration = 60 s:
 * the settle/release transaction runs AFTER this in a finally, and a 55 s
 * timeout left so little margin that a slow invocation could be killed
 * mid-settle, LEAKING the reservation (review 2026-07-12). A 2-minute clip
 * transcribes in seconds on every lane, so 40 s is generous.
 */
const UPSTREAM_TIMEOUT_MS = 40_000;

/** Upload filename extension by container (Groq keys format detection off it). */
const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
};

export function sttExtForMime(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

function kindFromStatus(status: number): SttErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 413) return 'too_large';
  if (status === 400 || status === 415 || status === 422) return 'bad_audio';
  if (status === 429) return 'rate';
  return 'other';
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/**
 * One clip → one transcript on the given lane. `language: en` is forced on
 * both lanes (Whisper's auto language-ID is measurably unreliable for
 * Singapore-accented English and can flip whole clips into Malay);
 * temperature is pinned to 0 for dictation determinism. The optional bias
 * `prompt` is CLIENT-VISIBLE content only by contract (SPEC "Voice
 * dictation") — the server never adds hidden case material to it.
 */
export async function transcribeClip(
  model: SttModelInfo,
  key: string,
  bytes: ArrayBuffer,
  mime: string,
  prompt: string | null
): Promise<SttResult> {
  try {
    if (model.provider === 'groq') return await groqTranscribe(model, key, bytes, mime, prompt);
    return await gatewayTranscribe(model, key, bytes, mime, prompt);
  } catch (err) {
    if (err instanceof SttUpstreamError) throw err;
    if (isAbortError(err)) throw new SttUpstreamError('timeout');
    throw new SttUpstreamError('other');
  }
}

async function groqTranscribe(
  model: SttModelInfo,
  key: string,
  bytes: ArrayBuffer,
  mime: string,
  prompt: string | null
): Promise<SttResult> {
  const ext = sttExtForMime(mime) ?? 'webm';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `clip.${ext}`);
  form.append('model', model.id);
  form.append('language', 'en');
  form.append('temperature', '0');
  // verbose_json carries `duration` (the settle basis) and segments.
  form.append('response_format', 'verbose_json');
  if (prompt) form.append('prompt', prompt);

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new SttUpstreamError(kindFromStatus(res.status));

  const body = (await res.json()) as {
    text?: unknown;
    duration?: unknown;
    x_groq?: { id?: unknown };
  };
  if (typeof body.text !== 'string') throw new SttUpstreamError('other');
  const duration = typeof body.duration === 'number' && body.duration >= 0 ? body.duration : null;
  const genId =
    typeof body.x_groq?.id === 'string'
      ? body.x_groq.id
      : res.headers.get('x-request-id') || null;
  return { text: body.text, durationSeconds: duration, generationId: genId, warnings: [] };
}

async function gatewayTranscribe(
  model: SttModelInfo,
  key: string,
  bytes: ArrayBuffer,
  mime: string,
  prompt: string | null
): Promise<SttResult> {
  const res = await fetch('https://ai-gateway.vercel.sh/v4/ai/transcription-model', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'ai-model-id': model.id,
      // Both version headers are REQUIRED (verified live 2026-07-12; values
      // from @ai-sdk/gateway source — the endpoint 400s "Unsupported gateway
      // protocol version" without them).
      'ai-gateway-protocol-version': '0.0.1',
      'ai-transcription-model-specification-version': '4',
    },
    body: JSON.stringify({
      audio: Buffer.from(bytes).toString('base64'),
      mediaType: mime,
      providerOptions: {
        openai: { language: 'en', temperature: 0, ...(prompt ? { prompt } : {}) },
      },
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new SttUpstreamError(kindFromStatus(res.status));

  const body = (await res.json()) as {
    text?: unknown;
    durationInSeconds?: unknown;
    warnings?: unknown;
    providerMetadata?: { gateway?: { generationId?: unknown } };
  };
  if (typeof body.text !== 'string') throw new SttUpstreamError('other');
  const duration =
    typeof body.durationInSeconds === 'number' && body.durationInSeconds >= 0
      ? body.durationInSeconds
      : null;
  const genId =
    typeof body.providerMetadata?.gateway?.generationId === 'string'
      ? body.providerMetadata.gateway.generationId
      : null;
  // The gateway's warning union is {unsupported|compatibility, feature,
  // details?} | {deprecated, setting, message} | {other, message} — read
  // `message` too, or an 'other' warning maps to nothing and a lane silently
  // ignoring `temperature` never surfaces (the Lab exists to see exactly that).
  // Upstream-authored text: bounded here, and rendered as text (never HTML).
  const warnings = Array.isArray(body.warnings)
    ? body.warnings
        .slice(0, 5)
        .map((w) => {
          if (typeof w === 'string') return w.slice(0, 300);
          if (w && typeof w === 'object') {
            const o = w as {
              feature?: unknown;
              details?: unknown;
              setting?: unknown;
              message?: unknown;
            };
            const parts = [o.feature, o.setting, o.details, o.message].filter(
              (p): p is string => typeof p === 'string' && p.length > 0
            );
            if (parts.length) return parts.join(': ').slice(0, 300);
          }
          return null;
        })
        .filter((w): w is string => w !== null)
    : [];
  return { text: body.text, durationSeconds: duration, generationId: genId, warnings };
}
