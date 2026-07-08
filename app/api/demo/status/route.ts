// GET /api/demo/status — is a demo session active on this browser?
//
// Reports {active} (+ a MASKED email, + the providers the server-held keys
// cover) from the httpOnly demo_session cookie so the UI can show state — the
// cookie value, the full email, and the server keys never appear in the
// payload. `active` is true only when the whole demo path would actually work:
// valid signed cookie, email still whitelisted, AND at least one server-held
// key configured (otherwise the UI would claim "no key needed" while
// /api/examiner still 401s). The provider list is revealed only to an
// authenticated session, and describes server configuration, never case content.

import { NextResponse } from 'next/server';
import type { DemoStatus } from '@/lib/types';
import { maskEmail, readDemoSession } from '@/lib/demo';
import { demoProviders } from '@/lib/providers';

export const runtime = 'nodejs';

export async function GET() {
  let body: DemoStatus = { active: false };
  const providers = demoProviders();
  if (providers.length > 0) {
    const email = await readDemoSession();
    if (email) body = { active: true, email: maskEmail(email), providers };
  }
  return NextResponse.json(body);
}
