import { Injectable } from '@nestjs/common';
import type {
  InboundMessage,
  ListSection,
  MessagingPort,
  OutboundMessage,
} from '../../../ports/messaging.port';
import { KapsoClient } from './kapso.client';

@Injectable()
export class KapsoAdapter implements MessagingPort {
  constructor(private readonly client: KapsoClient) {}

  async send(message: OutboundMessage): Promise<{ messageId: string }> {
    const payload = this.buildPayload(message);
    return this.client.sendMessage(message.phoneNumberId, payload);
  }

  // Kapso v2 webhook payload (flat — no `event`/`data` envelope).
  // Single event:  { message, conversation, phone_number_id, is_new_conversation }
  // Batched event: { batch: true, data: [<event>, ...], batch_info: {...} }
  parseWebhook(raw: unknown): InboundMessage[] {
    const body = (raw ?? {}) as Record<string, unknown>;

    if (body.batch === true && Array.isArray(body.data)) {
      return (body.data as unknown[])
        .map((item) => this.parseSingleEvent(item))
        .filter((m): m is InboundMessage => m !== null);
    }

    const single = this.parseSingleEvent(body);
    return single ? [single] : [];
  }

  private parseSingleEvent(raw: unknown): InboundMessage | null {
    const body = (raw ?? {}) as Record<string, unknown>;
    const msg = (body.message ?? {}) as Record<string, unknown>;
    const conv = (body.conversation ?? {}) as Record<string, unknown>;
    const kapso = (msg.kapso ?? {}) as Record<string, unknown>;

    // Defensive: ignore outbound echoes (whatsapp.message.sent) if they ever reach this handler.
    const direction = typeof kapso.direction === 'string' ? kapso.direction : 'inbound';
    if (direction !== 'inbound') return null;

    const messageId = String(msg.id ?? '');
    if (!messageId) return null;

    const phoneNumberId = String(body.phone_number_id ?? conv.phone_number_id ?? '');
    const phoneNumber = this.normalizeE164(String(conv.phone_number ?? msg.from ?? ''));
    const conversationId = String(conv.id ?? '');
    const timestamp = String(msg.timestamp ?? Math.floor(Date.now() / 1000));
    const isNewConversation = Boolean(body.is_new_conversation ?? false);

    const type = String(msg.type ?? 'unknown');

    if (type === 'text') {
      const textObj = (msg.text ?? {}) as Record<string, unknown>;
      return {
        messageId,
        phoneNumber,
        phoneNumberId,
        conversationId,
        type: 'text',
        text: String(textObj.body ?? ''),
        timestamp,
        isNewConversation,
      };
    }

    if (type === 'interactive') {
      const interactive = (msg.interactive ?? {}) as Record<string, unknown>;
      const buttonReply = (interactive.button_reply ?? {}) as Record<string, unknown>;
      const listReply = (interactive.list_reply ?? {}) as Record<string, unknown>;

      const replyId = String(buttonReply.id ?? listReply.id ?? '');
      const replyTitle = String(buttonReply.title ?? listReply.title ?? '');

      return {
        messageId,
        phoneNumber,
        phoneNumberId,
        conversationId,
        type: 'interactive',
        interactiveReplyId: replyId,
        interactiveReplyTitle: replyTitle,
        timestamp,
        isNewConversation,
      };
    }

    return {
      messageId,
      phoneNumber,
      phoneNumberId,
      conversationId,
      type: 'unknown',
      timestamp,
      isNewConversation,
    };
  }

  // Meta envía el número como dígitos (`16315551181`). E.164 canónico requiere `+`.
  private normalizeE164(raw: string): string {
    if (!raw) return '';
    return raw.startsWith('+') ? raw : `+${raw}`;
  }

  private buildPayload(message: OutboundMessage): unknown {
    const base = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'interactive',
    };

    switch (message.kind) {
      case 'text':
        return {
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'text',
          text: { body: message.body },
        };

      case 'list': {
        return {
          ...base,
          interactive: {
            type: 'list',
            body: { text: message.body },
            action: {
              button: message.buttonText,
              sections: message.sections.map((s: ListSection) => ({
                title: s.title,
                rows: s.rows.map((r) => ({
                  id: r.id,
                  title: r.title,
                  description: r.description,
                })),
              })),
            },
          },
        };
      }

      case 'buttons': {
        return {
          ...base,
          interactive: {
            type: 'button',
            body: { text: message.body },
            action: {
              buttons: message.buttons.map((b) => ({
                type: 'reply',
                reply: { id: b.id, title: b.title },
              })),
            },
          },
        };
      }

      default:
        throw new Error(`Unsupported outbound message kind`);
    }
  }
}
