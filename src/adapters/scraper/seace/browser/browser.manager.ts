import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContextOptions } from 'playwright';
import { SEACE_USER_AGENT, SEACE_VIEWPORT } from '../seace.types';

/**
 * Mantiene 1 instancia persistente de Chromium para todo el worker.
 * Cada job toma un BrowserContext nuevo (via ContextFactory) y lo descarta.
 */
@Injectable()
export class BrowserManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserManager.name);
  private browser: Browser | null = null;
  private static stealthApplied = false;

  async onModuleInit(): Promise<void> {
    if (!BrowserManager.stealthApplied) {
      chromium.use(StealthPlugin());
      BrowserManager.stealthApplied = true;
    }
    const headless = process.env.SEACE_HEADLESS !== 'false';
    this.browser = await chromium.launch({
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    this.logger.log(`Chromium launched (headless=${headless})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch((err) => this.logger.warn(`close error: ${err}`));
      this.browser = null;
    }
  }

  get(): Browser {
    if (!this.browser) {
      throw new Error('BrowserManager: browser not initialized (call onModuleInit first)');
    }
    return this.browser;
  }

  defaultContextOptions(): BrowserContextOptions {
    return {
      userAgent: SEACE_USER_AGENT,
      viewport: { ...SEACE_VIEWPORT },
      locale: 'es-PE',
      timezoneId: 'America/Lima',
      ignoreHTTPSErrors: false,
      acceptDownloads: true,
    };
  }
}
