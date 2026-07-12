'use client';

// The playground's recorder UI (/lab/dictation). All capture logic — the iOS
// hardening, wake lock, interruption salvage, re-entry guard — lives in the
// shared useDictation hook, which the in-composer mic (ComposerMic) uses too,
// so the two surfaces cannot drift apart.

import { useDictation, type RecordedClip } from './useDictation';
import { MAX_RECORD_SECONDS } from '@/lib/stt-shared';

export type { RecordedClip };

const COUNTDOWN_FROM_SECONDS = 30;

interface Props {
  disabled?: boolean;
  onClip: (clip: RecordedClip) => void;
}

export default function LabRecorder({ disabled, onClip }: Props) {
  const { phase, elapsed, level, error, permissionHint, start, stop } = useDictation(onClip);

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
              "polite" made VoiceOver read the clock every second, over the
              user's own dictation. */}
          <span className="text-sm font-medium tabular-nums" role="timer">
            {mm}:{ss}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-red-200 dark:bg-red-900" aria-hidden>
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
            onClick={() => stop('send')}
            className="min-h-11 flex-1 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            Stop &amp; transcribe
          </button>
          <button
            type="button"
            onClick={() => stop('cancel')}
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
        onClick={() => void start()}
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
