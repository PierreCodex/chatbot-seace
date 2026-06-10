import { Injectable } from '@nestjs/common';
import type { OutboundMessage } from '../../../ports/messaging.port';

@Injectable()
export class MenuPresenter {
  build(phoneNumberId: string, to: string): OutboundMessage {
    return {
      kind: 'list',
      to,
      phoneNumberId,
      body: 'Bienvenido a ContrataBot. ¿Qué deseas hacer?',
      buttonText: 'Ver opciones',
      sections: [
        {
          title: 'Menú principal',
          rows: [
            {
              id: 'search',
              title: 'Buscar procesos',
              description: 'Busca procesos de contratación en SEACE',
            },
            {
              id: 'subscriptions',
              title: 'Mis suscripciones',
              description: 'Administra tus alertas',
            },
            { id: 'help', title: 'Ayuda', description: 'Cómo usar el bot' },
          ],
        },
      ],
    };
  }
}
