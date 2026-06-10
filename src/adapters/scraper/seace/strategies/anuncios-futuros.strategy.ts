import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import type { SearchFilters, TabName } from '../../../../ports/persistence/types';
import { LabelResolver } from '../locators/label-resolver';
import { HtmlRowsParser } from '../parsers/html-rows.parser';
import { SessionManager } from '../session/session.manager';
import { escId, ScrapeValidationError, TAB_FORM_IDS, TAB_LINK_HASH } from '../seace.types';
import type { ParsedPage, TabStrategy } from './tab.strategy';

/**
 * Estrategia de la pestaña "Anuncio de Contratación Futura" (ACF, tab7).
 *
 * Diferencias clave con Procedimientos (ver docs/04-scraping.md §2.4):
 *  - `Objeto de Contratación` es **obligatorio**; no hay "Año de la Convocatoria".
 *  - El select de Objeto usa valores propios (`cbxObjContratacion`).
 *  - Las filas NO tienen nomenclatura/nidProceso/ficha → datatable `dtResultadosACF`.
 *
 * El filtro por **entidad** (A1) NO se aplica vía scraping aquí: el crawler hace
 * búsquedas objeto-only (A2) y el match por entidad se resuelve en SQL (fan-out,
 * ver docs/09 §2.1). Por eso `entityRuc` se ignora a nivel de scrape.
 */
@Injectable()
export class AnunciosFuturosStrategy implements TabStrategy {
  readonly tab: TabName = 'anuncios_futuros';
  readonly formId = TAB_FORM_IDS.anuncios_futuros;

  private readonly logger = new Logger(AnunciosFuturosStrategy.name);

  constructor(
    private readonly session: SessionManager,
    private readonly labels: LabelResolver,
    private readonly parser: HtmlRowsParser,
  ) {}

  async switchTo(page: Page): Promise<void> {
    const link = page.locator(`a[href="${TAB_LINK_HASH.anuncios_futuros}"]`).first();
    const visible = await link.isVisible().catch(() => false);
    if (!visible) {
      // ACF es la pestaña por defecto al cargar el buscador; si el link no está
      // visible asumimos que ya está activa.
      this.logger.warn('tab link ACF no visible; asumimos pestaña ya activa');
      return;
    }
    await link.click();
    await this.session.waitForPrimefaces(page, 5_000);
  }

  async applyFilters(page: Page, filters: SearchFilters): Promise<void> {
    // Objeto de Contratación: OBLIGATORIO en ACF.
    if (!filters.objeto) {
      throw new ScrapeValidationError(['ACF requiere "Objeto de Contratación" (obligatorio)']);
    }
    const objBaseId = await this.resolveSelectBase(
      page,
      'cbxObjContratacion',
      'Objeto de Contratación',
    );
    if (!objBaseId) {
      throw new ScrapeValidationError(['No se localizó el select Objeto de Contratación (ACF)']);
    }
    await this.selectPrimefacesOption(page, objBaseId, OBJETO_LABEL[filters.objeto]);

    // Descripción del objeto (palabra clave) — opcional.
    if (filters.keyword) {
      await this.fillInputJs(page, ':descripcionObjeto', filters.keyword);
    }

    // El filtro por entidad se resuelve en SQL (fan-out), no vía el modal ACF.
    if (filters.entityRuc) {
      this.logger.debug(
        `ACF: entityRuc=${filters.entityRuc} se filtra en SQL (fan-out), no vía scrape`,
      );
    }
  }

  async search(page: Page): Promise<void> {
    const btnId = `${this.formId}:btnBuscarSel`;
    const dispatched = await page.evaluate((id) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (!el) return false;
      el.click();
      return true;
    }, btnId);
    if (!dispatched) {
      throw new ScrapeValidationError([`Botón Buscar (#${btnId}) no encontrado`]);
    }
    await this.session.waitForPrimefaces(page, 30_000);
    await this.session.ensureNotExpired(page);
    const errors = await page
      .locator('#frmMesajes .ui-messages-error-detail')
      .allTextContents()
      .catch(() => []);
    if (errors.length) {
      throw new ScrapeValidationError(errors);
    }
  }

  async parse(page: Page): Promise<ParsedPage> {
    const html = await page.content();
    return this.parser.parseAnunciosFuturos(html, this.formId);
  }

  async goToNextPage(page: Page): Promise<boolean> {
    const paginatorId = `${this.formId}:dtResultadosACF_paginator_bottom`;
    const nextLoc = page.locator(`#${escId(paginatorId)} .ui-paginator-next`).first();
    const classes = (await nextLoc.getAttribute('class').catch(() => null)) ?? '';
    if (classes.includes('ui-state-disabled')) {
      return false;
    }
    const clicked = await page.evaluate((id) => {
      const container = document.getElementById(id);
      const next = container?.querySelector('.ui-paginator-next') as HTMLElement | null;
      if (!next) return false;
      next.click();
      return true;
    }, paginatorId);
    if (!clicked) return false;
    await this.session.waitForPrimefaces(page, 25_000);
    return true;
  }

  /** Setea un input del form vía JS disparando `input`/`change` para PrimeFaces. */
  private async fillInputJs(page: Page, idSuffix: string, value: string): Promise<void> {
    const ok = await page.evaluate(
      ({ formId, idSuffix, value }) => {
        const form = document.getElementById(formId);
        if (!form) return false;
        const input = form.querySelector(`input[id$="${idSuffix}"]`) as HTMLInputElement | null;
        if (!input) return false;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      { formId: this.formId, idSuffix, value },
    );
    if (!ok) {
      throw new ScrapeValidationError([`Input ${idSuffix} no encontrado en form ${this.formId}`]);
    }
  }

  private async resolveSelectBase(
    page: Page,
    stableSuffix: string,
    labelText: string,
  ): Promise<string | null> {
    const candidate = await page
      .locator(`form#${escId(this.formId)} [id$=":${stableSuffix}_input"]`)
      .first()
      .getAttribute('id')
      .catch(() => null);
    if (candidate) return candidate.replace(/_input$/, '');
    return this.labels.resolveSelectByAdjacentLabel(page, this.formId, labelText);
  }

  private async selectPrimefacesOption(
    page: Page,
    baseId: string,
    optionLabel: string,
  ): Promise<void> {
    const inputSel = `#${escId(`${baseId}_input`)}`;
    try {
      await page.locator(inputSel).selectOption({ label: optionLabel });
      return;
    } catch {
      /* PrimeFaces only listens to the styled div */
    }
    await page.locator(`#${escId(baseId)}`).click();
    await page
      .locator(`#${escId(`${baseId}_panel`)} li`)
      .filter({ hasText: new RegExp(`^${escapeRegex(optionLabel)}$`) })
      .first()
      .click();
  }
}

const OBJETO_LABEL: Record<NonNullable<SearchFilters['objeto']>, string> = {
  bien: 'Bien',
  servicio: 'Servicio',
  obra: 'Obra',
  consultoria_obra: 'Consultoría de Obra',
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
