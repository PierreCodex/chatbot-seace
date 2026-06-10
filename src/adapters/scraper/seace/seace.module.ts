import { Module } from '@nestjs/common';
import { ENTITY_LOOKUP_PORT } from '../../../ports/entity-lookup.port';
import { SCRAPER_PORT } from '../../../ports/scraper.port';
import { BrowserManager } from './browser/browser.manager';
import { ContextFactory } from './browser/context.factory';
import { EntityModalScraper } from './entity-modal.scraper';
import { LabelResolver } from './locators/label-resolver';
import { EntityRowsParser } from './parsers/entity-rows.parser';
import { HtmlRowsParser } from './parsers/html-rows.parser';
import { SeaceAdapter } from './seace.adapter';
import { SessionManager } from './session/session.manager';
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
    TabStrategyRegistry,
    EntityModalScraper,
    { provide: SCRAPER_PORT, useClass: SeaceAdapter },
    { provide: ENTITY_LOOKUP_PORT, useExisting: EntityModalScraper },
  ],
  exports: [SCRAPER_PORT, ENTITY_LOOKUP_PORT, EntityModalScraper],
})
export class SeaceScraperModule {}
