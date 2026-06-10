import type { SearchFilters, TabName } from '../ports/persistence/types';

export interface SearchJobData {
  userId: string | null;
  tab: TabName;
  filters: SearchFilters;
  trace: {
    requestId: string;
    enqueuedAt: number;
  };
}

export interface SearchJobResult {
  source: 'live';
  inserted: number;
  updated: number;
  unchanged: number;
  rowCount: number;
  totalReported: number | null;
  totalPages: number | null;
  pagesScraped: number;
  durationMs: number;
  /** IDs de los procesos persistidos, en el orden en que SEACE los devolvió. */
  resultIds: string[];
}
