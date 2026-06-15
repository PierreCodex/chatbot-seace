import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  MESSAGING_PORT,
  type BotCommandSpec,
  type MessagingPort,
} from '../../ports/messaging.port';
import { ADMIN_REPO, type AdminRepoPort } from '../../ports/persistence/admin.repo.port';
import { RolesService } from './roles.service';

// Menú público (lo ve cualquier usuario).
const PUBLIC: BotCommandSpec[] = [
  { command: 'start', description: 'Iniciar y ver el menú' },
  { command: 'register', description: 'Registrarte y ver tu plan' },
  { command: 'menu', description: 'Menú de funciones' },
  { command: 'miplan', description: 'Ver tu plan y tus alertas' },
  { command: 'misalertas', description: 'Gestionar tus alertas' },
  { command: 'ayuda', description: '¿Qué puede hacer el bot?' },
  { command: 'ent', description: 'Consultar una entidad' },
];

const CMDS: BotCommandSpec = { command: 'cmds', description: 'Comandos de administración' };

// Comandos de planes (owner y seller).
const PLAN: BotCommandSpec[] = [
  { command: 'activar', description: 'Dar Premium a un usuario' },
  { command: 'extender', description: 'Extender Premium' },
  { command: 'desactivar', description: 'Volver a Free' },
  { command: 'usuario', description: 'Ver ficha de un usuario' },
  { command: 'premium', description: 'Listar Premium activos' },
  { command: 'porvencer', description: 'Próximos vencimientos' },
  { command: 'historial', description: 'Auditoría de un usuario' },
];

// Comandos exclusivos del owner.
const OWNER_ONLY: BotCommandSpec[] = [
  { command: 'agregarvendedor', description: 'Dar de alta un seller' },
  { command: 'quitarvendedor', description: 'Dar de baja un seller' },
  { command: 'vendedores', description: 'Listar sellers' },
  { command: 'suspender', description: 'Suspender un usuario' },
  { command: 'reactivar', description: 'Reactivar un usuario' },
  { command: 'panico', description: 'Revocar seller (emergencia)' },
  { command: 'auditoria', description: 'Acciones recientes' },
];

const SELLER_MENU = [...PUBLIC, CMDS, ...PLAN];
const OWNER_MENU = [...PUBLIC, CMDS, ...PLAN, ...OWNER_ONLY];

/**
 * Configura el menú nativo de comandos de Telegram (setMyCommands) por scope
 * (docs/17 fase 8): público por defecto, y por-chat para owners (todo) y sellers
 * (público + planes). Sincroniza al arrancar y cuando cambia un seller. Solo aplica
 * en Telegram (Kapso no implementa setMyCommands).
 */
@Injectable()
export class BotCommandsService implements OnModuleInit {
  private readonly logger = new Logger(BotCommandsService.name);
  private readonly owners: string[];

  constructor(
    @Inject(MESSAGING_PORT) private readonly messaging: MessagingPort,
    @Inject(ADMIN_REPO) private readonly admin: AdminRepoPort,
    private readonly roles: RolesService,
    config: ConfigService<Env, true>,
  ) {
    this.owners = config.get('OWNER_IDS', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    if (!this.messaging.setMyCommands) return; // canal sin menú nativo (Kapso)
    try {
      await this.syncAll();
    } catch (err) {
      this.logger.warn(`sync inicial de comandos falló: ${(err as Error).message}`);
    }
  }

  /** Setea el menú público (default) + el de cada owner y cada seller activo. Cada
   * llamada por-chat es resiliente: si ese usuario aún no inició el bot, Telegram
   * devuelve "chat not found" y se omite sin cortar el resto. */
  async syncAll(): Promise<void> {
    if (!this.messaging.setMyCommands) return;
    await this.messaging.setMyCommands(PUBLIC, { type: 'default' });
    for (const id of this.owners) await this.setChat(OWNER_MENU, id);
    const sellers = await this.admin.listSellers({ includeRevoked: false });
    for (const s of sellers) await this.setChat(SELLER_MENU, s.telegramId);
    this.logger.log(
      `menú de comandos sincronizado (público + ${this.owners.length} owner + ${sellers.length} seller)`,
    );
  }

  private async setChat(menu: BotCommandSpec[], chatId: string): Promise<void> {
    try {
      await this.messaging.setMyCommands!(menu, { type: 'chat', chatId });
    } catch (err) {
      this.logger.debug(`setMyCommands chat ${chatId} omitido: ${(err as Error).message}`);
    }
  }

  /** Actualiza el menú de UN usuario según su rol actual (alta/baja de seller). */
  async syncUser(telegramId: string): Promise<void> {
    if (!this.messaging.setMyCommands) return;
    const role = await this.roles.roleOf(telegramId);
    const menu = role === 'owner' ? OWNER_MENU : role === 'seller' ? SELLER_MENU : PUBLIC;
    try {
      await this.messaging.setMyCommands(menu, { type: 'chat', chatId: telegramId });
    } catch (err) {
      this.logger.warn(`sync de comandos para ${telegramId} falló: ${(err as Error).message}`);
    }
  }
}
