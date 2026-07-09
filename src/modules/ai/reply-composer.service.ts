import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import { LLM_PORT, type LlmPort } from '../../ports/llm.port';
import type { Env } from '../../config/env.schema';
import { respuestaSchema } from './intent.schema';
import { replyDirective, replySystemPrompt } from './prompts/reply.system.prompt';

// Tope de redacciones por usuario/hora: acota el abuso ("ChatGPT gratis") a
// unas pocas redirecciones de 3 líneas. Superado → plantillas estáticas.
const MAX_PER_HOUR = 6;
const RATE_PREFIX = 'nlu:compose:';
const MAX_LEN = 400;

export type ComposeKind = 'ayuda' | 'fuera_de_alcance';

/**
 * Redactor conversacional (docs/24): redacta SOLO las respuestas sociales
 * (ayuda / fuera de alcance / FAQ difusa) bajo directiva del código. Nunca
 * responde contenido — redirige/describe capacidades. Ante cualquier fallo,
 * límite o validación rota devuelve null y el caller usa la plantilla de
 * siempre. Las respuestas con DATOS jamás pasan por aquí.
 */
@Injectable()
export class ReplyComposerService {
  private readonly logger = new Logger(ReplyComposerService.name);
  readonly enabled: boolean;

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      config.get('NLU_ENABLED', { infer: true }) &&
      config.get('LLM_API_KEY', { infer: true }).length > 0;
  }

  async compose(args: {
    kind: ComposeKind;
    userText: string;
    userId: string;
    yaBusco: boolean;
  }): Promise<string | null> {
    if (!this.enabled) return null;
    if (!(await this.underLimit(args.userId))) {
      this.logger.debug(`compose rate-limit alcanzado user=${args.userId}`);
      return null;
    }

    const started = Date.now();
    try {
      const out = await this.llm.extract({
        system: replySystemPrompt({ yaBusco: args.yaBusco }),
        user: replyDirective(args.kind, args.userText.slice(0, 300), args.yaBusco),
        schema: respuestaSchema,
        schemaName: 'respuesta',
        maxTokens: 200,
        timeoutMs: 6000,
      });
      const clean = sanitizeReply(out.respuesta);
      // Log de auditoría: qué se redactó y ante qué (recortado).
      this.logger.log(
        `compose ${args.kind} ${Date.now() - started}ms "${args.userText.slice(0, 60)}" → ` +
          (clean ? `"${clean.slice(0, 80)}"` : 'RECHAZADA por sanitize'),
      );
      return clean;
    } catch (err) {
      this.logger.warn(`compose ${args.kind} falló: ${(err as Error).message}`);
      return null;
    }
  }

  /** Contador por usuario/hora en Redis (límite blando; carrera benigna). */
  private async underLimit(userId: string): Promise<boolean> {
    const key = `${RATE_PREFIX}${userId}:${Math.floor(Date.now() / 3_600_000)}`;
    const n = (await this.cache.get<number>(key).catch(() => 0)) ?? 0;
    if (n >= MAX_PER_HOUR) return false;
    await this.cache.set(key, n + 1, 3700).catch(() => {});
    return true;
  }
}

/**
 * Validación de la redacción ANTES de enviarla (defensa 3, docs/24): larga,
 * con bloques de código o con URLs fuera de la whitelist → se descarta y el
 * caller usa la plantilla. Exportada para tests y la batería adversarial.
 */
export function sanitizeReply(s: string): string | null {
  const t = s?.trim();
  if (!t || t.length > MAX_LEN) return null;
  if (t.includes('```')) return null;
  const urls = t.match(/https?:\/\/\S+|t\.me\/\S+|www\.\S+/gi) ?? [];
  for (const u of urls) {
    if (!u.toLowerCase().includes('t.me/pierrecodex')) return null;
  }
  return t;
}
