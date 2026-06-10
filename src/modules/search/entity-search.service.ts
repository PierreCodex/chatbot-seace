import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import {
  ENTITY_LOOKUP_PORT,
  type EntityLookupMatch,
  type EntityLookupPort,
} from '../../ports/entity-lookup.port';
import {
  ENTITIES_REPO,
  type EntitiesRepoPort,
  type StoredEntity,
} from '../../ports/persistence/entities.repo.port';

const CACHE_PREFIX = 'entity-query:';
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h
const L2_MIN_MATCHES = 3;
const RESULT_LIMIT = 10;
const L3_MAX_PAGES = 3;

/**
 * Resolución de entidades con cascada L1 → L2 → L3.
 *
 *  L1 Redis cache (24h) por query normalizada — sirve repetidos instantáneo.
 *  L2 Trigram local en `entities` — si la DB ya tiene matches suficientes,
 *     evita un scrape (la tabla se va llenando con uso real).
 *  L3 Scrape on-demand del modal de SEACE — cachea L1 y persiste en DB para
 *     que la próxima vez el L2 ya alcance.
 */
@Injectable()
export class EntitySearchService {
  private readonly logger = new Logger(EntitySearchService.name);

  constructor(
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(ENTITIES_REPO) private readonly entities: EntitiesRepoPort,
    @Inject(ENTITY_LOOKUP_PORT) private readonly lookup: EntityLookupPort,
  ) {}

  async search(query: string): Promise<EntityLookupMatch[]> {
    const q = normalizeQuery(query);
    if (!q) return [];

    const cacheKey = `${CACHE_PREFIX}${q}`;
    const cached = await this.cache.get<EntityLookupMatch[]>(cacheKey);
    if (cached && cached.length > 0) {
      this.logger.debug(`entity-search L1 hit "${q}" (${cached.length})`);
      return cached.slice(0, RESULT_LIMIT);
    }

    const local = await this.entities.searchByText(q, RESULT_LIMIT);
    if (local.length >= L2_MIN_MATCHES) {
      this.logger.debug(`entity-search L2 hit "${q}" (${local.length})`);
      const matches = local.map(toMatch);
      await this.cache.set(cacheKey, matches, CACHE_TTL_SECONDS);
      return matches;
    }

    this.logger.log(`entity-search L3 miss "${q}", scrapeando modal de SEACE`);
    const scraped = await this.lookup.searchByNombre(q, { maxPages: L3_MAX_PAGES });
    if (scraped.length === 0) {
      this.logger.warn(`entity-search L3 "${q}" devolvió 0 entidades`);
      return [];
    }
    await this.entities
      .upsertManyByRuc(scraped.map((m) => ({ ruc: m.ruc, nombre: m.nombre, tipoDoc: m.tipoDoc })))
      .catch((err) => this.logger.warn(`entity-search upsert fallback: ${(err as Error).message}`));

    const top = scraped.slice(0, RESULT_LIMIT);
    await this.cache.set(cacheKey, top, CACHE_TTL_SECONDS);
    return top;
  }
}

function normalizeQuery(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toMatch(e: StoredEntity): EntityLookupMatch {
  return { ruc: e.ruc, nombre: e.nombre, tipoDoc: e.tipoDoc ?? null };
}
