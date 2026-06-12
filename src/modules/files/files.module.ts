import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';

/**
 * Registra el FilesController en el API. El proveedor de `FILES_PORT` lo aporta
 * el adapter global `FilesModule` (`src/adapters/files`), así que aquí no se
 * importa nada de adapters.
 */
@Module({ controllers: [FilesController] })
export class FilesHttpModule {}
