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
        // The ONLY route allowed to reach the microphone: the /lab voice-
        // dictation experiment (2026-07-12). Scoped deliberately — the mic
        // permission is granted per-ORIGIN by the browser, so once a user
        // allows it here, an origin-wide `microphone=(self)` would let script
        // on ANY page (the practice pane, the landing pages) open the mic;
        // our CSP must carry script-src 'unsafe-inline' for Tailwind, so this
        // header is the backstop that keeps that unreachable. Duplicate header
        // keys are last-match-wins in Next, so this entry (declared after the
        // catch-all above) overrides Permissions-Policy for /lab only, and
        // must therefore restate the full directive list.
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
