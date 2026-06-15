import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tgDivider, tgEmoji } from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { ButtonOption, OutboundMessage } from '../../../ports/messaging.port';
import { ADMIN_REPO, type AdminRepoPort } from '../../../ports/persistence/admin.repo.port';
import {
  SUBSCRIPTIONS_REPO,
  type SubscriptionsRepoPort,
} from '../../../ports/persistence/subscriptions.repo.port';
import type { ObjetoContratacion, SubFrequency } from '../../../ports/persistence/types';
import { PlanService, type EffectivePlan } from '../../admin/plan.service';
import { RolesService } from '../../admin/roles.service';
import type { Flow, FlowContext, FlowResult } from '../types';

const FLOW_ID = 'subscribe';
const MS_DAY = 24 * 60 * 60 * 1000;
// Contacto para "Ver planes Premium" (cobro manual). Cambiar si cambia el handle.
const PREMIUM_CONTACT_URL = 'https://t.me/pierrecodex';

type Step = 'awaiting-frequency' | 'awaiting-duration' | 'manage';

/** Contexto de la última búsqueda ACF, para "Avísame" sin re-preguntar filtros. */
export interface LastAcf {
  objeto: ObjetoContratacion;
  entityRuc?: string | null;
  entityNombre?: string | null;
}

interface SubDraft {
  objeto: ObjetoContratacion;
  entityRuc?: string | null;
  entityNombre?: string | null;
  frequency?: SubFrequency;
}

interface FlowData {
  lastAcf?: LastAcf;
  subDraft?: SubDraft;
}

const OBJETO_LABELS: Record<ObjetoContratacion, string> = {
  obra: 'Obra',
  bien: 'Bien',
  servicio: 'Servicio',
  consultoria_obra: 'Consultoría de Obra',
};

const FREQ_LABEL: Record<SubFrequency, string> = {
  hourly: '⚡ Inmediata al detectar',
  daily: '📅 1 vez al día',
  weekly: '🗓️ 1 vez por semana',
};

type DurKey = '1d' | '1w' | '1m' | 'inf';
const DUR_LABEL: Record<DurKey, string> = {
  '1d': '1 día',
  '1w': '1 semana',
  '1m': '1 mes',
  inf: 'Sin vencimiento',
};

/**
 * Flujo de alertas (docs/09, docs/17 fase 6). Crea una alerta a partir de la última
 * búsqueda ACF ("🔔 Avísame") pidiendo frecuencia y duración (gated por plan), y
 * gestiona "Mis alertas". El motor de match/entrega (matcher + notifier) es la 6b.
 *
 *   [Avísame] ─▶ awaiting-frequency ─▶ awaiting-duration ─▶ crea la alerta
 *   [Mis alertas] ─▶ manage (listar / borrar)
 */
@Injectable()
export class SubscribeFlow implements Flow {
  readonly id = FLOW_ID;
  private readonly logger = new Logger(SubscribeFlow.name);
  private readonly isTelegram: boolean;

  constructor(
    @Inject(SUBSCRIPTIONS_REPO) private readonly subs: SubscriptionsRepoPort,
    @Inject(ADMIN_REPO) private readonly admin: AdminRepoPort,
    private readonly roles: RolesService,
    private readonly plan: PlanService,
    config: ConfigService<Env, true>,
  ) {
    this.isTelegram = config.get('MESSAGING_CHANNEL', { infer: true }) === 'telegram';
  }

  async handle(ctx: FlowContext): Promise<FlowResult> {
    const data = (ctx.state.data ?? {}) as FlowData;
    const input = ctx.input.trim();

    if (input.startsWith('subdel:')) return this.onDelete(ctx, input.slice('subdel:'.length));
    switch (ctx.state.step as Step) {
      case 'awaiting-frequency':
        return this.onFrequency(ctx, data);
      case 'awaiting-duration':
        return this.onDuration(ctx, data);
      case 'manage':
        return this.startManage(ctx);
      default:
        return this.startCreate(ctx);
    }
  }

  /** Entrada "🔔 Avísame": hereda los filtros de la última búsqueda. */
  async startCreate(ctx: FlowContext): Promise<FlowResult> {
    const data = (ctx.state.data ?? {}) as FlowData;
    const last = data.lastAcf;
    if (!last?.objeto) {
      return this.toMenu(ctx, 'Primero hacé una búsqueda de anuncios y después tocá 🔔 Avísame.');
    }
    const eff = await this.effectivePlan(ctx.phoneNumber);
    const active = await this.subs.countActive(ctx.userId);
    const max = this.plan.maxAlertas(eff);
    if (active >= max) return this.quotaMessage(ctx, eff, max);
    const draft: SubDraft = {
      objeto: last.objeto,
      entityRuc: last.entityRuc ?? null,
      entityNombre: last.entityNombre ?? null,
    };
    // Mensaje NUEVO (sin edit) para no pisar la tarjeta de resultados: queda en
    // el historial. A partir de acá el flujo edita sus propios mensajes.
    return {
      messages: [this.frequencyMsg(ctx, draft, eff)],
      nextFlowId: FLOW_ID,
      nextStep: 'awaiting-frequency',
      dataPatch: { subDraft: draft },
    };
  }

  /** Cuota llena: aviso + botón a Premium (Free) o solo aviso (Premium). */
  private quotaMessage(ctx: FlowContext, eff: EffectivePlan, max: number): FlowResult {
    const body =
      eff === 'premium'
        ? `🔔 Llegaste al límite de tu plan <b>Premium</b> (${max} alertas).\n\nBorrá una en /misalertas.`
        : `🔔 Llegaste al límite de tu plan <b>Free</b> (${max} alertas).\n\nBorrá una en /misalertas o actualizá a Premium para tener 10.`;
    // Botones transparentes (sin `style`), con emoji en el título.
    const buttons: ButtonOption[] =
      eff === 'premium'
        ? [{ id: 'menu:main', title: '🏠 Menú' }]
        : [
            { id: 'premium:info', title: '💎 Quiero Premium', url: PREMIUM_CONTACT_URL },
            { id: 'menu:main', title: '🏠 Menú' },
          ];
    return {
      messages: [
        {
          kind: 'buttons',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          html: this.isTelegram,
          body,
          buttons,
          buttonLayout: [1, 1],
        },
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { subDraft: undefined },
    };
  }

  private async onFrequency(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const draft = data.subDraft;
    if (!draft) return this.startCreate(ctx);
    const freq = parseId(ctx.input, 'subf') as SubFrequency | null;
    const eff = await this.effectivePlan(ctx.phoneNumber);
    if (!freq || !this.allowedFreqs(eff).includes(freq)) {
      return { messages: [this.frequencyMsg(ctx, draft, eff)] };
    }
    const next = { ...draft, frequency: freq };
    return {
      messages: [this.durationMsg(ctx, next, eff)],
      navigation: 'edit',
      nextStep: 'awaiting-duration',
      dataPatch: { subDraft: next },
    };
  }

  private async onDuration(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const draft = data.subDraft;
    if (!draft?.frequency) return this.startCreate(ctx);
    const dur = parseId(ctx.input, 'subd') as DurKey | null;
    const eff = await this.effectivePlan(ctx.phoneNumber);
    if (!dur || !this.allowedDurs(eff).includes(dur)) {
      return { messages: [this.durationMsg(ctx, draft, eff)] };
    }
    let created;
    try {
      created = await this.subs.create({
        userId: ctx.userId,
        tab: 'anuncios_futuros',
        objeto: draft.objeto,
        entityRuc: draft.entityRuc ?? null,
        entityNombre: draft.entityNombre ?? null,
        frequency: draft.frequency,
        expiresAt: durationToDate(dur),
      });
    } catch (err) {
      this.logger.error(`crear alerta falló: ${(err as Error).message}`);
      return this.toMenu(ctx, '⚠️ No pude crear la alerta. Intentá de nuevo en un momento.');
    }
    return {
      messages: [this.createdMsg(ctx, draft, dur, created.frequency)],
      navigation: 'edit',
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { subDraft: undefined },
    };
  }

  /** Entrada "🔔 Mis alertas": lista las activas con opción de borrar. */
  async startManage(ctx: FlowContext): Promise<FlowResult> {
    const list = await this.subs.listByUser(ctx.userId, 'active');
    if (list.length === 0) {
      return this.toMenu(
        ctx,
        this.isTelegram
          ? '🔔 <b>Mis alertas</b>\nNo tenés alertas activas todavía.\n\nBuscá anuncios y tocá 🔔 Avísame para crear una.'
          : 'No tenés alertas activas. Buscá anuncios y tocá Avísame para crear una.',
      );
    }
    const lines = list.map((s, i) => {
      const alcance = s.entityNombre ? esc(s.entityNombre) : 'Todas las entidades';
      const objeto = s.objeto ? OBJETO_LABELS[s.objeto as ObjetoContratacion] : '—';
      return (
        `${i + 1}. <b>${esc(objeto)}</b> · ${alcance}\n` +
        `    <i>${FREQ_LABEL[s.frequency]}</i> · ⏳ ${vencimientoLabel(s.expiresAt)}`
      );
    });
    const buttons: ButtonOption[] = list.map((s, i) => ({
      id: `subdel:${s.id}`,
      title: `🗑 Borrar #${i + 1}`,
    }));
    buttons.push({
      id: 'menu:main',
      title: 'Menú',
      style: 'success',
    });
    return {
      messages: [
        {
          kind: 'buttons',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          html: this.isTelegram,
          body:
            `${tgEmoji('alert')} <b>Mis alertas</b> (${list.length})\n` +
            tgDivider(8) +
            '\n' +
            lines.join('\n'),
          buttons,
        },
      ],
      navigation: 'edit',
      nextFlowId: FLOW_ID,
      nextStep: 'manage',
    };
  }

  private async onDelete(ctx: FlowContext, id: string): Promise<FlowResult> {
    try {
      const sub = await this.subs.findById(id);
      if (sub && sub.userId === ctx.userId) {
        await this.subs.updateStatus(id, 'deleted');
      }
    } catch (err) {
      this.logger.warn(`borrar alerta ${id} falló: ${(err as Error).message}`);
    }
    return this.startManage(ctx); // re-renderiza la lista (in-place)
  }

  // ── builders ──

  private frequencyMsg(ctx: FlowContext, draft: SubDraft, eff: EffectivePlan): OutboundMessage {
    const buttons: ButtonOption[] = this.allowedFreqs(eff).map((f, i) => ({
      id: `subf:${f}`,
      title: FREQ_LABEL[f],
      ...(i === 0 ? { style: 'primary' as const } : {}),
    }));
    buttons.push({ id: 'menu:main', title: 'Cancelar', style: 'danger' });
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      html: this.isTelegram,
      body:
        `${tgEmoji('alert')} <b>Nueva alerta</b>\n` +
        tgDivider(8) +
        `\n${this.scopeLine(draft)}\n\n` +
        '¿<b>Cada cuánto</b> querés el aviso?' +
        (eff === 'premium' ? '' : '\n<i>La opción inmediata es Premium.</i>'),
      buttons,
      buttonLayout: buttonRows(buttons.length),
    };
  }

  private durationMsg(ctx: FlowContext, draft: SubDraft, eff: EffectivePlan): OutboundMessage {
    const buttons: ButtonOption[] = this.allowedDurs(eff).map((d, i) => ({
      id: `subd:${d}`,
      title: DUR_LABEL[d],
      ...(i === 0 ? { style: 'primary' as const } : {}),
    }));
    buttons.push({ id: 'menu:main', title: 'Cancelar', style: 'danger' });
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      html: this.isTelegram,
      body:
        `${tgEmoji('alert')} <b>Nueva alerta</b>\n` +
        tgDivider(8) +
        `\n${this.scopeLine(draft)}\n${draft.frequency ? `Aviso: <i>${FREQ_LABEL[draft.frequency]}</i>\n` : ''}\n` +
        '¿Por <b>cuánto tiempo</b> la mantengo?' +
        (eff === 'premium' ? '' : '\n<i>1 mes y sin vencimiento son Premium.</i>'),
      buttons,
      buttonLayout: buttonRows(buttons.length),
    };
  }

  private createdMsg(
    ctx: FlowContext,
    draft: SubDraft,
    dur: DurKey,
    freq: SubFrequency,
  ): OutboundMessage {
    const venc = dur === 'inf' ? 'sin vencimiento' : `vence en ${DUR_LABEL[dur]}`;
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      html: this.isTelegram,
      body:
        `${tgEmoji('ok')} <b>¡Alerta creada!</b>\n` +
        tgDivider(8) +
        `\n${this.scopeLine(draft)}\n` +
        `Aviso: <i>${FREQ_LABEL[freq]}</i> · ${venc}\n\n` +
        'Te avisaré acá cuando aparezcan anuncios que coincidan. 🔔',
      buttons: [
        { id: 'subscriptions', title: '🔔 Mis alertas', style: 'primary' },
        { id: 'menu:main', title: 'Menú', style: 'success' },
      ],
      buttonLayout: [2],
    };
  }

  private scopeLine(draft: SubDraft): string {
    const objeto = OBJETO_LABELS[draft.objeto];
    const alcance = draft.entityNombre ? esc(draft.entityNombre) : 'Todas las entidades';
    return `📦 <b>${esc(objeto)}</b>\n🏛️ ${alcance}`;
  }

  private allowedFreqs(eff: EffectivePlan): SubFrequency[] {
    return eff === 'premium' ? ['hourly', 'daily', 'weekly'] : ['daily', 'weekly'];
  }

  private allowedDurs(eff: EffectivePlan): DurKey[] {
    return eff === 'premium' ? ['1d', '1w', '1m', 'inf'] : ['1d', '1w'];
  }

  private async effectivePlan(telegramId: string): Promise<EffectivePlan> {
    const premiumByRole = await this.roles.isPremiumByRole(telegramId);
    const u = await this.admin.findUser(telegramId);
    if (!u) return premiumByRole ? 'premium' : 'free';
    return this.plan.getEffectivePlan(u, new Date(), premiumByRole);
  }

  private toMenu(ctx: FlowContext, body: string): FlowResult {
    return {
      messages: [
        {
          kind: 'text',
          to: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          html: this.isTelegram,
          body,
        },
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { subDraft: undefined },
    };
  }
}

// ── helpers ──

function parseId(input: string, prefix: string): string | null {
  return input.startsWith(`${prefix}:`) ? input.slice(prefix.length + 1) : null;
}

/** Etiqueta de vigencia para "Mis alertas": días restantes o sin vencimiento. */
function vencimientoLabel(expiresAt: Date | null): string {
  if (!expiresAt) return 'Sin vencimiento';
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / MS_DAY);
  if (days <= 0) return 'Vence hoy';
  return `${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`;
}

function durationToDate(dur: DurKey): Date | null {
  switch (dur) {
    case '1d':
      return new Date(Date.now() + MS_DAY);
    case '1w':
      return new Date(Date.now() + 7 * MS_DAY);
    case '1m':
      return new Date(Date.now() + 30 * MS_DAY);
    case 'inf':
      return null;
  }
}

/** Filas para botones verticales (1 por fila). */
function buttonRows(n: number): number[] {
  return Array.from({ length: n }, () => 1);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
