// GET /api/demo/status — is a demo session active on this browser?
//
// Reports {active} (+ a MASKED email) from the httpOnly demo_session cookie so
// the UI can show state — the cookie value, the full email, and the server key
// never appear in the payload. `active` is true only when the whole demo path
// would actually work: valid signed cookie, email still whitelisted, AND the
// server-held key configured (otherwise the UI would claim "no key needed"
// while /api/examiner still 401s).

import { NextResponse } from 'next/server';
import type { DemoStatus } from '@/lib/types';
import { maskEmail, readDemoSession } from '@/lib/demo';

export const runtime = 'nodejs';

export async function GET() {
  let body: DemoStatus = { active: false };
  if (process.env.DEMO_ANTHROPIC_API_KEY?.trim()) {
    const email = await readDemoSession();
    if (email) body = { active: true, email: maskEmail(email) };
  }
  return NextResponse.json(body);
}
