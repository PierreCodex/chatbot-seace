import { Module } from '@nestjs/common';
import { AdminCommandsService } from './admin-commands.service';
import { PlanService } from './plan.service';
import { RolesService } from './roles.service';

/**
 * Sistema de roles/planes/comandos de administración (docs/17). `ADMIN_REPO` y
 * `CACHE_PORT` son globales (PrismaPersistenceModule / RedisCacheModule);
 * `ConfigService` también. Exporta los servicios para que `BotModule` los use.
 */
@Module({
  providers: [RolesService, PlanService, AdminCommandsService],
  exports: [RolesService, PlanService, AdminCommandsService],
})
export class AdminModule {}
