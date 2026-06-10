# 05 · Schema de PostgreSQL (Supabase como host) — gestionado con Prisma

**ORM canónico**: Prisma. El archivo `prisma/schema.prisma` en la raíz del repo es la fuente de verdad; las migraciones se generan con `prisma migrate`. Las definiciones SQL de este documento son una **referencia legible** para el equipo y para diseñar índices, triggers, RPCs y vistas que Prisma no modela bien.

**Sin Supabase Auth**: los usuarios del bot viven en una tabla propia `wa_users` (sin FK a `auth.users`). La identidad es el número E.164 que provee Meta. No hay JWT, no hay flujo de login.

**Conexión**: Prisma conecta vía `DATABASE_URL` (pooler de Supabase con `?pgbouncer=true&connection_limit=1` para serverless-friendly, o conexión directa si tirámos a RDS). Cambiar host es cambiar la URL.

Convenciones:
- Naming SQL `snake_case`, plural en tablas. Naming Prisma `camelCase` con `@map`/`@@map`.
- IDs: `uuid` con `gen_random_uuid()`; identificadores naturales de SEACE (nomenclatura, RUC) conservados como columnas únicas.
- `created_at` / `updated_at` en todas las tablas. Prisma maneja `updatedAt` con `@updatedAt`; un trigger SQL los mantiene también para escrituras hechas fuera de Prisma.
- **RLS deshabilitado** por defecto (la app conecta como rol con permisos completos vía Prisma; no hay clientes anon-key tocando la DB). La autorización es responsabilidad de la capa de aplicación: cada repo Prisma exige `waUserId` del contexto del bot cuando la consulta es user-scoped.

## 1. `schema.prisma` — fuente de verdad

Archivo en `prisma/schema.prisma` en la raíz del repo. Prisma genera el cliente tipado y las migraciones SQL a partir de aquí. Las secciones SQL más abajo son referencia humana y contienen lo que Prisma no modela bien (índices GIN/trigram, vistas, RPCs, extensiones, triggers).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // En Supabase usar el pooler con: ?pgbouncer=true&connection_limit=1
  // Para RDS / Postgres directo: conexión estándar.
}

// =====================================================================
// ENUMS
// =====================================================================

enum ProcesoTab {
  procedimientos
  anuncios_futuros
  expresiones_interes
  difusion_requerimientos
  orden_compra_servicio
  condiciones_contratacion
}

enum ObjetoContratacion {
  bien
  servicio
  obra
  consultoria_obra
}

enum SubFrequency { hourly daily weekly }   // hourly = "alerta inmediata al detectar" (premium)
enum SubStatus    { active paused expired deleted }
enum UserPlan     { free premium }

enum NotifKind   { search_result subscription_hit file_delivery system_message template }
enum NotifStatus { queued sent delivered read failed }

enum JobStatus   { queued running completed failed dlq }
enum FileOrigin  { seace_repository export_excel ficha_pdf }

// =====================================================================
// CATÁLOGOS
// =====================================================================

model Entity {
  id          String   @id @default(uuid()) @db.Uuid
  ruc         String   @unique @db.VarChar(11)
  nombre      String
  sigla       String?
  tipoDoc     String?  @map("tipo_doc")
  ultimoVisto DateTime @default(now()) @map("ultimo_visto") @db.Timestamptz
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @updatedAt        @map("updated_at") @db.Timestamptz

  processes   Process[]

  @@index([nombre])
  @@index([sigla])
  @@map("entities")
}

// =====================================================================
// DATOS DE SEACE
// =====================================================================

model Process {
  id                String              @id @default(uuid()) @db.Uuid
  tab               ProcesoTab
  nomenclatura      String?
  entityRuc         String?             @map("entity_ruc") @db.VarChar(11)
  entityNombre      String              @map("entity_nombre")
  fechaPublicacion  DateTime?           @map("fecha_publicacion") @db.Timestamptz
  tipoSeleccion     String?             @map("tipo_seleccion")
  tipoSeleccionId   Int?                @map("tipo_seleccion_id")
  objeto            ObjetoContratacion?
  descripcion       String?
  alcance           String?
  cantidad          Decimal?            @db.Decimal
  plazoDias         Int?                @map("plazo_dias")
  fechaAproxConv    DateTime?           @map("fecha_aprox_conv") @db.Date

  codigoSnip        String?             @map("codigo_snip")
  codigoCui         String?             @map("codigo_cui")
  valorReferencial  Decimal?            @map("valor_referencial") @db.Decimal(18, 2)
  moneda            String?
  versionSeace      Int?                @map("version_seace") @db.SmallInt

  nidProceso        String?             @map("nid_proceso")
  nidConvocatoria   String?             @map("nid_convocatoria")  // efímero, no usar como key
  urlRepositorio    String?             @map("url_repositorio")

  contentHash       String              @map("content_hash")
  scrapedAt         DateTime            @default(now()) @map("scraped_at") @db.Timestamptz
  firstSeenAt       DateTime            @default(now()) @map("first_seen_at") @db.Timestamptz
  lastChangedAt     DateTime?           @map("last_changed_at") @db.Timestamptz

  raw               Json?

  createdAt         DateTime            @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime            @updatedAt      @map("updated_at") @db.Timestamptz

  entity            Entity?             @relation(fields: [entityRuc], references: [ruc])
  history           ProcessHistory[]
  subscriptionHits  SubscriptionHit[]
  files             File[]

  @@unique([tab, nomenclatura, versionSeace], name: "tab_nomenclatura_versionSeace")
  @@index([entityRuc])
  @@index([fechaPublicacion(sort: Desc)])
  @@index([objeto])
  @@index([nidProceso])
  @@map("processes")
}

model ProcessHistory {
  id          String   @id @default(uuid()) @db.Uuid
  processId   String   @map("process_id") @db.Uuid
  snapshot    Json
  contentHash String   @map("content_hash")
  observedAt  DateTime @default(now()) @map("observed_at") @db.Timestamptz

  process     Process  @relation(fields: [processId], references: [id], onDelete: Cascade)

  @@index([processId, observedAt(sort: Desc)])
  @@map("process_history")
}

// =====================================================================
// USUARIOS WHATSAPP (sin Supabase Auth)
// =====================================================================

model WaUser {
  id            String   @id @default(uuid()) @db.Uuid
  phoneE164     String   @unique @map("phone_e164") @db.VarChar(20)
  displayName   String?  @map("display_name")
  firstSeenAt   DateTime @default(now()) @map("first_seen_at") @db.Timestamptz
  lastActiveAt  DateTime @default(now()) @map("last_active_at") @db.Timestamptz
  totalMessages BigInt   @default(0) @map("total_messages")
  language      String   @default("es-PE")
  blocked       Boolean  @default(false)
  plan          UserPlan @default(free)
  planExpiresAt DateTime? @map("plan_expires_at") @db.Timestamptz
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt      @map("updated_at") @db.Timestamptz

  subscriptions Subscription[]
  searches      Search[]
  notifications Notification[]
  conversation  Conversation?

  @@index([phoneE164])
  @@map("wa_users")
}

// =====================================================================
// SUSCRIPCIONES Y ALERTAS
// =====================================================================

model Subscription {
  id              String              @id @default(uuid()) @db.Uuid
  userId          String              @map("user_id") @db.Uuid
  tab             ProcesoTab
  entityRuc       String?             @map("entity_ruc") @db.VarChar(11)
  tipoSeleccionIds Int[]              @map("tipo_seleccion_ids")
  objeto          ObjetoContratacion?
  departamento    String?
  keyword         String?
  valorMin        Decimal?            @map("valor_min") @db.Decimal(18, 2)
  valorMax        Decimal?            @map("valor_max") @db.Decimal(18, 2)
  frequency       SubFrequency        @default(daily)
  status          SubStatus           @default(active)
  expiresAt       DateTime?           @map("expires_at") @db.Timestamptz
  lastRunAt       DateTime?           @map("last_run_at") @db.Timestamptz
  lastHitCount    Int                 @default(0) @map("last_hit_count")
  nextRunAt       DateTime?           @map("next_run_at") @db.Timestamptz
  createdAt       DateTime            @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime            @updatedAt      @map("updated_at") @db.Timestamptz

  user            WaUser              @relation(fields: [userId], references: [id], onDelete: Cascade)
  hits            SubscriptionHit[]

  @@index([status, nextRunAt])
  @@index([userId])
  @@map("subscriptions")
}

model SubscriptionHit {
  id              String       @id @default(uuid()) @db.Uuid
  subscriptionId  String       @map("subscription_id") @db.Uuid
  processId       String       @map("process_id") @db.Uuid
  notifiedAt      DateTime?    @map("notified_at") @db.Timestamptz
  notificationId  String?      @map("notification_id") @db.Uuid
  createdAt       DateTime     @default(now()) @map("created_at") @db.Timestamptz

  subscription    Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  process         Process      @relation(fields: [processId], references: [id], onDelete: Cascade)

  @@unique([subscriptionId, processId])
  @@index([subscriptionId, createdAt(sort: Desc)])
  @@map("subscription_hits")
}

// =====================================================================
// HISTORIAL DE BÚSQUEDAS Y NOTIFICACIONES
// =====================================================================

model Search {
  id           String     @id @default(uuid()) @db.Uuid
  userId       String?    @map("user_id") @db.Uuid
  tab          ProcesoTab
  filters      Json
  filtersHash  String?    @map("filters_hash")  // generated column via SQL trigger/migration
  resultCount  Int?       @map("result_count")
  resultIds    String[]   @map("result_ids") @db.Uuid
  source       String     // 'live' | 'cache' | 'cached_db'
  durationMs   Int?       @map("duration_ms")
  error        String?
  createdAt    DateTime   @default(now()) @map("created_at") @db.Timestamptz

  user         WaUser?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt(sort: Desc)])
  @@index([filtersHash, createdAt(sort: Desc)])
  @@map("searches")
}

model Notification {
  id           String       @id @default(uuid()) @db.Uuid
  userId       String       @map("user_id") @db.Uuid
  kind         NotifKind
  payload      Json
  status       NotifStatus  @default(queued)
  kapsoMsgId   String?      @map("kapso_msg_id")
  error        String?
  attempts     Int          @default(0) @db.SmallInt
  createdAt    DateTime     @default(now()) @map("created_at") @db.Timestamptz
  sentAt       DateTime?    @map("sent_at") @db.Timestamptz
  deliveredAt  DateTime?    @map("delivered_at") @db.Timestamptz
  readAt       DateTime?    @map("read_at") @db.Timestamptz

  user         WaUser       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([status, createdAt])
  @@map("notifications")
}

// =====================================================================
// ESTADO CONVERSACIONAL (mirror eventual de Redis)
// =====================================================================

model Conversation {
  userId    String   @id @map("user_id") @db.Uuid
  flow      String?
  step      String?
  filters   Json?
  expiresAt DateTime? @map("expires_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  user      WaUser   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("conversations")
}

// =====================================================================
// OPERACIONAL
// =====================================================================

model ScrapeJob {
  id           String    @id @default(uuid()) @db.Uuid
  jobType      String    @map("job_type")
  payload      Json
  status       JobStatus @default(queued)
  attempts     Int       @default(0) @db.SmallInt
  error        String?
  workerId     String?   @map("worker_id")
  startedAt    DateTime? @map("started_at") @db.Timestamptz
  finishedAt   DateTime? @map("finished_at") @db.Timestamptz
  durationMs   Int?      @map("duration_ms")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz

  @@index([status, createdAt])
  @@index([jobType, createdAt(sort: Desc)])
  @@map("scrape_jobs")
}

model File {
  id           String     @id @default(uuid()) @db.Uuid
  processId    String?    @map("process_id") @db.Uuid
  origin       FileOrigin
  storagePath  String     @map("storage_path")
  sizeBytes    BigInt?    @map("size_bytes")
  mimeType     String?    @map("mime_type")
  originalName String?    @map("original_name")
  sha256       String?
  downloadedAt DateTime   @default(now()) @map("downloaded_at") @db.Timestamptz

  process      Process?   @relation(fields: [processId], references: [id], onDelete: Cascade)

  @@unique([processId, origin, originalName])
  @@index([processId])
  @@map("files")
}
```

### Notas sobre el mapeo

- **Naming**: el dominio en TS usa `camelCase` (`waUserId`, `entityRuc`, `fechaPublicacion`). El SQL subyacente usa `snake_case` vía `@map`/`@@map`. Prisma se encarga de la traducción.
- **Búsqueda full-text + trigram**: Prisma no modela índices GIN trigram. El SQL de la sección 4 los crea con migraciones manuales (`CREATE INDEX ... USING gin (... gin_trgm_ops)`) que viven en `prisma/migrations/<timestamp>_add_trgm_indexes/migration.sql`.
- **`filters_hash` como columna generada**: Prisma no soporta columnas `GENERATED ALWAYS AS ... STORED` nativamente. Se aplica vía migración manual (ver SQL más abajo) y el campo se declara como `String?` en Prisma.
- **Sin RLS**: ningún `@@policy` ni `@@security` — Prisma conecta con un rol Postgres dedicado que tiene los privilegios necesarios.
- **Generación**: `prisma generate` produce `node_modules/@prisma/client` con los tipos. En NestJS se inyecta vía `PrismaService extends PrismaClient`.

## 2. Extensiones requeridas

```sql
create extension if not exists "pgcrypto";       -- gen_random_uuid
create extension if not exists "pg_trgm";        -- búsqueda textual ILIKE rápida
create extension if not exists "btree_gin";      -- índices compuestos
-- pgvector: opcional para futuras búsquedas semánticas de descripciones
create extension if not exists "vector";
```

## 3. Trigger genérico de updated_at

```sql
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
```

(Se aplica como `before update` en cada tabla.)

## 4. Tablas (referencia SQL canónica generada por Prisma)

### 3.1 `entities` — Entidades del Estado peruano

Catálogo poblado on-demand al resolver entidades vía modal de SEACE. Sirve para autocompletar nombres.

```sql
create table entities (
  id            uuid primary key default gen_random_uuid(),
  ruc           varchar(11) unique not null,
  nombre        text not null,
  sigla         text,
  tipo_doc      text,                       -- "RUC", "DNI" (rara vez)
  ultimo_visto  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index entities_nombre_trgm on entities using gin (nombre gin_trgm_ops);
create index entities_sigla_trgm  on entities using gin (sigla gin_trgm_ops);

create trigger trg_entities_updated_at before update on entities
  for each row execute function set_updated_at();
```

Sin RLS (el único cliente que toca esta tabla es el backend vía Prisma con credenciales completas).

### 3.2 `processes` — Procesos de selección scrapeados

```sql
create type proceso_tab as enum (
  'procedimientos',
  'anuncios_futuros',
  'expresiones_interes',
  'difusion_requerimientos',
  'orden_compra_servicio',
  'condiciones_contratacion'
);

create type objeto_contratacion as enum (
  'bien', 'servicio', 'obra', 'consultoria_obra'
);

create table processes (
  id                  uuid primary key default gen_random_uuid(),
  tab                 proceso_tab not null,
  
  nomenclatura        text,                       -- LP-ABR-1-2026-MDY/CS-1 (puede repetirse entre versiones; ver tab+nomenclatura+version)
  entity_ruc          varchar(11) references entities(ruc),
  entity_nombre       text not null,              -- snapshot, por si la entidad cambia de nombre

  fecha_publicacion   timestamptz,
  tipo_seleccion      text,
  tipo_seleccion_id   int,                        -- el value del select (ej. 790)
  objeto              objeto_contratacion,
  descripcion         text,
  alcance             text,
  cantidad            numeric,
  plazo_dias          int,
  fecha_aprox_conv    date,

  codigo_snip         text,
  codigo_cui          text,                       -- código único de inversión
  valor_referencial   numeric(18,2),
  moneda              text,
  version_seace       smallint check (version_seace in (2,3)),

  nid_proceso         text,                       -- ID interno SEACE (estable entre sesiones)
  nid_convocatoria    text,                       -- token cifrado (efímero, no usar como key)

  url_repositorio     text,                       -- URL de bases / archivos

  content_hash        text not null,              -- sha256(JSON(filas_relevantes)), para detección de cambios
  scraped_at          timestamptz not null default now(),
  first_seen_at       timestamptz not null default now(),
  last_changed_at     timestamptz,
  
  raw                 jsonb,                      -- payload completo parseado (para retro-compatibilidad si cambia el schema)
  
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (tab, nomenclatura, version_seace)
);

create index processes_entity_ruc       on processes (entity_ruc);
create index processes_fecha_publicacion on processes (fecha_publicacion desc);
create index processes_objeto           on processes (objeto);
create index processes_descripcion_trgm on processes using gin (descripcion gin_trgm_ops);
create index processes_raw_gin          on processes using gin (raw);
create index processes_nid_proceso      on processes (nid_proceso);

create trigger trg_processes_updated_at before update on processes
  for each row execute function set_updated_at();
```

Sin RLS. La lectura va siempre vía el backend; el bot decide qué procesos mostrar a cada usuario.

### 3.3 `process_history` — Versionado opcional

Cuando `content_hash` cambia, se inserta el estado anterior aquí. Permite responder "¿qué cambió en este proceso?".

```sql
create table process_history (
  id          uuid primary key default gen_random_uuid(),
  process_id  uuid not null references processes(id) on delete cascade,
  snapshot    jsonb not null,
  content_hash text not null,
  observed_at timestamptz not null default now()
);

create index process_history_pid on process_history (process_id, observed_at desc);
```

Política de retención: cron mensual borra entries >180 días.

### 3.4 `wa_users` — Usuarios del bot (WhatsApp)

Tabla standalone. La identidad es el número de teléfono E.164 que provee Meta — no hay `auth.users`, no hay JWT, no hay login. El bot resuelve el `wa_users.id` interno a partir del `from` que llega en el webhook.

```sql
create table wa_users (
  id              uuid primary key default gen_random_uuid(),
  phone_e164      varchar(20) unique not null,           -- "+51999111222"
  display_name    text,                                   -- opcional, lo que el usuario pone
  first_seen_at   timestamptz not null default now(),
  last_active_at  timestamptz not null default now(),
  total_messages  bigint not null default 0,
  language        text not null default 'es-PE',
  blocked         boolean not null default false,
  plan            user_plan not null default 'free',     -- tier SaaS: free | premium
  plan_expires_at timestamptz,                           -- fin del premium; NULL = sin vencimiento
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index wa_users_phone on wa_users (phone_e164);

create trigger trg_wa_users_updated_at before update on wa_users
  for each row execute function set_updated_at();
```

Autorización: en aplicación. El bot, al recibir un webhook de Kapso/Meta, hace `upsert wa_users by phone_e164`, obtiene el `id`, y todo repo subsiguiente exige ese `waUserId` como parámetro de las consultas user-scoped. No hay RLS porque no hay rol no-confiable tocando la DB.

### 3.5 `subscriptions` — Alertas configuradas por el usuario

```sql
create type sub_frequency as enum ('hourly', 'daily', 'weekly');
-- hourly = "alerta inmediata al detectar" (premium); copy: nunca "tiempo real"
create type sub_status as enum ('active', 'paused', 'expired', 'deleted');
-- expired: la marca el job de expiración cuando expires_at < now()

create table subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references wa_users(id) on delete cascade,
  
  -- Filtros (NULL = sin filtrar por ese eje)
  tab           proceso_tab not null,
  entity_ruc    varchar(11),
  tipo_seleccion_ids int[],
  objeto        objeto_contratacion,
  departamento  text,
  keyword       text,
  valor_min     numeric(18,2),
  valor_max     numeric(18,2),
  
  frequency     sub_frequency not null default 'daily',
  status        sub_status not null default 'active',
  expires_at    timestamptz,                      -- vigencia de la alerta; NULL = indefinida (premium)
  
  last_run_at   timestamptz,
  last_hit_count int not null default 0,
  next_run_at   timestamptz,
  
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index subscriptions_next_run on subscriptions (status, next_run_at) where status = 'active';
create index subscriptions_user on subscriptions (user_id);

create trigger trg_subs_updated_at before update on subscriptions
  for each row execute function set_updated_at();
```

Sin RLS. Filtrado por `user_id` en aplicación: cada query del repo Prisma exige el `waUserId` del contexto del bot.

### 3.6 `subscription_hits` — Histórico de match de una suscripción

```sql
create table subscription_hits (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  process_id      uuid not null references processes(id) on delete cascade,
  notified_at     timestamptz,                    -- null si aún no se mandó al user
  notification_id uuid,                            -- referencia al mensaje enviado, ver tabla notifications
  created_at      timestamptz not null default now(),
  
  unique (subscription_id, process_id)
);

create index sub_hits_sub on subscription_hits (subscription_id, created_at desc);
create index sub_hits_pending on subscription_hits (subscription_id) where notified_at is null;
```

Sin RLS. Acceso siempre vía join con `subscriptions.user_id` en el repo Prisma.

### 3.7 `searches` — Historial de búsquedas (analítica + caché secundaria)

```sql
create table searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references wa_users(id) on delete set null,
  tab           proceso_tab not null,
  filters       jsonb not null,
  filters_hash  text generated always as (encode(digest(filters::text, 'sha256'), 'hex')) stored,
  result_count  int,
  result_ids    uuid[],
  source        text not null,                    -- 'live', 'cache', 'cached_db'
  duration_ms   int,
  error         text,
  created_at    timestamptz not null default now()
);

create index searches_user_time on searches (user_id, created_at desc);
create index searches_hash on searches (filters_hash, created_at desc);
create index searches_filters_gin on searches using gin (filters);
```

Sin RLS. La lectura de historial por usuario se hace siempre con `where: { userId: ctx.user.id }` en el repo Prisma.

### 3.8 `notifications` — Mensajes salientes a WhatsApp

```sql
create type notif_kind as enum (
  'search_result', 'subscription_hit', 'file_delivery', 'system_message', 'template'
);
create type notif_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references wa_users(id) on delete cascade,
  kind          notif_kind not null,
  payload       jsonb not null,
  status        notif_status not null default 'queued',
  kapso_msg_id  text,                              -- ID que devuelve Kapso al enviar
  error         text,
  attempts      smallint not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz
);

create index notif_user_time on notifications (user_id, created_at desc);
create index notif_pending on notifications (status, created_at) where status in ('queued','failed');
```

Sin RLS. Filtrado por `user_id` en aplicación.

### 3.9 `conversations` — Estado conversacional ligero (mirror de Redis)

Solo se persiste cuando una conversación termina o pasa más de 6h, para recuperar contexto en caso de Redis flush.

```sql
create table conversations (
  user_id       uuid primary key references wa_users(id) on delete cascade,
  flow          text,
  step          text,
  filters       jsonb,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);
```

Sin RLS. Solo el backend toca esta tabla (mirror eventual de Redis).

### 3.10 `scrape_jobs` — Auditoría de jobs ejecutados

```sql
create type job_status as enum ('queued', 'running', 'completed', 'failed', 'dlq');

create table scrape_jobs (
  id            uuid primary key default gen_random_uuid(),
  job_type      text not null,                    -- 'search', 'subscription_run', 'ficha_detail', 'export_excel'
  payload       jsonb not null,
  status        job_status not null default 'queued',
  attempts      smallint not null default 0,
  error         text,
  worker_id     text,
  started_at    timestamptz,
  finished_at   timestamptz,
  duration_ms   int,
  created_at    timestamptz not null default now()
);

create index scrape_jobs_status on scrape_jobs (status, created_at);
create index scrape_jobs_type on scrape_jobs (job_type, created_at desc);
```

Sin RLS. Tabla operacional, no expuesta a usuarios.

### 3.11 `files` — Archivos descargados (bases, actas, etc.)

```sql
create type file_origin as enum ('seace_repository', 'export_excel', 'ficha_pdf');

create table files (
  id            uuid primary key default gen_random_uuid(),
  process_id    uuid references processes(id) on delete cascade,
  origin        file_origin not null,
  storage_path  text not null,                    -- bucket/key
  size_bytes    bigint,
  mime_type     text,
  original_name text,
  sha256        text,
  downloaded_at timestamptz not null default now(),
  
  unique (process_id, origin, original_name)
);

create index files_process on files (process_id);
```

Sin RLS en la tabla. Las URLs firmadas que se generan para que WhatsApp descargue archivos vienen de Supabase Storage (si se activa), pero la metadata vive en Postgres bajo control del backend.

Storage bucket (si se activa `adapters/storage/supabase-storage/`): `seace-files`, privado. El backend genera signed URLs con TTL corto vía `@supabase/supabase-js` cuando el bot necesita entregar un archivo.

## 5. Vistas útiles

### 4.1 Procesos recientes por entidad (para suscripciones de tipo "entidad X")

```sql
create or replace view v_processes_recent_by_entity as
select 
  entity_ruc,
  entity_nombre,
  count(*) filter (where fecha_publicacion > now() - interval '7 days') as last_7d,
  count(*) filter (where fecha_publicacion > now() - interval '30 days') as last_30d,
  max(fecha_publicacion) as ultimo,
  array_agg(id order by fecha_publicacion desc) filter (where fecha_publicacion > now() - interval '7 days') as ids_recientes
from processes
where entity_ruc is not null
group by entity_ruc, entity_nombre;
```

### 4.2 Suscripciones que necesitan correr ahora

```sql
create or replace view v_subs_due as
select * from subscriptions
where status = 'active'
  and (next_run_at is null or next_run_at <= now());
```

El scheduler corre `select * from v_subs_due limit 50` cada minuto y encola jobs en BullMQ.

## 6. Funciones RPC (opcionales — Prisma puede llamarlas via `$queryRaw` o `prisma.$executeRaw`)

### 5.1 `bot_upsert_process()` — el worker llama esto en lugar de SQL crudo

```sql
create or replace function bot_upsert_process(p jsonb)
returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
  v_hash text;
  v_existing_hash text;
begin
  v_hash := encode(digest(p::text, 'sha256'), 'hex');
  
  select id, content_hash into v_id, v_existing_hash
  from processes
  where tab = (p->>'tab')::proceso_tab
    and nomenclatura = p->>'nomenclatura'
    and version_seace = (p->>'version_seace')::smallint;
  
  if v_id is null then
    insert into processes (
      tab, nomenclatura, entity_ruc, entity_nombre, fecha_publicacion,
      tipo_seleccion, objeto, descripcion, valor_referencial, moneda,
      version_seace, nid_proceso, nid_convocatoria, raw, content_hash
    )
    values (
      (p->>'tab')::proceso_tab, p->>'nomenclatura', p->>'entity_ruc', p->>'entity_nombre',
      (p->>'fecha_publicacion')::timestamptz,
      p->>'tipo_seleccion', (p->>'objeto')::objeto_contratacion,
      p->>'descripcion', (p->>'valor_referencial')::numeric,
      p->>'moneda', (p->>'version_seace')::smallint,
      p->>'nid_proceso', p->>'nid_convocatoria',
      p, v_hash
    )
    returning id into v_id;
  elsif v_existing_hash <> v_hash then
    insert into process_history (process_id, snapshot, content_hash)
    select v_id, raw, content_hash from processes where id = v_id;
    update processes set
      raw = p, content_hash = v_hash, last_changed_at = now(),
      scraped_at = now()
    where id = v_id;
  else
    update processes set scraped_at = now() where id = v_id;
  end if;
  return v_id;
end $$;
```

### 5.2 `bot_search_cached()` — consulta caché si existe búsqueda reciente

```sql
create or replace function bot_search_cached(p_tab proceso_tab, p_filters jsonb, p_max_age interval)
returns table (process_ids uuid[], cached_at timestamptz) language sql stable as $$
  select result_ids, created_at
  from searches
  where tab = p_tab
    and filters_hash = encode(digest(p_filters::text, 'sha256'), 'hex')
    and created_at > now() - p_max_age
    and source = 'live'
  order by created_at desc
  limit 1;
$$;
```

## 7. Estimación de tamaño y políticas de retención

| Tabla | Filas mes 6 | Política |
|---|---|---|
| `processes` | ~50,000 | Sin TTL (datos del Estado) |
| `process_history` | ~10,000 | Borrar >180 días |
| `searches` | ~200,000 | Borrar >90 días si user_id null |
| `notifications` | ~100,000 | Borrar status=`read` >60 días |
| `scrape_jobs` | ~500,000 | Borrar status=`completed` >14 días |
| `wa_users` | ~5,000 | Sin TTL |
| `subscriptions` | ~10,000 | Sin TTL, status=`deleted` purge >30 días |

Cron mensual (`pg_cron` o función Edge):

```sql
delete from process_history where observed_at < now() - interval '180 days';
delete from searches        where created_at  < now() - interval '90 days' and user_id is null;
delete from notifications   where status = 'read' and read_at < now() - interval '60 days';
delete from scrape_jobs     where status = 'completed' and finished_at < now() - interval '14 days';
delete from subscriptions   where status = 'deleted' and updated_at < now() - interval '30 days';
```

## 8. Alta de usuarios WhatsApp (sin Supabase Auth)

Flujo simple sin JWT ni login:

```
1. Llega un mensaje al webhook de Kapso/Meta con from='+51999111222'
2. NestJS resuelve el wa_users.id internamente:
   waUser = await prisma.waUser.upsert({
     where:  { phoneE164: '+51999111222' },
     create: { phoneE164: '+51999111222' },
     update: { lastActiveAt: new Date(), totalMessages: { increment: 1 } }
   })
3. Ese waUser.id se inyecta como ctx.waUserId en toda la cadena (conversación,
   búsquedas, suscripciones)
4. Cada repo Prisma que toca datos user-scoped exige waUserId como argumento
```

No hay autenticación porque Meta ya verificó el número antes de que el mensaje nos llegue. La superficie de ataque es WhatsApp mismo, no nuestra DB.

## 9. Backup y migraciones

- **Migraciones con `prisma migrate`**: fuente de verdad = `prisma/schema.prisma`. Comandos:
  - Dev: `prisma migrate dev --name <descr>` genera y aplica migración local.
  - Prod (Railway): `prisma migrate deploy` en el start command del API service.
- Supabase Cloud incluye backups diarios 7 días en Pro.
- Para MVP free, snapshot manual semanal (`pg_dump $DATABASE_URL`) a S3 propio.
- Cambio de host (Supabase → RDS o local): cambiar `DATABASE_URL`, correr `prisma migrate deploy`, fin.

## 10. Esquema mínimo de inicio (MVP)

Si hay que arrancar en 1 sprint, lo mínimo es:

1. `entities`
2. `processes`
3. `wa_users`
4. `subscriptions`
5. `notifications`
6. `searches`

El resto (process_history, files, conversations, scrape_jobs) se añade en iteraciones 2-3.