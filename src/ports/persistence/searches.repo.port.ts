import type { Prisma, Search as PrismaSearch } from '@prisma/client';
import type { Duration, SearchFilters, TabName } from './types';

export type StoredSearch = PrismaSearch;

export interface SearchRecordInput {
  userId?: string | null;
  tab: TabName;
  filters: SearchFilters;
  resultIds: string[];
  resultCount: number;
  source: 'live' | 'cache' | 'cached_db';
  durationMs?: number;
  error?: string | null;
}

export interface SearchesRepoPort {
  create(data: SearchRecordInput): Promise<StoredSearch>;
  findRecentByFilters(
    tab: TabName,
    filters: Prisma.InputJsonValue,
    maxAge: Duration,
  ): Promise<StoredSearch | null>;
}

export const SEARCHES_REPO = Symbol('SEARCHES_REPO');
