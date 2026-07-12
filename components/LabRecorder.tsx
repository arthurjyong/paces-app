'use client';

// Voice-dictation recorder (Lab experiment 1). One-shot record → stop → hand
// the finished clip up — deliberately NO timeslice chunking, NO pause/resume,
// NO streaming: on iOS Safari those are unreliable (fragmented-MP4 chunks,
// open WebKit pause bugs), and screen lock / backgrounding / an incoming call
// kills capture outright. Instead: a Screen Wake Lock while recording, and any
// interruption (visibilitychange, track mute/ended, recorder error) stops the
// take and SALVAGES the partial clip rather than losing it.
//
// Capture spec (see SPEC.md "Voice dictation"): mono, 32 kbps requested
// (Safari's default AAC is 192 kbps — a 3-min clip would brush the platform's
// 4.5 MB body cap, so the bitrate request + the hard 2-minute auto-stop + a
// byte guard all hold the upload small), mimeType negotiated — modern iOS
// (18.4+) and Chromium give webm/opus, older iOS gives mp4/AAC.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CLIP_BYTES, MAX_RECORD_SECONDS } from '@/lib/stt-shared';

/** Reject a clip the server would refuse anyway, before wasting the upload. */
const MAX_BLOB_BYTES = MAX_CLIP_BYTES;
/** Show the auto-stop countdown once this little time remains. */
const COUNTDOWN_FROM_SECONDS = 30;

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  seconds: number;
  /** true when the take was cut short by lock/backgrounding/call/error */
  interrupted: boolean;
}

interface Props {
  disabled?: boolean;
  onClip: (clip: RecordedClip) => void;
}

// 'starting' covers the async gap between the tap and the recorder actually
// running (getUserMedia + wake lock): without it a double-tap ran start()
// twice, orphaning a live mic stream (the in-use indicator stayed lit) and a
// wake lock (review 2026-07-12).
type Phase = 'idle' | 'starting' | 'recording' | 'error';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined; // very old builds: let the browser pick its default
  }
  return MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c));
}

export default function LabRecorder({ disabled, onClip }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionHint, setPermissionHint] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const stopModeRef = useRef<'send' | 'cancel' | 'salvage'>('send');
  const recordingRef = useRef(false);
  /** Set synchronously on tap, before the first await — the re-entry guard. */
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  /** onstop closes over the handler captured at record time; the parent
   *  recreates onClip whenever the model/A-B/bias settings change, so read it
   *  through a ref (kept current in an effect — never mutated during render)
   *  to honour edits made DURING a take. */
  const onClipRef = useRef(onClip);
  useEffect(() => {
    onClipRef.current = onClip;
  }, [onClip]);

  const cleanup = useCallback(() => {
    recordingRef.current = false;
    busyRef.current = false;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    capTimerRef.current = null;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  const stopRecording = useCallback((mode: 'send' | 'cancel' | 'salvage') => {
    const recorder = recorderRef.current;
    if (!recorder || !recordingRef.current) return;
    recordingRef.current = false;
    stopModeRef.current = mode;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // recorder already dead (iOS capture failure) — finalize from onstop/cleanup
    }
  }, []);

  // Interruptions: backgrounding/screen lock (visibilitychange) and capture
  // teardown (track mute/ended) both end the take on iOS — salvage it.
  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = () => {
      if (document.hidden && recordingRef.current) stopRecording('salvage');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      // CANCEL the take before tearing down. cleanup() stops the tracks, and
      // per spec a recorder whose tracks all end finalizes asynchronously —
      // firing onstop AFTER unmount, which would have uploaded and CHARGED a
      // clip for a page the user already navigated away from (review
      // 2026-07-12). onstop also checks mountedRef, belt and braces.
      stopModeRef.current = 'cancel';
      recordingRef.current = false;
      cleanup();
    };
  }, [stopRecording, cleanup]);

  const start = useCallback(async () => {
    // Re-entry guard, set SYNCHRONOUSLY before any await: a second tap during
    // the permission/wake-lock gap would otherwise open a second mic stream
    // and orphan the first (the mic stays live after Stop — review 2026-07-12).
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setPermissionHint(false);
    setPhase('starting');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      busyRef.current = false;
      setPhase('error');
      setError('Voice recording is not supported in this browser.');
      return;
    }
    let stream: MediaStream;
    try {
      // Must be called from inside the tap's gesture handler (iOS requirement).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      busyRef.current = false;
      setPhase('error');
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setError('Microphone access was blocked.');
        setPermissionHint(true);
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('No microphone was found on this device.');
      } else {
        setError('Could not start the microphone — try again.');
      }
      return;
    }

    // Unmounted while the permission prompt was open: drop the stream we just
    // acquired instead of starting a headless recording.
    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      busyRef.current = false;
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    stopModeRef.current = 'send';

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      });
    } catch {
      cleanup();
      setPhase('error');
      setError('Could not start the recorder — try again.');
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      if (recordingRef.current) stopRecording('salvage');
    };
    recorder.onstop = () => {
      const mode = stopModeRef.current;
      const seconds = Math.round((Date.now() - startedAtRef.current) / 100) / 10;
      const type = recorder.mimeType || mimeType || 'audio/mp4';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      cleanup();
      // Unmounted (the browser finalizes the recorder asynchronously once its
      // tracks stop): discard — never upload or charge for a page the user
      // has left. No setState after unmount either.
      if (!mountedRef.current) return;
      setPhase('idle');
      setElapsed(0);
      if (mode === 'cancel') return;
      if (blob.size < 200) {
        setPhase('error');
        setError('Nothing was recorded — try again, a little closer to the microphone.');
        return;
      }
      if (blob.size > MAX_BLOB_BYTES) {
        setPhase('error');
        setError('That recording came out too large — try a shorter take.');
        return;
      }
      onClipRef.current({ blob, mimeType: type, seconds, interrupted: mode === 'salvage' });
    };

    // Track teardown (Siri, phone call, another app grabbing the mic). The
    // 1-second guard skips the transient mute some devices fire at start.
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (recordingRef.current) stopRecording('salvage');
      };
      track.onmute = () => {
        if (recordingRef.current && Date.now() - startedAtRef.current > 1000) {
          stopRecording('salvage');
        }
      };
    }

    // Level meter — proves audio is actually flowing despite iOS quirks.
    try {
      type WindowWithWebkitAC = Window & { webkitAudioContext?: typeof AudioContext };
      const AC = window.AudioContext ?? (window as WindowWithWebkitAC).webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      }
    } catch {
      // meter is cosmetic — never block recording on it
    }

    // Keep the screen awake for the take: on iOS, screen lock kills capture.
    // NOT awaited — recording must start on the tap, not after a permission
    // round-trip; and if the take is already over by the time it resolves,
    // release it immediately rather than pinning the screen on.
    type NavigatorWithWakeLock = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    void (navigator as NavigatorWithWakeLock).wakeLock
      ?.request('screen')
      .then((wl) => {
        if (recordingRef.current && mountedRef.current) wakeLockRef.current = wl;
        else void wl.release().catch(() => {});
      })
      .catch(() => {
        // unsupported or denied — the visibilitychange salvage still covers us
      });

    startedAtRef.current = Date.now();
    recordingRef.current = true;
    recorder.start(); // no timeslice — single blob at stop (iOS reliability)
    setPhase('recording');
    setElapsed(0);
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    capTimerRef.current = setTimeout(() => stopRecording('send'), MAX_RECORD_SECONDS * 1000);
  }, [cleanup, stopRecording]);

  const remaining = MAX_RECORD_SECONDS - elapsed;
  const mm = String(Math.floor(elapsed / 60));
  const ss = String(elapsed % 60).padStart(2, '0');

  if (phase === 'recording') {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
          </span>
          {/* role="timer" implies aria-live="off" ON PURPOSE — an explicit
              "polite" made VoiceOver read the clock every second for the whole
              take, over the user's own dictation (review 2026-07-12). */}
          <span className="text-sm font-medium tabular-nums" role="timer">
            {mm}:{ss}
          </span>
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-red-200 dark:bg-red-900"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-red-500 transition-[width] duration-100"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>
        {remaining <= COUNTDOWN_FROM_SECONDS && (
          <p className="text-xs text-red-700 dark:text-red-300">
            Auto-stops in {Math.max(remaining, 0)}s
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => stopRecording('send')}
            className="min-h-11 flex-1 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            Stop &amp; transcribe
          </button>
          <button
            type="button"
            onClick={() => stopRecording('cancel')}
            className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={disabled || phase === 'starting'}
        aria-label="Start voice dictation"
        className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        <MicIcon />
        {phase === 'starting' ? 'Starting…' : 'Record'}
      </button>
      {phase === 'error' && error && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p>{error}</p>
          {permissionHint && (
            <p className="mt-1">
              On iPhone: tap <strong>aA</strong> in the address bar → Website Settings →
              Microphone → <strong>Allow</strong>, then reload. Recording also needs HTTPS.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
