export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Abstraction over the e-mail transport (SMTP in dev via Mailpit; SES/Resend/etc. later). */
export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export const SEND_MAIL_JOB = 'send-mail';
