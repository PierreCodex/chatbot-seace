import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ContextFactory } from '../dist/adapters/scraper/seace/browser/context.factory.js';
import { SessionManager } from '../dist/adapters/scraper/seace/session/session.manager.js';
import { WorkerModule } from '../dist/worker.module.js';

/**
 * Investigación (F4.5): captura el POST AJAX real del modal "Buscar Entidad"
 * para evaluar si se puede hacer replay HTTP directo (sin navegador).
 * Imprime body (ViewState, params, ¿token reCAPTCHA?), headers, cookies y la
 * respuesta. Reusa BrowserManager/ContextFactory para que el stealth/UA sean
 * los mismos que usa el scraper real.
 */
const FORM = 'tbBuscador:idFormBuscarProceso';
const LUPA = `${FORM}:ajax`;
const DIALOG = `${FORM}:frmBuscarEntidad`;
const INPUT = `${FORM}:txtNombreEntidad`;
const BTN = `${FORM}:btnBuscarEntidad`;
const TAB_LINK = '#tbBuscador:tab1';
const escId = (id) => id.replace(/:/g, '\\:');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function summarizePostData(raw) {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params.entries()) {
    // ViewState y tokens largos: recortar para legibilidad pero indicar tamaño.
    out[k] = v.length > 80 ? `${v.slice(0, 80)}… (${v.length} chars)` : v;
  }
  return out;
}

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  const contexts = app.get(ContextFactory, { strict: false });
  const session = app.get(SessionManager, { strict: false });

  const jc = await contexts.create();
  const page = jc.page;

  const posts = [];
  const tagOf = (raw) => {
    if (!raw) return 'other';
    if (raw.includes('btnBuscarEntidad')) return 'SEARCH';
    if (raw.includes('dataTable_pagination=true') || raw.includes('dataTable_first')) return 'PAGINATE';
    return 'other';
  };
  page.on('request', (req) => {
    if (req.url().includes('buscadorPublico') && req.method() === 'POST') {
      const raw = req.postData() ?? '';
      posts.push({
        tag: tagOf(raw),
        url: req.url(),
        headers: req.headers(),
        raw,
        postData: summarizePostData(raw),
        response: null,
      });
    }
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (req.url().includes('buscadorPublico') && req.method() === 'POST') {
      let body = '';
      try {
        body = await res.text();
      } catch {
        /* noop */
      }
      const vs = body.match(/ViewState[^>]*>(?:<!\[CDATA\[)?([^\]<]+)/);
      const match = posts.find((p) => p.url === req.url() && p.response === null);
      if (match) {
        match.response = {
          status: res.status(),
          contentType: res.headers()['content-type'],
          bodyLen: body.length,
          viewStateInResponse: vs ? vs[1].slice(0, 50) : null,
          containsDataTable: body.includes('dataTable'),
        };
      }
    }
  });

  console.log('▶ Navegando a SEACE y abriendo el modal de entidad…');
  await session.openBuscador(page);
  await page.locator(`a[href="${TAB_LINK}"]`).first().click().catch(() => undefined);
  await session.waitForPrimefaces(page, 5000);
  await page.evaluate((id) => document.getElementById(id)?.click(), LUPA);
  await session.waitForPrimefaces(page, 10000);
  await page.waitForSelector(`#${escId(DIALOG)}`, { state: 'visible', timeout: 5000 });

  console.log('▶ Buscando "a" en el modal (varias páginas)…');
  await page.evaluate(
    ({ id, val }) => {
      const i = document.getElementById(id);
      i.value = val;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { id: INPUT, val: 'a' },
  );
  await page.evaluate((id) => document.getElementById(id)?.click(), BTN);
  await session.waitForPrimefaces(page, 20000);
  await sleep(1000);

  console.log('▶ Paginando a la página 2 (para capturar el POST de paginación)…');
  const paginatorId = `${FORM}:dataTable_paginator_bottom`;
  await page.evaluate((id) => {
    const next = document.getElementById(id)?.querySelector('.ui-paginator-next');
    if (next && !next.classList.contains('ui-state-disabled')) next.click();
  }, paginatorId);
  await session.waitForPrimefaces(page, 20000);
  await sleep(1500);

  const cookies = await jc.context.cookies();

  console.log('\n================ CAPTURAS (POST a buscadorPublico) ================');
  posts.forEach((p, i) => {
    const interesting = p.tag === 'SEARCH' || p.tag === 'PAGINATE';
    console.log(`\n### POST #${i + 1} [${p.tag}]  ${p.url.split(';')[0]}`);
    console.log('faces-request:', p.headers['faces-request'] ?? '(none)', '| content-type:', p.headers['content-type']);
    console.log('response:', JSON.stringify(p.response));
    if (interesting) {
      console.log('--- RAW BODY ---');
      console.log(p.raw);
    } else {
      console.log('postData:', JSON.stringify(p.postData));
    }
  });

  console.log('\n================ COOKIES ================');
  for (const c of cookies) {
    console.log(`  ${c.name} = ${String(c.value).slice(0, 30)}${c.value.length > 30 ? '…' : ''}  (domain=${c.domain})`);
  }

  await jc.close();
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
