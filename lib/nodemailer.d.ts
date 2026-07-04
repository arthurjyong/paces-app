// Minimal ambient types for nodemailer, which ships without TypeScript types.
// Declared locally instead of installing @types/nodemailer — nodemailer itself
// is the only new dependency the demo-access gate is allowed to add. Only the
// surface used by lib/demo.ts is declared.

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
  }

  export function createTransport(options: TransportOptions): Transporter;
}
