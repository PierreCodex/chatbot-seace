/**
 * Seed mínimo para desarrollo (F1).
 *   - 1 wa_user con phone +51999000001
 *   - 1 entity MINSA (RUC 20131370645)
 *   - 1 subscription daily de Obras para ese user
 * Idempotente: re-correr el script no duplica ni rompe.
 *
 * Uso: `pnpm seed:dev`
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });

  try {
    const user = await prisma.waUser.upsert({
      where: { phoneE164: '+51999000001' },
      create: { phoneE164: '+51999000001', displayName: 'Dev User' },
      update: {},
    });
    console.log(`wa_user: ${user.id}  (${user.phoneE164})`);

    const entity = await prisma.entity.upsert({
      where: { ruc: '20131370645' },
      create: {
        ruc: '20131370645',
        nombre: 'MINISTERIO DE SALUD',
        sigla: 'MINSA',
        tipoDoc: 'RUC',
      },
      update: { ultimoVisto: new Date() },
    });
    console.log(`entity:  ${entity.ruc} ${entity.sigla}`);

    const existing = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        tab: 'procedimientos',
        entityRuc: entity.ruc,
        objeto: 'obra',
        status: 'active',
      },
    });

    const sub =
      existing ??
      (await prisma.subscription.create({
        data: {
          user: { connect: { id: user.id } },
          tab: 'procedimientos',
          entityRuc: entity.ruc,
          objeto: 'obra',
          frequency: 'daily',
        },
      }));
    console.log(`sub:     ${sub.id}  (${sub.tab}/obra/${sub.frequency}/${sub.status})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});