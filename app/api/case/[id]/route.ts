import { NextResponse } from 'next/server';
import type { ApiError, PublicCase } from '@/lib/types';
import { getCaseMeta, getCaseStem, toPublicMeta } from '@/lib/content';

export const runtime = 'nodejs';

// Pin caching explicitly rather than relying on platform defaults.
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Manifest lookup only — the id is never joined into a filesystem path
    // (invariant 3).
    const meta = getCaseMeta(id);
    if (!meta) {
      const body: ApiError = { error: 'Case not found' };
      return NextResponse.json(body, { status: 404, headers: CACHE_HEADERS });
    }
    // PublicCase is the ONLY case content the client may ever receive
    // (invariant 1): spoiler-free projected meta (no canonicalSlugs — they
    // name the diagnosis) + the candidate stem.
    const body: PublicCase = { meta: toPublicMeta(meta), stem: getCaseStem(id) };
    return NextResponse.json(body, { headers: CACHE_HEADERS });
  } catch (err) {
    // Never forward the raw error — ContentError messages name internal file
    // paths / build scripts (info disclosure to anonymous clients).
    console.error('[case] content error:', err instanceof Error ? err.message : 'unknown error');
    const body: ApiError = { error: 'Case content is temporarily unavailable' };
    return NextResponse.json(body, { status: 500, headers: CACHE_HEADERS });
  }
}
