// Client-side helper for POST /api/transcribe — the one place the upload
// shape lives, shared by the Lab playground and the in-composer mic.
// The server re-validates everything; nothing here is a security boundary.

import type { TranscribeOk, TranscribeStatus } from './stt-shared';

export type TranscribeResult =
  | { ok: true; data: TranscribeOk }
  | { ok: false; error: string; status: number };

/** Which STT lanes this deployment can run. 401 → not signed in (dictation is
 *  managed-door-only: it spends a server-held key). */
export async function fetchSttStatus(): Promise<TranscribeStatus | { error: number }> {
  try {
    const res = await fetch('/api/transcribe');
    if (!res.ok) return { error: res.status };
    return (await res.json()) as TranscribeStatus;
  } catch {
    return { error: 0 };
  }
}

export async function transcribeBlob(
  blob: Blob,
  modelId: string,
  prompt: string | null
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', blob);
  form.append('model', modelId);
  if (prompt && prompt.trim()) form.append('prompt', prompt.trim());
  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: form });
    if (res.ok) return { ok: true, data: (await res.json()) as TranscribeOk };
    let error = 'Transcription failed — try again';
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error) error = body.error;
    } catch {
      // keep the generic message
    }
    return { ok: false, error, status: res.status };
  } catch {
    return { ok: false, error: 'Network error — check your connection and retry', status: 0 };
  }
}
