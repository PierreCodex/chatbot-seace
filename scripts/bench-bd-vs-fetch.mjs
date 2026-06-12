import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { AcfHttpScraper } from '../dist/adapters/scraper/seace/acf-http.scraper.js';
import { EntityFetchLookup } from '../dist/adapters/scraper/seace/entity-fetch.lookup.js';
import { HtmlRowsParser } from '../dist/adapters/scraper/seace/parsers/html-rows.parser.js';
import { EntityRowsParser } from '../dist/adapters/scraper/seace/parsers/entity-rows.parser.js';

/**
 * Benchmark BD-first vs fetch en vivo, con el código real.
 *   - BD-first: `process.findByFilters` (lo que resuelve el caso normal de ACF).
 *   - Fetch ACF: `AcfHttpScraper.search({objeto})` (scrape live de SEACE).
 *   - Fetch entidad: `EntityFetchLookup.searchByNombre` (modal en vivo).
 * Uso: node --env-file=.env scripts/bench-bd-vs-fetch.mjs
 */
const RUNS = 5;
const SIX_H = 6 * 3600 * 1000;

async function timed(label, fn, runs = RUNS) {
  const ms = [];
  let sample;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    sample = await fn();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  const avg = ms.reduce((s, x) => s + x, 0) / ms.length;
  const fmt = (x) => `${x.toFixed(0)}ms`;
  console.log(
    `${label.padEnd(42)} min ${fmt(ms[0]).padStart(7)} · avg ${fmt(avg).padStart(7)} · max ${fmt(ms[ms.length - 1]).padStart(7)}  (${sample})`,
  );
}

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });
  const acf = new AcfHttpScraper(new HtmlRowsParser());
  const entityLookup = new EntityFetchLookup(new EntityRowsParser());

  const dbFind = (where) =>
    prisma.process.count({
      where: { tab: 'anuncios_futuros', scrapedAt: { gte: new Date(Date.now() - SIX_H) }, ...where },
    });

  console.log(`\n=== BD-first (Postgres/Supabase, lo que ve el usuario en el caso normal) ===`);
  await timed('BD · objeto-only (obra)', async () => `${await dbFind({ objeto: 'obra' })} filas`);
  await timed('BD · objeto + entidad (GORE Lima, obra)', async () =>
    `${await dbFind({ objeto: 'obra', entityNombre: { equals: 'GOBIERNO REGIONAL DE LIMA SEDE CENTRAL', mode: 'insensitive' } })} filas`,
  );
  await timed('BD · entidad SIN anuncios (Paita, obra)', async () =>
    `${await dbFind({ objeto: 'obra', entityNombre: { equals: 'MUNICIPALIDAD PROVINCIAL DE PAITA', mode: 'insensitive' } })} filas`,
  );

  console.log(`\n=== Fetch en vivo a SEACE (solo cuando la BD no tiene nada fresco) ===`);
  await timed(
    'FETCH · ACF scrape objeto (obra)',
    async () => {
      const r = await acf.search({ objeto: 'obra' });
      return `${r.rows.length} filas`;
    },
    3,
  );
  await timed(
    'FETCH · entidad en vivo (modal "talara")',
    async () => {
      const r = await entityLookup.searchByNombre('talara');
      return `${r.length} entidades`;
    },
    3,
  );

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
