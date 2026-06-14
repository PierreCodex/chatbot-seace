import { InputFile } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramAdapter } from '../../../src/adapters/messaging/telegram/telegram.adapter';
import type { OutboundMessage } from '../../../src/ports/messaging.port';

const api = {
  sendMessage: vi.fn().mockResolvedValue({ message_id: 111 }),
  sendDocument: vi.fn().mockResolvedValue({ message_id: 222 }),
  sendPhoto: vi.fn().mockResolvedValue({ message_id: 333 }),
  editMessageText: vi.fn().mockResolvedValue({ message_id: 444 }),
  deleteMessage: vi.fn().mockResolvedValue(true),
  answerCallbackQuery: vi.fn().mockResolvedValue(true),
};

function makeAdapter(): TelegramAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new TelegramAdapter({ api } as any);
}

describe('TelegramAdapter.parseWebhook', () => {
  let adapter: TelegramAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = makeAdapter();
  });

  it('parsea un mensaje de texto', () => {
    const out = adapter.parseWebhook({
      update_id: 1,
      message: {
        message_id: 5,
        date: 1700000000,
        chat: { id: 9876, type: 'private' },
        text: 'Lima',
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'text',
      text: 'Lima',
      phoneNumber: '9876',
      phoneNumberId: 'telegram-bot',
    });
  });

  it('marca isNewConversation con /start', () => {
    const out = adapter.parseWebhook({
      update_id: 2,
      message: {
        message_id: 6,
        date: 1700000000,
        chat: { id: 9876, type: 'private' },
        text: '/start',
      },
    });
    expect(out[0].isNewConversation).toBe(true);
  });

  it('parsea un callback_query como interactive (+ sourceMessageId) y apaga el spinner', () => {
    const out = adapter.parseWebhook({
      update_id: 3,
      callback_query: {
        id: 'cbq1',
        from: { id: 9876, is_bot: false, first_name: 'X' },
        data: 'objeto:obra',
        message: { message_id: 7, date: 1700000000, chat: { id: 9876, type: 'private' } },
      },
    });
    expect(out[0]).toMatchObject({
      type: 'interactive',
      interactiveReplyId: 'objeto:obra',
      phoneNumber: '9876',
      sourceMessageId: '7',
    });
    expect(api.answerCallbackQuery).toHaveBeenCalledWith('cbq1');
  });

  it('ignora updates sin texto ni callback', () => {
    expect(adapter.parseWebhook({ update_id: 4 })).toEqual([]);
  });
});

describe('TelegramAdapter.send', () => {
  let adapter: TelegramAdapter;
  beforeEach(() => {
    vi.clearAllMocks();
    adapter = makeAdapter();
  });

  it('text → sendMessage con parse_mode HTML y convierte *negrita*', async () => {
    await adapter.send({ kind: 'text', to: '9876', phoneNumberId: 'x', body: 'hola *mundo*' });
    expect(api.sendMessage).toHaveBeenCalledWith(9876, 'hola <b>mundo</b>', { parse_mode: 'HTML' });
  });

  it('buttons → inline_keyboard con callback_data = id', async () => {
    const msg: OutboundMessage = {
      kind: 'buttons',
      to: '9876',
      phoneNumberId: 'x',
      body: 'elige',
      buttons: [
        { id: 'entact:otra', title: '🔎 Otra entidad' },
        { id: 'menu:main', title: '📋 Menú' },
      ],
    };
    await adapter.send(msg);
    const [, , opts] = api.sendMessage.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: '🔎 Otra entidad', callback_data: 'entact:otra' }],
      [{ text: '📋 Menú', callback_data: 'menu:main' }],
    ]);
  });

  it('buttons → propaga style (color) e icon_custom_emoji_id (Bot API 9.4)', async () => {
    const msg: OutboundMessage = {
      kind: 'buttons',
      to: '9876',
      phoneNumberId: 'x',
      body: 'menu',
      buttons: [
        { id: 'acf:module', title: 'ACF', style: 'primary' },
        { id: 'menu:main', title: 'Menú', style: 'success', iconCustomEmojiId: '999' },
      ],
    };
    await adapter.send(msg);
    const [, , opts] = api.sendMessage.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: 'ACF', callback_data: 'acf:module', style: 'primary' }],
      [{ text: 'Menú', callback_data: 'menu:main', style: 'success', icon_custom_emoji_id: '999' }],
    ]);
  });

  it('list → texto con filas + teclado inline apilado', async () => {
    const msg: OutboundMessage = {
      kind: 'list',
      to: '9876',
      phoneNumberId: 'x',
      body: 'Tipo de objeto',
      buttonText: 'Elegir',
      sections: [
        {
          title: 'Objetos',
          rows: [
            { id: 'objeto:obra', title: 'Obra', description: 'Construcción' },
            { id: 'objeto:bien', title: 'Bien' },
          ],
        },
      ],
    };
    await adapter.send(msg);
    const [chatId, text, opts] = api.sendMessage.mock.calls[0];
    expect(chatId).toBe(9876);
    expect(text).toContain('• Obra — Construcción');
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: 'Obra', callback_data: 'objeto:obra' }],
      [{ text: 'Bien', callback_data: 'objeto:bien' }],
    ]);
  });

  it('document → sendDocument con el link', async () => {
    await adapter.send({
      kind: 'document',
      to: '9876',
      phoneNumberId: 'x',
      link: 'https://host/files/abc.pdf',
      filename: 'anuncios.pdf',
      caption: 'Tus *anuncios*',
    });
    expect(api.sendDocument).toHaveBeenCalledWith(9876, 'https://host/files/abc.pdf', {
      caption: 'Tus <b>anuncios</b>',
      parse_mode: 'HTML',
    });
  });

  it('devuelve el message_id como string', async () => {
    const r = await adapter.send({ kind: 'text', to: '9876', phoneNumberId: 'x', body: 'hi' });
    expect(r).toEqual({ messageId: '111' });
  });

  it('editMessage → editMessageText con texto + teclado (mismo espacio)', async () => {
    await adapter.editMessage(
      {
        kind: 'buttons',
        to: '9876',
        phoneNumberId: 'x',
        html: true,
        body: '<b>Submenú</b>',
        buttons: [{ id: 'menu:main', title: 'Menú' }],
      },
      '7',
    );
    expect(api.editMessageText).toHaveBeenCalledWith(9876, 7, '<b>Submenú</b>', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Menú', callback_data: 'menu:main' }]] },
    });
  });

  it('deleteMessage → api.deleteMessage (efecto desvanecido)', async () => {
    await adapter.deleteMessage('9876', '7');
    expect(api.deleteMessage).toHaveBeenCalledWith(9876, 7);
  });

  it('con imagePath → sendPhoto con caption + teclado (no sendMessage)', async () => {
    const msg: OutboundMessage = {
      kind: 'list',
      to: '9876',
      phoneNumberId: 'x',
      imagePath: 'assets/banner.png',
      body: '¡Hola! Soy *DataSeace*',
      buttonText: 'Ver',
      sections: [{ title: 'Menú', rows: [{ id: 'anuncios', title: '📅 Anuncios' }] }],
    };
    await adapter.send(msg);
    expect(api.sendMessage).not.toHaveBeenCalled();
    const [chatId, photo, opts] = api.sendPhoto.mock.calls[0];
    expect(chatId).toBe(9876);
    expect(photo).toBeInstanceOf(InputFile);
    expect(opts.parse_mode).toBe('HTML');
    expect(opts.caption).toContain('<b>DataSeace</b>');
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: '📅 Anuncios', callback_data: 'anuncios' }],
    ]);
  });
});
