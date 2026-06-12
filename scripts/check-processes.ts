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
      include: { acf: true, procedimiento: true },
    });
    console.log('Últimos 10 (scraped_at desc):');
    for (const p of last) {
      // CTI: el id de negocio vive en el detalle (nomenclatura en procedimiento).
      const id = p.procedimiento?.nomenclatura ?? `acf:${p.dedupeKey.slice(0, 10)}`;
      const monto = p.procedimiento
        ? `${(p.procedimiento.moneda ?? '?').padEnd(4)} ${String(p.procedimiento.valorReferencial ?? '').padStart(14)}`
        : `plazo ${String(p.acf?.plazoDias ?? '-').padStart(4)}d`;
      console.log(
        `  ${id.padEnd(35)} | ${(p.objeto ?? '-').padEnd(8)} | ${monto} | ${p.entityNombre}`,
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