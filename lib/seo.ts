// Single source of truth for SEO / discoverability. All metadata, the
// sitemap, robots.txt, and structured data flow through the constants and
// helpers here so that "make the site discoverable" is one reviewed change.
//
// ▶ THE FLIP: set SITE_INDEXABLE = true when the site is launch-ready. That one
//   line lifts the site-wide noindex (layout metadata robots), opens robots.txt
//   to crawlers, and advertises the sitemap — atomically, with no mixed
//   signals. It is INDEPENDENT of the /case-images/* "noindex, noimageindex"
//   response header in next.config.ts, which protects the interim third-party
//   clinical images and must stay ON regardless (see that file's comment). The
//   images never reach a crawlable page, so the flip exposes zero clinical
//   photos — only /, /about and /privacy (which contain none) become indexable.

import type { Metadata } from 'next';

/** Master switch for search discoverability. While false the whole site is
 *  noindexed and robots.txt disallows all crawling; flip to true to launch. */
export const SITE_INDEXABLE = true;

export const SITE_URL = 'https://pacesbuddy.com';
export const SITE_NAME = 'PACES Buddy';
export const SITE_TAGLINE = 'AI practice partner for MRCP PACES';
export const SITE_TITLE_DEFAULT = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const SITE_DESCRIPTION =
  'A free, open-source AI practice partner for the MRCP PACES clinical exam. Practise name-free cases against an AI examiner and simulated patient, then get a structured marksheet across the seven PACES skills — your practice partner for the hours between real patients.';

export const GITHUB_URL = 'https://github.com/arthurjyong/paces-app';
export const CONTACT_EMAIL = 'hello@pacesbuddy.com';

/** Brand teal (matches app/icon.svg + the app's teal accents). */
export const BRAND_TEAL = '#0d9488';

/** The PACES Buddy mark (speech bubble + ECG trace), inlined so the generated
 *  OG image and apple-icon can embed it as a data URI. Mirrors app/icon.svg. */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="#0d9488"/><g fill="#ffffff"><rect x="16" y="24" width="68" height="42" rx="13"/><path d="M30 62 L30 83 L51 64 Z"/></g><polyline points="26,45 39,45 45,32 51,58 57,45 74,45" fill="none" stroke="#0d9488" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The metadata `robots` object (a <meta name="robots"> directive), gated on
 *  SITE_INDEXABLE. When discoverable, googleBot keeps noimageindex on as a
 *  belt-and-suspenders with the /case-images/* response header. */
export function robotsMeta(): Metadata['robots'] {
  if (!SITE_INDEXABLE) {
    return { index: false, follow: false };
  }
  return {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  };
}

/** Per-page metadata for the two static pages (canonical + share cards).
 *  Nested metadata objects are REPLACED wholesale by the child in Next's
 *  shallow merge, so each page emits its own complete openGraph/twitter. */
export function pageMetadata(opts: { title: string; description: string; path: string }): Metadata {
  const fullTitle = `${opts.title} — ${SITE_NAME}`;
  return {
    title: opts.title, // gets the layout's "%s — PACES Buddy" template
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url: opts.path,
      title: fullTitle,
      description: opts.description,
      locale: 'en_US',
      // Child pages set their own openGraph, which replaces (not merges) the
      // layout's — and that drops the file-convention /opengraph-image. Re-add
      // it explicitly so /about and /privacy also unfurl with the brand card.
      images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: SITE_NAME }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description: opts.description,
      images: ['/opengraph-image'],
    },
  };
}

// ── JSON-LD structured data (plain objects; rendered via <JsonLd>) ───────────
// Depersonalised on purpose: the brand entity is an Organization ("PACES
// Buddy"), never a Person — mirroring the grassroots "a group of residents"
// positioning.

const ORG_ID = `${SITE_URL}/#organization`;

export function organizationLd() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    email: CONTACT_EMAIL,
    description:
      'A grassroots, non-commercial project by a group of residents providing a free, open-source practice partner for the MRCP PACES exam.',
    sameAs: [GITHUB_URL],
  };
}

export function webApplicationLd() {
  return {
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    inLanguage: 'en',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': ORG_ID },
    audience: { '@type': 'EducationalAudience', educationalRole: 'MRCP PACES candidate' },
  };
}

/** The home page graph: the web app plus the brand entity it belongs to. */
export function homeGraphLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [webApplicationLd(), organizationLd()],
  };
}

/** FAQPage from the questions visibly present on /about (must mirror the DOM). */
export function faqPageLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
}
