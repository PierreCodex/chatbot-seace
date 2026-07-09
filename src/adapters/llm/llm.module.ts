import { Module } from '@nestjs/common';
import { LLM_PORT } from '../../ports/llm.port';
import { AnthropicLlmAdapter } from './anthropic.adapter';

/**
 * Bindea LLM_PORT al proveedor activo (LLM_PROVIDER). Hoy solo existe el
 * adapter de Anthropic; cuando haya key de OpenAI se agrega su adapter aquí
 * y se elige por env, sin tocar `modules/ai`. Ver docs/21 y docs/22.
 */
@Module({
  providers: [AnthropicLlmAdapter, { provide: LLM_PORT, useExisting: AnthropicLlmAdapter }],
  exports: [LLM_PORT],
})
export class LlmModule {}
