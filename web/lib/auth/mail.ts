// Outbound mail for magic-link sign-in, modeled on ~/Code/prospect/lib/mail.ts
// (same SMTP_URL / MAIL_FROM / MAIL_REPLY_TO shape, so the two apps can share
// one Resend account and sending domain). Scoped to lib/auth/ rather than a
// shared lib/mail.ts because this app has exactly one outbound mail today
// (the magic link) -- see NOTES-B19.md for what a future digest sender
// (web/scripts/digest.ts) should reuse from here.
//
// SMTP_URL unset: dev fallback prints the link to the server console (that
// IS how dev sign-in works -- Henry's rule: never mint a magic link for a
// real address in testing). Same condition in production is a
// misconfiguration -- log a fingerprint, never the link, since the log
// would otherwise hold a live sign-in credential.
import { createHash } from 'crypto';
import nodemailer from 'nodemailer';

const FROM_ADDR = process.env.MAIL_FROM || 'noreply@911records.nyc';
const FROM = FROM_ADDR.includes('<') ? FROM_ADDR : `9/11 City Records <${FROM_ADDR}>`;
const REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function fingerprint(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 12);
}

let transport: nodemailer.Transporter | null | undefined;

function getTransport(): nodemailer.Transporter | null {
  if (transport !== undefined) return transport;
  const url = process.env.SMTP_URL;
  transport = url ? nodemailer.createTransport(url) : null;
  return transport;
}

function magicLinkCopy(url: string): { subject: string; text: string; html: string } {
  const subject = 'Sign in to 9/11 City Records';
  const text = `Sign in to 9/11 City Records\n\n${url}\n\nThis link expires in an hour. If you did not request it, ignore this email -- no account will be created.\n`;
  const html = `<p>Sign in to <strong>9/11 City Records</strong>:</p><p><a href="${url}">${url}</a></p><p>This link expires in an hour. If you did not request it, ignore this email -- no account will be created.</p>`;
  return { subject, text, html };
}

/** Sends (or, with no SMTP configured, logs) the magic-link sign-in email. */
export async function sendMagicLinkMail(email: string, url: string): Promise<void> {
  const { subject, text, html } = magicLinkCopy(url);
  const t = getTransport();
  if (!t) {
    if (isProduction()) {
      console.error(
        `[auth/mail] SMTP_URL is unset on a production instance -- sign-in mail cannot be sent. ` +
          `to=sha256:${fingerprint(email)} subject=${JSON.stringify(subject)}. This is a total sign-in outage; set SMTP_URL.`,
      );
      return;
    }
    // Dev fallback: the printed link IS how you sign in locally. Never a
    // real address other than a +test alias you own (Henry's rule).
    console.log(`[auth/mail] (SMTP_URL unset; dev console transport) to=${email}\n${text}`);
    return;
  }
  try {
    const info = await t.sendMail({ from: FROM, to: email, subject, text, html, replyTo: REPLY_TO });
    console.log(`[auth/mail] sent to=sha256:${fingerprint(email)} id=${info.messageId}`);
  } catch (err) {
    console.error(`[auth/mail] send failed to=sha256:${fingerprint(email)}`, err);
  }
}
