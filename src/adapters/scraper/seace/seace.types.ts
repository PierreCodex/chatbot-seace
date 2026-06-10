import type { ProcesoTab } from '@prisma/client';

export const SEACE_BUSCADOR_URL =
  'https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml';

export const SEACE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SeaceBot/1.0 (contact: cordovalizano18@gmail.com)';

export const SEACE_VIEWPORT = { width: 1280, height: 720 } as const;

export const TAB_FORM_IDS: Record<ProcesoTab, string> = {
  procedimientos: 'tbBuscador:idFormBuscarProceso',
  anuncios_futuros: 'tbBuscador:idFormbuscarACF',
  expresiones_interes: 'tbBuscador:idFormbuscarexpresionInteres',
  difusion_requerimientos: 'tbBuscador:idFormbuscarDifusionRequerimientos',
  orden_compra_servicio: 'tbBuscador:idFormbuscarOCOS',
  condiciones_contratacion: 'tbBuscador:idFormbuscarCCO',
};

export const TAB_LINK_HASH: Record<ProcesoTab, string> = {
  procedimientos: '#tbBuscador:tab1',
  anuncios_futuros: '#tbBuscador:tab7',
  expresiones_interes: '#tbBuscador:tab3',
  difusion_requerimientos: '#tbBuscador:tab4',
  orden_compra_servicio: '#tbBuscador:tab5',
  condiciones_contratacion: '#tbBuscador:tab6',
};

/**
 * Escapa los `:` del ID JSF para usarlos como selector CSS.
 */
export function escId(id: string): string {
  return id.replace(/:/g, '\\:');
}

export class ViewExpiredError extends Error {
  constructor(message = 'SEACE devolvió ViewExpiredException') {
    super(message);
    this.name = 'ViewExpiredError';
  }
}

export class ScrapeValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'ScrapeValidationError';
  }
}
