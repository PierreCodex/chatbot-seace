# 10 · Roadmap UX del bot WhatsApp (agente UX)

> **Para quien tome esto:** eres responsable de la **capa de conversación/UX** del bot
> (`src/modules/bot/`): flows, presenters, state machine. **No** tocas el scraper, el
> schema ni los jobs del worker — esos son del agente backend. Trabajas contra
> **ports** (interfaces) y **mocks**, en paralelo al backend.

## 0. Contexto mínimo

- Producto: bot de WhatsApp (vía **Kapso**) para consultar **SEACE** (contrataciones
  del Estado peruano). Stack: NestJS + Prisma/Supabase + BullMQ/Redis + Playwright.
- **MVP = una sola pestaña: "Anuncio de Contratación Futura" (ACF)**, `tab='anuncios_futuros'`.
- Arquitectura: hexagonal-lite. **`modules/` NO importa `adapters/`** (lo bloquea ESLint).
  Lee `07-arquitectura-backend.md`.
- Estado actual del bot en código: `main-menu.flow.ts`, `search-procesos.flow.ts`,
  `menu.presenter.ts` (genéricos/placeholder, hechos para Procedimientos). Hay que
  llevarlos al MVP ACF.

### Docs que SON tu fuente de verdad (léelos antes de codear)
- **`06-whatsapp-ux.md` §10** — *spec canónica del flujo ACF* (variante A + empujón
  suave). **Esto es lo que implementas.**
- `03-modulos-bot.md` — módulos y principios UX.
- `09-alertas-suscripciones.md` — alertas: tipos A1/A2, frecuencia, duración, tier.
- **`12-flujos-bot-implementados.md`** — *as-built*: lo que el código ya hace hoy
  (state machine, presentación 1/2-10/>10, PDFs, guards). Léelo para no re-diseñar
  lo ya construido.

## 1. Alcance: 4 módulos = Flows + Presenters

| Módulo | Flow(s) | Presenter(s) |
|---|---|---|
| **Onboarding / Menú** | `main-menu.flow.ts` (actualizar) | `menu.presenter.ts` (actualizar) |
| **Búsqueda ACF** (core) | `search-anuncios.flow.ts` (nuevo) | `search-results.presenter.ts` (nuevo) |
| **Resolvedor de entidad** | `entity-resolver.flow.ts` (nuevo) | `entity.presenter.ts` (nuevo) |
| **Suscripciones** | `subscribe.flow.ts`, `my-subscriptions.flow.ts` (nuevos) | `subscription.presenter.ts` (nuevo) |

## 2. El contrato (tu frontera con el backend)

Consumes **solo** estos ports/tipos (vía DI token, nunca la clase concreta):

| Necesitas | Port / tipo | Token |
|---|---|---|
| Enviar mensajes WA | `MessagingPort` (`OutboundMessage`) | `MESSAGING_PORT` |
| Buscar/leer procesos ACF | `SearchFacade` (orquesta DB-first) | módulo `search` |
| Resolver entidad por texto | `EntitySearchService` / `ENTITIES_REPO` | módulo `entities` (a crear con backend) |
| Crear/listar/expirar alertas | `SubscriptionsService` | módulo `subscriptions` |
| Estado conversacional | `CachePort` vía `ConversationStore` | `CACHE_PORT` |
| Plan del usuario (tier) | `WaUsersService` → `wa_users.plan` | módulo `users` |

Tipos compartidos: `ProcessRow`, `SearchFilters`, `TabName` (`ports/persistence/types.ts`),
`OutboundMessage` (`ports/messaging.port.ts`). **No los cambies sin acordar con backend.**

> **Trabajas con mocks**: usa `adapters/scraper/mock/` y datos de seed para que tus
> flows/presenters corran sin scraper real. La integración final con la
> `AnunciosFuturosStrategy` la entrega el backend; tú no la esperas para avanzar.

## 3. Fases (cada una con entregable testeable)

**Progreso** (marca `[x]` al cerrar cada fase):
- [x] UX-1 · Menú + Onboarding
- [x] UX-2 · Búsqueda ACF (variante A + empujón suave) ⭐
- [x] UX-3 · Resolvedor de entidad — inline (en ACF) **y** standalone (`entity-resolver`)
- [ ] UX-4 · Suscripciones con tier
- [x] UX-5 · Resultados: tarjetas ≤5 / resumen >5 + **PDF con todos** (`modules/files`:
      render pdfkit + hosting efímero + controller), cableado inline y async
- [ ] UX-6 · Integración + pulido

> **Hecho** (avance 1): `menu.presenter.ts` migrado a menú ACF; `main-menu.flow.ts`
> enruta a `search-anuncios`; `search-anuncios.flow.ts` (variante A + empujón suave +
> resolvedor de entidad inline); `acf-results.presenter.ts` (tarjetas/resumen).
> `search-procesos.flow.ts` queda como legacy F4.
>
> **Hecho** (avance 2): UX-3 standalone (`entity-resolver.flow.ts` + `entity.presenter.ts`,
> handoff a ACF vía `startWithEntity`) y kind `document` en `MessagingPort` + `KapsoAdapter`
> (PDF para >5 cuando backend provea `pdfUrl`). Suite del bot: **33/33** verde
> (`test/modules/bot/` + `test/adapters/messaging/`).
>
> **Hecho** (avance 3): backend del PDF cerrado (`modules/files` + `adapters/files`:
> renderers ACF/entidades + `FilesService` + `FilesController`) y el **PDF de entidades**
> (>10 coincidencias) cableado en el resolvedor. Total repo: **79/79**.

### UX-1 · Menú + Onboarding (1 día) — ✅ HECHO
- [x] `menu.presenter.ts`: List con **📅 Anuncios futuros · 🔔 Mis alertas ·
      🔎 Consultar entidad · ❓ Ayuda**.
- [x] `main-menu.flow.ts`: dispatch a `search-anuncios` (+ placeholders alertas/entidad/
      ayuda; legacy `search` de Procedimientos preservado). Bienvenida en el body del menú.
- [x] **Entregable**: `menu.presenter.spec.ts` (1) + `main-menu.flow.spec.ts` (5). Verde.

### UX-2 · Búsqueda ACF — variante A + empujón suave (3-4 días) ⭐ — ✅ HECHO
Implementa **`06` §10.3 / §10.7**.
- [x] `search-anuncios.flow.ts`: state machine (`awaiting-objeto → menu → soft-nudge →
      awaiting-entity → entity-disambiguation`), estado en `ConversationState.data`.
- [x] Paso obligatorio: **objeto** (List 4 items). Sin objeto no hay "Buscar ahora".
- [x] **Menú dinámico** con resumen acumulativo (`✅ Filtros: Obra · <entidad>`):
      `[🔍 Buscar ahora] [🏢 Filtrar/Cambiar entidad] [🌎 Quitar entidad]`.
- [x] **Empujón suave**: "Buscar ahora" sin entidad → `[🌎 Buscar todos] [🏢 Filtrar entidad]`.
- [x] Llama `SearchFacade.search(tab='anuncios_futuros', ...)`; cached/cache → presenter;
      queued → "Buscando… te aviso ✅".
- [x] **Entregable**: `search-anuncios.flow.spec.ts` (10) recorriendo A2 y A1. Verde.
- [ ] _Pendiente (refinamiento)_: filtros **tipo de selección** y **fechas** vía WhatsApp
      Flow (hoy el menú solo expone objeto + entidad).

### UX-3 · Resolvedor de entidad (2 días) — ✅ HECHO
Implementa **`06` §10.4**. Componente **compartido** (inline + standalone).
- [x] **Inline** (dentro de ACF): texto → `EntitySearchService` → 0/1/varios →
      List de coincidencias (muestra RUC) → tap → vuelve al menú con la entidad.
- [x] **Standalone** (`entity-resolver.flow.ts`, desde "🔎 Consultar entidad") =
      **lookup-only**: resuelve por nombre/sigla/RUC → ficha (`entity.presenter.ts`) con la
      entidad + RUC y **2 botones**: `[🔎 Otra entidad] [📋 Menú]`. **Sin** "Ver anuncios":
      para ver anuncios de la entidad, el usuario vuelve al menú y elige 📅 Anuncios futuros
      (decisión 2026-06-12 — el resolvedor solo consulta el RUC).
- [x] **Entregable**: `entity-resolver.flow.spec.ts` (9). Verde.
- [x] **>10 coincidencias → PDF de entidades** (`hostEntitiesPdf` + `entitiesOverflowMessages`):
      listado numerado nombre+RUC; el usuario responde el RUC/nombre exacto. Degrada a lista
      top-10 si falta `PUBLIC_BASE_URL`.
- [ ] _Pendiente_: "Crear alerta" es placeholder hasta UX-4; selección por texto en el paso
      de lista ≤10 (hoy solo tap).

### UX-4 · Suscripciones con tier (3 días)
Implementa **`09` §6** y **§2.2-2.3**.
- [ ] `subscribe.flow.ts`: post-búsqueda (hereda `filters`) y desde menú (arma `filters`).
      Pasos: **frecuencia** → **duración** → confirmar. Llama `SubscriptionsService`.
- [ ] **Gating por tier** (`wa_users.plan`): free = {diaria, semanal} × {1 día, 1 semana};
      premium = + ⚡ Inmediata + {1 mes, indefinida}.
- [ ] `my-subscriptions.flow.ts`: listar / pausar / eliminar; mostrar vencimiento y ofrecer
      reactivar las `expired`.
- [ ] **REGLA DE COPY (estricta)**: la frecuencia `hourly` se llama **"⚡ Inmediata (al
      detectar)"** o "notificación prioritaria". **NUNCA "tiempo real" ni "instantáneo"**.
- [ ] **Entregable**: spec del flow cubriendo free y premium.

### UX-5 · Presentación de resultados: tarjetas + disparo de PDF (2 días) — ✅ HECHO
Implementa **`06` §10.5 / §10.6**.
- [x] `acf-results.presenter.ts` — **≤5** → tarjetas ACF (entidad, fecha pub, tipo,
      conv. aprox., plazo, descripción **truncada**). **Sin** ficha/bases/cronograma.
- [x] **>5** → resumen ("Encontré N… los 5 más recientes") + 5 tarjetas. Mensaje final
      `[🔔 Suscribirme] [✏️ Refinar] [Menú]`.
- [x] **>5 → documento PDF**: kind `document` añadido a `MessagingPort` + payload en
      `KapsoAdapter` (Meta Cloud API `type: document`, link+filename+caption). El
      presenter adjunta el PDF si recibe `pdfUrl` (>5); si no, degrada a 5 tarjetas + nota.
- [x] **Backend del PDF (`modules/files`)**: `AcfPdfRenderer` (pdfkit, `StoredProcess[] →
      Buffer`) + `FilesService` (cache efímero en Redis 30min + URL `${PUBLIC_BASE_URL}/files/:token.pdf`)
      + `FilesController` que lo sirve. Cableado en **ambos** caminos: inline
      (`search-anuncios.flow`) y async (`SearchResultsListener`, ahora tab-aware). Si no hay
      `PUBLIC_BASE_URL`, `hostAcfPdf` devuelve `null` y degrada a 5 tarjetas.
- [x] **Backend del PDF de entidades** (>10): `EntitiesPdfRenderer` + `hostEntitiesPdf`,
      mismo hosting efímero. Cableado en el resolvedor (`entitiesOverflowMessages`).
- [x] **Entregable**: `acf-results.presenter.spec.ts` (6) + `kapso-adapter.document.spec.ts` (2)
      + `acf-pdf.renderer.spec.ts` (2) + `entities-pdf.renderer.spec.ts` (2) +
      `files.service.spec.ts` (5) + `files.controller.spec.ts` (2). Verde.

### UX-6 · Integración + pulido (1-2 días)
- [ ] Conectar con la `AnunciosFuturosStrategy` real cuando el backend la entregue.
- [x] Manejo de errores/edge (`03` §"Manejo de errores"): **timeouts a SEACE** (`seaceFetch`
      12s + reintento → error tipado → mensaje humano, inline y en cola), 0 resultados (botones
      de salida), input basura (guards de control-id). Falta solo el e2e real.
- [ ] Conversación end-to-end por WhatsApp real.

## 4. Lo que NO haces (es del backend)
- `AnunciosFuturosStrategy` / parser / scraper SEACE.
- Schema Prisma, migraciones, índice único parcial `(tab, content_hash)`.
- Crawler / Matcher / Notifier / job de expiración (worker).
- Render interno del PDF (tú lo **disparas y envías**, no lo generas).
- Tocar `ports/*` o tipos compartidos sin acordar con backend.

## 5. Tests por fase (gate de avance — todo con ports mockeados)

Cada fase **cierra solo cuando su spec está verde**. **Ningún test del bot toca BD ni
SEACE**: se inyectan dobles (`{ provide: MESSAGING_PORT, useValue: fake }`, mocks de
`SearchFacade` / `EntitySearchService` / `SubscriptionsService`, fixtures de
`InboundMessage`). Specs en `vitest`.

| Fase | Spec(s) gate | Valida | Estado |
|---|---|---|---|
| **UX-1** | `menu.presenter.spec.ts`, `main-menu.flow.spec.ts` | "hola"/intent → menú ACF correcto | ✅ 6/6 |
| **UX-2** | `search-anuncios.flow.spec.ts` | recorre A2 y A1; objeto obligatorio; empujón suave; menú dinámico | ✅ 10/10 |
| **UX-3** | `entity-resolver.flow.spec.ts` (standalone) | nombre→lista, 1 match→ficha, handoff a ACF | ✅ 9/9 |
| **UX-4** | `subscribe.flow.spec.ts`, `my-subscriptions.flow.spec.ts` | gating free vs premium; copy sin "tiempo real"; pausar/eliminar/reactivar | ⬜ |
| **UX-5** | `acf-results.presenter.spec.ts`, `kapso-adapter.document.spec.ts`, renderers + `files.service`/`files.controller` | ≤5 → tarjetas; >5 → resumen + PDF (kind `document`); backend genera/hospeda el PDF | ✅ backend cerrado (falta e2e con `PUBLIC_BASE_URL`) |
| **UX-6** | conversación e2e real por WhatsApp | integración con scraper real + edge cases | ⬜ |

> Regla: un avance no se da por hecho sin su spec verde. El e2e real (UX-6) es el único
> que necesita WhatsApp/scraper vivos; todo lo demás corre en CI sin infra.

## 6. Definition of Done (UX MVP)
- [ ] "hola" → menú ACF en <3s.
- [ ] Flujo ACF (variante A) completo con objeto obligatorio + empujón suave.
- [ ] Resolvedor de entidad funciona inline y standalone (sin exigir RUC).
- [ ] Suscripción creada con frecuencia + duración, gateada por tier; copy correcto
      (sin "tiempo real").
- [ ] ≤5 → tarjetas; >5 → PDF adjunto.
- [ ] Specs verdes de flows y presenters (con ports mockeados).
