import { Injectable } from '@nestjs/common';
import type {
  EntityLookupMatch,
  EntityLookupOptions,
  EntityLookupPort,
} from '../../../ports/entity-lookup.port';
import { EntityRowsParser } from './parsers/entity-rows.parser';
import { SEACE_BUSCADOR_URL, SEACE_USER_AGENT, TAB_FORM_IDS } from './seace.types';

// Modal "Buscar Entidad" de la pestaña ACF (la pestaña por defecto → presente en
// el HTML inicial, sin necesidad de cambiar de tab).
const FORM = TAB_FORM_IDS.anuncios_futuros; // tbBuscador:idFormbuscarACF
const LUPA = `${FORM}:ajax`;
const INPUT_NOMBRE = `${FORM}:txtNombreEntidad`;
const INPUT_RUC = `${FORM}:txtRucEntidad`;
const BTN_BUSCAR = `${FORM}:btnBuscarEntidad`;
const DATATABLE = `${FORM}:dataTable`;
const VIEWSTATE = 'javax.faces.ViewState';

const PAGE_SIZE = 10; // filas por página del datatable del modal
// El modal topa en 300 coincidencias; 30 páginas las cubre. El loop corta solo
// en cuanto una página viene incompleta, así que las búsquedas específicas
// (pocas entidades) siguen siendo rápidas; solo las muy genéricas pagina más.
// Antes era 5 (tope 50) y cortaba búsquedas reales como "Lima" (67 en la web).
const DEFAULT_MAX_PAGES = 30;

interface Session {
  cookie: string;
  viewState: string;
}

/**
 * Búsqueda de entidades por **fetch puro** (sin Playwright). El modal "Buscar
 * Entidad" de SEACE no usa reCAPTCHA (`tokenBusProSel` vacío), así que basta:
 *
 *   GET buscador → cookies (JSESSIONID, X-Oracle-BMC-LBS-Route) + ViewState del HTML
 *   POST abrir-modal (lupa ajax) → POST buscar (txtNombreEntidad|txtRucEntidad)
 *
 * Es **autoritativo** (idéntico a la web) y rápido (~1-2s), a diferencia del
 * `EntityModalScraper` (Playwright, ~3 min). Lo usa `EntitySearchService` como
 * fuente en vivo principal; la tabla local queda como cache/respaldo.
 */
@Injectable()
export class EntityFetchLookup implements EntityLookupPort {
  constructor(private readonly parser: EntityRowsParser) {}

  searchByNombre(q: string, opts?: EntityLookupOptions): Promise<EntityLookupMatch[]> {
    return this.liveSearch(INPUT_NOMBRE, q.trim(), opts?.maxPages ?? DEFAULT_MAX_PAGES);
  }

  /** Búsqueda en vivo por RUC exacto (campo txtRucEntidad del modal). */
  searchByRuc(ruc: string, opts?: EntityLookupOptions): Promise<EntityLookupMatch[]> {
    return this.liveSearch(INPUT_RUC, ruc.trim(), opts?.maxPages ?? 1);
  }

  private async liveSearch(
    field: string,
    value: string,
    maxPages: number,
  ): Promise<EntityLookupMatch[]> {
    if (!value) return [];
    const session = await this.openSession();

    // SEARCH: filtra el datatable del modal por nombre o RUC.
    const searchBody = this.buildBody({
      'javax.faces.source': BTN_BUSCAR,
      'javax.faces.partial.execute': FORM,
      'javax.faces.partial.render': DATATABLE,
      [BTN_BUSCAR]: BTN_BUSCAR,
      [FORM]: FORM,
      [field]: value,
      [VIEWSTATE]: session.viewState,
    });
    const dedup = new Map<string, EntityLookupMatch>();
    const first = this.parser.parseRowsFragment(
      this.extractHtml(await this.post(session, searchBody)),
    );
    for (const r of first) dedup.set(r.ruc, r);

    // PAGINATE por conteo de filas (sesión fresca → offset arranca en 0 limpio).
    let offset = first.length;
    let lastCount = first.length;
    let pages = 1;
    while (lastCount >= PAGE_SIZE && pages < maxPages) {
      const pageBody = this.buildBody({
        'javax.faces.source': DATATABLE,
        'javax.faces.partial.execute': DATATABLE,
        'javax.faces.partial.render': DATATABLE,
        [`${DATATABLE}_pagination`]: 'true',
        [`${DATATABLE}_first`]: String(offset),
        [`${DATATABLE}_rows`]: String(PAGE_SIZE),
        [`${DATATABLE}_encodeFeature`]: 'true',
        [FORM]: FORM,
        [field]: value,
        [VIEWSTATE]: session.viewState,
      });
      const rows = this.parser.parseRowsFragment(
        this.extractHtml(await this.post(session, pageBody)),
      );
      if (rows.length === 0) break;
      for (const r of rows) dedup.set(r.ruc, r);
      offset += rows.length;
      lastCount = rows.length;
      pages++;
    }

    return [...dedup.values()];
  }

  /** GET inicial (cookies + ViewState) + abrir el modal (lupa ajax). */
  private async openSession(): Promise<Session> {
    const g = await fetch(SEACE_BUSCADOR_URL, {
      headers: { 'user-agent': SEACE_USER_AGENT, accept: 'text/html' },
    });
    const cookie = (g.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const html = await g.text();
    const viewState =
      html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/)?.[1] ??
      this.extractViewState(html);
    if (!cookie || !viewState) {
      throw new Error(`openSession incompleta (cookie=${!!cookie} viewState=${!!viewState})`);
    }
    const session: Session = { cookie, viewState };

    // Abrir el modal (inicializa el datatable server-side).
    const openBody = this.buildBody({
      'javax.faces.source': LUPA,
      'javax.faces.partial.execute': LUPA,
      'javax.faces.partial.render': LUPA,
      [LUPA]: LUPA,
      [FORM]: FORM,
      [VIEWSTATE]: viewState,
    });
    await this.post(session, openBody);
    return session;
  }

  private async post(session: Session, body: string): Promise<string> {
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
        cookie: session.cookie,
      },
      body,
    });
    const text = await res.text();
    if (text.includes('ViewExpiredException')) throw new Error('ViewExpiredException');
    const vs = this.extractViewState(text);
    if (vs) session.viewState = vs;
    return text;
  }

  private buildBody(fields: Record<string, string>): string {
    const params = new URLSearchParams({ 'javax.faces.partial.ajax': 'true', ...fields });
    return params.toString();
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
