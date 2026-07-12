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
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </Link>

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

        <h2 className="mt-8 text-base font-semibold">Voice dictation (Lab)</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          The experimental voice dictation in the Lab records audio <em>only</em> while you hold a
          take — you tap Record, and your browser asks your permission first. The clip passes
          through our server to the speech-recognition provider you pick, which returns the text;
          we never save or log the audio, and the transcript lands in your text box exactly like
          typed text. The providers (Groq, or OpenAI via Vercel AI Gateway) may keep a copy of the
          audio briefly for their own abuse monitoring — up to 30 days in OpenAI&apos;s case —
          under their own policies, so treat dictation like any other cloud service and do not
          speak real patient identifiers into it.
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
          <a
            href="mailto:hello@pacesbuddy.com"
            className="underline hover:text-teal-700 dark:hover:text-teal-300"
          >
            hello@pacesbuddy.com
          </a>
        </p>

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          <Link href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            Back to practising
          </Link>
          {' · '}
          <Link href="/about" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            About
          </Link>
        </p>
      </div>
    </main>
  );
}
