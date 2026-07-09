// GET /api/auth/status — the client's whole view of the managed session.
//
// Returns ManagedStatus (lib/tiers.ts): {active:false} when signed out, else
// an opaque per-user id, the MASKED email, tier, and tier-filtered model ids —
// NO spend numbers (users are never shown their credit). The cookie value, the
// full email address, and the server-held gateway key never appear in the
// payload. Authorization is re-derived from
// the database inside getManagedStatus, so a domain or override removed
// after sign-in reads as {active:false} immediately — outstanding cookies
// included. ANY failure (a DB blip, an unconfigured door) also returns
// {active:false} with a 200: the sidebar polls this on every load and must
// degrade to "signed out", never break or leak an error.

import { NextResponse } from 'next/server';
import type { ManagedStatus } from '@/lib/tiers';
import { getManagedStatus } from '@/lib/managed';

export const runtime = 'nodejs';

// Per-user, cookie-derived — must never be stored by a shared/CDN cache.
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET() {
  try {
    return NextResponse.json(await getManagedStatus(), { headers: CACHE_HEADERS });
  } catch (err) {
    // Log the cause server-side; the client just sees "signed out".
    console.error('[auth] status failed:', err instanceof Error ? err.message : 'unknown error');
    const body: ManagedStatus = { active: false };
    return NextResponse.json(body, { headers: CACHE_HEADERS });
  }
}
