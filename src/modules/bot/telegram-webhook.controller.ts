import {
  Body,
  Controller,
  Headers,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Env } from '../../config/env.schema';
import type { MessagingPort } from '../../ports/messaging.port';
import { MESSAGING_PORT } from '../../ports/messaging.port';
import { ConversationService } from './conversation.service';

/**
 * Webhook de Telegram (paralelo al de Kapso). Telegram no firma el body: si al
 * registrar el webhook (`setWebhook`) se pasó `secret_token`, lo reenvía en el header
 * `X-Telegram-Bot-Api-Secret-Token`. Validamos ese header contra TELEGRAM_WEBHOOK_SECRET.
 * Responde 200 rápido y procesa async (Telegram reintrega si tardás).
 */
@Controller('webhook/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);
  private readonly secret: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    private readonly conversation: ConversationService,
  ) {
    this.secret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true }) ?? '';
  }

  @Post()
  async handleWebhook(
    @Body() body: unknown,
    @Headers('x-telegram-bot-api-secret-token') token: string | undefined,
  ): Promise<string> {
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });

    if (this.secret) {
      if (!token || !this.safeEqual(token, this.secret)) {
        if (nodeEnv === 'production') {
          this.logger.warn('Invalid/missing Telegram secret token');
          throw new UnauthorizedException('Invalid secret token');
        }
        this.logger.warn('Invalid/missing Telegram secret token (dev mode: continuing)');
      }
    }

    try {
      const inbounds = this.messaging.parseWebhook(body);
      if (inbounds.length === 0) return 'OK';

      // Procesa async para responder 200 rápido.
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

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
