import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';

@Injectable()
export class KapsoClient {
  private readonly logger = new Logger(KapsoClient.name);
  private readonly baseUrl = 'https://api.kapso.ai/meta/whatsapp';
  private readonly apiKey: string;

  constructor(config: ConfigService<Env, true>) {
    this.apiKey = config.get('KAPSO_API_KEY', { infer: true }) ?? '';
    if (!this.apiKey) {
      throw new Error('KAPSO_API_KEY is required but not configured');
    }
  }

  async sendMessage(phoneNumberId: string, payload: unknown): Promise<{ messageId: string }> {
    const url = `${this.baseUrl}/v24.0/${phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Kapso API error ${res.status}: ${text}`);
      throw new Error(`Kapso API returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id ?? 'unknown';
    return { messageId };
  }
}
