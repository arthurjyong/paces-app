'use client';

// Sidebar "Account" section — the managed door's client face (Phase 1;
// replaces the Phase-0 "Invited access" panel). Sign-in is email + a 6-digit
// code typed IN-APP — deliberately not a clickable link, because institutional
// mail gateways rewrite or strip links (plan §3). The session lives in an
// httpOnly cookie, so this component only ever sees the ManagedStatus
// projection from GET /api/auth/status (masked email, tier, covered models) —
// never the cookie value, the full address, the spend numbers, or any key.
// Collapsible, styled to match Settings.

import { useState } from 'react';
import type { ApiError, AuthRequestResponse } from '@/lib/types';
import type { ManagedStatus } from '@/lib/tiers';

interface AccountPanelProps {
  /** null while GET /api/auth/status is still loading. */
  status: ManagedStatus | null;
  /** Re-fetch /api/auth/status (called after a successful verify). */
  onRefresh: () => void;
  /** Called after an explicit sign-out — the parent clears local History and re-fetches status. */
  onSignOut: () => void;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorFrom(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as ApiError).error === 'string') {
    return (data as ApiError).error;
  }
  return fallback;
}

export default function AccountPanel({ status, onRefresh, onSignOut }: AccountPanelProps) {
  const [open, setOpen] = useState(true);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // The 'sent' message from /api/auth/request; its presence is also what
  // switches the form into the type-the-code stage.
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  // 'byok_only' is informational, not a failure: the domain simply isn't on
  // either allow-list (public product behaviour, per the auth contract) —
  // rendered amber, never red.
  const [byokMessage, setByokMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'request' | 'verify' | 'signout' | null>(null);

  async function requestCode() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy('request');
    setError(null);
    setByokMessage(null);
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      const data = await readJson(res);
      // Non-2xx = rate limit / malformed address / managed door unavailable —
      // the server's fixed strings are user-ready.
      if (!res.ok) throw new Error(errorFrom(data, `Request failed (${res.status})`));
      const parsed = data as AuthRequestResponse;
      if (parsed.status === 'sent' && typeof parsed.message === 'string') {
        setSentMessage(parsed.message);
        setCode('');
      } else if (parsed.status === 'byok_only' && typeof parsed.message === 'string') {
        setByokMessage(parsed.message);
        setSentMessage(null);
      } else {
        throw new Error('Unexpected response — please try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode() {
    const value = email.trim();
    const digits = code.trim();
    if (!value || digits.length !== 6 || busy) return;
    setBusy('verify');
    setError(null);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, code: digits }),
      });
      const data = await readJson(res);
      if (!res.ok || !(data && typeof data === 'object' && (data as { ok?: unknown }).ok === true)) {
        throw new Error(errorFrom(data, `Sign-in failed (${res.status})`));
      }
      // The session cookie rode in on the response; the parent re-fetches
      // status (which flips this panel to the signed-in card), and the local
      // form state resets so a later sign-out starts from a clean slate.
      setEmail('');
      setCode('');
      setSentMessage(null);
      setByokMessage(null);
      setError(null);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy('signout');
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch {
      // best-effort — the status refresh below shows the truth either way
    } finally {
      setBusy(null);
      onSignOut();
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
        <span>Account</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          {status === null ? (
            // Don't flash the sign-in form before we know whether a session is
            // already active (it reads as a contradiction on a signed-in
            // device that is merely still loading).
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">Checking access…</p>
          ) : status.active ? (
            <>
              <div className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 dark:border-teal-800 dark:bg-teal-950/40">
                <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
                  Signed in as {status.email}
                </p>
                <p className="mt-0.5 text-xs text-teal-700/80 dark:text-teal-300/80">
                  Free practice, with your study history synced across your devices.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={busy !== null}
                className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {busy === 'signout' ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (sentMessage) void verifyCode();
                else void requestCode();
              }}
            >
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Sign in with your email to practise free with DeepSeek AI, with your study history
                synced across your devices. Want a smarter study partner? Add your own Claude API
                key in Settings for a more advanced AI — your history still syncs.
              </p>
              <input
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-label="Email address for managed access"
                className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              {sentMessage ? (
                <>
                  <p className="text-xs leading-5 text-teal-700 dark:text-teal-300">{sentMessage}</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit code"
                    aria-label="6-digit sign-in code"
                    className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-base tracking-widest outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 md:text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <button
                    type="submit"
                    disabled={busy !== null || code.trim().length !== 6}
                    className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {busy === 'verify' ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void requestCode()}
                    disabled={busy !== null || email.trim().length === 0}
                    className="block text-xs text-zinc-500 underline hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    Send a new code
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  disabled={busy !== null || email.trim().length === 0}
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {busy === 'request' ? 'Sending…' : 'Email me a code'}
                </button>
              )}
              {byokMessage && (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{byokMessage}</p>
              )}
              {error && <p className="text-xs leading-5 text-red-600 dark:text-red-400">{error}</p>}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
