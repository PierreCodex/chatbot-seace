import { Injectable, Logger } from '@nestjs/common';
import type { BrowserContext, Page } from 'playwright';
import { BrowserManager } from './browser.manager';

export interface JobContext {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/**
 * Crea un BrowserContext + Page por job y los limpia al terminar.
 * En MVP la simplicidad gana: 1 contexto = 1 job, sin pool.
 */
@Injectable()
export class ContextFactory {
  private readonly logger = new Logger(ContextFactory.name);

  constructor(private readonly browser: BrowserManager) {}

  async create(): Promise<JobContext> {
    const context = await this.browser.get().newContext(this.browser.defaultContextOptions());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    return {
      context,
      page,
      close: async () => {
        await page.close().catch((err) => this.logger.warn(`page close: ${err}`));
        await context.close().catch((err) => this.logger.warn(`context close: ${err}`));
      },
    };
  }
}
