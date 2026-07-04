import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the generated content/ dir with every API route on Vercel
  // (runtime fs reads are not statically traceable).
  outputFileTracingIncludes: {
    "/api/**": ["./content/**"],
  },
};

export default nextConfig;
