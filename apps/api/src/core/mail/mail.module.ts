import { Global, Module } from '@nestjs/common';
import { MailProcessor } from './mail.processor.js';
import { MailService } from './mail.service.js';
import { MAIL_PROVIDER } from './mail.types.js';
import { SmtpMailProvider } from './smtp-mail.provider.js';

@Global()
@Module({
  providers: [MailService, MailProcessor, { provide: MAIL_PROVIDER, useClass: SmtpMailProvider }],
  exports: [MailService],
})
export class MailModule {}
