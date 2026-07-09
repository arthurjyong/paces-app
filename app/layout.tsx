import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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
  title: "PACES Buddy — AI practice partner",
  description: "PACES Buddy — AI practice partner for MRCP PACES",
  // Pre-launch (audience of one) AND the interim build carries third-party
  // clinical images — keep it out of search indexes until images are swapped to
  // open-licensed sources. Remove once the app is intended to be discoverable.
  robots: { index: false, follow: false },
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
