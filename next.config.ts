import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the generated content/ dir with every API route on Vercel
  // (runtime fs reads are not statically traceable).
  outputFileTracingIncludes: {
    "/api/**": ["./content/**"],
  },
  env: {
    // Stamped at build time and shown in the sidebar footer, so anyone can
    // tell at a glance whether their browser is running the latest deploy
    // (stale mobile tabs kept serving pre-autosave code invisibly).
    // GMT+8 (Singapore) — the audience is SG-based; a UTC stamp read a day
    // "behind" during late-night sessions and looked stale.
    NEXT_PUBLIC_BUILD_STAMP:
      new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " GMT+8",
  },
  // Canonical-host redirects: 308 the www alias and the stable Vercel
  // production alias to the apex domain, so there is a single indexable host.
  // The metadataBase canonical tags already point search engines at the apex;
  // these make it authoritative and stop the vercel.app URL competing in the
  // index. Only the exact production aliases match, so per-deployment
  // *.vercel.app preview URLs (used for testing) are left alone. The apex
  // itself has no rule, so there is no redirect loop.
  async redirects() {
    return [
      {
        // /lab/case was the Lab trial of voice dictation. It GRADUATED to the
        // main app on 2026-07-12 (the mic is now beside Send at /), so the
        // experiment page is retired — keeping a second copy of the whole
        // practice app would just be two things to maintain and two places to
        // diverge. Anyone holding the old link lands on the real thing.
        source: "/lab/case",
        destination: "/",
        permanent: false,
      },
      {
        // The Lab as a SECTION is closed (2026-07-12): its one experiment
        // graduated, and the only thing left is the transcription playground —
        // the workbench that picks which speech model the app trusts. So /lab
        // is no longer a hub, it just goes to the tool that remains.
        source: "/lab",
        destination: "/lab/dictation",
        permanent: false,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.pacesbuddy.com" }],
        destination: "https://pacesbuddy.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "paces-app.vercel.app" }],
        destination: "https://pacesbuddy.com/:path*",
        permanent: true,
      },
    ];
  },
  // Baseline security response headers on every route (security audit
  // 2026-07-09). CSP is strict but allows the inline styles Tailwind injects +
  // the Vercel Analytics/Insights hosts; frame-ancestors 'none' + XFO DENY stop
  // clickjacking; nosniff blocks MIME-sniffing.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      // blob: is for the /lab dictation playground's local playback of a
      // just-recorded clip — object URLs only, never a remote source.
      "media-src 'self' blob:",
      "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",
      "font-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Voice dictation graduated from the Lab to the main app (2026-07-12),
        // so the practice route needs the microphone.
        //
        // The grant stays SCOPED to the routes that actually record, rather
        // than going site-wide, and that is a deliberate security decision, not
        // an oversight: the browser grants mic permission per-ORIGIN, so once a
        // user allows it here, an origin-wide `microphone=(self)` would let
        // script on ANY page of pacesbuddy.com open the mic — and our CSP must
        // carry script-src 'unsafe-inline' for Tailwind, so this header is the
        // backstop that keeps that unreachable. Every content page (/about,
        // /privacy, the 16 landing pages) therefore keeps the catch-all's
        // `microphone=()`. Duplicate header keys are last-match-wins in Next,
        // so these entries override the catch-all and must restate the full
        // directive list.
        source: "/",
        headers: [
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
      {
        source: "/lab/:path*",
        headers: [
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          // Belt-and-braces with each Lab page's `robots` metadata: experiments
          // must never surface in search, whatever they render.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // Clinical images are interim third-party material (see layout.tsx
        // robots note): the page-level noindex meta can't cover static image
        // responses, so refuse indexing at the header level. This must
        // OUTLIVE the site-wide noindex — when the app is opened up for SEO,
        // these files stay out of image search regardless.
        source: "/case-images/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, noimageindex" }],
      },
    ];
  },
};

export default nextConfig;
