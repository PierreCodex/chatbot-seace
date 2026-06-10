import type { Entity as PrismaEntity } from '@prisma/client';

export type StoredEntity = PrismaEntity;

export interface EntityUpsertInput {
  ruc: string;
  nombre: string;
  sigla?: string | null;
  tipoDoc?: string | null;
}

export interface EntitiesRepoPort {
  searchByText(q: string, limit?: number): Promise<StoredEntity[]>;
  findByRuc(ruc: string): Promise<StoredEntity | null>;
  upsertManyByRuc(rows: EntityUpsertInput[]): Promise<{ inserted: number; updated: number }>;
}

export const ENTITIES_REPO = Symbol('ENTITIES_REPO');
