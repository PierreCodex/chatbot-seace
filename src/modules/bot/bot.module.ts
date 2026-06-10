import { Module } from '@nestjs/common';
import { KapsoMessagingModule } from '../../adapters/messaging/kapso/kapso.module';
import { SearchModule } from '../search/search.module';
import { ConversationService } from './conversation.service';
import { ConversationStore } from './conversation.store';
import { FlowRegistry } from './flow.registry';
import { MainMenuFlow } from './flows/main-menu.flow';
import { SearchProcesosFlow } from './flows/search-procesos.flow';
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
    MainMenuFlow,
    SearchProcesosFlow,
    WaUsersService,
    ConversationService,
    {
      provide: 'FLOW_INITIALIZER',
      useFactory: (
        registry: FlowRegistry,
        mainMenu: MainMenuFlow,
        searchProcesos: SearchProcesosFlow,
      ) => {
        registry.register(mainMenu);
        registry.register(searchProcesos);
        return true;
      },
      inject: [FlowRegistry, MainMenuFlow, SearchProcesosFlow],
    },
  ],
})
export class BotModule {}
