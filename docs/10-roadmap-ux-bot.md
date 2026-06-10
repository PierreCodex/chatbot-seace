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
- [ ] UX-1 · Menú + Onboarding
- [ ] UX-2 · Búsqueda ACF (variante A + empujón suave) ⭐
- [ ] UX-3 · Resolvedor de entidad
- [ ] UX-4 · Suscripciones con tier
- [ ] UX-5 · Resultados: tarjetas + PDF
- [ ] UX-6 · Integración + pulido

> **Base ya existente** (placeholders de Procedimientos, **a migrar a ACF**, no reescribir
> de cero): `main-menu.flow.ts`, `menu.presenter.ts` creados; `search-procesos.flow.ts`
> existe como referencia del patrón state-machine.

### UX-1 · Menú + Onboarding (1 día)
- [ ] Actualizar `menu.presenter.ts`: List con **📅 Anuncios de Contratación Futura ·
      🔔 Mis alertas · 🔎 Consultar entidad · ❓ Ayuda**.
- [ ] `main-menu.flow.ts`: dispatch a los flows nuevos; bienvenida (primer contacto).
- [ ] **Entregable**: spec de presenter (input→OutboundMessage) + "hola" → menú correcto.

### UX-2 · Búsqueda ACF — variante A + empujón suave (3-4 días) ⭐
Implementa **`06` §10.3 / §10.7** literal.
- [ ] `search-anuncios.flow.ts`: state machine con estado en Redis
      `{ flow:'acf-search', step, filters:{ objeto, entityRuc?, tipoSeleccionIds?, fechaDesde?, fechaHasta? } }`.
- [ ] Paso obligatorio: **objeto** (List 4 items). Sin objeto no hay "Buscar ahora".
- [ ] **Menú dinámico** con resumen acumulativo: `[🔍 Buscar ahora] [➕ Agregar filtro]`;
      agregar → entidad / tipo selección (Flow) / fechas (Flow). Re-pinta desde `filters`.
- [ ] **Empujón suave**: si toca "Buscar ahora" sin filtro de alcance → preguntar
      `[🌎 Buscar todos] [🏢 Filtrar por entidad]`.
- [ ] Al confirmar, llama `SearchFacade.search(...)`; si responde async, cerrar con
      "Buscando… te aviso ✅".
- [ ] **Entregable**: specs del flow (mockea ports) recorriendo A2 y A1.

### UX-3 · Resolvedor de entidad (2 días)
Implementa **`06` §10.4**. Componente **compartido** (inline + standalone).
- [ ] Texto libre → `EntitySearchService` → List de coincidencias (muestra RUC) → tap.
- [ ] Casos borde: RUC pegado (match directo), >10 coincidencias (refinar / PDF directorio),
      0 en cache (el backend hace fallback a SEACE; tú solo muestras "buscando…").
- [ ] Standalone (`/entidad`): muestra datos + `[📅 Ver anuncios] [🔔 Crear alerta]`.
- [ ] **Entregable**: spec del flow + sub-uso desde UX-2.

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

### UX-5 · Presentación de resultados: tarjetas + disparo de PDF (2 días)
Implementa **`06` §10.5 / §10.6**.
- [ ] `search-results.presenter.ts` — **≤5** → tarjetas ACF (entidad, fecha pub, tipo,
      conv. aprox., plazo, descripción **truncada**, `[Ver descripción completa]`).
      **Sin** ficha/bases/cronograma.
- [ ] **>5** → resumen corto + adjuntar **documento PDF** (`OutboundMessage` kind
      `document`). El **render del PDF lo provee el backend** (`modules/files` renderer
      `ProcessRow[]→Buffer`); tú decides cuándo enviarlo y armas el mensaje.
- [ ] Mensaje final con `[🔔 Suscribirme] [✏️ Refinar]`.
- [ ] **Entregable**: spec del presenter con N≤5 y N>5.

### UX-6 · Integración + pulido (1-2 días)
- [ ] Conectar con la `AnunciosFuturosStrategy` real cuando el backend la entregue.
- [ ] Manejo de errores/edge (`03` §"Manejo de errores"): timeouts, 0 resultados, input basura.
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

| Fase | Spec(s) gate | Valida |
|---|---|---|
| **UX-1** | `menu.presenter.spec.ts`, `main-menu.flow.spec.ts` | "hola"/intent → menú ACF correcto |
| **UX-2** | `search-anuncios.flow.spec.ts` | recorre A2 y A1; objeto obligatorio; empujón suave; re-pinta estado desde Redis (cache mock) |
| **UX-3** | `entity-resolver.flow.spec.ts` | nombre→lista, RUC directo, >10→refinar, 0→"buscando"; uso standalone |
| **UX-4** | `subscribe.flow.spec.ts`, `my-subscriptions.flow.spec.ts` | gating free vs premium; copy sin "tiempo real"; pausar/eliminar/reactivar |
| **UX-5** | `search-results.presenter.spec.ts` | ≤5 → tarjetas; >5 → mensaje con documento PDF |
| **UX-6** | conversación e2e real por WhatsApp | integración con scraper real + edge cases |

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
