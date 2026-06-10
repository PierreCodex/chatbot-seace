import type { PrismaClient } from '@prisma/client';

/**
 * Truncate de tablas data-side dejando intactas las tablas Prisma internas
 * (_prisma_migrations). RESTART IDENTITY + CASCADE para limpiar FKs.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "subscription_hits",
      "subscriptions",
      "notifications",
      "searches",
      "files",
      "process_history",
      "processes",
      "conversations",
      "entities",
      "wa_users",
      "scrape_jobs"
    RESTART IDENTITY CASCADE
  `);
}
