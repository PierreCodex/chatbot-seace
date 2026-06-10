# 08 · Roadmap de implementación — MVP funcional por fases

## Principios de ejecución

1. **Cada fase tiene un entregable que se ejecuta y se observa**. Si no se puede demostrar con un comando o una conversación de WhatsApp, no es entregable, es diseño.
2. **Una fase es "done" cuando el entregable pasa**. No cuando "el código está bonito".
3. **Anti-scope-creep**: cada fase tiene una sección "lo que NO entra". Si aparece la tentación de añadir algo, va al backlog post-MVP.
4. **El usuario real (tú) prueba cada fase antes de empezar la siguiente**. Si la fase anterior no convence, no se avanza.
5. **No optimizar antes de tiempo**. Pool de 1 browser, concurrency 1, sin proxies, sin OTLP. Eso entra en F7+ cuando duela.

> ## ⚠️ Pivot a ACF-first (actualización 2026-06)
>
> Las fases **F0–F4 se construyeron sobre la pestaña Procedimientos** (sirvieron para
> validar end-to-end scraping + bot + búsqueda WA, y están **done**). Tras esa
> validación, **el MVP a entregar es la pestaña "Anuncio de Contratación Futura"
> (ACF)**, no Procedimientos. Secuencia vigente desde aquí:
>
> `F4.5 (pre-crawl entidades) → F4.6 (scraper ACF) ★ → F5 (alertas ACF: fan-out + tier
> + PDF) → F6 (deploy MVP ACF) → F7+ (otras 5 pestañas, ficha, Excel, obs.)`
>
> El reparto: **agente UX** hace el bot (ver `10-roadmap-ux-bot.md`); **backend** hace
> scraper/crawler/alertas. El "Mapa de dependencias" de abajo es el orden de
> construcción original; las fases ACF actualizadas se detallan más abajo. Ver `09` y
> `06` §10.

## Mapa de dependencias

```
F0 (Bootstrap) ─▶ F1 (Schema + repos)
                          │
                          ▼
                  F2 (Scraper manual) ─▶ F4 (Búsqueda WA end-to-end)
                          │                    │
                          │                    ▼
                  F3 (Bot recibe/responde)   F4.5 (Pre-crawl entidades)
                                               │
                                               ▼
                                           F5 (Suscripciones + crawler)
                                               │
                                               ▼
                                       F6 (Deploy Railway + 6 pestañas)
                                               │
                                               ▼
                                       F7+ (Robustez, Excel, ficha, observability)
```

F2 y F3 son paralelizables si hay más de una persona.

---

## Fase 0 — Bootstrap del repo (1 día)

**Objetivo**: tener un workspace NestJS funcional con dos servicios (API + Worker), conectados a Supabase y Upstash en la nube, con comandos básicos de desarrollo.

**Prerequisitos (provisioning antes de tocar código)**:
- [x] Proyecto **Supabase dev** creado. Anotar la `DATABASE_URL` del pooler (Settings → Database → Connection string → URI con `?pgbouncer=true`).
- [x] Base **Upstash Redis dev** creada (free tier). Anotar la `REDIS_URL` con esquema `rediss://` (TLS).
- [ ] **Kapso sandbox** activo con `KAPSO_API_KEY` y `KAPSO_WEBHOOK_SECRET` a mano. (Si todavía no tienes la cuenta, este prereq se puede aplazar hasta F3 — F0/F1/F2 no consumen Kapso.) — **diferido a F3**.
- [x] **Playwright browsers** instalados localmente: `npx playwright install chromium` (se necesitarán en F2; instalarlos en F0 evita sorpresas después).
- [x] Archivo `.env.local` creado con las variables de la sección de envs más abajo. **No** se commitea. — usamos `.env` en lugar de `.env.local` porque Prisma CLI sólo lee `.env` nativamente.

**Entregable verificable**:
```bash
pnpm install
pnpm prisma migrate dev --name init    # contra Supabase dev project
pnpm dev:api                            # arranca API en :3000
pnpm dev:worker                         # arranca Worker (segundo terminal o concurrently)
curl http://localhost:3000/health       # → 200 OK
curl http://localhost:3001/health       # worker health → 200 OK
```

> Nota: aunque `prisma migrate dev` se ejecuta en F0 contra Supabase, el `schema.prisma` puede estar todavía vacío o mínimo (solo un model dummy para validar la conexión). El schema completo se llena en F1.

**Tareas concretas**:
- [x] `pnpm init`, NestJS CLI, TypeScript strict, prettier, eslint.
- [x] Instalar `eslint-plugin-boundaries` (o `no-restricted-paths`) con la regla: `src/modules/**` no puede importar `src/adapters/**`. Que CI falle si alguien lo intenta.
- [x] Estructura de carpetas base de `docs/07-arquitectura-backend.md` (vacías, con `.gitkeep` donde haga falta).
- [x] `src/main.ts` (API) y `src/worker.main.ts` (Worker) — ambos con `HealthController` que devuelve `{ status: 'ok', service: 'api'|'worker', uptime, version }`.
- [x] Validación de env con zod en `src/config/env.schema.ts`. La app no arranca si falta una env requerida.
- [x] `PrismaService` con la conexión validada al iniciar (un `$queryRaw\`SELECT 1\`` en `onModuleInit` que falle ruidoso si Supabase no responde).
- [x] Cliente Redis (ioredis) inicializado contra Upstash con TLS habilitado por la URL `rediss://`. Smoke check `PING` en arranque.
- [x] Script `pnpm dev` que arranca ambos con `concurrently` o `npm-run-all`.
- [x] `.env.example` documentando todas las envs (sin valores reales).
- [x] `.gitignore` con `.env.local`, `node_modules`, `dist`, `.playwright-cli`, etc.

**Variables de entorno mínimas para desarrollo (`.env.local`)**:
```bash
# Postgres en Supabase dev (usar el pooler para conexión serverless-friendly)
# Connect to Postgres via the shared transaction-mode pooler (IPv4-only)
DATABASE_URL="postgresql://postgres.xotndyteyoqiairjgycq:[YOUR-PASSWORD]@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Connect to Postgres via the shared session-mode pooler (used for migrations)
DIRECT_URL="postgresql://postgres.xotndyteyoqiairjgycq:[YOUR-PASSWORD]@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# Redis en Upstash (rediss = TLS)
REDIS_URL="

# Kapso sandbox (puede quedar vacío en F0; obligatorio desde F3)
KAPSO_API_KEY=""
KAPSO_WEBHOOK_SECRET=""

# Runtime
NODE_ENV="development"
SERVICE="api"          # o "worker"; cada terminal exporta el suyo
LOG_LEVEL="debug"
```

> En `prisma/schema.prisma` declarar `datasource db { url = env("DATABASE_URL"), directUrl = env("DIRECT_URL") }` para que `prisma migrate` use la conexión directa y el cliente runtime use el pooler.

**Alternativa offline (no es el path principal)**: si en algún momento quieres desarrollar 100% sin internet, puedes correr Postgres y Redis localmente con Docker Compose (`postgres:16` + `redis:7-alpine`) y apuntar `DATABASE_URL`/`REDIS_URL` a `localhost`. Pero el setup principal del proyecto asume servicios cloud (Supabase + Upstash) para que dev y prod compartan provider y se eviten sorpresas de "funciona local pero no en Railway".

**Lo que NO entra en F0**:
- No Kapso real (sandbox key opcional en F0; obligatoria en F3).
- No adapters concretos (Playwright, Kapso) más allá de validar que las dependencias están instaladas.
- No CI/CD (F6).
- No tests más allá de un `health.spec.ts` smoke.
- No schema Prisma completo — sólo la conexión validada con un model dummy.

**Stop condition**: si llevas más de 1 día configurando tooling, parar y simplificar. Bootstrap no es donde se pierde tiempo. Si Supabase o Upstash no responden al `migrate dev`/`PING`, revisar credenciales antes de seguir.

---

## Fase 1 — Schema Prisma + repos de persistencia (2-3 días)

**Objetivo**: la capa de datos funciona contra Postgres real, con tipos generados y repositorios implementando los ports.

**Entregable verificable**:
```bash
pnpm prisma migrate dev --name init   # aplica schema completo
pnpm test:repos                        # ejecuta los specs de repos contra Supabase dev (usa schema 'test' o truncate por spec)
```

Y un script de seed mínimo:
```bash
pnpm seed:dev   # crea 1 wa_user, 1 entity (MINSA), 1 subscription
psql $DATABASE_URL -c "select * from wa_users; select * from entities;"
# muestra las filas creadas
```

**Tareas concretas**:
- [x] `prisma/schema.prisma` copiado de la sección 1 de `05-schema-supabase.md`.
- [x] `prisma migrate dev` corre sin error contra el proyecto Supabase dev.
- [x] Migraciones manuales: índices GIN trigram para `entities.nombre`/`sigla` y `processes.descripcion`. Crear extensión `pg_trgm` y `pgcrypto` en una migración SQL aparte. (Más: triggers `set_updated_at()` + `searches.filters_hash` como `GENERATED ALWAYS AS … STORED`.)
- [x] `PrismaService` extends `PrismaClient`, con `onModuleInit`/`onModuleDestroy` para connect/disconnect.
- [x] Ports en `src/ports/persistence/`: `ProcessesRepoPort`, `EntitiesRepoPort`, `WaUsersRepoPort`, `SubscriptionsRepoPort`, `SearchesRepoPort`, `NotificationsRepoPort`. Solo interfaces.
- [x] Implementaciones Prisma en `src/adapters/persistence/prisma/*.repo.ts`. Cada una tiene los 3-5 métodos imprescindibles del MVP, no más.
- [x] `PrismaPersistenceModule` registra todos los providers con sus tokens.
- [x] Specs unitarios de los repos: usar `vitest` o `jest` apuntando a la `DATABASE_URL` de Supabase dev (no mocks). Cada spec hace `beforeEach: truncate` de las tablas que toca, crea fixtures, valida queries reales. Si concurrencia entre devs molesta, crear un schema dedicado `test` en el mismo proyecto Supabase y apuntar tests ahí vía `?schema=test`. (21/21 specs verde con `vitest` en pool singleFork.)
- [x] Script `pnpm seed:dev` que crea 1 wa_user con phone `+51999000001`, 1 entity MINSA, 1 subscription daily de Obras.

**Lo que NO entra en F1**:
- No `Search` ni `Notification` con lógica de filtrado avanzada — solo CRUD básico.
- No vistas SQL (v_processes_recent_by_entity, v_subs_due) — se añaden cuando un caller las necesite.
- No `ProcessHistory` ni `ScrapeJob` — F5/F6.
- No RPCs de Postgres (la lógica de `bot_upsert_process` vive en TS por ahora).

**Stop condition**: si los specs de repos te toman más de 2 días, estás escribiendo de más. Un repo con 4 métodos y 4 specs es suficiente.

---

## Fase 2 — Scraper Procedimientos disparable manualmente (3-5 días)

**Objetivo**: el worker puede ejecutar una búsqueda real contra SEACE y persistir los resultados en Postgres, sin bot todavía. Solo Procedimientos (la pestaña principal). El resto de pestañas vienen en F6.

**Entregable verificable**:
```bash
curl -X POST http://localhost:3000/dev/scrape \
  -H 'content-type: application/json' \
  -d '{"tab":"procedimientos","filters":{"anioConvocatoria":2026,"objeto":"obra"}}'
# → { "jobId": "abc123" }

# ~10-20 segundos después:
psql $DATABASE_URL -c "select nomenclatura, entity_nombre, valor_referencial from processes order by scraped_at desc limit 10;"
# → muestra procesos reales scrapeados de SEACE
```

**Tareas concretas**:
- [x] Ports: `ScraperPort`, `QueuePort` en `src/ports/`. (`QueuePort` además expone `JobConsumerPort` para que el worker no importe `bullmq` directo.)
- [x] `BullMqQueueModule` implementando `QueuePort` + `JobConsumerPort` (add, addBulk, getJob, register).
- [x] `SeaceScraperModule` en `src/adapters/scraper/seace/`:
  - [x] `BrowserManager`: 1 `Browser` persistente con `playwright-extra` + `puppeteer-extra-plugin-stealth`. Lanza al `onModuleInit`, cierra al `onModuleDestroy`.
  - [x] `ContextFactory`: crea/destruye un `BrowserContext` por job.
  - [x] `SessionManager`: navega a `buscadorPublico.xhtml`, detecta `ViewExpiredException` y espera a PrimeFaces (cookies persisten implícitamente en el contexto).
  - [x] `LabelResolver`: dado un form y un label visible, devuelve el ID JSF base/input/focus del input asociado (sección 2.1 de `04-scraping.md`).
  - [x] `TabStrategy` interface + `TabStrategyRegistry`.
  - [x] `ProcedimientosStrategy`: implementa `switchTo`, `applyFilters`, `search`, `parse` para HTML. NO Excel todavía, NO ficha detalle.
  - [x] `HtmlRowsParser`: convierte filas de `dtProcesos` a `ProcessRow` con `nidProceso`/`nidConvocatoria` extraídos del `onclick`. Helpers: `parsePrimeFacesParams`, `normalizeMoneyAmount`, `parseSeaceDate`.
- [x] `SeaceAdapter` implementing `ScraperPort`. Método único: `search(tab, filters): Promise<ScrapeResult>` (incluye `rows`, `totalReported`, `durationMs`).
- [x] Worker: `ScrapeProcessor` consume jobs `JOB_NAMES.SEARCH_ON_DEMAND` y `CRAWL_SCHEDULED`, llama al `ScraperPort`, hace `processesRepo.upsertMany()`. Vía `JobConsumerPort`, no importa bullmq.
- [x] API: controlador `DevController` con `POST /dev/scrape` (solo si `NODE_ENV !== 'production'`). Encola un job y devuelve el `jobId`. Bonus: `GET /dev/jobs/:id` para inspeccionar estado.
- [x] `pnpm dev:logs:worker` que muestra logs estructurados del worker (qué job se procesó, cuántos procesos parseó, cuántos insertó vs actualizó). `LOG_LEVEL=debug` en este script.
- [x] Spec del parser de HTML: en lugar del snapshot YAML (que es accessibility tree, no HTML), se construyó `test/adapters/scraper/fixtures/procedimientos.sample.html` representativo con 5 filas + un `empty.html`. 11/11 specs verde.

**Lo que NO entra en F2**:
- No Excel export (F7).
- No pestañas distintas a Procedimientos (F6).
- No retry policy sofisticada (3 attempts + backoff exponencial básico de BullMQ basta).
- No proxies, no UA rotation.
- No webhook todavía. F2 no toca WhatsApp.
- No `searches` table todavía — el job se ejecuta sin contexto de usuario.

**Riesgos**:
- reCAPTCHA podría bloquear en el primer intento si la sesión arranca muy "automatizada". **Mitigación**: arrancar con `puppeteer-extra-plugin-stealth` configurado desde el día 1 (no es opcional, es F2 directamente). Si bloquea, investigar antes de continuar.
- Los IDs `j_idt179`, `j_idt188` pueden cambiar entre visitas (son autogenerados). **Mitigación**: el `LabelResolver` ya está en la lista, no skippear.

**Stop condition**: si después de 3 días no logras que el primer scrape produzca filas en `processes`, parar y validar la inspección Playwright contra SEACE en vivo antes de seguir.

---

## Fase 3 — Bot recibe y responde por WhatsApp (2-3 días)

**Objetivo**: un mensaje real desde un número de WhatsApp llega al webhook, se persiste el `wa_user`, y el bot responde con el menú principal. Sin lógica de búsqueda aún.

**Entregable verificable**:
- Configurar un número de WhatsApp Business en Kapso (sandbox o número real comprado).
- Apuntar el webhook de Kapso a `https://<tunel-ngrok>/webhook`.
- Mandar "hola" desde tu número personal.
- Recibir un mensaje de respuesta con el menú principal (lista interactiva con 3-4 opciones).
- Verificar en Postgres:
  ```bash
  psql $DATABASE_URL -c "select phone_e164, total_messages from wa_users;"
  # → tu número aparece, total_messages >= 1
  ```

**Tareas concretas**:
- [x] Ports: `MessagingPort` con `send(OutboundMessage)` y `parseWebhook(raw)`.
- [x] `KapsoMessagingModule` en `src/adapters/messaging/kapso/`:
  - [x] `KapsoClient`: fetch nativo contra Kapso REST con auth header.
  - [x] `KapsoAdapter implements MessagingPort`: envío de texto, lista interactiva y botones.
  - [x] Tipos de `OutboundMessage` discriminados por `kind`.
- [x] `BotModule`:
  - [x] `WebhookController` con `POST /webhook` — valida firma de Kapso (en prod; en dev loguea warning y continúa), llama `parseWebhook`, pasa al `ConversationService`.
  - [x] `ConversationService`: orquesta state machine. Lee/escribe estado en Redis vía `CachePort`.
  - [x] `ConversationStore` con TTL 30 min.
  - [x] `FlowRegistry` que mantiene un mapa `flowId → Flow`.
  - [x] `MainMenuFlow`: state machine de 1 paso — recibe cualquier intent, retorna `OutboundMessage` con la lista del menú.
  - [x] `MenuPresenter`: construye el `OutboundMessage` de la lista.
  - [x] `WaUsersService`: `upsertByPhone(phone)` usando `WaUsersRepoPort`.
- [x] `CachePort` + `RedisCacheModule` (implementación con `ioredis` apuntando a Upstash vía `REDIS_URL` con TLS). — _Ya estaba en F0/F2._
- [x] Tunneling: ngrok configurado y corriendo en dev.

**Estado del entregable**: ✅ Done.
- El código del bot está completo y compila.
- Webhooks configurados en Kapso para ambos números (producción + sandbox).
- La API local recibe webhooks correctamente y persiste `wa_users`.
- Mensajes free-form llegan al número de producción `ContrataBot` (+52 1 56 3753 4743) y el bot responde el menú principal con lista interactiva.

**Lo que NO entra en F3**:
- No flows de búsqueda (F4).
- No suscripciones (F5).
- No plantillas Meta (solo mensajes free-form mientras la ventana de 24h esté abierta).
- No persistencia de `Conversation` en Postgres — solo Redis (con TTL).
- No manejo de Flows nativos de Meta (los dropdowns gigantes vienen en F4).

**Stop condition**: si el webhook no recibe nada después de 2h con ngrok configurado, verificar firma + URL en Kapso antes de seguir. No avanzar a F4 sin un mensaje real recibido.

---

## Fase 4 — Búsqueda interactiva end-to-end vía WhatsApp (4-6 días)

**Objetivo**: el usuario completa el flow de búsqueda por WhatsApp y recibe procesos reales de SEACE como tarjetas. Es el primer "wow" del producto.

**Entregable verificable**:
Conversación real:
```
User:  hola
Bot:   [menú]
User:  [tap "Buscar procesos"]
Bot:   ¿De qué entidad?
User:  MINSA
Bot:   Encontré 3 coincidencias: [lista con MINISTERIO DE SALUD, ...]
User:  [tap MINISTERIO DE SALUD]
Bot:   ¿Qué año? [lista años]
User:  [tap 2026]
Bot:   ¿Qué objeto? [Bien · Servicio · Obra · Consultoría · Todos]
User:  [tap Obra]
Bot:   Resumen: MINSA, 2026, Obra. [Buscar] [Modificar] [Cancelar]
User:  [tap Buscar]
Bot:   🔎 Buscando...   (5-10s)
Bot:   Encontré 47 procesos. Te muestro los 5 más recientes:
       [Tarjeta 1] [Tarjeta 2] ... [Tarjeta 5]
       [Ver más] [Refinar] [Suscribirme]
```

**Estado del entregable**: ✅ Done (a nivel de código, compila + lint + typecheck verde; pendiente validar end-to-end por WhatsApp real).

**Diseño implementado** — el F4 se partió en 2 stages para validar incrementalmente:

**Stage 1 (Backbone async)** ✅:
- `EntityModalScraper`: scrape on-demand del modal "Buscar Entidad" de SEACE — NO se harcodean entidades.
- `EntitySearchService` con cascade **L1 → L2 → L3**:
  - L1 Redis (`entity-query:<normalized>`, TTL 24h).
  - L2 trigram local (`pg_trgm`) sobre `entities`; gateway en `≥3 matches`.
  - L3 scrape live del modal cuando los anteriores no alcanzan; upsert idempotente a DB + cache L1.
- `ProcedimientosStrategy.applyFilters`: al recibir `entityRuc`, abre el modal y clickea "Seleccionar" del primer match (el input visible no filtra por RUC). Llama `entityModal.pickByRuc(page, ruc)`.
- `processes.findManyByIds(ids)`: preserva el orden de entrada (necesario para presentar resultados ordenados por relevancia).
- `SearchFacade.search(req)`: DB-first (frescura 6h) → cache Redis (`search:cache:<hash>`, TTL 30 min) → `enqueue(job)` + mapping `search:job:<jobId>` en Redis (TTL 15 min) con `{ phoneNumber, phoneNumberId, userId, tab, filters }` para que el listener encuentre al destinatario.
- `ScrapeProcessor` devuelve `resultIds: string[]` en `SearchJobResult` para hidratar los procesos desde DB sin re-scrape.
- `SearchResultsListener`:
  - Suscribe vía `QueuePort.onJobCompleted` / `onJobFailed` (implementado con BullMQ `QueueEvents`).
  - Recupera el `JobContext` desde Redis; si no existe (crawler programado o dev sin destinatario) ignora.
  - Llama `processes.findManyByIds(resultIds)`, formatea con `SearchResultsPresenter`, envía vía `MessagingPort`.
  - En `failed`: avisa al usuario con un mensaje claro de error.
- `SearchResultsPresenter`: header + hasta 5 tarjetas (text, una por proceso con nomenclatura/entidad/descripcion truncada/objeto/valor/fecha) + footer con botones `Refinar` / `Suscribirme` / `Menú`.
- Endpoints dev (`DevController`): `POST /dev/entity-search` y `POST /dev/search` para validar sin WhatsApp.

**Stage 2 (UX conversacional)** ✅:
- `SearchProcesosFlow` con state machine completo: `awaiting-entity` (texto libre) → `entity-disambiguation` (lista hasta 10 opciones) → `awaiting-anio` (lista 3 años + "Todos") → `awaiting-objeto` (lista Bien/Servicio/Obra/Consultoría/Todos) → `confirm` (buttons Buscar/Cancelar) → `running`.
- Auto-pick si el query devuelve una sola coincidencia.
- Si la búsqueda resuelve por DB o cache, los resultados van inline; si entra en `queued`, el flow termina con mensaje "Buscando… te aviso ✅" y la entrega es asincrónica vía `SearchResultsListener` (ya levantado en Stage 1).
- `MainMenuFlow` dispatcher por `input`: `'search'` → arranca `SearchProcesosFlow.start`; `'subscriptions'`/`'help'` → mensaje "próximamente" + menú; `'search:refine'` (button del presenter) → re-arranca el flow.
- `BotModule` importa `SearchModule` y registra ambos flows en `FlowRegistry`.

**Fixes resueltos durante F4**:
- `BullMqQueue`: mover Queue/QueueEvents al constructor (no `onModuleInit`) para que el listener pueda registrarse sin race.
- `BullMqConnection.onModuleInit`: sólo llamar `connect()` si `status === 'wait'`; QueueEvents dispara la conexión antes.
- `PrismaEntitiesRepo.upsertManyByRuc`: paralelizar con `Promise.all` sin transacción (los upserts son idempotentes); evita el timeout default de 5s de `$transaction` cuando hay 30+ filas vía pooler remoto.

**Lo que NO entra en F4** (post-MVP / siguientes fases):
- No Búsqueda Avanzada (Departamento/Provincia/Distrito) — F7.
- No Flows nativos de Meta para los 89 tipos de selección — F7.
- No ficha detalle (los buttons `Ver ficha` muestran "próximamente"). F7.
- No descarga de bases (placeholder).
- No filtros por rango de fechas — F7.
- No suscripciones (F5).
- No paginación de resultados más allá del top-5 (sin "Ver más" en MVP).
- No optimización del tiempo de scrape — ver F4.5 abajo.

**Resultado observado**:
- Primera búsqueda de un término nuevo (L3): ~3 minutos (browser cold start + reCAPTCHA Enterprise v3 + 4 páginas del modal).
- Búsquedas repetidas (L1): <1 segundo.
- Búsquedas con variantes (L2 después de cachear): ~50 ms.

**Lo que NO entra en F4**:
- No Búsqueda Avanzada (Departamento/Provincia/Distrito) — F7.
- No Flows nativos de Meta para los 89 tipos de selección — F7.
- No ficha detalle (los buttons `Ver ficha` muestran "próximamente"). F7.
- No descarga de bases (placeholder).
- No filtros por rango de fechas — F7.
- No suscripciones (F5).
- No paginación de resultados más allá de "Ver más" que muestra los siguientes 5 (sin scroll infinito).

**Riesgos**:
- Latencia: si el scrape tarda >8s, el bot debe enviar el mensaje "Esto está tardando, te aviso..." y completar asíncronamente. Implementar este heartbeat es opcional en F4 pero recomendado.
- Estado conversacional perdido (Redis flush): el bot debe responder con menú principal en lugar de quedarse colgado.

**Stop condition**: si completas el flow pero el resultado es errático (a veces 0 resultados, a veces error), parar y validar el parser de F2 contra más casos antes de declarar F4 done.

---

## Fase 4.5 — Pre-crawl de entidades (1-2 días)

**Motivación**: en F4 quedó comprobado que el scrape L3 del modal tarda ~3 minutos la primera vez que un usuario menciona un término nuevo (ej: "piura"). Aunque la cascade L1/L2/L3 amortiza el costo en runs posteriores, **cada término nuevo paga la primera vez** y eso degrada la experiencia para usuarios nuevos. Las entidades públicas del Perú son ~10-15k (finitas y de baja rotación), por lo que la solución profesional es **pre-cargar el catálogo completo** en `entities` y dejar L3 sólo como fallback para entidades recién registradas.

**Objetivo**: tener la tabla `entities` con TODAS las entidades públicas registradas en SEACE (~10-15k filas). Después de esta fase, cualquier búsqueda por nombre/sigla/ciudad cae en L2 (`pg_trgm`) en <100 ms — **L3 se ejecuta < 0.1% de las veces**.

**Entregable verificable**:
```bash
pnpm crawl:entities                          # script one-shot, tarda ~2-3h
psql $DATABASE_URL -c "select count(*) from entities;"
# → al menos 10000 filas

# Búsqueda L2 directa por trigram:
psql $DATABASE_URL -c "select ruc, nombre from entities where nombre % 'piura' limit 10;"
# → respuesta en <100ms con 10+ matches reales
```

Y la prueba de UX:
```
[Por WhatsApp, usuario que jamás buscó antes]
User:  hola
Bot:   [menú]
User:  [tap "Buscar procesos"]
Bot:   ¿De qué entidad?
User:  ate
Bot:   [< 1 segundo] Encontré 5 entidades: [Municipalidad Distrital de Ate, ...]
```

**Tareas concretas**:
- [ ] Script `scripts/crawl-entities.ts`:
  - Reusa `EntityModalScraper` (no escribir scraper duplicado).
  - Itera el alfabeto a-z + dígitos: para cada letra, busca por `txtNombreEntidad` y pagina hasta agotar (máx 30 páginas por letra = 300 entidades).
  - Estrategia anti-duplicados: `Set<ruc>` en memoria + upsert idempotente al final.
  - Estrategia anti-bloqueo: pausa 5s entre letras, reusar el mismo `BrowserContext` para preservar la sesión SEACE y no resolver reCAPTCHA en cada query.
  - Persiste con `entitiesRepo.upsertManyByRuc()` en chunks de 100.
- [ ] Script `npm run` registrado en `package.json` → `pnpm crawl:entities`.
- [ ] Log estructurado: por cada letra, `{ letra, paginas, totalAcumulado }`. Permite reanudar si crashea (idempotente — re-correr es seguro).
- [ ] **Bajar el threshold de L2 de `≥3 matches` a `≥1`** en `EntitySearchService` una vez la DB esté llena: con el catálogo completo, basta 1 match para confiar en L2 (la chance de tener un único match relevante real es alta).
- [ ] Cron semanal opcional `@Cron('0 3 * * 1', ...)` en background para capturar entidades recién registradas. Marcar `last_seen_at` para detectar entidades dadas de baja.
- [ ] Métrica de operación: contar cuántas veces L3 se ejecuta vs L1/L2 (log + opcional Postgres counter). Objetivo: <1% de queries caen en L3 después del crawl.

**Lo que NO entra en F4.5**:
- No optimización del scraper L3 (HTTP replay, etc.) — F7+ si jamás se vuelve necesario.
- No deduplicación con SUNAT/RENIEC — el RUC del modal de SEACE es la autoridad.
- No detección semántica de duplicados (mismos nombres con typos).
- No backfill del histórico de procesos por entidad (eso es scraping de procesos, no de entidades — F5/F6).

**Riesgos**:
- Si SEACE rate-limitea por sesión: el crawl entero podría requerir múltiples contexts/IPs. **Mitigación**: empezar con 1 context + pausas, monitorear logs; si bloquea, escalonar más.
- Si el modal cambia el límite de "300 max coincidencias" en algún query genérico (p.ej. "a"), perderíamos cola. **Mitigación**: iterar también con sufijos comunes (a + 0..9, ab, ac, ...) si una letra topa los 300.
- Espacio en DB: 15k filas × ~200 bytes/fila = ~3 MB. Despreciable.

**Stop condition**: si después de 3 letras el ratio entidades únicas / total parseado cae por debajo del 30%, parar y revisar la estrategia (probablemente estás cubriendo lo mismo muchas veces — combinar con búsqueda por departamento si es necesario).

---

## Fase 4.6 — Scraper ACF (`AnunciosFuturosStrategy`) (2-3 días) ★ primer ladrillo del MVP

**Objetivo**: el worker scrapea la pestaña Anuncio de Contratación Futura y persiste
sus filas en `processes` (`tab='anuncios_futuros'`). Prerequisito de todo el MVP ACF.

**Entregable verificable**:
```bash
curl -X POST http://localhost:3000/dev/scrape \
  -H 'content-type: application/json' \
  -d '{"tab":"anuncios_futuros","filters":{"objeto":"obra"}}'
psql $DATABASE_URL -c "select entity_nombre, fecha_aprox_conv, plazo_dias from processes where tab='anuncios_futuros' order by scraped_at desc limit 10;"
# → filas reales de ACF
```

**Tareas concretas**:
- [x] `anuncios-futuros.strategy.ts` (tab `anuncios_futuros`) contra la interfaz real
      (`07` §4.1): `switchTo` (`#tbBuscador:tab7`), `applyFilters` (objeto obligatorio +
      keyword opcional), `search`, `parse`, `goToNextPage`. **Sin** `exportExcel`.
      El filtro por **entidad NO va por scrape** — se resuelve en SQL (fan-out, `09` §2.1).
- [x] Parser de las **10 columnas ACF** (`parseAnunciosFuturos`) → `ProcessRow`. Sin
      nomenclatura/nidProceso. Hash de identidad `hashAcfContent`.
- [x] Registrar en `TabStrategyRegistry` + provider en `SeaceScraperModule`.
- [x] Migración: **índice único parcial** `(tab, content_hash) where tab='anuncios_futuros'`
      (`20260610040000_...`) + `upsertMany` deduplica ACF por `content_hash` (`07` §3.5, `02` D6).
- [x] Spec del parser con **fixture HTML representativo** de la pestaña ACF.

**Test de validación (gate)**:
- [x] `anuncios-futuros.parser.spec.ts` (fixture ACF): 10 columnas → `ProcessRow`, objetos,
      fechas UTC, contentHash estable/distinto, caso vacío. **8/8 verde.**
- [x] `processes.repo` spec contra **BD dev**: 2 filas ACF idénticas → 1 insert + 1
      unchanged (dedup `content_hash`); 2 distintas → 2 inserts. **6/6 verde.**
- [ ] (opcional) e2e live: `POST /dev/scrape {tab:anuncios_futuros}` produce filas reales
      (requiere worker + SEACE en vivo; ~3 min, riesgo reCAPTCHA).

**Lo que NO entra en F4.6**: bot/UX (agente UX), PDF, crawler programado, alertas.

**Stop condition**: si el parse no produce filas tras 2 días, validar el snapshot ACF
en vivo (form `tbBuscador:idFormbuscarACF`, datatable `dtResultadosACF` — ya inspeccionado).

---

## Fase 5 — Alertas ACF: fan-out + tier + PDF (5-7 días)

**Objetivo**: el usuario crea una alerta ACF (con frecuencia + duración, gateadas por
tier) y recibe la notificación cuando aparecen anuncios nuevos. El crawler corre con
**scope fijo** (4 búsquedas/corrida, una por objeto) y el **matcher hace fan-out** a las
suscripciones — NO se scrapea por suscripción. Ver `09` §2.1 y `02` Flujo 3.

**Entregable verificable**:
```
User:  [completa una búsqueda ACF y toca 🔔 Suscribirme]
Bot:   ¿Cada cuánto te aviso? [⚡ Inmediata (Premium)] [1 vez al día] [1 vez a la semana]
User:  [1 vez al día]
Bot:   ¿Por cuánto tiempo? [1 día] [1 semana]   (Premium: +1 mes / Sin vencimiento)
User:  [1 semana]
Bot:   ✅ Alerta creada · Obra · diaria · vence en 1 semana.

# Fuerzo una corrida del crawler ACF (4 búsquedas, una por objeto):
curl -X POST http://localhost:3000/dev/crawl-now

# Verificar:
psql $DATABASE_URL -c "select status, expires_at, last_run_at, last_hit_count from subscriptions;"
# → status=active, expires_at=+7d, last_run_at=now(), last_hit_count >= 0

# Si hubo hits:
psql $DATABASE_URL -c "select kind, status, sent_at from notifications order by created_at desc limit 5;"
# → notif tipo subscription_hit, status sent
# Y en WhatsApp aparece el mensaje
```

**Tareas concretas** (backend; los Flows del bot los hace el **agente UX**, ver `10`):
- [x] Migración schema alertas: `subscriptions.expires_at`, `SubStatus.expired`,
      `wa_users.plan`, `plan_expires_at` (`20260610021500_add_subscription_expiry_and_user_plan`).
- [ ] `CrawlerScheduler` (`modules/crawler/`): `@Cron('0 6,12,18,2 * * *', tz America/Lima)`
      → **scope fijo ACF**: 4 búsquedas (una por objeto), **NO** `ScopeBuilder`. Encola con
      `Promise.allSettled` + delay escalonado.
- [ ] `HitDetectionService` (**fan-out**): tras el upsert, matchea las filas nuevas contra
      `subscriptions` activas y **no vencidas** (objeto + `entity_ruc` si A1) e inserta
      `subscription_hits` (`notified_at=null`). Dedup por `content_hash`.
- [ ] **Job de expiración** (`@Cron`): `status='expired'` donde `expires_at < now()`.
- [ ] `NotificationsService` (**digest**): entrega los hits pendientes según `frequency`
      (`hourly`=al detectar; `daily`=8am; `weekly`=lunes 8am). Agrupa por `user_id`;
      >50 hits → mensaje resumen. Marca `notified_at` + fila en `notifications`.
- [ ] **Render PDF ficha-por-anuncio** (`modules/files`): `ProcessRow[] → Buffer`, al
      vuelo (sin Storage); lo consume el presenter de resultados (`06` §10.6).
- [ ] **Policy de tier** (`modules/subscriptions/`): qué frecuencias/duraciones se ofrecen
      según `wa_users.plan` (free vs premium, `09` §2.3). El gating visual lo aplica el bot.
- [ ] Endpoint dev `POST /dev/crawl-now` que dispara el crawler ACF manualmente.
- [ ] **Plantilla Meta `subscription_hit_v1`** (UTILITY) aprobada en Kapso para
      notificaciones fuera de la ventana de 24h.
- [ ] Flows del bot (`subscribe.flow.ts`, `my-subscriptions.flow.ts`) → **agente UX**, `10` UX-4.
- [ ] Smoke: crear alerta → `/dev/crawl-now` con data que produce un match → llega la
      notificación a WhatsApp.

**Test de validación (gate)**:
- [ ] `hit-detection.spec.ts` (unit, mocks): filas nuevas × suscripciones (A1/A2) →
      `subscription_hits` esperados; alerta **vencida** NO matchea.
- [ ] `expiry.spec.ts` (BD dev): alerta con `expires_at` pasado → `status='expired'`.
- [ ] `notifier.spec.ts` (unit): digest agrupa por `user_id`; >50 hits → resumen;
      `hourly` se renderiza "⚡ Inmediata".
- [ ] `tier-policy.spec.ts` (unit): free NO ofrece hourly/1mes/indefinida; premium sí.
- [ ] Smoke e2e: crear alerta → `/dev/crawl-now` con match → notificación llega a WhatsApp.

**Copy obligatorio**: `hourly` se muestra como **"⚡ Inmediata (al detectar)"** —
**nunca "tiempo real" ni "instantáneo"** (la frescura máx. es la cadencia del crawler).

**Lo que NO entra en F5**:
- No `ScopeBuilder` dinámico (es para Procedimientos, fuera del MVP ACF).
- No back-off de suscripciones zombi — en fan-out una alerta sin matches cuesta 0 scrapes.
- No multi-objeto por alerta (un `objeto`; multi = post-MVP).
- No edición de alerta (crear / pausar / eliminar / reactivar basta).

**Riesgos**:
- Plantillas Meta tardan 24-48h en aprobarse. **Mitigación**: enviar la plantilla a aprobación al inicio de F5, no al final. Mientras se aprueba, probar con notificaciones free-form (válidas si el usuario interactuó <24h atrás).
- El crawler programado puede correr "vacío" si no hay suscripciones activas — el log debe distinguir "scope vacío, nada que hacer" de "scope con items pero fallaron jobs".

**Stop condition**: si la notificación nunca llega después de 1h de probar diferentes paths, parar y revisar Kapso, la firma del webhook outbound, y la cola de BullMQ. No es un bug de F5 — es de la infra de mensajes y hay que aislarlo.

---

## Fase 6 — Despliegue Railway — MVP ACF en producción (3-5 días)

**Objetivo**: el MVP **ACF** vive en producción, accesible desde un número WhatsApp
real: búsqueda ACF + alertas (fan-out + tier + PDF) funcionando end-to-end. Las otras
5 pestañas **NO** son parte del MVP (pasan a F7+).

**Entregable verificable**:
- URL pública: `https://chatbot-seace-api.up.railway.app/health` → 200 OK.
- Mandar "hola" al número configurado en Meta Business → menú con **Anuncios de
  Contratación Futura**.
- Flujo ACF completo en prod: objeto → (filtros) → resultados (tarjetas ≤5 / PDF >5).
- Crear una alerta → el crawler ACF (06:00/12:00/18:00/02:00 Perú) dispara la
  notificación cuando hay match.

**Tareas concretas**:
- [ ] `Dockerfile.api` y `Dockerfile.worker`. El de worker usa `mcr.microsoft.com/playwright:v1.x-jammy` como base, el de API usa `node:20-alpine`.
- [ ] `start` commands: API ejecuta `prisma migrate deploy && node dist/main.js`. Worker ejecuta `node dist/worker.main.js`.
- [ ] Railway:
  - [ ] Crear proyecto, 2 servicios desde el mismo repo (uno con cada Dockerfile).
  - [ ] Variables de entorno: `DATABASE_URL` (Supabase pooler), `REDIS_URL` (Upstash), `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, `SERVICE=api`/`SERVICE=worker`, `NODE_ENV=production`.
  - [ ] Healthcheck del Worker apuntando al `/health` interno.
  - [ ] Volumen efímero para `/tmp` (Railway lo da por defecto).
- [ ] Supabase producción: crear proyecto, ejecutar `prisma migrate deploy` apuntando al host de producción (una vez, manualmente).
- [ ] Upstash producción: crear DB Redis free tier.
- [ ] Kapso producción: cambiar webhook URL al endpoint de Railway, validar firma.
- [ ] Worker en prod con `@Cron` del crawler ACF + job de expiración activos.
- [ ] Smoke test post-deploy: `scripts/smoke-prod.ts` que dispara una búsqueda ACF vía
      la API y verifica que llegan filas + que una alerta de prueba notifica.

> Las **otras 5 strategies** (Procedimientos ya existe; Expresiones, Difusión, OCOS,
> CCO) **NO** son MVP — se mueven a **F7+**. Cada una: 1 archivo `*.strategy.ts` +
> fixture HTML + spec (`07` §4.1).

**Test de validación (gate)**:
- [ ] `/health` (api + worker) → 200 en Railway.
- [ ] `scripts/smoke-prod.ts`: búsqueda ACF en prod devuelve filas + una alerta de
      prueba dispara la notificación end-to-end.

**Lo que NO entra en F6**:
- No CI/CD elaborado — `git push` a `main` despliega vía Railway, eso basta.
- No staging environment separado — Railway free no aguanta dos copias completas.
- No backup automatizado (manual con `pg_dump` semanal por ahora).
- No observability (logs estructurados con pino y los logs nativos de Railway son suficientes).

**Riesgos**:
- Railway Hobby puede pasarse de los $5 base si el worker es muy activo. **Mitigación**: monitorear la factura en la primera semana, ajustar concurrencia.
- Las strategies nuevas pueden tener edge cases del DOM que no vimos en Procedimientos. **Mitigación**: capturar fixtures reales y testear contra ellos antes de prod.
- ViewExpired bajo carga real puede ser más frecuente que en dev. **Mitigación**: que F6 sí incluya el manejo de retry (3 attempts + backoff de BullMQ).

**Stop condition**: si después de 5 días no logras que las 6 pestañas funcionen en prod, declarar F6 done con las que sí funcionen + las que fallen las pasas a F7.

---

## Fase 7+ — Robustez y features avanzados (continuo, post-MVP demo)

A partir de aquí, el roadmap deja de ser secuencial. Cada item es independiente y se prioriza según uso real (qué pide el usuario que falte).

| Feature | Cuándo |
|---|---|
| **Excel fast-path** (>50 resultados → exportar Excel + parsear) | Cuando un usuario haga una búsqueda con >50 resultados y la latencia se note |
| **Ficha de detalle** (clic en `Ver ficha` → parsear la página completa) | Cuando alguien pida "más info" repetidamente |
| **Descarga de bases** vía Supabase Storage | Cuando empiece a haber demanda de archivos |
| **Búsqueda avanzada** (Departamento → Provincia → Distrito cascada) | Cuando un usuario pregunte por "obras en Cusco" |
| **WhatsApp Flow nativo** para los 89 tipos de selección | Si la búsqueda por tipo se vuelve frecuente |
| **Back-off de suscripciones zombi** | Cuando hayan 5+ suscripciones que llevan 4+ semanas sin matches |
| **Búsqueda por palabra clave en descripción** (FTS o trigram avanzado) | Cuando ya tengamos >1000 procesos en DB |
| **Comparador de procesos** | Cuando alguien lo pida |
| **Export a Excel por email** | Cuando pidan datasets grandes |
| **Observabilidad OTLP** (Grafana, traces) | Cuando haya >10 usuarios |
| **Proxies residenciales** | SOLO si reCAPTCHA empieza a bloquear |
| **Pool de sesiones >1** | Cuando BullMQ `waiting > 5` sostenido |
| **Migración a Pro / VPS** | Cuando Railway pase de $15/mes sostenido |
| **Migración a RDS** | Cuando Supabase free se llene (>500MB) o se vendan plans enterprise |

## Definition of Done global (MVP **ACF** listo cuando…)

- [ ] Un usuario nuevo manda "hola" → recibe menú con **Anuncios de Contratación Futura** en <3s.
- [ ] Completa una búsqueda ACF (objeto obligatorio + A1/A2) → recibe resultados:
      tarjetas si ≤5, **PDF ficha-por-anuncio** si >5.
- [ ] Resolvedor de entidad funciona sin exigir RUC (nombre/sigla/RUC).
- [ ] Crea una alerta (frecuencia + duración, gateadas por tier) → la próxima corrida
      del crawler ACF le notifica si hay anuncios nuevos. Copy sin "tiempo real".
- [ ] El sistema corre en Railway sin caerse durante 7 días continuos.
- [ ] La factura de Railway no supera $15/mes.
- [ ] DB-first sirve búsquedas repetidas en <1s.

> Las otras 5 pestañas de SEACE, ficha de detalle y Excel fast-path son **post-MVP** (F7+).

## Estimación temporal

- Trabajo en serie por una persona: **~5-7 semanas** para llegar al "Done global".
- Con 2 personas (una en bot, otra en scraper): **~3-4 semanas**.
- Es un MVP funcional para 1-2 usuarios reales. Pasar a "vendible a empresas" requiere F7+ y endurecimiento (testing, monitoring, escalado).

## Cómo usar este roadmap

1. Empezar siempre por **F0**. No hay atajos.
2. **No saltarse entregables**. Si el entregable no sale, hay un bug de diseño que arrastrarás a fases siguientes.
3. **No empezar la fase N+1 sin demostrar la N**. Es la única forma de mantener honesta la promesa "cada fase es testeable".
4. **Si una fase se atasca**: parar, revisar el doc correspondiente (`02-arquitectura.md` para infra, `04-scraping.md` para scraping, etc.), y decidir si el bloqueo es de diseño o de implementación.
5. **Commits chicos por fase**. Un branch por fase, un PR por fase, merge solo cuando el entregable pasa.