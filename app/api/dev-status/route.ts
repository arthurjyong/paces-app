// GET /api/dev-status — dev-only capability probe so the client can unlock the
// keyless UI when the local `claude -p` subscription bridge is active (see
// lib/devCli.ts). In any non-development environment this route 404s
// (mirroring invariant 5's dryRun gate), so production payloads are unchanged.

import { NextResponse } from 'next/server';
import { devCliEnabled } from '@/lib/devCli';

export const runtime = 'nodejs';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ cliBridge: devCliEnabled() });
}
