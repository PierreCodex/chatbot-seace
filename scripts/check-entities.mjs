import { PrismaClient } from '@prisma/client';

/**
 * Check rápido del avance del pre-crawl (F4.5): total de entidades + muestra.
 * Uso: node --env-file=.env scripts/check-entities.mjs
 */
async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });
  try {
    const count = await prisma.entity.count();
    console.log(`Total entidades en DB: ${count}`);

    // Diagnóstico de cobertura: grupos homogéneos grandes que el cap de 300 trunca.
    const groups = [
      ['MUNICIPALIDAD%', 'Municipalidades'],
      ['GOBIERNO REGIONAL%', 'Gobiernos Regionales'],
      ['UNIVERSIDAD%', 'Universidades'],
      ['RED DE SALUD%', 'Redes de Salud'],
    ];
    console.log('Cobertura por grupo (ILIKE):');
    for (const [pat, label] of groups) {
      const n = await prisma.entity.count({ where: { nombre: { startsWith: pat.replace('%', ''), mode: 'insensitive' } } });
      console.log(`  ${label.padEnd(22)} ${n}`);
    }
    const sample = await prisma.entity.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    console.log('Últimas 10 (createdAt desc):');
    for (const e of sample) {
      console.log(`  ${e.ruc}  ${e.nombre}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
