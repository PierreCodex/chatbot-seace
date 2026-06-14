import type { Process as PrismaProcess, ProcessAcf, ProcessProcedimiento } from '@prisma/client';
import type { Duration, ProcessRow, SearchFilters, TabName } from './types';

/**
 * Proceso con sus detalles 1:1 (CTI). `acf` está presente cuando
 * `tab='anuncios_futuros'`; `procedimiento` cuando `tab='procedimientos'`.
 * El otro queda `null`.
 */
export type StoredProcess = PrismaProcess & {
  acf: ProcessAcf | null;
  procedimiento: ProcessProcedimiento | null;
};

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /**
   * IDs de las filas afectadas en el orden del input.
   * Las filas que fallaron al persistir no aparecen.
   */
  ids: string[];
  /** IDs de las filas **recién creadas** (nuevas). Subconjunto de `ids`. Lo usa el
   * matcher de alertas para disparar solo por anuncios nuevos (no por re-scrapes). */
  insertedIds: string[];
}

export interface ProcessesRepoPort {
  findByFilters(
    tab: TabName,
    filters: SearchFilters,
    opts?: { maxAge?: Duration; limit?: number },
  ): Promise<StoredProcess[]>;

  upsertMany(rows: ProcessRow[]): Promise<UpsertResult>;

  findById(id: string): Promise<StoredProcess | null>;

  findManyByIds(ids: string[]): Promise<StoredProcess[]>;
}

export const PROCESSES_REPO = Symbol('PROCESSES_REPO');
