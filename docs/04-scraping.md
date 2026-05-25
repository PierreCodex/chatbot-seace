# 04 · Estrategia de scraping

## 0. Decisión central: scraping híbrido DB-first

El sistema combina **dos modos de scraping** sobre la misma infraestructura de Playwright, y un bot que **siempre consulta Supabase primero**.

```
                       Consulta del usuario
                                │
                                ▼
                  ┌─────────────────────────┐
                  │  DB hit? (procesos      │
                  │  cuya antigüedad        │   sí
                  │  < umbral_frescura)     │─────▶ Devolver desde DB (<1s)
                  └────────────┬────────────┘
                               │ no
                               ▼
                  ┌─────────────────────────┐
                  │  Cache Redis            │   sí
                  │  (búsqueda idéntica     │─────▶ Devolver desde Redis (<1s)
                  │  últimos 15 min)        │
                  └────────────┬────────────┘
                               │ no
                               ▼
                  ┌─────────────────────────┐
                  │  Scrape on-demand       │
                  │  (Playwright, 3-15s)    │
                  │  + persistir en DB      │
                  │  + cache Redis 15min    │
                  └─────────────────────────┘

                  ──────────────────────────────────

                  En paralelo, 4 veces al día:

                  ┌─────────────────────────┐
                  │  Crawler programado     │
                  │  scope = suscripciones  │
                  │  activas + top-N        │
                  │  búsquedas frecuentes   │
                  │  (dedup, content_hash)  │
                  └────────────┬────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │  Upsert en processes +  │
                  │  insert en subscription │
                  │  _hits si hay deltas    │
                  └─────────────────────────┘
```

**Lo que NO se hace** (anti-patrones explícitos):
1. **No batch global**: nunca "todos los procesos publicados hoy" sin filtro. SEACE publica cientos por día → reCAPTCHA score agotado.
2. **No crawler de histórico**: bajar millones de procesos históricos es infeasible y no aporta valor para 1-2 usuarios.
3. **No scraping persistente 24/7**: el worker está despierto pero los jobs corren puntualmente (5-10/día en MVP + 4 corridas programadas).

**Lo que SÍ se hace**:
1. **Crawler programado dirigido por demanda** (sección 11): scrapea solo lo que tiene usuarios reales suscritos o lo que se busca frecuentemente.
2. **Scrape on-demand con persistencia** (sección 12): si el usuario pide algo fuera del scope, se scrapea sincronicamente y se persiste para servir desde DB la próxima vez.
3. **Cache Redis** (sección 8) TTL 15 min para colisiones de búsqueda idéntica en burst.
4. **Excel fast-path** (sección 3.2) cuando resultados >50.
5. **Promoción automática al scope** (sección 11.3): si una búsqueda on-demand se repite >3 veces en 30 días, entra al scope crawleado.
6. **Tolerancia a Día 0** (sección 13): el bot funciona con DB vacía cayendo a on-demand puro.

## 1. Pool de sesiones Playwright

### 1.1 Estructura

```typescript
class SeaceSessionPool {
  private slots: SessionSlot[] = []
  private maxSlots = 5
  private ttlMs = 25 * 60 * 1000  // 25 min, antes del ViewExpired
  
  async acquire(): Promise<SessionSlot> { ... }
  async release(slot: SessionSlot): Promise<void> { ... }
  async healthCheck(): Promise<void> { ... }
}

interface SessionSlot {
  id: string
  context: BrowserContext
  page: Page
  createdAt: number
  busy: boolean
  lastSearchAt: number
  searchCount: number  // recicla a 200
  jsessionId?: string
}
```

### 1.2 Ciclo de vida

| Evento | Acción |
|---|---|
| Worker arranca | Crea N=2 slots warm (navega a `buscadorPublico.xhtml`, espera `networkidle`) |
| Job llega | `acquire()` toma slot libre; si no hay → cola interna |
| Job termina | `release(slot)` marca libre y actualiza métricas |
| `searchCount > 200` o `now - createdAt > ttlMs` | Cierra slot, abre nuevo |
| Slot tira `ViewExpiredException` | Descarta inmediato, crea nuevo |
| Worker recibe SIGTERM | Cierra todos los slots, persiste cookies en Redis para warm-restart |

### 1.3 Warm restart

Para reducir cold-start tras deploy, las cookies (JSESSIONID + X-Oracle-BMC-LBS-Route) se serializan en Redis con TTL 25 min. Al arrancar:
1. Worker lee cookies de Redis.
2. Crea contexto Chromium con `context.addCookies(...)`.
3. Navega directo a `buscadorPublico.xhtml`. Si responde sin login y con ViewState válido → reusa sesión.
4. Si responde con ViewExpired → descarta cookies y empieza limpio.

## 2. Adapters por pestaña

Cada pestaña de SEACE es un módulo separado en el worker:

```
worker/
├── pool/SessionPool.ts
├── adapters/
│   ├── BaseTabAdapter.ts          // métodos comunes: open, ensureCookies, parsePaginator, exportExcel
│   ├── ProcedimientosAdapter.ts   // tab1
│   ├── AnunciosFuturosAdapter.ts  // tab7
│   ├── ExpresionesAdapter.ts      // tab3
│   ├── DifusionAdapter.ts         // tab4
│   ├── OcosAdapter.ts             // tab5
│   └── CcoAdapter.ts              // tab6
└── parsers/
    ├── ProcessRowParser.ts
    ├── OcosRowParser.ts
    └── FichaParser.ts
```

Cada adapter implementa:

```typescript
interface TabAdapter<TFilter, TResult> {
  tabId: string                       // "tab1", "tab7", etc.
  formId: string                      // "tbBuscador:idFormBuscarProceso"
  switchTo(page: Page): Promise<void>
  applyFilters(page: Page, f: TFilter): Promise<void>
  search(page: Page): Promise<void>
  parseResults(page: Page): Promise<TResult[]>
  paginate(page: Page, toPage: number): Promise<void>
  exportExcel(page: Page): Promise<Buffer>
}
```

### 2.1 Localización de campos (robustez)

**No** hardcodear IDs JSF como `tbBuscador:idFormBuscarProceso:j_idt179_input`. Esos números cambian si OECE recompila la app. Estrategia:

1. **IDs estables** (preferidos): `nombreEntidad`, `numeroSeleccion`, `descripcionObjeto`, `codigoSnip`, `CUI`, `anioConvocatoria_input`, etc. son nombres semánticos.
2. **IDs autogenerados** (`j_idt*`): localizar por **label asociado**. PrimeFaces emite `<label for="tbBuscador:idFormBuscarProceso:j_idt179_focus">Tipo de Selección</label>`. El adapter usa:

```typescript
async function selectByLabel(page: Page, formId: string, labelText: string, optionText: string) {
  const inputId = await page.locator(`form#${escId(formId)} label`)
    .filter({ hasText: labelText })
    .getAttribute('for')
  // inputId = "tbBuscador:idFormBuscarProceso:j_idt179_focus" → reemplazar suffix
  const selectId = inputId.replace(/_focus$/, '_input')
  await page.locator(`#${escId(selectId)}`).selectOption({ label: optionText })
}
```

3. **Selects PrimeFaces son tricky**: el `<select>` real está oculto y la UI muestra un div estilizado. Hay 2 caminos:
   - Manipular el `<select>` oculto vía `selectOption` (funciona si PrimeFaces no listenea solo en el div estilizado).
   - Hacer clic en el div, esperar el dropdown, clic en la opción.
   
   **Probar el primero**; si no dispara cascadas (Departamento→Provincia), forzar el segundo.

### 2.2 Datepickers (PrimeFaces Calendar)

```typescript
await page.locator(`#${escId(formId)}\\:dfechaInicio_input`).fill('25/05/2026')
await page.keyboard.press('Tab')  // dispara onblur que valida
```

Formato `dd/MM/yyyy` confirmado. No usar el icono de calendario (más clicks); fill directo basta.

### 2.3 Espera correcta tras submit

PrimeFaces emite eventos JS detectables:

```typescript
const waitForPrimefaces = async (page: Page) => {
  await page.waitForResponse(r => 
    r.url().includes('buscadorPublico.xhtml') && 
    r.request().method() === 'POST' &&
    r.request().headers()['faces-request'] === 'partial/ajax'
  )
  // Y además esperar que se actualice el datatable
  await page.waitForFunction(() => !document.querySelector('.ui-blockui-content'))
}
```

Doble check: la búsqueda devuelve XML que reemplaza el datatable; el blockUI semitransparente se quita cuando termina.

## 3. Parseo de resultados

### 3.1 De HTML (cuando resultados ≤ 50)

```typescript
async function parseProcessRows(page: Page) {
  return page.locator('#tbBuscador\\:idFormBuscarProceso\\:dtProcesos tbody.ui-datatable-data > tr')
    .evaluateAll((rows) => rows.map((tr) => {
      const td = (i: number) => tr.children[i]?.textContent?.trim() ?? ''
      const actionCell = tr.children[12]
      const fichaLink = actionCell?.querySelector('a img[src*="fichaSeleccion"]')?.parentElement
      const onclick = fichaLink?.getAttribute('onclick') ?? ''
      const params = parsePrimeFacesParams(onclick)  // extrae nidConvocatoria, nidProceso
      return {
        rowIndex: parseInt(td(0), 10),
        entidad: td(1),
        fechaPublicacion: td(2),
        nomenclatura: td(3),
        reiniciadoDesde: td(4),
        objeto: td(5),
        descripcion: td(6),
        codigoSnip: td(7),
        cui: td(8),
        valorReferencial: td(9),
        moneda: td(10),
        versionSeace: td(11),
        ids: params,  // { nidConvocatoria, nidProceso }
      }
    }))
}

function parsePrimeFacesParams(onclick: string) {
  // onclick típico: PrimeFaces.addSubmitParam('tbBuscador:idFormBuscarProceso',
  //   {'nidConvocatoria':'WKi7+...','nidProceso':'1016256',...}).submit('...');
  const m = onclick.match(/addSubmitParam\([^,]+,\s*(\{[^}]+\})/)
  if (!m) return {}
  // Convertir {'a':'b'} a JSON parseable
  return JSON.parse(m[1].replace(/'/g, '"'))
}
```

### 3.2 De Excel (cuando resultados > 50 o el usuario pide "todos")

```typescript
async function exportExcelToBuffer(page: Page, formId: string): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.locator(`#${escId(formId)}\\:btnExportar`).click()
  const dl = await downloadPromise
  const buf = await dl.createReadStream().then(streamToBuffer)
  return buf
}

// Parsing con exceljs
import ExcelJS from 'exceljs'
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(buffer)
const ws = wb.worksheets[0]
ws.eachRow({ includeEmpty: false }, (row, n) => { ... })
```

> **TODO de descubrimiento**: confirmar que el Excel exportado **contenga los campos para reconstruir el `nidProceso`** (típicamente OECE incluye un código SEACE público que sirve de referencia). Si no, los registros parseados del Excel pierden el link directo a la ficha y el bot solo puede ofrecer "abrir SEACE para ver detalle" como fallback.

### 3.3 Ficha de detalle

Cuando el usuario pide "Ver ficha":
1. El worker hace clic en `fichaSeleccion.gif` del row correspondiente.
2. La navegación es un `POST` con `nidConvocatoria` + `nidProceso` + `nidSistema=3` + `ntipo=1`.
3. Llega a una nueva URL (típicamente `/seacebus-uiwd-pub/buscadorPublico/fichaSeleccion/...`).
4. Se parsea la página completa: cronograma, descripción detallada, requisitos, contacto, archivos.

> Esta parte queda como TODO de la siguiente iteración — la página de ficha no fue inspeccionada en este pase.

## 4. Manejo de sesiones, cookies y errores JSF

### 4.1 ViewExpiredException

Síntoma: HTTP 200 con HTML que contiene `javax.faces.application.ViewExpiredException`.

Acción:
```typescript
if (responseHtml.includes('ViewExpiredException')) {
  this.pool.discard(slot)
  throw new RetriableScrapeError('ViewExpired')
}
```

BullMQ reencola con `attempts: 3` y backoff exponencial. Tercer fallo → DLQ.

### 4.2 Sesión perdida por el load balancer

Si `X-Oracle-BMC-LBS-Route` apunta a nodo caído, JSESSIONID es válido pero el otro nodo no tiene la View. Manifestación idéntica a ViewExpired. Mismo handler.

### 4.3 Validación cliente (campo obligatorio vacío)

Después de cada submit, el adapter inspecciona:
```typescript
const errors = await page.locator('#frmMesajes .ui-messages-error-detail')
  .allTextContents()
if (errors.length) throw new ValidationScrapeError(errors.join('; '))
```

Estos errores se devuelven al usuario en el bot (típicamente: "Selecciona el año antes de buscar").

## 5. Anti-bot: reCAPTCHA Enterprise

### 5.1 Estado observado

- v3 invisible, no presenta challenge.
- Token vacío en submit ≠ bloqueo inmediato. SEACE aparentemente no valida la presencia del token de forma dura — usa score acumulado por sesión.
- Bloqueo manifestado eventualmente como: respuesta sin `<partial-response>` o con mensaje genérico de error, posiblemente HTTP 403 (no probado en este pase).

### 5.2 Estrategia preventiva

| Capa | Medida |
|---|---|
| **Browser fingerprint** | `playwright-extra` + `puppeteer-extra-plugin-stealth` (oculta `navigator.webdriver`, normaliza plugins, headers, fonts) |
| **Comportamiento** | Random delays 800-2500ms entre clicks; movimientos de mouse simulados antes de submit |
| **Tasa por sesión** | Max 1 búsqueda cada 5s, max 200 por sesión, reciclar |
| **Diversidad de IP** | Pool de proxies residenciales (Bright Data, Oxylabs) — solo si reCAPTCHA empieza a bloquear |
| **Rotación de UA** | Tres user-agents Chrome estables, no aleatorios |
| **Resolución** | Viewport fijo 1280×720 (lo que SEACE recomienda en el footer) |

### 5.3 Si reCAPTCHA endurece (plan B)

Si SEACE empieza a exigir el token real (`grecaptcha.execute` ejecutado por JS de Google):
1. El navegador Playwright **ya lo hará automáticamente** porque corre JS real.
2. El único caso de fallo es que el score sea bajo → mensaje "Por favor, complete el reCAPTCHA" que no se puede automatizar.
3. Mitigación: 2captcha o anti-captcha como último recurso ($1-3 por 1000 resoluciones). NO planeado para MVP.

### 5.4 Lo que NO hacemos

- **NO** intentamos resolver CAPTCHAs visuales (no aplica con v3 invisible).
- **NO** hacemos peticiones HTTP directas saltándonos el navegador (la página requiere JS para el token, aunque ahora pase con token vacío).
- **NO** usamos headless detection bypass agresivo (`stealth` cubre el 95%).

## 6. Paginación

Algoritmo:

```typescript
async function paginate(page: Page, targetPage: number, maxPages = 50) {
  const paginatorId = `tbBuscador:idFormBuscarProceso:dtProcesos_paginator_bottom`
  for (let i = 0; i < maxPages; i++) {
    const currentText = await page.locator(`#${escId(paginatorId)} .ui-paginator-current`).textContent()
    const m = currentText?.match(/Página:\s*(\d+)\/(\d+)/)
    if (!m) break
    const [, current, total] = m
    if (parseInt(current) >= targetPage || current === total) break
    const nextBtn = page.locator(`#${escId(paginatorId)} .ui-paginator-next:not(.ui-state-disabled)`)
    if (await nextBtn.count() === 0) break
    await nextBtn.click()
    await waitForPrimefaces(page)
    await page.waitForTimeout(randomBetween(800, 1800))  // anti-bot
  }
}
```

Para bajar **todas** las páginas, preferir **exportExcel** (mucho más eficiente y menos sospechoso).

## 7. Persistencia diferencial (suscripciones)

Cuando un job del crawler programado (o cualquier scrape) procesa filas, debe insertar `subscription_hits` SOLO para procesos nuevos o realmente modificados.

```typescript
async function persistAndDetectHits(scopeItem: ScopeItem, rows: ProcessRow[]) {
  for (const row of rows) {
    const hash = hashRow(row)
    const existing = await db.processes.findUnique({
      where: { tab_nomenclatura_version: { tab: row.tab, nomenclatura: row.nomenclatura, version: row.versionSeace } }
    })

    let isNewOrChanged = false
    if (!existing) {
      await db.processes.create({ data: { ...row, contentHash: hash, firstSeenAt: new Date() } })
      isNewOrChanged = true
    } else if (existing.contentHash !== hash) {
      await db.processes.update({
        where: { id: existing.id },
        data: { ...row, contentHash: hash, lastChangedAt: new Date() }
      })
      isNewOrChanged = true
    } else {
      // sin cambio: solo refresca scraped_at para señalar que se re-verificó
      await db.processes.update({ where: { id: existing.id }, data: { scrapedAt: new Date() } })
    }

    // Si el job vino de una suscripción y la fila es nueva/cambió → insert hit
    if (isNewOrChanged && scopeItem.subscriptionId) {
      await db.subscriptionHits.upsert({
        where: { subscription_process: { subscriptionId: scopeItem.subscriptionId, processId: existing?.id ?? row.id } },
        create: { subscriptionId: scopeItem.subscriptionId, processId: existing?.id ?? row.id },
        update: {}  // si ya existía, no re-notifica
      })
    }
  }
}
```

`content_hash` se calcula sobre los campos que realmente importan al usuario (entidad, fecha de publicación, valor, descripción). Cambios menores tipo "Fecha de actualización del sistema" no disparan re-notificaciones.

Frecuencias soportadas por el campo `subscriptions.frequency`:
- `hourly` → notificación en cuanto el crawler programado lo capture (latencia máxima: 6h por construcción del scheduler)
- `daily` → resumen agrupado a las 8am hora Perú
- `weekly` → resumen agrupado lunes 8am

## 8. Caché en Redis

```typescript
key:    `seace:search:procedimientos:${sha1(JSON.stringify(filters))}`
value:  JSON con resultados resumidos (top 50 rows)
TTL:    15 min
```

Hit ratio esperado: 30-50% en horario laboral (mismas búsquedas repetidas por mismo o distintos usuarios).

Invalidación: solo TTL. No bust manual — los datos de SEACE no cambian instantáneamente y 15 min es aceptable.

## 9. Crawler programado dirigido por demanda

### 9.1 Cuándo corre

Cron del Scheduler de NestJS, hora **America/Lima**:

| Hora | Por qué |
|---|---|
| 06:00 | Captura procesos publicados durante la madrugada y el inicio del horario laboral OECE |
| 12:00 | Captura los publicados en la mañana laboral |
| 18:00 | Captura los publicados en la tarde laboral (OECE atiende 08:30-17:30) |
| 02:00 | Ventana nocturna de cobertura por si algo se publicó tarde |

Total: **4 corridas/día**. No más — SEACE no publica más rápido que eso en la práctica, y cada corrida consume reCAPTCHA score.

### 9.2 Cómo calcula el scope (lo crítico)

El scope NUNCA es global. Se computa al inicio de cada corrida:

```typescript
async function buildScope(): Promise<ScopeItem[]> {
  // (a) Suscripciones activas — cada una es un scope-item
  const subs = await db.subscriptions.findMany({
    where: { status: 'active' }
  })
  const fromSubs: ScopeItem[] = subs.map(s => ({
    source: 'subscription',
    subscriptionId: s.id,
    tab: s.tab,
    filters: {
      entityRuc: s.entityRuc,
      objeto: s.objeto,
      keyword: s.keyword,
      departamento: s.departamento,
      anio: currentYear(),  // siempre año en curso para crawler programado
    }
  }))

  // (b) Top-N filtros de búsqueda en últimos 30 días (con count >= 3)
  const topSearches = await db.$queryRaw`
    SELECT tab, filters, COUNT(*) AS hits
    FROM searches
    WHERE created_at > now() - interval '30 days'
      AND user_id IS NOT NULL
    GROUP BY tab, filters
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `
  const fromSearches: ScopeItem[] = topSearches.map(s => ({
    source: 'top_search',
    tab: s.tab,
    filters: s.filters,
  }))

  // (c) Dedup: dos scope-items con mismos filtros → uno solo, pero retiene
  // todas las subscriptionIds para enrutar hits
  return dedupScope([...fromSubs, ...fromSearches])
}
```

### 9.3 Cómo se ejecuta

```typescript
@Cron('0 6,12,18,2 * * *', { timeZone: 'America/Lima' })
async runScheduledCrawl() {
  const scope = await buildScope()
  if (scope.length === 0) {
    logger.info('Crawler programado: scope vacío, nada que hacer')
    return
  }
  logger.info(`Crawler programado: encolando ${scope.length} scope-items`)
  for (const item of scope) {
    await scrapeQueue.add('crawl:scheduled', item, {
      jobId: `scheduled:${hash(item)}`,  // dedup en BullMQ
      priority: 10,                       // < que on-demand (que usa 1)
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 }
    })
  }
}
```

El worker procesa con concurrency = 1 en MVP. Cada job:
1. Aplica filtros al adapter de la pestaña.
2. Si resultados ≤ 50 → parsea HTML.
3. Si resultados > 50 → exporta Excel y parsea con `exceljs`.
4. Persiste con `persistAndDetectHits()` (ver sección 7).
5. Marca `subscriptions.last_run_at` y actualiza `last_hit_count`.

### 9.4 Promoción automática al scope

Si una búsqueda on-demand se repite ≥3 veces en 30 días distintos `user_id`, la query `topSearches` la captura en la siguiente corrida del crawler. **No se requiere código adicional**: el SQL de scope `HAVING COUNT(*) >= 3` ya implementa la regla.

### 9.5 Back-off de suscripciones zombi

Si una suscripción no ha generado hits en N=10 corridas consecutivas, el Scheduler la mueve a `frequency='weekly'` para reducir su carga. Si después de M=4 semanas sigue sin hits, se le envía al usuario un mensaje preguntando si todavía le interesa:

```
Bot: Tu alerta "ESSALUD · Servicios" no ha encontrado novedades en 30 días.
     ¿Quieres mantenerla?  [Sí] [Pausarla] [Eliminar]
```

## 10. On-demand fallback con persistencia

Si la consulta del usuario sale del scope crawleado, el bot dispara un job de prioridad alta:

```typescript
async function onDemandSearch(userId: string, tab: string, filters: any) {
  // 1. Consulta DB primero
  const cached = await db.processes.findMany({
    where: matchFilters(tab, filters),
    orderBy: { fechaPublicacion: 'desc' },
    take: 50
  })
  const stalest = cached.reduce((min, p) => Math.min(min, p.scrapedAt.getTime()), Infinity)
  const ageHours = (Date.now() - stalest) / 3600_000

  if (cached.length > 0 && ageHours < FRESHNESS_HOURS) {
    return { source: 'db', rows: cached }
  }

  // 2. Encola scrape on-demand
  const job = await scrapeQueue.add('search:on-demand', { tab, filters, userId }, { priority: 1 })
  return { source: 'queued', jobId: job.id }
}
```

Cuando el worker termina:
1. Persiste los resultados igual que el crawler programado.
2. Registra la búsqueda en `searches` (con `user_id`) → esto la hace candidata a promoción al scope.
3. Publica el resultado por Redis pub/sub para que NestJS lo envíe al usuario.

**Umbrales de frescura sugeridos** (configurables vía env):

| Caso | FRESHNESS_HOURS |
|---|---|
| Procesos cuyo `tab` está cubierto por una suscripción del usuario | 6 |
| Procesos en scope top-N | 6 |
| Procesos fuera de scope (one-shot del usuario) | 24 |
| Procesos con `fecha_publicacion` > 60 días atrás (histórico) | 168 (1 semana) |

## 11. Día 0 — tolerancia a DB vacía

Cuando el bot arranca por primera vez, `processes` está vacío. El sistema debe operar sin error:

| Estado del sistema | Comportamiento esperado |
|---|---|
| Primera consulta de un usuario, DB vacía | Bot responde "Buscando en tiempo real..." y cae a on-demand. Resultado guardado en DB para la próxima vez. |
| Primera suscripción creada | Se persiste en `subscriptions`. Próxima corrida del Scheduler la incluye en scope. |
| `subscription_hits` aún vacío al consultar "mis suscripciones" | Bot muestra "Aún sin coincidencias. Te aviso apenas haya algo." — no error. |
| Vistas SQL agregadas (v_processes_recent_by_entity, etc.) | Usan `LEFT JOIN ... COUNT(*) FILTER(...) COALESCE(..., 0)` para no romper con dataset vacío. |
| Crawler programado con scope vacío (sin subs activas) | Loggea y retorna inmediato. No corre Playwright innecesariamente. |

**Test obligatorio en CI**: levantar todo el stack contra una DB recién creada y validar que las 5 interacciones críticas (menú, búsqueda nueva, crear suscripción, ver suscripciones, buscar entidad) responden sin error.

## 12. Política de uso ético

Aunque la información es pública:
- Identificarse en el `User-Agent`: `Mozilla/5.0 (...) Chrome/X SeaceBot/1.0 (contact: cordovalizano18@gmail.com)`.
- Respetar tasas: nunca >2 búsquedas/seg agregadas a través de todos los workers.
- Honrar pausas si OECE comunica mantenimiento (página devuelve "Sistema no disponible").
- No persistir más de N días los datos cacheados sin re-verificar (compromiso de frescura).
- Si OECE pide bajar el bot, hacerlo. Mantener canal de contacto vía página /contacto del bot.

## 13. Resumen de la estrategia

| Decisión | Por qué |
|---|---|
| **Híbrido DB-first + crawler dirigido + on-demand** | Sub-segundo en casos cacheados, cobertura para suscripciones, fallback robusto |
| **Crawler programado 4×/día, scope = subs + top-N searches** | Cubre lo demandado sin tocar millones de procesos del Estado |
| **Promoción automática al scope (≥3 hits/30d)** | El corpus crece orgánicamente con el uso |
| **DB-vacía tolerada en Día 0** | El bot no se rompe sin datos; cae a on-demand puro |
| **Excel para >50 resultados** | Más eficiente y menos sospechoso que paginar HTML |
| **Playwright con stealth** | reCAPTCHA Enterprise requiere browser real |
| **1 browser persistente + 1 contexto/job en MVP** | RAM 400-600MB; escala a pool de 3-5 cuando haga falta |
| **Adapter por pestaña, localización por label** | Resiste cambios de IDs JSF autogenerados |
| **content_hash para detectar deltas reales** | Suscripciones no spamean re-emisiones |
| **ViewExpired = retry automático** | El error es esperable, no fatal |
| **Sin crawler global ni histórico masivo** | No vale el costo ni el riesgo con reCAPTCHA |