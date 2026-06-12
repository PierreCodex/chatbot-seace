import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE: z.enum(['api', 'worker']),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  REDIS_URL: z.string().url(),

  KAPSO_API_KEY: z.string().default(''),
  KAPSO_WEBHOOK_SECRET: z.string().default(''),

  // URL pública del API para servir archivos efímeros (PDF de anuncios ACF) que
  // Meta descarga por link. Dev = túnel ngrok; prod = dominio de Railway/Contabo.
  // Si falta, el bot omite el PDF y muestra solo las 5 tarjetas.
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Motor de alertas F5 — crawler ACF agendado (corre en el worker). Apagado por
  // defecto para que dev/test/CI no scrapeen SEACE en cada arranque. En prod del
  // worker: CRAWLER_ENABLED=true.
  CRAWLER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
