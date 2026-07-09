// DELETE /api/history/[id] — tombstone one of the signed-in user's history
// records so the delete propagates across devices. [id] is the URL-encoded
// client record id. Session-gated; the user only touches their own rows.

import { NextResponse } from 'next/server';
import type { ApiError } from '@/lib/types';
import { readManagedSession } from '@/lib/managed';
import { tombstoneRecord } from '@/lib/history';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await readManagedSession();
    if (!session) return jsonError('Not signed in', 401);
    const { id } = await params;
    if (typeof id !== 'string' || id.length === 0 || id.length > 400) {
      return jsonError('Invalid record id', 400);
    }
    await tombstoneRecord(session.sub, id);
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError('Could not delete history — try again', 503);
  }
}
