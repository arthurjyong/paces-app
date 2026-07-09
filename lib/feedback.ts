// Server-only feedback intake ("Feedback" in the sidebar footer + "report an
// issue" on the marksheet). Anonymous by design — a report must never require
// an account — so every input is treated as hostile: manual validation, an
// in-memory per-IP brake, a durable global daily cap, and a honeypot handled
// at the route. Storage (Postgres) and notification (SMTP) are independent
// best-effort sinks; the submission succeeds if at least one of them is
// configured and the row/email landed.
//
// Nothing in this module may be imported by client components.

import { createTransport } from 'nodemailer';
import { dbConfigured, query, withTransaction } from './db';

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'case_content', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MESSAGE_MAX = 5000;

export interface FeedbackSubmission {
  category: FeedbackCategory;
  message: string;
  caseCode: string | null;
  replyEmail: string | null;
  /** Verified session email when signed in — server-derived, never client-supplied. */
  userEmail: string | null;
}

// ---------------------------------------------------------------------------
// Validation (manual, matching lib/managed.ts conventions — no schema library)
// ---------------------------------------------------------------------------

export function parseCategory(value: unknown): FeedbackCategory | null {
  return FEEDBACK_CATEGORIES.includes(value as FeedbackCategory) ? (value as FeedbackCategory) : null;
}

export function parseMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > FEEDBACK_MESSAGE_MAX) return null;
  return trimmed;
}

/** Case codes are the stable public identifiers ("c0421") shown in the picker. */
export function parseCaseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^c\d{4}$/.test(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// In-memory per-IP brake (best-effort, same shape as the OTP limiter; the
// durable bound is the global daily cap below)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60 * 60 * 1000;
const IP_SUBMIT_LIMIT = 5;
const rateBuckets = new Map<string, number[]>();

export function feedbackIpRateOk(ip: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 1000) {
    for (const [k, hits] of rateBuckets) {
      if (hits.every((t) => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  const live = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  rateBuckets.set(ip, live);
  if (live.length >= IP_SUBMIT_LIMIT) return false;
  live.push(now);
  return true;
}

/** Global daily ceiling on stored feedback (runaway/spam backstop). */
const FEEDBACK_GLOBAL_DAILY_CAP = 500;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type FeedbackStoreResult = 'stored' | 'rate_limited' | 'unavailable';

export async function storeFeedback(s: FeedbackSubmission): Promise<FeedbackStoreResult> {
  if (!dbConfigured()) return 'unavailable';
  // Count + insert under a fixed advisory lock — the same discipline as
  // requestOtp's global daily cap: a plain SELECT-count then INSERT races
  // across serverless instances and overshoots the cap.
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(918273646)');
    const recent = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM feedback WHERE created_at > now() - interval '1 day'"
    );
    if ((recent.rows[0]?.n ?? 0) >= FEEDBACK_GLOBAL_DAILY_CAP) return 'rate_limited';
    await client.query(
      'INSERT INTO feedback (category, message, case_code, reply_email, user_email) VALUES ($1, $2, $3, $4, $5)',
      [s.category, s.message, s.caseCode, s.replyEmail, s.userEmail]
    );
    return 'stored';
  });
}

// ---------------------------------------------------------------------------
// Email — a plain-text notification to the maintainers, and a fixed-text
// acknowledgement to the submitter. Plain text everywhere: the message body is
// untrusted, and text/plain removes the whole HTML-injection surface.
// ---------------------------------------------------------------------------

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS);
}

export function feedbackSinksAvailable(): boolean {
  return dbConfigured() || smtpConfigured();
}

function transporter() {
  return createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port: Number(process.env.SMTP_PORT?.trim() || '587'),
    secure: Number(process.env.SMTP_PORT?.trim() || '587') === 465,
    auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS! },
    // Bound every phase so a slow MX can't pin the serverless invocation.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
  });
}

function fromAddress(): string {
  return process.env.MAIL_FROM?.trim() || process.env.SMTP_USER!.trim();
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  idea: 'Idea',
  case_content: 'Case content',
  other: 'Other',
};

/**
 * Notify the maintainers. Destination comes from FEEDBACK_TO_EMAIL (env, not
 * code — the repo is public and the address is personal). Never throws.
 */
export async function sendFeedbackNotification(s: FeedbackSubmission): Promise<boolean> {
  const to = process.env.FEEDBACK_TO_EMAIL?.trim();
  if (!to || !smtpConfigured()) return false;
  try {
    await transporter().sendMail({
      from: `"PACES Buddy" <${fromAddress()}>`,
      to,
      subject: `[PACES Buddy] ${CATEGORY_LABELS[s.category]}${s.caseCode ? ` · ${s.caseCode}` : ''}`,
      text: [
        `Category: ${CATEGORY_LABELS[s.category]}`,
        s.caseCode ? `Case: ${s.caseCode}` : null,
        s.replyEmail ? `Reply to: ${s.replyEmail}` : null,
        s.userEmail ? `Signed in as: ${s.userEmail}` : 'Not signed in',
        '',
        s.message,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
    });
    return true;
  } catch (err) {
    console.error('[feedback] notification failed:', err instanceof Error ? err.message : 'unknown error');
    return false;
  }
}

/**
 * Fixed-text acknowledgement so the form doesn't feel like a black hole.
 * Deliberately contains NOTHING the submitter typed (an attacker must not be
 * able to relay arbitrary text to a victim address), and is capped per
 * address per day (durable) so the endpoint can't be used to nag a stranger.
 * FAILS CLOSED without the DB: the cap is what makes the send safe, and only
 * the DB can enforce it durably — no cap store, no ack. Never throws.
 */
export async function sendFeedbackAck(replyEmail: string): Promise<void> {
  if (!smtpConfigured() || !dbConfigured()) return;
  try {
    {
      const recent = await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM feedback WHERE reply_email = $1 AND created_at > now() - interval '1 day'",
        [replyEmail]
      );
      // The row for THIS submission is already inserted, so >1 means this
      // address already received an ack today.
      if ((recent.rows[0]?.n ?? 0) > 1) return;
    }
    await transporter().sendMail({
      from: `"PACES Buddy" <${fromAddress()}>`,
      to: replyEmail,
      subject: 'We received your PACES Buddy feedback',
      text: 'Thanks for helping make PACES Buddy better - your note has reached us and we read everything.\n\nIf it needs a reply, we will write back to this address.\n\nPACES Buddy - AI practice partner for MRCP PACES\nhttps://pacesbuddy.com\n',
    });
  } catch (err) {
    console.error('[feedback] ack failed:', err instanceof Error ? err.message : 'unknown error');
  }
}
