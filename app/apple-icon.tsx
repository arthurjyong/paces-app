// Generated 180×180 Apple touch icon (/apple-icon) for iOS home-screen
// bookmarks — the mobile candidate audience's "add to home screen" tile.
// Reuses the brand mark; iOS applies its own corner mask.

import { ImageResponse } from 'next/og';
import { LOGO_SVG, BRAND_TEAL } from '@/lib/seo';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const logo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND_TEAL }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={180} height={180} alt="" />
      </div>
    ),
    { ...size },
  );
}
