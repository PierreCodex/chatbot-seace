// zod/v4: el helper de structured outputs del SDK de Anthropic tipa contra la
// API v4. Solo el stack de IA usa v4; el resto del proyecto sigue en v3 clásico.
import type { z } from 'zod/v4';

/**
 * Petición de extracción estructurada: el LLM recibe system+user y DEBE
 * devolver un objeto que valide contra `schema` (el proveedor garantiza el
 * shape vía structured outputs; el adapter re-valida con Zod al recibir).
 */
export interface LlmExtractRequest<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
  /** Nombre corto del schema (algunos proveedores lo exigen). */
  schemaName: string;
  maxTokens?: number;
  /** Override del presupuesto por llamada (default: NLU_TIMEOUT_MS). Lo usa
   * el warm-up, que tolera la compilación fría del schema (~10s). */
  timeoutMs?: number;
}

/**
 * Port agnóstico de proveedor LLM (docs/21 §3). El único uso permitido es
 * extracción estructurada — el LLM nunca redacta texto libre hacia el usuario.
 * Adapters: Anthropic (activo), OpenAI (cuando haya key). Lanza error ante
 * timeout/API caída/parse inválido; los servicios de `modules/ai` capturan y
 * degradan (fallback a botones), nunca propagan al usuario.
 */
export interface LlmPort {
  extract<S extends z.ZodType>(req: LlmExtractRequest<S>): Promise<z.infer<S>>;
}

export const LLM_PORT = Symbol('LLM_PORT');
