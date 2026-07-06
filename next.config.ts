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
    NEXT_PUBLIC_BUILD_STAMP: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  },
};

export default nextConfig;
