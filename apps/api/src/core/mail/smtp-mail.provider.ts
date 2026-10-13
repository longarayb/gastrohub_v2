import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config.service.js';
import type { MailMessage, MailProvider } from './mail.types.js';

@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly transporter: Transporter;

  constructor(private readonly config: AppConfig) {
    const tls = config.get('SMTP_TLS');
    const user = config.get('SMTP_USER');
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      // tls: encrypted from the start (465); starttls: upgrade required (587, e.g. Brevo).
      secure: tls === 'tls',
      requireTLS: tls === 'starttls',
      ignoreTLS: tls === 'none',
      auth: user ? { user, pass: config.get('SMTP_PASSWORD') } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: { name: this.config.get('APP_NAME'), address: this.config.get('MAIL_FROM_ADDRESS') },
      ...message,
    });
  }
}
