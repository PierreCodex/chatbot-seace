import type { EntityLookupMatch } from './entity-lookup.port';
import type { StoredProcess } from './persistence/processes.repo.port';

/**
 * Genera y hospeda archivos efímeros para entregarlos por WhatsApp (MVP: el PDF
 * con todos los anuncios ACF cuando hay >5 resultados). El render es backend; el
 * bot/listener solo piden la URL ya hospedada y la pasan al presenter como `pdfUrl`.
 */
export interface FilesPort {
  /**
   * Renderiza el PDF de anuncios ACF, lo hospeda (cache efímero) y devuelve la
   * URL pública. Devuelve `null` si no se puede hospedar (p.ej. falta
   * `PUBLIC_BASE_URL`) — el presenter degrada a tarjetas sin romperse.
   */
  hostAcfPdf(processes: StoredProcess[]): Promise<string | null>;

  /**
   * Renderiza el PDF con el listado de entidades coincidentes (cuando hay >10),
   * lo hospeda y devuelve la URL pública. `null` si no se puede hospedar.
   */
  hostEntitiesPdf(matches: EntityLookupMatch[]): Promise<string | null>;

  /** Recupera un PDF hospedado por su token (lo sirve el FilesController). */
  getPdf(token: string): Promise<Buffer | null>;
}

export const FILES_PORT = Symbol('FILES_PORT');
