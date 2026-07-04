// POST /api/demo/request — step 1 of the demo-access magic-link flow.
//
// Anti-enumeration: the response is ALWAYS the same generic 200 with
// DEMO_REQUEST_MESSAGE, whether or not the email is whitelisted — and whether
// or not demo mode is configured at all. The whitelist branch does its work
// (token signing + email send) inside after(), so response timing cannot leak
// which branch ran either. The only non-200s are input/rate-limit errors that
// apply identically to every email.

import { NextResponse, after } from 'next/server';
import { DEMO_REQUEST_MESSAGE, type ApiError, type DemoRequestResponse } from '@/lib/types';
import {
  EMAIL_RATE_LIMIT,
  IP_RATE_LIMIT,
  LINK_TTL_MS,
  createSignedToken,
  demoModeEnabled,
  isWhitelisted,
  magicLinkBaseUrl,
  normalizeEmail,
  rateLimitOk,
  requestIp,
  sendMagicLink,
} from '@/lib/demo';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonError('Enter a valid email address', 400);
  }

  // Best-effort in-memory rate limit, applied BEFORE the whitelist check so a
  // 429 carries no membership signal. Both buckets are checked before either
  // consumes a slot (an IP-rejected burst must not drain the email allowance).
  // Anyone can still fill an email's bucket by posting that address — that is
  // the accepted price of anti-enumeration (counting only whitelisted emails
  // would turn the 429 threshold into a membership oracle). Cold starts reset
  // it — acceptable, because link tokens are unguessable HMACs regardless.
  const limits = [
    { key: `email:${email}`, limit: EMAIL_RATE_LIMIT },
    { key: `ip:${requestIp(request)}`, limit: IP_RATE_LIMIT },
  ];
  if (!rateLimitOk(limits)) {
    return jsonError('Too many sign-in requests — try again later', 429);
  }

  if (demoModeEnabled() && isWhitelisted(email)) {
    // Fails closed (null) in production when APP_BASE_URL is unset — never
    // build an emailed link from the attacker-controllable request host.
    const base = magicLinkBaseUrl(request);
    const token = base ? createSignedToken(email, 'link', LINK_TTL_MS) : null;
    if (base && token) {
      const link = `${base}/api/demo/verify?token=${encodeURIComponent(token)}`;
      // Sent after the response so delivery time can't distinguish this branch.
      // sendMagicLink never throws, and logs the link instead when SMTP is unset.
      after(() => sendMagicLink(email, link));
    }
  }

  const responseBody: DemoRequestResponse = { message: DEMO_REQUEST_MESSAGE };
  return NextResponse.json(responseBody);
}
