import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from '../queue/queue.constants.js';
import { MAIL_PROVIDER, SEND_MAIL_JOB, type MailMessage, type MailProvider } from './mail.types.js';

@Processor(QUEUES.NOTIFICATIONS)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(@Inject(MAIL_PROVIDER) private readonly provider: MailProvider) {
    super();
  }

  async process(job: Job<MailMessage>): Promise<void> {
    if (job.name !== SEND_MAIL_JOB) return;
    await this.provider.send(job.data);
    this.logger.log({ to: job.data.to, subject: job.data.subject }, 'E-mail enviado');
  }
}
