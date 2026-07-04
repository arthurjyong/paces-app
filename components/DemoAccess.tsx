'use client';

// Sidebar "Invited access" section: a whitelisted user (invited by the app
// owner) emails themselves a sign-in link and can then practise without an API
// key. The session lives in an httpOnly cookie — this component only ever sees
// GET /api/demo/status ({active, masked email}), never the cookie value or any
// key. The ?demo=active|invalid verify-redirect flag is handled by page.tsx
// (as a main-pane banner, visible on mobile where this sidebar is off-canvas).
// Collapsible, styled to match Settings.

import { useState } from 'react';
import { DEMO_REQUEST_MESSAGE, type ApiError, type DemoStatus } from '@/lib/types';

interface DemoAccessProps {
  /** null while /api/demo/status is still loading. */
  status: DemoStatus | null;
}

export default function DemoAccess({ status }: DemoAccessProps) {
  const [open, setOpen] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestLink() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch('/api/demo/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as ApiError;
          if (typeof data?.error === 'string') message = data.error;
        } catch {
          // keep the fallback message
        }
        throw new Error(message);
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <span>Invited access</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          {status === null ? (
            // Don't flash the sign-in form before we know whether a session is
            // already active (it reads as a contradiction next to the success
            // banner right after a link click).
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">Checking access…</p>
          ) : status.active ? (
            <div className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 dark:border-teal-800 dark:bg-teal-950/40">
              <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
                Access active — no API key needed.
              </p>
              {status.email && (
                <p className="mt-0.5 text-xs text-teal-700/80 dark:text-teal-300/80">
                  Signed in as {status.email}
                </p>
              )}
            </div>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void requestLink();
              }}
            >
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Been invited by the app owner? Enter your email and we&apos;ll send you a sign-in
                link — no API key needed.
              </p>
              <input
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address for invited access"
                className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                disabled={busy || email.trim().length === 0}
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {busy ? 'Sending…' : 'Email me a sign-in link'}
              </button>
              {sent && (
                <p className="text-xs leading-5 text-teal-700 dark:text-teal-300">
                  {DEMO_REQUEST_MESSAGE}
                </p>
              )}
              {error && (
                <p className="text-xs leading-5 text-red-600 dark:text-red-400">{error}</p>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
