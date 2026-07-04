// Server-only demo-access gate: signed magic-link tokens, the demo_session
// cookie, whitelist checks, best-effort rate limiting, and sign-in email
// delivery. Nothing in this module may be imported by client components — it
// reads AUTH_SECRET and DEMO_ANTHROPIC_API_KEY (which must never reach the
// client in any form, mirroring invariant 2 for BYOK keys).
//
// Trust model (stateless — no DB): a token is
//   base64url(JSON{email, purpose, exp}) + '.' + base64url(HMAC-SHA256(AUTH_SECRET, payload))
// 'link' tokens (15 min) are emailed as magic links; 'session' tokens (30 days)
// live in an httpOnly cookie. The purposes are disjoint and checked on verify,
// so a captured session cookie can never be replayed through /api/demo/verify
// to mint fresh sessions (and a link token can't outlive its 15 minutes as a
// cookie). The whitelist is re-checked at every use, so removing an email from
// DEMO_WHITELIST revokes access immediately, outstanding cookies included.

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { createTransport } from 'nodemailer';

/** httpOnly cookie holding the signed 'session' token. */
export const DEMO_SESSION_COOKIE = 'demo_session';
/** Magic links are single-purpose and short-lived. */
export const LINK_TTL_MS = 15 * 60 * 1000;
/** Demo sessions last 30 days, then the user just requests a new link. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TokenPurpose = 'link' | 'session';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getWhitelist(): string[] {
  // Parsed per call (cheap) so env edits in dev apply without a restart.
  return (process.env.DEMO_WHITELIST ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Case-insensitive, trimmed membership test against DEMO_WHITELIST. */
export function isWhitelisted(email: string): boolean {
  return getWhitelist().includes(email.trim().toLowerCase());
}

/**
 * Demo mode exists only when fully configured: an HMAC secret to sign with, a
 * server-held key to spend, and at least one whitelisted email. Anything less
 * and every demo endpoint behaves as if the feature were absent (generic
 * responses only — never an error that reveals server configuration).
 */
export function demoModeEnabled(): boolean {
  return (
    Boolean(process.env.AUTH_SECRET) &&
    Boolean(process.env.DEMO_ANTHROPIC_API_KEY?.trim()) &&
    getWhitelist().length > 0
  );
}

/**
 * Base URL for SAME-ORIGIN REDIRECTS only: APP_BASE_URL if set, else the origin
 * the request arrived on. The request-derived fallback is safe here because
 * redirecting a sender back to the host their own request claimed affects
 * nobody else — but it is NOT safe for links we email (see magicLinkBaseUrl).
 */
export function appBaseUrl(request: Request): string {
  const env = process.env.APP_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

/**
 * Base URL for EMAILED magic links — security-sensitive, so it fails closed.
 * In production the request origin comes from the Host / x-forwarded-host
 * header, which the SENDER of the request controls: falling back to it would
 * let a non-whitelisted attacker request a link for a whitelisted victim with
 * a spoofed Host, so the victim's email carries a REAL link token pointing at
 * an attacker domain that harvests it (host-poisoning). Therefore: APP_BASE_URL
 * when set; the request origin only outside production (localhost dev flow);
 * otherwise null — the caller must skip sending. The generic 200 still goes
 * out either way, so this leaks nothing (misconfiguration is email-independent).
 */
export function magicLinkBaseUrl(request: Request): string | null {
  const env = process.env.APP_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, '');
  if (process.env.NODE_ENV !== 'production') return new URL(request.url).origin;
  console.error(
    '[demo] APP_BASE_URL is not set — sign-in link NOT generated (the request host is untrusted in production; set APP_BASE_URL)'
  );
  return null;
}

// ---------------------------------------------------------------------------
// Email normalisation / masking
// ---------------------------------------------------------------------------

/** Lowercased, trimmed email — or null if the input isn't a plausible address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** "consultant@example.com" -> "c***@example.com" (status display only). */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Signed tokens
// ---------------------------------------------------------------------------

function sign(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * Constant-time string equality. Both sides are hashed first so lengths always
 * match (timingSafeEqual throws on length mismatch, and the length itself must
 * not leak timing either).
 */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Signed token for `email`, or null when AUTH_SECRET is unset. */
export function createSignedToken(
  email: string,
  purpose: TokenPurpose,
  ttlMs: number
): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const payload = Buffer.from(
    JSON.stringify({ email, purpose, exp: Date.now() + ttlMs }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify signature (constant-time), purpose, and expiry; returns the embedded
 * email or null. Deliberately silent about WHY a token failed — callers must
 * respond generically (no detail leakage).
 */
export function verifySignedToken(token: unknown, purpose: TokenPurpose): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return null;
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(sign(payloadB64, secret), signature)) return null;

  let parsed: { email?: unknown; purpose?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed.purpose !== purpose) return null;
  if (typeof parsed.exp !== 'number' || Date.now() >= parsed.exp) return null;
  if (typeof parsed.email !== 'string' || !parsed.email) return null;
  return parsed.email;
}

// ---------------------------------------------------------------------------
// Demo session (the httpOnly cookie)
// ---------------------------------------------------------------------------

/**
 * Email of a valid demo session on the current request, or null. "Valid" =
 * signed, unexpired, AND still whitelisted (revocation by env edit works on
 * every request, not just at sign-in).
 */
export async function readDemoSession(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(DEMO_SESSION_COOKIE)?.value;
  if (!raw) return null;
  const email = verifySignedToken(raw, 'session');
  if (!email || !isWhitelisted(email)) return null;
  return email;
}

/**
 * The server-held demo key — released ONLY behind a valid demo session and only
 * to server code (it goes straight into the Anthropic SDK constructor, exactly
 * like a BYOK key, and must never appear in any client-visible payload, log,
 * or error).
 */
export async function getDemoApiKey(): Promise<string | null> {
  const serverKey = process.env.DEMO_ANTHROPIC_API_KEY?.trim();
  if (!serverKey) return null;
  return (await readDemoSession()) ? serverKey : null;
}

// ---------------------------------------------------------------------------
// Rate limiting (best-effort, in-memory)
// ---------------------------------------------------------------------------

/** 5 sends/hour per email is what actually bounds email volume per address. */
export const EMAIL_RATE_LIMIT = 5;
/**
 * The per-IP ceiling is deliberately looser: hospital NAT/proxies present many
 * users behind one IP, and 5/h shared would lock out colleagues invited at the
 * same site. x-forwarded-for is also spoofable unless the app is behind a
 * trusted proxy (Vercel sets it), so per-IP is a soft brake, not the bound.
 */
export const IP_RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map<string, number[]>();

/**
 * Best-effort in-memory rate limiter over a 1-hour rolling window. Checks
 * EVERY bucket first and consumes a slot in each only when all pass: a request
 * rejected by one bucket must not burn a slot in another (otherwise requests
 * that 429 on the IP bucket would still drain a victim email's allowance).
 * In-memory only, so serverless cold starts reset it — acceptable best-effort,
 * because tokens are unguessable and the generic response leaks nothing to
 * hammer for.
 */
export function rateLimitOk(entries: Array<{ key: string; limit: number }>): boolean {
  const now = Date.now();
  // Light sweep so a long-lived process can't grow the map unbounded.
  if (rateBuckets.size > 1000) {
    for (const [k, hits] of rateBuckets) {
      if (hits.every((t) => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  const live = entries.map(({ key }) =>
    (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  );
  // Persist the pruned windows whether or not the request is allowed.
  entries.forEach(({ key }, i) => rateBuckets.set(key, live[i]));
  if (entries.some(({ limit }, i) => live[i].length >= limit)) return false;
  for (const hits of live) hits.push(now);
  return true;
}

/** Best-effort client IP for rate limiting (first x-forwarded-for hop). */
export function requestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

// ---------------------------------------------------------------------------
// Magic-link email
// ---------------------------------------------------------------------------

/**
 * Send the magic link via SMTP. When SMTP is not configured in DEV, DO NOT
 * fail — log the link to the server console instead so the flow can be
 * exercised end-to-end. In PRODUCTION a missing/partial SMTP config logs a
 * loud error WITHOUT the link (a live 15-minute sign-in credential must never
 * land in deployment logs). Never throws: callers respond with the generic
 * message regardless of delivery outcome (anti-enumeration).
 */
export async function sendMagicLink(email: string, link: string): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || '587');
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    const partial = Boolean(host || user || pass);
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `[demo] SMTP ${partial ? 'PARTIALLY configured (some of SMTP_HOST/SMTP_USER/SMTP_PASS missing)' : 'not configured'} — sign-in link NOT sent to ${email} (link withheld from logs in production)`
      );
      return;
    }
    if (partial) {
      console.warn(
        '[demo] SMTP partially configured (some of SMTP_HOST/SMTP_USER/SMTP_PASS missing) — treating as unconfigured'
      );
    }
    console.log(`[demo] SMTP not configured — sign-in link for ${email}: ${link}`);
    return;
  }

  try {
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `"PACES Practice" <${user}>`,
      to: email,
      subject: 'Your PACES Practice sign-in link',
      text: `Hello,\n\nClick this link to sign in to PACES Practice (it works for 15 minutes):\n\n${link}\n\nAfter that you can practise straight away — no API key or account needed. If you did not request this email, just ignore it.\n`,
    });
  } catch (err) {
    // Delivery failed after the generic 200 already went out. Log the reason
    // (never the link — the address may be mistyped or hostile) and move on.
    console.error(
      '[demo] Failed to send sign-in email:',
      err instanceof Error ? err.message : 'unknown error'
    );
  }
}
