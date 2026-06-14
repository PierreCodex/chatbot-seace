import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminAuditLog } from '@prisma/client';
import { tgEmoji } from '../../common/telegram-emoji';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import { ADMIN_REPO, type AdminRepoPort } from '../../ports/persistence/admin.repo.port';
import type { ButtonOption, OutboundMessage } from '../../ports/messaging.port';
import { PlanService } from './plan.service';
import { RolesService, type AdminRole } from './roles.service';

export interface AdminContext {
  /** id de Telegram del emisor (= chat_id en privado). */
  senderId: string;
  phoneNumberId: string;
  input: string;
  /** message_id del mensaje origen (botón), para editar/borrar in-place. */
  sourceMessageId?: string;
}

/**
 * Resultado del router admin. `navigation` (Telegram): `edit` reescribe el mensaje
 * origen (paginación de /cmds), `delete` lo borra (botón Cerrar).
 */
export interface AdminHandleResult {
  messages: OutboundMessage[];
  navigation?: 'edit' | 'delete';
}

/** Comandos admin (no incluye los públicos `/miplan` y `/ayuda`). */
const ADMIN_COMMANDS = new Set([
  'cmds',
  'activar',
  'extender',
  'desactivar',
  'usuario',
  'premium',
  'porvencer',
  'historial',
  'agregarvendedor',
  'quitarvendedor',
  'vendedores',
  'suspender',
  'reactivar',
  'panico',
  'auditoria',
]);

/** Subconjunto exclusivo del owner. El resto lo pueden usar owner y seller. */
const OWNER_ONLY = new Set([
  'agregarvendedor',
  'quitarvendedor',
  'vendedores',
  'suspender',
  'reactivar',
  'panico',
  'auditoria',
]);

const MAX_ATTEMPTS = 5;
const LIST_LIMIT = 20;
const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Router + handlers de los comandos de administración (docs/17). Corre ANTES del
 * router de flujos. Devuelve:
 *   - `OutboundMessage[]` si el input es un comando admin/`/miplan` (puede ser `[]`
 *     en modo sigilo cuando un no-autorizado tipea un comando admin).
 *   - `null` si no es un comando manejado aquí → sigue el flujo normal.
 */
@Injectable()
export class AdminCommandsService {
  private readonly logger = new Logger(AdminCommandsService.name);

  constructor(
    private readonly roles: RolesService,
    private readonly plan: PlanService,
    @Inject(ADMIN_REPO) private readonly repo: AdminRepoPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
  ) {}

  async handle(ctx: AdminContext): Promise<AdminHandleResult | null> {
    // Callbacks de paginación de /cmds (botones « » / Cerrar). Sin estado: la
    // página va en el id del botón.
    if (ctx.input.startsWith('cmds:')) return this.cmdsNav(ctx);

    const parsed = parseCommand(ctx.input);
    if (!parsed) return null;
    const { cmd, args } = parsed;

    if (cmd === 'miplan') return { messages: await this.miplan(ctx) };
    if (cmd === 'ayuda' || cmd === 'help') return { messages: await this.ayuda(ctx) };
    if (!ADMIN_COMMANDS.has(cmd)) return null;

    const role = await this.roles.roleOf(ctx.senderId);
    if (!role) {
      // Sigilo: no respondemos nada; registramos el intento (rate-limited).
      await this.recordUnauthorized(ctx.senderId, cmd);
      return { messages: [] };
    }
    if (OWNER_ONLY.has(cmd) && role !== 'owner') {
      return { messages: [this.text(ctx, '🚫 Ese comando es solo del dueño.')] };
    }

    try {
      if (cmd === 'cmds') return { messages: [this.renderCmdsHome(ctx, role)] };
      return { messages: await this.dispatch(cmd, args, ctx, role) };
    } catch (err) {
      this.logger.error(`admin ${cmd} falló: ${(err as Error).message}`);
      return {
        messages: [
          this.text(ctx, '⚠️ No pude completar la acción. Revisá los datos e intentá de nuevo.'),
        ],
      };
    }
  }

  /** Callbacks de /cmds (re-valida el rol): home, categoría+página, cerrar. */
  private async cmdsNav(ctx: AdminContext): Promise<AdminHandleResult> {
    const role = await this.roles.roleOf(ctx.senderId);
    if (!role) return { messages: [] };
    if (ctx.input === 'cmds:exit') return { messages: [], navigation: 'delete' };
    if (ctx.input === 'cmds:home') {
      return { messages: [this.renderCmdsHome(ctx, role)], navigation: 'edit' };
    }
    const m = /^cmds:c:([a-z]+):(\d+)$/.exec(ctx.input);
    if (m) {
      return {
        messages: [this.renderCmdsCategory(ctx, role, m[1], Number(m[2]))],
        navigation: 'edit',
      };
    }
    return { messages: [] };
  }

  private dispatch(
    cmd: string,
    args: string[],
    ctx: AdminContext,
    role: AdminRole,
  ): Promise<OutboundMessage[]> {
    switch (cmd) {
      case 'activar':
        return this.activar(args, ctx, role);
      case 'extender':
        return this.extender(args, ctx, role);
      case 'desactivar':
        return this.desactivar(args, ctx, role);
      case 'usuario':
        return this.usuario(args, ctx);
      case 'premium':
        return this.premium(ctx);
      case 'porvencer':
        return this.porvencer(args, ctx);
      case 'historial':
        return this.historial(args, ctx);
      case 'agregarvendedor':
        return this.agregarVendedor(args, ctx);
      case 'quitarvendedor':
        return this.quitarVendedor(args, ctx);
      case 'vendedores':
        return this.vendedores(ctx);
      case 'suspender':
        return this.suspender(args, ctx);
      case 'reactivar':
        return this.reactivar(args, ctx);
      case 'panico':
        return this.panico(args, ctx);
      case 'auditoria':
        return this.auditoria(ctx);
      default:
        return Promise.resolve([this.text(ctx, 'Comando no reconocido.')]);
    }
  }

  // ── público ──

  private async miplan(ctx: AdminContext): Promise<OutboundMessage[]> {
    const u = await this.repo.findUser(ctx.senderId);
    if (!u) return [this.text(ctx, 'Escribí /start para empezar.')];
    const role = await this.roles.roleOf(ctx.senderId);
    const eff = this.plan.getEffectivePlan(u, new Date(), role !== null);
    const cupo = this.plan.maxAlertas(eff);
    const lines = [
      '👤 <b>Tu cuenta</b>',
      `🆔 Tu id: <code>${ctx.senderId}</code>`,
      `📦 Plan: <b>${planLabel(eff)}</b>`,
    ];
    if (role) lines.push(`🛡️ Premium por tu rol de <b>${role}</b>`);
    else if (eff === 'premium' && u.planExpiresAt)
      lines.push(`⏳ Vence: ${fmtDate(u.planExpiresAt)}`);
    else if (eff === 'premium') lines.push('⏳ Vence: <i>sin vencimiento</i>');
    if (eff === 'suspended') lines.push('⚠️ Tu cuenta está suspendida.');
    lines.push(`🔔 Alertas: hasta <b>${cupo}</b>`);
    return [this.text(ctx, lines.join('\n'))];
  }

  /** Ayuda para usuarios: qué hace el bot (público). */
  private ayuda(ctx: AdminContext): Promise<OutboundMessage[]> {
    const body = [
      '🤖 <b>DataSeace — ¿qué puedo hacer?</b>',
      '',
      '📅 <b>Ver anuncios futuros</b>',
      'Anuncios de Contratación Futura (ACF) por objeto y entidad. Tocá el menú para empezar.',
      '',
      '🏢 <b>Consultar entidad</b>',
      'Escribí <code>/ent &lt;nombre o RUC&gt;</code> para ver los datos de una entidad.',
      '',
      '🔔 <b>Alertas</b>',
      'Te aviso cuando salgan nuevos anuncios según tus filtros <i>(próximamente)</i>.',
      '',
      '👤 <b>Tu cuenta</b>',
      '<code>/miplan</code> — tu id, tu plan y tu cupo de alertas.',
      '',
      'Escribí <b>menú</b> en cualquier momento para volver al inicio.',
    ].join('\n');
    return Promise.resolve([this.text(ctx, body)]);
  }

  // ── comandos de administración (owner + seller) ──

  /** Vista inicial de /cmds: stats + selección de categoría (botones de colores). */
  private renderCmdsHome(ctx: AdminContext, role: AdminRole): OutboundMessage {
    const cats = catsFor(role);
    const totalCmds = cats.reduce((n, c) => n + c.cmds.length, 0);
    const body =
      `${tgEmoji('search')} <b>DataSeace · Comandos</b>\n` +
      `${CMDS_SEP}\n` +
      `📂 <b>Categorías:</b> ${cats.length}   ·   🔧 <b>Comandos:</b> ${totalCmds}\n` +
      `🛡️ Tu rol: <b>${role}</b>\n\n` +
      `👇 <b>Elegí una categoría:</b>`;

    const catBtns: ButtonOption[] = cats.map((c) => ({
      id: `cmds:c:${c.key}:0`,
      title: `${c.icon} ${c.title}`,
      style: 'primary',
    }));
    const layout: number[] = [];
    for (let i = 0; i < catBtns.length; i += 2) layout.push(Math.min(2, catBtns.length - i));
    layout.push(1); // fila del Cerrar
    return {
      kind: 'buttons',
      to: ctx.senderId,
      phoneNumberId: ctx.phoneNumberId,
      html: true,
      body,
      buttons: [...catBtns, { id: 'cmds:exit', title: '✖ Cerrar', style: 'danger' }],
      buttonLayout: layout,
    };
  }

  /** Vista de categoría: cards (una por comando) con paginación + volver/cerrar. */
  private renderCmdsCategory(
    ctx: AdminContext,
    role: AdminRole,
    catKey: string,
    page: number,
  ): OutboundMessage {
    const cats = catsFor(role);
    const cat = cats.find((c) => c.key === catKey);
    if (!cat) return this.renderCmdsHome(ctx, role); // defensa: categoría inválida/owner-only
    const pages = chunk(cat.cmds, CMDS_PER_PAGE);
    const idx = Math.max(0, Math.min(page, pages.length - 1));
    const cards = pages[idx]
      .map(
        (c) =>
          `<blockquote>🔧 <b>Comando:</b> <code>${c.cmd}</code>\n` +
          `📝 <b>Uso:</b> ${c.args ? `<code>${c.args}</code>` : '<i>—</i>'}\n` +
          `💬 <b>Qué hace:</b> <i>${c.desc}</i></blockquote>`,
      )
      .join('\n');
    const body =
      `${tgEmoji('search')} <b>DataSeace · Comandos</b>\n` +
      `${cat.icon} <b>${cat.title}</b>   ·   <code>${idx + 1}/${pages.length}</code>\n\n` +
      cards;

    const nav: ButtonOption[] = [];
    if (idx > 0) {
      nav.push({ id: `cmds:c:${cat.key}:${idx - 1}`, title: '« Anterior', style: 'primary' });
    }
    if (idx < pages.length - 1) {
      nav.push({ id: `cmds:c:${cat.key}:${idx + 1}`, title: 'Siguiente »', style: 'primary' });
    }
    const buttons: ButtonOption[] = [
      ...nav,
      { id: 'cmds:home', title: '◀ Categorías', style: 'success' },
      { id: 'cmds:exit', title: '✖ Cerrar', style: 'danger' },
    ];
    return {
      kind: 'buttons',
      to: ctx.senderId,
      phoneNumberId: ctx.phoneNumberId,
      html: true,
      body,
      buttons,
      buttonLayout: nav.length ? [nav.length, 2] : [2],
    };
  }

  // ── planes (owner + seller) ──

  private async activar(
    args: string[],
    ctx: AdminContext,
    role: AdminRole,
  ): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id)
      return [
        this.text(ctx, 'Uso: <code>/activar &lt;id&gt; &lt;días|permanente&gt; [nota]</code>'),
      ];
    const dur = parseDuration(args[1]);
    if (dur === 'invalid') {
      return [
        this.text(
          ctx,
          'Indicá los días (número) o la palabra <code>permanente</code>.\nUso: <code>/activar &lt;id&gt; &lt;días|permanente&gt; [nota]</code>',
        ),
      ];
    }
    const guard = await this.guardTarget(id, ctx.senderId, role);
    if (guard) return [this.text(ctx, guard)];
    const target = await this.repo.findUser(id);
    if (!target) return [this.text(ctx, notStarted(id))];

    const expiry = dur === 'permanente' ? null : new Date(Date.now() + dur * MS_DAY);
    const note = joinNote(args.slice(2));
    const after = await this.repo.setPlan({
      targetUserId: id,
      plan: 'premium',
      planExpiresAt: expiry,
      actorId: ctx.senderId,
      actorRole: role,
      action: 'plan_activado',
      note,
    });
    const venc = after.planExpiresAt
      ? `hasta el <b>${fmtDate(after.planExpiresAt)}</b>`
      : '<b>permanente</b>';
    return [
      this.text(ctx, `✅ Premium activado para <code>${id}</code> ${venc}.`),
      this.textTo(
        ctx,
        id,
        `🎉 <b>¡Tu plan ahora es Premium!</b>\n${after.planExpiresAt ? `Vigente hasta el ${fmtDate(after.planExpiresAt)}.` : 'Sin vencimiento.'}\n\nYa podés crear hasta ${this.plan.maxAlertas('premium')} alertas.`,
      ),
    ];
  }

  private async extender(
    args: string[],
    ctx: AdminContext,
    role: AdminRole,
  ): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    const days = parseInt(args[1], 10);
    if (!id || !Number.isInteger(days) || days <= 0) {
      return [this.text(ctx, 'Uso: <code>/extender &lt;id&gt; &lt;días&gt; [nota]</code>')];
    }
    const guard = await this.guardTarget(id, ctx.senderId, role);
    if (guard) return [this.text(ctx, guard)];
    const target = await this.repo.findUser(id);
    if (!target) return [this.text(ctx, notStarted(id))];
    if (this.plan.getEffectivePlan(target) !== 'premium') {
      return [
        this.text(ctx, `<code>${id}</code> no tiene Premium activo. Usá <code>/activar</code>.`),
      ];
    }
    if (target.planExpiresAt === null) {
      return [
        this.text(
          ctx,
          `<code>${id}</code> ya tiene Premium <b>permanente</b>; no hay nada que extender.`,
        ),
      ];
    }
    const base =
      target.planExpiresAt.getTime() > Date.now() ? target.planExpiresAt.getTime() : Date.now();
    const expiry = new Date(base + days * MS_DAY);
    await this.repo.setPlan({
      targetUserId: id,
      plan: 'premium',
      planExpiresAt: expiry,
      actorId: ctx.senderId,
      actorRole: role,
      action: 'plan_extendido',
      note: joinNote(args.slice(2)),
    });
    return [
      this.text(
        ctx,
        `✅ Premium de <code>${id}</code> extendido hasta el <b>${fmtDate(expiry)}</b>.`,
      ),
      this.textTo(ctx, id, `⏳ Tu Premium se extendió hasta el ${fmtDate(expiry)}.`),
    ];
  }

  private async desactivar(
    args: string[],
    ctx: AdminContext,
    role: AdminRole,
  ): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/desactivar &lt;id&gt; [nota]</code>')];
    const guard = await this.guardTarget(id, ctx.senderId, role);
    if (guard) return [this.text(ctx, guard)];
    const target = await this.repo.findUser(id);
    if (!target) return [this.text(ctx, notStarted(id))];
    await this.repo.setPlan({
      targetUserId: id,
      plan: 'free',
      planExpiresAt: null,
      actorId: ctx.senderId,
      actorRole: role,
      action: 'plan_desactivado',
      note: joinNote(args.slice(1)),
    });
    return [
      this.text(ctx, `✅ <code>${id}</code> volvió a <b>Free</b>.`),
      this.textTo(ctx, id, 'ℹ️ Tu plan volvió a Free.'),
    ];
  }

  private async usuario(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/usuario &lt;id&gt;</code>')];
    const u = await this.repo.findUser(id);
    if (!u) return [this.text(ctx, notStarted(id))];
    const role = await this.roles.roleOf(id);
    const eff = this.plan.getEffectivePlan(u, new Date(), role !== null);
    const lines = [
      `👤 <b>Usuario</b> <code>${id}</code>`,
      u.displayName ? `📛 ${esc(u.displayName)}` : null,
      `📦 Plan efectivo: <b>${planLabel(eff)}</b>`,
      `🗄️ En BD: ${u.plan}${u.planExpiresAt ? ` (vence ${fmtDate(u.planExpiresAt)})` : ''}`,
      u.blocked ? '⛔ Suspendido' : '✅ Activo',
      role ? `🛡️ Rol: <b>${role}</b>` : null,
    ].filter(Boolean) as string[];
    return [this.text(ctx, lines.join('\n'))];
  }

  private async premium(ctx: AdminContext): Promise<OutboundMessage[]> {
    const list = await this.repo.listActivePremium(LIST_LIMIT);
    if (list.length === 0) return [this.text(ctx, 'No hay usuarios Premium activos.')];
    const rows = list.map(
      (u) =>
        `• <code>${u.channelUserId}</code> — ${u.planExpiresAt ? fmtDate(u.planExpiresAt) : 'permanente'}`,
    );
    return [this.text(ctx, `💎 <b>Premium activos (${list.length})</b>\n${rows.join('\n')}`)];
  }

  private async porvencer(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const days = args[0] ? parseInt(args[0], 10) : 7;
    if (!Number.isInteger(days) || days <= 0)
      return [this.text(ctx, 'Uso: <code>/porvencer [días]</code>')];
    const list = await this.repo.listExpiringSoon(days, LIST_LIMIT);
    if (list.length === 0)
      return [this.text(ctx, `Ningún Premium vence en los próximos ${days} días.`)];
    const rows = list.map(
      (u) => `• <code>${u.channelUserId}</code> — ${fmtDate(u.planExpiresAt!)}`,
    );
    return [
      this.text(ctx, `⏳ <b>Vencen en ${days} días (${list.length})</b>\n${rows.join('\n')}`),
    ];
  }

  private async historial(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/historial &lt;id&gt;</code>')];
    const log = await this.repo.listAuditByTarget(id, 15);
    if (log.length === 0) return [this.text(ctx, `Sin historial para <code>${id}</code>.`)];
    return [
      this.text(ctx, `📜 <b>Historial de <code>${id}</code></b>\n${log.map(auditLine).join('\n')}`),
    ];
  }

  // ── owner-only ──

  private async agregarVendedor(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/agregarvendedor &lt;id&gt; [nota]</code>')];
    if (this.roles.isOwner(id)) return [this.text(ctx, 'Ese id ya es dueño.')];
    if (id === ctx.senderId) return [this.text(ctx, 'No podés agregarte a vos mismo.')];
    const u = await this.repo.findUser(id);
    if (!u) return [this.text(ctx, notStarted(id))];
    await this.repo.addSeller({
      telegramId: id,
      ownerId: ctx.senderId,
      note: joinNote(args.slice(1)),
    });
    return [
      this.text(ctx, `✅ <code>${id}</code> ahora es <b>seller</b>.`),
      this.textTo(
        ctx,
        id,
        '🛡️ El dueño te dio permisos de <b>seller</b>: ya podés activar Premium a usuarios.',
      ),
    ];
  }

  private async quitarVendedor(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/quitarvendedor &lt;id&gt;</code>')];
    const seller = await this.repo.revokeSeller({ telegramId: id, byId: ctx.senderId });
    if (!seller) return [this.text(ctx, `<code>${id}</code> no es seller.`)];
    return [
      this.text(ctx, `✅ <code>${id}</code> ya no es seller.`),
      this.textTo(ctx, id, 'ℹ️ Se te quitaron los permisos de seller.'),
    ];
  }

  private async vendedores(ctx: AdminContext): Promise<OutboundMessage[]> {
    const list = await this.repo.listSellers({ includeRevoked: true });
    if (list.length === 0) return [this.text(ctx, 'No hay sellers registrados.')];
    const rows = list.map(
      (s) =>
        `${s.active ? '🟢' : '⚪'} <code>${s.telegramId}</code>${s.note ? ` — ${esc(s.note)}` : ''}`,
    );
    return [this.text(ctx, `🛡️ <b>Sellers</b>\n${rows.join('\n')}`)];
  }

  private async suspender(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/suspender &lt;id&gt; [nota]</code>')];
    if (this.roles.isOwner(id)) return [this.text(ctx, 'No podés suspender a un dueño.')];
    if (id === ctx.senderId) return [this.text(ctx, 'No podés suspenderte a vos mismo.')];
    const target = await this.repo.findUser(id);
    if (!target) return [this.text(ctx, notStarted(id))];
    await this.repo.setBlocked({
      targetUserId: id,
      blocked: true,
      actorId: ctx.senderId,
      actorRole: 'owner',
      note: joinNote(args.slice(1)),
    });
    return [this.text(ctx, `⛔ <code>${id}</code> suspendido.`)];
  }

  private async reactivar(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/reactivar &lt;id&gt;</code>')];
    const target = await this.repo.findUser(id);
    if (!target) return [this.text(ctx, notStarted(id))];
    await this.repo.setBlocked({
      targetUserId: id,
      blocked: false,
      actorId: ctx.senderId,
      actorRole: 'owner',
    });
    return [
      this.text(ctx, `✅ <code>${id}</code> reactivado.`),
      this.textTo(ctx, id, '✅ Tu cuenta fue reactivada.'),
    ];
  }

  private async panico(args: string[], ctx: AdminContext): Promise<OutboundMessage[]> {
    const id = parseId(args[0]);
    if (!id) return [this.text(ctx, 'Uso: <code>/panico &lt;seller_id&gt;</code>')];
    const seller = await this.repo.revokeSeller({
      telegramId: id,
      byId: ctx.senderId,
      emergency: true,
    });
    if (!seller) return [this.text(ctx, `<code>${id}</code> no es seller.`)];
    const recent = await this.repo.listAuditByActor(id, 10);
    const head = `🚨 <b>Emergencia:</b> seller <code>${id}</code> revocado.`;
    const body =
      recent.length > 0
        ? `\n\nÚltimas acciones para revisar:\n${recent.map(auditLine).join('\n')}`
        : '\n\nSin acciones recientes registradas.';
    return [this.text(ctx, head + body)];
  }

  private async auditoria(ctx: AdminContext): Promise<OutboundMessage[]> {
    const log = await this.repo.listAuditRecent(LIST_LIMIT);
    if (log.length === 0) return [this.text(ctx, 'Sin acciones registradas.')];
    return [this.text(ctx, `📋 <b>Auditoría reciente</b>\n${log.map(auditLineFull).join('\n')}`)];
  }

  // ── helpers ──

  /**
   * Anti-escalamiento (docs/17 §5). Devuelve un mensaje de error si el target no
   * es válido para `role`, o `null` si está OK.
   */
  private async guardTarget(
    targetId: string,
    senderId: string,
    role: AdminRole,
  ): Promise<string | null> {
    if (role === 'seller' && targetId === senderId) return 'No podés modificar tu propio plan.';
    if (this.roles.isOwner(targetId) && targetId !== senderId) {
      return 'No podés gestionar a un dueño.';
    }
    if (role === 'seller' && (await this.roles.isSeller(targetId))) {
      return 'No podés gestionar a otro seller.';
    }
    return null;
  }

  private async recordUnauthorized(senderId: string, cmd: string): Promise<void> {
    const key = `admin:attempt:${senderId}`;
    const n = (await this.cache.get<number>(key)) ?? 0;
    await this.cache.set(key, n + 1, 60);
    if (n + 1 > MAX_ATTEMPTS) return; // cap: silencio total para no inflar la auditoría
    await this.repo
      .log({
        actorId: senderId,
        actorRole: 'system',
        action: 'intento_no_autorizado',
        targetUserId: senderId,
        note: `cmd=${cmd}`,
      })
      .catch(() => {});
  }

  private text(ctx: AdminContext, body: string): OutboundMessage {
    return { kind: 'text', to: ctx.senderId, phoneNumberId: ctx.phoneNumberId, html: true, body };
  }

  private textTo(ctx: AdminContext, toId: string, body: string): OutboundMessage {
    return { kind: 'text', to: toId, phoneNumberId: ctx.phoneNumberId, html: true, body };
  }
}

// ── funciones puras ──

export function parseCommand(input: string): { cmd: string; args: string[] } | null {
  const t = input.trim();
  if (!t.startsWith('/')) return null;
  const parts = t.slice(1).split(/\s+/);
  let cmd = parts[0].toLowerCase();
  const at = cmd.indexOf('@');
  if (at >= 0) cmd = cmd.slice(0, at);
  if (!cmd) return null;
  return { cmd, args: parts.slice(1) };
}

// ── /cmds: catálogo de categorías (menú de 2 niveles) ──

const CMDS_PER_PAGE = 3;
const CMDS_SEP = '━━━━━━━━━━━━━━';

interface CmdEntry {
  cmd: string;
  args: string;
  desc: string;
}
interface CmdCategory {
  key: string;
  icon: string;
  title: string;
  ownerOnly: boolean;
  cmds: CmdEntry[];
}

const CMD_CATEGORIES: CmdCategory[] = [
  {
    key: 'planes',
    icon: '💼',
    title: 'Planes',
    ownerOnly: false,
    cmds: [
      { cmd: '/activar', args: '&lt;id&gt; &lt;días|permanente&gt; [nota]', desc: 'dar Premium' },
      { cmd: '/extender', args: '&lt;id&gt; &lt;días&gt; [nota]', desc: 'sumar días' },
      { cmd: '/desactivar', args: '&lt;id&gt; [nota]', desc: 'volver a Free' },
    ],
  },
  {
    key: 'consultas',
    icon: '📊',
    title: 'Consultas',
    ownerOnly: false,
    cmds: [
      { cmd: '/usuario', args: '&lt;id&gt;', desc: 'ver ficha del usuario' },
      { cmd: '/premium', args: '', desc: 'listar Premium activos' },
      { cmd: '/porvencer', args: '[días]', desc: 'próximos vencimientos' },
      { cmd: '/historial', args: '&lt;id&gt;', desc: 'auditoría del usuario' },
    ],
  },
  {
    key: 'sellers',
    icon: '👑',
    title: 'Sellers',
    ownerOnly: true,
    cmds: [
      { cmd: '/agregarvendedor', args: '&lt;id&gt; [nota]', desc: 'alta de seller' },
      { cmd: '/quitarvendedor', args: '&lt;id&gt;', desc: 'baja de seller' },
      { cmd: '/vendedores', args: '', desc: 'listar sellers' },
    ],
  },
  {
    key: 'moderacion',
    icon: '🛡️',
    title: 'Moderación',
    ownerOnly: true,
    cmds: [
      { cmd: '/suspender', args: '&lt;id&gt; [nota]', desc: 'bloquear usuario' },
      { cmd: '/reactivar', args: '&lt;id&gt;', desc: 'quitar bloqueo' },
      { cmd: '/panico', args: '&lt;seller_id&gt;', desc: 'revocar seller (emergencia)' },
      { cmd: '/auditoria', args: '', desc: 'acciones recientes' },
    ],
  },
];

/** Categorías visibles para el rol (el owner ve todas; el seller, las no owner-only). */
function catsFor(role: AdminRole): CmdCategory[] {
  return role === 'owner' ? CMD_CATEGORIES : CMD_CATEGORIES.filter((c) => !c.ownerOnly);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseId(raw: string | undefined): string | null {
  return raw && /^\d{3,}$/.test(raw) ? raw : null;
}

/** `permanente` | número de días positivo | `'invalid'`. */
function parseDuration(raw: string | undefined): number | 'permanente' | 'invalid' {
  if (!raw) return 'invalid';
  if (raw.toLowerCase() === 'permanente') return 'permanente';
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}

function joinNote(parts: string[]): string | null {
  const s = parts.join(' ').trim();
  return s.length ? s : null;
}

function notStarted(id: string): string {
  return `El usuario <code>${id}</code> aún no ha iniciado el bot (que escriba /start primero).`;
}

function planLabel(p: 'free' | 'premium' | 'suspended'): string {
  return p === 'premium' ? 'Premium 💎' : p === 'suspended' ? 'Suspendido ⛔' : 'Free';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(d);
}

function auditLine(a: AdminAuditLog): string {
  return `• ${fmtDate(a.createdAt)} — ${a.action}${a.note ? ` (${esc(a.note)})` : ''}`;
}

function auditLineFull(a: AdminAuditLog): string {
  return `• ${fmtDate(a.createdAt)} — ${a.action} · <code>${a.actorId}</code>→<code>${a.targetUserId ?? '—'}</code>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
