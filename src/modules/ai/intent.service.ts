import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import { LLM_PORT, type LlmPort } from '../../ports/llm.port';
import type { Env } from '../../config/env.schema';
import { nluIntentSchema, type NluIntent } from './intent.schema';
import { nluSystemPrompt } from './prompts/nlu.system.prompt';

// Cache de intents parseados: mensajes idénticos ("obras", "mis alertas") no
// pagan LLM. Clave por texto normalizado; TTL corto porque el prompt incluye
// la fecha (fechas relativas) y no queremos intents con fecha vieja.
// ⚠️ Al cambiar el system prompt o el schema, SUBIR la versión del prefijo —
// si no, los textos ya cacheados siguen respondiendo con la extracción vieja.
const CACHE_PREFIX = 'nlu:intent:v2:';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6h

/**
 * NLU (docs/21 §3): 1 llamada LLM → intent estructurado validado con Zod.
 * Nunca lanza: ante timeout/API caída/salida inválida devuelve null y el
 * caller degrada a la experiencia de botones. Loggea cada parse — ese log es
 * el insumo del golden set (docs/22, "Observabilidad").
 */
@Injectable()
export class IntentService implements OnModuleInit {
  private readonly logger = new Logger(IntentService.name);
  readonly enabled: boolean;
  private readonly isTest: boolean;

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('NLU_ENABLED', { infer: true }) &&
      config.get('LLM_API_KEY', { infer: true }).length > 0;
    this.isTest = config.get('NODE_ENV', { infer: true }) === 'test';
  }

  /**
   * Warm-up al bootear (fire-and-forget): la 1.ª llamada real paga la
   * compilación del schema en la API (~10s si el cache de 24h expiró) más el
   * handshake TLS del proceso — superaría el presupuesto y caería al fallback.
   * Este ping lo absorbe antes de que llegue un usuario. No retrasa el boot.
   */
  onModuleInit(): void {
    if (!this.enabled || this.isTest) return;
    const started = Date.now();
    void this.llm
      .extract({
        system: nluSystemPrompt(new Date()),
        user: 'hola',
        schema: nluIntentSchema,
        schemaName: 'nlu_intent',
        maxTokens: 700,
        timeoutMs: 25_000, // tolera la compilación fría; corre en background
      })
      .then(() => this.logger.log(`nlu warm-up ok en ${Date.now() - started}ms`))
      .catch((err) =>
        this.logger.warn(`nlu warm-up falló (no bloquea): ${(err as Error).message}`),
      );
  }

  async parse(text: string): Promise<NluIntent | null> {
    if (!this.enabled) return null;
    const clean = text.trim();
    if (!clean) return null;

    const cacheKey = `${CACHE_PREFIX}${hashOf(normalize(clean))}`;
    const cached = await this.cache.get<NluIntent>(cacheKey).catch(() => null);
    if (cached) {
      this.logger.debug(`nlu cache hit "${truncate(clean)}" → ${cached.intent}`);
      return cached;
    }

    const started = Date.now();
    try {
      const intent = await this.llm.extract({
        system: nluSystemPrompt(new Date()),
        user: clean,
        schema: nluIntentSchema,
        schemaName: 'nlu_intent',
        maxTokens: 700,
      });
      // Log estructurado por parse: texto → intent (insumo del golden set).
      this.logger.log(
        `nlu parse ${Date.now() - started}ms "${truncate(clean)}" → ` +
          `${intent.intent}${summarize(intent)}`,
      );
      await this.cache.set(cacheKey, intent, CACHE_TTL_SECONDS).catch(() => {});
      return intent;
    } catch (err) {
      // Fallback silencioso: el usuario ve el menú de siempre, jamás un error de IA.
      this.logger.warn(
        `nlu parse falló en ${Date.now() - started}ms "${truncate(clean)}": ${(err as Error).message}`,
      );
      return null;
    }
  }
}

function summarize(i: NluIntent): string {
  const parts: string[] = [];
  if (i.objeto) parts.push(`objeto=${i.objeto}`);
  if (i.keyword) parts.push(`kw=${i.keyword}(+${i.sinonimos.length})`);
  if (i.entidad) parts.push(`ent="${i.entidad}"`);
  if (i.ubicacion) parts.push(`ubi="${i.ubicacion}"`);
  if (i.excluir.length) parts.push(`excl=${i.excluir.length}`);
  if (i.limite != null) parts.push(`lim=${i.limite}`);
  if (i.quierePdf) parts.push('pdf');
  if (i.faqId) parts.push(`faq=${i.faqId}`);
  return parts.length ? ` [${parts.join(' ')}]` : '';
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hashOf(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24);
}

function truncate(s: string, n = 120): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
