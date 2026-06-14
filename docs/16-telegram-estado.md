# 16 · Telegram — estado (implementado / pendiente)

> Estado vivo de la migración y el rediseño en Telegram. Qué está hecho, qué
> componentes de la Bot API usamos, y qué falta. Complementa: [13 (plan)](./13-telegram-migracion.md),
> [15 (custom emoji)](./15-telegram-emojis.md).

---

## ✅ Implementado

### Canal e infraestructura
- **Coexistencia WhatsApp + Telegram** por env `MESSAGING_CHANNEL` (carga condicional del
  adapter en `messaging.module.ts` → solo se exige la credencial del canal activo).
- **Identidad multi-canal en BD** (migración aplicada a Supabase): `wa_users.channel` +
  `channel_user_id` (`phone_e164` opcional). `upsertByChannel`; `ConversationService` usa
  el canal activo.
- **Webhook** `POST /webhook/telegram` (valida header `X-Telegram-Bot-Api-Secret-Token`).
- **Adapter grammY** (`Api` standalone, timeout 12s) — `telegram.adapter.ts`:
  - `send` para `text` / `buttons` / `list` / `document`.
  - `parseWebhook`: `message` (texto) y `callback_query` (botón) + `answerCallbackQuery`
    (apaga el spinner) + `sourceMessageId` (para editar/borrar).
  - `editMessage`, `deleteMessage`, `sendChatAction`.
- **Conversor copy** WA (`*b*`/`_i_`) → HTML (`telegram.markdown.ts`).

### UX / diseño
- **Menú de 2 niveles**: inicial (módulos: ACF activo · Próximamente · Ayuda) → submenú ACF
  (Ver anuncios · Consultar entidad · Mis alertas). HTML, separador animado, value-prop.
- **Botones de colores** (Bot API 9.4 `style`: primary/success) + **ícono custom** en botón
  (`icon_custom_emoji_id`) + **grilla** (`buttonLayout`).
- **Banner de bienvenida** (`sendPhoto`, una vez en `/start`).
- **Navegación en el mismo espacio**: `editMessage` (menú↔submenú, abrir flujo) + **efecto
  desvanecido** `deleteMessage` (volver al menú).
- **Custom emoji animados** (registro `common/telegram-emoji.ts`): `dot`, `search`, `ruc`,
  `write`, `loading`, `premium`, `alert`, etc. + separador `tgDivider` + efectos `TG_EFFECT`.
- **Indicador "escribiendo…"** (`sendChatAction('typing')`) automático en cada mensaje.

### Flujo Consultar entidad (completo) ✅
- Prompt + búsqueda por botón **y** comando global `/ent <texto>`.
- Resultados **sin botones colgados** (RUCs directo en texto, historial limpio) + línea guía.
- Ficha (1) / lista (2–10, todos los RUC) / PDF (`entidades.pdf`, >10).
- **"Consultando…" desaparece** al entregar (`deleteMessageIds`).
- **Relevancia**: descarta ruido puro-trigram (ej. "universidad nacional de frontera" 69 → 1).

### Flujo Ver anuncios (completo) ✅
- **Pantallas intermedias Telegram-style** (channel-aware): selector de objeto (grilla de
  botones), menú de filtros, prompt/desambiguación de entidad, 0-resultados — con HTML,
  botones de colores, separador animado y **navegación in-place** (`edit`/`replace`).
- **Búsqueda en un solo toque**: "Buscar ahora" busca directo (con o sin entidad). Se
  eliminó la pantalla de confirmación "empujón suave" porque duplicaba la decisión que el
  menú ya ofrece (*Buscar ahora* vs *Filtrar por entidad*).
- **Tarjetas Telegram**: separador animado + objeto·tipo + `<blockquote expandable>`
  (colapsable) con Entidad / Objeto / CUI / Publicado / Convocatoria / Plazo / Cantidad,
  valores en **monospace**.
- **Loaders animation-ready** ("Consultando…" / "Buscando…" con `tgEmoji('loading')`).
- **Efecto animado** al entregar resultados (`message_effect_id`).
- PDF con todos (`anuncios-futuros.pdf`) cuando hay >5.

### Robustez
- `seaceFetch` (timeout 12s + reintento) + errores tipados + mensajes humanos (inline y en
  cola). PDF servido con **filename por tipo** (anuncios-futuros.pdf / entidades.pdf).

---

## 🧩 Componentes de la Bot API en uso

| Componente | Uso en DataSeace |
|---|---|
| `parse_mode: HTML` (`<b><i><code>`, `<blockquote expandable>`, `<tg-emoji>`) | Todo el copy Telegram |
| `InlineKeyboardButton.style` (9.4) | Botones azul/verde |
| `InlineKeyboardButton.icon_custom_emoji_id` (9.4) | Íconos animados en botones |
| `message_effect_id` | Efecto al entregar resultados |
| `sendChatAction('typing')` | "Escribiendo…" durante el trabajo |
| `editMessageText` / `deleteMessage` | Navegación in-place + desvanecido |
| `sendPhoto` / `sendDocument` (por URL) | Banner / PDFs |
| `answerCallbackQuery` | Apagar spinner del botón |
| custom emoji (`tg-emoji`) | Acentos animados (requiere owner Premium) |

---

## ⏳ Pendiente

### Flujo Ver anuncios — async
- **"Buscando…" (queued ~30s)**: hoy es animation-ready, pero no se borra cuando el listener
  entrega el resultado async (es cross-proceso → requiere guardar el `message_id`).

### Roles, planes y comandos de admin — fases 1–5 ✅ ([17](./17-roles-permisos-alertas.md))
- Roles owner (env) / seller (BD) + planes free/premium; **cobro manual (sin Telegram
  Stars)**; comandos propios implementados (`/miplan` `/activar` `/extender` `/desactivar`
  `/usuario` `/premium` `/porvencer` `/historial` + owner `/agregarvendedor`
  `/quitarvendedor` `/vendedores` `/suspender` `/reactivar` `/panico` `/auditoria`).
- Schema + migración aplicados; `RolesService`/`PlanService`/`AdminCommandsService`;
  router admin previo al de flujos; auditoría transaccional; sigilo + rate-limit.
- Pendiente (fases 6–9): `planPolicy`+`subscribe.flow`, cron de vencimiento,
  `setMyCommands` por scope, confirmación inline en destructivos.

### Motor de alertas ✅ (ver [17](./17-roles-permisos-alertas.md) fase 6)
- ✅ `planPolicy` (Free 3 / Premium 10) + `SubscribeFlow` (botón "🔔 Avísame" hereda los
  filtros; frecuencia + duración gated por plan) + "Mis alertas".
- ✅ `HitDetectionService` (matchea anuncios nuevos del crawl ↔ alertas) +
  `AlertNotifierService` (inmediata `hourly` + digest diario/semanal) en el worker.
- ✅ Job de expiración (`ExpiryScheduler`, 03:30 Lima): expira alertas vencidas + baja a
  Free los Premium vencidos con aviso.
- Preview local sin esperar a SEACE: `pnpm alerts:preview -- --id=<telegram_id>`.

> **Telegram Stars: descartado.** El cobro es manual/externo; el plan se activa con
> comandos propios. Ver [17](./17-roles-permisos-alertas.md).

### A evaluar (mejoras)
- `MessageEntity` tipo **`date_time`** (9.5) para fechas — verificar que no rompa el manejo TZ.
- **Rich Messages `RichBlockTable`** (10.1) → anuncios como tabla — verificar soporte en grammY.
- **Mini App** (dashboard gráfico) · **Topics en chat privado** (separar Búsquedas/Alertas).

### Operativo
- BotFather: agregar `/ent` a `setMyCommands`; crear **pack de custom emoji propio** en `@Stickers`.
- Flujo **Buscador de procedimientos** (`search-procesos`, legacy) sin estilo Telegram.
- Producción: hosting del API/worker + `setWebhook` al dominio final.

---

## 🗂️ Mapa de archivos (Telegram)

```
src/adapters/messaging/
├── messaging.module.ts            # binding por MESSAGING_CHANNEL
└── telegram/
    ├── telegram.client.ts         # grammY Api (timeout 12s)
    ├── telegram.adapter.ts        # send/parseWebhook/edit/delete/chatAction
    ├── telegram.markdown.ts       # copy WA → HTML
    └── telegram.module.ts
src/common/telegram-emoji.ts       # registro custom emoji + efectos + separador
src/modules/bot/
├── telegram-webhook.controller.ts # POST /webhook/telegram
├── conversation.service.ts        # canal + navegación (edit/replace/delete) + typing
├── flows/{main-menu,entity-resolver,search-anuncios}.flow.ts
└── presenters/{menu,entity}.presenter.ts
src/modules/search/presenters/acf-results.presenter.ts  # tarjetas (channel-aware)
```

> Para cambiar emoji/efectos: ver [15 · Custom emoji](./15-telegram-emojis.md) → editar solo
> `src/common/telegram-emoji.ts`.
