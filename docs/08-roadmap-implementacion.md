# 08 · Roadmap de implementación — MVP funcional por fases

## Principios de ejecución

1. **Cada fase tiene un entregable que se ejecuta y se observa**. Si no se puede demostrar con un comando o una conversación de WhatsApp, no es entregable, es diseño.
2. **Una fase es "done" cuando el entregable pasa**. No cuando "el código está bonito".
3. **Anti-scope-creep**: cada fase tiene una sección "lo que NO entra". Si aparece la tentación de añadir algo, va al backlog post-MVP.
4. **El usuario real (tú) prueba cada fase antes de empezar la siguiente**. Si la fase anterior no convence, no se avanza.
5. **No optimizar antes de tiempo**. Pool de 1 browser, concurrency 1, sin proxies, sin OTLP. Eso entra en F7+ cuando duela.

## Mapa de dependencias

```
F0 (Bootstrap) ─▶ F1 (Schema + repos)
                          │
                          ▼
                  F2 (Scraper manual) ─▶ F4 (Búsqueda WA end-to-end)
                          │                    │
                          │                    ▼
                  F3 (Bot recibe/responde) ─▶ F5 (Suscripciones + crawler)
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
- [ ] Proyecto **Supabase dev** creado. Anotar la `DATABASE_URL` del pooler (Settings → Database → Connection string → URI con `?pgbouncer=true`).
- [ ] Base **Upstash Redis dev** creada (free tier). Anotar la `REDIS_URL` con esquema `rediss://` (TLS).
- [ ] **Kapso sandbox** activo con `KAPSO_API_KEY` y `KAPSO_WEBHOOK_SECRET` a mano. (Si todavía no tienes la cuenta, este prereq se puede aplazar hasta F3 — F0/F1/F2 no consumen Kapso.)
- [ ] **Playwright browsers** instalados localmente: `npx playwright install chromium` (se necesitarán en F2; instalarlos en F0 evita sorpresas después).
- [ ] Archivo `.env.local` creado con las variables de la sección de envs más abajo. **No** se commitea.

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
- [ ] `pnpm init`, NestJS CLI, TypeScript strict, prettier, eslint.
- [ ] Instalar `eslint-plugin-boundaries` (o `no-restricted-paths`) con la regla: `src/modules/**` no puede importar `src/adapters/**`. Que CI falle si alguien lo intenta.
- [ ] Estructura de carpetas base de `docs/07-arquitectura-backend.md` (vacías, con `.gitkeep` donde haga falta).
- [ ] `src/main.ts` (API) y `src/worker.main.ts` (Worker) — ambos con `HealthController` que devuelve `{ status: 'ok', service: 'api'|'worker', uptime, version }`.
- [ ] Validación de env con zod en `src/config/env.schema.ts`. La app no arranca si falta una env requerida.
- [ ] `PrismaService` con la conexión validada al iniciar (un `$queryRaw\`SELECT 1\`` en `onModuleInit` que falle ruidoso si Supabase no responde).
- [ ] Cliente Redis (ioredis) inicializado contra Upstash con TLS habilitado por la URL `rediss://`. Smoke check `PING` en arranque.
- [ ] Script `pnpm dev` que arranca ambos con `concurrently` o `npm-run-all`.
- [ ] `.env.example` documentando todas las envs (sin valores reales).
- [ ] `.gitignore` con `.env.local`, `node_modules`, `dist`, `.playwright-cli`, etc.

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
- [ ] `prisma/schema.prisma` copiado de la sección 1 de `05-schema-supabase.md`.
- [ ] `prisma migrate dev` corre sin error contra el proyecto Supabase dev.
- [ ] Migraciones manuales: índices GIN trigram para `entities.nombre`/`sigla` y `processes.descripcion`. Crear extensión `pg_trgm` y `pgcrypto` en una migración SQL aparte.
- [ ] `PrismaService` extends `PrismaClient`, con `onModuleInit`/`onModuleDestroy` para connect/disconnect.
- [ ] Ports en `src/ports/persistence/`: `ProcessesRepoPort`, `EntitiesRepoPort`, `WaUsersRepoPort`, `SubscriptionsRepoPort`, `SearchesRepoPort`, `NotificationsRepoPort`. Solo interfaces.
- [ ] Implementaciones Prisma en `src/adapters/persistence/prisma/*.repo.ts`. Cada una tiene los 3-5 métodos imprescindibles del MVP, no más.
- [ ] `PrismaPersistenceModule` registra todos los providers con sus tokens.
- [ ] Specs unitarios de los repos: usar `vitest` o `jest` apuntando a la `DATABASE_URL` de Supabase dev (no mocks). Cada spec hace `beforeEach: truncate` de las tablas que toca, crea fixtures, valida queries reales. Si concurrencia entre devs molesta, crear un schema dedicado `test` en el mismo proyecto Supabase y apuntar tests ahí vía `?schema=test`.
- [ ] Script `pnpm seed:dev` que crea 1 wa_user con phone `+51999000001`, 1 entity MINSA, 1 subscription daily de Obras.

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
- [ ] Ports: `ScraperPort`, `QueuePort` en `src/ports/`.
- [ ] `BullMqQueueModule` implementando `QueuePort` (add, addBulk, getJob).
- [ ] `SeaceScraperModule` en `src/adapters/scraper/seace/`:
  - [ ] `BrowserManager`: 1 `Browser` persistente con `playwright-extra` + `puppeteer-extra-plugin-stealth`. Lanza al `onModuleInit`, cierra al `onModuleDestroy`.
  - [ ] `ContextFactory`: crea/destruye un `BrowserContext` por job.
  - [ ] `SessionManager`: navega a `buscadorPublico.xhtml`, conserva cookies (JSESSIONID + Oracle-BMC-LBS-Route) en memoria, detecta `ViewExpiredException`.
  - [ ] `LabelResolver`: dado un form y un label visible, devuelve el ID JSF del input asociado (sección 2.1 de `04-scraping.md`).
  - [ ] `TabStrategy` interface + `TabStrategyRegistry`.
  - [ ] `ProcedimientosStrategy`: implementa `switchTo`, `applyFilters`, `search`, `parse` para HTML. NO Excel todavía, NO ficha detalle.
  - [ ] `HtmlRowParser`: convierte filas de `dtProcesos` a `ProcessRow` con `nidProceso`/`nidConvocatoria` extraídos del `onclick`.
- [ ] `SeaceAdapter` implementing `ScraperPort`. Métodos: `search(tab, filters): Promise<ProcessRow[]>`.
- [ ] Worker: `ScrapeProcessor` consume jobs `JOB_NAMES.SEARCH_ON_DEMAND`, llama al ScraperPort, hace `processesRepo.upsertMany()`.
- [ ] API: controlador `DevController` con `POST /dev/scrape` (solo si `NODE_ENV !== 'production'`). Encola un job y devuelve el `jobId`.
- [ ] `pnpm dev:logs:worker` que muestra logs estructurados del worker (qué job se procesó, cuántos procesos parseó, cuántos insertó vs actualizó).
- [ ] Spec del parser de HTML: usar el snapshot YAML del `.playwright-cli/` capturado el 2026-05-25 como fixture, validar que parsea 15 rows.

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
- [ ] Ports: `MessagingPort` con `send(OutboundMessage)` y `parseWebhook(raw)`.
- [ ] `KapsoMessagingModule` en `src/adapters/messaging/kapso/`:
  - [ ] `KapsoClient`: axios contra Kapso REST con auth header.
  - [ ] `KapsoAdapter implements MessagingPort`: envío de texto y lista interactiva. Botones (1-3) opcional.
  - [ ] Tipos de `OutboundMessage` discriminados por `kind`.
- [ ] `BotModule`:
  - [ ] `WebhookController` con `POST /webhook` — valida firma de Kapso, llama `parseWebhook`, pasa al `ConversationService`.
  - [ ] `ConversationService`: orquesta state machine. Lee/escribe estado en Redis vía `CachePort`.
  - [ ] `ConversationStore` con TTL 30 min.
  - [ ] `FlowRegistry` que mantiene un mapa `flowId → Flow`.
  - [ ] `MainMenuFlow`: state machine de 1 paso — recibe cualquier intent, retorna `OutboundMessage` con la lista del menú.
  - [ ] `MenuPresenter`: construye el `OutboundMessage` de la lista.
  - [ ] `WaUsersService`: `upsertByPhone(phone)` usando `WaUsersRepoPort`.
- [ ] `CachePort` + `RedisCacheModule` (implementación con `ioredis` apuntando a Upstash vía `REDIS_URL` con TLS).
- [ ] Tunneling: instrucciones en README para correr `ngrok http 3000` o `cloudflared` durante dev.

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

**Tareas concretas**:
- [ ] `SearchProcesosFlow`: state machine con steps `awaiting-entity`, `entity-disambiguation`, `awaiting-anio`, `awaiting-objeto`, `confirm`, `running`, `done`.
- [ ] `EntitiesRepoPort.searchByText(q, limit)` ya está en F1; validar que funcione con `pg_trgm`.
- [ ] **Pre-poblar `entities` con un seed real**: scrapear el modal de búsqueda de entidad de SEACE para ~100 entidades comunes (MINSA, ESSALUD, MEF, Ministerios, OECE, Municipalidad de Lima Metropolitana + distritales más grandes). Script `pnpm seed:entities`.
- [ ] `SearchFacade.search(userId, tab, filters)`:
  - 1. Consulta `processes` con filtros + freshness; si hit, devuelve.
  - 2. Consulta cache Redis con hash de filtros; si hit, devuelve.
  - 3. Encola job `search:on-demand` y devuelve `{ jobId, source: 'queued' }`.
- [ ] Pub/sub Redis: el `ScrapeProcessor` publica el resultado a `search-results:<jobId>` al terminar.
- [ ] `ConversationService` escucha el pub/sub, recupera el estado de la conversación esperando este `jobId`, formatea con `SearchResultsPresenter` y envía vía `MessagingPort`.
- [ ] `SearchResultsPresenter`: arma 5 mensajes de texto (uno por proceso, máx 5) cada uno con 3 buttons (`Ver ficha`, `Bases`, `Cronograma` — los dos últimos pueden ser placeholders que dicen "próximamente" en F4).
- [ ] Registro en `searches`: cada búsqueda completada (live o cached) inserta una fila con `user_id`, `filters`, `result_count`. Esto alimenta el top-N de F5.
- [ ] Persistir resultados del on-demand en `processes` (ya hecho en F2, validar que se ejecuta).
- [ ] **Confirmación antes de scrapear**: el step `confirm` envía buttons; sin "Sí" del usuario no se gasta un scrape.

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

## Fase 5 — Suscripciones + crawler programado (4-6 días)

**Objetivo**: el usuario crea una alerta y recibe una notificación de WhatsApp cuando hay procesos nuevos que matchean. El crawler programado corre periódicamente con scope dirigido por demanda.

**Entregable verificable**:
```
User:  [completa una búsqueda como F4]
Bot:   [muestra resultados]
User:  [tap "Suscribirme a esta búsqueda"]
Bot:   ¿Cada cuánto? [Tiempo real] [Diaria] [Semanal]
User:  [tap Diaria]
Bot:   ✅ Suscripción creada. Te avisaré cada día.

# Fuerzo una corrida del crawler manualmente:
curl -X POST http://localhost:3000/dev/crawl-now

# Verificar:
psql $DATABASE_URL -c "select status, last_run_at, last_hit_count from subscriptions;"
# → status=active, last_run_at=now(), last_hit_count >= 0

# Si hubo hits:
psql $DATABASE_URL -c "select kind, status, sent_at from notifications order by created_at desc limit 5;"
# → notif tipo subscription_hit, status sent
# Y en WhatsApp aparece el mensaje
```

**Tareas concretas**:
- [ ] `SubscribeFlow`: 2 steps — elegir frecuencia, confirmar. Toma los filtros del flow de búsqueda inmediatamente anterior.
- [ ] `MySubscriptionsFlow`: lista suscripciones del user, permite pausar/eliminar.
- [ ] `SubscriptionsService`: CRUD + transiciones de estado (`active`/`paused`/`deleted`).
- [ ] `CrawlerScheduler` en `src/modules/crawler/`:
  - [ ] `@Cron('0 6,12,18,2 * * *', { timeZone: 'America/Lima' })` ejecuta `runScope()`.
  - [ ] `ScopeBuilderService`: consulta suscripciones activas + top-N de `searches` con `HAVING COUNT >= 3` últimos 30 días, deduplica, devuelve `ScopeItem[]`.
  - [ ] `CrawlerOrchestrator`: encola los scope items con `Promise.allSettled` y delay escalonado (250ms entre cada uno).
- [ ] Endpoint dev `POST /dev/crawl-now` que dispara `runScope()` manualmente sin esperar al cron — imprescindible para testear.
- [ ] `HitDetectionService` (puede vivir dentro de `SubscriptionsModule`):
  - [ ] `persistAndDetectHits(scopeItem, rows)`: la función de la sección 7 de `04-scraping.md`.
  - [ ] Computa `content_hash` sobre los campos relevantes.
  - [ ] Inserta `subscription_hits` con `notified_at = null` cuando hay deltas.
- [ ] `NotificationsService`:
  - [ ] Consume `subscription_hits` con `notified_at = null`, agrupa por `user_id`, construye `OutboundMessage` con hasta 5 procesos por mensaje (más → "Tienes 12 procesos nuevos, [Ver todos]").
  - [ ] Envía vía `MessagingPort`.
  - [ ] Marca `subscription_hits.notified_at = now()` y crea fila en `notifications` con `kapso_msg_id`.
- [ ] **Plantilla Meta `subscription_hit_v1` aprobada en Kapso** (categoría UTILITY). Para que las notificaciones funcionen cuando la ventana de 24h con el usuario está cerrada.
- [ ] Smoke test: crear suscripción, encolar manualmente un scrape que sabes que devuelve resultados nuevos, validar que llega la notificación a tu WhatsApp.

**Lo que NO entra en F5**:
- No back-off automático de suscripciones zombi (F7).
- No promoción automática al scope desde `searches` repetidas (el SQL del scope ya lo hace, pero no escribir lógica extra de promoción).
- No agrupación inteligente de notificaciones — un mensaje por suscripción que dispare, máximo 1 por hora por usuario.
- No edición de suscripción (solo crear/pausar/eliminar).

**Riesgos**:
- Plantillas Meta tardan 24-48h en aprobarse. **Mitigación**: enviar la plantilla a aprobación al inicio de F5, no al final. Mientras se aprueba, probar con notificaciones free-form (válidas si el usuario interactuó <24h atrás).
- El crawler programado puede correr "vacío" si no hay suscripciones activas — el log debe distinguir "scope vacío, nada que hacer" de "scope con items pero fallaron jobs".

**Stop condition**: si la notificación nunca llega después de 1h de probar diferentes paths, parar y revisar Kapso, la firma del webhook outbound, y la cola de BullMQ. No es un bug de F5 — es de la infra de mensajes y hay que aislarlo.

---

## Fase 6 — Despliegue Railway + las 6 pestañas (3-5 días)

**Objetivo**: el bot vive en producción, accesible desde un número WhatsApp real, con las 6 pestañas de SEACE soportadas (no solo Procedimientos).

**Entregable verificable**:
- URL pública: `https://chatbot-seace-api.up.railway.app/health` → 200 OK.
- Mandar "hola" al número configurado en Meta Business → respuesta del menú.
- Probar las 6 pestañas vía bot: Procedimientos, ACF, Expresiones, Difusión, OCOS, CCO. Cada una devuelve al menos una búsqueda válida.
- Crawler programado corre automáticamente (verificar logs después de las 06:00/12:00/18:00 hora Perú).

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
- [ ] Implementar las 5 strategies restantes:
  - [ ] `AnunciosStrategy` (ACF, tab7).
  - [ ] `ExpresionesStrategy` (tab3).
  - [ ] `DifusionStrategy` (tab4, casi clon de Expresiones).
  - [ ] `OcosStrategy` (tab5, Año + Mes obligatorios).
  - [ ] `CcoStrategy` (tab6).
- [ ] Cada strategy: capturar fixture HTML del snapshot (correr el bot en dev, navegar a la pestaña, guardar el HTML real) y escribir un spec del parser.
- [ ] Smoke test post-deploy: script `scripts/smoke-prod.ts` que dispara una búsqueda de cada pestaña vía la API y verifica que llegan procesos.

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

## Definition of Done global (MVP listo cuando…)

- [ ] Un usuario nuevo manda "hola" → recibe menú en <3s.
- [ ] Completa una búsqueda por entidad → recibe 5 procesos reales en <15s.
- [ ] Crea una suscripción → la próxima corrida del crawler (max 6h después) le manda notificación si hay procesos nuevos.
- [ ] Las 6 pestañas de SEACE funcionan al menos en flujo básico.
- [ ] El sistema corre en Railway sin caerse durante 7 días continuos.
- [ ] La factura de Railway no supera $15/mes.
- [ ] DB-first sirve búsquedas repetidas en <1s tras 1-2 semanas de uso.

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