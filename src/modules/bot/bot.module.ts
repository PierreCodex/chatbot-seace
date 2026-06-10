import { Module } from '@nestjs/common';
import { KapsoMessagingModule } from '../../adapters/messaging/kapso/kapso.module';
import { SearchModule } from '../search/search.module';
import { ConversationService } from './conversation.service';
import { ConversationStore } from './conversation.store';
import { FlowRegistry } from './flow.registry';
import { MainMenuFlow } from './flows/main-menu.flow';
import { SearchAnunciosFlow } from './flows/search-anuncios.flow';
import { SearchProcesosFlow } from './flows/search-procesos.flow';
import { AcfResultsPresenter } from './presenters/acf-results.presenter';
import { MenuPresenter } from './presenters/menu.presenter';
import { WaUsersService } from './wa-users.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [KapsoMessagingModule, SearchModule],
  controllers: [WebhookController],
  providers: [
    ConversationStore,
    FlowRegistry,
    MenuPresenter,
    AcfResultsPresenter,
    MainMenuFlow,
    SearchAnunciosFlow,
    SearchProcesosFlow,
    WaUsersService,
    ConversationService,
    {
      provide: 'FLOW_INITIALIZER',
      useFactory: (
        registry: FlowRegistry,
        mainMenu: MainMenuFlow,
        anuncios: SearchAnunciosFlow,
        searchProcesos: SearchProcesosFlow,
      ) => {
        registry.register(mainMenu);
        registry.register(anuncios);
        registry.register(searchProcesos);
        return true;
      },
      inject: [FlowRegistry, MainMenuFlow, SearchAnunciosFlow, SearchProcesosFlow],
    },
  ],
})
export class BotModule {}
