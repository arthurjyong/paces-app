// Emitted at /robots.txt. Gated on SITE_INDEXABLE: while the site is not yet
// discoverable, disallow all crawling and advertise no sitemap (so nothing is
// discovered even if the noindex meta were ever missed). When the flag flips,
// open crawling, keep the API surface disallowed, name the apex as the
// canonical host, and point at the sitemap.
//
// NOTE: this is a DIFFERENT mechanism from the metadata `robots` noindex (which
// controls indexing). /case-images/* indexing is handled independently by the
// X-Robots-Tag header in next.config.ts and is intentionally not disallowed
// here (the header must be crawlable to be honoured; nothing links to it).

import type { MetadataRoute } from 'next';
import { SITE_URL, SITE_INDEXABLE } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  if (!SITE_INDEXABLE) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
