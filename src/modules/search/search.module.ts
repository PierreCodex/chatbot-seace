import { Module } from '@nestjs/common';
import { MessagingModule } from '../../adapters/messaging/messaging.module';
import { SeaceScraperModule } from '../../adapters/scraper/seace/seace.module';
import { EntitySearchService } from './entity-search.service';
import { AcfResultsPresenter } from './presenters/acf-results.presenter';
import { SearchResultsPresenter } from './presenters/search-results.presenter';
import { SearchResultsListener } from './search-results.listener';
import { SearchFacade } from './search.facade';

@Module({
  imports: [SeaceScraperModule, MessagingModule.register()],
  providers: [
    EntitySearchService,
    SearchFacade,
    SearchResultsPresenter,
    AcfResultsPresenter,
    SearchResultsListener,
  ],
  exports: [EntitySearchService, SearchFacade, SearchResultsPresenter, AcfResultsPresenter],
})
export class SearchModule {}
