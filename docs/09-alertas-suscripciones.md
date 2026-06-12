# 09 · Alertas y Suscripciones — Requerimientos

> **Estado:** especificación para validar **antes de programar**. La base de
> persistencia ya existe (ver `05-schema-supabase.md` §3.5/§3.6) y se **extiende**
> con duración (`expires_at`) y tier (`wa_users.plan`) — ver §2.3 y §10. Aquí se
> define el **catálogo de tipos de alerta**, las **restricciones de SEACE**, la
> **arquitectura de disparo** (ingesta + fan-out) y los **flujos de creación** en
> WhatsApp.

## 0. Alcance del MVP

> **El MVP de alertas se centra ÚNICAMENTE en la pestaña "Anuncio de Contratación
> Futura" (ACF, `tab=acf`).** La pestaña "Buscador de Procedimientos de Selección"
> (`tab=procedimientos`) queda **fuera de alcance / en pausa** para alertas, junto
> con la decisión sobre el volumen de la alerta objeto-solo (ver §9.1, marcada como
> EN PAUSA). El modelo y los flujos descritos aplican a ACF; cuando se reactive
> Procedimientos sólo habrá que cambiar el `tab`.

## 1. Propósito y alcance

Este documento es la **fuente única de verdad del subsistema de alertas**. Para
no duplicar, sólo referencia (no reescribe) lo ya documentado:

| Tema | Vive en |
|---|---|
| UX de gestión "Mis suscripciones" (pausar/eliminar/frecuencia, límite 10) | `03-modulos-bot.md` §3 |
| CTA "Suscribirme a esta búsqueda" al final de resultados | `03-modulos-bot.md` §1.3 |
| Tabla `subscriptions` + `subscription_hits` (campos, índices) | `05-schema-supabase.md` §3.5/§3.6 |
| Componentes WhatsApp (List/Buttons/Flow), fechas con date picker | `06-whatsapp-ux.md` |
| Notificación >24h con plantilla Meta | `06-whatsapp-ux.md` §2.8 |

Lo **nuevo** que aporta este doc: §2.1 (arquitectura ingesta + fan-out), §2.2-2.3
(duración y tier SaaS), §3 (restricciones de SEACE), §4 (catálogo de tipos), §5-6
(puntos de entrada y flujos), §10 (migración pendiente).

## 2. Modelo conceptual

Una **alerta** = filtros guardados + la **pestaña** que vigila + una **frecuencia**
de entrega + una **duración** (vigencia).

```
Alerta  ≈  SearchFilters (guardado)  +  tab  +  frequency  +  expires_at
```

Hay **tres ejes independientes** que no deben confundirse:

| Eje | Campo | Qué controla | Ejemplo |
|---|---|---|---|
| **Filtros** | `objeto`, `entity_ruc`, ... | Qué procesos hacen match | Obra · GORE Piura |
| **Frecuencia** | `frequency` | Cada cuánto se **entrega** el aviso (digest) | 1 vez al día |
| **Duración** | `expires_at` | Cuánto **vive** la alerta antes de auto-expirar | dura 1 semana |

Ejemplo completo: *"avísame de obras de GORE Piura, **diariamente**, durante **1
semana**"*.

La mayor parte ya está en la tabla `subscriptions` (`tab`, `entity_ruc`, `objeto`,
`frequency`, `status`...). **Lo nuevo a nivel de datos es el eje de duración y el
tier** (ver §2.3).

### 2.1 Arquitectura de disparo: ingesta global + fan-out (NO scraping por suscripción)

Decisión de diseño central. SEACE **no notifica**; nosotros scrapeamos. Por eso se
separa la **ingesta** (scrape, independiente de usuarios) de la **notificación**
(match + entrega). **No** se re-ejecuta una búsqueda por cada suscripción (eso sería
N scrapes → caro y dispara el anti-bot/reCAPTCHA).

```
Crawler ACF (global, 4 búsquedas/ciclo: una por objeto)
        │  inserta filas nuevas en `processes` (dedup por content_hash)
        ▼
Matcher: filas nuevas  ⨯  subscriptions activas  →  crea subscription_hits
        │  (unique(subscription_id, process_id) evita duplicados)
        ▼
Notifier: entrega los hits pendientes según el "digest" del usuario
        │  (<24h: mensaje normal · >24h: plantilla Meta)
        ▼
   WhatsApp del usuario
```

- **Crawler:** corre en un horario **global** (independiente de cuántos usuarios
  haya). Para ACF basta con **4 búsquedas por ciclo** (obra/bien/servicio/
  consultoría) para cubrir toda la pestaña. El número de scrapes es **constante**, no
  crece con las suscripciones.
- **Matcher:** compara las filas recién insertadas contra las suscripciones activas
  con SQL barato (`objeto` y, si A1, `entity_ruc`). Inserta `subscription_hits` con
  `notified_at = NULL`. Sólo considera alertas `status='active'` y `expires_at` futuro.
- **Notifier:** envía los hits pendientes. La **`frequency` es la cadencia de
  ENTREGA (digest)**, no la de scraping:
  - `hourly` → **"alerta inmediata al detectar"**: se entrega tras la corrida del
    crawler que detectó el match (frescura máx = cadencia del crawler: **incremental
    cada 1h** con early-stop + completo diario, ya implementado en F5). **Copy: nunca
    "tiempo real" ni "instantáneo"** — usar "alerta inmediata al detectar" o
    "notificación prioritaria".
  - `daily` → se acumulan los hits del día y se manda 1 mensaje a las 8am.
  - `weekly` → 1 resumen el lunes 8am.

> `next_run_at` cambia de semántica: pasa a ser "próxima ventana de **entrega**", no
> "próximo scrape". El motor de scraping vive en `02-arquitectura.md` y `04-scraping.md`.

### 2.2 Duración / vigencia de la alerta (`expires_at`)

La alerta puede **auto-expirar**. Un job periódico marca `status='expired'` cuando
`expires_at < now()`. Opciones que ve el usuario (gated por tier, ver §2.3):

| Duración | `expires_at` | Disponible en |
|---|---|---|
| 1 día | `now() + 1 day` | Free + Premium |
| **1 semana** (default) | `now() + 7 days` | Free + Premium |
| 1 mes | `now() + 30 days` | **Premium** |
| Indefinida | `NULL` | **Premium** |

Al expirar, el bot puede ofrecer **reactivar** la alerta con un botón (útil para
retención y para empujar el upgrade a premium).

### 2.3 Tier / plan (SaaS) — modelado desde ahora

Se modela el tier **ya**, para no reescribir la lógica al monetizar. El tier sólo
**limita qué opciones se ofrecen**; el motor de alertas es el mismo.

| Capacidad | **Free** | **Premium** |
|---|---|---|
| Máx. alertas activas | 3 | 10 |
| Duraciones | 1 día, 1 semana | + 1 mes, indefinida |
| Frecuencias | diaria, semanal | + inmediata al detectar (`hourly`) |

> Los números (3 / 10) son propuesta inicial, ajustables. Esto **refina** el límite
> "máx 10" genérico de `03-modulos-bot.md` §3, ahora segmentado por tier.

**Delta de schema** (✅ **aplicado** — migración
`20260610021500_add_subscription_expiry_and_user_plan`):

```sql
-- 1) Eje de duración en la alerta (NULL = indefinida)
ALTER TABLE "subscriptions" ADD COLUMN "expires_at" TIMESTAMPTZ;
ALTER TYPE "SubStatus" ADD VALUE 'expired';

-- 2) Tier del usuario
CREATE TYPE "UserPlan" AS ENUM ('free', 'premium');
ALTER TABLE "wa_users" ADD COLUMN "plan" "UserPlan" NOT NULL DEFAULT 'free';
ALTER TABLE "wa_users" ADD COLUMN "plan_expires_at" TIMESTAMPTZ;  -- fin del premium; NULL = sin vencimiento
```

En Prisma: `Subscription.expiresAt DateTime?`, `SubStatus` + `expired`, y en `WaUser`
un enum `UserPlan { free premium }` con `plan` y `planExpiresAt`.

## 3. Restricciones de SEACE que condicionan los tipos de alerta

> Verificado en vivo en el buscador de SEACE. Estas reglas **definen** qué tipos de
> alerta son posibles.

1. **No se puede filtrar por objeto + región/departamento sin entidad.**
   Ej.: `objeto=Bien + departamento=Lima` **no es válido**. Si quieres acotar por
   región, **debes** elegir una entidad.
2. **Sí se puede filtrar sólo por objeto** (bien / obra / servicio / consultoría),
   trayendo todo lo publicado recientemente de ese objeto a nivel nacional.
3. **Sí se puede filtrar por entidad + objeto.**
4. El **objeto es siempre obligatorio** en el flujo del bot (decisión de producto:
   evita búsquedas demasiado amplias y alinea con `03-modulos-bot.md`).
5. Aplica **igual a Procedimientos y a ACF** (Anuncio de Contratación Futura): ambas
   pestañas comparten esta limitación de filtros.

**Consecuencia directa:** la idea inicial de una alerta "Objeto + Región (sin
entidad)" queda **descartada**. Los ejes de alcance válidos son: *entidad* o
*ninguno* (objeto-solo).

## 4. Catálogo de tipos de alerta

### 4.1 Regla anti-spam (invariante)

Toda alerta exige **`objeto` obligatorio**. El alcance puede ser una entidad o
ninguno; cuando es objeto-solo, el control de volumen recae en la **frecuencia** y
en la **agrupación** del mensaje (ver §7).

### 4.2 Tipos del MVP

| ID | Tipo | Ejes obligatorios | Pestaña (MVP) | Caso de uso |
|---|---|---|---|---|
| **A1** | **Entidad + Objeto** | `objeto` + `entity_ruc` | ACF (`tab=acf`) | "Avísame de **anuncios futuros de obra** de **GORE Piura**" |
| **A2** | **Objeto** (solo) | `objeto` | ACF (`tab=acf`) | "Avísame de **todo anuncio futuro de obra**, sin importar entidad" |

En el MVP ambos tipos vigilan **ACF** (anuncios de contratación futura, fase de
planificación). El campo `tab` ya permitiría aplicarlos a **Procedimientos** sin
cambiar de modelo, pero esa pestaña está **en pausa** (ver §0 y §9.1).

> Ejemplos en alcance (todos `tab=acf`):
> - A1 → "anuncios futuros de obra de GORE Piura"
> - A2 → "todo anuncio futuro de obra, sin importar entidad"

### 4.3 Tipos post-MVP (documentados, NO se construyen aún)

| ID | Tipo | Eje extra | Notas |
|---|---|---|---|
| A3 | Palabra clave | `objeto` + `keyword` | Útil para nichos ("ambulancia", "puente"). El schema ya soporta `keyword`. |
| A4 | Tipo de Selección | `objeto` + `tipo_seleccion_ids` | "Sólo Licitación Pública". Combinable con A1. |
| A5 | Por monto | `objeto` + `valor_min` | "Sólo si valor referencial > S/ 1M". Schema ya soporta `valor_min/max`. |
| A6 | Watch list (seguimiento) | un proceso puntual | Avisar cambios de estado/cronograma de UN proceso. Requiere modelo nuevo. |

## 5. Puntos de entrada (2 flujos de creación)

La alerta se puede crear desde **dos lugares**, ambos confirmados:

- **Flujo A — Post-búsqueda (contextual).** El usuario terminó una búsqueda (por
  cualquier ruta, incl. Búsqueda Avanzada) y obtiene resultados. Aparece el botón
  **"🔔 Suscribirme"**: registra **la configuración exacta que acaba de usar** sin
  volver a preguntar filtros. Sólo pide **frecuencia** y **duración**. (Es el §1.3 de `03`.)
- **Flujo B — Desde el menú principal (directo).** Entrada **"🔔 Configurar
  alertas"** del menú (ya prevista en `03` §6). Aquí el usuario arma la alerta desde
  cero porque no viene de una búsqueda. Reutiliza los mismos pasos de filtros del
  módulo de búsqueda y termina pidiendo **frecuencia** y **duración**.

> Ambos flujos convergen en el mismo `POST /subscriptions` (mismo `SearchFilters` +
> `tab` + `frequency` + `expires_at`). La diferencia es sólo de dónde salen los
> filtros. Las opciones de frecuencia y duración se filtran según el **tier** del
> usuario (§2.3).

## 6. Flujos conversacionales en WhatsApp

### 6.1 Flujo A — Suscribirse desde resultados

```
Bot: Encontré 47 procesos. Te muestro los 5 más recientes:
     ... (cards) ...
     [Ver más]  [Refinar]  [🔔 Suscribirme]

User: [tap 🔔 Suscribirme]

Bot: Te avisaré cuando aparezcan nuevas Obras de GORE PIURA.
     ¿Cada cuánto quieres el aviso?
     [⚡ Inmediata (Premium)]  [1 vez al día]  [1 vez a la semana]   ← Buttons

User: [tap 1 vez al día]

Bot: ¿Por cuánto tiempo mantengo esta alerta?
     [1 día]  [1 semana]                          ← Buttons (Free)
     (Premium vería además: [1 mes] [Sin vencimiento])

User: [tap 1 semana]

Bot: ✅ Alerta creada.
     Tipo: Entidad + Objeto · Obras · GORE PIURA
     Aviso: diario 8:00 am · Vence: en 1 semana
     Gestiona tus alertas en /suscripciones
```

### 6.2 Flujo B — Crear alerta desde el menú

```
Menú principal → [🔔 Configurar alertas]

Bot: Vamos a crear una alerta de Anuncios de Contratación Futura.
     Primero, ¿qué objeto te interesa? (obligatorio)
     [🏗️ Obra]  [🛒 Bien]  [🛠️ Servicio]  [📐 Consultoría]   ← List/Buttons

User: [tap Obra]

Bot: ¿Quieres acotar a una entidad o vigilar TODAS?
     [🏢 Una entidad]  [🌎 Todas (sólo por objeto)]            ← define A1 vs A2

   ── Si elige "Una entidad" (A1):
   Bot: Escribe el nombre, sigla o RUC. Ej: GORE Piura, 20315880069
   User: GORE Piura
   Bot: Encontré: 1) GOBIERNO REGIONAL DE PIURA (RUC ...) → [confirmar]

   ── Si elige "Todas" (A2): se salta la entidad.

Bot: Resumen de tu alerta:
     Anuncios futuros · Obra · GORE PIURA
     ¿Cada cuánto te aviso?
     [1 vez al día]  [1 vez a la semana]          ← Free (Premium ve además "⚡ Inmediata")

User: [tap 1 vez al día]

Bot: ¿Por cuánto tiempo la mantengo?
     [1 día]  [1 semana]                          ← Free (Premium ve "1 mes" / "Sin vencimiento")

User: [tap 1 semana]

Bot: ✅ Alerta creada (vence en 1 semana). Gestiónala en /suscripciones
```

> El `tab` no se pregunta: en el MVP siempre es `acf`. Cuando se reactive
> Procedimientos, aquí se insertará el paso "¿Anuncios futuros o Procesos de
> selección?".

### 6.3 Fechas (cuando apliquen)

Si en el futuro una alerta incluye rango de fechas (p. ej. para A4/A5 o refinar),
**se usa WhatsApp Flow con date picker nativo** (2 date pickers desde/hasta en una
pantalla). Nunca texto libre para fechas. Detalle en `06-whatsapp-ux.md` §2.x.
**Validación obligatoria:** `desde ≤ hasta`.

### 6.4 Notificación de la alerta

- Si el usuario interactuó hace **<24h**: mensaje normal (texto + cards + botones).
- Si hace **>24h**: **plantilla Meta UTILITY** (ver `06` §2.8), porque la ventana de
  servicio está cerrada.
- Si una corrida genera **>50 hits**: se agrupa en un solo mensaje
  ("GORE PIURA publicó 60 obras. [Ver todas]") — ver `03` §3.

## 7. Mapeo tipo → módulo / tabla / campo

| Necesidad | Dónde se resuelve | ¿Existe? |
|---|---|---|
| Guardar la alerta | `subscriptions` (`tab`, `entity_ruc`, `objeto`, `frequency`...) | ✅ schema listo |
| Duración / vigencia | `subscriptions.expires_at` + status `expired` | ⚠️ migración pendiente (§2.3) |
| Tier del usuario | `wa_users.plan` (`free`/`premium`) + `plan_expires_at` | ⚠️ migración pendiente (§2.3) |
| Ingesta global (crawler) | Crawler ACF, 4 búsquedas/ciclo, dedup `content_hash` | ⚠️ por implementar |
| Match filas nuevas → alertas | Matcher SQL (`objeto`, `entity_ruc`) → `subscription_hits` | ⚠️ por implementar |
| Deduplicar lo ya avisado | `subscription_hits` (`unique(subscription_id, process_id)`) | ✅ schema listo |
| Entregar por digest | `frequency` + `next_run_at` (ventana de entrega) + job `notifier` | ✅ schema / ⚠️ worker por implementar |
| Scraper de ACF | TabStrategy `anuncios_futuros` | ⚠️ ACF strategy pendiente |
| Enviar la notificación | `notifications` (`kind=subscription_hit`) + MessagingPort (Kapso) | ✅ schema / ⚠️ wiring |
| Auto-expirar alertas | job que pasa a `expired` si `expires_at < now()` | ⚠️ por implementar |
| UX de gestión | Módulo "Mis suscripciones" | 📄 diseñado en `03` §3, sin implementar |

## 8. Límites y cuotas (por tier)

Segmentado por tier (refina el límite genérico de `03-modulos-bot.md` §3). Detalle en
§2.3:

| | Free | Premium |
|---|---|---|
| Máx. alertas activas | 3 | 10 |
| Frecuencias | diaria, semanal | + inmediata al detectar (`hourly`) |
| Duraciones | 1 día, 1 semana | + 1 mes, indefinida |

Más: agrupación de mensaje si una corrida supera ~50 hits (común a ambos tiers).

## 9. Decisiones (estado)

1. **[EN PAUSA]** A2 (objeto-solo) sobre **Procedimientos** y su volumen — parqueada:
   Procedimientos fuera del MVP (§0). En ACF, A2 se permite por su bajo volumen.
2. **[RESUELTO]** Objeto en la alerta: **único** en el MVP. Multi-selección
   ("obras Y bienes") queda **pensada para después** (implicaría varias alertas o
   un `objeto[]`); no se construye ahora.
3. **[RESUELTO]** Disparo: **ingesta global + fan-out** (§2.1), no scraping por
   suscripción. `frequency` = cadencia de entrega (digest).
4. **[RESUELTO]** Duración con `expires_at` (§2.2) y **tier modelado desde ahora**
   (§2.3): Free = {1 día, 1 semana} · Premium = {+1 mes, +indefinida}.
5. **[RESUELTO + IMPLEMENTADO]** Cadencia del **crawler global** de ACF: **incremental
   cada 1h** (early-stop por orden DESC) + **completo 1×/día** — implementado en F5
   (`CrawlerScheduler`, `src/workers/crawler.scheduler.ts`), supera el "4×/día" original.
   El premium `hourly` se define como **"alerta inmediata al detectar"** (se entrega
   tras la corrida que detectó el match). **Regla de copy: nunca "tiempo real" ni
   "instantáneo"** en bot, landing ni material — usar "alerta inmediata al detectar"
   o "notificación prioritaria".

## 10. Pendiente de implementación

1. ~~Migración de schema~~ → ✅ **Aplicada**
   (`prisma/migrations/20260610021500_add_subscription_expiry_and_user_plan`):
   `subscriptions.expires_at`, `SubStatus += expired`, enum `UserPlan`,
   `wa_users.plan`, `wa_users.plan_expires_at`. `schema.prisma` y
   `05-schema-supabase.md` actualizados.
2. **TabStrategy `anuncios_futuros`** (scraper ACF) — prerequisito del crawler.
   Incluye el **índice único parcial** para dedup por `(tab, content_hash)` de filas
   sin nomenclatura (ver `02-arquitectura.md` D6).
3. **Crawler + Matcher + Notifier** (§2.1) como jobs del worker.
4. **Job de expiración** de alertas (§7).
5. **UX premium gating** en los flujos (§6) según `wa_users.plan`.