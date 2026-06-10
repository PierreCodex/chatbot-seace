import { Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';

/**
 * Menú principal del MVP (ACF-first). Ver docs/06-whatsapp-ux.md §10.2.
 * Lista interactiva con 4 entradas: Anuncios futuros (core), Mis alertas,
 * Consultar entidad, Ayuda.
 */
@Injectable()
export class MenuPresenter {
  build(phoneNumberId: string, to: string): OutboundMessage {
    return {
      kind: 'list',
      to,
      phoneNumberId,
      body: '¡Hola! Soy ContrataBot 🇵🇪. ¿Qué deseas hacer?',
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
