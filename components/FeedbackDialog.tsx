'use client';

// Feedback modal, reached from the sidebar footer ("Feedback") and the
// marksheet ("report an issue with this case" — arrives with caseCode
// prefilled). Posts to /api/feedback; anonymous, reply email optional. The
// hidden "website" input is a honeypot — humans never see it, bots fill it.
//
// Modal a11y contract (review 2026-07-10): Tab is trapped inside the panel,
// focus returns to the opener on close, Escape ignores IME composition,
// submit outcomes are announced (role=status/alert), and the backdrop closes
// on mousedown-on-backdrop only (a drag-select ending outside the panel must
// not dismiss it).

import { useEffect, useRef, useState } from 'react';

interface FeedbackDialogProps {
  open: boolean;
  /** Prefilled case code when opened from a marksheet ("c0421"), else null. */
  caseCode: string | null;
  onClose: () => void;
}

const CATEGORIES = [
  ['bug', 'Bug'],
  ['idea', 'Idea'],
  ['case_content', 'Case content error'],
  ['other', 'Other'],
] as const;

export default function FeedbackDialog({ open, caseCode, onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<string>(caseCode ? 'case_content' : 'bug');
  const [message, setMessage] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [prevOpen, setPrevOpen] = useState(false);
  const [draftContext, setDraftContext] = useState<string | null>(caseCode);

  // Fresh state each open — done during render (the React "adjust state on
  // prop change" pattern), not in an effect. A draft survives an accidental
  // close, but NOT a context switch: feedback typed for one case must never
  // be submitted tagged with another case's code.
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      if (draftContext !== caseCode) {
        setMessage('');
        setDraftContext(caseCode);
      }
      setCategory(caseCode ? 'case_content' : 'bug');
      setState('idle');
      setError(null);
    }
  }

  // Initial focus — separate from the reset effect because after a previous
  // "sent" view the textarea only mounts once state flips back to 'idle'.
  useEffect(() => {
    if (open && state === 'idle') textareaRef.current?.focus();
  }, [open, state]);

  // The success view unmounts the focused Send button; move focus somewhere
  // real so keyboard/SR users aren't dropped at the document body.
  useEffect(() => {
    if (open && state === 'sent') closeButtonRef.current?.focus();
  }, [open, state]);

  // Return focus to whatever opened the dialog.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      openerRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // isComposing: Escape during CJK IME composition cancels the
      // composition and must not also dismiss the dialog.
      if (e.key === 'Escape' && !e.isComposing) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = [
      ...panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, select'),
    ].filter((el) => el.tabIndex !== -1 && !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function submit() {
    const text = message.trim();
    if (!text || state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: text,
          caseCode: caseCode ?? undefined,
          replyEmail: replyEmail.trim() || undefined,
          website,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Something went wrong — try again shortly');
        setState('idle');
        return;
      }
      setMessage('');
      setReplyEmail('');
      setState('sent');
    } catch {
      setError('Something went wrong — check your connection and try again');
      setState('idle');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onKeyDown={trapTab}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="feedback-title" className="text-sm font-semibold">
            {state === 'sent' ? 'Thank you' : caseCode ? `Report an issue · case #${caseCode}` : 'Feedback'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        {state === 'sent' ? (
          <div className="space-y-3">
            <p role="status" className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              Your feedback has reached us — we read everything. Thanks for helping make PACES Buddy
              better.
            </p>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
            >
              Close
            </button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Feedback category">
              {CATEGORIES.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    category === key
                      ? 'border-teal-600 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-500 dark:text-teal-950'
                      : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <textarea
              ref={textareaRef}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              placeholder={
                caseCode
                  ? 'What looks wrong in this case? (a wrong answer key, an unrealistic finding, a marking issue…)'
                  : 'What happened, or what should exist?'
              }
              className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-base leading-6 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />

            <div>
              <input
                type="email"
                value={replyEmail}
                onChange={(e) => setReplyEmail(e.target.value)}
                placeholder="Email for a reply (optional)"
                aria-label="Email for a reply (optional)"
                autoComplete="email"
                spellCheck={false}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-base outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </div>

            {/* Honeypot — visually hidden from humans, tempting to bots. */}
            <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
              <label>
                Website
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] leading-4 text-zinc-400 dark:text-zinc-500">
                Goes straight to the maintainers. Or email{' '}
                <a href="mailto:hello@pacesbuddy.com" className="underline hover:text-teal-700 dark:hover:text-teal-300">
                  hello@pacesbuddy.com
                </a>
              </p>
              <button
                type="submit"
                disabled={state === 'sending' || message.trim().length === 0}
                className="shrink-0 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
