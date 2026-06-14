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

// v5: invalida el cache previo. v4 guardaba el ruido puro-trigram (ej. "universidad
// nacional de frontera" → 69); v5 descarta ese ruido cuando hay matches reales.
const CACHE_PREFIX = 'entity-query:v5:';
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h
const RESULT_LIMIT = 300; // tope del modal de SEACE; ≤10 → lista nativa, >10 → PDF

/**
 * Resolución de entidades. La fuente **autoritativa** es SEACE en vivo (lookup
 * por fetch puro, `ENTITY_LOOKUP_PORT`), idéntica a la web y sin Playwright. La
 * tabla local (`entities`) aporta matching difuso por-palabra y resiliencia:
 *
 *  1. Cache Redis (L1, 24h) por query normalizada — repeticiones instantáneas.
 *  2. **En vivo + local en paralelo, unidos por RUC**:
 *     - *vivo* trae lo que la tabla local no tenga (catálogo completo de SEACE);
 *     - *local* (ILIKE por-palabra) cubre queries abreviadas/multi-palabra que
 *       el "contiene" literal de SEACE no matchea (ej. "muni sullana").
 *     Los resultados en vivo se persisten → la tabla local se auto-sana.
 *  3. Si SEACE falla (red/caído), se degrada a solo-local.
 *
 * RUC exacto (11 dígitos) resuelve directo: local por clave, y si falta, en vivo.
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
    const raw = query.trim();
    const q = normalizeQuery(query);
    if (!q) return [];

    // RUC exacto (11 dígitos): resolución directa por clave.
    const digits = q.replace(/\D/g, '');
    if (/^\d{11}$/.test(digits)) return this.byRuc(digits);

    // L1: cache de una búsqueda previa (ya unida vivo+local).
    const cacheKey = `${CACHE_PREFIX}${q}`;
    const cached = await this.cache.get<EntityLookupMatch[]>(cacheKey);
    if (cached && cached.length > 0) {
      this.logger.debug(`entity-search L1 hit "${q}" (${cached.length})`);
      return cached.slice(0, RESULT_LIMIT);
    }

    // En vivo (autoritativo) + local (difuso) en paralelo. Mando el texto crudo
    // a SEACE (conserva tildes que su "contiene" necesita) y el normalizado al local.
    const [liveR, localR] = await Promise.allSettled([
      this.lookup.searchByNombre(raw),
      this.entities.searchByText(q, RESULT_LIMIT),
    ]);
    const live = liveR.status === 'fulfilled' ? liveR.value : [];
    if (liveR.status === 'rejected') {
      this.logger.warn(`entity-search en vivo falló "${raw}": ${liveR.reason?.message}`);
    }
    const local = localR.status === 'fulfilled' ? localR.value.map(toMatch) : [];

    if (live.length > 0) await this.persist(live);

    const merged = dedupByRuc([...live, ...local]);

    // Short-circuit de match exacto: si el texto ES el nombre de una entidad, el
    // usuario escribió el nombre completo y quiere ESA, no una lista de homónimos
    // parciales (todas las "MUNICIPALIDAD DISTRITAL DE …" que el trigram arrastra).
    // Colapsa a la(s) coincidencia(s) exacta(s) → el flujo muestra ficha directa.
    const exact = merged.filter((m) => normalizeQuery(m.nombre) === q);
    // Si no hay exacto, ordena por relevancia para que la lista ≤10 (o el PDF >10)
    // muestre primero lo más parecido, no el orden arbitrario vivo-primero.
    const result = exact.length > 0 ? exact : rankByRelevance(merged, q);

    this.logger.debug(
      `entity-search "${raw}" · vivo=${live.length} local=${local.length} → ${merged.length}` +
        (exact.length > 0 ? ` (exacto: ${exact.length})` : ''),
    );
    if (result.length > 0) {
      await this.cache.set(cacheKey, result.slice(0, RESULT_LIMIT), CACHE_TTL_SECONDS);
    }
    return result.slice(0, RESULT_LIMIT);
  }

  private async byRuc(digits: string): Promise<EntityLookupMatch[]> {
    const found = await this.entities.findByRuc(digits);
    if (found) return [toMatch(found)];
    if (this.lookup.searchByRuc) {
      try {
        const live = await this.lookup.searchByRuc(digits);
        if (live.length > 0) {
          await this.persist(live);
          return live;
        }
      } catch (err) {
        this.logger.warn(`entity-search RUC en vivo falló: ${(err as Error).message}`);
      }
    }
    return [];
  }

  /** Persiste los matches autoritativos de SEACE → auto-sana la tabla local. */
  private async persist(matches: EntityLookupMatch[]): Promise<void> {
    await this.entities
      .upsertManyByRuc(matches.map((m) => ({ ruc: m.ruc, nombre: m.nombre, tipoDoc: m.tipoDoc })))
      .catch((err) => this.logger.warn(`entity-search upsert: ${(err as Error).message}`));
  }
}

function dedupByRuc(matches: EntityLookupMatch[]): EntityLookupMatch[] {
  const seen = new Map<string, EntityLookupMatch>();
  for (const m of matches) if (!seen.has(m.ruc)) seen.set(m.ruc, m);
  return [...seen.values()];
}

/**
 * Ordena por cercanía al texto: exacto → empieza-con → contiene-substring →
 * contiene-todas-las-palabras → resto (solo trigram). Desempata por nombre más
 * corto (más específico).
 *
 * Además **descarta el ruido puro-trigram** (score 4) cuando hay coincidencias
 * reales (≤3): así "universidad nacional de frontera" devuelve solo la(s) que
 * contiene(n) "frontera", no las ~68 "UNIVERSIDAD NACIONAL DE …" que el trigram
 * arrastra por parecido. Si TODO es trigram (typo, sin match real), se conserva.
 */
function rankByRelevance(matches: EntityLookupMatch[], q: string): EntityLookupMatch[] {
  const words = q.split(' ').filter(Boolean);
  const score = (m: EntityLookupMatch): number => {
    const n = normalizeQuery(m.nombre);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    if (words.length > 0 && words.every((w) => n.includes(w))) return 3;
    return 4;
  };
  const scored = matches.map((m) => ({ m, s: score(m) }));
  const best = scored.reduce((min, x) => (x.s < min ? x.s : min), 4);
  const kept = best <= 3 ? scored.filter((x) => x.s <= 3) : scored;
  return kept.sort((a, b) => a.s - b.s || a.m.nombre.length - b.m.nombre.length).map((x) => x.m);
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
