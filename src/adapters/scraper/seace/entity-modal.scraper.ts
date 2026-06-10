import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import type {
  EntityLookupMatch,
  EntityLookupOptions,
  EntityLookupPort,
} from '../../../ports/entity-lookup.port';
import { ContextFactory } from './browser/context.factory';
import { EntityRowsParser, type ParsedEntityModal } from './parsers/entity-rows.parser';
import { SessionManager } from './session/session.manager';
import { escId, TAB_FORM_IDS, TAB_LINK_HASH } from './seace.types';

const PROCEDIMIENTOS_FORM = TAB_FORM_IDS.procedimientos;
const LUPA_ID = `${PROCEDIMIENTOS_FORM}:ajax`;
const DIALOG_ID = `${PROCEDIMIENTOS_FORM}:frmBuscarEntidad`;
const INPUT_NOMBRE = `${PROCEDIMIENTOS_FORM}:txtNombreEntidad`;
const INPUT_RUC = `${PROCEDIMIENTOS_FORM}:txtRucEntidad`;
const BTN_BUSCAR_MODAL = `${PROCEDIMIENTOS_FORM}:btnBuscarEntidad`;
const DATATABLE = `${PROCEDIMIENTOS_FORM}:dataTable`;

/**
 * Driver del modal "Buscar Entidad" del tab Procedimientos.
 *
 * Dos casos de uso:
 *  - `searchByNombre`: el bot pregunta al usuario, el usuario tipea "piura",
 *    devolvemos la lista para que elija. NO toca el form principal.
 *  - `pickByRuc`: el bot ya conoce el RUC (porque el usuario eligió antes),
 *    abre modal, busca por RUC, clickea "Seleccionar" → el form principal
 *    queda asociado a esa entidad en el backend de SEACE.
 */
@Injectable()
export class EntityModalScraper implements EntityLookupPort {
  private readonly logger = new Logger(EntityModalScraper.name);

  constructor(
    private readonly contexts: ContextFactory,
    private readonly session: SessionManager,
    private readonly parser: EntityRowsParser,
  ) {}

  /**
   * Abre un context propio, navega a SEACE, switchea a Procedimientos, abre
   * el modal y devuelve hasta `maxPages * 10` entidades que coinciden con
   * el texto en el campo "Nombre Entidad".
   */
  async searchByNombre(nombre: string, opts?: EntityLookupOptions): Promise<EntityLookupMatch[]> {
    const startedAt = Date.now();
    const jc = await this.contexts.create();
    try {
      await this.session.openBuscador(jc.page);
      await this.switchToProcedimientos(jc.page);
      await this.openModal(jc.page);
      await this.fillInputAndSearch(jc.page, INPUT_NOMBRE, nombre);

      const collected: EntityLookupMatch[] = [];
      const maxPages = opts?.maxPages ?? 3;
      let page = 1;
      while (page <= maxPages) {
        const parsed = await this.parseCurrentPage(jc.page);
        collected.push(...parsed.rows);
        if (parsed.rows.length === 0) break;
        if (parsed.totalPages != null && page >= parsed.totalPages) break;
        const advanced = await this.goNextPage(jc.page);
        if (!advanced) break;
        page++;
        await this.session.waitForPrimefaces(jc.page, 10_000);
      }
      this.logger.log(
        `entity-modal "${nombre}": ${collected.length} matches en ${page} páginas (${Date.now() - startedAt}ms)`,
      );
      return collected;
    } finally {
      await jc.close();
    }
  }

  /**
   * Aplica un filtro de entidad por RUC al form principal de Procedimientos.
   * Reusa una `page` ya abierta (la del scrape de procesos), abre el modal,
   * busca por RUC, clickea "Seleccionar" del primer match. Al volver, el
   * input visible "Nombre o Sigla de Entidad" queda lleno y el backend ya
   * tiene la entidad asociada para el siguiente submit del form principal.
   */
  async pickByRuc(page: Page, ruc: string): Promise<boolean> {
    await this.openModal(page);
    await this.fillInputAndSearch(page, INPUT_RUC, ruc);
    const parsed = await this.parseCurrentPage(page);
    if (parsed.rows.length === 0) {
      this.logger.warn(`pickByRuc: RUC ${ruc} no devolvió matches`);
      return false;
    }
    const ok = await page.evaluate((tableId) => {
      const tbl = document.getElementById(tableId);
      const firstRow = tbl?.querySelector('tbody.ui-datatable-data tr');
      const selectorLink = firstRow?.querySelector('td:last-child a') as HTMLElement | null;
      if (!selectorLink) return false;
      selectorLink.click();
      return true;
    }, DATATABLE);
    if (!ok) {
      this.logger.warn(`pickByRuc: link "Seleccionar" no encontrado para RUC ${ruc}`);
      return false;
    }
    await this.session.waitForPrimefaces(page, 10_000);
    return true;
  }

  private async switchToProcedimientos(page: Page): Promise<void> {
    const hash = TAB_LINK_HASH.procedimientos;
    const link = page.locator(`a[href="${hash}"]`).first();
    const visible = await link.isVisible().catch(() => false);
    if (!visible) return; // ya activo o no presente
    await link.click();
    await this.session.waitForPrimefaces(page, 5_000);
  }

  private async openModal(page: Page): Promise<void> {
    const clicked = await page.evaluate((id) => {
      const el = document.getElementById(id) as HTMLElement | null;
      if (!el) return false;
      el.click();
      return true;
    }, LUPA_ID);
    if (!clicked) throw new Error(`Lupa de entidad (#${LUPA_ID}) no encontrada`);
    // El click hace `frmBuscarEntidad.show()` + PrimeFaces.ab para hidratar el dialog.
    await this.session.waitForPrimefaces(page, 10_000);
    await page.waitForSelector(`#${escId(DIALOG_ID)}`, { state: 'visible', timeout: 5_000 });
  }

  private async fillInputAndSearch(page: Page, inputId: string, value: string): Promise<void> {
    const ok = await page.evaluate(
      ({ id, val }) => {
        const i = document.getElementById(id) as HTMLInputElement | null;
        if (!i) return false;
        i.value = val;
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      { id: inputId, val: value },
    );
    if (!ok) throw new Error(`Input #${inputId} no encontrado dentro del modal`);
    const clicked = await page.evaluate((id) => {
      const btn = document.getElementById(id) as HTMLElement | null;
      if (!btn) return false;
      btn.click();
      return true;
    }, BTN_BUSCAR_MODAL);
    if (!clicked) throw new Error(`Botón Buscar del modal (#${BTN_BUSCAR_MODAL}) no encontrado`);
    await this.session.waitForPrimefaces(page, 20_000);
  }

  private async parseCurrentPage(page: Page): Promise<ParsedEntityModal> {
    const html = await page.content();
    return this.parser.parse(html, PROCEDIMIENTOS_FORM);
  }

  private async goNextPage(page: Page): Promise<boolean> {
    const paginatorId = `${DATATABLE}_paginator_bottom`;
    const clicked = await page.evaluate((id) => {
      const container = document.getElementById(id);
      const next = container?.querySelector('.ui-paginator-next') as HTMLElement | null;
      if (!next) return false;
      if (next.classList.contains('ui-state-disabled')) return false;
      next.click();
      return true;
    }, paginatorId);
    return clicked;
  }
}
