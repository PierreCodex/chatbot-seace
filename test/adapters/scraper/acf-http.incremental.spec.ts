import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcfHttpScraper } from '../../../src/adapters/scraper/seace/acf-http.scraper';
import { HtmlRowsParser } from '../../../src/adapters/scraper/seace/parsers/html-rows.parser';

/**
 * Verifica el early-stop incremental de `crawlAcf`: como el datatable ACF viene
 * en orden Fecha de Publicación DESC, en cuanto una página resulta 100% sin
 * cambios (inserted+updated===0) se corta la paginación de ese objeto. Se
 * espían `openSession` y `post` para no tocar la red; los conteos los provee el
 * `onPage` del test (que es quien dispara el stop).
 */
describe('AcfHttpScraper · crawl incremental (early-stop)', () => {
  const FORM = 'tbBuscador:idFormbuscarACF';

  // SEARCH: solo necesita el datatable + paginador con "del total 45" → 3 páginas.
  const searchXml = `
    <div id="${FORM}:dtResultadosACF">
      <table><tbody class="ui-datatable-data"></tbody></table>
      <div id="${FORM}:dtResultadosACF_paginator_bottom">
        <span class="ui-paginator-current">[ Mostrando de 1 a 15 del total 45 - Página: 1/3 ]</span>
      </div>
    </div>`;

  // Una fila ACF mínima (10 celdas) — el contenido no importa para el stop.
  const acfRow = (n: number) =>
    `<tr>${[
      '',
      `ENTIDAD ${n}`,
      '11/06/2026',
      'AS',
      'Obra',
      `desc ${n}`,
      'Nacional',
      '1',
      '30 días',
      '01/07/2026',
    ]
      .map((t) => `<td>${t}</td>`)
      .join('')}</tr>`;

  let scraper: AcfHttpScraper;
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scraper = new AcfHttpScraper(new HtmlRowsParser());
    vi.spyOn(scraper as never, 'openSession').mockResolvedValue({
      cookieHeader: 'c',
      viewState: 'v',
      valueByObjeto: { bien: '62', servicio: '65', obra: '64', consultoria_obra: '63' },
    } as never);
    postSpy = vi.spyOn(scraper as never, 'post') as ReturnType<typeof vi.spyOn>;
  });

  it('corta cuando una página viene sin cambios (no pide la siguiente)', async () => {
    postSpy
      .mockResolvedValueOnce(searchXml) // SEARCH (total 45 → 3 págs)
      .mockResolvedValueOnce(acfRow(0)) // página 0
      .mockResolvedValueOnce(acfRow(1)) // página 1
      .mockResolvedValueOnce(acfRow(2)); // página 2 (NO debería pedirse)

    const onPage = vi
      .fn()
      .mockResolvedValueOnce({ inserted: 2, updated: 0, unchanged: 13 }) // pág 0 → seguir
      .mockResolvedValueOnce({ inserted: 0, updated: 0, unchanged: 15 }); // pág 1 → parar

    await scraper.crawlAcf({ objetos: ['obra'], incremental: true, onPage, pauseMs: 0 });

    expect(onPage).toHaveBeenCalledTimes(2);
    // SEARCH + pág0 + pág1 = 3 POSTs; la pág2 nunca se pidió.
    expect(postSpy).toHaveBeenCalledTimes(3);
  });

  it('en modo completo pagina hasta el final aunque no haya cambios', async () => {
    postSpy
      .mockResolvedValueOnce(searchXml)
      .mockResolvedValueOnce(acfRow(0))
      .mockResolvedValueOnce(acfRow(1))
      .mockResolvedValueOnce(acfRow(2));

    const onPage = vi.fn().mockResolvedValue({ inserted: 0, updated: 0, unchanged: 15 });

    await scraper.crawlAcf({ objetos: ['obra'], incremental: false, onPage, pauseMs: 0 });

    expect(onPage).toHaveBeenCalledTimes(3); // las 3 páginas
    expect(postSpy).toHaveBeenCalledTimes(4); // SEARCH + 3 páginas
  });
});
