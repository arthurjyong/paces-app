// Web app manifest (/manifest.webmanifest) — makes PACES Buddy installable /
// add-to-home-screen on the mobile audience. A single SVG icon with sizes:'any'
// satisfies modern install prompts; the Apple touch icon is wired separately by
// app/apple-icon.tsx.

import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_TITLE_DEFAULT, SITE_DESCRIPTION, BRAND_TEAL } from '@/lib/seo';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE_DEFAULT,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: BRAND_TEAL,
    icons: [{ src: '/icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' }],
  };
}
