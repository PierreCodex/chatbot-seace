import { Module } from '@nestjs/common';
import { KapsoMessagingModule } from '../../adapters/messaging/kapso/kapso.module';
import { SeaceScraperModule } from '../../adapters/scraper/seace/seace.module';
import { EntitySearchService } from './entity-search.service';
import { SearchResultsPresenter } from './presenters/search-results.presenter';
import { SearchResultsListener } from './search-results.listener';
import { SearchFacade } from './search.facade';

@Module({
  imports: [SeaceScraperModule, KapsoMessagingModule],
  providers: [EntitySearchService, SearchFacade, SearchResultsPresenter, SearchResultsListener],
  exports: [EntitySearchService, SearchFacade, SearchResultsPresenter],
})
export class SearchModule {}
