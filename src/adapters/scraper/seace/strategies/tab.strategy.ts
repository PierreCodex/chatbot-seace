import type { Page } from 'playwright';
import type { ProcessRow, SearchFilters, TabName } from '../../../../ports/persistence/types';

export interface ParsedPage {
  rows: ProcessRow[];
  totalReported: number | null;
  currentPage: number | null;
  totalPages: number | null;
}

export interface TabStrategy {
  readonly tab: TabName;
  readonly formId: string;

  switchTo(page: Page): Promise<void>;
  applyFilters(page: Page, filters: SearchFilters): Promise<void>;
  search(page: Page): Promise<void>;
  parse(page: Page): Promise<ParsedPage>;
  /** Devuelve true si pudo avanzar; false si era la última página. */
  goToNextPage(page: Page): Promise<boolean>;
}
