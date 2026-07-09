import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod/v4';
import type { Env } from '../../config/env.schema';
import type { LlmExtractRequest, LlmPort } from '../../ports/llm.port';

/**
 * Adapter Anthropic del LlmPort. Usa `messages.parse()` + `zodOutputFormat`:
 * la API garantiza que la salida cumple el schema (structured outputs) y el
 * SDK la re-valida con el mismo Zod al recibirla — doble validación gratis.
 *
 * El cliente se crea lazy: sin LLM_API_KEY la app arranca igual (el NLU queda
 * inactivo río arriba) y este adapter solo fallaría si alguien lo llamara.
 */
@Injectable()
export class AnthropicLlmAdapter implements LlmPort {
  private readonly logger = new Logger(AnthropicLlmAdapter.name);
  private client: Anthropic | null = null;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.apiKey = config.get('LLM_API_KEY', { infer: true });
    this.model = config.get('LLM_MODEL', { infer: true });
    this.timeoutMs = config.get('NLU_TIMEOUT_MS', { infer: true });
  }

  async extract<S extends z.ZodType>(req: LlmExtractRequest<S>): Promise<z.infer<S>> {
    if (!this.apiKey) throw new Error('LLM_API_KEY no configurada');
    // maxRetries 0: el presupuesto total es NLU_TIMEOUT_MS; un retry interno
    // del SDK lo duplicaría. El fallback (botones) es más barato que esperar.
    this.client ??= new Anthropic({ apiKey: this.apiKey, maxRetries: 0 });

    const started = Date.now();
    const response = await this.client.messages.parse(
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: zodOutputFormat(req.schema) },
      },
      { timeout: req.timeoutMs ?? this.timeoutMs },
    );

    if (response.parsed_output == null) {
      throw new Error(`respuesta sin parsed_output (stop_reason=${response.stop_reason})`);
    }
    this.logger.debug(
      `extract ${req.schemaName} ok en ${Date.now() - started}ms ` +
        `(in=${response.usage.input_tokens} out=${response.usage.output_tokens})`,
    );
    return response.parsed_output as z.infer<S>;
  }
}
