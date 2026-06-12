import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EntityModalScraper } from '../dist/adapters/scraper/seace/entity-modal.scraper.js';
import { EntityHttpScraper } from '../dist/adapters/scraper/seace/entity-http.scraper.js';
import { PrismaService } from '../dist/adapters/persistence/prisma/prisma.service.js';
import { ENTITIES_REPO } from '../dist/ports/persistence/entities.repo.port.js';
import { WorkerModule } from '../dist/worker.module.js';

/**
 * F4.5 · Pre-crawl del catálogo de entidades públicas de SEACE.
 *
 * Carga `entities` con (idealmente) las ~10-15k entidades para que toda
 * búsqueda por nombre caiga en L2 (pg_trgm, <100ms) y L3 (scrape live) sea
 * fallback raro. Reusa `EntityModalScraper.crawlAllEntities` (un solo context,
 * sesión preservada). Es idempotente: re-correr es seguro.
 *
 * Requiere build previo (importa dist). El npm script `crawl:entities` ya
 * hace `pnpm build` antes.
 *
 * Overrides (para el tuning del stop-condition del roadmap):
 *   --terms=a,b,c        términos semilla (default a-z + 0-9)
 *   --max-pages=35       máx. requests/páginas por término
 *   --max-term-length=2  hasta dónde expandir sufijos en términos saturados
 *   --pause=300          ms de pausa entre términos
 *   --browser            usar el scraper por navegador (lento) en vez del HTTP
 *   --dry                no persiste (solo cuenta; útil para medir cobertura)
 *
 * Por defecto usa el scraper HTTP (replay del AJAX, minutos). `--browser` cae
 * al scraper por Playwright (horas) como fallback.
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

  const useBrowser = Boolean(args.browser);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  const scraper = useBrowser ? app.get(EntityModalScraper) : app.get(EntityHttpScraper);
  const repo = app.get(ENTITIES_REPO);
  const prisma = app.get(PrismaService);

  const before = await prisma.entity.count();
  console.log(
    `▶ Pre-crawl de entidades [${useBrowser ? 'navegador' : 'HTTP'}]${dry ? ' (DRY-RUN, sin persistir)' : ''}. entities actuales=${before}`,
  );

  let persisted = 0;
  let inserted = 0;
  let updated = 0;
  const t0 = Date.now();

  const { totalUnique } = await scraper.crawlAllEntities({
    // Acepta coma o espacio: pnpm/PowerShell a veces convierte las comas en
    // espacios al reenviar args (`--terms=a,b,c` → `--terms=a b c`).
    terms: typeof args.terms === 'string' ? args.terms.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : undefined,
    maxPagesPerTerm: args['max-pages'] ? Number(args['max-pages']) : undefined,
    maxTermLength: args['max-term-length'] ? Number(args['max-term-length']) : undefined,
    pauseMsBetweenTerms: args.pause ? Number(args.pause) : undefined,
    onChunk: dry
      ? undefined
      : async (rows) => {
          const r = await repo.upsertManyByRuc(
            rows.map((m) => ({ ruc: m.ruc, nombre: m.nombre, tipoDoc: m.tipoDoc })),
          );
          persisted += rows.length;
          inserted += r.inserted;
          updated += r.updated;
          console.log(
            `   · lote +${rows.length} (insert=${r.inserted} update=${r.updated}) · acumulado=${persisted}`,
          );
        },
    onProgress: (p) => {
      const ratio = p.rowsSeen > 0 ? Math.round((p.newUnique / p.rowsSeen) * 100) : 0;
      console.log(
        `   [${p.term}] págs=${p.pages} vistas=${p.rowsSeen} nuevas=${p.newUnique} (${ratio}%) únicas=${p.totalUnique}${p.truncated ? ' ⤵ saturó→expande' : ''}`,
      );
    },
  });

  const after = await prisma.entity.count();
  console.log(
    `✅ Crawl done: ${totalUnique} únicas scrapeadas` +
      (dry ? '' : ` · persistidas=${persisted} (insert=${inserted} update=${updated}) · entities ${before}→${after}`) +
      ` · ${Math.round((Date.now() - t0) / 1000)}s`,
  );

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});