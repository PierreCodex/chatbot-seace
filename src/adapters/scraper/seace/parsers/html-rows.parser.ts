import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import type { ProcessRow } from '../../../../ports/persistence/types';
import { escId } from '../seace.types';
import { normalizeMoneyAmount, parsePrimeFacesParams, parseSeaceDate } from './primefaces.helpers';

export interface ParsedRowsResult {
  rows: ProcessRow[];
  /** Total real de items reportado por SEACE (ej. 499). */
  totalReported: number | null;
  currentPage: number | null;
  totalPages: number | null;
}

const OBJETO_MAP: Record<string, ProcessRow['objeto']> = {
  bien: 'bien',
  servicio: 'servicio',
  obra: 'obra',
  'consultoría de obra': 'consultoria_obra',
  'consultoria de obra': 'consultoria_obra',
};

/**
 * Parser HTML del datatable `dtProcesos` de la pestaña Procedimientos.
 *
 * Devuelve filas listas para `ProcessesRepoPort.upsertMany`. El contentHash
 * se calcula sobre los campos que el usuario percibe (entidad/objeto/fecha/
 * valor/descripción) para que cambios cosméticos no disparen re-notificaciones.
 */
@Injectable()
export class HtmlRowsParser {
  parseProcedimientos(html: string, formId: string): ParsedRowsResult {
    const root = parseHtml(html);
    const tableId = `${formId}:dtProcesos`;
    const table = root.querySelector(`#${escId(tableId)}`);
    if (!table) {
      return { rows: [], totalReported: null, currentPage: null, totalPages: null };
    }

    const pageInfo = this.parsePaginatorInfo(root, formId);
    const tbody = table.querySelector('tbody.ui-datatable-data');
    if (!tbody) return { rows: [], ...pageInfo };

    const trs = tbody.querySelectorAll('tr');
    const rows: ProcessRow[] = [];
    for (const tr of trs) {
      if (tr.classList.contains('ui-datatable-empty-message')) continue;
      const row = this.parseRow(tr);
      if (row) rows.push(row);
    }
    return { rows, ...pageInfo };
  }

  private parseRow(tr: HTMLElement): ProcessRow | null {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 12) return null;

    const text = (i: number) => cells[i]?.text.replace(/\s+/g, ' ').trim() ?? '';

    const actionCell = cells[12];
    const fichaImg = actionCell?.querySelector('a img[src*="fichaSeleccion"]');
    const fichaLink = fichaImg?.parentNode as HTMLElement | undefined;
    const onclick = fichaLink?.getAttribute('onclick') ?? '';
    const ids = parsePrimeFacesParams(onclick);

    const objetoText = text(5).toLowerCase();
    const objeto = OBJETO_MAP[objetoText] ?? null;
    const versionRaw = text(11); // "Seace 3", "Seace 2"
    const versionSeace = /(\d+)/.exec(versionRaw)?.[1];

    const row: ProcessRow = {
      tab: 'procedimientos',
      nomenclatura: text(3) || null,
      entityRuc: null,
      entityNombre: text(1),
      fechaPublicacion: parseSeaceDate(text(2)),
      tipoSeleccion: null,
      tipoSeleccionId: null,
      objeto,
      descripcion: text(6) || null,
      alcance: null,
      cantidad: null,
      plazoDias: null,
      fechaAproxConv: null,
      codigoSnip: text(7) || null,
      codigoCui: text(8) || null,
      valorReferencial: normalizeMoneyAmount(text(9)),
      moneda: text(10) || null,
      versionSeace: versionSeace ? Number(versionSeace) : null,
      nidProceso: ids.nidProceso ?? null,
      nidConvocatoria: ids.nidConvocatoria ?? null,
      urlRepositorio: null,
      contentHash: '',
      raw: {
        rowIndex: text(0),
        rawValor: text(9),
        rawVersion: versionRaw,
        ids,
      },
    };
    row.contentHash = hashContent(row);
    return row;
  }

  private parsePaginatorInfo(
    root: HTMLElement,
    formId: string,
  ): { totalReported: number | null; currentPage: number | null; totalPages: number | null } {
    // SEACE muestra: "[ Mostrando de 1 a 15 del total 499 - Página: 1/34 ]"
    const paginator = root.querySelector(
      `#${escId(formId)}\\:dtProcesos_paginator_bottom .ui-paginator-current`,
    );
    const text = paginator?.text ?? '';
    const total = text.match(/del\s+total\s+(\d+)/i)?.[1];
    const page = text.match(/Página:\s*(\d+)\s*\/\s*(\d+)/i);
    return {
      totalReported: total ? Number(total) : null,
      currentPage: page ? Number(page[1]) : null,
      totalPages: page ? Number(page[2]) : null,
    };
  }
}

/**
 * Hash determinístico de los campos relevantes para el usuario.
 * Cambios en `scrapedAt`, `raw.rowIndex` o tokens efímeros no deben mover
 * este hash — sólo cambios reales del proceso.
 */
export function hashContent(row: ProcessRow): string {
  const significant = {
    tab: row.tab,
    nomenclatura: row.nomenclatura,
    entityNombre: row.entityNombre,
    fechaPublicacion: row.fechaPublicacion?.toISOString() ?? null,
    objeto: row.objeto,
    descripcion: row.descripcion,
    codigoSnip: row.codigoSnip,
    codigoCui: row.codigoCui,
    valorReferencial: row.valorReferencial,
    moneda: row.moneda,
    versionSeace: row.versionSeace,
  };
  return createHash('sha256').update(JSON.stringify(significant)).digest('hex');
}
