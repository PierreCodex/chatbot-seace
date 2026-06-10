import { Injectable, Logger } from '@nestjs/common';
import type { ScraperPort, ScrapeResult } from '../../../ports/scraper.port';
import type { ProcessRow, SearchFilters, TabName } from '../../../ports/persistence/types';
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
  ) {}

  async search(tab: TabName, filters: SearchFilters): Promise<ScrapeResult> {
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
      return {
        rows: allRows,
        totalReported,
        totalPages,
        pagesScraped,
        durationMs,
      };
    } finally {
      await jc.close();
    }
  }
}
