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

  // Canal de mensajería activo. El composition root bindea MESSAGING_PORT al
  // adapter correspondiente (Kapso/WhatsApp o Telegram). Ambos coexisten; se elige
  // por env. Ver docs/13-telegram-migracion.md.
  MESSAGING_CHANNEL: z.enum(['whatsapp', 'telegram']).default('whatsapp'),

  KAPSO_API_KEY: z.string().default(''),
  KAPSO_WEBHOOK_SECRET: z.string().default(''),

  // Telegram (grammY usado solo como Api-client). Token de @BotFather; el secret
  // se valida contra el header X-Telegram-Bot-Api-Secret-Token del webhook.
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),

  // Dueños del bot (raíz de confianza, inmutable en runtime). Lista de ids
  // numéricos de Telegram separados por coma. NUNCA en BD — ver docs/17 §1.
  // Ej: OWNER_IDS="111111111,222222222".
  OWNER_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s)),
    ),

  // URL pública del API para servir archivos efímeros (PDF de anuncios ACF) que
  // Meta descarga por link. Dev = túnel ngrok; prod = dominio de Railway/Contabo.
  // Si falta, el bot omite el PDF y muestra solo las 5 tarjetas.
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Proxy (opcional) para los fetch a SEACE. Necesario si el IP del host está
  // bloqueado por SEACE (ej. datacenter de Railway) → usar un proxy residencial
  // de Perú. Formato: http://usuario:password@host:puerto. Ver docs/19.
  PROXY_URL: z.string().url().optional(),

  // Motor de alertas F5 — crawler ACF agendado (corre en el worker). Apagado por
  // defecto para que dev/test/CI no scrapeen SEACE en cada arranque. En prod del
  // worker: CRAWLER_ENABLED=true.
  CRAWLER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // IA conversacional (NLU-first, docs/21). El proveedor es intercambiable vía
  // LlmPort; se arranca con Anthropic (OpenAI cuando haya key). Sin LLM_API_KEY
  // el router NLU queda inactivo y el bot se comporta como siempre (botones).
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('claude-haiku-4-5'),
  // Kill-switch del NLU: apagarlo restaura la experiencia actual sin deploy.
  NLU_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Presupuesto de la llamada NLU; al agotarse → fallback al menú de botones.
  // 8s: el parse típico toma 1.5-2.5s pero la 1.ª llamada del proceso (TLS) y
  // los picos del proveedor superan 4s — verificado en chat-sim el 2026-07-09.
  NLU_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
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
