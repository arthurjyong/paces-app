// POST /api/auth/verify — step 2 of the managed-door sign-in: the user types
// the emailed 6-digit code back.
//
// Trust model: every OTP failure mode (unknown email, wrong code, expired,
// attempts exhausted, already used, domain de-listed since request) collapses
// into ONE generic 400 — no oracle for which check failed. The checks
// themselves live in lib/managed.ts verifyOtp: attempt-limited BEFORE the
// hash comparison, single-use via a conditional consume, constant-time
// compare, eligibility re-checked from the database. Success mints the
// 30-day managed-session cookie: httpOnly (script-unreadable), sameSite lax,
// secure in production only (plain-http localhost must keep working). The
// session token rides ONLY in the Set-Cookie header — never in the JSON body
// — and the submitted code is never echoed or logged anywhere.

import { NextResponse } from 'next/server';
import type { ApiError, AuthVerifyResponse } from '@/lib/types';
import { MANAGED_SESSION_COOKIE, SESSION_TTL_MS, normalizeEmail, verifyOtp } from '@/lib/managed';

export const runtime = 'nodejs';

/** The only string an unexpected failure may produce (generic by design). */
const UNAVAILABLE_MESSAGE = 'Sign-in is temporarily unavailable — try again shortly';

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    // Unexpected throw (almost always the database). Log the reason
    // server-side; the client gets the fixed generic string only.
    console.error('[auth] verify failed:', err instanceof Error ? err.message : 'unknown error');
    return jsonError(UNAVAILABLE_MESSAGE, 503);
  }
}

async function handle(request: Request) {
  let body: { email?: unknown; code?: unknown } | null;
  try {
    body = (await request.json()) as { email?: unknown; code?: unknown } | null;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const email = normalizeEmail(body?.email);
  if (!email) {
    return jsonError('Enter a valid email address', 400);
  }
  // Trim only — verifyOtp enforces the exact 6-digit shape. A non-string
  // becomes '' and fails there, indistinguishable from a wrong code (a
  // malformed body must not produce a different signal than a bad guess).
  const code = typeof body?.code === 'string' ? body.code.trim() : '';

  const result = await verifyOtp(email, code);
  if (!result.ok) {
    if (result.reason === 'unavailable') {
      return jsonError(UNAVAILABLE_MESSAGE, 503);
    }
    // One string for every 'invalid' path — see the trust model above.
    return jsonError('That code is invalid or has expired — request a new one', 400);
  }

  // The body confirms success only; tier/allowance/models come from a
  // follow-up GET /api/auth/status (single source for session state).
  const ok: AuthVerifyResponse = { ok: true };
  const res = NextResponse.json(ok);
  res.cookies.set(MANAGED_SESSION_COOKIE, result.sessionToken, {
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
