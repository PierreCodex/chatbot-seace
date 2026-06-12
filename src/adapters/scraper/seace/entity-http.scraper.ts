import { Injectable, Logger } from '@nestjs/common';
import { ContextFactory } from './browser/context.factory';
import { EntityRowsParser } from './parsers/entity-rows.parser';
import { SessionManager } from './session/session.manager';
import {
  SEACE_BUSCADOR_URL,
  SEACE_USER_AGENT,
  TAB_FORM_IDS,
  TAB_LINK_HASH,
  escId,
} from './seace.types';
import type { EntityLookupMatch } from '../../../ports/entity-lookup.port';
import type { EntityCrawlOptions, EntityCrawlProgress } from './entity-modal.scraper';

const FORM = TAB_FORM_IDS.procedimientos;
const LUPA_ID = `${FORM}:ajax`;
const DIALOG_ID = `${FORM}:frmBuscarEntidad`;
const INPUT_NOMBRE = `${FORM}:txtNombreEntidad`;
const BTN_BUSCAR_MODAL = `${FORM}:btnBuscarEntidad`;
const PAGINATOR_ID = `${FORM}:dataTable_paginator_bottom`;

const FIELD_NOMBRE = `${FORM}:txtNombreEntidad`;
const FIELD_FIRST = `${FORM}:dataTable_first`;
const VIEWSTATE = 'javax.faces.ViewState';

const DEFAULT_CRAWL_TERMS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const EXPANSION_CHARS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const MODAL_CAP = 300; // el modal topa en ~300 coincidencias por búsqueda
const PAGE_SIZE = 10; // filas por página del datatable del modal

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface HttpSession {
  cookieHeader: string;
  searchTemplate: string;
  paginateTemplate: string;
  viewState: string;
}

/**
 * Scraper de entidades vía **replay HTTP** (F4.5, optimización del barrido).
 *
 * El modal "Buscar Entidad" es un POST AJAX de PrimeFaces que NO usa reCAPTCHA
 * (`tokenBusProSel` va vacío) y responde un XML parcial con la tabla. En vez de
 * manejar el navegador por cada búsqueda (~20-30s c/u), hacemos **un bootstrap
 * con Playwright** (una sola vez: sesión con buen score + cookies + ViewState +
 * plantillas de body) y luego disparamos las búsquedas/paginación con `fetch`
 * (~1-2s c/u). Esto baja el crawl de horas a minutos.
 *
 * Los IDs `j_idt*` del form cambian por sesión, por eso la plantilla se captura
 * viva en el bootstrap y solo se intercambian los campos estables
 * (`txtNombreEntidad`, `dataTable_first`, `ViewState`).
 */
@Injectable()
export class EntityHttpScraper {
  private readonly logger = new Logger(EntityHttpScraper.name);

  constructor(
    private readonly contexts: ContextFactory,
    private readonly session: SessionManager,
    private readonly parser: EntityRowsParser,
  ) {}

  async crawlAllEntities(opts: EntityCrawlOptions = {}): Promise<{ totalUnique: number }> {
    const pauseMs = opts.pauseMsBetweenTerms ?? 300;
    const maxTermLength = opts.maxTermLength ?? 2;
    const chunkSize = opts.chunkSize ?? 100;
    const maxRequests = opts.maxPagesPerTerm ?? 35;
    const queue = [...(opts.terms ?? DEFAULT_CRAWL_TERMS)];

    const seen = new Set<string>();
    let buffer: EntityLookupMatch[] = [];
    const startedAt = Date.now();

    let sess = await this.bootstrap();
    this.logger.log('bootstrap HTTP listo (sesión + plantillas capturadas)');

    try {
      while (queue.length > 0) {
        const term = queue.shift() as string;
        let rows: EntityLookupMatch[] = [];
        let truncated = false;
        try {
          ({ rows, truncated } = await this.searchTerm(sess, term, maxRequests));
        } catch (err) {
          const msg = (err as Error).message;
          this.logger.warn(`término "${term}" falló: ${msg}; re-bootstrapeando sesión`);
          sess = await this.bootstrap();
          try {
            ({ rows, truncated } = await this.searchTerm(sess, term, maxRequests));
          } catch (err2) {
            this.logger.warn(
              `término "${term}" falló de nuevo: ${(err2 as Error).message}; lo salto`,
            );
          }
        }

        let newUnique = 0;
        for (const row of rows) {
          if (seen.has(row.ruc)) continue;
          seen.add(row.ruc);
          newUnique++;
          buffer.push(row);
        }

        if (truncated && term.length < maxTermLength) {
          for (const c of EXPANSION_CHARS) queue.push(`${term}${c}`);
        }

        if (opts.onChunk && buffer.length >= chunkSize) {
          const batch = buffer;
          buffer = [];
          await opts.onChunk(batch);
        }

        const progress: EntityCrawlProgress = {
          term,
          pages: 0,
          rowsSeen: rows.length,
          newUnique,
          totalUnique: seen.size,
          truncated,
        };
        opts.onProgress?.(progress);

        if (queue.length > 0 && pauseMs > 0) await delay(pauseMs);
      }

      if (opts.onChunk && buffer.length > 0) await opts.onChunk(buffer);
      this.logger.log(`crawl HTTP entidades: ${seen.size} únicas en ${Date.now() - startedAt}ms`);
      return { totalUnique: seen.size };
    } finally {
      // nada que cerrar: el contexto del bootstrap ya se cerró.
    }
  }

  /**
   * Abre el navegador una sola vez para establecer una sesión legítima y
   * capturar: cookies, ViewState y las plantillas de body (búsqueda + paginación).
   */
  private async bootstrap(): Promise<HttpSession> {
    const jc = await this.contexts.create();
    const page = jc.page;
    let searchTemplate = '';
    let paginateTemplate = '';
    let viewState = '';

    page.on('request', (req) => {
      if (!req.url().includes('buscadorPublico') || req.method() !== 'POST') return;
      const raw = req.postData() ?? '';
      if (raw.includes('btnBuscarEntidad') && raw.includes('txtNombreEntidad='))
        searchTemplate = raw;
      else if (raw.includes('dataTable_pagination=true')) paginateTemplate = raw;
    });
    page.on('response', async (res) => {
      const req = res.request();
      if (!req.url().includes('buscadorPublico') || req.method() !== 'POST') return;
      const body = await res.text().catch(() => '');
      const vs = this.extractViewState(body);
      if (vs) viewState = vs;
    });

    try {
      await this.session.openBuscador(page);
      // switch a Procedimientos
      const link = page.locator(`a[href="${TAB_LINK_HASH.procedimientos}"]`).first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await this.session.waitForPrimefaces(page, 5_000);
      }
      // abrir modal
      await page.evaluate((id) => document.getElementById(id)?.click(), LUPA_ID);
      await this.session.waitForPrimefaces(page, 10_000);
      await page.waitForSelector(`#${escId(DIALOG_ID)}`, { state: 'visible', timeout: 5_000 });
      // buscar "a" → captura plantilla de búsqueda + varias páginas
      await this.fillAndSearch(page, 'a');
      await this.session.waitForPrimefaces(page, 20_000);
      await delay(800);
      // paginar una vez → captura plantilla de paginación
      await page.evaluate((id) => {
        const next = document.getElementById(id)?.querySelector('.ui-paginator-next');
        if (next && !(next as Element).classList.contains('ui-state-disabled'))
          (next as HTMLElement).click();
      }, PAGINATOR_ID);
      await this.session.waitForPrimefaces(page, 20_000);
      await delay(800);

      const cookies = await jc.context.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      if (!searchTemplate || !paginateTemplate || !viewState) {
        throw new Error(
          `bootstrap incompleto (search=${!!searchTemplate} paginate=${!!paginateTemplate} viewState=${!!viewState})`,
        );
      }
      return { cookieHeader, searchTemplate, paginateTemplate, viewState };
    } finally {
      await jc.close();
    }
  }

  private async fillAndSearch(page: import('playwright').Page, term: string): Promise<void> {
    await page.evaluate(
      ({ id, val }) => {
        const i = document.getElementById(id) as HTMLInputElement | null;
        if (!i) return;
        i.value = val;
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { id: INPUT_NOMBRE, val: term },
    );
    await page.evaluate((id) => document.getElementById(id)?.click(), BTN_BUSCAR_MODAL);
  }

  /** Una búsqueda completa (search + paginación) por HTTP para un término. */
  private async searchTerm(
    sess: HttpSession,
    term: string,
    maxRequests: number,
  ): Promise<{ rows: EntityLookupMatch[]; truncated: boolean }> {
    // 1) SEARCH: aplica el filtro server-side y devuelve la página 1.
    const searchBody = this.buildBody(sess.searchTemplate, {
      [FIELD_NOMBRE]: term,
      [VIEWSTATE]: sess.viewState,
    });
    const first = this.parser.parse(this.extractHtml(await this.post(sess, searchBody)), FORM);
    const all: EntityLookupMatch[] = [...first.rows];

    // 2) PAGINATE: a ciegas por conteo de filas. El texto del paginador
    // (".ui-paginator-current") lo rellena JS de PrimeFaces en el cliente, así
    // que en el XML crudo `totalPages` viene null. Mientras una página traiga
    // la página completa (PAGE_SIZE filas), asumimos que hay más; paramos cuando
    // una página trae menos (última) o 0, o al topar el cap del modal.
    if (first.rows.length >= PAGE_SIZE) {
      let offset = first.rows.length;
      let req = 0;
      while (req++ < maxRequests) {
        const body = this.buildBody(sess.paginateTemplate, {
          [FIELD_NOMBRE]: term,
          [FIELD_FIRST]: String(offset),
          [VIEWSTATE]: sess.viewState,
        });
        // La paginación devuelve los <tr> pelados (no el panel completo).
        const pageRows = this.parser.parseRowsFragment(
          this.extractHtml(await this.post(sess, body)),
        );
        if (pageRows.length === 0) break;
        all.push(...pageRows);
        offset += pageRows.length;
        if (pageRows.length < PAGE_SIZE) break;
        if (all.length >= MODAL_CAP) break;
      }
    }

    return { rows: all, truncated: all.length >= MODAL_CAP };
  }

  /** POST HTTP a SEACE reusando cookies + ViewState; renueva el ViewState. */
  private async post(sess: HttpSession, body: string): Promise<string> {
    const res = await fetch(SEACE_BUSCADOR_URL, {
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

  /** Construye un body desde una plantilla intercambiando campos (incl. ViewState). */
  private buildBody(template: string, overrides: Record<string, string>): string {
    const params = new URLSearchParams(template);
    for (const [k, v] of Object.entries(overrides)) params.set(k, v);
    return params.toString();
  }

  /** Extrae el HTML de los bloques CDATA del partial-response. */
  private extractHtml(xml: string): string {
    const blocks = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/g);
    if (!blocks) return xml;
    return blocks.map((b) => b.slice(9, -3)).join('\n');
  }

  private extractViewState(xml: string): string | null {
    const m = xml.match(/id="[^"]*ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/);
    return m ? m[1] : null;
  }
}
