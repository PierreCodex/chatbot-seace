# 02 · Arquitectura del sistema

## Stack confirmado

| Capa | Tecnología | Por qué |
|---|---|---|
| Mensajería | WhatsApp Business Platform (Meta Cloud API) vía **Kapso** | Kapso abstrae botones, listas, flows, plantillas y maneja la cola entrante de Meta. Evita lidiar con tokens de webhook ni el ciclo de moderación de plantillas. |
| API / orquestación | **NestJS** (TypeScript) | Módulos, DI, fácil de testear, soporta Bull/BullMQ nativamente. |
| Cola y caché | **Redis 7** + **BullMQ** | BullMQ tiene jobs delayed, repeatables (cron), priorities, rate-limit por queue — todo lo que necesitamos. |
| Scraper | **Worker Node separado** con `playwright-extra` + `puppeteer-extra-plugin-stealth` | Aislamiento: si el navegador crashea no tumba la API. Permite escalar horizontalmente. |
| Base de datos | **Supabase Postgres** | RLS para multi-tenant, Edge Functions opcionales, realtime para futuro panel admin. |
| Auth de usuarios WhatsApp | **Supabase Auth** con phone provider (passwordless via OTP) | Aunque WhatsApp ya autentica al usuario por su número, usamos Supabase Auth para emitir JWTs y poder reutilizar RLS sin un rol superuser en el backend. |
| Almacenamiento de archivos | **Supabase Storage** | Bases de licitación, Excel exportado, fichas en PDF. Bucket privado con URLs firmadas para WhatsApp. |
| Observabilidad | OpenTelemetry → Grafana Cloud (free tier) o Logflare | Trazas end-to-end del job de scraping. |

## Diagrama de componentes

```
┌──────────────┐       ┌────────────────┐
│  Usuario WA  │──────▶│ Meta Cloud API │
└──────────────┘       └────────┬───────┘
                                │ webhook
                                ▼
                       ┌────────────────┐
                       │      Kapso     │  (botones, listas, flows, plantillas)
                       └────────┬───────┘
                                │ HTTPS POST (webhook reenviado)
                                ▼
        ┌───────────────────────────────────────────────┐
        │                  NestJS API                   │
        │  ┌─────────────┐ ┌──────────────┐ ┌────────┐  │
        │  │ Conversation│ │ Search/Query │ │ Cache  │  │
        │  │   Module    │ │   Module     │ │ Module │  │
        │  └──────┬──────┘ └──────┬───────┘ └───┬────┘  │
        │         │               │             │       │
        │         └────────┬──────┴─────────────┘       │
        └──────────────────┼────────────────────────────┘
                           │                ▲
                  enqueue  │                │  job result events
                           ▼                │
                  ┌────────────────────────────┐
                  │  Redis (BullMQ queues +    │
                  │  result cache TTL)         │
                  └────────┬───────────────────┘
                           │ pop job
                           ▼
        ┌───────────────────────────────────────────────┐
        │   Scraper Worker (Node + Playwright Stealth)  │
        │  ┌──────────────────┐  ┌──────────────────┐   │
        │  │ Session Pool     │  │ Tab Adapters     │   │
        │  │ (cookies, view-  │  │ (Procedimientos, │   │
        │  │  state, slots)   │  │  OCOS, ACF, ...) │   │
        │  └──────────────────┘  └──────────────────┘   │
        └────────┬──────────────────────────┬───────────┘
                 │ resultados parseados     │ archivos descargados
                 ▼                          ▼
        ┌──────────────────┐     ┌──────────────────┐
        │ Supabase Postgres│     │ Supabase Storage │
        │  (RLS habilitado)│     │  (signed URLs)   │
        └──────────────────┘     └──────────────────┘
                 ▲
                 │ cron triggers (4×/día)
                 │
        ┌─────────────────────────────────────────┐
        │ Scheduler (en NestJS)                   │
        │  • Calcula scope dinámico:              │
        │      suscripciones activas + top-N      │
        │      búsquedas frecuentes (searches)    │
        │  • Encola jobs "crawl:<scope>" a BullMQ │
        │  • Recorre subscription_hits pendientes │
        │    y encola notificaciones              │
        └─────────────────────────────────────────┘
```

> **Triple disparador del Worker**: (1) `search:on-demand` desde la API cuando el usuario pide algo no cacheado, (2) `crawl:scheduled` desde el Scheduler 4 veces al día con scope dirigido por demanda, (3) `ficha:detail` puntual cuando alguien abre una ficha. El pool de sesiones es compartido entre los tres tipos de job, con prioridad alta para on-demand.

## Flujos críticos

### Flujo 1: consulta interactiva del usuario (DB-first)

```
WhatsApp ─▶ Kapso ─▶ NestJS /webhook
   1. NestJS parsea mensaje + recupera sesión conversacional desde Redis
   2. ¿La consulta resuelve contra Supabase? (procesos ya scrapeados
      cuya antigüedad < umbral_de_frescura)
        a. SÍ  → responde con datos de DB en <1s. Fin.
        b. NO  → continúa
   3. ¿Cache de Redis (búsqueda idéntica <15min)? → responde inmediato
   4. Si no, crea job BullMQ "search:on-demand" con prioridad alta
   5. Responde al usuario en <2s: "🔎 Buscando en tiempo real..." + typing
   6. Worker toma el job:
      a. Reserva slot de sesión Playwright (pool reutilizable)
      b. Si la sesión está viva, navega; si no, abre nueva
      c. Ejecuta búsqueda, parsea resultados
      d. Persiste en supabase.processes (upsert por idempotencia)
         → la próxima búsqueda igual ya queda servida por DB
      e. Publica resultado a Redis pub/sub
   7. NestJS escucha pub/sub, formatea mensaje y lo envía vía Kapso
```

**Umbral de frescura por tipo de búsqueda** (configurable):
- Suscripciones / búsquedas top-N (ya en scope del crawler) → 6 horas
- Búsquedas fuera de scope que ya se persistieron en algún momento → 24 horas
- Si el dato es más viejo que el umbral, se vuelve a scrapear y refrescar.

**Tiempo objetivo end-to-end**:
- DB-hit: <1s (>50% del tráfico esperado una vez el crawler tenga 1-2 semanas de datos)
- Cache Redis hit: <1s
- On-demand miss: 3-8s sincronos o asíncronos con heartbeat (ver Flujo 2)

### Flujo 2: respuesta asíncrona (lo que evita "el usuario espera con el chat abierto")

WhatsApp permite enviar mensajes hasta **24h después** del último mensaje del usuario sin necesidad de plantilla aprobada. Eso nos da un colchón enorme:

- Si el scraping tarda más de N segundos (umbral 8s), NestJS envía un mensaje intermedio: *"Esto está tomando más de lo habitual. Te aviso aquí mismo apenas tenga los resultados (1-3 min)."*
- El usuario cierra WhatsApp y se va. El job sigue en BullMQ.
- Cuando termina, NestJS empuja el resultado a la conversación. WhatsApp se encarga de notificar al usuario con badge.

Esto se sostiene en que **no necesitamos respuesta sincrónica**: el chat es naturalmente asíncrono.

### Flujo 3: crawler programado (scope dirigido por demanda)

El Scheduler en NestJS corre **4 veces al día** vía `@nestjs/schedule` (cron):

```
Cron: 0 6 * * *   (6 am hora Perú)
Cron: 0 12 * * *  (12 m)
Cron: 0 18 * * *  (6 pm)
Cron: 0 2 * * *   (2 am, ventana nocturna)
```

En cada disparo:

```
1. Computar scope dinámico
   a. Subscripciones activas (status='active', distintas por entity_ruc/keyword/objeto)
   b. Top-N de la tabla `searches` (filtros con mayor count en últimos 30 días, N≈20)
   c. Deduplicar: si una suscripción y una búsqueda coinciden, 1 sólo scrape
2. Encolar 1 job "crawl:scheduled" por scope-item (con concurrency limit 2 en BullMQ)
3. Worker procesa cada job:
   a. Aplica filtros del scope-item al adapter correspondiente
   b. Prefiere Excel-export si resultados >50; HTML parse si menos
   c. Upsert en supabase.processes con content_hash
   d. Si hay cambios reales (insert o update con hash distinto) y el scope-item
      vino de una suscripción → inserta filas en subscription_hits con notified_at=null
4. Después de procesar todos los jobs, el Scheduler:
   a. Lee subscription_hits con notified_at IS NULL
   b. Agrupa por user_id (para mandar 1 mensaje por usuario con todos los hits)
   c. Encola notifications.status='queued'
   d. NestJS las envía vía Kapso (plantilla UTILITY si >24h del último msg)
   e. Marca subscription_hits.notified_at = now()
```

**Detalles clave:**
- Nunca se hace un scrape "global" sin filtros. Si no hay suscripciones ni búsquedas frecuentes, no se scrapea nada esa corrida.
- `content_hash` (en `processes`) garantiza que sólo los procesos nuevos o modificados generen `subscription_hits`. No hay re-emisiones.
- Si una suscripción nunca matcheó nada en N corridas, se reduce su frecuencia en el scheduler (back-off) para no consumir recursos.

### Flujo 4: fallback on-demand con persistencia

Cuando el usuario busca **fuera del scope crawleado** (entidad nueva, palabra clave inusual):

```
1. Bot responde: "🔎 Buscando en tiempo real..."
2. Worker corre search:on-demand
3. Persiste resultados en supabase.processes
4. La próxima búsqueda igual ya se sirve desde DB (Flujo 1, paso 2.a)
5. Si la misma búsqueda se repite >M veces (M≈3) en 30 días, el Scheduler
   la incorpora automáticamente al scope del crawler programado en la próxima corrida
```

Esto significa que **el corpus de la DB crece orgánicamente con el uso**: las búsquedas más demandadas terminan en el scope programado sin intervención manual.

### Día 0 — tolerancia a DB vacía

La primera semana de operación, el bot funciona en modo **100% on-demand**:
- El paso 2.a del Flujo 1 nunca da hit (DB vacía o casi).
- Cada búsqueda dispara un scrape y persiste.
- El crawler programado corre desde el día 1 pero solo cubre el corto scope inicial (las primeras suscripciones que los usuarios vayan creando).

Reglas para que el bot no se rompa:
- Ninguna consulta SQL asume `count > 0`. Vistas con `LEFT JOIN` y `COALESCE(..., 0)`.
- Si una suscripción nunca tiene `subscription_hits`, se muestra "Aún sin coincidencias" en lugar de error.
- El UX de "buscando en tiempo real" es siempre el fallback, no un caso de error.

## Decisiones clave

### D1. Scraping híbrido: programado dirigido por demanda + on-demand con persistencia

**Decisión**: el sistema corre **dos modos de scraping** que se complementan:

1. **Crawler programado** que corre 4 veces al día (6h/12h/18h hora Perú + 2am nocturno) y cubre **únicamente lo que está siendo demandado**:
   - Suscripciones activas de usuarios reales
   - Top-N (~20) filtros de la tabla `searches` con mayor frecuencia en últimos 30 días
   - **Nunca** un batch global sin filtros
2. **On-demand** cuando el usuario pide algo fuera del scope crawleado: el worker scrapea sincronicamente, devuelve el resultado y **persiste en DB** para servirlo desde caché la próxima vez.

**El bot siempre consulta Supabase primero**. Si encuentra datos cuya antigüedad < umbral de frescura, los devuelve en <1s. Solo si no hay nada (o está stale) cae al on-demand.

**Razones**:
- Sub-segundo de latencia para la mayoría de búsquedas una vez el corpus tiene 1-2 semanas de tráfico.
- Suscripciones fiables: el aviso al usuario ya tiene la data en DB, no depende del éxito del scrape en ese instante.
- Carga distribuida en el tiempo en lugar de picos por uso → menos pelea con reCAPTCHA.
- El corpus crece **orgánicamente con el uso**: lo que la gente busca repetidamente termina en el scope programado.
- Día 0 con DB vacía es operable: el bot cae al modo on-demand sin romperse.

**Anti-patrón explícito**: nunca scrapear "todos los procesos publicados hoy" sin filtro de entidad u objeto. SEACE publica cientos por día; un scrape global agresivo agotaría reCAPTCHA score en horas.

**Trigger automático del scope**: si una misma búsqueda on-demand se repite >3 veces en 30 días, el Scheduler la promueve automáticamente al scope crawleado en la siguiente corrida. No requiere intervención manual.

### D2. Pool de sesiones Playwright (no abrir/cerrar por request)

**Decisión**: el worker mantiene navegador(es) ya autenticados (cookies + JSESSIONID válidos), los reutiliza durante 25 min (antes de que JSF marque ViewExpired), y los recicla.

**Por qué**: levantar Chromium es caro (~3-5s) y reCAPTCHA penaliza sesiones nuevas.

**Modelo de pool — versión MVP (1-2 usuarios, 5-10 jobs/día)**:
- **1 sólo browser persistente** + 1 contexto por job (creado/destruido al inicio/final de cada scrape)
- BullMQ concurrency = 1 (los jobs se procesan en serie; 5-10 jobs/día no compiten)
- RAM esperada: 400-600 MB en idle, picos de ~1 GB durante scrape
- Health-check: si el contexto devuelve `ViewExpiredException`, se descarta y se crea uno nuevo dentro del mismo browser. Si el browser cae, se relanza al recibir el siguiente job.

**Modelo de pool — crecimiento (>10 usuarios o >50 jobs/día)**:
- 3-5 contextos persistentes al inicio
- BullMQ concurrency = N (uno por slot)
- Promoción a este modelo cuando se observe cola creciendo en BullMQ (`waiting > 5` sostenido).

### D3. Excel como fast path para volumen

**Decisión**: si la consulta produce >50 resultados, el worker pulsa **Exportar a Excel**, parsea con `exceljs`, y devuelve el dataset. Si <50, parsea la tabla HTML.

**Por qué**: 1 descarga vs 50/15 = 4 páginas de scraping. Menos clicks, menos score de bot.

**Caveat**: pendiente validar que el Excel incluya los `nidProceso` para poder linkear a la ficha. Si no, el usuario solo tendrá resumen (entidad, fecha, monto, nomenclatura) y un botón "Ver más" que dispare un scrape puntual de esa fila.

### D4. Conversación stateful en Redis (no en Postgres)

**Decisión**: el estado de la conversación (en qué paso del flujo está, qué filtros eligió) vive en Redis con TTL 30 min.

**Por qué**:
- Es efímero. No necesitamos historial conversacional persistente.
- Reduce latencia: cada vuelta del usuario lee/escribe 1 hash.
- Si se pierde, el bot retoma desde el menú principal — UX aceptable.

Estructura: `conv:{userPhone}` → hash con `{ flow, step, filters, expiresAt }`.

### D5. Kapso como abstracción de Meta

Kapso maneja:
- Plantillas (creación, aprobación, versionado)
- Flows interactivos (componentes nativos de Meta)
- Cola de reintentos si el send a Meta falla
- Webhooks unificados (no hay que distinguir entre status updates, mensajes, button replies)

NestJS habla con Kapso vía HTTP/SDK; no toca Meta directamente. Si Kapso cae, la API queda parcialmente disponible (Redis y BD operan) pero no llegan/salen mensajes.

### D6. Idempotencia del upsert

Cada proceso de SEACE tiene **nomenclatura única** (`LP-ABR-1-2026-MDY/CS-1`) que sirve como clave natural. El worker hace `INSERT ... ON CONFLICT (nomenclatura) DO UPDATE SET datos_actualizados=now(), ...`. Esto permite re-scrapear sin duplicar y detectar cambios (versionado opcional con tabla `process_history`).

## Manejo de latencia JSF — el problema real

El sitio JSF puede tardar 3-15s en responder una búsqueda (incluso 30s+ con filtros amplios). El chat de WhatsApp no tolera 30s de silencio sin que el usuario piense que el bot murió. Estrategia:

1. **Acuse de recibo inmediato** (<2s): mensaje "🔎 Buscando..." con typing indicator de Kapso.
2. **Heartbeat condicional**: si pasados 8s no hay resultado, mensaje "Esto está tardando, sigo trabajando..."
3. **Resultado o fallback**: cuando termina, mensaje formateado. Si timeout (>60s) o error, mensaje de disculpa + botón "Reintentar".
4. **Operación off-the-shelf**: para suscripciones (no interactivas) la latencia no importa.

El usuario percibe el chat como asíncrono. La clave de UX es **darle feedback temprano**, no minimizar el tiempo total.

## Despliegue propuesto

| Componente | Servicio | Razón |
|---|---|---|
| API NestJS | **Railway Hobby** ($5/mes base) — servicio separado del worker | Webhook HTTPS, SSL gratis, deploy desde Docker. Hobby alcanza con 1-2 usuarios. |
| Worker Playwright | **Railway Hobby** — segundo servicio en el mismo proyecto, imagen base `mcr.microsoft.com/playwright:v1.49.0-jammy` | Chromium + libs preinstalados. RAM estimada 400-600MB con 1 browser + contexto por job. |
| Redis | **Upstash Redis** (serverless, free tier 10k req/día) | Externo a Railway: la TTL y el throughput de BullMQ caben holgadamente en el free. Costo $0 en MVP. |
| DB | **Supabase Cloud** free tier (externo) | 500MB DB + 1GB storage. Migrar a Pro ($25) cuando se llene. |
| Storage de archivos | **Supabase Storage** (mismo proyecto Supabase) | Bases en PDF, Excel exportado. |
| Kapso | Cloud de Kapso | SaaS gestionado |

**Presupuesto MVP confirmado**: ~$6-8/mes total (Railway Hobby $5 + uso esperado $1-3, Upstash y Supabase en free). Si la factura de Railway empieza a crecer >$15/mes sostenido, evaluar Pro ($20 con cap) o migrar el worker a un VPS dedicado.

**Deploy desde monorepo Docker**: dos servicios Railway leen del mismo repo. La diferencia es el `Dockerfile` (o el `start command` en `railway.json`) y las variables de entorno (`SERVICE=api` vs `SERVICE=worker`). El worker NO expone HTTP público; solo un endpoint interno `/health` para que Railway no lo reinicie a media tarea.

**Limpieza de filesystem en worker**: `/tmp` tiene 1GB efímero en Hobby. Cada job que descargue Excel/PDF debe borrar el archivo al terminar (después de subirlo a Supabase Storage si aplica).

## Diagrama de mensajes (secuencia para una búsqueda)

```
Usuario  Kapso   NestJS  Redis    Worker   SEACE   Supabase
  │       │       │       │        │         │        │
  │──msg──▶│       │       │        │         │        │
  │       │──post─▶│       │        │         │        │
  │       │       │─get(conv)──────▶│        │         │
  │       │       │◀────────────────│        │         │
  │       │       │─enqueue(search)─▶│       │         │
  │       │◀ack───│       │        │         │        │
  │◀━typing━━━━━━━│       │        │         │        │
  │       │       │       │◀pop────│        │         │
  │       │       │       │        │──POST──▶│        │
  │       │       │       │        │◀──XML──│         │
  │       │       │       │        │ parse  │         │
  │       │       │       │        │────────upsert────▶│
  │       │       │       │◀result─│        │         │
  │       │       │◀publish───────│        │         │
  │       │◀send──│       │        │         │        │
  │◀msg━━━│       │       │        │         │        │
```

## Riesgos arquitecturales y mitigación

| Riesgo | Mitigación |
|---|---|
| SEACE cambia IDs JSF en deploy | Tab Adapters localizan campos por label, no ID hardcodeado. Tests E2E semanales contra prod. |
| reCAPTCHA bloquea worker | Pool de sesiones + proxies residenciales en backup + alarmas en score bajo |
| BullMQ crece sin tope | TTL en jobs completed (24h), max retries=3, dead-letter queue con alerta |
| Meta limita plantillas | Solo usar plantillas para notificaciones >24h; conversaciones activas usan free-form |
| Supabase free tier se queda corto | Migración a Pro ($25/mes) cuando >500MB. Plan: rotar tabla `process_history` mensual a cold storage. |
| Worker crashea con tab abierta | BullMQ retry con backoff exponencial; nuevo worker abre sesión fresca |
| Costos reCAPTCHA escalan | (no aplica: OECE paga el reCAPTCHA, nosotros lo consumimos) |