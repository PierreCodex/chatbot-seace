import { Global, Module } from '@nestjs/common';
import { FILES_PORT } from '../../ports/files.port';
import { AcfPdfRenderer } from './acf-pdf.renderer';
import { EntitiesPdfRenderer } from './entities-pdf.renderer';
import { FilesService } from './files.service';

/**
 * Adapter de archivos efímeros (PDF ACF). `@Global` para que tanto el API (bot
 * inline + FilesController) como el worker (SearchResultsListener) puedan
 * inyectar `FILES_PORT` sin importar el adapter (respeta el boundary ESLint).
 */
@Global()
@Module({
  providers: [AcfPdfRenderer, EntitiesPdfRenderer, { provide: FILES_PORT, useClass: FilesService }],
  exports: [FILES_PORT],
})
export class FilesModule {}
