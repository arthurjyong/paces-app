// Server-only inbound-mail forwarding (hello@pacesbuddy.com → the maintainers'
// mailbox). Resend Inbound receives mail for the domain and fires an
// email.received webhook carrying METADATA ONLY; the body and attachments are
// fetched back from the Resend API, then re-sent through the app's own SMTP
// transport with Reply-To = the original sender, so replying from the
// destination mailbox goes straight back to whoever wrote in.
//
// Trust model: the webhook endpoint is public, so nothing is processed until
// the Svix signature (Resend's webhook signer) verifies against
// RESEND_INBOUND_WEBHOOK_SECRET. The Resend API key used to fetch content
// (RESEND_API_KEY, full access) never leaves the server. The SENDER of the
// inbound mail is an arbitrary stranger: their subject/body/attachments are
// forwarded with visible provenance in BOTH the text and HTML parts, and the
// forward path defends against mail loops (below).
//
// Loop defence (review 2026-07-10): (1) a forward destination at the inbound
// domain is treated as NOT CONFIGURED — mail to the domain must never be
// re-sent into the domain; (2) mail from the domain itself, from null/daemon
// senders, from our own MAIL_FROM, or already marked auto-submitted/forwarded
// is acknowledged but not forwarded; (3) every forward carries
// Auto-Submitted / X-Auto-Response-Suppress / X-PacesBuddy-Forwarded headers
// so autoresponders stay quiet and re-entry is detectable.
//
// Nothing in this module may be imported by client components.

import crypto from 'crypto';
import { createTransport } from 'nodemailer';

// ---------------------------------------------------------------------------
// Svix signature verification (manual — no svix dependency). Scheme:
// base64(HMAC-SHA256(base64decode(secret), `${id}.${timestamp}.${rawBody}`))
// compared against the space-separated "v1,<sig>" entries in svix-signature.
// ---------------------------------------------------------------------------

const TIMESTAMP_TOLERANCE_S = 5 * 60;

export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string
): boolean {
  // Requests without svix headers are random internet probes — fail silently.
  // Requests WITH them that still fail are logged with non-secret diagnostics
  // (which check failed, lengths, timestamp delta) — a misconfigured signing
  // secret would otherwise be indistinguishable from probe noise.
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const fail = (reason: string): false => {
    console.error(`[inbound] signature check failed: ${reason} (id=${headers.id}, sigLen=${headers.signature?.length})`);
    return false;
  };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return fail('non-numeric timestamp');
  const delta = Math.abs(Date.now() / 1000 - ts);
  if (delta > TIMESTAMP_TOLERANCE_S) return fail(`timestamp delta ${Math.round(delta)}s`);
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch {
    return fail('secret not base64-decodable');
  }
  if (key.length === 0) return fail('empty decoded secret');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();
  let sawV1 = false;
  for (const entry of headers.signature.split(' ')) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    sawV1 = true;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return fail(sawV1 ? `HMAC mismatch (keyLen=${key.length}, bodyLen=${rawBody.length})` : 'no v1 entry in signature header');
}

// ---------------------------------------------------------------------------
// Resend Receiving API
// ---------------------------------------------------------------------------

interface ReceivedEmail {
  from: string;
  to: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers?: Record<string, string>;
  attachments?: Array<{ id: string; filename: string; content_type: string; size?: number }>;
}

const RESEND_API = 'https://api.resend.com';

async function resendGet(path: string): Promise<Response> {
  return fetch(`${RESEND_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}` },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const res = await resendGet(`/emails/receiving/${emailId}`);
  if (!res.ok) {
    console.error(`[inbound] content fetch failed: ${res.status}`);
    return null;
  }
  return (await res.json()) as ReceivedEmail;
}

/**
 * Download attachments for forwarding, bounded in BOTH bytes and count — a
 * serverless invocation must not buffer arbitrary volumes or make unbounded
 * sequential round-trips. Oversize/overflow/failed attachments are skipped
 * and reported by name in the forwarded provenance (the original stays
 * retrievable in the Resend dashboard).
 */
const ATTACHMENT_BUDGET_BYTES = 15 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 10;

export async function downloadAttachments(
  emailId: string,
  attachments: ReceivedEmail['attachments']
): Promise<{ forwarded: Array<{ filename: string; content: Buffer; contentType: string }>; skipped: string[] }> {
  const all = attachments ?? [];
  const forwarded: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  const skipped: string[] = all.slice(ATTACHMENT_MAX_COUNT).map((a) => a.filename);
  let budget = ATTACHMENT_BUDGET_BYTES;
  for (const att of all.slice(0, ATTACHMENT_MAX_COUNT)) {
    try {
      if (att.size !== undefined && att.size > budget) {
        skipped.push(att.filename);
        continue;
      }
      const meta = await resendGet(`/emails/receiving/${emailId}/attachments/${att.id}`);
      if (!meta.ok) {
        skipped.push(att.filename);
        continue;
      }
      const { download_url: url } = (await meta.json()) as { download_url?: string };
      if (!url) {
        skipped.push(att.filename);
        continue;
      }
      const file = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!file.ok) {
        skipped.push(att.filename);
        continue;
      }
      const content = Buffer.from(await file.arrayBuffer());
      if (content.length > budget) {
        skipped.push(att.filename);
        continue;
      }
      budget -= content.length;
      forwarded.push({ filename: att.filename, content, contentType: att.content_type });
    } catch {
      skipped.push(att.filename);
    }
  }
  return { forwarded, skipped };
}

// ---------------------------------------------------------------------------
// Loop defence
// ---------------------------------------------------------------------------

function forwardDestination(): string {
  return (process.env.INBOUND_FORWARD_TO?.trim() || process.env.FEEDBACK_TO_EMAIL?.trim() || '').toLowerCase();
}

/** The domain Resend Inbound receives for — derived from MAIL_FROM (noreply@<domain>). */
function inboundDomain(): string {
  const from = process.env.MAIL_FROM?.trim().toLowerCase() ?? '';
  const at = from.lastIndexOf('@');
  return at >= 0 ? from.slice(at + 1) : '';
}

const FORWARDED_MARKER_HEADER = 'x-pacesbuddy-forwarded';
const DAEMON_SENDERS = /^(mailer-daemon|postmaster|no-?reply|bounce|double-bounce)@/i;

/**
 * Reason NOT to forward this message, or null to proceed. Skipped mail is
 * acknowledged to Svix (2xx) — it is deliberate, not a failure.
 */
export function skipReason(email: ReceivedEmail): string | null {
  const from = (email.from ?? '').trim().toLowerCase();
  const domain = inboundDomain();
  if (!from || from === '<>') return 'null sender (bounce)';
  if (DAEMON_SENDERS.test(from)) return 'daemon/no-reply sender';
  const mailFrom = process.env.MAIL_FROM?.trim().toLowerCase();
  if (mailFrom && from.includes(mailFrom)) return 'own MAIL_FROM (would echo)';
  if (domain && from.endsWith(`@${domain}`)) return 'sender at the inbound domain (would loop)';
  for (const [k, v] of Object.entries(email.headers ?? {})) {
    const key = k.toLowerCase();
    if (key === FORWARDED_MARKER_HEADER) return 'already forwarded by us (re-entry)';
    if (key === 'auto-submitted' && v.trim().toLowerCase() !== 'no') return 'auto-submitted mail';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The forward itself — via the app's own SMTP transport (same shape as
// lib/managed.ts / lib/feedback.ts).
// ---------------------------------------------------------------------------

export function inboundConfigured(): boolean {
  const destination = forwardDestination();
  const domain = inboundDomain();
  // A destination at the inbound domain is a guaranteed infinite loop
  // (forward → Resend Inbound → webhook → forward…) — refuse to run at all.
  if (destination && domain && destination.endsWith(`@${domain}`)) {
    console.error('[inbound] forward destination is at the inbound domain — refusing (mail loop)');
    return false;
  }
  return Boolean(
    process.env.RESEND_INBOUND_WEBHOOK_SECRET?.trim() &&
      process.env.RESEND_API_KEY?.trim() &&
      destination &&
      process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function forwardReceivedEmail(email: ReceivedEmail, emailId: string): Promise<boolean> {
  const to = forwardDestination();
  const { forwarded, skipped } = await downloadAttachments(emailId, email.attachments);

  // Provenance must be visible in EVERY rendering — the forward arrives from
  // the app's own trusted address, so without it, attacker mail is laundered
  // as first-party. Text gets a footer; HTML gets an escaped banner on top;
  // the subject is prefixed for both.
  const provenance = `Forwarded external mail — originally from ${email.from} to ${email.to.join(', ')}.`;
  const skippedNote = skipped.length
    ? `Attachments not forwarded (view in Resend): ${skipped.join(', ')}`
    : null;
  const textFooter = ['', '----', provenance, skippedNote].filter((l): l is string => l !== null);
  const htmlBanner =
    `<div style="border:1px solid #d4d4d8;background:#fafafa;color:#52525b;padding:8px 12px;margin-bottom:12px;font:13px/1.5 sans-serif;">` +
    escapeHtml(provenance) +
    (skippedNote ? `<br>${escapeHtml(skippedNote)}` : '') +
    `</div>`;

  try {
    const port = Number(process.env.SMTP_PORT?.trim() || '587');
    const transporter = createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS! },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 15_000,
    });
    await transporter.sendMail({
      from: `"PACES Buddy Mail" <${process.env.MAIL_FROM?.trim() || process.env.SMTP_USER!.trim()}>`,
      to,
      replyTo: email.from,
      subject: `[pacesbuddy.com] ${email.subject || '(no subject)'}`,
      // Mark the forward machine-generated: autoresponders stay quiet, and a
      // re-entering copy is recognised by skipReason() instead of looping.
      headers: {
        'Auto-Submitted': 'auto-forwarded',
        'X-Auto-Response-Suppress': 'All',
        'X-PacesBuddy-Forwarded': emailId,
      },
      text: (email.text ?? '(no text body)') + '\n' + textFooter.join('\n'),
      // Inline images arrive as data: URIs (Resend's default html_format).
      html: email.html ? htmlBanner + email.html : undefined,
      attachments: forwarded.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return true;
  } catch (err) {
    console.error('[inbound] forward failed:', err instanceof Error ? err.message : 'unknown error');
    return false;
  }
}
