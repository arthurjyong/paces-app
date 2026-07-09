// Minimal ambient types for nodemailer, which ships without TypeScript types.
// Declared locally instead of installing @types/nodemailer. Only the surface
// used by lib/managed.ts (the managed-tier sign-in code email) is declared.

declare module 'nodemailer' {
  export interface SendMailOptions {
    from?: string;
    to: string;
    subject: string;
    text: string;
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
