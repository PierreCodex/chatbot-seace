import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/adapters/persistence/prisma/prisma.service.js';
import { PROCESSES_REPO } from '../dist/ports/persistence/processes.repo.port.js';
import { SCRAPER_PORT } from '../dist/ports/scraper.port.js';
import { WorkerModule } from '../dist/worker.module.js';

const TAB = 'anuncios_futuros';
const FILTERS = { objeto: 'obra' };

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  const scraper = app.get(SCRAPER_PORT);
  const repo = app.get(PROCESSES_REPO);
  const prisma = app.get(PrismaService);

  console.log('▶ Scrapeando ACF (objeto=obra) en vivo…');
  const t0 = Date.now();
  const res = await scraper.search(TAB, FILTERS);
  console.log(
    `   scrape: ${res.rows.length} filas · ${res.pagesScraped} págs · total reportado=${res.totalReported} · ${Date.now() - t0}ms`,
  );
  if (res.rows.length === 0) {
    console.log('❌ scrape devolvió 0 filas (¿reCAPTCHA o sin resultados?)');
    await app.close();
    process.exit(1);
  }

  console.log('▶ Upsert #1 (base + process_acf)…');
  const u1 = await repo.upsertMany(res.rows);
  console.log(`   ${JSON.stringify({ inserted: u1.inserted, updated: u1.updated, unchanged: u1.unchanged })}`);

  const baseCount = await prisma.process.count({ where: { tab: TAB } });
  const acfCount = await prisma.processAcf.count();
  console.log(`   processes(${TAB})=${baseCount} · process_acf=${acfCount}`);

  const sample = await prisma.process.findFirst({ where: { tab: TAB }, include: { acf: true } });
  console.log(
    '   sample:',
    JSON.stringify({
      entidad: sample?.entityNombre,
      objeto: sample?.objeto,
      dedupeKey: (sample?.dedupeKey ?? '').slice(0, 12) + '…',
      acf: sample?.acf,
    }),
  );

  console.log('▶ Upsert #2 (idempotencia)…');
  const u2 = await repo.upsertMany(res.rows);
  console.log(`   ${JSON.stringify({ inserted: u2.inserted, updated: u2.updated, unchanged: u2.unchanged })}`);
  const baseCount2 = await prisma.process.count({ where: { tab: TAB } });
  const acfCount2 = await prisma.processAcf.count();
  console.log(`   processes(${TAB})=${baseCount2} · process_acf=${acfCount2}`);

  const ok =
    u2.inserted === 0 && baseCount2 === baseCount && acfCount2 === baseCount2 && acfCount === baseCount;
  console.log(
    ok
      ? '✅ E2E OK: CTI persiste base + process_acf 1:1 y el dedup es idempotente'
      : '❌ E2E FALLÓ (revisar counts arriba)',
  );

  await app.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
