import { Injectable, Logger } from '@nestjs/common';
import type { ScraperPort, ScrapeResult } from '../../../ports/scraper.port';
import type { ProcessRow, SearchFilters, TabName } from '../../../ports/persistence/types';
import { AcfHttpScraper } from './acf-http.scraper';
import { sameEntityName } from './entity-name.util';
import { ContextFactory } from './browser/context.factory';
import { SessionManager } from './session/session.manager';
import { TabStrategyRegistry } from './strategies/tab-strategy.registry';

const DEFAULT_MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES ?? 3);

@Injectable()
export class SeaceAdapter implements ScraperPort {
  private readonly logger = new Logger(SeaceAdapter.name);

  constructor(
    private readonly contexts: ContextFactory,
    private readonly session: SessionManager,
    private readonly strategies: TabStrategyRegistry,
    private readonly acfHttp: AcfHttpScraper,
  ) {}

  async search(tab: TabName, filters: SearchFilters): Promise<ScrapeResult> {
    const isAcf = tab === 'anuncios_futuros';
    // ACF se resuelve por replay HTTP (sin reCAPTCHA, ~10× más rápido); si algo
    // falla, cae al scrape por navegador de abajo.
    if (isAcf) {
      try {
        return this.filterByEntity(await this.acfHttp.search(filters), filters);
      } catch (err) {
        this.logger.warn(
          `[anuncios_futuros] replay HTTP falló (${(err as Error).message}); cae a navegador`,
        );
      }
    }

    const startedAt = Date.now();
    const strategy = this.strategies.get(tab);
    const jc = await this.contexts.create();
    try {
      this.logger.log(`[${tab}] abriendo buscador...`);
      await this.session.openBuscador(jc.page);
      await strategy.switchTo(jc.page);
      await strategy.applyFilters(jc.page, filters);
      this.logger.log(`[${tab}] filtros aplicados, lanzando búsqueda`);
      await strategy.search(jc.page);

      // Página 1
      const first = await strategy.parse(jc.page);
      const allRows: ProcessRow[] = [...first.rows];
      const totalReported = first.totalReported;
      const totalPages = first.totalPages;
      let pagesScraped = 1;
      this.logger.log(
        `[${tab}] página 1/${totalPages ?? '?'}: ${first.rows.length} filas (total reportado: ${totalReported ?? '?'})`,
      );

      // Páginas siguientes hasta el cap
      const maxPages = Math.min(DEFAULT_MAX_PAGES, totalPages ?? DEFAULT_MAX_PAGES);
      while (pagesScraped < maxPages) {
        const advanced = await strategy.goToNextPage(jc.page);
        if (!advanced) break;
        const parsed = await strategy.parse(jc.page);
        if (parsed.rows.length === 0) break;
        allRows.push(...parsed.rows);
        pagesScraped++;
        this.logger.log(
          `[${tab}] página ${pagesScraped}/${totalPages ?? '?'}: ${parsed.rows.length} filas (acumulado: ${allRows.length})`,
        );
      }

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `[${tab}] done: ${allRows.length} filas en ${pagesScraped} páginas / ${totalPages ?? '?'} totales (${durationMs}ms)`,
      );
      const result: ScrapeResult = {
        rows: allRows,
        totalReported,
        totalPages,
        pagesScraped,
        durationMs,
      };
      return isAcf ? this.filterByEntity(result, filters) : result;
    } finally {
      await jc.close();
    }
  }

  /**
   * Filtra ACF por entidad en cliente: SEACE no permite acotar los Anuncios de
   * Contratación Futura por entidad desde el form (solo por objeto), así que el
   * scrape trae todo el objeto y aquí nos quedamos con las filas de la entidad
   * pedida. Sin filtro de entidad → no toca nada. El `totalReported` de SEACE es
   * del objeto completo; con filtro el total real es el de las filas que quedan.
   */
  private filterByEntity(result: ScrapeResult, filters: SearchFilters): ScrapeResult {
    if (!filters.entityNombre) return result;
    const rows = result.rows.filter((r) => sameEntityName(r.entityNombre, filters.entityNombre));
    this.logger.log(
      `[anuncios_futuros] filtro entidad "${filters.entityNombre}": ${rows.length}/${result.rows.length} filas`,
    );
    return { ...result, rows, totalReported: rows.length, totalPages: null };
  }
}
