// GET /api/demo/verify?token= — step 2 of the demo-access magic-link flow.
//
// The token signature is checked in constant time, expiry is enforced, and the
// email must STILL be in DEMO_WHITELIST at verify time (a link requested before
// a whitelist edit must not sign in after it). Success sets the httpOnly
// demo_session cookie (a second signed token, purpose 'session', 30 days) and
// redirects to /?demo=active. EVERY failure redirects to /?demo=invalid — no
// detail about which check failed leaks to the caller.

import { NextResponse } from 'next/server';
import {
  DEMO_SESSION_COOKIE,
  SESSION_TTL_MS,
  appBaseUrl,
  createSignedToken,
  demoModeEnabled,
  isWhitelisted,
  verifySignedToken,
} from '@/lib/demo';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const base = appBaseUrl(request);
  const token = new URL(request.url).searchParams.get('token');

  // Purpose 'link' only: a captured demo_session cookie value must not be
  // replayable here to mint fresh sessions (see lib/demo.ts trust model).
  const email = demoModeEnabled() ? verifySignedToken(token, 'link') : null;
  if (!email || !isWhitelisted(email)) {
    return NextResponse.redirect(new URL('/?demo=invalid', base));
  }

  const session = createSignedToken(email, 'session', SESSION_TTL_MS);
  if (!session) {
    return NextResponse.redirect(new URL('/?demo=invalid', base));
  }

  const res = NextResponse.redirect(new URL('/?demo=active', base));
  res.cookies.set(DEMO_SESSION_COOKIE, session, {
    httpOnly: true,
    // Secure would make curl/browsers drop the cookie on plain-http localhost;
    // production (Vercel) is always https.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
