// PACES Buddy — home route (server wrapper around the client app).
// The interactive practice UI is the HomeApp client component. This server
// component wraps it with two crawler-facing additions that the 'use client'
// SPA cannot provide on its own:
//   (a) a crawlable intro block — real text + internal links to /about,
//       /privacy and GitHub, present in the INITIAL HTML — so non-JS crawlers,
//       link unfurlers, and LLM answer engines see actual content (and can
//       discover the otherwise DOM-orphaned static pages), and
//   (b) the home-page JSON-LD (WebApplication + Organization).
// The intro is screen-reader / crawler visible but visually offscreen
// (sr-only): the mounted app is the only thing sighted users see, so the live
// UI is unchanged and there is no hydration flash. All of this is inert while
// the site is noindexed (SITE_INDEXABLE=false in lib/seo.ts).

import Link from 'next/link';
import HomeApp from '@/components/HomeApp';
import JsonLd from '@/components/JsonLd';
import { SITE_NAME, SITE_DESCRIPTION, GITHUB_URL, homeGraphLd } from '@/lib/seo';
import { getLandingSlugs, getLandingPage } from '@/lib/content';

export default function Page() {
  // Crawlable internal links to the revision guides — this gives every landing
  // page a direct link from the homepage (the highest-authority page), so
  // crawlers discover them beyond the sitemap and internal link equity flows in.
  // sr-only, so the minimalist practice UI is unchanged.
  const guides = getLandingSlugs()
    .map((slug) => getLandingPage(slug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <>
      <div className="sr-only">
        <h1>{SITE_NAME} — a free AI practice partner for the MRCP PACES exam</h1>
        <p>{SITE_DESCRIPTION}</p>
        <p>
          PACES Buddy is free, open source, and non-commercial. Learn more{' '}
          <Link href="/about">about the project</Link>, read the{' '}
          <Link href="/privacy">privacy &amp; disclaimer</Link>, or see the{' '}
          <a href={GITHUB_URL}>source code on GitHub</a>.
        </p>
        {guides.length > 0 && (
          <nav aria-label="PACES revision guides">
            <h2>Free MRCP PACES revision guides</h2>
            <ul>
              {guides.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${p.slug}`}>{p.h1}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      {/* Voice dictation GRADUATED from the Lab 2026-07-12: the mic sits beside
          Send for every signed-in user. It renders only when a transcription
          lane is reachable (i.e. signed in), so signed-out / BYOK users see the
          composer exactly as before. The matching microphone Permissions-Policy
          grant for "/" is in next.config.ts. */}
      <HomeApp dictation />
      <JsonLd data={homeGraphLd()} />
    </>
  );
}
