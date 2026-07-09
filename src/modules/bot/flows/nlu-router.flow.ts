import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tgDivider, tgEmoji, TG_EMOJI } from '../../../common/telegram-emoji';
import type { Env } from '../../../config/env.schema';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import { FILES_PORT, type FilesPort } from '../../../ports/files.port';
import type { ButtonOption, OutboundMessage } from '../../../ports/messaging.port';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
  type StoredProcess,
} from '../../../ports/persistence/processes.repo.port';
import type { ObjetoContratacion, SearchFilters } from '../../../ports/persistence/types';
import { FAQ_ANSWERS } from '../../ai/faq.answers';
import type { NluIntent } from '../../ai/intent.schema';
import { IntentService } from '../../ai/intent.service';
import { RerankService } from '../../ai/rerank.service';
import { ReplyComposerService } from '../../ai/reply-composer.service';
import { ResultsSummaryService } from '../../ai/results-summary.service';
import { EntitySearchService } from '../../search/entity-search.service';
import { AcfResultsPresenter } from '../../search/presenters/acf-results.presenter';
import { SearchFacade } from '../../search/search.facade';
import { MenuPresenter } from '../presenters/menu.presenter';
import type { Flow, FlowContext, FlowResult } from '../types';
import { EntityResolverFlow } from './entity-resolver.flow';
import { friendlyError } from './search-anuncios.flow';
import { SubscribeFlow } from './subscribe.flow';

const FLOW_ID = 'nlu';
const MAX_ENTITY_CHOICES = 10;
// Igual que SearchAnunciosFlow: se paginan 5; el PDF cubre el resto.
const ACF_PAGE_COUNT = 5;

type Step = 'awaiting-objeto' | 'entity-disambiguation';

interface FlowData {
  nluIntent?: NluIntent;
  nluCandidates?: EntityLookupMatch[];
}

/**
 * Estado de la lista de resultados ACF guardado en la conversación. Lo leen
 * MainMenuFlow (paginación ◀▶ `acfpage:N`) y el hub de rubros (`rubro:*`).
 * Los campos de rubros solo existen cuando la búsqueda vino del NLU y la
 * clasificación aportó; el wizard clásico sigue usando {ids,total,pdfUrl}.
 */
export interface AcfResultsState {
  /** Ids paginables de la VISTA ACTIVA (≤5; `acfpage:N` los recorre). */
  ids: string[];
  /** Total de la vista activa (encabezado "Se encontraron N"). */
  total: number;
  pdfUrl?: string | null;
  /** Todos los ids del resultado sin filtro (hasta 50) — para "Ver todos". */
  allIds?: string[];
  grandTotal?: number;
  /** Rubros del hub NLU: etiqueta + ids completos del subconjunto. pdfUrl del
   * rubro se genera lazy al entrar (undefined = no intentado; null = falló). */
  rubros?: { rubro: string; ids: string[]; pdfUrl?: string | null }[];
  activeRubro?: number | null;
  activeLabel?: string | null;
  /** PDF de la vista activa (rubro → PDF del rubro; todos → PDF general). */
  activePdfUrl?: string | null;
  /** Cuerpo HTML del hub, para re-renderizarlo con "🔙 Rubros". */
  hubBody?: string;
  /** Keyword original de la búsqueda (se restaura al salir de un rubro). */
  baseKeyword?: string | null;
}

const OBJETO_LABELS: Record<ObjetoContratacion, string> = {
  obra: 'Obra',
  bien: 'Bien',
  servicio: 'Servicio',
  consultoria_obra: 'Consultoría de Obra',
};

/**
 * Router NLU (docs/21 §3): recibe el texto libre "huérfano" que antes caía al
 * menú, lo interpreta con IntentService y ejecuta con las piezas existentes
 * (SearchFacade, EntitySearchService, presenters). La IA solo interpreta la
 * entrada; TODA respuesta sale de plantillas. Ante cualquier fallo del NLU,
 * `handleFreeText` devuelve null y MainMenuFlow muestra el menú de siempre.
 *
 *   texto libre ─▶ parse ─▶ buscar_acf ──(sin objeto)──▶ awaiting-objeto
 *                          │            └─(entidad ambigua)▶ entity-disambiguation
 *                          ├▶ crear_alerta (= búsqueda + nudge a 🔔 Avísame)
 *                          ├▶ ver_alertas / buscar_entidad (delegan a flujos)
 *                          └▶ faq / ayuda / fuera_de_alcance (plantillas)
 */
@Injectable()
export class NluRouterFlow implements Flow {
  readonly id = FLOW_ID;
  private readonly logger = new Logger(NluRouterFlow.name);
  private readonly isTelegram: boolean;

  constructor(
    private readonly intents: IntentService,
    private readonly rerank: RerankService,
    private readonly summary: ResultsSummaryService,
    private readonly composer: ReplyComposerService,
    private readonly entitySearch: EntitySearchService,
    private readonly searchFacade: SearchFacade,
    private readonly resultsPresenter: AcfResultsPresenter,
    private readonly menuPresenter: MenuPresenter,
    private readonly subscribeFlow: SubscribeFlow,
    private readonly entityFlow: EntityResolverFlow,
    @Inject(FILES_PORT) private readonly files: FilesPort,
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
    config: ConfigService<Env, true>,
  ) {
    this.isTelegram = config.get('MESSAGING_CHANNEL', { infer: true }) === 'telegram';
  }

  /** ¿El NLU está activo? (kill-switch + key presente). */
  get enabled(): boolean {
    return this.intents.enabled;
  }

  /** Pasos propios del flujo (re-pregunta de objeto / desambiguación). */
  async handle(ctx: FlowContext): Promise<FlowResult> {
    const data = (ctx.state.data ?? {}) as FlowData;
    switch (ctx.state.step as Step) {
      case 'awaiting-objeto':
        return this.onObjeto(ctx, data);
      case 'entity-disambiguation':
        return this.onEntityPicked(ctx, data);
      default:
        return (await this.handleFreeText(ctx)) ?? this.toMenu(ctx);
    }
  }

  /**
   * Punto de entrada desde MainMenuFlow con texto libre. Devuelve null cuando
   * el NLU no puede responder (apagado, sin key, timeout, parse inválido):
   * el caller muestra el menú — la experiencia previa, sin error visible.
   *
   * `opts.skip`: intents que el caller NO quiere que se manejen (devuelve null).
   * Lo usa la "segunda oportunidad" de los pasos de texto libre — p. ej. el
   * resolvedor de entidades re-parsea su input fallido pero excluye
   * `buscar_entidad` para no entrar en bucle consigo mismo.
   */
  async handleFreeText(
    ctx: FlowContext,
    opts?: { skip?: Array<NluIntent['intent']> },
  ): Promise<FlowResult | null> {
    const intent = await this.intents.parse(ctx.input);
    if (!intent) return null;
    if (opts?.skip?.includes(intent.intent)) return null;

    switch (intent.intent) {
      case 'buscar_acf':
      case 'crear_alerta':
        return this.runAcf(ctx, intent);
      case 'ver_alertas': {
        const r = await this.subscribeFlow.startManage(ctx);
        return { ...r, nextFlowId: r.nextFlowId ?? 'subscribe' };
      }
      case 'buscar_entidad': {
        const query = intent.entidadQuery ?? intent.entidad ?? ctx.input;
        const r = await this.entityFlow.handle({
          ...ctx,
          input: query,
          state: { ...ctx.state, flowId: 'entity-resolver', step: 'awaiting-query' },
        });
        return { ...r, nextFlowId: r.nextFlowId ?? 'entity-resolver' };
      }
      case 'seguimiento_resultado':
        return this.handleSeguimientoResultado(ctx, intent);
      case 'faq': {
        if (intent.faqId) return this.replyWithHelpButton(ctx, FAQ_ANSWERS[intent.faqId]);
        const reply = await this.composer.compose({
          kind: 'ayuda',
          userText: ctx.input,
          userId: ctx.userId,
          yaBusco: Boolean(ctx.state.data?.lastAcf),
        });
        return this.replyWithHelpButton(ctx, reply ?? this.helpText());
      }
      case 'ayuda': {
        const reply = await this.composer.compose({
          kind: 'ayuda',
          userText: ctx.input,
          userId: ctx.userId,
          yaBusco: Boolean(ctx.state.data?.lastAcf),
        });
        return this.replyWithHelpButton(ctx, reply ?? this.helpText());
      }
      case 'fuera_de_alcance': {
        const reply = await this.composer.compose({
          kind: 'fuera_de_alcance',
          userText: ctx.input,
          userId: ctx.userId,
          yaBusco: Boolean(ctx.state.data?.lastAcf),
        });
        return this.replyWithHelpButton(
          ctx,
          reply ??
            'Eso se me escapa 😅 — yo sé de *contrataciones del Estado (SEACE)*.\n\n' +
              'Prueba algo como: _"obras para colegios en Piura"_.',
        );
      }
    }
  }

  // ── seguimiento sobre resultados ya mostrados (multi-turno) ──

  private async handleSeguimientoResultado(
    ctx: FlowContext,
    intent: NluIntent,
  ): Promise<FlowResult> {
    const res = ctx.state.data?.acfResults as AcfResultsState | undefined;
    if (!res?.ids?.length) {
      return this.replyWithHelpButton(
        ctx,
        'Primero hacé una búsqueda para poder responderte sobre sus resultados.',
      );
    }

    const ids = (res.allIds ?? res.ids).slice(0, ACF_PAGE_COUNT * 2);
    const processes = await this.processes.findManyByIds(ids);
    if (!processes.length) {
      return this.replyWithHelpButton(
        ctx,
        'No encontré los anuncios de esa búsqueda. Probá buscando de nuevo.',
      );
    }

    switch (intent.pregunta) {
      case 'ubicacion':
        return this.replyUbicacion(ctx, processes);
      case 'entidad':
        return this.replyEntidades(ctx, processes);
      case 'fechas':
        return this.replyFechas(ctx, processes);
      default:
        return this.replyUbicacion(ctx, processes);
    }
  }

  private replyUbicacion(ctx: FlowContext, processes: StoredProcess[]): FlowResult {
    const total = processes.length;
    const lines = processes.slice(0, 5).map((p, i) => {
      const entidad = esc(p.entityNombre ?? 'Entidad no disponible');
      const desc = esc(truncate(p.descripcion ?? '', 140));
      return `${i + 1}. <b>${entidad}</b>\n<i>${desc}</i>`;
    });
    const body =
      `📍 <b>Ubicación de ${total} anuncio${total === 1 ? '' : 's'}</b>\n` +
      tgDivider(8) +
      '\n' +
      lines.join('\n\n') +
      (total > 5 ? '\n\n<i>(mostrando 5 de ' + total + ')</i>' : '');
    return {
      messages: [
        textMsg(ctx, body, true),
        this.menuPresenter.helpButton(ctx.phoneNumberId, ctx.phoneNumber),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { nluIntent: undefined, nluCandidates: undefined },
    };
  }

  private replyEntidades(ctx: FlowContext, processes: StoredProcess[]): FlowResult {
    const counts = new Map<string, number>();
    for (const p of processes) {
      const k = p.entityNombre ?? 'Sin entidad';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const entries = Array.from(counts.entries()).slice(0, 10);
    const body =
      `🏛️ <b>Entidades de estos ${processes.length} anuncios</b>\n` +
      tgDivider(8) +
      '\n' +
      entries.map(([e, n]) => `• <b>${esc(e)}</b> — ${n}`).join('\n');
    return {
      messages: [
        textMsg(ctx, body, true),
        this.menuPresenter.helpButton(ctx.phoneNumberId, ctx.phoneNumber),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { nluIntent: undefined, nluCandidates: undefined },
    };
  }

  private replyFechas(ctx: FlowContext, processes: StoredProcess[]): FlowResult {
    const rango = fechaAproxRange(processes);
    const fechas = processes.slice(0, 5).map((p, i) => {
      const f = p.acf?.fechaAproxConv
        ? p.acf.fechaAproxConv.toLocaleDateString('es-PE', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : 'sin fecha';
      return `${i + 1}. <b>${esc(p.entityNombre ?? 'Entidad')}</b> — ${f}`;
    });
    const body =
      `🗓️ <b>Fechas aprox. de convocatoria</b>\n` +
      tgDivider(8) +
      '\n' +
      fechas.join('\n') +
      (rango ? `\n\n<i>Rango total: ${rango}</i>` : '');
    return {
      messages: [
        textMsg(ctx, body, true),
        this.menuPresenter.helpButton(ctx.phoneNumberId, ctx.phoneNumber),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { nluIntent: undefined, nluCandidates: undefined },
    };
  }

  // ── búsqueda ACF en lenguaje natural ──

  private async runAcf(ctx: FlowContext, intent: NluIntent): Promise<FlowResult> {
    // Objeto es obligatorio en SEACE: única re-pregunta del camino natural.
    if (!intent.objeto) {
      return {
        messages: [this.askObjetoMessage(ctx, intent)],
        nextFlowId: FLOW_ID,
        nextStep: 'awaiting-objeto',
        dataPatch: { nluIntent: intent, nluCandidates: undefined },
      };
    }

    // Resolver entidad/ubicación contra el catálogo (docs/21 §3.4).
    const notices: string[] = [];
    let entity: { ruc: string; nombre: string } | undefined;
    let entityNombres: string[] | undefined;

    if (intent.entidad) {
      const matches = await this.searchEntities(intent.entidad);
      if (matches === null) return this.errorResult(ctx);
      if (matches.length === 0) {
        notices.push(`No encontré la entidad «${intent.entidad}» — te muestro sin ese filtro.`);
      } else if (matches.length === 1) {
        entity = { ruc: matches[0].ruc, nombre: matches[0].nombre };
      } else {
        // Ambigua → desambiguación con botones (la IA no adivina cuál muni era).
        const top = matches.slice(0, MAX_ENTITY_CHOICES);
        return {
          messages: [this.entityListMessage(ctx, matches.length, top)],
          nextFlowId: FLOW_ID,
          nextStep: 'entity-disambiguation',
          dataPatch: { nluIntent: intent, nluCandidates: top },
        };
      }
    } else if (intent.ubicacion) {
      const matches = await this.searchEntities(intent.ubicacion);
      if (matches === null) return this.errorResult(ctx);
      if (matches.length === 0) {
        notices.push(`No pude acotar por «${intent.ubicacion}» — te muestro sin ese filtro.`);
      } else {
        // "En Piura" = anuncios de TODAS las entidades cuyo nombre matchea la
        // zona. El copy dice "entidades de X" (ACF no tiene campo región).
        entityNombres = matches.map((m) => m.nombre);
      }
    }

    return this.doSearch(ctx, intent, { entity, entityNombres, notices });
  }

  private async doSearch(
    ctx: FlowContext,
    intent: NluIntent,
    opts: {
      entity?: { ruc: string; nombre: string };
      entityNombres?: string[];
      notices: string[];
    },
  ): Promise<FlowResult> {
    const objeto = intent.objeto as ObjetoContratacion;
    const keywords = dedupTerms([intent.keyword, ...intent.sinonimos]);
    const excludeKeywords = dedupTerms(intent.excluir);

    const filters: SearchFilters = { objeto };
    if (opts.entity) filters.entityNombre = opts.entity.nombre;
    else if (opts.entityNombres?.length) filters.entityNombres = opts.entityNombres;
    if (keywords.length) filters.keywords = keywords;
    if (excludeKeywords.length) filters.excludeKeywords = excludeKeywords;

    // "⏳ Consultando…" — cubre BD + re-rank (~1-2s). Se borra al responder.
    const status = await ctx.notify(this.consultandoMsg(ctx));
    const del = status.messageId ? [status.messageId] : [];

    let processes: StoredProcess[];
    try {
      const outcome = await this.searchFacade.search({
        userId: ctx.userId,
        phoneNumber: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        tab: 'anuncios_futuros',
        filters,
      });
      if (outcome.source === 'queued') {
        // Raro en ACF (BD-first + guard del facade), pero el listener entrega.
        return {
          messages: [this.buscandoMsg(ctx)],
          nextFlowId: 'main-menu',
          nextStep: 'awaiting-selection',
          dataPatch: this.resetPatch(intent, opts.entity),
          deleteMessageIds: del,
        };
      }
      processes = outcome.processes;

      // Degradación útil (docs/21 anexo §9 caso 6): sin match con la keyword →
      // mostrar lo que sí hay del objeto/entidad, avisando.
      if (processes.length === 0 && keywords.length) {
        const rest: SearchFilters = { ...filters };
        delete rest.keywords;
        delete rest.excludeKeywords;
        const fallback = await this.searchFacade.search({
          userId: ctx.userId,
          phoneNumber: ctx.phoneNumber,
          phoneNumberId: ctx.phoneNumberId,
          tab: 'anuncios_futuros',
          filters: rest,
        });
        if (fallback.source !== 'queued' && fallback.processes.length > 0) {
          processes = fallback.processes;
          opts.notices.push(
            `No encontré anuncios de «${intent.keyword}» — te muestro los de ` +
              `${OBJETO_LABELS[objeto]} que sí hay 👇`,
          );
        }
      } else if (processes.length > 1 && intent.keyword) {
        // Re-rank LLM: descarta falsos positivos del ILIKE. Falla → lista tal cual.
        processes = await this.rerank.filter(processes, {
          keyword: intent.keyword,
          sinonimos: intent.sinonimos,
          excluir: intent.excluir,
        });
      }
    } catch (err) {
      this.logger.warn(`búsqueda NLU falló: ${(err as Error).message}`);
      return { ...this.errorResult(ctx, friendlyError(err)), deleteMessageIds: del };
    }

    // "los 15 más recientes": el repo ya ordena por fecha desc.
    if (intent.limite != null && intent.limite > 0) {
      processes = processes.slice(0, intent.limite);
    }

    if (processes.length === 0) {
      return {
        messages: [...this.noticeMsgs(ctx, opts.notices), this.emptyMsg(ctx, intent, opts)],
        nextFlowId: 'main-menu',
        nextStep: 'awaiting-selection',
        dataPatch: this.resetPatch(intent, opts.entity),
        deleteMessageIds: del,
      };
    }

    // Nudge de alerta: "avísame de X" primero muestra la búsqueda; el botón
    // 🔔 Avísame hereda estos filtros vía lastAcf (SubscribeFlow.startCreate).
    if (intent.intent === 'crear_alerta') {
      opts.notices.push(
        'Esto es lo que hay HOY. Para que te avise de los nuevos, toca 🔔 *Avísame* en los resultados.',
      );
    }

    return this.presentResults(ctx, intent, opts, processes, del);
  }

  private async presentResults(
    ctx: FlowContext,
    intent: NluIntent,
    opts: { entity?: { ruc: string; nombre: string }; notices: string[] },
    processes: StoredProcess[],
    deleteMessageIds: string[],
  ): Promise<FlowResult> {
    const totalFound = processes.length;
    // PDF: como siempre con >5, o forzado si lo pidió ("dame el pdf de...").
    const wantsPdf = totalFound > ACF_PAGE_COUNT || intent.quierePdf;
    const pdfUrl = wantsPdf ? ((await this.files.hostAcfPdf(processes)) ?? undefined) : undefined;

    const notices = this.noticeMsgs(ctx, opts.notices);
    // Clasificación por rubros (docs/21 fase 2 adelantada): el LLM solo agrupa
    // (etiquetas + índices); el código cuenta y renderiza. En Telegram el
    // resumen es un HUB tocable con drill-down in-place; en WhatsApp, texto.
    const groups = totalFound >= 4 ? await this.summary.classify(processes) : null;
    const base = {
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      deleteMessageIds,
    };

    if (this.isTelegram) {
      const allIds = processes.map((p) => p.id);

      // Hub de rubros: UN solo mensaje; los botones navegan el set (rubro:*).
      if (groups && groups.length > 0) {
        const hubBody = this.hubBody(intent, totalFound, processes);
        const acfResults: AcfResultsState = {
          ids: allIds.slice(0, ACF_PAGE_COUNT),
          total: totalFound,
          pdfUrl: pdfUrl ?? null,
          allIds,
          grandTotal: totalFound,
          rubros: groups.map((g) => ({ rubro: g.rubro, ids: g.ids })),
          activeRubro: null,
          activeLabel: null,
          hubBody,
          baseKeyword: intent.keyword ?? null,
        };
        return {
          ...base,
          messages: [...notices, this.hubMessage(ctx, hubBody, acfResults)],
          dataPatch: { ...this.resetPatch(intent, opts.entity), acfResults },
        };
      }

      // Sin rubros (pocos resultados / clasificación falló): tarjeta clásica.
      const ids = allIds.slice(0, ACF_PAGE_COUNT);
      const header = this.resultsPresenter.resultsHeader({
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
      });
      const page0 = this.resultsPresenter.pageMessage({
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        process: processes[0],
        index: 0,
        pages: ids.length,
        total: totalFound,
        pdfUrl,
      });
      return {
        ...base,
        messages: [...notices, header, page0],
        dataPatch: {
          ...this.resetPatch(intent, opts.entity),
          acfResults: { ids, total: totalFound, pdfUrl: pdfUrl ?? null },
        },
      };
    }

    // WhatsApp: sin edición in-place → resumen informativo de texto + tarjetas.
    if (groups && groups.length > 0) {
      const objeto = intent.objeto ? OBJETO_LABELS[intent.objeto] : 'anuncios';
      const rango = fechaAproxRange(processes);
      const lineas = groups.map((g) => `▫️ ${g.rubro} — *${g.count}*`).join('\n');
      notices.push(
        textMsg(
          ctx,
          `📊 *${totalFound} anuncios de ${objeto}* — resumen por rubro\n\n${lineas}` +
            (rango ? `\n\n🗓️ Convocatorias aprox.: ${rango}` : ''),
        ),
      );
    }
    const messages = this.resultsPresenter.build({
      phoneNumber: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      totalFound,
      processes,
      pdfUrl,
    });
    return {
      ...base,
      messages: [...notices, ...messages],
      dataPatch: this.resetPatch(intent, opts.entity),
    };
  }

  // ── hub de rubros (Telegram, drill-down in-place) ──

  /**
   * Acciones de los botones del hub (`rubro:N` / `rubro:all` / `rubro:back`) —
   * llegan con estado main-menu y MainMenuFlow delega aquí. El MISMO mensaje
   * se edita entre el hub (resumen) y la tarjeta paginada del subconjunto.
   * Sin llamadas al LLM: los ids por rubro ya están en el estado.
   */
  async onRubroAction(ctx: FlowContext): Promise<FlowResult> {
    const res = (ctx.state.data?.acfResults ?? null) as AcfResultsState | null;
    const arg = ctx.input.slice('rubro:'.length);
    // Estado viejo (sesión expirada / botón antiguo): no romper, menú.
    if (!res?.rubros?.length) return this.toMenu(ctx);

    if (arg === 'back') {
      return {
        messages: [this.hubMessage(ctx, res.hubBody ?? '', res)],
        navigation: 'edit',
        nextFlowId: 'main-menu',
        nextStep: 'awaiting-selection',
        dataPatch: {
          acfResults: {
            ...res,
            ids: (res.allIds ?? res.ids).slice(0, ACF_PAGE_COUNT),
            total: res.grandTotal ?? res.total,
            activeRubro: null,
            activeLabel: null,
            activePdfUrl: res.pdfUrl ?? null,
          },
          lastAcf: this.lastAcfWithKeyword(ctx, res.baseKeyword ?? null),
        },
      };
    }

    let subsetIds: string[];
    let label: string | null;
    let activeRubro: number | null;
    let keyword: string | null;
    let viewPdf: string | null;
    let rubros = res.rubros;

    if (arg === 'all') {
      subsetIds = res.allIds ?? res.ids;
      label = null;
      activeRubro = null;
      keyword = res.baseKeyword ?? null;
      viewPdf = res.pdfUrl ?? null; // vista completa → PDF general
    } else {
      const n = Number(arg);
      const g = Number.isInteger(n) ? res.rubros[n] : undefined;
      if (!g) return this.toMenu(ctx);
      subsetIds = g.ids;
      label = g.rubro;
      activeRubro = n;
      // 🔔 Avísame desde un rubro hereda ese refinamiento (fase 2 lo congela).
      keyword = g.rubro;
      // PDF SOLO con los anuncios de este rubro (el general vive en el hub como
      // "Ver todos"). Lazy: se genera al entrar por primera vez y se cachea en
      // el estado; con ≤5 no hace falta (las tarjetas ya los muestran todos).
      viewPdf = g.pdfUrl ?? null;
      if (g.pdfUrl === undefined && subsetIds.length > ACF_PAGE_COUNT) {
        const subset = await this.processes.findManyByIds(subsetIds);
        viewPdf = (await this.files.hostAcfPdf(subset)) ?? null;
        rubros = res.rubros.map((r, i) => (i === n ? { ...r, pdfUrl: viewPdf } : r));
      }
    }

    const pageIds = subsetIds.slice(0, ACF_PAGE_COUNT);
    const first = pageIds.length ? await this.processes.findById(pageIds[0]) : null;
    if (!first) return this.toMenu(ctx);

    const page0 = this.resultsPresenter.pageMessage({
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      process: first,
      index: 0,
      pages: pageIds.length,
      total: subsetIds.length,
      pdfUrl: viewPdf ?? undefined,
      filterLabel: label ?? undefined,
      backToRubros: true,
    });
    return {
      messages: [page0],
      navigation: 'edit',
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: {
        acfResults: {
          ...res,
          rubros,
          ids: pageIds,
          total: subsetIds.length,
          activeRubro,
          activeLabel: label,
          // PDF de la VISTA activa: lo usa la paginación ◀▶ (onAcfPage).
          activePdfUrl: viewPdf,
        },
        lastAcf: this.lastAcfWithKeyword(ctx, keyword),
      },
    };
  }

  /** Cuerpo del hub (estado 1). Se guarda en el estado para "🔙 Rubros". */
  private hubBody(intent: NluIntent, total: number, processes: StoredProcess[]): string {
    const objeto = intent.objeto ? OBJETO_LABELS[intent.objeto] : 'anuncios';
    const rango = fechaAproxRange(processes);
    return (
      `📊 <b>${total} anuncios de ${esc(objeto)}</b> — por rubro\n` +
      tgDivider(8) +
      (rango ? `\n🗓️ Convocatorias aprox.: <code>${esc(rango)}</code>\n` : '\n') +
      `\n<i>Toca un rubro para ver solo esos 👇</i>`
    );
  }

  /** Hub tocable: resumen + botones de rubros / Ver todos / PDF / Menú. */
  private hubMessage(ctx: FlowContext, body: string, res: AcfResultsState): OutboundMessage {
    const rubros = res.rubros ?? [];
    const rubroButtons: ButtonOption[] = rubros.map((g, i) => ({
      id: `rubro:${i}`,
      title: `${rubroEmoji(g.rubro)} ${truncate(g.rubro, 22)} (${g.ids.length})`,
    }));
    // "Ver todos" ES el PDF completo (lista los N de una) — sin botón PDF
    // duplicado. Si no hay PDF hosteado, degrada a la tarjeta paginada.
    const total = res.grandTotal ?? res.total;
    const lastRow: ButtonOption[] = [
      res.pdfUrl
        ? {
            id: 'acf:pdf',
            title: `Ver todos (${total})`,
            url: res.pdfUrl,
            style: 'primary',
            iconCustomEmojiId: TG_EMOJI.pdfBtn.id,
          }
        : { id: 'rubro:all', title: `📋 Ver todos (${total})`, style: 'primary' },
    ];
    lastRow.push({
      id: 'menu:show',
      title: 'Menú',
      style: 'success',
      iconCustomEmojiId: TG_EMOJI.back.id,
    });
    const layout: number[] = [];
    for (let i = 0; i < rubroButtons.length; i += 2) {
      layout.push(Math.min(2, rubroButtons.length - i));
    }
    layout.push(lastRow.length);
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      html: true,
      body,
      buttons: [...rubroButtons, ...lastRow],
      buttonLayout: layout,
    };
  }

  /** lastAcf con la keyword del contexto activo (rubro elegido u original). */
  private lastAcfWithKeyword(ctx: FlowContext, keyword: string | null): Record<string, unknown> {
    const last = (ctx.state.data?.lastAcf ?? {}) as Record<string, unknown>;
    return { ...last, keyword, sinonimos: keyword ? [keyword] : [] };
  }

  // ── pasos propios ──

  /** Botón de objeto tras la re-pregunta ("qué hay para hospitales"). */
  private async onObjeto(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const raw = parseId(ctx.input, 'objeto');
    const intent = data.nluIntent;
    if (raw && intent && raw in OBJETO_LABELS) {
      return this.runAcf(ctx, { ...intent, objeto: raw as ObjetoContratacion });
    }
    // Texto libre en medio de la re-pregunta → es una consulta nueva.
    if (isFreeTextQuery(ctx.input)) {
      return (await this.handleFreeText(ctx)) ?? this.toMenu(ctx);
    }
    return this.toMenu(ctx);
  }

  /** Entidad elegida en la desambiguación. */
  private async onEntityPicked(ctx: FlowContext, data: FlowData): Promise<FlowResult> {
    const ruc = parseId(ctx.input, 'entity');
    const found = data.nluCandidates?.find((c) => c.ruc === ruc);
    const intent = data.nluIntent;
    if (found && intent) {
      return this.doSearch(ctx, intent, {
        entity: { ruc: found.ruc, nombre: found.nombre },
        notices: [],
      });
    }
    if (isFreeTextQuery(ctx.input)) {
      return (await this.handleFreeText(ctx)) ?? this.toMenu(ctx);
    }
    return this.toMenu(ctx);
  }

  // ── helpers ──

  /** null = error consultando entidades (SEACE caído y local falló). */
  private async searchEntities(query: string): Promise<EntityLookupMatch[] | null> {
    try {
      return await this.entitySearch.search(query);
    } catch (err) {
      this.logger.warn(`entidades NLU falló "${query}": ${(err as Error).message}`);
      return null;
    }
  }

  private resetPatch(
    intent: NluIntent,
    entity?: { ruc: string; nombre: string },
  ): Record<string, unknown> {
    return {
      nluIntent: undefined,
      nluCandidates: undefined,
      // Para 🔔 Avísame (SubscribeFlow hereda). keyword/sinonimos viajan ya
      // desde fase 1 para que la fase 2 los congele en la suscripción.
      lastAcf: {
        objeto: intent.objeto,
        entityRuc: entity?.ruc ?? null,
        entityNombre: entity?.nombre ?? null,
        keyword: intent.keyword,
        sinonimos: intent.sinonimos,
      },
    };
  }

  private toMenu(ctx: FlowContext): FlowResult {
    return {
      messages: [this.menuPresenter.build(ctx.phoneNumberId, ctx.phoneNumber)],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { nluIntent: undefined, nluCandidates: undefined },
    };
  }

  /** Respuesta conversacional de ayuda con un único botón para abrir el menú guiado. */
  private replyWithHelpButton(ctx: FlowContext, text: string): FlowResult {
    return {
      messages: [
        textMsg(ctx, text),
        this.menuPresenter.helpButton(ctx.phoneNumberId, ctx.phoneNumber),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { nluIntent: undefined, nluCandidates: undefined },
    };
  }

  private errorResult(ctx: FlowContext, text?: string): FlowResult {
    return {
      messages: [
        textMsg(
          ctx,
          text ?? '⚠️ Tuve un problema con esa consulta. Intenta de nuevo o usa el menú 👇',
        ),
        this.menuPresenter.build(ctx.phoneNumberId, ctx.phoneNumber),
      ],
      nextFlowId: 'main-menu',
      nextStep: 'awaiting-selection',
      dataPatch: { nluIntent: undefined, nluCandidates: undefined },
    };
  }

  private helpText(): string {
    return (
      '🤖 Escríbeme lo que buscas en lenguaje natural, por ejemplo:\n\n' +
      '💡 _"obras para colegios en Piura"_\n' +
      '💡 _"anuncios de servicios del GORE Cusco"_\n' +
      '💡 _"avísame cuando salgan hospitales"_\n\n' +
      'También puedo consultar el *RUC de una entidad* o enviarte un *PDF con resultados*.'
    );
  }

  private noticeMsgs(ctx: FlowContext, notices: string[]): OutboundMessage[] {
    return notices.map((n) => textMsg(ctx, `ℹ️ ${n}`));
  }

  private emptyMsg(
    ctx: FlowContext,
    intent: NluIntent,
    opts: { entity?: { ruc: string; nombre: string } },
  ): OutboundMessage {
    const objeto = intent.objeto ? OBJETO_LABELS[intent.objeto] : 'ese objeto';
    const alcance = opts.entity ? ` de ${opts.entity.nombre}` : '';
    const buttons: ButtonOption[] = [
      { id: 'acf:refine', title: '✏️ Nueva búsqueda' },
      { id: 'menu:main', title: '🏁 Menú' },
    ];
    if (this.isTelegram) {
      return {
        kind: 'buttons',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body: `🔍 No encontré anuncios futuros de <b>${esc(objeto)}</b>${esc(alcance)}.\n\n<i>¿Qué quieres hacer?</i>`,
        buttons: [
          { id: 'acf:refine', title: '✏️ Nueva búsqueda' },
          { id: 'menu:main', title: 'Menú', style: 'success', iconCustomEmojiId: TG_EMOJI.back.id },
        ],
        buttonLayout: [1, 1],
      };
    }
    return {
      kind: 'buttons',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `No encontré anuncios futuros de *${objeto}*${alcance}. ¿Qué quieres hacer?`,
      buttons,
    };
  }

  /** Re-pregunta de objeto conservando lo ya extraído ("qué hay para hospitales"). */
  private askObjetoMessage(ctx: FlowContext, intent: NluIntent): OutboundMessage {
    const tema = intent.keyword ? ` sobre «${intent.keyword}»` : '';
    if (this.isTelegram) {
      return {
        kind: 'buttons',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body:
          `${tgEmoji('anunciosHdr')} Encontré tu búsqueda${esc(tema)}.\n` +
          tgDivider(8) +
          '\n¿De qué <b>tipo de contratación</b>?',
        buttons: [
          { id: 'objeto:obra', title: '🏗️ Obra', style: 'primary' },
          { id: 'objeto:bien', title: '📦 Bien' },
          { id: 'objeto:servicio', title: '🛠️ Servicio' },
          { id: 'objeto:consultoria_obra', title: '📐 Consultoría de obra' },
          { id: 'menu:main', title: 'Menú', style: 'success', iconCustomEmojiId: TG_EMOJI.back.id },
        ],
        buttonLayout: [2, 2, 1],
      };
    }
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `Encontré tu búsqueda${tema}. ¿De qué *tipo de contratación*?`,
      buttonText: 'Elegir objeto',
      sections: [
        {
          title: 'Objeto de contratación',
          rows: (Object.entries(OBJETO_LABELS) as [ObjetoContratacion, string][]).map(
            ([id, title]) => ({ id: `objeto:${id}`, title }),
          ),
        },
      ],
    };
  }

  /** Desambiguación de entidad (misma UI que el wizard: botones entity:<ruc>). */
  private entityListMessage(
    ctx: FlowContext,
    total: number,
    top: EntityLookupMatch[],
  ): OutboundMessage {
    const note =
      total > top.length ? ` (te muestro ${top.length}; afina el nombre si no está)` : '';
    if (this.isTelegram) {
      return {
        kind: 'buttons',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body: `${tgEmoji('search')} <b>${total} entidad${total === 1 ? '' : 'es'}</b>${esc(note)} — elige una:`,
        buttons: top.map((m) => ({ id: `entity:${m.ruc}`, title: truncate(m.nombre, 40) })),
      };
    }
    return {
      kind: 'list',
      to: ctx.phoneNumber,
      phoneNumberId: ctx.phoneNumberId,
      body: `Encontré ${total} entidad${total === 1 ? '' : 'es'}${note}. Elige una:`,
      buttonText: 'Ver entidades',
      sections: [
        {
          title: 'Entidades',
          rows: top.map((m) => ({
            id: `entity:${m.ruc}`,
            title: truncate(m.nombre, 24),
            description: truncate(`${m.nombre} · RUC ${m.ruc}`, 72),
          })),
        },
      ],
    };
  }

  private consultandoMsg(ctx: FlowContext): OutboundMessage {
    if (this.isTelegram) {
      return {
        kind: 'text',
        to: ctx.phoneNumber,
        phoneNumberId: ctx.phoneNumberId,
        html: true,
        body: `${tgEmoji('loading')} <i>Buscando anuncios…</i>`,
      };
    }
    return textMsg(ctx, '🔎 Buscando anuncios…');
  }

  private buscandoMsg(ctx: FlowContext): OutboundMessage {
    return textMsg(
      ctx,
      '🔎 *Estoy buscando en el SEACE los anuncios más recientes para ti.*\n\n' +
        'Esto puede tomar hasta ~30 segundos ⏳ Te los envío aquí mismo. ✅',
    );
  }
}

// ── helpers de módulo ──

/** ¿Parece texto libre de usuario (no id de botón/comando)? Compartido con
 * MainMenuFlow para decidir cuándo intentar el NLU. */
export function isFreeTextQuery(input: string): boolean {
  const t = input.trim();
  if (t.length < 2 || t.length > 500) return false;
  if (/^[\w-]+:/.test(t)) return false; // ids de botones ("acf:buscar", "objeto:x")
  if (t.startsWith('/')) return false; // comandos
  return /\p{L}/u.test(t); // al menos una letra
}

/** Emoji cosmético por rubro (mapeo de plantilla; default genérico). */
function rubroEmoji(label: string): string {
  const l = label.toLowerCase();
  if (/(salud|hospital|m[eé]dic)/.test(l)) return '🩺';
  if (/(educa|colegio|escuela)/.test(l)) return '🎓';
  if (/(v[ií]a|transport|carretera|puente)/.test(l)) return '🛣️';
  if (/(energ|el[eé]ctric)/.test(l)) return '⚡';
  if (/(sanea|agua|desag)/.test(l)) return '🚰';
  if (/aliment/.test(l)) return '🍚';
  if (/(inform[aá]t|equipam|c[oó]mputo|tecnolog)/.test(l)) return '💻';
  if (/(seguridad|vigilancia)/.test(l)) return '🚨';
  if (/(veh[ií]culo|maquinaria)/.test(l)) return '🚜';
  if (/(constru|obra|edificac|infraestructura)/.test(l)) return '🏗️';
  return '🔹';
}

/** Rango de fechas aprox. de convocatoria del set (calculado, no del LLM). */
function fechaAproxRange(processes: StoredProcess[]): string | null {
  const fechas = processes
    .map((p) => p.acf?.fechaAproxConv)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  if (fechas.length === 0) return null;
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const min = fmt(fechas[0]);
  const max = fmt(fechas[fechas.length - 1]);
  return min === max ? min : `${min} – ${max}`;
}

function dedupTerms(terms: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const clean = t?.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function textMsg(ctx: FlowContext, body: string, html = false): OutboundMessage {
  return { kind: 'text', to: ctx.phoneNumber, phoneNumberId: ctx.phoneNumberId, body, html };
}

function parseId(input: string, prefix: string): string | null {
  if (!input.startsWith(`${prefix}:`)) return null;
  return input.slice(prefix.length + 1);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
