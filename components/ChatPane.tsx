'use client';

// Main pane: case top bar (Finish & marksheet / New case), stem card with
// Begin button, chat transcript (bubbles + usage lines + "[BEGIN ENCOUNTER]"
// divider), loading indicator, error notice, marksheet card, and the composer.

import { useEffect, useRef, useState } from 'react';
import type { MarkSheet, PublicCase, TokenUsage } from '@/lib/types';
import { BEGIN_MESSAGE, RichText, usageLine, type TranscriptEntry } from './shared';
import MarksheetCard from './MarksheetCard';

interface ChatPaneProps {
  publicCase: PublicCase | null;
  caseLoading: boolean;
  entries: TranscriptEntry[];
  pending: 'chat' | 'mark' | null;
  error: string | null;
  canRetry: boolean;
  marksheet: MarkSheet | null;
  markUsage: TokenUsage | null;
  hasKey: boolean;
  /** Guidance shown when hasKey is false — provider-aware, built by the parent
   *  (covers both "no key for this provider" and "managed access doesn't cover
   *  this model"). */
  keyNotice: string;
  onBegin: () => void;
  onSend: (text: string) => void;
  onMark: () => void;
  onNewCase: () => void;
  onRetry: () => void;
  onOpenSidebar: () => void;
}

export default function ChatPane({
  publicCase,
  caseLoading,
  entries,
  pending,
  error,
  canRetry,
  marksheet,
  markUsage,
  hasKey,
  keyNotice,
  onBegin,
  onSend,
  onMark,
  onNewCase,
  onRetry,
  onOpenSidebar,
}: ChatPaneProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const started = entries.length > 0;

  // Keep the transcript scrolled to the newest content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, pending, marksheet, error]);

  // Return focus to the composer once a reply lands.
  useEffect(() => {
    if (started && !pending) textareaRef.current?.focus();
  }, [started, pending]);

  function submitDraft() {
    const text = draft.trim();
    if (!text || pending || !started) return;
    setDraft('');
    onSend(text);
  }

  if (!publicCase) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">PACES Buddy</h1>
        <p className="max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          {caseLoading
            ? 'Loading case…'
            : hasKey
              ? 'Pick a case from the sidebar to start a practice encounter with the AI examiner.'
              : `Pick a case from the sidebar to start a practice encounter with the AI examiner. ${keyNotice}`}
        </p>
        {error && !caseLoading && (
          <p className="max-w-md rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 md:hidden dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Open menu
        </button>
      </div>
    );
  }

  const { meta, stem } = publicCase;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm md:hidden dark:border-zinc-700"
        >
          ☰
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{meta.displayTitle}</h1>
          <p className="flex text-xs text-zinc-500 dark:text-zinc-400">
            {/* The case code must survive narrow widths (it's how a user reports a
                case mid-encounter), so it sits outside the truncating segment. */}
            <span className="truncate">
              {meta.sittingLabel} · {meta.timing}
            </span>
            <span className="shrink-0">&nbsp;· #{meta.caseCode}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onMark}
          disabled={!started || pending !== null}
          className="shrink-0 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          {pending === 'mark' ? 'Marking…' : 'Finish & marksheet'}
        </button>
        <button
          type="button"
          onClick={onNewCase}
          disabled={pending !== null}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          New case
        </button>
      </header>

      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-5">
          {!hasKey && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {keyNotice}
            </p>
          )}

          {/* Stem card */}
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-900 dark:bg-teal-950/30">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                Candidate stem
              </h2>
              <span className="text-xs text-teal-700/70 dark:text-teal-300/70">{meta.timing}</span>
            </div>
            <RichText text={stem.trim()} className="text-sm leading-6" />
            {!started && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={onBegin}
                  disabled={!hasKey || pending !== null || caseLoading}
                  className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
                >
                  Begin encounter
                </button>
              </div>
            )}
          </div>

          {/* Turns */}
          {entries.map((entry, i) =>
            entry.role === 'user' && entry.content === BEGIN_MESSAGE ? (
              <Divider key={i} label="Encounter started" />
            ) : entry.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-teal-700 px-3.5 py-2 text-sm leading-6 text-white dark:bg-teal-600">
                  <RichText text={entry.content} />
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-3.5 py-2 text-sm leading-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <RichText text={entry.content} />
                </div>
                {entry.images && entry.images.length > 0 && (
                  <div className="mt-2 flex max-w-[85%] flex-wrap gap-2">
                    {entry.images.map((img, k) => (
                      <figure
                        key={k}
                        className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.caption}
                          loading="lazy"
                          className="max-h-72 w-auto max-w-full object-contain"
                        />
                        <figcaption className="border-t border-zinc-100 px-2.5 py-1.5 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                          {img.caption}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {entry.usage && (
                  <p className="mt-1 pl-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {usageLine(entry.usage, entry.kbLookups)}
                  </p>
                )}
              </div>
            ),
          )}

          {pending && (
            <div className="flex items-center gap-2 pl-1 text-sm text-zinc-400 dark:text-zinc-500">
              <TypingDots />
              {pending === 'mark' ? 'Completing the marksheet…' : 'Examiner is replying…'}
            </div>
          )}

          {error && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <span className="whitespace-pre-wrap">{error}</span>
              {canRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  // !hasKey mirrors the Begin gate: on a restored encounter the
                  // managed/dev-bridge probes may still be in flight — an early
                  // click would misfire the "add your API key" error.
                  disabled={pending !== null || !hasKey}
                  className="shrink-0 rounded border border-red-400 px-2 py-0.5 text-xs font-medium hover:bg-red-100 disabled:opacity-40 dark:border-red-700 dark:hover:bg-red-900/40"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {marksheet && <MarksheetCard marksheet={marksheet} usage={markUsage} />}
        </div>
      </div>

      {/* Composer */}
      {started && (
        <div className="border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              disabled={pending !== null}
              placeholder="Describe what you examine, ask, or say… (Enter to send, Shift+Enter for a new line)"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="button"
              onClick={submitDraft}
              disabled={pending !== null || draft.trim().length === 0}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      {label}
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0.3s]" />
    </span>
  );
}
