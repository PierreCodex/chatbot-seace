import { describe, expect, it } from 'vitest';
import { waToTelegramHtml } from '../../../src/adapters/messaging/telegram/telegram.markdown';

describe('waToTelegramHtml', () => {
  it('convierte *negrita* a <b>', () => {
    expect(waToTelegramHtml('hola *mundo*')).toBe('hola <b>mundo</b>');
  });

  it('convierte _itálica_ a <i>', () => {
    expect(waToTelegramHtml('texto _en cursiva_')).toBe('texto <i>en cursiva</i>');
  });

  it('escapa < > & antes de convertir', () => {
    expect(waToTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('deja ~ y emojis intactos (no son strikethrough)', () => {
    expect(waToTelegramHtml('Convocatoria: ~15/06 🗓️')).toBe('Convocatoria: ~15/06 🗓️');
  });

  it('maneja negrita e itálica en el mismo texto', () => {
    expect(waToTelegramHtml('*Obra* _municipal_')).toBe('<b>Obra</b> <i>municipal</i>');
  });
});
