// /lab/dictation — the transcription playground: the workbench that decides
// which speech model the app trusts. Record once, transcribe the same clip on
// two models side by side, and score a take against a set of PACES sentences.
//
// This is the ONLY thing left of the Lab. Voice dictation itself graduated to
// the main app on 2026-07-12 (the mic is beside Send at /), the /lab/case
// trial page is retired (→ /), and the Lab hub is gone (/lab → here). The
// playground stays because model choice is not a one-off decision: when a new
// speech model appears, this is how it gets compared against the incumbent on
// real PACES vocabulary and a real accent, rather than on a vendor benchmark.
//
// Unlisted and noindexed: the page metadata's `robots` replaces the layout's
// wholesale for this route, an X-Robots-Tag header backs it up, the sitemap
// never lists it, and nothing public links here.

import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';
import LabPlayground from '@/components/LabPlayground';

export const metadata: Metadata = {
  title: 'Transcription playground',
  description: 'Compare speech-recognition models on PACES vocabulary.',
  // Self-referencing — omitting this inherits the root layout's canonical="/",
  // which would pair a noindex with a canonical pointing at the homepage.
  alternates: { canonical: '/lab/dictation' },
  robots: { index: false, follow: false },
};

export default function DictationPlaygroundPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">🧪 Transcription playground</h1>

        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>A workbench, not a feature.</strong> This page exists to compare speech models
          against each other on real PACES vocabulary. Voice dictation itself now lives in the app
          — sign in and you will find a microphone beside Send.
        </div>

        <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Record a take and see how each model handles clinical language. Tick <strong>A/B</strong>{' '}
          to transcribe one recording on two models side by side — the differing words are
          highlighted. The bias context below is fed to the model as the text that supposedly
          preceded your speech: it is what makes it write &ldquo;pan-systolic&rdquo; rather than
          &ldquo;pancystolic&rdquo;. Clear it and re-record the same sentence to see the difference
          for yourself.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          <li>
            Voice clips pass through our server to the speech provider you pick and are never
            stored by us; the provider may retain audio briefly for its own abuse monitoring (see{' '}
            <Link href="/privacy" className="underline hover:text-teal-700 dark:hover:text-teal-300">
              privacy
            </Link>
            ). Don&apos;t dictate real patient identifiers.
          </li>
          <li>
            Recording stops automatically at 2 minutes, and stops early if the screen locks or you
            switch apps (a phone limitation) — what was captured is kept.
          </li>
          <li>
            <strong>iPhone tip:</strong> Safari re-asks for microphone permission on most visits —
            an Apple rule, not our setting. To stop the prompts: tap <strong>aA</strong> in the
            address bar → Website Settings → Microphone → <strong>Allow</strong>.
          </li>
        </ul>

        <div className="mt-6">
          <LabPlayground />
        </div>

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          <Link href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Back to practising
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
