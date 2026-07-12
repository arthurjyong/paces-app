// /lab/dictation — Lab experiment: the transcription playground. The
// workbench for choosing which speech model the app should trust: record once,
// transcribe the same clip on two lanes, diff them, and score a take against a
// PACES sentence. (The mic in a real case lives at /lab/case.)
//
// noindex: the page metadata's `robots` replaces the layout's wholesale for
// this route; /lab/* is also absent from the sitemap and linked nowhere public.

import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';
import LabBanner from '@/components/LabBanner';
import LabPlayground from '@/components/LabPlayground';

export const metadata: Metadata = {
  title: 'Transcription playground — Lab',
  description: 'Compare speech-recognition models on PACES vocabulary.',
  // Self-referencing — see the note in app/lab/page.tsx.
  alternates: { canonical: '/lab/dictation' },
  robots: { index: false, follow: false },
};

export default function LabDictationPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </Link>

        <p className="mt-8 text-xs text-zinc-400 dark:text-zinc-600">
          <Link href="/lab" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            🧪 Lab
          </Link>
          {' / '}
          <span>Transcription playground</span>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Transcription playground</h1>

        <div className="mt-4">
          <LabBanner />
        </div>

        <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Speak, and see how well each speech model handles real PACES vocabulary. Tick{' '}
          <strong>A/B</strong> to transcribe one recording on two models side by side — the
          differing words are highlighted. The bias context below is fed to the model as the text
          that supposedly preceded your speech: it is what makes it write
          &ldquo;pan-systolic&rdquo; rather than &ldquo;pancystolic&rdquo;. Clear it and re-record
          the same sentence to see the difference for yourself.
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
          <Link href="/lab" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Back to the Lab
          </Link>
          {' · '}
          <Link href="/lab/case" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Practise a case by voice
          </Link>
          {' · '}
          <span>build {process.env.NEXT_PUBLIC_BUILD_STAMP}</span>
        </p>
      </div>
    </main>
  );
}
