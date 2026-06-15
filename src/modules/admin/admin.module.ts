import { Module } from '@nestjs/common';
import { MessagingModule } from '../../adapters/messaging/messaging.module';
import { AdminCommandsService } from './admin-commands.service';
import { BotCommandsService } from './bot-commands.service';
import { PlanService } from './plan.service';
import { RolesService } from './roles.service';

/**
 * Sistema de roles/planes/comandos de administración (docs/17). `ADMIN_REPO` y
 * `CACHE_PORT` son globales (PrismaPersistenceModule / RedisCacheModule);
 * `ConfigService` también. Importa el canal de mensajería para el menú nativo de
 * comandos (`BotCommandsService` → setMyCommands). Exporta los servicios para `BotModule`.
 */
@Module({
  imports: [MessagingModule.register()],
  providers: [RolesService, PlanService, AdminCommandsService, BotCommandsService],
  exports: [RolesService, PlanService, AdminCommandsService, BotCommandsService],
})
export class AdminModule {}
