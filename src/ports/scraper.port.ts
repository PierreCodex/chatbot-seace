import type { ProcessRow, SearchFilters, TabName } from './persistence/types';

export interface ScrapeResult {
  rows: ProcessRow[];
  totalReported: number | null;
  totalPages: number | null;
  pagesScraped: number;
  durationMs: number;
}

export interface ScraperPort {
  search(tab: TabName, filters: SearchFilters): Promise<ScrapeResult>;
}

export const SCRAPER_PORT = Symbol('SCRAPER_PORT');
