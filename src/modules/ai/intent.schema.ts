// zod/v4: requerido por el helper de structured outputs del SDK (ver llm.port.ts).
import { z } from 'zod/v4';

/** Ids de las respuestas FAQ pre-escritas (ver faq.answers.ts). El LLM solo
 * CLASIFICA en una de estas — nunca redacta la respuesta. */
export const FAQ_IDS = [
  'que_es_acf',
  'que_es_seace',
  'que_es_cui',
  'que_es_objeto',
  'como_funciona_bot',
  'como_alertas',
  'es_oficial',
  'planes',
  'fecha_convocatoria',
  'contacto',
] as const;

/**
 * Salida estructurada del NLU (docs/21 §3.3). Un solo objeto plano (no unión)
 * para máxima compatibilidad con structured outputs: todos los campos son
 * requeridos y los no aplicables van en null/[]/false — así el proveedor
 * garantiza el shape completo y el prompt define la semántica.
 */
export const nluIntentSchema = z.object({
  intent: z.enum([
    'buscar_acf',
    'crear_alerta',
    'ver_alertas',
    'buscar_entidad',
    'seguimiento_resultado',
    'faq',
    'ayuda',
    'fuera_de_alcance',
  ]),
  /** Objeto de contratación; null si el usuario no lo dijo ni es inferible. */
  objeto: z.enum(['obra', 'bien', 'servicio', 'consultoria_obra']).nullable(),
  /** Tema/keyword tal como lo dijo el usuario ("colegio", "carreteras"). */
  keyword: z.string().nullable(),
  /** Expansión de la keyword para el ILIKE (incluye variantes sin tilde). */
  sinonimos: z.array(z.string()),
  /** Entidad concreta nombrada ("GORE Piura", "muni de Sullana"); null si no. */
  entidad: z.string().nullable(),
  /** Lugar/región ("en Piura") — distinto de entidad; se resuelve contra el
   * catálogo de entidades. */
  ubicacion: z.string().nullable(),
  /** Temas a excluir ("pero no carreteras") → NOT ILIKE. */
  excluir: z.array(z.string()),
  /** Rango sobre fecha aproximada de convocatoria, ISO yyyy-mm-dd o null. */
  fechaDesde: z.string().nullable(),
  fechaHasta: z.string().nullable(),
  /** Cantidad pedida explícitamente ("los 15 más recientes"); null = todos. */
  limite: z.number().int().nullable(),
  /** true si pidió el PDF explícitamente ("dame el pdf de..."). */
  quierePdf: z.boolean(),
  /** Solo para intent=buscar_entidad: el texto a resolver (nombre/sigla/RUC). */
  entidadQuery: z.string().nullable(),
  /** Solo para intent=faq: cuál respuesta pre-escrita corresponde. */
  faqId: z.enum(FAQ_IDS).nullable(),
  /** Solo para intent=seguimiento_resultado: qué quiere saber del resultado previo. */
  pregunta: z.enum(['ubicacion', 'entidad', 'fechas', 'general']).nullable(),
});

export type NluIntent = z.infer<typeof nluIntentSchema>;

/** Salida del re-rank: índices (0-based) de los candidatos realmente
 * relevantes a la keyword del usuario. */
export const rerankSchema = z.object({
  indices: z.array(z.number().int()),
});
export type RerankResult = z.infer<typeof rerankSchema>;

/**
 * Clasificación de resultados por rubros (docs/21 fase 2, versión estructurada:
 * el LLM solo AGRUPA — etiqueta corta + índices —; los conteos, orden y render
 * los hace el código. Nada de texto libre hacia el usuario).
 */
/** Salida del redactor conversacional (capa social): SOLO el texto, que luego
 * valida el código (sanitizeReply) antes de enviarse. */
export const respuestaSchema = z.object({
  respuesta: z.string(),
});
export type Respuesta = z.infer<typeof respuestaSchema>;

export const clasificacionSchema = z.object({
  rubros: z.array(
    z.object({
      /** Etiqueta corta del rubro (1-3 palabras, ej. "Salud", "Vías y transporte"). */
      rubro: z.string(),
      /** Índices (0-based) de los anuncios que pertenecen a este rubro. */
      indices: z.array(z.number().int()),
    }),
  ),
});
export type Clasificacion = z.infer<typeof clasificacionSchema>;
