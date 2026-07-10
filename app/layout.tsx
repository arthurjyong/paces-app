import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE_DEFAULT,
  SITE_DESCRIPTION,
  robotsMeta,
} from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE_DEFAULT, template: `%s — ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  // Site-wide default share card; child pages override title/description.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    title: SITE_TITLE_DEFAULT,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE_DEFAULT,
    description: SITE_DESCRIPTION,
  },
  // Discoverability is gated by SITE_INDEXABLE in lib/seo.ts (currently the
  // whole site is noindexed: pre-launch, and pending the third-party clinical
  // image swap). Flip that one flag to launch. The /case-images/* noimageindex
  // header in next.config.ts is separate and stays regardless.
  robots: robotsMeta(),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // iOS Safari auto-zooms the page when a focused input's font-size is below
  // 16px; capping the scale suppresses that focus zoom. iOS still honours
  // manual pinch-zoom regardless of this cap (accessibility override).
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* Vercel Web Analytics — cookieless, no personal data, no consent
            banner needed (privacy-friendly fit for a clinical audience). */}
        <Analytics />
      </body>
    </html>
  );
}
