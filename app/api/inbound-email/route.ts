// POST /api/inbound-email — Resend Inbound webhook receiver. Mail sent to
// @pacesbuddy.com (hello@, or anything else at the domain) lands at Resend,
// which fires email.received here; we fetch the content back from the Resend
// API and forward it to the maintainers' mailbox via SMTP.
//
// The endpoint is public, so nothing runs before the Svix signature check,
// and every response body is opaque (no configuration state leaks — same
// discipline as the auth routes). Status codes follow Svix retry semantics —
// ONLY 2xx stops redelivery, every other status is retried for ~28h — so:
// 2xx = done (including deliberately ignored or malformed-but-signed events,
// which will never improve on retry), 401 = unsigned (retries are harmless
// noise and eventually stop), 5xx = transient, retry me.

import { NextResponse } from 'next/server';
import {
  fetchReceivedEmail,
  forwardReceivedEmail,
  inboundConfigured,
  skipReason,
  verifySvixSignature,
} from '@/lib/inbound';

export const runtime = 'nodejs';
// The attachment chain (content fetch + up to 10 downloads + SMTP send) can
// legitimately take minutes on a large mail; don't let the platform default
// kill it mid-forward and strand the message in a retry loop.
export const maxDuration = 60;

/** The only body an unexpected failure may produce (generic by design). */
const UNAVAILABLE = { error: 'Temporarily unavailable' };

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error('[inbound] webhook failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json(UNAVAILABLE, { status: 500 });
  }
}

async function handle(request: Request) {
  if (!inboundConfigured()) {
    // 5xx so Svix keeps retrying through a mid-rollout config window; the
    // body is the same opaque string as any other failure.
    return NextResponse.json(UNAVAILABLE, { status: 503 });
  }

  const rawBody = await request.text();

  const verified = verifySvixSignature(
    rawBody,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    process.env.RESEND_INBOUND_WEBHOOK_SECRET!.trim()
  );
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Signed but nonsensical payloads are Resend-side anomalies that a retry
  // cannot fix — log loudly, acknowledge quietly.
  if (rawBody.length > 1024 * 1024) {
    console.error(`[inbound] ignoring oversized signed payload (${rawBody.length} chars)`);
    return NextResponse.json({ ignored: true });
  }
  let event: { type?: unknown; data?: { email_id?: unknown } } | null;
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    console.error('[inbound] ignoring signed payload with invalid JSON');
    return NextResponse.json({ ignored: true });
  }

  // Only email.received is subscribed; acknowledge anything else so Svix
  // doesn't retry events we will never act on.
  if (event?.type !== 'email.received') {
    return NextResponse.json({ ignored: true });
  }

  const emailId = event.data?.email_id;
  if (typeof emailId !== 'string' || !/^[0-9a-f-]{36}$/i.test(emailId)) {
    console.error('[inbound] ignoring event with malformed email_id');
    return NextResponse.json({ ignored: true });
  }

  const email = await fetchReceivedEmail(emailId);
  if (!email) {
    // Content not retrievable right now — let Svix retry.
    return NextResponse.json(UNAVAILABLE, { status: 500 });
  }

  const skip = skipReason(email);
  if (skip) {
    console.log(`[inbound] not forwarding ${emailId}: ${skip}`);
    return NextResponse.json({ ignored: true });
  }

  const forwarded = await forwardReceivedEmail(email, emailId);
  if (!forwarded) {
    return NextResponse.json(UNAVAILABLE, { status: 500 });
  }

  return NextResponse.json({ forwarded: true });
}
