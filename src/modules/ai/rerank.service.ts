import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PORT, type LlmPort } from '../../ports/llm.port';
import type { StoredProcess } from '../../ports/persistence/processes.repo.port';
import { rerankSchema } from './intent.schema';

// Techo de candidatos que se mandan al LLM (el repo ya limita a 50; esto es un
// cinturón por si el límite sube). ~40 tokens por descripción truncada.
const MAX_CANDIDATES = 50;
const DESCRIPTION_CAP = 220;

/**
 * Re-rank semántico (docs/21 fase 1): tras el filtro SQL, el LLM decide cuáles
 * candidatos son REALMENTE relevantes a la keyword ("vigilancia para el
 * colegio" no es una obra de colegio). Devuelve solo IDs de la BD — el LLM
 * jamás redacta contenido. Ante cualquier fallo devuelve la lista original
 * (el ILIKE ya es un resultado válido).
 */
@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);

  constructor(@Inject(LLM_PORT) private readonly llm: LlmPort) {}

  async filter(
    candidates: StoredProcess[],
    args: { keyword: string; sinonimos: string[]; excluir: string[] },
  ): Promise<StoredProcess[]> {
    if (candidates.length <= 1) return candidates;
    const pool = candidates.slice(0, MAX_CANDIDATES);

    const list = pool
      .map((p, i) => `${i}. ${truncate(p.descripcion ?? '(sin descripción)', DESCRIPTION_CAP)}`)
      .join('\n');
    const exclusion = args.excluir.length
      ? `\nEXCLUYE los relacionados a: ${args.excluir.join(', ')}.`
      : '';

    const started = Date.now();
    try {
      const result = await this.llm.extract({
        system:
          'Filtras resultados de anuncios de contratación pública (SEACE, Perú). ' +
          'Recibes descripciones numeradas y un tema buscado. Devuelve los índices de los ' +
          'anuncios cuyo OBJETO DE CONTRATACIÓN corresponde realmente al tema (no basta que ' +
          'la palabra aparezca: "SERVICIO DE VIGILANCIA PARA EL COLEGIO X" no es una obra de ' +
          'colegios). Ante la duda, INCLUYE el índice (mejor un extra que perder uno real).',
        user:
          `Tema buscado: "${args.keyword}" (relacionados: ${args.sinonimos.join(', ') || '—'}).` +
          `${exclusion}\n\nAnuncios:\n${list}`,
        schema: rerankSchema,
        schemaName: 'rerank',
        maxTokens: 300,
      });

      const keep = new Set(result.indices.filter((i) => i >= 0 && i < pool.length));
      // Si el LLM descartó TODO, desconfiamos del re-rank antes que del ILIKE.
      if (keep.size === 0) {
        this.logger.warn(`rerank descartó todo (${pool.length} candidatos) — se ignora`);
        return candidates;
      }
      const filtered = pool.filter((_, i) => keep.has(i));
      this.logger.log(
        `rerank "${args.keyword}" ${pool.length}→${filtered.length} en ${Date.now() - started}ms`,
      );
      // Los candidatos que excedían MAX_CANDIDATES no fueron evaluados: se conservan.
      return [...filtered, ...candidates.slice(MAX_CANDIDATES)];
    } catch (err) {
      this.logger.warn(`rerank falló (${(err as Error).message}) — se usa el ILIKE tal cual`);
      return candidates;
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
