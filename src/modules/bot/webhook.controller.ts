import {
  Body,
  Controller,
  Headers,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Env } from '../../config/env.schema';
import type { MessagingPort } from '../../ports/messaging.port';
import { MESSAGING_PORT } from '../../ports/messaging.port';
import { ConversationService } from './conversation.service';

@Controller('webhook/kapso')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly secret: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
  ) {
    this.secret = this.config.get('KAPSO_WEBHOOK_SECRET', { infer: true }) ?? '';
  }

  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Body() parsedBody: unknown,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-event') event: string | undefined,
  ): Promise<string> {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    const rawBody = req.rawBody;

    // Verify signature against the raw payload (Kapso firma el JSON crudo).
    if (this.secret && signature) {
      const isValid = rawBody ? this.verifySignature(rawBody, signature) : false;
      if (!isValid) {
        if (nodeEnv === 'production') {
          this.logger.warn('Invalid webhook signature');
          throw new UnauthorizedException('Invalid signature');
        }
        this.logger.warn('Invalid webhook signature (dev mode: continuing)');
      }
    } else if (this.secret && !signature) {
      if (nodeEnv === 'production') {
        this.logger.warn('Webhook secret configured but no signature received');
        throw new UnauthorizedException('Missing signature');
      }
      this.logger.warn('Missing webhook signature (dev mode: continuing)');
    }

    if (event !== 'whatsapp.message.received') {
      return 'OK';
    }

    try {
      const inbounds = this.messaging.parseWebhook(parsedBody);
      if (inbounds.length === 0) {
        this.logger.debug('Webhook had no actionable inbound messages');
        return 'OK';
      }

      // Procesa asincrónicamente para responder 200 rápido (Kapso exige <10s).
      for (const inbound of inbounds) {
        if (!inbound.phoneNumber) continue;
        this.conversation.processInbound(inbound).catch((err) => {
          this.logger.error(`Failed to process inbound: ${(err as Error).message}`);
        });
      }

      return 'OK';
    } catch (err) {
      this.logger.error(`Webhook processing error: ${(err as Error).message}`);
      return 'OK';
    }
  }

  private verifySignature(rawBody: Buffer, signature: string): boolean {
    try {
      const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
      const expectedBuf = Buffer.from(expected);
      const receivedBuf = Buffer.from(signature);
      if (expectedBuf.length !== receivedBuf.length) return false;
      return timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      return false;
    }
  }
}
