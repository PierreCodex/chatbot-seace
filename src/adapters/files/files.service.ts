import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { CACHE_PORT, type CachePort } from '../../ports/cache.port';
import type { EntityLookupMatch } from '../../ports/entity-lookup.port';
import type { FilesPort } from '../../ports/files.port';
import type { StoredProcess } from '../../ports/persistence/processes.repo.port';
import { AcfPdfRenderer } from './acf-pdf.renderer';
import { EntitiesPdfRenderer } from './entities-pdf.renderer';

const CACHE_PREFIX = 'file:pdf:';
const TTL_SECONDS = 30 * 60; // 30 min — basta para que Meta descargue el link

/**
 * Hospedaje efímero de PDFs (sin Storage): renderiza, guarda el binario en Redis
 * (base64) bajo un token y devuelve una URL pública `${PUBLIC_BASE_URL}/files/<token>.pdf`
 * que sirve el FilesController. Si no hay `PUBLIC_BASE_URL`, no se puede entregar
 * un link a Meta → devuelve `null` y el presenter degrada a tarjetas.
 */
@Injectable()
export class FilesService implements FilesPort {
  private readonly logger = new Logger(FilesService.name);
  private readonly publicBaseUrl: string;

  constructor(
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    private readonly renderer: AcfPdfRenderer,
    private readonly entitiesRenderer: EntitiesPdfRenderer,
    config: ConfigService<Env, true>,
  ) {
    // PUBLIC_BASE_URL es opcional en el schema; normalizamos sin slash final.
    const publicBaseUrl = config.get('PUBLIC_BASE_URL', { infer: true });
    this.publicBaseUrl = (publicBaseUrl ?? '').replace(/\/+$/, '');
  }

  async hostAcfPdf(processes: StoredProcess[]): Promise<string | null> {
    if (processes.length === 0) return null;
    return this.host(() => this.renderer.render(processes));
  }

  async hostEntitiesPdf(matches: EntityLookupMatch[]): Promise<string | null> {
    if (matches.length === 0) return null;
    return this.host(() => this.entitiesRenderer.render(matches));
  }

  /** Renderiza, cachea el binario bajo un token y devuelve la URL pública. */
  private async host(render: () => Promise<Buffer>): Promise<string | null> {
    if (!this.publicBaseUrl) {
      this.logger.debug('PUBLIC_BASE_URL no configurado; se omite el PDF');
      return null;
    }
    try {
      const pdf = await render();
      const token = randomUUID();
      await this.cache.set(`${CACHE_PREFIX}${token}`, pdf.toString('base64'), TTL_SECONDS);
      return `${this.publicBaseUrl}/files/${token}.pdf`;
    } catch (err) {
      this.logger.warn(`no se pudo hospedar el PDF: ${(err as Error).message}`);
      return null;
    }
  }

  async getPdf(token: string): Promise<Buffer | null> {
    const b64 = await this.cache.get<string>(`${CACHE_PREFIX}${token}`);
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
}
