// /lab — the Lab INDEX. Each experiment lives at a self-describing child
// route (/lab/dictation, /lab/case) rather than a number, so a link says what
// it is. Owner decisions 2026-07-12: open to EVERYONE behind a prominent "not
// polished, not final" banner; experiments that spend a server-held key still
// require the managed sign-in (invariant 9 — no anonymous server-key path).
//
// Deliberately UNDISCOVERABLE: the page-level `robots` below replaces the
// layout's robots object wholesale for this route (Next's shallow metadata
// merge), the sitemap never lists it (app/sitemap.ts is a hardcoded list), and
// nothing public links here. Do NOT add /lab to robots.txt disallow —
// blocking the crawl would stop this noindex from being read.

import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';
import LabBanner from '@/components/LabBanner';

export const metadata: Metadata = {
  title: 'Lab',
  description: 'Experimental PACES Buddy features under research.',
  // SELF-referencing canonical, and it is load-bearing: Next's metadata merge
  // is a shallow per-key overwrite, so a page that omits `alternates` inherits
  // the ROOT LAYOUT's `canonical: "/"` — i.e. every Lab page would tell Google
  // "I am a duplicate of the homepage" while ALSO carrying noindex. That
  // conflicting pair is exactly what can propagate the noindex onto the
  // canonical target: the homepage (review 2026-07-12).
  alternates: { canonical: '/lab' },
  robots: { index: false, follow: false },
};

const EXPERIMENTS = [
  {
    href: '/lab/case',
    name: 'Practise a case by voice',
    status: 'live',
    blurb:
      'The full practice interface with a microphone beside Send: speak your findings, and the transcript lands in the box for you to edit before sending. Dictation, not conversation — nothing reaches the examiner until you press Send.',
  },
  {
    href: '/lab/dictation',
    name: 'Transcription playground',
    status: 'live',
    blurb:
      'The workbench behind the mic: record once, transcribe the same clip on two models side by side, and score a take against a set of PACES sentences. Used to pick which speech model the app should trust.',
  },
];

export default function LabPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">🧪 Lab</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Where new ideas are tried before they reach the app. Everything here is a work in
          progress — try it, break it, and tell us what you think.
        </p>

        <div className="mt-4">
          <LabBanner />
        </div>

        <ul className="mt-8 space-y-3">
          {EXPERIMENTS.map((x) => (
            <li key={x.href}>
              <Link
                href={x.href}
                className="block rounded-md border border-zinc-200 bg-white p-4 transition-colors hover:border-teal-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-teal-500"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{x.name}</span>
                  <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-900/60 dark:text-teal-200">
                    {x.status}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{x.blurb}</p>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          <Link href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Back to practising
          </Link>
          {' · '}
          <Link href="/about" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            About
          </Link>
          {' · '}
          <Link href="/privacy" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Privacy &amp; disclaimer
          </Link>
          {' · '}
          <span>build {process.env.NEXT_PUBLIC_BUILD_STAMP}</span>
        </p>
      </div>
    </main>
  );
}
