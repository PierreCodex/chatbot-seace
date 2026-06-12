import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AcfHttpScraper } from '../adapters/scraper/seace/acf-http.scraper';
import type { Env } from '../config/env.schema';
import {
  PROCESSES_REPO,
  type ProcessesRepoPort,
} from '../ports/persistence/processes.repo.port';

type CrawlMode = 'incremental' | 'full';

/**
 * Crawler ACF agendado (motor de alertas F5). Corre en el proceso worker vía
 * `@nestjs/schedule` (no por BullMQ: el crawl es una operación in-process de
 * ~4s, no un job distribuido con reintentos). Dos cadencias, validadas en vivo
 * (ver docs / memoria del 2026-06-12):
 *
 *   - **Incremental cada hora**: paginа cada objeto desde la página 1 (orden
 *     DESC = lo nuevo primero) y corta apenas una página viene 100% sin cambios.
 *     Costo típico sin novedades ~4s / ~9 requests.
 *   - **Completo 1×/día** (03:00): pagina todo. Red de seguridad para ediciones
 *     de filas viejas, borrados y churn de igual conteo que el incremental no ve.
 *
 * Gateado por `CRAWLER_ENABLED` (off por defecto). Un flag `running` evita que
 * el tick horario se solape con el completo (el worker es single-instance aquí).
 */
@Injectable()
export class CrawlerScheduler {
  private readonly logger = new Logger(CrawlerScheduler.name);
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly scraper: AcfHttpScraper,
    @Inject(PROCESSES_REPO) private readonly processes: ProcessesRepoPort,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('CRAWLER_ENABLED', { infer: true }) ?? false;
    if (this.enabled) {
      this.logger.log('crawler ACF habilitado (incremental 1h + completo 03:00)');
    }
  }

  @Cron('0 0 * * * *', { name: 'acf-incremental' })
  async hourlyIncremental(): Promise<void> {
    if (!this.enabled) return;
    await this.runCrawl('incremental');
  }

  @Cron('0 0 3 * * *', { name: 'acf-full' })
  async dailyFull(): Promise<void> {
    if (!this.enabled) return;
    await this.runCrawl('full');
  }

  /** Ejecuta un crawl y agrega los conteos del upsert para el log. Reentrante-safe. */
  async runCrawl(mode: CrawlMode): Promise<{
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: boolean;
  }> {
    if (this.running) {
      this.logger.warn(`crawl ${mode} omitido: ya hay uno en curso`);
      return { inserted: 0, updated: 0, unchanged: 0, skipped: true };
    }
    this.running = true;
    const startedAt = Date.now();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    try {
      await this.scraper.crawlAcf({
        incremental: mode === 'incremental',
        onPage: async ({ rows }) => {
          const r = await this.processes.upsertMany(rows);
          inserted += r.inserted;
          updated += r.updated;
          unchanged += r.unchanged;
          return r;
        },
      });
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      this.logger.log(
        `crawl ${mode} ok: +${inserted} nuevos, ~${updated} cambiados, =${unchanged} sin cambio (${secs}s)`,
      );
      return { inserted, updated, unchanged, skipped: false };
    } catch (err) {
      this.logger.error(`crawl ${mode} falló: ${(err as Error).message}`);
      return { inserted, updated, unchanged, skipped: false };
    } finally {
      this.running = false;
    }
  }
}
