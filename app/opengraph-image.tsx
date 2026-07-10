// Generated social share card (/opengraph-image), used for link unfurls on
// WhatsApp / Slack / Telegram / X etc. Brand only — deliberately contains no
// clinical images. Also serves as the Twitter card image (twitter falls back to
// og:image when no twitter-image is present).
//
// next/og only bundles Geist-Regular, so it cannot render a real bold weight on
// its own; the Geist 400/600/700 woff files in assets/ are loaded explicitly so
// the title renders genuinely bold. Read at build time (this route is static).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE_NAME, LOGO_SVG, BRAND_TEAL } from '@/lib/seo';

export const alt = 'PACES Buddy — a free AI practice partner for the MRCP PACES exam';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const fontFile = (weight: number) => readFile(join(process.cwd(), 'assets', `Geist-${weight}.woff`));

export default async function Image() {
  const [regular, semibold, bold] = await Promise.all([fontFile(400), fontFile(600), fontFile(700)]);
  const logo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
          fontFamily: 'Geist',
          padding: 80,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={150} height={150} alt="" />
        <div
          style={{
            display: 'flex',
            marginTop: 40,
            fontSize: 92,
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.02em',
          }}
        >
          {SITE_NAME}
        </div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 40, fontWeight: 600, color: BRAND_TEAL }}>
          AI practice partner for MRCP PACES
        </div>
        <div style={{ display: 'flex', marginTop: 36, fontSize: 27, fontWeight: 400, color: '#64748b' }}>
          Free · Open source · Practise between real patients
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
        { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
        { name: 'Geist', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
