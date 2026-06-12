import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ContextFactory } from '../dist/adapters/scraper/seace/browser/context.factory.js';
import { SessionManager } from '../dist/adapters/scraper/seace/session/session.manager.js';
import { AnunciosFuturosStrategy } from '../dist/adapters/scraper/seace/strategies/anuncios-futuros.strategy.js';
import { PrismaService } from '../dist/adapters/persistence/prisma/prisma.service.js';
import { WorkerModule } from '../dist/worker.module.js';

/**
 * Verificación: total REAL en la web (paginador "del total N", que rellena JS)
 * por objeto vs. lo persistido en la BD. Descarta si la paginación ciega del
 * AcfHttpScraper sobre-pide filas fantasma.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OBJETOS = ['bien', 'servicio', 'obra', 'consultoria_obra'];

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  const contexts = app.get(ContextFactory, { strict: false });
  const session = app.get(SessionManager, { strict: false });
  const strategy = app.get(AnunciosFuturosStrategy, { strict: false });
  const prisma = app.get(PrismaService, { strict: false });

  for (const objeto of OBJETOS) {
    const jc = await contexts.create();
    const page = jc.page;
    try {
      await session.openBuscador(page);
      await strategy.switchTo(page);
      await strategy.applyFilters(page, { objeto });
      await strategy.search(page);
      await sleep(1500); // dejar que el JS rellene el paginador

      const paginatorText = await page
        .locator('[id$="dtResultadosACF_paginator_bottom"] .ui-paginator-current')
        .first()
        .textContent()
        .catch(() => '');
      const visibleRows = await page
        .locator('[id$="dtResultadosACF"] tbody.ui-datatable-data > tr:not(.ui-datatable-empty-message)')
        .count()
        .catch(() => 0);

      const dbCount = await prisma.process.count({ where: { tab: 'anuncios_futuros', objeto } });
      console.log(
        `\n[${objeto}] web paginador: "${(paginatorText ?? '').trim()}" · filas visibles pág.1=${visibleRows} · BD=${dbCount}`,
      );
    } catch (e) {
      console.log(`[${objeto}] error: ${e.message}`);
    } finally {
      await jc.close();
    }
  }

  await app.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
