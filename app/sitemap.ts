// Emitted at /sitemap.xml. Lists only the crawlable static routes — "/" (the
// server-wrapped app) and the two static pages; case/API routes are JS/login-
// gated and deliberately excluded. Advertised to crawlers only once the site
// is discoverable (robots.ts gates the reference on SITE_INDEXABLE).

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { getLandingSlugs } from '@/lib/content';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  // Public SEO revision pages (/[slug]) — enumerated from what actually built,
  // so the sitemap can never advertise a page that isn't there.
  const landing: MetadataRoute.Sitemap = getLandingSlugs().map((slug) => ({
    url: `${SITE_URL}/${slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));
  return [
    // No trailing slash, to match the self-referencing canonical Next emits for
    // the root (`https://pacesbuddy.com`) — keeps sitemap and canonical identical.
    { url: SITE_URL, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/about`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    ...landing,
  ];
}
