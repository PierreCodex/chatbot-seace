import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TG_EMOJI, tgDivider, tgEmoji } from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { OutboundMessage } from '../../../ports/messaging.port';

/** Banner de bienvenida (Telegram lo envía como foto; Kapso lo ignora). */
const WELCOME_BANNER = 'assets/banner.png';
/** Separador de la bienvenida (estilo "====" del diseño propuesto). */
const WELCOME_SEP = '====================';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Menú principal del MVP (ACF-first). Ver docs/06-whatsapp-ux.md §10.2 y la
 * propuesta de diseño Telegram (docs/13).
 *
 * Render por canal (hay un solo canal activo a la vez):
 *  - **Telegram**: mensaje `buttons` con HTML (`<b>`/`<i>`), grilla de botones y
 *    banner en la bienvenida. Más limpio y profesional.
 *  - **WhatsApp**: `list` interactiva (4 filas) como hasta ahora.
 */
@Injectable()
export class MenuPresenter {
  private readonly isTelegram: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.isTelegram = config.get('MESSAGING_CHANNEL', { infer: true }) === 'telegram';
  }

  /** Menú inicial (nivel módulos). Telegram: módulos del SEACE; WhatsApp: list plana.
   * Es un mensaje de **texto** (sin banner) para poder editarlo en su lugar. */
  build(phoneNumberId: string, to: string): OutboundMessage {
    return this.isTelegram
      ? this.telegramMain(phoneNumberId, to)
      : this.whatsapp(phoneNumberId, to);
  }

  /** Bienvenida (/start): Telegram → SOLO el banner (el menú se abre con /menu);
   * WhatsApp → [list] (la lista ya es el menú). */
  welcome(phoneNumberId: string, to: string, displayName?: string | null): OutboundMessage[] {
    if (!this.isTelegram) return [this.whatsapp(phoneNumberId, to)];
    return [this.telegramBanner(phoneNumberId, to, displayName)];
  }

  private telegramBanner(
    phoneNumberId: string,
    to: string,
    displayName?: string | null,
  ): OutboundMessage {
    const hola = displayName ? `Hola <b>${escHtml(displayName)}</b>` : '¡Hola!';
    return {
      kind: 'text',
      to,
      phoneNumberId,
      html: true,
      imagePath: WELCOME_BANNER,
      body:
        `${hola}, bienvenido a tu bot favorito 🤖\n\n` +
        `${WELCOME_SEP}\n\n` +
        `Somos <b>DataSeace</b> 🇵🇪\n` +
        `<i>Monitoreo y alertas del SEACE, directo en Telegram</i> ${tgEmoji('tgLogo')}\n\n` +
        `${WELCOME_SEP}\n\n` +
        `[⌨️]  <b>COMANDOS BÁSICOS</b>\n\n` +
        `[🔰] Regístrate con /register <i>(3 alertas gratis)</i>\n` +
        `[⚒️] Menú de funciones /menu\n` +
        `[📋] Tu perfil /miplan\n\n` +
        `${WELCOME_SEP}\n\n` +
        `[💬]  <b>NUEVO: escríbeme y te entiendo</b>\n\n` +
        `<i>Prueba:</i> <code>obras para colegios en Piura</code>\n` +
        `<i>o</i> <code>avísame cuando salgan hospitales</code>\n\n` +
        `${WELCOME_SEP}\n\n` +
        `${tgEmoji('ownerTag')} Owner: @pierrecodex ${tgEmoji('ownerBadge')}`,
    };
  }

  /** Botón único "Menú" para acompañar respuestas conversacionales de ayuda.
   * No muestra el menú completo; solo ofrece la ruta guiada bajo demanda. */
  helpButton(phoneNumberId: string, to: string): OutboundMessage {
    return {
      kind: 'buttons',
      to,
      phoneNumberId,
      html: true,
      body: '¿Preferís ver las opciones?',
      buttons: [
        {
          id: 'menu:main',
          title: '🏛️ Menú',
          style: 'primary',
          iconCustomEmojiId: TG_EMOJI.back.id,
        },
      ],
      buttonLayout: [1],
    };
  }

  /** Submenú del módulo ACF (nivel 2, solo Telegram): ver anuncios / entidad / alertas. */
  acfMenu(phoneNumberId: string, to: string): OutboundMessage {
    return {
      kind: 'buttons',
      to,
      phoneNumberId,
      html: true,
      body:
        '📅 <b>Anuncio de Contratación Futura</b>\n' +
        tgDivider(8) +
        '\n<blockquote>Lo que el Estado <b>planea licitar</b> próximamente — antes de la convocatoria oficial.</blockquote>\n\n' +
        `${tgEmoji('dot')} 📅 <b>Ver anuncios futuros</b>\n` +
        '<i>Filtra por rubro y/o entidad.</i>\n\n' +
        `${tgEmoji('dot')} 🔎 <b>Consultar entidad</b>\n` +
        '<i>Por nombre o RUC — o usa</i> <code>/ent &lt;texto&gt;</code>\n\n' +
        `${tgEmoji('dot')} 🔔 <b>Mis alertas</b> · ${tgEmoji('premium')} Premium <i>(pronto)</i>\n` +
        '<i>Avisos automáticos a tu medida.</i>',
      buttons: [
        {
          id: 'anuncios',
          title: 'Ver anuncios futuros',
          style: 'primary',
          iconCustomEmojiId: TG_EMOJI.anunciosBtn.id,
        },
        { id: 'entity', title: 'Consultar entidad', iconCustomEmojiId: TG_EMOJI.search.id },
        { id: 'subscriptions', title: 'Mis alertas', iconCustomEmojiId: TG_EMOJI.alert.id },
        { id: 'menu:main', title: 'Menú', style: 'success', iconCustomEmojiId: TG_EMOJI.back.id },
      ],
      buttonLayout: [1, 2, 1],
    };
  }

  private telegramMain(phoneNumberId: string, to: string): OutboundMessage {
    return {
      kind: 'buttons',
      to,
      phoneNumberId,
      html: true,
      body:
        '🏛️ <b>DataSeace</b> — Menú principal\n' +
        tgDivider(8) +
        '\nTu acceso directo a las contrataciones del Estado peruano 🇵🇪\n' +
        'Datos del <b>SEACE</b>, sin entrar a la web.\n\n' +
        '💬 <i>También me puedes escribir directo, ej:</i>\n' +
        '<code>obras para colegios en Piura</code>\n\n' +
        '📂 <b>Módulos disponibles</b>\n' +
        `${tgEmoji('dot')} <b>Anuncio de Contratación Futura</b>  ${tgEmoji('ok')} <i>activo</i>\n` +
        `${tgEmoji('dot')} <b>Más módulos del SEACE</b>  🔒 <i>próximamente</i>\n\n` +
        `${tgEmoji('elige')} <i>Elige una opción</i>`,
      buttons: [
        {
          id: 'acf:module',
          title: 'Anuncio de Contratación Futura',
          style: 'primary',
          iconCustomEmojiId: TG_EMOJI.anunciosBtn.id,
        },
        { id: 'soon', title: 'Próximamente', iconCustomEmojiId: TG_EMOJI.soon.id },
        { id: 'help', title: 'Ayuda', iconCustomEmojiId: TG_EMOJI.ayuda.id },
      ],
      // ACF ancho arriba; Próximamente + Ayuda en par.
      buttonLayout: [1, 2],
    };
  }

  private whatsapp(phoneNumberId: string, to: string): OutboundMessage {
    return {
      kind: 'list',
      to,
      phoneNumberId,
      body:
        '¡Hola! Soy *DataSeace* 🇵🇪🤖\n\n' +
        'Te traigo los *Anuncios de Contratación Futura* y las contrataciones del Estado peruano directo del *SEACE* 🏛️ — sin que tengas que entrar a la web 📲✨\n\n' +
        '¿Qué deseas hacer? 👇\n\n' +
        '_Tip: escribe *menú* en cualquier momento para volver aquí._',
      buttonText: 'Ver opciones',
      sections: [
        {
          title: 'Menú principal',
          rows: [
            {
              id: 'anuncios',
              title: '📅 Anuncios futuros',
              description: 'Anuncios de Contratación Futura del Estado',
            },
            {
              id: 'subscriptions',
              title: '🔔 Mis alertas',
              description: 'Administra tus avisos',
            },
            {
              id: 'entity',
              title: '🔎 Consultar entidad',
              description: 'Busca el RUC de una entidad',
            },
            { id: 'help', title: '❓ Ayuda', description: 'Cómo usar el bot' },
          ],
        },
      ],
    };
  }
}
