import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { FILES_PORT, type FilesPort } from '../../ports/files.port';

/**
 * Sirve los PDF efímeros hospedados por `FilesService` para que Meta los
 * descargue por link. Vive en `modules/` e inyecta solo el port (no toca
 * adapters → respeta el boundary). Solo se registra en el API.
 */
@Controller('files')
export class FilesController {
  constructor(@Inject(FILES_PORT) private readonly files: FilesPort) {}

  @Get(':token.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="anuncios-futuros.pdf"')
  async getPdf(@Param('token') token: string): Promise<StreamableFile> {
    const pdf = await this.files.getPdf(token);
    if (!pdf) throw new NotFoundException('Archivo no encontrado o expirado');
    return new StreamableFile(pdf);
  }
}
