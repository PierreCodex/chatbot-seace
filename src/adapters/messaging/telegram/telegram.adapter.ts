import { Injectable, Logger } from '@nestjs/common';
import { InputFile } from 'grammy';
import type { InlineKeyboardButton, Update } from 'grammy/types';
import type {
  ButtonOption,
  InboundMessage,
  MessagingPort,
  OutboundMessage,
} from '../../../ports/messaging.port';
import { TelegramClient } from './telegram.client';
import { waToTelegramHtml } from './telegram.markdown';

// Telegram no tiene "número de empresa" como WhatsApp; el bot ES el token.
// Se guarda un valor constante en el slot phoneNumberId para conservar el contrato.
const TELEGRAM_BOT_ID = 'telegram-bot';

@Injectable()
export class TelegramAdapter implements MessagingPort {
  private readonly logger = new Logger(TelegramAdapter.name);

  constructor(private readonly client: TelegramClient) {}

  async send(message: OutboundMessage): Promise<{ messageId: string }> {
    const chatId = Number(message.to);

    const effect = message.effectId ? { message_effect_id: message.effectId } : {};

    if (message.kind === 'document') {
      const sent = await this.client.api.sendDocument(chatId, message.link, {
        ...(message.caption
          ? { caption: waToTelegramHtml(message.caption), parse_mode: 'HTML' }
          : {}),
        ...effect,
      });
      return { messageId: String(sent.message_id) };
    }

    // text / buttons / list → texto (caption) + teclado inline opcional.
    const { text, keyboard } = render(message);
    const replyMarkup = keyboard ? { inline_keyboard: keyboard } : undefined;

    // Si trae imagen de cabecera (banner), va como foto con caption.
    if (message.imagePath) {
      const sent = await this.client.api.sendPhoto(chatId, new InputFile(message.imagePath), {
        caption: text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        ...effect,
      });
      return { messageId: String(sent.message_id) };
    }

    const sent = await this.client.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...effect,
    });
    return { messageId: String(sent.message_id) };
  }

  async sendChatAction(to: string, action: 'typing' | 'upload_document'): Promise<void> {
    await this.client.api.sendChatAction(Number(to), action);
  }

  // Reescribe un mensaje en su lugar (navegación sin alargar el chat). Solo aplica a
  // text/buttons/list; un mensaje foto no se puede convertir a texto → fallback a send.
  async editMessage(message: OutboundMessage, messageId: string): Promise<{ messageId: string }> {
    if (message.kind === 'document' || message.imagePath) {
      return this.send(message);
    }
    const chatId = Number(message.to);
    const { text, keyboard } = render(message);
    const edited = await this.client.api.editMessageText(chatId, Number(messageId), text, {
      parse_mode: 'HTML',
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
    return { messageId: typeof edited === 'object' ? String(edited.message_id) : messageId };
  }

  async deleteMessage(to: string, messageId: string): Promise<void> {
    await this.client.api.deleteMessage(Number(to), Number(messageId));
  }

  // Telegram webhook = un objeto `Update`. Nos interesan dos formas:
  //   - update.message.text       → texto del usuario
  //   - update.callback_query.data → id del botón inline pulsado
  parseWebhook(raw: unknown): InboundMessage[] {
    const update = (raw ?? {}) as Update;

    const cbq = update.callback_query;
    if (cbq) {
      // Apaga el "relojito" de carga del botón (fire-and-forget).
      void this.client.api
        .answerCallbackQuery(cbq.id)
        .catch((err) => this.logger.debug(`answerCallbackQuery falló: ${(err as Error).message}`));

      const chat = cbq.message?.chat;
      if (!chat) return [];
      return [
        {
          messageId: String(cbq.id),
          phoneNumber: String(chat.id),
          phoneNumberId: TELEGRAM_BOT_ID,
          conversationId: String(chat.id),
          type: 'interactive',
          interactiveReplyId: cbq.data ?? '',
          interactiveReplyTitle: '',
          sourceMessageId: cbq.message ? String(cbq.message.message_id) : undefined,
          timestamp: String(cbq.message?.date ?? Math.floor(Date.now() / 1000)),
          isNewConversation: false,
        },
      ];
    }

    const msg = update.message;
    if (msg && typeof msg.text === 'string') {
      return [
        {
          messageId: String(msg.message_id),
          phoneNumber: String(msg.chat.id),
          phoneNumberId: TELEGRAM_BOT_ID,
          conversationId: String(msg.chat.id),
          type: 'text',
          text: msg.text,
          timestamp: String(msg.date),
          isNewConversation: msg.text.trim() === '/start',
        },
      ];
    }

    return [];
  }
}

// Convierte text/buttons/list a (caption HTML, teclado inline). El `list` no tiene
// equivalente nativo en Telegram → se vuelca como texto con las filas + un botón
// inline por fila.
function render(message: Exclude<OutboundMessage, { kind: 'document' }>): {
  text: string;
  keyboard?: InlineKeyboardButton[][];
} {
  if (message.kind === 'text') {
    return { text: message.html ? message.body : waToTelegramHtml(message.body) };
  }

  if (message.kind === 'buttons') {
    return {
      text: message.html ? message.body : waToTelegramHtml(message.body),
      keyboard: chunkButtons(message.buttons, message.buttonLayout),
    };
  }

  // list (sin imagen): texto con filas + un botón por fila.
  const lines: string[] = [waToTelegramHtml(message.body)];
  const keyboard: InlineKeyboardButton[][] = [];
  for (const section of message.sections) {
    if (section.title) lines.push('', `<b>${waToTelegramHtml(section.title)}</b>`);
    for (const row of section.rows) {
      const desc = row.description ? ` — ${waToTelegramHtml(row.description)}` : '';
      lines.push(`• ${waToTelegramHtml(row.title)}${desc}`);
      keyboard.push([{ text: row.title, callback_data: row.id }]);
    }
  }
  return { text: lines.join('\n'), keyboard };
}

// Agrupa botones en filas según `layout` (ej. [1,2,1]); sin layout → 1 por fila.
// Los botones que sobren del layout caen a una fila individual cada uno.
function chunkButtons(buttons: ButtonOption[], layout?: number[]): InlineKeyboardButton[][] {
  const toBtn = (b: ButtonOption): InlineKeyboardButton => ({
    text: b.title,
    callback_data: b.id,
    ...(b.style ? { style: b.style } : {}),
    ...(b.iconCustomEmojiId ? { icon_custom_emoji_id: b.iconCustomEmojiId } : {}),
  });
  if (!layout || layout.length === 0) {
    return buttons.map((b) => [toBtn(b)]);
  }
  const rows: InlineKeyboardButton[][] = [];
  let i = 0;
  for (const count of layout) {
    const row = buttons.slice(i, i + count).map(toBtn);
    if (row.length) rows.push(row);
    i += count;
  }
  while (i < buttons.length) rows.push([toBtn(buttons[i++])]);
  return rows;
}
