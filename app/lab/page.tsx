// /lab — the experimental section: features under research, trialled here
// before (if ever) reaching the main app. Owner decisions 2026-07-12: open to
// EVERYONE behind a prominent "not polished, not final" banner; server-key-
// spending experiments (dictation) still require the managed sign-in
// (invariant 9 — no anonymous server-key path).
//
// Deliberately UNDISCOVERABLE: page-level `robots` below replaces the
// layout's robots object wholesale for this route (Next's shallow metadata
// merge — same mechanism lib/seo.ts pageMetadata relies on), the sitemap
// never lists it (app/sitemap.ts is a hardcoded list), and nothing public
// links here. Do NOT add /lab to robots.txt disallow — blocking the crawl
// would stop this noindex from being read (see the /case-images note there).

import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';
import LabPlayground from '@/components/LabPlayground';

export const metadata: Metadata = {
  title: 'Lab',
  description: 'Experimental PACES Buddy features under research.',
  robots: { index: false, follow: false },
};

export default function LabPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">🧪 Lab</h1>

        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Features here are <strong>under research</strong> — not polished, not final, and they
          may change or disappear without notice. Feedback is very welcome (the Feedback form in
          the app reaches us).
        </div>

        <h2 className="mt-8 text-base font-semibold">Experiment 1 — voice dictation</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Speak instead of typing: record a short take, and it is transcribed into text you can
          edit before sending — the way you would present findings out loud in the exam. We are
          comparing transcription models on real PACES vocabulary before wiring this into the
          practice composer.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          <li>
            Voice clips pass through our server to the speech-recognition provider you pick and are
            never stored by us; the provider may retain audio briefly for its own abuse monitoring
            (see{' '}
            <Link href="/privacy" className="underline hover:text-teal-700 dark:hover:text-teal-300">
              privacy
            </Link>
            ). Don&apos;t dictate real patient identifiers.
          </li>
          <li>
            Recording stops automatically at 2 minutes, and stops early if the screen locks or you
            switch apps (a phone limitation) — what was captured is kept.
          </li>
          <li>English-only on purpose: forced English beats auto-detection for accented medical speech.</li>
          <li>
            <strong>iPhone tip:</strong> Safari asks for microphone permission again on most
            visits — that is an Apple rule, not a setting we control. To stop the re-prompting,
            tap <strong>aA</strong> in the address bar → Website Settings → Microphone →{' '}
            <strong>Allow</strong> (or add PACES Buddy to your Home Screen).
          </li>
        </ul>

        <div className="mt-4">
          <LabPlayground />
        </div>

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
