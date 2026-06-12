import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JOB_NAMES } from '../../jobs/job-types';
import type { SearchJobData } from '../../jobs/search.job';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
  type StoredProcess,
} from '../../ports/persistence/processes.repo.port';
import { SEARCHES_REPO, type SearchesRepoPort } from '../../ports/persistence/searches.repo.port';
import type { SearchFilters, TabName } from '../../ports/persistence/types';
import { hours } from '../../ports/persistence/types';
import { QUEUE_PORT, type QueuePort } from '../../ports/queue.port';

export interface SearchRequest {
  userId: string | null;
  phoneNumber?: string;
  phoneNumberId?: string;
  tab: TabName;
  filters: SearchFilters;
}

export type SearchOutcome =
  | { source: 'cached_db'; processes: StoredProcess[]; totalFound: number }
  | { source: 'cache'; processes: StoredProcess[]; totalFound: number }
  | { source: 'queued'; jobId: string };

export interface SearchJobContext {
  jobId: string;
  userId: string | null;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  tab: TabName;
  filters: SearchFilters;
  enqueuedAt: number;
}

const DB_FRESHNESS = hours(6);
const CACHE_PREFIX = 'search:cache:';
const CACHE_TTL_SECONDS = 30 * 60; // 30 min
const JOB_CTX_PREFIX = 'search:job:';
const JOB_CTX_TTL_SECONDS = 15 * 60; // 15 min — basta para que el scrape termine
const RESULT_LIMIT = 50;

/**
 * Orquesta una búsqueda de procesos en 3 niveles:
 *
 *  1. **DB-first**: si `processes` tiene resultados frescos (<6h) que matchean
 *     los filtros, los devuelve. Esto cubre repeats y crawler-prepoblados.
 *  2. **Cache Redis**: misma combinación de filtros pedida recientemente
 *     (TTL 30 min). Aplica cuando la DB no estaba lo suficientemente fresca
 *     pero ya alguien hizo el scrape live.
 *  3. **Encolar job**: cuando ni DB ni cache resuelven, encola un job de
 *     scrape y guarda en Redis `search:job:<jobId>` el contexto necesario
 *     para que `SearchResultsListener` enrute el resultado al usuario.
 *
 * El logging en `searches` se hace al resolver desde DB/cache aquí mismo, y
 * desde el listener cuando el resultado viene del scrape live.
 */
@Injectable()
export class SearchFacade {
  private readonly logger = new Logger(SearchFacade.name);

  constructor(
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
    @Inject(SEARCHES_REPO) private readonly searches: SearchesRepoPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  async search(req: SearchRequest): Promise<SearchOutcome> {
    const startedAt = Date.now();

    // 1) DB-first.
    const fresh = await this.processes.findByFilters(req.tab, req.filters, {
      maxAge: DB_FRESHNESS,
      limit: RESULT_LIMIT,
    });
    if (fresh.length > 0) {
      this.logger.debug(`DB-first hit (${fresh.length}) tab=${req.tab}`);
      await this.recordSearch(req, fresh, 'cached_db', Date.now() - startedAt);
      return { source: 'cached_db', processes: fresh, totalFound: fresh.length };
    }

    // 1b) ACF + filtro de entidad con dataset fresco: SEACE no filtra ACF por
    // entidad server-side (lo hacemos en cliente) y el crawler mantiene el set
    // ACF **completo**. Si hay anuncios frescos del objeto pero ninguno de la
    // entidad pedida, 0 es la respuesta real → la damos al instante en vez de
    // encolar un scrape (~10s) que tras filtrar daría 0 igual.
    if (req.tab === 'anuncios_futuros' && req.filters.entityNombre) {
      const freshObjeto = await this.processes.findByFilters(
        req.tab,
        { objeto: req.filters.objeto },
        { maxAge: DB_FRESHNESS, limit: 1 },
      );
      if (freshObjeto.length > 0) {
        this.logger.debug(`ACF fresco sin match de entidad "${req.filters.entityNombre}" → 0`);
        await this.recordSearch(req, [], 'cached_db', Date.now() - startedAt);
        return { source: 'cached_db', processes: [], totalFound: 0 };
      }
    }

    // 2) Cache Redis (resultado de scrape reciente).
    const cacheKey = `${CACHE_PREFIX}${this.filtersHash(req.tab, req.filters)}`;
    const cachedIds = await this.cache.get<string[]>(cacheKey);
    if (cachedIds && cachedIds.length > 0) {
      const processes = await this.processes.findManyByIds(cachedIds);
      if (processes.length > 0) {
        this.logger.debug(`cache hit (${processes.length}) tab=${req.tab}`);
        await this.recordSearch(req, processes, 'cache', Date.now() - startedAt);
        return { source: 'cache', processes, totalFound: processes.length };
      }
    }

    // 3) Encolar y registrar contexto del job.
    const requestId = randomUUID();
    const jobData: SearchJobData = {
      userId: req.userId,
      tab: req.tab,
      filters: req.filters,
      trace: { requestId, enqueuedAt: Date.now() },
    };
    const job = await this.queue.add(JOB_NAMES.SEARCH_ON_DEMAND, jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });

    const ctx: SearchJobContext = {
      jobId: job.id,
      userId: req.userId,
      phoneNumber: req.phoneNumber ?? null,
      phoneNumberId: req.phoneNumberId ?? null,
      tab: req.tab,
      filters: req.filters,
      enqueuedAt: Date.now(),
    };
    await this.cache.set(`${JOB_CTX_PREFIX}${job.id}`, ctx, JOB_CTX_TTL_SECONDS);
    this.logger.log(`queued job=${job.id} tab=${req.tab} user=${req.userId ?? 'anon'}`);
    return { source: 'queued', jobId: job.id };
  }

  /** Stored al completarse el scrape — invocado por `SearchResultsListener`. */
  async finalizeLiveSearch(
    ctx: SearchJobContext,
    processes: StoredProcess[],
    durationMs: number,
  ): Promise<void> {
    // Cachear los IDs para servir DB-miss inmediatos (caso 2 del search()).
    if (processes.length > 0) {
      const cacheKey = `${CACHE_PREFIX}${this.filtersHash(ctx.tab, ctx.filters)}`;
      await this.cache.set(
        cacheKey,
        processes.map((p) => p.id),
        CACHE_TTL_SECONDS,
      );
    }
    await this.searches.create({
      userId: ctx.userId,
      tab: ctx.tab,
      filters: ctx.filters,
      resultIds: processes.map((p) => p.id),
      resultCount: processes.length,
      source: 'live',
      durationMs,
    });
  }

  async getJobContext(jobId: string): Promise<SearchJobContext | null> {
    return this.cache.get<SearchJobContext>(`${JOB_CTX_PREFIX}${jobId}`);
  }

  async clearJobContext(jobId: string): Promise<void> {
    await this.cache.del(`${JOB_CTX_PREFIX}${jobId}`);
  }

  private async recordSearch(
    req: SearchRequest,
    processes: StoredProcess[],
    source: 'live' | 'cache' | 'cached_db',
    durationMs: number,
  ): Promise<void> {
    await this.searches
      .create({
        userId: req.userId,
        tab: req.tab,
        filters: req.filters,
        resultIds: processes.map((p) => p.id),
        resultCount: processes.length,
        source,
        durationMs,
      })
      .catch((err) => this.logger.warn(`no se pudo registrar search: ${(err as Error).message}`));
  }

  private filtersHash(tab: TabName, filters: SearchFilters): string {
    const canonical = JSON.stringify({ tab, filters: canonicalize(filters) });
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  }
}

function canonicalize(obj: SearchFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const v = (obj as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return out;
}
