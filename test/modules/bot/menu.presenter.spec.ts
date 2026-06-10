import { describe, expect, it } from 'vitest';
import { MenuPresenter } from '../../../src/modules/bot/presenters/menu.presenter';

describe('MenuPresenter', () => {
  it('arma el menú ACF (List) con 4 opciones en orden', () => {
    const msg = new MenuPresenter().build('pn1', '+51999');
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
});
