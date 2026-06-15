import { describe, expect, it } from 'vitest';
import { MenuPresenter } from '../../../src/modules/bot/presenters/menu.presenter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function presenterFor(channel: 'whatsapp' | 'telegram'): MenuPresenter {
  return new MenuPresenter({ get: () => channel } as any);
}

describe('MenuPresenter', () => {
  it('WhatsApp: arma el menú como List con 4 opciones en orden', () => {
    const msg = presenterFor('whatsapp').build('pn1', '+51999');
    expect(msg.kind).toBe('list');
    if (msg.kind !== 'list') throw new Error('esperaba list');
    expect(msg.to).toBe('+51999');
    expect(msg.phoneNumberId).toBe('pn1');
    expect(msg.sections[0].rows.map((r) => r.id)).toEqual([
      'anuncios',
      'subscriptions',
      'entity',
      'help',
    ]);
  });

  it('Telegram: menú inicial = módulos (ACF azul + Próximamente + Ayuda), texto sin banner', () => {
    const msg = presenterFor('telegram').build('pn1', '+51999');
    expect(msg.kind).toBe('buttons');
    if (msg.kind !== 'buttons') throw new Error('esperaba buttons');
    expect(msg.html).toBe(true);
    expect(msg.imagePath).toBeUndefined(); // el menú es texto (editable en su lugar)
    expect(msg.buttons.map((b) => b.id)).toEqual(['acf:module', 'soon', 'help']);
    expect(msg.buttons.find((b) => b.id === 'acf:module')?.style).toBe('primary');
  });

  it('Telegram: welcome = [solo banner] (el menú se abre con /menu)', () => {
    const msgs = presenterFor('telegram').welcome('pn1', '+51999');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('text');
    expect(msgs[0].imagePath).toBe('assets/banner.png');
    expect(msgs[0].body).toContain('<b>DataSeace</b>');
  });

  it('WhatsApp: welcome = [list]', () => {
    const msgs = presenterFor('whatsapp').welcome('pn1', '+51999');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe('list');
  });

  it('Telegram: submenú ACF lista ver-anuncios / entidad / alertas + volver', () => {
    const msg = presenterFor('telegram').acfMenu('pn1', '+51999');
    if (msg.kind !== 'buttons') throw new Error('esperaba buttons');
    expect(msg.buttons.map((b) => b.id)).toEqual([
      'anuncios',
      'entity',
      'subscriptions',
      'menu:main',
    ]);
    expect(msg.body).toContain('<blockquote>');
    expect(msg.body).toContain('<code>/ent');
    // "Ver anuncios" primary; "Menú" success con ícono animado.
    expect(msg.buttons.find((b) => b.id === 'anuncios')?.style).toBe('primary');
    const back = msg.buttons.find((b) => b.id === 'menu:main');
    expect(back?.style).toBe('success');
    expect(back?.iconCustomEmojiId).toBeTruthy();
  });
});
