'use client';

// The microphone that sits beside Send in the practice composer. Tap → record
// → tap → the transcript is inserted into the draft for you to edit before
// sending. Dictation, not conversation: nothing reaches the examiner until you
// press Send.
//
// Capture logic lives in useDictation (shared, hardened for iOS). This
// component owns only the compact UI + the upload, and it builds the bias
// prompt from CLIENT-VISIBLE context only (buildDictationPrompt — see the
// binding rule in lib/sttPrompt.ts).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDictation, type RecordedClip } from './useDictation';
import { fetchSttStatus, transcribeBlob } from '@/lib/transcribeClient';
import { buildDictationPrompt, type DictationContext } from '@/lib/sttPrompt';
import { MAX_RECORD_SECONDS } from '@/lib/stt-shared';

interface Props {
  /** Insert the transcript into the composer draft. */
  onText: (text: string) => void;
  /** Disabled while an examiner call is in flight. NB: this must never reach a
   *  LIVE take's stop control — see the button below. */
  disabled?: boolean;
  /** Client-visible context for the bias prompt (specialty + visible transcript). */
  context: DictationContext;
  /** Raised while a take is recording or uploading, so the composer can hold
   *  Send: otherwise the user sends an empty/partial draft and the transcript
   *  lands in the NEXT turn's box seconds later (review 2026-07-12). */
  onBusyChange?: (busy: boolean) => void;
  /** Whether a transcription lane is actually reachable (i.e. the user is
   *  signed in). The composer keys its LAYOUT off this, not off the dictation
   *  flag: a signed-out user must not be told to "speak" by a placeholder when
   *  no mic will ever appear for them. */
  onAvailable?: (available: boolean) => void;
}

export default function ComposerMic({
  onText,
  disabled,
  context,
  onBusyChange,
  onAvailable,
}: Props) {
  const [modelId, setModelId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Read at clip time (not render time) so the prompt reflects the transcript
  // as it stands when the take ENDS, not when the component last rendered.
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);
  // The upload continues after the component may have gone (the user hits "New
  // case" mid-transcription): without this, the transcript of the OLD encounter
  // is injected into the NEW case's draft.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // Can this browser record AT ALL? In-app webviews (WhatsApp, Facebook,
    // some hospital MDM browsers) and older Safari have no MediaRecorder, and
    // getUserMedia needs a secure context. Offering a mic there produces a
    // button that can only ever fail (review 2026-07-12) — so treat it as
    // unavailable, exactly like being signed out.
    const canRecord =
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);
    // Don't even ask the server when the browser can't record. Resolving to a
    // null lane through the same path keeps the state update asynchronous.
    const probe = canRecord ? fetchSttStatus() : Promise.resolve({ error: 0 as const });
    void probe.then((s) => {
      if (!alive) return;
      // The registry's first lane is the default (Groq whisper-large-v3). An
      // empty list means signed out, no lane configured, or out of credit —
      // the server decides; the client just renders nothing.
      const id = 'models' in s && s.models.length > 0 ? s.models[0].id : null;
      setModelId(id);
      onAvailable?.(id !== null);
    });
    return () => {
      alive = false;
    };
    // NB: no onAvailable(false) on unmount. The composer unmounts on every
    // "New case", and tearing the signal down would re-trigger the two-hop
    // probe and make the composer visibly reflow each time.
  }, [onAvailable]);

  const onClip = useCallback(
    async (clip: RecordedClip) => {
      if (!modelId) return;
      setUploading(true);
      setNotice(clip.interrupted ? 'Recording was interrupted — transcribing what was captured.' : null);
      const prompt = buildDictationPrompt(contextRef.current);
      const result = await transcribeBlob(clip.blob, modelId, prompt);
      // Gone while the upload was in flight (e.g. "New case"): drop the result
      // rather than injecting the previous encounter's words into a fresh one.
      if (!mountedRef.current) return;
      setUploading(false);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      const text = result.data.text.trim();
      if (!text) {
        setNotice('No speech was recognised — try again.');
        return;
      }
      // KEEP the interruption warning alongside the inserted text: it only
      // means anything once the user can see what was (and wasn't) captured.
      setNotice(
        clip.interrupted
          ? 'Recording was cut short (screen lock or app switch) — only the captured part was transcribed.'
          : null
      );
      onText(text);
    },
    [modelId, onText]
  );

  const { phase, elapsed, level, error, permissionHint, start, stop } = useDictation(onClip);

  const recording = phase === 'recording';

  // Tell the composer when dictation owns the turn (recording or transcribing).
  useEffect(() => {
    onBusyChange?.(recording || uploading);
  }, [recording, uploading, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  /** A fresh take clears the previous take's message — otherwise a stale error
   *  sits under the mic through the next recording (or forever, after a cancel). */
  const beginTake = useCallback(() => {
    setNotice(null);
    void start();
  }, [start]);

  const cancelTake = useCallback(() => {
    setNotice(null);
    stop('cancel');
  }, [stop]);

  // Dictation is unavailable (signed out, or no lane configured): render
  // nothing rather than a dead button.
  if (modelId === null) return null;

  const remaining = MAX_RECORD_SECONDS - elapsed;
  const mm = String(Math.floor(elapsed / 60));
  const ss = String(elapsed % 60).padStart(2, '0');
  const message = error ?? notice;

  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="flex items-center gap-2">
        {recording && (
          <div className="flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 dark:border-red-900 dark:bg-red-950/40">
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
            </span>
            {/* role="timer" implies aria-live="off" ON PURPOSE — announcing
                the clock every second would talk over the user's dictation. */}
            <span className="text-xs font-medium tabular-nums" role="timer">
              {mm}:{ss}
            </span>
            <span className="h-1.5 w-8 overflow-hidden rounded-full bg-red-200 dark:bg-red-900" aria-hidden>
              <span
                className="block h-full rounded-full bg-red-500 transition-[width] duration-100"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </span>
            <button
              type="button"
              onClick={cancelTake}
              className="ml-0.5 text-xs underline hover:text-red-700 dark:hover:text-red-300"
            >
              Cancel
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => (recording ? stop('send') : beginTake())}
          // A LIVE take's stop control must never be disabled: `disabled` is
          // the examiner-pending flag, and if a reply lands mid-take it would
          // otherwise strand the recording with no way to stop it (the 2-minute
          // auto-stop would be the only escape). Only the START path is gated.
          disabled={recording ? false : disabled || uploading || phase === 'starting'}
          aria-label={
            recording
              ? 'Stop recording and transcribe'
              : uploading
                ? 'Transcribing your recording'
                : 'Dictate with your voice'
          }
          title={recording ? 'Stop & transcribe' : uploading ? 'Transcribing…' : 'Dictate (voice → text)'}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            recording
              ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
              : 'border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
          }`}
        >
          {uploading ? <Spinner /> : recording ? <StopIcon /> : <MicIcon />}
        </button>
      </div>
      {recording && remaining <= 30 && (
        <p className="text-right text-[11px] text-red-600 dark:text-red-400">
          auto-stops in {Math.max(remaining, 0)}s
        </p>
      )}
      {message && (
        <p
          role="alert"
          className="max-w-[16rem] text-right text-[11px] leading-4 text-amber-700 dark:text-amber-300"
        >
          {message}
          {permissionHint && (
            <>
              {' '}
              On iPhone: <strong>aA</strong> → Website Settings → Microphone → Allow.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
