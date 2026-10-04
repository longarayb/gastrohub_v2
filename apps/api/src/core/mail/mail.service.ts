import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { BRAND } from '@app/shared';
import type { Queue } from 'bullmq';
import { AppConfig } from '../config/app-config.service.js';
import { QUEUES } from '../queue/queue.constants.js';
import { SEND_MAIL_JOB, type MailMessage } from './mail.types.js';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PRIMARY = BRAND.colors.primaryHex;

/** Builds and enqueues transactional e-mails (sent by `MailProcessor`). */
@Injectable()
export class MailService {
  constructor(
    @InjectQueue(QUEUES.NOTIFICATIONS) private readonly queue: Queue,
    private readonly config: AppConfig,
  ) {}

  private get appName(): string {
    return this.config.get('APP_NAME');
  }

  private layout(title: string, body: string): string {
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f5f4;font-family:Arial,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;padding:32px">
<div style="font-size:20px;font-weight:bold;color:${PRIMARY};margin-bottom:16px">${escapeHtml(this.appName)}</div>
<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}
<p style="color:#78716c;font-size:12px;margin-top:32px">Este é um e-mail automático. Não responda.</p>
</div></body></html>`;
  }

  async enqueue(message: MailMessage): Promise<void> {
    await this.queue.add(SEND_MAIL_JOB, message);
  }

  async sendPasswordReset(to: string, name: string, link: string): Promise<void> {
    const html = this.layout(
      'Redefinição de senha',
      `<p>Olá, ${escapeHtml(name)}!</p>
<p>Recebemos um pedido para redefinir sua senha. O link é válido por 1 hora.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:${PRIMARY};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Redefinir senha</a></p>
<p style="font-size:13px;color:#57534e">Se você não fez esse pedido, ignore este e-mail.</p>`,
    );
    const text = `Olá, ${name}!\n\nPara redefinir sua senha, acesse: ${link}\n\nO link é válido por 1 hora. Se você não fez esse pedido, ignore este e-mail.`;
    await this.enqueue({ to, subject: `Redefinição de senha — ${this.appName}`, html, text });
  }
}
