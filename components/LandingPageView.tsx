// Renders a public SEO revision landing page (/[slug]) from authored JSON.
// Pure presentational server component — it takes the already-loaded page and
// its resolved related pages, so it imports no server-only content module and
// holds no hidden case material. Chrome mirrors /about (Logo header, zinc/teal
// palette, max-w-2xl column) so the content pages feel part of the same site.

import Link from 'next/link';
import Logo from '@/components/Logo';
import type { LandingPage } from '@/lib/types';

/** Minimal inline formatter: the ONLY markup authored content may use is
 *  **bold** (to highlight sign / clinical terms). Split on the pairs and wrap
 *  the odd segments; React escapes everything, so this is XSS-safe. */
function inline(text: string, keyBase: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-zinc-800 dark:text-zinc-200">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

export default function LandingPageView({
  page,
  related,
}: {
  page: LandingPage;
  related: LandingPage[];
}) {
  return (
    <main className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* Brand header — same as /about; the logo links back to the app. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate FULL document load: Permissions-Policy binds to the document, and this page is served microphone=(). A client-side <Link> nav would carry that denial into the app and leave dictation dead on arrival. */}
        <a href="/" className="flex w-fit items-center gap-2.5" aria-label="PACES Buddy — back to the app">
          <Logo className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">PACES Buddy</span>
        </a>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">{page.h1}</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{inline(page.intro, 'intro')}</p>

        {page.sections.map((section, si) => (
          <section key={`sec-${si}`}>
            <h2 className="mt-8 text-base font-semibold">{section.heading}</h2>
            {section.paragraphs?.map((p, pi) => (
              <p key={`sec-${si}-p-${pi}`} className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {inline(p, `sec-${si}-p-${pi}`)}
              </p>
            ))}
            {section.bullets && section.bullets.length > 0 && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {section.bullets.map((b, bi) => (
                  <li key={`sec-${si}-b-${bi}`}>{inline(b, `sec-${si}-b-${bi}`)}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {page.faq && page.faq.length > 0 && (
          <>
            <h2 className="mt-8 text-base font-semibold">FAQ</h2>
            <dl className="mt-2 space-y-4 text-sm leading-6">
              {page.faq.map((item, fi) => (
                <div key={`faq-${fi}`}>
                  <dt className="font-medium text-zinc-800 dark:text-zinc-200">{item.question}</dt>
                  <dd className="mt-1 text-zinc-600 dark:text-zinc-300">{inline(item.answer, `faq-${fi}`)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {/* Practice CTA — the one place these pages push into the app. */}
        <div className="mt-10 rounded-xl border border-teal-200 bg-teal-50 p-5 dark:border-teal-900 dark:bg-teal-950/40">
          <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">{inline(page.practiceCta, 'cta')}</p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate FULL document load: Permissions-Policy binds to the document, and this page is served microphone=(). A client-side <Link> nav would carry that denial into the app and leave dictation dead on arrival. */}
          <a
            href="/"
            className="mt-3 inline-flex items-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Start practising — it&apos;s free
          </a>
        </div>

        {related.length > 0 && (
          <nav className="mt-8" aria-label="Related PACES topics">
            <h2 className="text-base font-semibold">Related</h2>
            <ul className="mt-2 space-y-1.5 text-sm leading-6">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/${r.slug}`} className="underline hover:text-teal-700 dark:hover:text-teal-300">
                    {r.h1}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <p className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- deliberate FULL document load: Permissions-Policy binds to the document, and this page is served microphone=(). A client-side <Link> nav would carry that denial into the app and leave dictation dead on arrival. */}
          <a href="/" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            PACES Buddy home
          </a>
          {' · '}
          <Link href="/about" className="underline hover:text-teal-700 dark:hover:text-teal-300">
            About
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
