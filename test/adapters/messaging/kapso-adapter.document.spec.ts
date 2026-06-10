import { describe, expect, it, vi } from 'vitest';
import { KapsoAdapter } from '../../../src/adapters/messaging/kapso/kapso.adapter';

describe('KapsoAdapter — document payload', () => {
  it('mapea kind "document" al payload de Meta Cloud API', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const adapter = new KapsoAdapter({ sendMessage } as never);

    await adapter.send({
      kind: 'document',
      to: '+51999',
      phoneNumberId: 'pn1',
      link: 'https://files.example/acf.pdf',
      filename: 'anuncios-futuros.pdf',
      caption: '40 anuncios de contratación futura',
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [phoneNumberId, payload] = sendMessage.mock.calls[0];
    expect(phoneNumberId).toBe('pn1');
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '+51999',
      type: 'document',
      document: {
        link: 'https://files.example/acf.pdf',
        filename: 'anuncios-futuros.pdf',
        caption: '40 anuncios de contratación futura',
      },
    });
  });

  it('omite caption cuando no se provee', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const adapter = new KapsoAdapter({ sendMessage } as never);

    await adapter.send({
      kind: 'document',
      to: '+51999',
      phoneNumberId: 'pn1',
      link: 'https://files.example/acf.pdf',
      filename: 'anuncios-futuros.pdf',
    });

    const payload = sendMessage.mock.calls[0][1] as {
      document: Record<string, unknown>;
    };
    expect(payload.document).not.toHaveProperty('caption');
  });
});
