import { Module } from '@nestjs/common';
import { MessagingModule } from '../../adapters/messaging/messaging.module';
import { AdminModule } from '../admin/admin.module';
import { SearchModule } from '../search/search.module';
import { ConversationService } from './conversation.service';
import { ConversationStore } from './conversation.store';
import { FlowRegistry } from './flow.registry';
import { EntityResolverFlow } from './flows/entity-resolver.flow';
import { MainMenuFlow } from './flows/main-menu.flow';
import { SearchAnunciosFlow } from './flows/search-anuncios.flow';
import { SearchProcesosFlow } from './flows/search-procesos.flow';
import { SubscribeFlow } from './flows/subscribe.flow';
import { EntityResultsPresenter } from './presenters/entity.presenter';
import { MenuPresenter } from './presenters/menu.presenter';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { WaUsersService } from './wa-users.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [MessagingModule.register(), SearchModule, AdminModule],
  // Ambos controllers se registran; solo recibe tráfico el del canal activo
  // (cada plataforma llama únicamente a su propia ruta).
  controllers: [WebhookController, TelegramWebhookController],
  providers: [
    ConversationStore,
    FlowRegistry,
    MenuPresenter,
    EntityResultsPresenter,
    MainMenuFlow,
    SearchAnunciosFlow,
    EntityResolverFlow,
    SearchProcesosFlow,
    SubscribeFlow,
    WaUsersService,
    ConversationService,
    {
      provide: 'FLOW_INITIALIZER',
      useFactory: (
        registry: FlowRegistry,
        mainMenu: MainMenuFlow,
        anuncios: SearchAnunciosFlow,
        entity: EntityResolverFlow,
        searchProcesos: SearchProcesosFlow,
        subscribe: SubscribeFlow,
      ) => {
        registry.register(mainMenu);
        registry.register(anuncios);
        registry.register(entity);
        registry.register(searchProcesos);
        registry.register(subscribe);
        return true;
      },
      inject: [
        FlowRegistry,
        MainMenuFlow,
        SearchAnunciosFlow,
        EntityResolverFlow,
        SearchProcesosFlow,
        SubscribeFlow,
      ],
    },
  ],
})
export class BotModule {}
