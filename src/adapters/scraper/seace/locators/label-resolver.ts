import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { escId } from '../seace.types';

/**
 * Resuelve el ID JSF de un input dada una etiqueta visible.
 *
 * PrimeFaces emite `<label for="...j_idt179_focus">Tipo de Selección</label>`.
 * Hardcodear `j_idt179` es frágil porque cambia entre versiones del despliegue.
 * Esta clase mapea label → ID actual y normaliza los sufijos típicos.
 */
@Injectable()
export class LabelResolver {
  private readonly logger = new Logger(LabelResolver.name);

  /**
   * Devuelve el ID base (sin sufijo) del input asociado al label.
   * Útil para luego construir `${id}_input`, `${id}_focus`, `${id}_panel`, etc.
   */
  async resolveBaseId(page: Page, formId: string, labelText: string): Promise<string | null> {
    const formSel = `form#${escId(formId)}`;
    const forAttr = await page
      .locator(`${formSel} label`)
      .filter({ hasText: labelText })
      .first()
      .getAttribute('for')
      .catch(() => null);

    if (!forAttr) {
      this.logger.warn(`label "${labelText}" no encontrado en form ${formId}`);
      return null;
    }
    return forAttr.replace(/_(focus|input|hidden|panel)$/i, '');
  }

  async resolveInputId(page: Page, formId: string, labelText: string): Promise<string | null> {
    const base = await this.resolveBaseId(page, formId, labelText);
    return base ? `${base}_input` : null;
  }

  async resolveFocusId(page: Page, formId: string, labelText: string): Promise<string | null> {
    const base = await this.resolveBaseId(page, formId, labelText);
    return base ? `${base}_focus` : null;
  }

  /**
   * Variante robusta para selects PrimeFaces cuya etiqueta NO está en un
   * `<label for>` sino en un `<td role="gridcell">`/`<span>` adyacente.
   *
   * Busca el elemento con texto exacto `labelText` dentro del form, luego
   * camina por los siguientes siblings/cells hasta encontrar un
   * `.ui-selectonemenu` y devuelve su ID base.
   *
   * Es la forma confiable de localizar inputs en la pestaña Procedimientos,
   * donde PrimeFaces autogenera IDs (`j_idt188`) sin label HTML asociado.
   */
  async resolveSelectByAdjacentLabel(
    page: Page,
    formId: string,
    labelText: string,
  ): Promise<string | null> {
    const baseId = await page.evaluate(
      ({ formId, labelText }) => {
        const form = document.getElementById(formId);
        if (!form) return null;
        const candidates = Array.from(form.querySelectorAll('td, label, span, [role="gridcell"]'));
        const labelEl = candidates.find(
          (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === labelText,
        ) as HTMLElement | undefined;
        if (!labelEl) return null;
        // Caso 1: <label for="..."> directo
        if (labelEl.tagName === 'LABEL') {
          const forAttr = labelEl.getAttribute('for');
          if (forAttr) return forAttr.replace(/_(focus|input|hidden|panel)$/i, '');
        }
        // Caso 2: caminar por siguientes celdas/siblings hasta hallar el select
        let cursor: Element | null = labelEl;
        for (let i = 0; i < 4 && cursor; i++) {
          const sel = cursor.querySelector('.ui-selectonemenu, select');
          if (sel) {
            const id = (sel as HTMLElement).id;
            return id.endsWith('_input') ? id.replace(/_input$/, '') : id;
          }
          cursor = cursor.nextElementSibling;
        }
        return null;
      },
      { formId, labelText },
    );
    return baseId;
  }
}
