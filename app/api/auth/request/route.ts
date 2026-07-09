// POST /api/auth/request — step 1 of the managed-door sign-in (email +
// 6-digit OTP; Phase 1, replacing the demo magic-link flow).
//
// Trust model: domain ELIGIBILITY is public product behaviour (the UI
// documents which providers qualify), so the response may distinguish 'sent'
// (eligible domain — a code is on its way) from 'byok_only' (on neither
// allow-list — use your own key). Whether an ACCOUNT exists is never
// revealed: requestOtp emails any address on an eligible domain, existing
// user or not, so 'sent' carries no membership signal. Send rate is limited
// per IP (in-memory, best-effort) and per email (durable, in Postgres) inside
// requestOtp, before any email leaves. Every unexpected failure — DB outage,
// driver throw — collapses to ONE fixed generic 503: no stack, driver
// message, or configuration detail ever reaches the client.

import { NextResponse } from 'next/server';
import type { ApiError, AuthRequestResponse } from '@/lib/types';
import { normalizeEmail, requestIp, requestOtp } from '@/lib/managed';

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
    console.error('[auth] request failed:', err instanceof Error ? err.message : 'unknown error');
    return jsonError(UNAVAILABLE_MESSAGE, 503);
  }
}

async function handle(request: Request) {
  let body: { email?: unknown } | null;
  try {
    body = (await request.json()) as { email?: unknown } | null;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const email = normalizeEmail(body?.email);
  if (!email) {
    return jsonError('Enter a valid email address', 400);
  }

  const result = await requestOtp(email, requestIp(request));
  switch (result) {
    case 'sent': {
      const ok: AuthRequestResponse = {
        status: 'sent',
        message:
          'We emailed you a 6-digit sign-in code — it works for 10 minutes. Check spam if it does not arrive.',
      };
      return NextResponse.json(ok);
    }
    case 'byok_only': {
      const ok: AuthRequestResponse = {
        status: 'byok_only',
        message:
          'Managed access covers major consumer email providers and approved SG-healthcare institutions. This address is not on either list — you can still practise free by adding your own API key in Settings.',
      };
      return NextResponse.json(ok);
    }
    case 'rate_limited':
      return jsonError('Too many sign-in codes requested — try again later', 429);
    case 'unavailable':
      // The managed door is not (fully) configured — same generic string as an
      // unexpected throw, so the response never maps server configuration.
      return jsonError(UNAVAILABLE_MESSAGE, 503);
  }
}
