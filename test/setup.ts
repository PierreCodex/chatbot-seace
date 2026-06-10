import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { afterAll } from 'vitest';

config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no definido — los specs de repos requieren Supabase dev.');
}

export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

// Limpieza global al final del run.
afterAll(async () => {
  await prisma.$disconnect();
});
