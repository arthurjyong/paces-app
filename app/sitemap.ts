// Emitted at /sitemap.xml. Lists only the crawlable static routes — "/" (the
// server-wrapped app) and the two static pages; case/API routes are JS/login-
// gated and deliberately excluded. Advertised to crawlers only once the site
// is discoverable (robots.ts gates the reference on SITE_INDEXABLE).

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/about`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
