import { describe, expect, it } from 'vitest';
import { EntityRowsParser } from '../../../src/adapters/scraper/seace/parsers/entity-rows.parser';

/**
 * Fragmento real que devuelve la **paginación AJAX** del modal (solo `<tr>`
 * pelados, sin la `<table>`/`<tbody>` contenedora). Layout de celdas:
 * [0]=N° · [1]=RUC · [2]=tipoDoc · [3]=<a>nombre</a> · …
 */
const PAGINATE_FRAGMENT = `
<tr data-ri="10" class="ui-widget-content ui-datatable-even" role="row">
  <td role="gridcell">11</td>
  <td role="gridcell">20368981355</td>
  <td role="gridcell">RUC</td>
  <td role="gridcell"> <a id="x:dataTable:10:ajaxEntidad" href="#" class="ui-commandlink">GOBIERNO REGIONAL DE PIURA</a></td>
</tr>
<tr data-ri="11" class="ui-widget-content ui-datatable-odd" role="row">
  <td role="gridcell">12</td>
  <td role="gridcell">20131370645</td>
  <td role="gridcell">RUC</td>
  <td role="gridcell"> <a id="x:dataTable:11:ajaxEntidad" href="#" class="ui-commandlink">MINISTERIO DE SALUD</a></td>
</tr>
`;

describe('EntityRowsParser · parseRowsFragment (paginación HTTP)', () => {
  const parser = new EntityRowsParser();

  it('parsea los <tr> pelados con ruc + nombre + tipoDoc', () => {
    const rows = parser.parseRowsFragment(PAGINATE_FRAGMENT);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      ruc: '20368981355',
      nombre: 'GOBIERNO REGIONAL DE PIURA',
      tipoDoc: 'RUC',
    });
    expect(rows[1].ruc).toBe('20131370645');
    expect(rows[1].nombre).toBe('MINISTERIO DE SALUD');
  });

  it('ignora la fila de "sin resultados" y descarta RUC no válidos', () => {
    const empty = '<tr class="ui-datatable-empty-message"><td>No se encontraron datos</td></tr>';
    expect(parser.parseRowsFragment(empty)).toHaveLength(0);

    const badRuc = `<tr role="row"><td>1</td><td>123</td><td>RUC</td><td>ENTIDAD X</td></tr>`;
    expect(parser.parseRowsFragment(badRuc)).toHaveLength(0);
  });

  it('devuelve vacío para un fragmento sin filas', () => {
    expect(parser.parseRowsFragment('')).toHaveLength(0);
  });
});
