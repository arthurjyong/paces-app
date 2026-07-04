import { NextResponse } from 'next/server';
import type { ApiError, PublicManifest } from '@/lib/types';
import { ContentError, getPublicManifest } from '@/lib/content';

export const runtime = 'nodejs';

// Pin caching explicitly rather than relying on platform defaults — the app's
// whole value is what must not leak or go stale.
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET() {
  try {
    // Projected manifest only — canonicalSlugs name the diagnosis and must
    // never reach the client (invariant 1).
    const manifest: PublicManifest = getPublicManifest();
    return NextResponse.json(manifest, { headers: CACHE_HEADERS });
  } catch (err) {
    const body: ApiError = {
      error: err instanceof ContentError ? err.message : 'Internal server error',
    };
    return NextResponse.json(body, { status: 500, headers: CACHE_HEADERS });
  }
}
