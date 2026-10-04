import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config.service.js';
import type { MailMessage, MailProvider } from './mail.types.js';

@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly transporter: Transporter;

  constructor(private readonly config: AppConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      secure: false,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.config.get('SMTP_FROM'), ...message });
  }
}
