import { describe, it, expect, vi } from 'vitest';
import { CrawlerScheduler } from '../../src/workers/crawler.scheduler';

/**
 * Orquestación del crawler agendado: agrega los conteos del upsert, pasa el flag
 * `incremental` correcto, respeta el guard anti-solape y el gate `CRAWLER_ENABLED`.
 * El early-stop del scraper se prueba aparte (acf-http.incremental.spec).
 */
describe('CrawlerScheduler', () => {
  const makeRepo = (counts = { inserted: 1, updated: 0, unchanged: 1, ids: [] as string[] }) => ({
    upsertMany: vi.fn().mockResolvedValue(counts),
  });
  const config = (enabled: boolean) => ({ get: vi.fn().mockReturnValue(enabled) }) as never;

  it('agrega conteos por página y pasa incremental:true en el tick horario', async () => {
    const repo = makeRepo();
    const scraper = {
      crawlAcf: vi.fn(async (opts: { incremental: boolean; onPage: (p: unknown) => Promise<unknown> }) => {
        await opts.onPage({ objeto: 'obra', rows: [{}, {}], pageIdx: 0 });
        await opts.onPage({ objeto: 'obra', rows: [{}], pageIdx: 1 });
      }),
    };

    const sched = new CrawlerScheduler(scraper as never, repo as never, config(true));
    await sched.hourlyIncremental();

    expect(scraper.crawlAcf).toHaveBeenCalledWith(
      expect.objectContaining({ incremental: true }),
    );
    expect(repo.upsertMany).toHaveBeenCalledTimes(2);
  });

  it('el completo pasa incremental:false', async () => {
    const repo = makeRepo();
    const scraper = { crawlAcf: vi.fn(async () => {}) };
    const sched = new CrawlerScheduler(scraper as never, repo as never, config(true));
    await sched.dailyFull();
    expect(scraper.crawlAcf).toHaveBeenCalledWith(
      expect.objectContaining({ incremental: false }),
    );
  });

  it('no corre nada si CRAWLER_ENABLED es false', async () => {
    const repo = makeRepo();
    const scraper = { crawlAcf: vi.fn(async () => {}) };
    const sched = new CrawlerScheduler(scraper as never, repo as never, config(false));
    await sched.hourlyIncremental();
    expect(scraper.crawlAcf).not.toHaveBeenCalled();
  });

  it('evita el solape: un segundo crawl concurrente se omite', async () => {
    const repo = makeRepo();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const scraper = { crawlAcf: vi.fn(async () => gate) };
    const sched = new CrawlerScheduler(scraper as never, repo as never, config(true));

    const first = sched.runCrawl('incremental'); // queda en vuelo
    const second = await sched.runCrawl('full'); // debe omitirse
    expect(second.skipped).toBe(true);

    release();
    await first;
    expect(scraper.crawlAcf).toHaveBeenCalledTimes(1);
  });
});
