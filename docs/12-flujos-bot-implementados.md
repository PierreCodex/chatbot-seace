# 12 · Flujos del bot — estado implementado (as-built)

> **Fuente de verdad del comportamiento actual** del bot (`src/modules/bot/`). Los docs
> `06-whatsapp-ux.md` (§10), `03-modulos-bot.md` y `10-roadmap-ux-bot.md` son la
> intención de diseño; **este doc describe lo que el código realmente hace hoy**.
> Validado localmente con `pnpm chat:sim` (ver §7).

Última actualización: 2026-06-11.

---

## 1. Arquitectura de la conversación (state machine)

Cada usuario (por número) tiene un **estado persistente en Redis**: `ConversationState = { userId, phoneNumber, phoneNumberId, flowId, step, data, updatedAt }` (`ConversationStore`).

Flujo de un mensaje entrante (`ConversationService.processInbound`):

1. Upsert del `wa_user` por teléfono.
2. Carga el estado guardado (o crea uno nuevo en `flowId='main-menu'`, `step='initial'`).
3. `input = interactiveReplyId ?? text` (id de botón/lista si tocó algo; texto si escribió).
4. Resuelve el `Flow` por `state.flowId` y llama `flow.handle(ctx)`.
5. Aplica el `FlowResult`: actualiza `flowId/step/data`, borra el estado si `endConversation`, y manda los `messages` por `MESSAGING_PORT`.
6. Si el flow lanza error → resetea a `main-menu` (try/catch defensivo).

**Contrato `Flow`:** `handle(ctx) → { messages, nextFlowId?, nextStep?, dataPatch?, endConversation? }`. Es un autómata: cada flow lee `step` + `input` y decide el siguiente estado. No hay "wait" bloqueante — cada mensaje se procesa contra el estado guardado.

Flows registrados (`FlowRegistry`): `main-menu`, `search-anuncios`, `entity-resolver`, `search-procesos` (legacy Procedimientos).

---

## 2. Menú principal (`main-menu`)

`step: awaiting-selection`. Enruta por el id recibido:

| Input | Acción |
|---|---|
| `anuncios` / `acf:refine` | → flujo ACF (`search-anuncios.start`) |
| `entity` / `entidad` | → resolver de entidad (`entity-resolver.start`) |
| `help` | texto de ayuda + menú |
| `acf:subscribe` / `subscriptions` | placeholder "alertas pronto" + menú (UX-4 pendiente) |
| cualquier texto (hola, basura) | muestra el menú |

---

## 3. Búsqueda ACF (`search-anuncios`) — flujo core del MVP

Spec de diseño: `06-whatsapp-ux.md §10` (variante A + empujón suave). Estados:

```
awaiting-objeto ──(objeto obligatorio)──▶ menu
menu ──[Buscar ahora] sin entidad ──▶ soft-nudge ──[Buscar todos]──▶ (búsqueda)
     ├─[Buscar ahora] con entidad ─────────────────────────────────▶ (búsqueda)
     └─[Filtrar entidad]──▶ awaiting-entity ──▶ (1 / 2-10 / >10) ──▶ menu
soft-nudge ──[Filtrar entidad]──▶ awaiting-entity
```

- **`awaiting-objeto`**: lista con los 4 objetos (Bien/Servicio/Obra/Consultoría de Obra). Obligatorio; si no eligen de la lista, re-pide.
- **`menu`**: muestra filtros acumulados (`Objeto · Entidad|Todas`) + opciones [Buscar ahora] [Filtrar/Cambiar entidad] [Quitar entidad].
- **`soft-nudge`** (empujón suave): si el usuario busca sin entidad, confirma "vas a ver TODOS… ¿buscar o acotar?".
- **`awaiting-entity`**: pide texto; resuelve entidad (ver §5) y presenta según cantidad (ver §6).
- **`entity-disambiguation`**: el usuario toca una entidad de la lista → vuelve a `menu` con la entidad fijada.

**Ejecución de la búsqueda** (`runSearch` → `SearchFacade.search`, ver §4):
- Filtro: siempre `objeto`; si hay entidad → **`entityNombre`** (NO `entityRuc`: los anuncios ACF guardan el nombre pero no el RUC; el nombre viene de la tabla `entities`, así coincide con el raspado del anuncio).
- Si resuelve inline (`cached_db`/`cache`): presenta resultados (5 tarjetas; si `>5` adjunta **PDF con todos**, ver §6). Pasa a `main-menu/awaiting-selection`.
- Si `queued`: "Buscando… te aviso apenas tenga los resultados ✅"; el worker entrega después vía `SearchResultsListener`.

---

## 4. Resolución de la búsqueda ACF (`SearchFacade`, DB-first)

3 niveles:
1. **DB-first**: `processes` frescos (<6h) que matchean filtros → inline (`cached_db`).
2. **Cache Redis** (30 min): combinación de filtros pedida hace poco → inline (`cache`).
3. **Encolar job** de scrape (`queued`); el contexto vive en Redis por `jobId`; el worker scrape + `SearchResultsListener` entrega.

Con el crawler ACF poblando la BD (~175 anuncios, frescos), las búsquedas objeto-only y por entidad resuelven **inline**. El path `queued` es raro (BD vieja >6h).

**El scrape ACF es por fetch PURO** (`AcfHttpScraper`, sin Playwright, como entidades): `GET buscador` → cookies + ViewState + valores de objeto → `POST buscar`/`paginar`. Crawl de los 4 objetos ≈ **10s** (validado: bien 37, servicio 83, obra 40, consultoría 15). `SeaceAdapter.search` enruta ACF aquí (fallback a navegador si falla). Beneficia sobre todo al **crawler F5** (4×/día) y quita Chromium del camino de ACF.

**Filtro por entidad en ACF (cliente).** SEACE **no** permite acotar los anuncios ACF por entidad desde el form (solo por objeto): el form ACF expone campos de entidad pero requieren el sub-modal "Buscar Entidad". Por eso el filtro por entidad se aplica **en cliente**:
- **DB-first** (`processes.repo.findByFilters`): `entityNombre` con `equals(insensitive)`. Como anuncio y entidad provienen de SEACE, el nombre coincide (verificado contra datos reales).
- **Short-circuit anti-volcado** (`SearchFacade`): si DB-first por entidad da 0 **pero hay anuncios frescos (<6h) del objeto** (el crawler mantiene el set ACF completo), entonces 0 es la respuesta real → se devuelve `cached_db` vacío **al instante**, sin encolar. Esto arregla el bug en que elegir una entidad **sin** anuncios ACF encolaba un scrape que —al solo filtrar por objeto— **volcaba anuncios de otras entidades**.
- **Red de seguridad en el scrape** (`SeaceAdapter.filterByEntity`): si igual se encola (DB vieja), tras raspar el objeto se **post-filtra** por `sameEntityName` (normaliza mayúsculas/tildes/espacios) y se ajusta `totalReported` al conteo filtrado. Cubre tanto el path HTTP como el fallback navegador.

---

## 5. Resolución de entidades (`EntitySearchService`, live-first)

La fuente **autoritativa es SEACE en vivo** vía **fetch puro** (`EntityFetchLookup`,
bindeado a `ENTITY_LOOKUP_PORT`) — idéntico a la web, ~1-2s, **sin Playwright ni
reCAPTCHA** (el modal "Buscar Entidad" no exige token). La tabla local aporta matching
difuso y resiliencia.

- **RUC exacto** (11 dígitos): `findByRuc` local; si falta → búsqueda en vivo por RUC
  (`searchByRuc`, campo `txtRucEntidad`). Persiste lo nuevo.
- **L1 Redis** (24h, prefijo `entity-query:v2:`): query normalizada cacheada (ya unida).
- **Vivo + local en paralelo, unidos por RUC**:
  - *vivo* (`EntityFetchLookup.searchByNombre`): GET buscador → cookies + ViewState →
    POST abrir-modal → POST buscar → parsea filas (paginado, hasta ~50). Trae el catálogo
    **completo** de SEACE (lo que la tabla local de 3270 no tiene).
  - *local* (`searchByText`, ILIKE "contiene" **por palabra** + trigram de respaldo):
    cubre queries abreviadas/multi-palabra que el "contiene" literal de SEACE no matchea
    (ej. "muni sullana" → 3). Antes el local usaba solo trigram `%` umbral 0.3 → "piura"
    no matcheaba; corregido a ILIKE por-palabra.
  - Los resultados en vivo **se persisten** en `entities` → la tabla local se auto-sana.
- **Fallback**: si SEACE falla (red/caído), se usa solo-local. (`EntityModalScraper`
  Playwright queda disponible para crawls, ya no en el camino caliente.)

Validado: "talara" → 2 (UGEL + Muni Provincial, igual que la web), "piura" → 32 (incl.
entidades ausentes del crawl local). Normalización: minúsculas, sin tildes, espacios
colapsados; al vivo se le manda el texto **crudo** (conserva tildes que su "contiene" usa).
*Limitación menor:* ILIKE local no es accent-insensitive; el vivo cubre ese caso.

---

## 6. Reglas de presentación de entidades (por cantidad)

Aplica en el filtro ACF (`awaiting-entity`) y en el resolver standalone (`entity-resolver`):

| Coincidencias | Presentación |
|---|---|
| **0** | "No encontré… prueba ciudad/región o pega el RUC" |
| **1** (o RUC exacto) | **Ficha directa** (mensaje), sin lista |
| **2–10** | **Lista nativa** de WhatsApp (tap) |
| **>10** | **PDF con TODAS** las coincidencias + "escríbeme el RUC o nombre exacto" |

**Lista nativa (2–10):** el título de fila topa en **24 chars** (límite WhatsApp), así que `entityTitle()` abrevia el prefijo común (`GORE`, `Muni. Dist.`, `Muni. Prov.`, `Univ. Nac.`, `UGEL`…) para que se vea la parte distintiva; el **nombre completo + RUC** va en la **descripción** (72 chars).

**PDF (>10):** `EntitiesPdfRenderer` → listado numerado (nombre + RUC). El usuario responde el RUC (→ resolución directa) o el nombre exacto. Si no hay `PUBLIC_BASE_URL`, degrada a lista top-10 + nota.

**Cierre del resolver standalone (UX-3).** La ficha de una entidad resuelta trae 3 botones (límite WhatsApp): `📅 Ver anuncios` · `🔎 Otra entidad` · `🏁 Finalizar`. "Crear alerta" queda como **teaser de texto** (no botón) hasta UX-4. En los dead-ends (0 resultados, >10 PDF) se adjuntan los botones de cierre `🔎 Otra entidad` / `🏁 Finalizar`. El flujo es **perdonador**: escribir un nombre/RUC en cualquier paso (`awaiting-query`, `disambiguation`, `viewing`) dispara una **nueva** búsqueda en vez de quedar atascado; `entact:otra` re-pide el texto; ids de control ajenos (`acf:`, `nudge:`…) se ignoran con re-prompt.

---

## 7. PDFs (hosting efímero, sin Storage)

`FilesPort` (`FILES_PORT`, adapter `@Global`):
- `hostAcfPdf(processes)` — PDF de anuncios ACF cuando la búsqueda da **>5** resultados. `AcfPdfRenderer` lo arma **agrupado por entidad** (cabecera → índice por entidad con conteo → secciones por entidad ordenadas por #anuncios; anuncios por fecha desc).
- `hostEntitiesPdf(matches)` — PDF del listado de entidades cuando hay **>10** coincidencias.
- Mecanismo: renderiza (pdfkit, JS puro) → guarda base64 en **Redis** (`file:pdf:<token>`, TTL 30 min) → devuelve `${PUBLIC_BASE_URL}/files/<token>.pdf`. `FilesController` lo sirve; **Meta descarga ese link y entrega el archivo** al usuario (el usuario no ve la URL, ve el documento).
- Sin `PUBLIC_BASE_URL` → devuelve `null` → degrada a tarjetas/lista (sin romperse).

---

## 8. Robustez y casos borde

- **Feedback "consultando":** antes de una búsqueda de entidad en vivo (~1-2s), el flow
  emite un mensaje intermedio "🔎 Consultando en SEACE… dame un segundito ⏳" vía
  `ctx.notify` (callback del `FlowContext` que envía ya mismo, sin esperar al `FlowResult`).
  Así el usuario sabe que algo está pasando.
- **Comando de escape global:** desde **cualquier** flujo/paso, escribir `menú`, `menu`,
  `inicio`, `salir`, `cancelar`, `volver`, `start` o `/start` (normalizado: sin tildes,
  sin `/` inicial) reinicia al menú principal (`ConversationService.isResetCommand`).
  El menú lo anuncia ("_Tip: escribe *menú* en cualquier momento para volver aquí._").
  El **botón `menu:main`** (lo emiten varias fichas/presenters) también se intercepta
  globalmente en `ConversationService` → va al menú sin importar el flujo activo. Antes la
  ficha de entidad lo emitía pero `EntityResolverFlow` solo entendía `entact:*`, así que
  "Menú" re-mostraba la ficha (bug corregido).
- **Tap a botón viejo en paso de texto:** si en `awaiting-entity`/`awaiting-query` llega un id de control (`nudge:all`, `acf:…`, etc.) se **re-pide** en vez de buscarlo como entidad (guard `isControlId`). Antes disparaba un L3 de 3 min sobre basura.
- **Texto donde se espera botón:** en `awaiting-objeto`/`menu`/`soft-nudge`/disambiguación, si el usuario escribe en vez de tocar → re-muestra la opción ("elige de la lista").
- **Búsquedas `queued`:** el contexto vive en Redis por `jobId`; el worker entrega el resultado sin importar qué haga el usuario mientras tanto. Ningún flujo "en espera" se pierde.
- **Error en un flow:** reset a `main-menu`.

---

## 9. Validación local sin Meta (`pnpm chat:sim`)

`scripts/chat-sim.mjs` levanta el `AppModule` real (flows + BD + entidades) pero **reemplaza `MESSAGING_PORT`** por un impresor a consola. NO toca WhatsApp. Interactivo o `--script="anuncios;objeto:obra;acf:buscar;nudge:all"` (input con `:` = id de botón; sin `:` = texto). Usa número ficticio.

---

## 10. Pendiente (no implementado)

- **Mis alertas / suscripciones (UX-4)** + motor F5 (crawler 4×/día, detección de hits, expiración, notificación). Bloqueado parcialmente por verificación de portafolio Meta (Flows/plantillas).
- Entrega proactiva de alertas (template vs "al volver" vs Telegram) — se decide al final.
- `unaccent` para búsquedas con tildes/ñ.
- Selección por texto (RUC/nombre) también en el paso de lista ≤10 (hoy solo tap; el texto exacto sí funciona en el path >10).
