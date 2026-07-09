import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PORT, type LlmPort } from '../../ports/llm.port';
import type { StoredProcess } from '../../ports/persistence/processes.repo.port';
import { clasificacionSchema } from './intent.schema';

const MAX_CANDIDATES = 50;
const DESCRIPTION_CAP = 180;
const MAX_RUBRO_LABEL = 32;

export interface RubroGroup {
  rubro: string;
  /** Cuántos anuncios del set cayeron en este rubro (contado por el código). */
  count: number;
  /** IDs de la BD de los anuncios del rubro (para filtros futuros por rubro). */
  ids: string[];
}

/**
 * Resumen inteligente de resultados (docs/21 fase 2, adelantado): el LLM
 * agrupa los anuncios en rubros temáticos y devuelve SOLO etiquetas + índices.
 * El código cuenta, ordena y renderiza — el usuario nunca lee texto del LLM.
 * Ante cualquier fallo devuelve null y la respuesta sale sin resumen (la
 * tarjeta de siempre): mejora progresiva, nunca un punto de falla.
 */
@Injectable()
export class ResultsSummaryService {
  private readonly logger = new Logger(ResultsSummaryService.name);

  constructor(@Inject(LLM_PORT) private readonly llm: LlmPort) {}

  async classify(processes: StoredProcess[]): Promise<RubroGroup[] | null> {
    const pool = processes.slice(0, MAX_CANDIDATES);
    if (pool.length < 2) return null;

    const list = pool
      .map((p, i) => `${i}. ${truncate(p.descripcion ?? '(sin descripción)', DESCRIPTION_CAP)}`)
      .join('\n');

    const started = Date.now();
    try {
      const result = await this.llm.extract({
        system:
          'Clasificas anuncios de contratación pública (SEACE, Perú) en rubros temáticos. ' +
          'Recibes descripciones numeradas. Agrúpalas en 2 a 6 rubros con etiquetas cortas ' +
          '(1-3 palabras, en español, ej. "Salud", "Educación", "Vías y transporte", ' +
          '"Saneamiento", "Equipamiento"). Cada índice va en EXACTAMENTE un rubro. ' +
          'No inventes rubros vacíos ni índices que no existan.',
        user: `Anuncios:\n${list}`,
        schema: clasificacionSchema,
        schemaName: 'clasificacion',
        maxTokens: 400,
      });

      // El LLM solo propuso etiquetas+índices; validamos y contamos nosotros.
      const seen = new Set<number>();
      const groups: RubroGroup[] = [];
      for (const g of result.rubros) {
        const rubro = g.rubro.trim().slice(0, MAX_RUBRO_LABEL);
        const valid = g.indices.filter((i) => i >= 0 && i < pool.length && !seen.has(i));
        if (!rubro || valid.length === 0) continue;
        valid.forEach((i) => seen.add(i));
        groups.push({ rubro, count: valid.length, ids: valid.map((i) => pool[i].id) });
      }
      // Índices que el LLM no clasificó → "Otros" (calculado, no inventado).
      const rest = pool.map((_, i) => i).filter((i) => !seen.has(i));
      if (rest.length > 0 && groups.length > 0) {
        groups.push({ rubro: 'Otros', count: rest.length, ids: rest.map((i) => pool[i].id) });
      }
      if (groups.length < 2) return null; // un solo rubro no aporta lectura

      groups.sort((a, b) => b.count - a.count || a.rubro.localeCompare(b.rubro));
      this.logger.log(
        `clasificación ${pool.length} anuncios → ${groups.length} rubros en ${Date.now() - started}ms`,
      );
      return groups;
    } catch (err) {
      this.logger.warn(`clasificación falló (${(err as Error).message}) — sin resumen`);
      return null;
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}
