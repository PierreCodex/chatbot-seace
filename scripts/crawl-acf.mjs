import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AcfHttpScraper } from '../dist/adapters/scraper/seace/acf-http.scraper.js';
import { PrismaService } from '../dist/adapters/persistence/prisma/prisma.service.js';
import { PROCESSES_REPO } from '../dist/ports/persistence/processes.repo.port.js';
import { WorkerModule } from '../dist/worker.module.js';

/**
 * Pre-crawl de Anuncios de Contratación Futura (ACF) vía replay HTTP.
 *
 * Recorre los 4 objetos (bien/servicio/obra/consultoría de obra) con un solo
 * bootstrap de Playwright y luego `fetch` por página. Persiste en `processes`
 * (+ `process_acf` 1:1). Idempotente (dedup por contentHash). Requiere build
 * previo (importa dist); el npm script `crawl:acf` ya hace `pnpm build`.
 *
 * Overrides:
 *   --objetos=bien,obra     subconjunto de objetos (default los 4)
 *   --max-pages=500         máx. páginas por objeto
 *   --pause=500             ms de pausa entre objetos
 *   --dry                   no persiste (solo cuenta)
 */
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dry = Boolean(args.dry);

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  const scraper = app.get(AcfHttpScraper);
  const repo = app.get(PROCESSES_REPO);
  const prisma = app.get(PrismaService);

  const before = await prisma.process.count({ where: { tab: 'anuncios_futuros' } });
  console.log(`▶ Pre-crawl ACF [HTTP]${dry ? ' (DRY-RUN)' : ''}. processes(ACF) actuales=${before}`);

  let persisted = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const t0 = Date.now();

  const incremental = !dry && Boolean(args.incremental);
  const { totalRows } = await scraper.crawlAcf({
    objetos:
      typeof args.objetos === 'string'
        ? args.objetos.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
        : undefined,
    maxPagesPerObjeto: args['max-pages'] ? Number(args['max-pages']) : undefined,
    pauseMs: args.pause ? Number(args.pause) : undefined,
    incremental,
    // onPage persiste por página y devuelve los conteos → habilita el early-stop
    // incremental. En modo --dry no persiste (solo cuenta filas vía onChunk).
    onPage: dry
      ? undefined
      : async ({ rows }) => {
          const r = await repo.upsertMany(rows);
          persisted += rows.length;
          inserted += r.inserted;
          updated += r.updated;
          unchanged += r.unchanged;
          return r;
        },
    onChunk: dry ? async (rows) => void (persisted += rows.length) : undefined,
    onProgress: (p) => {
      console.log(
        `   [${p.objeto}] filas=${p.rowsSeen} págs=${p.pagesScraped}${p.stoppedEarly ? ' (early-stop)' : ''}`,
      );
    },
  });

  const after = await prisma.process.count({ where: { tab: 'anuncios_futuros' } });
  const acfCount = await prisma.processAcf.count();
  console.log(
    `✅ Crawl ACF done: ${totalRows} filas scrapeadas` +
      (dry
        ? ''
        : ` · persistidas=${persisted} (insert=${inserted} update=${updated} sin cambio=${unchanged}) · processes(ACF) ${before}→${after} · process_acf=${acfCount}`) +
      ` · ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
