// GET /api/history  — pull the signed-in user's server-side study history.
// POST /api/history — push one archived encounter to the server.
//
// Both require a valid managed session (the cookie); an anonymous/BYOK user
// simply gets 401 and the client skips sync (their history stays local-only).
// The user only ever reads/writes their OWN rows (user id comes from the signed
// cookie, never the body). See lib/history.ts for the trust model.

import { NextResponse } from 'next/server';
import type { ApiError } from '@/lib/types';
import { readManagedSession } from '@/lib/managed';
import {
  listUserHistory,
  upsertRecord,
  validateIncomingRecord,
  type HistorySnapshot,
} from '@/lib/history';

export const runtime = 'nodejs';

// Per-user, cookie-derived — never cacheable by a shared/CDN cache.
const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status, headers: CACHE_HEADERS });
}

export async function GET() {
  try {
    const session = await readManagedSession();
    if (!session) return jsonError('Not signed in', 401);
    const snapshot: HistorySnapshot = await listUserHistory(session.sub);
    return NextResponse.json(snapshot, { headers: CACHE_HEADERS });
  } catch {
    // History sync is best-effort — a DB blip must not surface as an error the
    // user sees (their local history keeps working). Empty snapshot = no-op merge.
    const empty: HistorySnapshot = { records: [], deletedIds: [] };
    return NextResponse.json(empty, { headers: CACHE_HEADERS });
  }
}

export async function POST(request: Request) {
  try {
    const session = await readManagedSession();
    if (!session) return jsonError('Not signed in', 401);

    let body: { record?: unknown } | null;
    try {
      body = (await request.json()) as { record?: unknown } | null;
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
    const record = validateIncomingRecord(body?.record);
    if (!record) return jsonError('Invalid history record', 400);

    await upsertRecord(session.sub, record);
    return NextResponse.json({ ok: true }, { headers: CACHE_HEADERS });
  } catch {
    return jsonError('Could not save history — try again', 503);
  }
}
