import { Module } from '@nestjs/common';
import { LlmModule } from '../../adapters/llm/llm.module';
import { IntentService } from './intent.service';
import { ReplyComposerService } from './reply-composer.service';
import { RerankService } from './rerank.service';
import { ResultsSummaryService } from './results-summary.service';

/**
 * Módulo de IA conversacional (docs/21). Servicios puros de interpretación:
 * NLU (IntentService) y filtrado semántico (RerankService). La orquestación
 * del chat vive en modules/bot (NluRouterFlow); las respuestas al usuario
 * siempre salen de presenters/plantillas, nunca del LLM.
 */
@Module({
  imports: [LlmModule],
  providers: [IntentService, RerankService, ResultsSummaryService, ReplyComposerService],
  exports: [IntentService, RerankService, ResultsSummaryService, ReplyComposerService],
})
export class AiModule {}
