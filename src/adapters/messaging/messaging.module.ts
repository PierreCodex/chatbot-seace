import { Module, type DynamicModule } from '@nestjs/common';
import { KapsoMessagingModule } from './kapso/kapso.module';
import { TelegramMessagingModule } from './telegram/telegram.module';

/**
 * Bindea `MESSAGING_PORT` al adapter del canal activo (`MESSAGING_CHANNEL`).
 * Carga **condicional**: solo se instancia el adapter elegido, por lo que solo se
 * exige la credencial de ese canal (KAPSO_API_KEY ó TELEGRAM_BOT_TOKEN). Ambos
 * canales coexisten en el código; se elige por env. Ver docs/13-telegram-migracion.md.
 *
 * Se lee de `process.env` (no de ConfigService) porque la decisión ocurre al
 * construir el grafo de módulos, antes de que el DI resuelva ConfigService. El env
 * ya está cargado (.env) en ese punto.
 */
@Module({})
export class MessagingModule {
  static register(): DynamicModule {
    const channel = process.env.MESSAGING_CHANNEL ?? 'whatsapp';
    const impl = channel === 'telegram' ? TelegramMessagingModule : KapsoMessagingModule;
    return {
      module: MessagingModule,
      imports: [impl],
      exports: [impl],
    };
  }
}
