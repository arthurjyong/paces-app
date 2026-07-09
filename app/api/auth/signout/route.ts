// POST /api/auth/signout — clear the managed-session cookie on this browser.
//
// The session token is stateless (HMAC-signed, no server-side session row —
// see lib/managed.ts), so "signing out" is purely client-side state: the
// cookie is overwritten empty with maxAge 0 under the same attributes it was
// set with, and the browser discards it immediately. Idempotent — a browser
// without the cookie gets the same 200. No body is read, no database is
// touched, and the response carries no session material. (Server-side
// revocation is separate: removing the domain/override row deactivates the
// account on next use regardless of any cookie.)

import { NextResponse } from 'next/server';
import { MANAGED_SESSION_COOKIE } from '@/lib/managed';

export const runtime = 'nodejs';

/** The only string an unexpected failure may produce (generic by design). */
const UNAVAILABLE_MESSAGE = 'Sign-in is temporarily unavailable — try again shortly';

export async function POST() {
  try {
    const res = NextResponse.json({ ok: true });
    // Same attributes as /api/auth/verify set it with — a Set-Cookie only
    // replaces the stored cookie when name + path (+ flags) match.
    res.cookies.set(MANAGED_SESSION_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch {
    // Nothing above should be able to throw; kept for the fixed-generic-error
    // guarantee every auth route makes.
    return NextResponse.json({ error: UNAVAILABLE_MESSAGE }, { status: 503 });
  }
}
