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

export default function Page() {
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
      </div>
      <HomeApp />
      <JsonLd data={homeGraphLd()} />
    </>
  );
}
