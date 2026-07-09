// POST /api/feedback — anonymous in-app feedback (bugs, ideas, case-content
// corrections). No account required, so the endpoint assumes abuse: honeypot
// field (silent fake success), per-IP in-memory brake, durable global daily
// cap, and hard length bounds. The signed-in email, when present, is derived
// from the verified session server-side — never trusted from the body. Every
// unexpected failure collapses to ONE fixed generic 503 (same discipline as
// the auth routes).

import { NextResponse } from 'next/server';
import type { ApiError } from '@/lib/types';
import { normalizeEmail, readManagedSession, requestIp } from '@/lib/managed';
import {
  feedbackIpRateOk,
  feedbackSinksAvailable,
  parseCaseCode,
  parseCategory,
  parseMessage,
  sendFeedbackAck,
  sendFeedbackNotification,
  storeFeedback,
  FEEDBACK_MESSAGE_MAX,
  type FeedbackSubmission,
} from '@/lib/feedback';

export const runtime = 'nodejs';

/** The only string an unexpected failure may produce (generic by design). */
const UNAVAILABLE_MESSAGE = 'Feedback is temporarily unavailable — try again shortly';

const RECEIVED = {
  status: 'received' as const,
  message: 'Thanks — your feedback has reached us. We read everything.',
};

function jsonError(message: string, status: number) {
  const body: ApiError = { error: message };
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error('[feedback] submit failed:', err instanceof Error ? err.message : 'unknown error');
    return jsonError(UNAVAILABLE_MESSAGE, 503);
  }
}

async function handle(request: Request) {
  if (!feedbackSinksAvailable()) return jsonError(UNAVAILABLE_MESSAGE, 503);

  let body: {
    category?: unknown;
    message?: unknown;
    caseCode?: unknown;
    replyEmail?: unknown;
    website?: unknown;
  } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  // Honeypot: humans never see the field; a filled value gets a success
  // indistinguishable from the real one, and nothing is stored or sent.
  if (typeof body?.website === 'string' && body.website.length > 0) {
    return NextResponse.json(RECEIVED);
  }

  const category = parseCategory(body?.category);
  if (!category) return jsonError('Choose a category', 400);

  const message = parseMessage(body?.message);
  if (!message) {
    return jsonError(`Write a short message first (up to ${FEEDBACK_MESSAGE_MAX} characters)`, 400);
  }

  // Optional fields: a malformed value is rejected rather than silently
  // dropped, so a typo'd reply address doesn't vanish into the void.
  let caseCode: string | null = null;
  if (body?.caseCode !== undefined && body?.caseCode !== null && body?.caseCode !== '') {
    caseCode = parseCaseCode(body.caseCode);
    if (!caseCode) return jsonError('That case code does not look right', 400);
  }
  let replyEmail: string | null = null;
  if (body?.replyEmail !== undefined && body?.replyEmail !== null && body?.replyEmail !== '') {
    replyEmail = normalizeEmail(body.replyEmail);
    if (!replyEmail) return jsonError('That reply email does not look valid', 400);
  }

  if (!feedbackIpRateOk(requestIp(request))) {
    return jsonError('Too much feedback from this connection — try again later', 429);
  }

  const session = await readManagedSession();
  const submission: FeedbackSubmission = {
    category,
    message,
    caseCode,
    replyEmail,
    userEmail: session?.email ?? null,
  };

  const stored = await storeFeedback(submission);
  if (stored === 'rate_limited') {
    return jsonError('Feedback is paused for today — try again tomorrow', 429);
  }

  const notified = await sendFeedbackNotification(submission);
  if (stored !== 'stored' && !notified) {
    // Neither sink accepted it — don't pretend otherwise.
    return jsonError(UNAVAILABLE_MESSAGE, 503);
  }

  if (replyEmail) await sendFeedbackAck(replyEmail);

  return NextResponse.json(RECEIVED);
}
