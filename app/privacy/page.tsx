// /privacy — what is stored, what never leaves the browser, and the formal
// disclaimer (educational simulator, not clinical advice, not a substitute
// for bedside practice). Static server component, linked from /about and the
// sidebar footer's About page.

import Link from 'next/link';
import Logo from '@/components/Logo';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Privacy & disclaimer',
  description:
    'What PACES Buddy stores, what never leaves your browser, and what this tool is — and is not.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate FULL document load: Permissions-Policy binds to the document, and this page is served microphone=(). A client-side <Link> nav would carry that denial into the app and leave dictation dead on arrival. */}
        <a href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </a>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Privacy &amp; disclaimer</h1>

        <h2 className="mt-8 text-base font-semibold">What we store</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          <li>
            <strong>Account:</strong> if you sign in, your email address and hashed sign-in codes.
            Nothing else identifies you — no name, no password.
          </li>
          <li>
            <strong>Study history:</strong> encounters you finish are kept in your browser; when
            signed in they also sync to the server so your history follows you across devices. A
            history record holds the case stem, your own transcript, and your marksheet — the
            hidden case files and answer keys never leave the server.
          </li>
          <li>
            <strong>Usage metering:</strong> when you are signed in, the cost of each AI call is
            recorded against your account so we can keep it within a fair monthly limit.
          </li>
          <li>
            <strong>Feedback:</strong> whatever you type in the feedback form, with your account
            email attached when you are signed in.
          </li>
        </ul>

        <h2 className="mt-8 text-base font-semibold">Voice dictation</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Signed-in users can dictate instead of typing. Audio is recorded <em>only</em> while a
          take is running — you tap the microphone, and your browser asks your permission first;
          nothing listens in the background. The clip passes through our server to{' '}
          <strong>Groq</strong>, which turns it into text. We never save or log the audio, and the
          transcript lands in your text box exactly like typed text, for you to edit before you
          send it.
        </p>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Two things are worth knowing. First, so the model spells clinical terms correctly, we
          send <em>a short slice of the encounter already on your screen</em> along with the clip —
          the last couple of lines you and the examiner have exchanged, plus a list of common exam
          terms. Nothing hidden from you is ever sent. Second, Groq does not retain audio by
          default, but may hold it for up to 30 days to investigate faults or abuse, under its own
          policy. So treat it like any other cloud service:{' '}
          <strong>do not put real patient identifiers into the app — spoken or typed.</strong>
        </p>

        <h2 className="mt-8 text-base font-semibold">Your API key</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Your own API key, if you add one in Settings, is stored only in this browser. Each
          request passes it through our server to your AI provider and it is never saved or
          logged there. You pay your provider directly for what you use.
        </p>

        <h2 className="mt-8 text-base font-semibold">Analytics &amp; email</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          We use cookieless, privacy-friendly web analytics (aggregate page counts — no personal
          profiles, no ads, no third-party trackers). Emails from us are limited to sign-in codes,
          a short acknowledgement when you send feedback with a reply address, and any actual
          replies to that feedback.
        </p>

        <h2 className="mt-8 text-base font-semibold">Disclaimer</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          PACES Buddy is an exam-practice simulator, for education only. It is not medical advice,
          and it is not a substitute for clinical training, bedside teaching, or examining real
          patients. AI output can be wrong or incomplete — verify anything surprising against
          authoritative sources, and please report errors so the case bank improves for everyone.
        </p>

        <h2 className="mt-8 text-base font-semibold">Clinical images</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Some clinical photographs shown in cases remain the copyright of their original sources
          and are used here for education while we transition to openly licensed material. If an
          image is yours and you would like it credited or removed, write to us.
        </p>

        <h2 className="mt-8 text-base font-semibold">Contact</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate FULL document load: Permissions-Policy binds to the document, and this page is served microphone=(). A client-side <Link> nav would carry that denial into the app and leave dictation dead on arrival. */}
          <a
            href="mailto:hello@pacesbuddy.com"
            className="underline hover:text-teal-700 dark:hover:text-teal-300"
          >
            hello@pacesbuddy.com
          </a>
        </p>

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate FULL document load: Permissions-Policy binds to the document, and this page is served microphone=(). A client-side <Link> nav would carry that denial into the app and leave dictation dead on arrival. */}
          <a href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Back to practising
          </a>
          {' · '}
          <Link href="/about" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            About
          </Link>
        </p>
      </div>
    </main>
  );
}
