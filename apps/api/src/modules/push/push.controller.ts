import { Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { pushSubscriptionSchema, pushUnsubscribeSchema } from '@app/shared';
import { z } from 'zod';
import { AllowedInDemo } from '../../core/demo/demo-mode.js';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { PushService } from './push.service.js';

/** Web Push of the signed-in user (D049). */
@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('config')
  @ApiOperation({ summary: 'Chave pública VAPID (null = push desligado neste servidor)' })
  config() {
    return this.push.config();
  }

  @Post('subscriptions')
  @HttpCode(204)
  @ApiZodBody(pushSubscriptionSchema)
  async subscribe(
    @ZBody(pushSubscriptionSchema) body: z.output<typeof pushSubscriptionSchema>,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.push.subscribe(body, userAgent ?? null);
  }

  // Turning one's own notices off is not registration data (D045).
  @AllowedInDemo()
  @Delete('subscriptions')
  @HttpCode(204)
  @ApiZodBody(pushUnsubscribeSchema)
  async unsubscribe(@ZBody(pushUnsubscribeSchema) body: z.output<typeof pushUnsubscribeSchema>) {
    await this.push.unsubscribe(body.endpoint);
  }
}
