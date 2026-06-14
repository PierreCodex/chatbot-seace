import { Module } from '@nestjs/common';
import { MessagingModule } from '../../adapters/messaging/messaging.module';
import { AlertNotifierService } from './alert-notifier.service';
import { AlertPresenter } from './alert.presenter';
import { HitDetectionService } from './hit-detection.service';

/**
 * Motor de alertas (docs/09, docs/17 fase 6b): matcher + notifier. Corre en el
 * worker (junto al crawler). Importa el canal de mensajería para entregar avisos;
 * los repos son globales (PrismaPersistenceModule).
 */
@Module({
  imports: [MessagingModule.register()],
  providers: [HitDetectionService, AlertNotifierService, AlertPresenter],
  exports: [HitDetectionService, AlertNotifierService],
})
export class AlertsModule {}
