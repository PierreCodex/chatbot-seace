import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { SEACE_BUSCADOR_URL, ViewExpiredError } from '../seace.types';

/**
 * Responsable de llevar una Page a "estado listo para buscar":
 *   - Navegar a buscadorPublico.xhtml
 *   - Esperar a que JSF/PrimeFaces termine de hidratar
 *   - Detectar ViewExpiredException temprano
 */
@Injectable()
export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);

  async openBuscador(page: Page): Promise<void> {
    const res = await page.goto(SEACE_BUSCADOR_URL, { waitUntil: 'domcontentloaded' });
    if (!res) throw new Error('SEACE: no response al abrir buscador');
    const status = res.status();
    if (status >= 400) {
      throw new Error(`SEACE: HTTP ${status} al abrir buscador`);
    }
    await this.ensureNotExpired(page);
    // Espera blanda a que PrimeFaces termine de inicializar.
    await page
      .waitForLoadState('networkidle', { timeout: 10_000 })
      .catch(() => this.logger.debug('networkidle timeout (continuamos)'));
  }

  async ensureNotExpired(page: Page): Promise<void> {
    const html = await page.content();
    if (html.includes('ViewExpiredException') || html.includes('viewExpiredException')) {
      throw new ViewExpiredError();
    }
  }

  /**
   * Espera la respuesta AJAX típica de PrimeFaces tras un submit/click,
   * y a que el bloqueo modal `.ui-blockui-content` desaparezca.
   */
  async waitForPrimefaces(page: Page, timeoutMs = 20_000): Promise<void> {
    const ajax = page
      .waitForResponse(
        (r) =>
          r.url().includes('buscadorPublico') &&
          r.request().method() === 'POST' &&
          (r.request().headers()['faces-request'] === 'partial/ajax' ||
            r.headers()['content-type']?.includes('xml') === true),
        { timeout: timeoutMs },
      )
      .catch(() => null);

    await ajax;
    await page
      .waitForFunction(
        () => !document.querySelector('.ui-blockui-content:not([style*="display: none"])'),
        { timeout: timeoutMs },
      )
      .catch(() => {
        /* si nunca aparece el blockui, está OK */
      });
  }
}
