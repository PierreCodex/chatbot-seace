import { Injectable } from '@nestjs/common';
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import { escId } from '../seace.types';

export interface EntityMatch {
  ruc: string;
  nombre: string;
  tipoDoc: string | null;
}

export interface ParsedEntityModal {
  rows: EntityMatch[];
  currentPage: number | null;
  totalPages: number | null;
}

@Injectable()
export class EntityRowsParser {
  parse(html: string, formId: string): ParsedEntityModal {
    const root = parseHtml(html);
    const tableId = `${formId}:dataTable`;
    const table = root.querySelector(`#${escId(tableId)}`);
    if (!table) return { rows: [], currentPage: null, totalPages: null };

    const tbody = table.querySelector('tbody.ui-datatable-data');
    const rows: EntityMatch[] = [];
    for (const tr of tbody?.querySelectorAll('tr') ?? []) {
      if (tr.classList.contains('ui-datatable-empty-message')) continue;
      const row = this.parseRow(tr);
      if (row) rows.push(row);
    }
    return { rows, ...this.parsePaginatorInfo(root, formId) };
  }

  private parseRow(tr: HTMLElement): EntityMatch | null {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 4) return null;
    const text = (i: number) => cells[i]?.text.replace(/\s+/g, ' ').trim() ?? '';
    const ruc = text(1);
    const nombre = text(3);
    if (!ruc || !nombre) return null;
    if (!/^\d{11}$/.test(ruc)) return null;
    return { ruc, nombre, tipoDoc: text(2) || null };
  }

  private parsePaginatorInfo(
    root: HTMLElement,
    formId: string,
  ): { currentPage: number | null; totalPages: number | null } {
    const paginator = root.querySelector(
      `#${escId(formId)}\\:dataTable_paginator_bottom .ui-paginator-current`,
    );
    const txt = paginator?.text ?? '';
    const m = txt.match(/(\d+)\s+de\s+(\d+)/i);
    return {
      currentPage: m ? Number(m[1]) : null,
      totalPages: m ? Number(m[2]) : null,
    };
  }
}
