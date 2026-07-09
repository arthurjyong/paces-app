// /about — the project's story, linked from the sidebar footer and the empty
// state. Static server component; all copy decisions are deliberate (owner,
// 2026-07-10): grassroots framing ("a group of residents", no individual
// names), free + open source + explicitly not commercial, no donations —
// contributions of ideas/corrections/recalls/code instead, and the
// "supplement, not replacement, for the bedside" positioning up front.

import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';

export const metadata: Metadata = {
  title: 'About — PACES Buddy',
  description:
    'PACES Buddy is a free, open-source AI practice partner for MRCP PACES — a grassroots project by residents, for candidates.',
};

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </Link>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">About</h1>

        <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          PACES Buddy is a free, open-source practice partner for the MRCP PACES exam — a
          grassroots project built by a group of residents who were preparing for the exam
          themselves and wanted a better way to practise between shifts.
        </p>

        <h2 className="mt-8 text-base font-semibold">Not a replacement for the bedside</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          PACES is a bedside exam: real patients, real signs, real time pressure. No app teaches
          you what a spleen edge feels like, and none should claim to. PACES Buddy is for the
          hours you are <em>not</em> at the bedside — the commute, the post-call evening, the
          weeks when no senior is free to role-play a station. It drills the thinking layer: the
          examination routine, presenting findings, the viva, and the communication encounters —
          so the time you do get with real patients goes further.
        </p>

        <h2 className="mt-8 text-base font-semibold">How it works</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          <li>Pick one of 500+ name-free practice cases, or let the app pick at random.</li>
          <li>
            Describe what you examine, ask, or say — findings are revealed manoeuvre by
            manoeuvre, the way a real encounter unfolds.
          </li>
          <li>
            Present your findings, take the viva, and get a structured marksheet across the seven
            PACES skills.
          </li>
        </ol>

        <h2 className="mt-8 text-base font-semibold">Free, and not for sale</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          PACES Buddy is run and supported by a group of residents as a grassroots effort. It is
          free to use, the code is open source, and there are no plans to commercialise it. We do
          not currently accept donations — the way to give back is ideas, corrections, exam
          recalls, and code.
        </p>

        <h2 className="mt-8 text-base font-semibold">Make it better</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          <li>
            Something broken, or an idea? Use <strong>Feedback</strong> in the app&apos;s sidebar.
          </li>
          <li>
            A wrong answer key or an unrealistic case? Report it straight from the marksheet —
            every correction sharpens the case bank for everyone.
          </li>
          <li>
            Recently sat PACES? Your exam recall is the single most valuable thing you can
            contribute — send it through the feedback form or email us.
          </li>
          <li>
            Developer? The app&apos;s code is open source (MIT) on{' '}
            <a
              href="https://github.com/arthurjyong/paces-app"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-teal-700 dark:hover:text-teal-300"
            >
              GitHub
            </a>
            .
          </li>
        </ul>

        <h2 className="mt-8 text-base font-semibold">FAQ</h2>
        <dl className="mt-2 space-y-4 text-sm leading-6">
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Which AI does it run on?</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-300">
              The free signed-in tier runs on a managed model paid for by the project. If you want
              a stronger examiner, add your own Claude API key in Settings — it is stored only in
              your browser, sent per-request, never saved on our server, and you pay the provider
              directly.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Is my data safe?</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-300">
              Short version: we store your account email and your study history (so it syncs
              across devices), your API key is never saved on our server, and there are no ads or
              third-party trackers. The long version is on the{' '}
              <Link href="/privacy" className="underline hover:text-teal-700 dark:hover:text-teal-300">
                privacy &amp; disclaimer
              </Link>{' '}
              page.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Can I trust the answers?</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-300">
              The examiner is grounded in a curated case bank and reference notes, but it is still
              AI and can be wrong. Treat a surprising claim as a prompt to open the textbook — and
              report it, so the next candidate gets a better case.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">Why is it free?</dt>
            <dd className="mt-1 text-zinc-600 dark:text-zinc-300">
              Because we wished this existed when we started preparing. It stays free as long as
              the running costs stay manageable.
            </dd>
          </div>
        </dl>

        <h2 className="mt-8 text-base font-semibold">Contact</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          <a
            href="mailto:hello@pacesbuddy.com"
            className="underline hover:text-teal-700 dark:hover:text-teal-300"
          >
            hello@pacesbuddy.com
          </a>{' '}
          — or the Feedback form in the app.
        </p>

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          <Link href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Back to practising
          </Link>
          {' · '}
          <Link href="/privacy" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Privacy &amp; disclaimer
          </Link>
        </p>
      </div>
    </main>
  );
}
