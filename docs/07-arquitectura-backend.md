# 07 · Arquitectura interna del backend NestJS

## 0. Filosofía: Hexagonal lite (Ports & Adapters sin Clean Architecture pura)

### Por qué NO Clean Architecture pura / DDD pesado

| Lo que pide Clean Arch | Por qué no aquí |
|---|---|
| 4 capas (entities, use cases, interface adapters, frameworks) | El dominio del proyecto es CRUD + integración. No hay reglas de negocio complejas que justifiquen entidades ricas. |
| Use-case class por operación | Genera 50+ archivos `SearchProcesoUseCase`, `CreateSubscriptionUseCase`, etc. NestJS Services + Facades hacen lo mismo con la mitad de código. |
| Mappers DTO ↔ Entity ↔ Persistence Model en cada borde | Triple traducción para datos casi idénticos. Una sola tipa-de-dato bien tipada cubre el 90% de casos. |
| Aggregate roots, value objects, repositorios separados por bounded context | El bounded context es uno solo (consultar SEACE). Sobreingeniería. |
| Eventos de dominio + event bus interno | YAGNI: BullMQ ya es nuestro event bus para lo que importa (jobs async). |

### Por qué NO un monolito desestructurado (`seace.service.ts` de 1000 líneas)

Es el error que pagaste en Scrapper-Codex: cualquier cambio de proveedor te obliga a tocar N archivos porque la lógica del negocio **conoce** a Prisma/Supabase/Kapso. Concretamente eso significa:
- `BotService` no puede importar `SupabaseClient` directamente.
- `SearchService` no puede llamar `kapso.sendMessage(...)` directamente.
- `CrawlerService` no puede instanciar `chromium.launch()` directamente.

Si esos tres aprenden a hablar con **interfaces** (puertos) y la decisión de "qué implementación se usa" vive en un único `app.module.ts`, mañana cambiar Kapso → Meta directo es **una línea de código**.

### Lo que SÍ adoptamos (Hexagonal lite)

1. **Ports** (`src/ports/`): interfaces TypeScript puras que describen capacidades. No saben de NestJS.
2. **Adapters** (`src/adapters/`): implementaciones concretas con dependencias externas. Cada una es un módulo NestJS aislado.
3. **Modules de negocio** (`src/modules/`): la lógica del bot, búsqueda, suscripciones, crawler. Importan **ports vía tokens de DI**, nunca adapters directos.
4. **Composition root** (`src/app.module.ts`, `src/worker.main.ts`): el único lugar donde puertos se bindean a adapters concretos.

Esto es ~3 capas en lugar de las 4-5 de Clean Arch, sin mappers ceremoniosos. La regla de oro: **`modules/` no importa nada de `adapters/`**.

## 1. Estructura de carpetas

```
src/
├── main.ts                          # entry API (NestJS HTTP)
├── worker.main.ts                   # entry Worker (BullMQ processors)
├── app.module.ts                    # composition root API
├── worker.module.ts                 # composition root Worker
│
├── config/                          # @nestjs/config + zod validation
│   ├── env.schema.ts                # zod schema con typing del env
│   ├── config.module.ts
│   └── config.types.ts
│
├── common/                          # cross-cutting puro, sin DI
│   ├── logger/                      # pino wrapper
│   ├── errors/                      # clases de error tipadas
│   ├── interceptors/                # request-id, latency
│   ├── filters/                     # global exception filter
│   ├── decorators/                  # @CurrentUser, etc.
│   └── utils/                       # helpers puros (hash, dates)
│
├── ports/                           # 👈 INTERFACES — sin implementación
│   ├── messaging.port.ts
│   ├── scraper.port.ts
│   ├── cache.port.ts
│   ├── queue.port.ts
│   ├── storage.port.ts
│   └── persistence/
│       ├── processes.repo.port.ts
│       ├── subscriptions.repo.port.ts
│       ├── users.repo.port.ts
│       ├── searches.repo.port.ts
│       └── notifications.repo.port.ts
│
├── adapters/                        # 👈 IMPLEMENTACIONES de cada port
│   ├── messaging/
│   │   ├── kapso/
│   │   │   ├── kapso.adapter.ts     # implements MessagingPort
│   │   │   ├── kapso.client.ts      # axios → Kapso REST
│   │   │   ├── kapso.module.ts
│   │   │   └── kapso.dto.ts
│   │   └── meta-cloud/              # 🔮 futuro: Meta Cloud API directa
│   │       └── (vacío por ahora)
│   ├── persistence/
│   │   └── prisma/                  # 👈 ÚNICO adapter de datos
│   │       ├── prisma.module.ts
│   │       ├── prisma.service.ts    # extends PrismaClient, OnModuleInit/Destroy
│   │       ├── processes.repo.ts    # implements ProcessesRepoPort
│   │       ├── subscriptions.repo.ts
│   │       ├── wa-users.repo.ts     # tabla wa_users (sin Supabase Auth)
│   │       ├── searches.repo.ts
│   │       ├── entities.repo.ts
│   │       └── notifications.repo.ts
│   │       # (schema.prisma vive en /prisma/schema.prisma en la raíz del repo,
│   │       #  donde lo busca por defecto el CLI de Prisma)
│   ├── cache/
│   │   ├── redis/                   # ioredis cliente, implements CachePort
│   │   └── in-memory/               # para tests
│   ├── queue/
│   │   └── bullmq/                  # implements QueuePort
│   ├── storage/                     # solo si llegamos a guardar archivos
│   │   └── supabase-storage/        # @supabase/supabase-js DELGADO, solo Storage
│   └── scraper/
│       ├── seace/
│       │   ├── seace.module.ts
│       │   ├── seace.adapter.ts     # implements ScraperPort
│       │   ├── browser/             # gestión de Chromium
│       │   │   ├── browser.manager.ts   # 1 Browser persistente
│       │   │   ├── context.factory.ts   # 1 contexto por job
│       │   │   └── stealth.config.ts
│       │   ├── session/             # cookies, viewstate, recovery
│       │   │   ├── session.manager.ts
│       │   │   └── view-state.tracker.ts
│       │   ├── strategies/          # 👈 STRATEGY pattern por pestaña
│       │   │   ├── tab.strategy.ts          # interface base
│       │   │   ├── tab-strategy.registry.ts # mapa tab → strategy
│       │   │   ├── procedimientos.strategy.ts
│       │   │   ├── anuncios-futuros.strategy.ts   # ACF — tab='anuncios_futuros'
│       │   │   ├── expresiones.strategy.ts
│       │   │   ├── difusion.strategy.ts
│       │   │   ├── ocos.strategy.ts
│       │   │   └── cco.strategy.ts
│       │   ├── parsers/
│       │   │   ├── html-rows.parser.ts
│       │   │   ├── excel.parser.ts
│       │   │   ├── ficha.parser.ts
│       │   │   └── primefaces.helpers.ts    # parsePrimeFacesParams, etc.
│       │   ├── locators/            # localización por label, no ID
│       │   │   └── label-resolver.ts
│       │   └── seace.types.ts
│       └── mock/                    # adapter para tests/CI
│           └── mock-scraper.adapter.ts
│
├── modules/                         # 👈 LÓGICA DE NEGOCIO — depende solo de ports
│   ├── bot/                         # CONVERSACIÓN
│   │   ├── bot.module.ts
│   │   ├── webhook.controller.ts    # POST /webhook (Kapso → aquí)
│   │   ├── conversation/
│   │   │   ├── conversation.service.ts   # state machine driver
│   │   │   ├── conversation.state.ts     # tipos del estado
│   │   │   └── conversation.store.ts     # usa CachePort para persistir en Redis
│   │   ├── flows/                   # cada flow = mini state machine
│   │   │   ├── flow.interface.ts
│   │   │   ├── flow.registry.ts
│   │   │   ├── main-menu.flow.ts
│   │   │   ├── search-procesos.flow.ts
│   │   │   ├── search-anuncios.flow.ts
│   │   │   ├── search-ocos.flow.ts
│   │   │   ├── subscribe.flow.ts
│   │   │   ├── my-subscriptions.flow.ts
│   │   │   └── help.flow.ts
│   │   ├── intents/                 # mapea texto/botón a flow + step
│   │   │   └── intent-router.service.ts
│   │   └── presenters/              # 👈 SEPARA "qué decir" de "qué hacer"
│   │       ├── search-results.presenter.ts
│   │       ├── process-detail.presenter.ts
│   │       ├── subscription.presenter.ts
│   │       └── menu.presenter.ts
│   ├── search/                      # ORQUESTA: DB-first → cache → on-demand
│   │   ├── search.module.ts
│   │   ├── search.facade.ts         # API pública para el bot
│   │   ├── db-first.policy.ts       # decide si DB-hit es aceptable
│   │   ├── freshness.policy.ts      # umbrales por tipo
│   │   └── search.types.ts
│   ├── subscriptions/
│   │   ├── subscriptions.module.ts
│   │   ├── subscriptions.service.ts
│   │   └── hit-detection.service.ts # usa content_hash
│   ├── crawler/                     # programado (NestJS Scheduler)
│   │   ├── crawler.module.ts
│   │   ├── crawler.scheduler.ts     # @Cron incremental 1h + completo 12h
│   │   │                            #   (IMPL real: src/workers/crawler.scheduler.ts,
│   │   │                            #    in-process; early-stop DESC; sin scope-builder p/ACF)
│   │   ├── scope-builder.service.ts # subs + top-N (Procedimientos, no MVP ACF)
│   │   └── crawler.orchestrator.ts  # Promise.allSettled de scope items
│   ├── notifications/
│   │   ├── notifications.module.ts
│   │   ├── notifications.service.ts
│   │   └── template.registry.ts
│   ├── files/
│   │   ├── files.module.ts
│   │   └── files.service.ts
│   └── users/
│       ├── users.module.ts
│       └── users.service.ts
│
├── jobs/                            # 👈 DTOs de jobs compartidos API↔Worker
│   ├── job-types.ts                 # const JOB_NAMES, enum
│   ├── search.job.ts                # data + result type
│   ├── crawl.job.ts
│   ├── ficha.job.ts
│   └── notification.job.ts
│
└── workers/                         # 👈 BullMQ processors (corren en Worker service)
    ├── scrape.processor.ts          # consume search:on-demand, crawl:scheduled
    ├── ficha.processor.ts           # consume ficha:detail
    ├── notification.processor.ts    # consume notification:send
    └── health.controller.ts         # GET /health para Railway
```

## 2. Qué va en cada carpeta — reglas de oro

| Carpeta | Permite importar | NO debe importar |
|---|---|---|
| `ports/` | TS estándar, otros ports | nada de `@nestjs/*`, `@supabase/*`, `playwright`, `bullmq`, `axios` |
| `adapters/<x>/` | port que implementa, libs externas, `@nestjs/common` | otros `adapters/`, `modules/` |
| `modules/<y>/` | ports (vía DI token), otros `modules/`, `common/`, `jobs/` | cualquier cosa de `adapters/` |
| `workers/` | ports vía DI, `jobs/`, `modules/` cuando aplique | crear adapters manualmente |
| `common/` | TS puro, libs sin DI | nada de `adapters/` o `modules/` |
| `jobs/` | sólo tipos TS | nada |

**Regla mecánica para ESLint** (`eslint-plugin-boundaries` o `eslint-plugin-import` con `no-restricted-paths`): `modules/` no puede importar de `adapters/`. Si alguien lo intenta, CI falla. Esto **es lo que evita que vuelva la deuda de Scrapper-Codex**.

## 3. Ports & Adapters al detalle (con código)

### 3.1 Port: `MessagingPort`

```typescript
// src/ports/messaging.port.ts
export interface OutboundMessage {
  to: string                          // E.164
  kind: 'text' | 'buttons' | 'list' | 'flow' | 'document' | 'template'
  payload: unknown                    // tipado por kind, ver messaging.types.ts
}
export interface InboundMessage {
  from: string
  kind: 'text' | 'button_reply' | 'list_reply' | 'flow_reply'
  payload: unknown
  receivedAt: Date
}
export interface MessagingPort {
  send(msg: OutboundMessage): Promise<{ providerMessageId: string }>
  parseWebhook(raw: unknown): InboundMessage[]
}
export const MESSAGING_PORT = Symbol('MESSAGING_PORT')
```

### 3.2 Adapter: Kapso

```typescript
// src/adapters/messaging/kapso/kapso.adapter.ts
@Injectable()
export class KapsoAdapter implements MessagingPort {
  constructor(private readonly client: KapsoClient) {}
  async send(msg: OutboundMessage) { /* HTTP a Kapso */ }
  parseWebhook(raw: unknown) { /* Kapso → InboundMessage[] */ }
}

// src/adapters/messaging/kapso/kapso.module.ts
@Module({
  providers: [KapsoClient, { provide: MESSAGING_PORT, useClass: KapsoAdapter }],
  exports:   [MESSAGING_PORT]
})
export class KapsoMessagingModule {}
```

### 3.3 Bot consume el port, no el adapter

```typescript
// src/modules/bot/conversation/conversation.service.ts
@Injectable()
export class ConversationService {
  constructor(@Inject(MESSAGING_PORT) private msg: MessagingPort) {}
  async reply(to: string, text: string) {
    await this.msg.send({ to, kind: 'text', payload: { body: text } })
  }
}
```

Note: la única referencia a Kapso en todo `modules/bot/` es **inexistente**. Mañana cambiamos `useClass: KapsoAdapter` por `useClass: MetaCloudAdapter` en `app.module.ts` y nada más se toca.

### 3.4 Composition root

```typescript
// src/app.module.ts (API service)
@Module({
  imports: [
    ConfigAppModule,
    KapsoMessagingModule,              // 👈 cambiar a MetaCloudMessagingModule si toca
    PrismaPersistenceModule,           // 👈 funciona contra Supabase, RDS, Postgres local
    RedisCacheModule,
    BullMqQueueModule,
    // SupabaseStorageModule,          // solo si guardamos archivos (PDFs/Excels)
    // módulos de negocio:
    WaUsersModule,
    BotModule,
    SearchModule,
    SubscriptionsModule,
    CrawlerModule,
    NotificationsModule,
    // FilesModule,                    // si activamos storage
  ]
})
export class AppModule {}
```

```typescript
// src/worker.module.ts (Worker service — no escucha HTTP público)
@Module({
  imports: [
    ConfigAppModule,
    PrismaPersistenceModule,
    RedisCacheModule,
    BullMqQueueModule,
    SeaceScraperModule,                // 👈 Playwright + estrategias por pestaña
    SubscriptionsModule,               // necesario para hit-detection desde el worker
  ],
  controllers: [HealthController],     // sólo /health
  providers: [ScrapeProcessor, FichaProcessor, NotificationProcessor]
})
export class WorkerModule {}
```

Un solo repo, dos entry points (`main.ts` y `worker.main.ts`), seleccionados por la env `SERVICE` que Railway inyecta.

**Migración futura a RDS sin tocar `adapters/`**: Prisma ya es agnóstico al host de Postgres. Pasar de Supabase a RDS o a un Postgres self-hosted es cambiar `DATABASE_URL` en el env, correr `prisma migrate deploy`, y nada más. No hace falta un `postgres-direct/` adapter aparte.

### 3.5 Ejemplo concreto: repo Prisma implementando un port

```typescript
// src/ports/persistence/processes.repo.port.ts
export interface ProcessesRepoPort {
  findByFilters(tab: TabName, f: SearchFilters, opts?: { maxAge?: Duration }): Promise<ProcessRow[]>
  upsertMany(rows: ProcessRow[]): Promise<{ inserted: number; updated: number }>
  findById(id: string): Promise<ProcessRow | null>
}
export const PROCESSES_REPO = Symbol('PROCESSES_REPO')
```

```typescript
// src/adapters/persistence/prisma/processes.repo.ts
@Injectable()
export class PrismaProcessesRepo implements ProcessesRepoPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByFilters(tab: TabName, f: SearchFilters, opts?) {
    const maxAgeAt = opts?.maxAge ? new Date(Date.now() - opts.maxAge.ms) : undefined
    return this.prisma.process.findMany({
      where: {
        tab,
        ...(f.entityRuc && { entityRuc: f.entityRuc }),
        ...(f.objeto    && { objeto: f.objeto }),
        ...(f.keyword   && { descripcion: { contains: f.keyword, mode: 'insensitive' } }),
        ...(maxAgeAt    && { scrapedAt: { gte: maxAgeAt } }),
      },
      orderBy: { fechaPublicacion: 'desc' },
      take: 50,
    })
  }

  async upsertMany(rows: ProcessRow[]) {
    // Clave de conflicto POR PESTAÑA (ver 02 · D6):
    //   procedimientos     → (tab, nomenclatura, version_seace)
    //   anuncios_futuros    → (tab, content_hash)   ← ACF no tiene nomenclatura
    //   [requiere índice único parcial para tab='anuncios_futuros']
    let inserted = 0, updated = 0
    await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        const hash = hashRow(r)
        const where = r.tab === 'anuncios_futuros'
          ? { tab_contentHash: { tab: r.tab, contentHash: hash } }
          : { tab_nomenclatura_versionSeace: { tab: r.tab, nomenclatura: r.nomenclatura, versionSeace: r.versionSeace } }
        const result = await tx.process.upsert({
          where,
          create: { ...r, contentHash: hash },
          update: { ...r, contentHash: hash, scrapedAt: new Date() }
        })
        result.firstSeenAt.getTime() === result.scrapedAt.getTime() ? inserted++ : updated++
      }
    })
    return { inserted, updated }
  }

  async findById(id: string) { return this.prisma.process.findUnique({ where: { id } }) }
}
```

```typescript
// src/adapters/persistence/prisma/prisma.module.ts
@Module({
  providers: [
    PrismaService,
    { provide: PROCESSES_REPO,     useClass: PrismaProcessesRepo },
    { provide: ENTITIES_REPO,      useClass: PrismaEntitiesRepo },        // 👈 catálogo de entidades
    { provide: SUBSCRIPTIONS_REPO, useClass: PrismaSubscriptionsRepo },
    { provide: WA_USERS_REPO,      useClass: PrismaWaUsersRepo },
    { provide: SEARCHES_REPO,      useClass: PrismaSearchesRepo },
    { provide: NOTIFICATIONS_REPO, useClass: PrismaNotificationsRepo },
  ],
  exports: [
    PROCESSES_REPO, ENTITIES_REPO, SUBSCRIPTIONS_REPO, WA_USERS_REPO, SEARCHES_REPO, NOTIFICATIONS_REPO,
  ]
})
export class PrismaPersistenceModule {}
```

Los `modules/` consumen `PROCESSES_REPO` (interfaz), nunca `PrismaProcessesRepo` (clase concreta) ni `PrismaService`.

### 3.6 Rol de `@supabase/supabase-js` en la arquitectura

`supabase-js` es un cliente **opcional y aislado** que aparece SOLO si necesitamos Supabase Storage para guardar PDFs/Excels descargados de SEACE.

- **No** se usa para Auth (no usamos Supabase Auth; los usuarios viven en `wa_users` standalone, identificados por su número de WhatsApp).
- **No** se usa para acceder a Postgres (Prisma cubre todo).
- **No** se usa para Realtime (no hay caso de uso en MVP).

Si se activa Storage, vive en `adapters/storage/supabase-storage/`, implementa `StoragePort`, y es el ÚNICO archivo del repo que importa `@supabase/supabase-js`. El resto del código no se entera de que existe Supabase como proveedor.

Migración futura: si se cambia Storage a S3 o R2, se crea `adapters/storage/s3/` con la misma interfaz, se cambia el binding en `app.module.ts`, y listo.

## 4. Patrones reutilizados (los que pediste)

### 4.1 Strategy pattern para scrapers SEACE

```typescript
// src/adapters/scraper/seace/strategies/tab.strategy.ts
// Interfaz REAL en código: sin genéricos, sin exportExcel; con formId y paginación.
export interface ParsedPage {
  rows: ProcessRow[]
  totalReported: number | null
  currentPage: number | null
  totalPages: number | null
}
export interface TabStrategy {
  readonly tab: TabName                 // enum Prisma: 'procedimientos' | 'anuncios_futuros' | ...
  readonly formId: string               // id del form JSF de la pestaña
  switchTo(page: Page): Promise<void>
  applyFilters(page: Page, f: SearchFilters): Promise<void>
  search(page: Page): Promise<void>
  parse(page: Page): Promise<ParsedPage>
  goToNextPage(page: Page): Promise<boolean>   // true si avanzó; false si era la última página
}

// Registry inyectable
@Injectable()
export class TabStrategyRegistry {
  constructor(
    private readonly procedimientos: ProcedimientosStrategy,
    private readonly anunciosFuturos: AnunciosFuturosStrategy,   // tab='anuncios_futuros' (ACF)
    // ...
  ) {}
  get(tab: TabName): TabStrategy {
    const map = { procedimientos: this.procedimientos, anuncios_futuros: this.anunciosFuturos, /*...*/ }
    const s = map[tab]
    if (!s) throw new Error(`Strategy no encontrada: ${tab}`)
    return s
  }
}
```

> **Nota Excel**: la strategy **no** expone `exportExcel`. El botón Exportar de ACF
> existe en SEACE, pero no lo usamos: el PDF se **renderiza desde `processes`**
> (ver `06` §10.6 y `04` §3.2). Si algún día se necesita el Excel fast-path para
> Procedimientos, será un método aparte, no parte de esta interfaz.

`SeaceAdapter` recibe el registry por DI y delega a la estrategia que corresponda. Añadir una pestaña nueva = 1 archivo `xxx.strategy.ts` + 1 línea en el registry.

### 4.2 Promise.allSettled en el crawler

```typescript
// src/modules/crawler/crawler.orchestrator.ts
@Injectable()
export class CrawlerOrchestrator {
  constructor(@Inject(QUEUE_PORT) private q: QueuePort) {}

  async runScope(items: ScopeItem[]) {
    const results = await Promise.allSettled(
      items.map((item, i) =>
        // delay escalonado para no disparar 20 jobs en el mismo segundo
        this.delay(i * 250).then(() => this.q.add('crawl:scheduled', item))
      )
    )
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length) logger.warn(`scope: ${failed.length}/${items.length} encolados fallaron`)
  }

  private delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }
}
```

`Promise.allSettled` garantiza que un fallo en un scope-item no aborte el resto.

### 4.3 BullMQ async — Job DTO compartido

```typescript
// src/jobs/job-types.ts
export const JOB_NAMES = {
  SEARCH_ON_DEMAND: 'search:on-demand',
  CRAWL_SCHEDULED:  'crawl:scheduled',
  FICHA_DETAIL:     'ficha:detail',
  NOTIFY:           'notification:send',
} as const

// src/jobs/search.job.ts
export interface SearchJobData {
  userId: string | null
  tab: TabName
  filters: SearchFilters
  trace: { requestId: string; enqueuedAt: number }
}
export interface SearchJobResult {
  processIds: string[]
  source: 'live'
  durationMs: number
}
```

API y Worker importan el mismo tipo. Si cambias el shape, TypeScript te grita en ambos lados al mismo tiempo.

### 4.4 Caché TTL — port único, 2 adapters

```typescript
// src/ports/cache.port.ts
export interface CachePort {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
  del(key: string): Promise<void>
}
export const CACHE_PORT = Symbol('CACHE_PORT')
```

Adapter Redis (prod) e in-memory (tests + Día 0 si Redis aún no está listo). Ambos exportan `CACHE_PORT`. El `SearchFacade` no sabe cuál usa.

## 5. La pieza más importante: separar el bot del scraping

Ejemplo del flujo "el usuario busca procesos":

```
WhatsApp → Kapso (HTTP) → webhook.controller.ts
   │
   ▼
conversation.service.ts  ← orquesta el step actual del flow
   │
   ▼
search-procesos.flow.ts  ← decide: ¿qué falta preguntar? ¿ya hay filtros listos?
   │
   ▼ (filtros completos)
search.facade.ts  ← lógica DB-first → cache → encolar
   │            ↘            ↘
   ▼              ▼            ▼
ProcessesRepoPort  CachePort   QueuePort
   │              │            │
   ▼              ▼            ▼
PrismaRepo      RedisCache   BullMqQueue
                              │
                              ▼
                       (Worker service)
                              │
                              ▼
                       scrape.processor.ts
                              │
                              ▼
                       ScraperPort  ←  SeaceAdapter
                              │            │
                              │            ▼
                              │       TabStrategyRegistry → ProcedimientosStrategy
                              │
                              ▼
                       ProcessesRepoPort (upsert)
                              │
                              ▼
                       SubscriptionsModule.detectHits()
                              │
                              ▼
                       QueuePort.add('notification:send')
                              │
                              ▼
                       notification.processor → MessagingPort → Kapso → WhatsApp
```

Cada flecha cruza un port o un módulo de negocio. **Cero** referencias directas a Kapso, Supabase o Playwright desde `modules/bot/`.

Cuando el bot quiere mostrar un resultado, llama al **presenter**:

```typescript
// src/modules/bot/presenters/search-results.presenter.ts
export class SearchResultsPresenter {
  build(rows: ProcessRow[]): OutboundMessage[] {
    // arma tarjetas de texto + buttons, decide cuántos mostrar, pagina
    return rows.slice(0, 5).map(toCard)
  }
}
```

Y el conversation.service envía cada `OutboundMessage` por el `MessagingPort`. **La lógica de "cómo se ve" (presenter) está separada de "qué hacer" (flow) y de "cómo enviar" (adapter)**.

## 6. Estado conversacional

Vive en Redis vía `CachePort`. Estructura:

```typescript
// src/modules/bot/conversation/conversation.state.ts
export interface ConversationState {
  userId: string
  phone: string
  flowId: string        // 'search-procesos', 'main-menu', etc.
  step: string          // 'awaiting-entity', 'awaiting-objeto', etc.
  filters: SearchFilters
  startedAt: number
  expiresAt: number
}
```

`conversation.store.ts` lo lee/escribe vía `CachePort`. Si Redis se cae y la sesión se pierde, el próximo mensaje del usuario vuelve al menú principal. UX aceptable.

## 7. Tests

| Tipo | Dónde | Doble que se usa |
|---|---|---|
| Unit de `flows/` | `modules/bot/flows/*.spec.ts` | Mocks de ports, fixtures de mensajes |
| Unit de `presenters/` | `modules/bot/presenters/*.spec.ts` | Solo input → output, sin DI |
| Unit de `strategies/` | `adapters/scraper/seace/strategies/*.spec.ts` | Playwright Page mockeado con HTML fixture de snapshot real |
| Integration de `SearchFacade` | `modules/search/*.spec.ts` | Adapter in-memory de cache + repo, mock scraper |
| E2E del worker | `test/e2e/scrape.e2e.spec.ts` | Levanta Playwright real contra SEACE staging o snapshot |
| Smoke Día 0 | `test/smoke/day0.spec.ts` | DB vacía + Redis vacío; debe responder sin error |

Como `modules/` no toca `adapters/`, los tests unitarios pueden inyectar mocks en 3 líneas (`{ provide: MESSAGING_PORT, useValue: fakeMessaging }`).

## 8. Lo que NO hacemos (anti-patrones a vigilar)

| ❌ | ✅ |
|---|---|
| `BotService` importa `SupabaseClient` | `BotService` recibe `@Inject(PROCESSES_REPO)` |
| Cada operación es un Use-Case class | Un `SearchFacade` con 4 métodos |
| Mapper `DbProcess ↔ Domain Process ↔ Dto Process` | Un solo `ProcessRow` tipado |
| Lógica de scraping dentro de `bot.service.ts` | Lógica de scraping en `adapters/scraper/seace/` |
| Cron `@Cron` dentro de un adapter | Cron en `modules/crawler/crawler.scheduler.ts` |
| `if (provider === 'kapso') {...} else {...}` | DI binding en `app.module.ts` |
| `try/catch` que se traga errores en flows | Errores tipados (`common/errors/`) + filter global |
| Adapter llamando a otro adapter | Adapter no conoce a otros adapters; el module de negocio orquesta |

## 8·bis — Piezas del MVP (ACF / alertas) aún sin casa en esta estructura

Decisiones posteriores a la escritura original de este doc. Pendientes de ubicar:

1. **Resolvedor de entidad (Módulo 5).** Existe `entities.repo.ts` + `ENTITIES_REPO`,
   pero falta el **módulo de negocio**: `modules/entities/` (facade con búsqueda
   difusa pg_trgm nombre/sigla/RUC) + `bot/flows/entity-resolver.flow.ts` (sub-flujo
   inline + standalone). Ver `06` §10.4.
2. **Render de PDF "ficha-por-anuncio"** (resultados ACF >5). Renderer puro
   `ProcessRow[] → Buffer` en `modules/files/`, **al vuelo, sin** Supabase Storage; lo
   consume el presenter de resultados. Ver `06` §10.6.
3. **Tier/plan + expiración de alertas.** `wa_users.plan` ya migrado. Falta: gating de
   frecuencia/duración (policy en `modules/subscriptions/`) y job `@Cron` de expiración
   (`status='expired'` si `expires_at < now()`). Ver `09` §2.2-2.3.
4. **Crawler ACF de scope fijo + fan-out.** Para ACF NO se usa `scope-builder` (subs +
   top-N): son 4 búsquedas fijas por corrida (una por objeto) y
   `subscriptions/hit-detection.service.ts` hace el match. El `scope-builder` queda
   para Procedimientos. Ver `02` Flujo 3.
5. **Strategy ACF**: `anuncios-futuros.strategy.ts` (tab `anuncios_futuros`) contra la
   interfaz real (§4.1). Es el primer ladrillo del MVP.

## 9. Resumen

- **3 capas explícitas**: ports (interfaces), adapters (implementaciones), modules (lógica de negocio).
- **Composition root único** (`app.module.ts` / `worker.module.ts`) que decide qué adapter se usa por cada port.
- **NestJS DI con tokens Symbol** para inyectar interfaces, no clases.
- **ESLint con `no-restricted-paths`** impide a `modules/` importar `adapters/`.
- **Strategy pattern** dentro de `adapters/scraper/seace/strategies/` para las 6 pestañas.
- **Presenters separados de flows** en `modules/bot/`.
- **DTOs de job en `jobs/`** compartidos API ↔ Worker.
- **Dos entry points**, un repo. `SERVICE=api|worker` decide cuál arranca.

Esto es la cantidad mínima de estructura que:
1. Te deja cambiar Kapso → Meta directa en 1 línea.
2. Te deja cambiar Supabase Postgres → RDS cambiando solo `DATABASE_URL` (Prisma es agnóstico).
3. Te deja añadir una pestaña nueva de SEACE en 1 archivo (`strategies/`).
4. Te deja correr tests unit sin levantar Postgres ni Redis.
5. No te obliga a escribir 50 use-case classes ni mappers triples.
6. No deja que la próxima iteración del bot acople business con persistence.