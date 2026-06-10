export interface EntityLookupMatch {
  ruc: string;
  nombre: string;
  tipoDoc: string | null;
}

export interface EntityLookupOptions {
  maxPages?: number;
}

/**
 * Resuelve entidades scrapeando el modal "Buscar Entidad" de SEACE. Usado
 * por el cascade L1/L2/L3 cuando la DB local no tiene matches suficientes,
 * y por la estrategia de procedimientos para asociar una entidad por RUC
 * antes del submit.
 */
export interface EntityLookupPort {
  searchByNombre(q: string, opts?: EntityLookupOptions): Promise<EntityLookupMatch[]>;
}

export const ENTITY_LOOKUP_PORT = Symbol('ENTITY_LOOKUP_PORT');
