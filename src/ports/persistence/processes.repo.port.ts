import type { Process as PrismaProcess } from '@prisma/client';
import type { Duration, ProcessRow, SearchFilters, TabName } from './types';

export type StoredProcess = PrismaProcess;

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /**
   * IDs de las filas afectadas en el orden del input.
   * Las filas que fallaron al persistir no aparecen.
   */
  ids: string[];
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
