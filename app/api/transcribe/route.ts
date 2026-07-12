// /api/transcribe — Lab experiment 1 (voice dictation).
//
// POST: one recorded clip (multipart) → one transcript from a server-held STT
// lane (lib/stt.ts). MANAGED-DOOR-ONLY: SPEC invariant 9 applies in full —
// valid `paces_session` + LIVE DB tier + successful spend reservation before
// any server key is touched; there is no anonymous path and no BYOK STT lane
// (Anthropic keys can't transcribe). Metering is the examiner route's exact
// reserve-then-settle shape: reserve AFTER all request validation, settle in
// try/finally so no reservation leaks, fixed generic error strings only.
//
// GET: which STT lanes this deployment can run. Session-gated — lane
// availability is server configuration, and an anonymous caller gets the same
// plain 401 as an anonymous POST (no config oracle pre-auth).
//
// The server never stores or logs audio or transcripts — clip bytes live in
// memory for the duration of the request only (the backend stays stateless;
// the transcript goes back to the composer like typed text).

import { NextResponse } from 'next/server';
import type { ApiError } from '@/lib/types';
import {
  managedEnabled,
  readManagedSession,
  remainingAllowanceUsd,
  reserveSpend,
  resolveTier,
  settleSpend,
  transcribesInLastDay,
  MAX_TRANSCRIBE_PER_DAY,
} from '@/lib/managed';
import {
  actualTranscribeUsd,
  availableSttModels,
  estimateTranscribeUsd,
  sttExtForMime,
  sttKeyFor,
  sttModelInfo,
  transcribeClip,
  SttUpstreamError,
  STT_MODELS,
} from '@/lib/stt';
import { sniffAudioDurationSeconds } from '@/lib/audioDuration';
import {
  MAX_CLIP_BYTES,
  MAX_CLIP_SECONDS,
  MAX_RECORD_SECONDS,
  MAX_STT_PROMPT_CHARS,
  type TranscribeOk,
  type TranscribeStatus,
} from '@/lib/stt-shared';

export const runtime = 'nodejs';
// A transcription call on a 2-minute clip returns in seconds, but leave the
// same ceiling as the examiner route for slow upstream days.
export const maxDuration = 60;

/** Fixed client string for any config/DB failure on this path (same
 *  discipline as the examiner's MANAGED_UNAVAILABLE — never driver text). */
const STT_UNAVAILABLE = 'Transcription is temporarily unavailable — try again shortly';

const TOO_LONG_MESSAGE = `Recording too long — keep it under ${Math.floor(MAX_RECORD_SECONDS / 60)} minutes`;

// Per-user, cookie-derived — never cacheable by a shared/CDN cache.
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status, headers: CACHE_HEADERS });
}

export async function GET() {
  try {
    const session = managedEnabled() ? await readManagedSession() : null;
    if (!session) return jsonError('Not signed in', 401);
    let grant;
    try {
      grant = await resolveTier(session.email);
    } catch {
      return jsonError(STT_UNAVAILABLE, 503);
    }
    if (!grant) return jsonError('Not signed in', 401);

    // Lane availability must reflect SPENDABILITY, not just configuration: a
    // mic that 402s on every take is worse than no mic (review 2026-07-12).
    // Report no lanes once the user's remaining credit can't cover one clip,
    // or they've hit the daily dictation cap — the client renders no mic.
    const lanes = availableSttModels();
    let usable = lanes;
    if (lanes.length > 0) {
      const cheapest = Math.min(
        ...STT_MODELS.filter((m) => lanes.some((l) => l.id === m.id)).map(estimateTranscribeUsd)
      );
      const [remaining, used] = await Promise.all([
        remainingAllowanceUsd(session.sub, grant.allowanceUsd),
        transcribesInLastDay(session.sub),
      ]);
      if (remaining < cheapest || used >= MAX_TRANSCRIBE_PER_DAY) usable = [];
    }

    const payload: TranscribeStatus = {
      models: usable,
      maxSeconds: MAX_RECORD_SECONDS,
      maxBytes: MAX_CLIP_BYTES,
      maxPromptChars: MAX_STT_PROMPT_CHARS,
    };
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  } catch {
    return jsonError(STT_UNAVAILABLE, 503);
  }
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch {
    // Never log the error object (it could reference request internals).
    return jsonError(STT_UNAVAILABLE, 503);
  }
}

async function handle(request: Request) {
  // Cheap pre-parse refusal for oversized bodies (the platform 413s at
  // 4.5 MB anyway; this returns a friendlier message first when the client
  // declares a length).
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_CLIP_BYTES + 64 * 1024) {
    return jsonError('Recording too large — keep it under 2 minutes', 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('Invalid upload', 400);
  }

  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return jsonError('Invalid upload', 400);
  }
  if (file.size > MAX_CLIP_BYTES) {
    return jsonError('Recording too large — keep it under 2 minutes', 413);
  }
  // MediaRecorder reports e.g. "audio/webm;codecs=opus" — match the container.
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (!sttExtForMime(mime)) {
    return jsonError('Unsupported audio format', 415);
  }

  // Registry membership is public knowledge (the ids ship in the repo); the
  // per-lane KEY check is server configuration and runs after the session
  // gate below.
  const model = sttModelInfo(form.get('model'));
  if (!model) return jsonError('Unknown transcription model', 400);

  // Optional bias context — client-visible content only by contract (the
  // server adds nothing). Control characters stripped, silently truncated to
  // the prompt budget (whisper truncates past ~224 tokens regardless).
  const rawPrompt = form.get('prompt');
  const prompt =
    typeof rawPrompt === 'string' && rawPrompt.trim().length > 0
      ? rawPrompt
          .replace(/[\p{Cc}\p{Cf}]+/gu, ' ') // control + format chars
          .trim()
          .slice(0, MAX_STT_PROMPT_CHARS)
      : null;

  // THE MANAGED GATE (invariant 9). Fail closed to the plain 401 when the
  // door is not fully configured OR there is no valid session —
  // indistinguishable on purpose (no config oracle pre-auth).
  const session = managedEnabled() ? await readManagedSession() : null;
  if (!session) return jsonError('Not signed in', 401);

  // Authorization re-derived from the database on EVERY call — a removed
  // domain/override revokes outstanding sessions right here.
  let grant;
  try {
    grant = await resolveTier(session.email);
  } catch {
    return jsonError(STT_UNAVAILABLE, 503);
  }
  if (!grant) {
    return jsonError(
      'Managed access is no longer available for this account — contact the app owner',
      403
    );
  }

  // Per-lane key presence — post-auth so an anonymous caller can't probe
  // which lanes are configured. Generic string, names no env var.
  const key = sttKeyFor(model);
  if (!key) return jsonError(STT_UNAVAILABLE, 503);

  const bytes = await file.arrayBuffer();
  const buf = Buffer.from(bytes);

  // DURATION BOUND (review 2026-07-12 — the fix for the drain vector). Bytes
  // never bounded duration: a low-bitrate clip can pack hours into a few MB,
  // and the provider bills the audio it receives whether or not we wait for
  // the answer. So read the duration out of the container and refuse a long
  // clip HERE — before any key is touched and before anything is reserved.
  // null = unknown (e.g. Safari's fragmented MP4 carries no duration): we
  // proceed, and such a clip settles at the reservation ceiling below.
  const sniffedSeconds = sniffAudioDurationSeconds(buf, mime);
  if (sniffedSeconds !== null && sniffedSeconds > MAX_CLIP_SECONDS) {
    return jsonError(TOO_LONG_MESSAGE, 400);
  }

  // PER-USER DAILY CAP. The USD caps do not bound provider quota usefully: a
  // user's $1/month buys ~9 hours of Groq audio, far more than the operator's
  // whole shared free-tier quota — so without this, one user could exhaust the
  // provider and deny dictation to everyone while staying inside their budget
  // (review 2026-07-12). Checked before the reservation, after all validation.
  try {
    if ((await transcribesInLastDay(session.sub)) >= MAX_TRANSCRIBE_PER_DAY) {
      return jsonError(
        "You've reached today's dictation limit — you can keep typing, and it resets tomorrow.",
        429
      );
    }
  } catch {
    return jsonError(STT_UNAVAILABLE, 503);
  }

  // METERING — reserve AFTER all validation above, so a 4xx can never consume
  // allowance. With the duration bounded above, the estimate (lib/stt.ts:
  // 5 minutes vs the enforced 2.5-minute ceiling) is a genuine upper bound.
  const estUsd = estimateTranscribeUsd(model);
  let reserved: Awaited<ReturnType<typeof reserveSpend>>;
  try {
    reserved = await reserveSpend(session.sub, estUsd, grant.allowanceUsd);
  } catch {
    return jsonError(STT_UNAVAILABLE, 503);
  }
  if (reserved.result === 'user_cap') {
    return jsonError(
      "You've used up your free practice credit. To request more, contact the app owner.",
      402
    );
  }
  if (reserved.result === 'global_cap') {
    return jsonError('Free practice is at capacity for today — try again tomorrow.', 429);
  }
  let openReservation: { estUsd: number; period: string; day: string } | null = {
    estUsd,
    period: reserved.period,
    day: reserved.day,
  };

  /** Move the held reservation into real spend at `costUsd` (never above the
   *  reservation — the ledger's hard-bound property). */
  const settleCharged = async (costUsd: number, generationId: string | null) => {
    const held = openReservation;
    if (!held) return;
    openReservation = null;
    await settleSpend(
      session.sub,
      held.estUsd,
      {
        model: model.id,
        action: 'transcribe',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: Math.min(costUsd, held.estUsd),
        generationId,
      },
      held.period,
      held.day
    );
  };

  const started = Date.now();
  try {
    const result = await transcribeClip(model, key, bytes, mime, prompt);

    // Settle basis, in order of trustworthiness: the provider's reported
    // duration; else the duration we read from the container ourselves; else
    // (both unknown — e.g. gateway gpt-4o-transcribe, which never reports one,
    // on a fragmented-MP4 clip that carries none) the reservation ceiling.
    // Never below the lane's minimum billed length.
    const basisSeconds = result.durationSeconds ?? sniffedSeconds;
    const costUsd =
      basisSeconds === null ? estUsd : actualTranscribeUsd(model, basisSeconds);
    await settleCharged(costUsd, result.generationId);

    const payload: TranscribeOk = {
      text: result.text,
      durationSeconds: basisSeconds,
      modelId: model.id,
      latencyMs: Date.now() - started,
      costUsd: Math.round(Math.min(costUsd, estUsd) * 1e6) / 1e6,
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    };
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  } catch (err) {
    if (err instanceof SttUpstreamError) {
      switch (err.kind) {
        case 'too_large':
          return jsonError('Recording too large — keep it under 2 minutes', 413);
        case 'bad_audio':
          return jsonError('Could not read that recording — try again', 400);
        case 'rate':
          return jsonError('Transcription is busy right now — try again shortly', 429);
        case 'timeout':
          // The clip was fully uploaded before our deadline expired, so the
          // provider transcribes and BILLS it whether or not we wait for the
          // answer. Releasing here would make a timeout free — and a timeout
          // is precisely what a crafted over-long clip induces, so releasing
          // would let it drain the operator with both caps disengaged
          // (review 2026-07-12). Charge the ceiling: the caps stay honest.
          console.error(`[transcribe] upstream timeout — charging reservation (model ${model.id})`);
          await settleCharged(estUsd, null);
          return jsonError('Transcription timed out — try a shorter clip', 504);
        // 'auth' (the OPERATOR's key was rejected upstream) and 'other'
        // collapse to the same generic 502 — an upstream auth failure is the
        // owner's problem, and naming it would only send users key-hunting.
        // Both are pre-transcription refusals: nothing was billed, so the
        // finally releases the reservation uncharged.
        default:
          return jsonError('Transcription failed — try again', 502);
      }
    }
    return jsonError('Transcription failed — try again', 502);
  } finally {
    // Every exit that did not settle above releases the reservation
    // uncharged — no path may leak a reservation.
    if (openReservation) {
      await settleSpend(
        session.sub,
        openReservation.estUsd,
        null,
        openReservation.period,
        openReservation.day
      );
    }
  }
}
