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
    ];
  },
};

export default nextConfig;
