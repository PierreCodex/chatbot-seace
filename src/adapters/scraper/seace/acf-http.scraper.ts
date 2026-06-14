import { Injectable, Logger } from '@nestjs/common';
import { parse as parseHtml } from 'node-html-parser';
import type { ScrapeResult } from '../../../ports/scraper.port';
import type {
  ObjetoContratacion,
  ProcessRow,
  SearchFilters,
} from '../../../ports/persistence/types';
import { HtmlRowsParser } from './parsers/html-rows.parser';
import { seaceFetch } from './http.util';
import {
  SEACE_BUSCADOR_URL,
  SEACE_USER_AGENT,
  ScrapeValidationError,
  TAB_FORM_IDS,
} from './seace.types';

const FORM = TAB_FORM_IDS.anuncios_futuros; // tbBuscador:idFormbuscarACF
const F = (suffix: string): string => `${FORM}:${suffix}`;
const VIEWSTATE = 'javax.faces.ViewState';

const PAGE_SIZE = 15; // la página del datatable ACF es de 15 filas (≠ 10 de entidades)
const DEFAULT_MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES ?? 3);
const CRAWL_MAX_PAGES = 500; // efectivamente "todas" en el crawl 4×/día

const ALL_OBJETOS: ObjetoContratacion[] = ['bien', 'servicio', 'obra', 'consultoria_obra'];

/** Etiqueta visible del `<option>` en el select Objeto de Contratación. */
const OBJETO_LABEL: Record<ObjetoContratacion, string> = {
  bien: 'Bien',
  servicio: 'Servicio',
  obra: 'Obra',
  consultoria_obra: 'Consultoría de Obra',
};

/** Valores conocidos del select (respaldo si no se parsean del HTML). */
const OBJETO_VALUE_FALLBACK: Record<ObjetoContratacion, string> = {
  bien: '62',
  consultoria_obra: '63',
  obra: '64',
  servicio: '65',
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface HttpSession {
  cookieHeader: string;
  viewState: string;
  /** Valor del `<option>` (`cbxObjContratacion_input`) por cada objeto. */
  valueByObjeto: Record<ObjetoContratacion, string>;
}

/** Conteo de un upsert idempotente (lo que devuelve `ProcessesRepoPort.upsertMany`). */
export interface PageUpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface AcfCrawlOptions {
  objetos?: ObjetoContratacion[];
  keyword?: string;
  maxPagesPerObjeto?: number;
  pauseMs?: number;
  /**
   * Modo incremental: como el datatable viene ordenado por Fecha de Publicación
   * DESC (lo nuevo primero), en cuanto una página entera resulta "sin cambios"
   * (inserted+updated === 0) el resto es más antiguo y ya está en BD → se corta
   * la paginación de ese objeto. Requiere `onPage` que devuelva los conteos.
   */
  incremental?: boolean;
  /**
   * Hook por página: persiste el lote y devuelve los conteos del upsert. Es lo
   * que habilita el early-stop incremental. Usar `onPage` **o** `onChunk`, no
   * ambos (doble upsert).
   */
  onPage?: (p: {
    objeto: ObjetoContratacion;
    rows: ProcessRow[];
    pageIdx: number;
  }) => Promise<PageUpsertResult>;
  /** Hook por objeto (lote completo). Camino legacy de los scripts de pre-crawl. */
  onChunk?: (rows: ProcessRow[]) => Promise<void>;
  onProgress?: (p: {
    objeto: ObjetoContratacion;
    rowsSeen: number;
    pagesScraped: number;
    stoppedEarly: boolean;
  }) => void;
}

/**
 * Scraper de Anuncios de Contratación Futura (ACF) vía **fetch puro** (sin
 * Playwright), gemelo de `EntityFetchLookup`. La búsqueda ACF es un POST AJAX de
 * PrimeFaces que NO usa reCAPTCHA (`tokenBusACF` va vacío), y está en la pestaña
 * por defecto, así que un `GET` ya trae el formulario + ViewState + el select de
 * objeto. Flujo: `GET buscador` → cookies + ViewState + valores de objeto →
 * `POST buscar` (por objeto) → `POST paginar`. ~2-5s por objeto.
 *
 * Diferencias con entidades: página ACF de **15 filas**, Objeto **obligatorio**
 * (`cbxObjContratacion_input`), paginación por `dtResultadosACF_first`.
 */
@Injectable()
export class AcfHttpScraper {
  private readonly logger = new Logger(AcfHttpScraper.name);

  constructor(private readonly parser: HtmlRowsParser) {}

  /** Búsqueda on-demand de un objeto (compatible con `ScraperPort.search`). */
  async search(filters: SearchFilters, opts: { maxPages?: number } = {}): Promise<ScrapeResult> {
    if (!filters.objeto) {
      throw new ScrapeValidationError(['ACF requiere "Objeto de Contratación" (obligatorio)']);
    }
    const startedAt = Date.now();
    const sess = await this.openSession();
    const { rows, totalReported, totalPages, pagesScraped } = await this.searchObjeto(
      sess,
      filters.objeto,
      filters.keyword,
      opts.maxPages ?? DEFAULT_MAX_PAGES,
    );
    return { rows, totalReported, totalPages, pagesScraped, durationMs: Date.now() - startedAt };
  }

  /**
   * Recorrido para poblar `processes` (crawler F5): una sesión y luego los 4
   * objetos. En modo completo (`incremental:false`) pagina cada objeto hasta el
   * final; en modo `incremental` corta apenas una página viene sin cambios
   * (early-stop por orden DESC). Persiste por página vía `onPage` (con conteos,
   * habilita el early-stop) o por objeto vía `onChunk` (legacy). Idempotente
   * aguas abajo (dedup por contentHash).
   */
  async crawlAcf(opts: AcfCrawlOptions = {}): Promise<{ totalRows: number }> {
    const objetos = opts.objetos ?? ALL_OBJETOS;
    const maxPages = opts.maxPagesPerObjeto ?? CRAWL_MAX_PAGES;
    const pauseMs = opts.pauseMs ?? 500;

    let sess = await this.openSession();
    this.logger.log('sesión ACF HTTP lista (cookies + ViewState + valores de objeto)');

    const hook = { incremental: opts.incremental ?? false, onPage: opts.onPage };
    let total = 0;
    for (const objeto of objetos) {
      let result: Awaited<ReturnType<typeof this.searchObjeto>>;
      try {
        result = await this.searchObjeto(sess, objeto, opts.keyword, maxPages, hook);
      } catch (err) {
        this.logger.warn(`objeto "${objeto}" falló: ${(err as Error).message}; renovando sesión`);
        sess = await this.openSession();
        result = await this.searchObjeto(sess, objeto, opts.keyword, maxPages, hook);
      }

      if (opts.onChunk && result.rows.length > 0) await opts.onChunk(result.rows);
      total += result.rows.length;
      opts.onProgress?.({
        objeto,
        rowsSeen: result.rows.length,
        pagesScraped: result.pagesScraped,
        stoppedEarly: result.stoppedEarly,
      });
      if (pauseMs > 0) await delay(pauseMs);
    }

    this.logger.log(`crawl ACF HTTP: ${total} filas en ${objetos.length} objetos`);
    return { totalRows: total };
  }

  /** Una búsqueda completa (search + paginación) por HTTP para un objeto. */
  private async searchObjeto(
    sess: HttpSession,
    objeto: ObjetoContratacion,
    keyword: string | undefined,
    maxPages: number,
    hook?: {
      incremental: boolean;
      onPage?: (p: {
        objeto: ObjetoContratacion;
        rows: ProcessRow[];
        pageIdx: number;
      }) => Promise<PageUpsertResult>;
    },
  ): Promise<{
    rows: ProcessRow[];
    totalReported: number | null;
    totalPages: number | null;
    pagesScraped: number;
    stoppedEarly: boolean;
  }> {
    const objetoValue = sess.valueByObjeto[objeto];

    // 1) SEARCH: fija el filtro objeto server-side y reporta el total REAL ("del
    // total N", en el panel completo). NO reusamos sus filas: PrimeFaces conserva
    // el offset del datatable entre búsquedas → el SEARCH puede traer una página
    // arbitraria (no la 1).
    const first = this.parser.parseAnunciosFuturos(
      this.extractHtml(
        await this.post(sess, this.searchBody(objetoValue, keyword, sess.viewState)),
      ),
      FORM,
    );
    const totalReported = first.totalReported;
    const totalPages = first.totalPages;

    // 2) PAGINATE explícito por índice de página desde first=0. La paginación SÍ
    // honra el `first` enviado → recorremos 0, 15, 30… acotando con `totalReported`.
    const dedup = new Map<string, ProcessRow>();
    const pageLimit =
      totalReported != null ? Math.min(maxPages, Math.ceil(totalReported / PAGE_SIZE)) : maxPages;
    let pagesScraped = 0;
    let stoppedEarly = false;
    for (let pageIdx = 0; pageIdx < pageLimit; pageIdx++) {
      const body = this.paginateBody(objetoValue, keyword, pageIdx * PAGE_SIZE, sess.viewState);
      const pageRows = this.parser.parseAnunciosFuturosFragment(
        this.extractHtml(await this.post(sess, body)),
      );
      pagesScraped++;
      if (pageRows.length === 0) break;
      for (const r of pageRows) dedup.set(r.contentHash, r);

      // Persistencia + early-stop incremental: si la página entera ya estaba en
      // BD sin cambios, por el orden DESC todo lo siguiente también lo está.
      if (hook?.onPage) {
        const res = await hook.onPage({ objeto, rows: pageRows, pageIdx });
        if (hook.incremental && res.inserted + res.updated === 0) {
          stoppedEarly = true;
          break;
        }
      }

      if (totalReported == null && pageRows.length < PAGE_SIZE) break;
    }

    return { rows: [...dedup.values()], totalReported, totalPages, pagesScraped, stoppedEarly };
  }

  /** GET inicial: cookies + ViewState + valores del select Objeto desde el HTML. */
  private async openSession(): Promise<HttpSession> {
    const g = await seaceFetch(SEACE_BUSCADOR_URL, {
      headers: { 'user-agent': SEACE_USER_AGENT, accept: 'text/html' },
    });
    const cookieHeader = (g.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const html = await g.text();
    const viewState = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/)?.[1] ?? null;
    if (!cookieHeader || !viewState) {
      throw new Error(`openSession ACF incompleta (cookie=${!!cookieHeader} vs=${!!viewState})`);
    }
    return { cookieHeader, viewState, valueByObjeto: this.readObjetoValues(html) };
  }

  /** Parsea `<option value>` del select Objeto; cae al fallback conocido si falta. */
  private readObjetoValues(html: string): Record<ObjetoContratacion, string> {
    const out = { ...OBJETO_VALUE_FALLBACK };
    const select = parseHtml(html).querySelector('select[id$=":cbxObjContratacion_input"]');
    if (select) {
      const byLabel = new Map<string, string>();
      for (const opt of select.querySelectorAll('option')) {
        const label = opt.text.replace(/\s+/g, ' ').trim();
        const value = opt.getAttribute('value');
        if (label && value) byLabel.set(label, value);
      }
      for (const objeto of ALL_OBJETOS) {
        const v = byLabel.get(OBJETO_LABEL[objeto]);
        if (v) out[objeto] = v;
      }
    }
    return out;
  }

  /** POST AJAX a SEACE reusando cookies + ViewState; renueva el ViewState. */
  private async post(sess: HttpSession, body: string): Promise<string> {
    const res = await seaceFetch(SEACE_BUSCADOR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'faces-request': 'partial/ajax',
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/xml, text/xml, */*; q=0.01',
        'user-agent': SEACE_USER_AGENT,
        origin: 'https://prod2.seace.gob.pe',
        referer: SEACE_BUSCADOR_URL,
        cookie: sess.cookieHeader,
      },
      body,
    });
    const text = await res.text();
    if (text.includes('ViewExpiredException')) throw new Error('ViewExpiredException');
    const vs = this.extractViewState(text);
    if (vs) sess.viewState = vs;
    return text;
  }

  /** Campos comunes del form ACF (mayormente vacíos) + objeto + keyword. */
  private formFields(objetoValue: string, keyword: string | undefined): Record<string, string> {
    return {
      [F('hddNumeroRuc')]: '',
      [F('nombreEntidad')]: '',
      [F('cbxTipoSeleccion_input')]: '',
      [F('cbxTipoSeleccion_focus')]: '',
      [F('cbxObjContratacion_input')]: objetoValue,
      [F('cbxObjContratacion_focus')]: '',
      [F('dfechaInicioPubACF_input')]: '',
      [F('dfechaFinPubACF_input')]: '',
      [F('descripcionObjeto')]: keyword ?? '',
      [F('dfechaInicioAproxConvACF_input')]: '',
      [F('dfechaFinAproxConvACF_input')]: '',
      [F('tokenBusACF')]: '',
      [F('txtNombreEntidad')]: '',
      [F('txtRucEntidad')]: '',
      [F('txtsigla')]: '',
    };
  }

  private searchBody(objetoValue: string, keyword: string | undefined, viewState: string): string {
    return new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': F('btnBuscarSel'),
      'javax.faces.partial.execute': FORM,
      'javax.faces.partial.render': `${F('pnlGrdResultadosAnuncioContratacionFutura')} frmMesajes:gPrincipal ${F('btnBuscarSel')} ${F('tipoSeleccion')} ${F('cbxObjContratacion')}`,
      [F('btnBuscarSel')]: F('btnBuscarSel'),
      submit: 'S',
      [FORM]: FORM,
      ...this.formFields(objetoValue, keyword),
      [VIEWSTATE]: viewState,
    }).toString();
  }

  private paginateBody(
    objetoValue: string,
    keyword: string | undefined,
    first: number,
    viewState: string,
  ): string {
    return new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': F('dtResultadosACF'),
      'javax.faces.partial.execute': F('dtResultadosACF'),
      'javax.faces.partial.render': F('dtResultadosACF'),
      'javax.faces.behavior.event': 'page',
      'javax.faces.partial.event': 'page',
      [F('dtResultadosACF_pagination')]: 'true',
      [F('dtResultadosACF_first')]: String(first),
      [F('dtResultadosACF_rows')]: String(PAGE_SIZE),
      [F('dtResultadosACF_encodeFeature')]: 'true',
      [FORM]: FORM,
      ...this.formFields(objetoValue, keyword),
      [VIEWSTATE]: viewState,
    }).toString();
  }

  private extractHtml(xml: string): string {
    const blocks = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/g);
    if (!blocks) return xml;
    return blocks.map((b) => b.slice(9, -3)).join('\n');
  }

  private extractViewState(xml: string): string | null {
    return xml.match(/id="[^"]*ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/)?.[1] ?? null;
  }
}
