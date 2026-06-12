import { Module } from '@nestjs/common';
import { ENTITY_LOOKUP_PORT } from '../../../ports/entity-lookup.port';
import { SCRAPER_PORT } from '../../../ports/scraper.port';
import { BrowserManager } from './browser/browser.manager';
import { ContextFactory } from './browser/context.factory';
import { EntityModalScraper } from './entity-modal.scraper';
import { EntityHttpScraper } from './entity-http.scraper';
import { AcfHttpScraper } from './acf-http.scraper';
import { EntityFetchLookup } from './entity-fetch.lookup';
import { LabelResolver } from './locators/label-resolver';
import { EntityRowsParser } from './parsers/entity-rows.parser';
import { HtmlRowsParser } from './parsers/html-rows.parser';
import { SeaceAdapter } from './seace.adapter';
import { SessionManager } from './session/session.manager';
import { AnunciosFuturosStrategy } from './strategies/anuncios-futuros.strategy';
import { ProcedimientosStrategy } from './strategies/procedimientos.strategy';
import { TabStrategyRegistry } from './strategies/tab-strategy.registry';

@Module({
  providers: [
    BrowserManager,
    ContextFactory,
    SessionManager,
    LabelResolver,
    HtmlRowsParser,
    EntityRowsParser,
    ProcedimientosStrategy,
    AnunciosFuturosStrategy,
    TabStrategyRegistry,
    EntityModalScraper,
    EntityHttpScraper,
    EntityFetchLookup,
    AcfHttpScraper,
    { provide: SCRAPER_PORT, useClass: SeaceAdapter },
    // Lookup en vivo por fetch puro (autoritativo, ~1-2s, sin Playwright). El
    // EntityModalScraper (navegador) queda disponible para crawls/respaldo.
    { provide: ENTITY_LOOKUP_PORT, useExisting: EntityFetchLookup },
  ],
  exports: [
    SCRAPER_PORT,
    ENTITY_LOOKUP_PORT,
    EntityModalScraper,
    EntityHttpScraper,
    EntityFetchLookup,
    AcfHttpScraper,
  ],
})
export class SeaceScraperModule {}
