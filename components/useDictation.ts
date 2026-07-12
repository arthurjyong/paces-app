'use client';

// Shared voice-capture hook — the single implementation behind BOTH the Lab
// playground (LabRecorder) and the in-composer mic (ComposerMic). Extracted
// 2026-07-12 so the two surfaces cannot drift: every iOS hardening rule below
// came out of the adversarial review and must hold wherever we record.
//
// One-shot record → stop → single blob. Deliberately NO timeslice chunking,
// NO pause/resume, NO streaming: on iOS Safari those are unreliable
// (fragmented-MP4 chunks that are not independently decodable; an open WebKit
// pause/resume bug), and screen lock / backgrounding / an incoming call kill
// capture outright. Instead we hold a Screen Wake Lock for the take and
// SALVAGE the partial clip on any interruption rather than losing it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CLIP_BYTES, MAX_RECORD_SECONDS } from '@/lib/stt-shared';

export interface RecordedClip {
  blob: Blob;
  mimeType: string;
  seconds: number;
  /** true when the take was cut short by lock/backgrounding/call/error */
  interrupted: boolean;
}

/** 'starting' covers the async gap between the tap and the recorder running
 *  (permission prompt): without it, a double-tap opened a second mic stream
 *  and orphaned the first, leaving the mic indicator lit. */
export type DictationPhase = 'idle' | 'starting' | 'recording' | 'error';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined; // very old builds: let the browser pick its default
  }
  return MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c));
}

export function useDictation(onClip: (clip: RecordedClip) => void) {
  const [phase, setPhase] = useState<DictationPhase>('idle');
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
  /** onstop closes over the handler captured at record time; the caller may
   *  rebuild onClip as its own state changes (model, bias context), so read it
   *  through a ref kept current in an effect — never mutated during render. */
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

  const stop = useCallback((mode: 'send' | 'cancel' | 'salvage') => {
    const recorder = recorderRef.current;
    if (!recorder || !recordingRef.current) return;
    recordingRef.current = false;
    stopModeRef.current = mode;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // recorder already dead (iOS capture failure) — onstop/cleanup finalize
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = () => {
      if (document.hidden && recordingRef.current) stop('salvage');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      // CANCEL before teardown: cleanup() stops the tracks, and a recorder
      // whose tracks all end finalizes ASYNCHRONOUSLY — firing onstop after
      // unmount, which would upload and CHARGE a clip for a page the user has
      // already left.
      stopModeRef.current = 'cancel';
      recordingRef.current = false;
      cleanup();
    };
  }, [stop, cleanup]);

  const start = useCallback(async () => {
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
      // Must run inside the tap's user-gesture handler (an iOS requirement).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      busyRef.current = false;
      setPhase('error');
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      ) {
        setError('Microphone access was blocked.');
        setPermissionHint(true);
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('No microphone was found on this device.');
      } else {
        setError('Could not start the microphone — try again.');
      }
      return;
    }

    // Unmounted while the permission prompt was open: drop the stream rather
    // than starting a headless recording.
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
        // Safari's default AAC is 192 kbps; ask for far less so a full-length
        // take stays well inside the upload cap.
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
      if (recordingRef.current) stop('salvage');
    };
    recorder.onstop = () => {
      const mode = stopModeRef.current;
      const seconds = Math.round((Date.now() - startedAtRef.current) / 100) / 10;
      const type = recorder.mimeType || mimeType || 'audio/mp4';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      cleanup();
      if (!mountedRef.current) return; // unmounted: discard, never upload
      setPhase('idle');
      setElapsed(0);
      if (mode === 'cancel') return;
      if (blob.size < 200) {
        setPhase('error');
        setError('Nothing was recorded — try again, a little closer to the microphone.');
        return;
      }
      if (blob.size > MAX_CLIP_BYTES) {
        setPhase('error');
        setError('That recording came out too large — try a shorter take.');
        return;
      }
      onClipRef.current({ blob, mimeType: type, seconds, interrupted: mode === 'salvage' });
    };

    // Track teardown (Siri, a phone call, another app grabbing the mic). The
    // 1-second guard skips the transient mute some devices fire at start.
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (recordingRef.current) stop('salvage');
      };
      track.onmute = () => {
        if (recordingRef.current && Date.now() - startedAtRef.current > 1000) stop('salvage');
      };
    }

    // Level meter — proves audio is flowing despite iOS quirks. Cosmetic:
    // never block recording on it.
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
      // meter unavailable — carry on
    }

    // Screen lock kills capture on iOS: hold a wake lock for the take. NOT
    // awaited (recording must start on the tap), and released immediately if
    // the take is already over by the time it resolves.
    type NavigatorWithWakeLock = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    void (navigator as NavigatorWithWakeLock).wakeLock
      ?.request('screen')
      .then((wl) => {
        if (recordingRef.current && mountedRef.current) wakeLockRef.current = wl;
        else void wl.release().catch(() => {});
      })
      .catch(() => {});

    startedAtRef.current = Date.now();
    recordingRef.current = true;
    recorder.start(); // no timeslice — one blob at stop (iOS reliability)
    setPhase('recording');
    setElapsed(0);
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    capTimerRef.current = setTimeout(() => stop('send'), MAX_RECORD_SECONDS * 1000);
  }, [cleanup, stop]);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setPermissionHint(false);
  }, []);

  return { phase, elapsed, level, error, permissionHint, start, stop, reset };
}
