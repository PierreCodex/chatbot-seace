import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import type { SearchFilters, TabName } from '../../../../ports/persistence/types';
import { EntityModalScraper } from '../entity-modal.scraper';
import { LabelResolver } from '../locators/label-resolver';
import { HtmlRowsParser } from '../parsers/html-rows.parser';
import { SessionManager } from '../session/session.manager';
import { escId, ScrapeValidationError, TAB_FORM_IDS, TAB_LINK_HASH } from '../seace.types';
import type { ParsedPage, TabStrategy } from './tab.strategy';

@Injectable()
export class ProcedimientosStrategy implements TabStrategy {
  readonly tab: TabName = 'procedimientos';
  readonly formId = TAB_FORM_IDS.procedimientos;

  private readonly logger = new Logger(ProcedimientosStrategy.name);

  constructor(
    private readonly session: SessionManager,
    private readonly labels: LabelResolver,
    private readonly parser: HtmlRowsParser,
    private readonly entityModal: EntityModalScraper,
  ) {}

  async switchTo(page: Page): Promise<void> {
    const linkHash = TAB_LINK_HASH.procedimientos;
    const link = page.locator(`a[href="${linkHash}"]`).first();
    const visible = await link.isVisible().catch(() => false);
    if (!visible) {
      this.logger.warn('tab link no visible; asumimos pestaña ya activa');
      return;
    }
    await link.click();
    await this.session.waitForPrimefaces(page, 5_000);
  }

  async applyFilters(page: Page, filters: SearchFilters): Promise<void> {
    if (filters.entityRuc) {
      // El campo visible "Nombre o Sigla de Entidad" no filtra por RUC. La
      // forma correcta es abrir el modal "Buscar Entidad", llenar el campo
      // RUC, y clickear el link "Seleccionar" del primer match — eso asocia
      // la entidad en el backend para el siguiente submit del form.
      const ok = await this.entityModal.pickByRuc(page, filters.entityRuc);
      if (!ok) {
        throw new ScrapeValidationError([
          `Entidad con RUC ${filters.entityRuc} no se pudo asociar vía modal`,
        ]);
      }
    }
    if (filters.keyword) {
      await this.fillInputJs(page, ':descripcionObjeto', filters.keyword);
    }

    // Año de Convocatoria (ID semántico estable, ver docs/01-analisis-seace.md)
    const anio = filters.anioConvocatoria ?? new Date().getFullYear();
    const anioBaseId = await this.resolveSelectBase(
      page,
      'anioConvocatoria',
      'Año de la Convocatoria',
    );
    if (!anioBaseId) {
      throw new ScrapeValidationError(['No se localizó el select de Año de la Convocatoria']);
    }
    await this.selectPrimefacesOption(page, anioBaseId, String(anio));

    // Objeto de Contratación: ID autogenerado (j_idt188). La etiqueta vive en
    // un <td role="gridcell">, no en un <label for>, así que usamos el
    // resolver "adjacent label".
    if (filters.objeto) {
      const label = OBJETO_LABEL[filters.objeto];
      const objBaseId = await this.labels.resolveSelectByAdjacentLabel(
        page,
        this.formId,
        'Objeto de Contratación',
      );
      if (!objBaseId) {
        this.logger.warn(`Objeto "${filters.objeto}" no aplicado: select no localizado`);
      } else {
        await this.selectPrimefacesOption(page, objBaseId, label);
      }
    }
  }

  async search(page: Page): Promise<void> {
    // Click vía JS para evitar problemas de visibilidad (algunos botones
    // PrimeFaces tienen ancestros con display oculto pero el handler funciona).
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
    return this.parser.parseProcedimientos(html, this.formId);
  }

  async goToNextPage(page: Page): Promise<boolean> {
    const paginatorId = `${this.formId}:dtProcesos_paginator_bottom`;
    // Detectar "disabled" vía locator de Playwright (selector con `\\:` escape).
    const nextLoc = page.locator(`#${escId(paginatorId)} .ui-paginator-next`).first();
    const classes = (await nextLoc.getAttribute('class').catch(() => null)) ?? '';
    if (classes.includes('ui-state-disabled')) {
      return false;
    }
    // Click vía JS: getElementById sortea el problema de los `:` literales en
    // IDs JSF (querySelector exige `\:` que es complicado de manejar en cadenas).
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

  /**
   * Setea el value de un input dentro del form vía JS y dispara el evento
   * `input` para que PrimeFaces lo registre. Sortea problemas de visibilidad
   * que bloquean `locator.fill()`.
   */
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
    stableSuffix: string | null,
    labelText: string,
  ): Promise<string | null> {
    if (stableSuffix) {
      const candidate = await page
        .locator(`form#${escId(this.formId)} [id$=":${stableSuffix}_input"]`)
        .first()
        .getAttribute('id')
        .catch(() => null);
      if (candidate) return candidate.replace(/_input$/, '');
    }
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
