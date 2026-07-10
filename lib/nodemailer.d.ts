// Minimal ambient types for nodemailer, which ships without TypeScript types.
// Declared locally instead of installing @types/nodemailer. Only the surface
// used by lib/managed.ts, lib/feedback.ts, and lib/inbound.ts is declared.

declare module 'nodemailer' {
  export interface MailAttachment {
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }

  export interface SendMailOptions {
    from?: string;
    to: string;
    /** Where a reply should go when it differs from `from` (e.g. forwarded mail). */
    replyTo?: string;
    subject: string;
    text: string;
    /** HTML body; clients that don't render it fall back to `text`. */
    html?: string;
    attachments?: MailAttachment[];
    /** Extra top-level headers (e.g. Auto-Submitted); nodemailer CRLF-strips values. */
    headers?: Record<string, string>;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>;
  }

  export interface TransportOptions {
    host: string;
    port: number;
    /** true for implicit TLS (port 465); false = STARTTLS upgrade (port 587). */
    secure?: boolean;
    auth?: { user: string; pass: string };
    /** ms to establish the TCP connection before giving up. */
    connectionTimeout?: number;
    /** ms to wait for the SMTP greeting after connecting. */
    greetingTimeout?: number;
    /** ms of socket inactivity before the send is aborted. */
    socketTimeout?: number;
  }

  export function createTransport(options: TransportOptions): Transporter;
}
