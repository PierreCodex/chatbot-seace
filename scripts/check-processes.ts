/**
 * Pequeño check de Fase 2: imprime las últimas filas insertadas en `processes`.
 * Útil para validar end-to-end sin tener psql instalado en Windows.
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });
  try {
    const count = await prisma.process.count();
    console.log(`Total procesos en DB: ${count}`);
    const last = await prisma.process.findMany({
      orderBy: { scrapedAt: 'desc' },
      take: 10,
      select: {
        nomenclatura: true,
        entityNombre: true,
        objeto: true,
        valorReferencial: true,
        moneda: true,
        nidProceso: true,
        scrapedAt: true,
      },
    });
    console.log('Últimos 10 (scraped_at desc):');
    for (const p of last) {
      console.log(
        `  ${p.nomenclatura?.padEnd(35)} | ${p.objeto?.padEnd(8) ?? '-       '} | ${(p.moneda ?? '?').padEnd(8)} ${String(p.valorReferencial ?? '').padStart(15)} | nid=${p.nidProceso} | ${p.entityNombre}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});