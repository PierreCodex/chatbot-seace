import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { AcfHttpScraper } from '../dist/adapters/scraper/seace/acf-http.scraper.js';
import { HtmlRowsParser } from '../dist/adapters/scraper/seace/parsers/html-rows.parser.js';
import { PrismaProcessesRepo } from '../dist/adapters/persistence/prisma/processes.repo.js';

/**
 * Verificación en vivo del crawl incremental SIN booteаr Nest/Redis (Redis está
 * con TLS interceptado). Replica lo que hace `CrawlerScheduler.runCrawl`:
 * crawlAcf({incremental}) + upsert por página. Con la BD ya poblada se espera
 * early-stop en página 1 por objeto. Uso: node --env-file=.env scripts/verify-incremental.mjs
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});
const scraper = new AcfHttpScraper(new HtmlRowsParser());
const repo = new PrismaProcessesRepo(prisma); // PrismaService duck-typed

let inserted = 0;
let updated = 0;
let unchanged = 0;
const t0 = Date.now();

await scraper.crawlAcf({
  incremental: true,
  pauseMs: 0,
  onPage: async ({ rows }) => {
    const r = await repo.upsertMany(rows);
    inserted += r.inserted;
    updated += r.updated;
    unchanged += r.unchanged;
    return r;
  },
  onProgress: (p) =>
    console.log(
      `  [${p.objeto}] filas=${p.rowsSeen} págs=${p.pagesScraped}${p.stoppedEarly ? ' (early-stop)' : ''}`,
    ),
});

console.log(
  `\nincremental: +${inserted} nuevos · ~${updated} cambiados · =${unchanged} sin cambio · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
await prisma.$disconnect();
process.exit(0);
