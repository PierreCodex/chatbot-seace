# 13 · Migración a Telegram — plan completo del bot

> **Objetivo:** llevar el bot de SEACE a **Telegram** reutilizando ~80% del código.
> WhatsApp (Kapso) y Telegram **coexisten**: se elige el canal por env
> `MESSAGING_CHANNEL`. Cliente Telegram = **grammY usado solo como `Api` + tipos**
> (sin su framework `Bot`/dispatch), para no romper la abstracción `MessagingPort`.

---

## 0. Por qué la migración es barata

Todo WhatsApp vive detrás de **un solo puerto**: `MessagingPort` (`send()` +
`parseWebhook()`, en `src/ports/messaging.port.ts`). Los flujos, presenters,
búsqueda, scraping, BullMQ, Supabase y los PDFs **no saben qué canal es**. Por eso
migrar = escribir **un adapter nuevo** + un controller de webhook, y elegirlo en el
composition root. La regla de oro del repo (`modules/` no importa `adapters/`) se
mantiene intacta.

**Bonus estratégico:** el blocker de las suscripciones (verificación de portafolio
Meta + WhatsApp Flows + `nfm_reply`) **desaparece**. En Telegram las suscripciones
se arman como pasos normales del motor de flujos con teclados inline — sin Meta, sin
Flows, sin verificación. Lo que estaba ⏸️ EN PAUSA se vuelve trivial (ver §9).

---

## 1. Qué contendrá el bot en Telegram (alcance funcional)

Todo lo que ya existe en WhatsApp, **idéntico en lógica**, más las suscripciones
nativas que estaban bloqueadas:

| Módulo | Estado en WhatsApp | En Telegram |
|---|---|---|
| **Menú principal** (`main-menu.flow`) | ✅ implementado | Reuso directo · `/start` ya lo dispara (reset global) |
| **Anuncios futuros / ACF** (`search-anuncios.flow`) | ✅ implementado | Reuso directo · lista de objeto → teclado inline |
| **Resolver de entidad** (`entity-resolver.flow`, lookup-only) | ✅ implementado | Reuso directo |
| **Búsqueda de procedimientos** (`search-procesos.flow`) | ✅ (parcial) | Reuso directo |
| **Entrega de PDF** (ACF agrupado + entidades, `modules/files`) | ✅ implementado | Reuso directo · `sendDocument(url)` |
| **Robustez** (timeouts SEACE, errores tipados, mensajes humanos) | ✅ implementado | Reuso directo |
| **Suscripciones / alertas** (Free vs Premium) | ⏸️ EN PAUSA (blocker Meta) | **Se desbloquea**: pasos inline (ver §9) |

> **No se toca:** flujos, presenters, `SearchFacade`, scrapers, `CrawlerScheduler`,
> BullMQ, Supabase/Prisma, `modules/files`. Solo se agrega el canal.

---

## 2. Decisión de cliente: grammY como `Api` + tipos (no el framework)

grammY tiene dos capas; usamos **solo la segunda**:

1. ❌ **Framework** (`new Bot()`, `bot.on(...)`, `webhookCallback()`, middleware,
   sessions). Quiere ser dueño del dispatch y el `Context` → **choca** con
   `ConversationService` + el motor de flujos + el store en Redis.
2. ✅ **Cliente + tipos** (`import { Api } from "grammy"` y los tipos `Update`,
   `Message`, `CallbackQuery`, `InlineKeyboardMarkup`). `api.sendMessage(...)`,
   `api.sendDocument(...)` totalmente tipados, sin imponer dispatch.

Verificado contra la doc actual de grammY: `new Api(token)` es un cliente autónomo
soportado, y los tipos del Bot API se importan sueltos.

- **Una sola dependencia nueva:** `grammy`.
- **Timeout:** `new Api(token, { client: { timeoutSeconds: 12 } })` — la robustez de
  red la da grammY; no hace falta envolverlo en `seaceFetch`.
- **Identidad sigue parseándose a mano** hacia `InboundMessage` → la abstracción de
  canal se conserva.

---

## 3. Mapeo de conceptos WhatsApp → Telegram

| Concepto WhatsApp | Telegram | Tratamiento |
|---|---|---|
| `phoneNumber` (clave de usuario) | `chat_id` numérico (sin teléfono salvo que lo comparta) | Reuso del slot `phoneNumber` con el `chat_id` como string (deuda menor; rename a `chatId`/`userKey` = fase 2, §10) |
| `phoneNumberId` (número de empresa Meta) | No existe — es el bot token | Constante (`telegram-bot`), ignorado en el envío |
| `kind: text` | `sendMessage` | 1:1 |
| `kind: buttons` | `sendMessage` + `reply_markup.inline_keyboard` (`callback_data = id`) | 1:1 · `callback_data` ≤ 64 bytes (los ids tipo `entact:otra` caben) |
| `kind: list` (selector nativo) | **No existe** | Teclado inline apilado (1 botón por fila); `description` se pliega al body |
| `kind: document` (PDF) | `sendDocument(chat_id, url, { caption })` | 1:1 · acepta URL hospedada |
| Markdown `*bold*` / `_italic_` | `parse_mode: 'HTML'` (`<b>`/`<i>`) | Mini-conversor WA→HTML + escape de `< > &` (§5) |
| Inbound texto | `update.message.text` | → `InboundMessage{ type:'text' }` |
| Inbound botón | `update.callback_query.data` | → `InboundMessage{ type:'interactive', interactiveReplyId }` + `answerCallbackQuery` (apaga el spinner) |

---

## 4. Arquitectura — archivos

### Nuevos

```
src/adapters/messaging/telegram/
├── telegram.client.ts          # new Api(token, { client:{ timeoutSeconds:12 } }) desde ConfigService
├── telegram.adapter.ts         # implements MessagingPort (send + parseWebhook)
├── telegram.markdown.ts        # conversor copy WA (*b* / _i_) → HTML + escape
└── telegram.module.ts          # provee MESSAGING_PORT = TelegramAdapter

src/modules/bot/
└── telegram-webhook.controller.ts  # POST /webhook/telegram (valida secret header, encola)

test/adapters/messaging/
├── telegram.adapter.spec.ts    # parse message/callback_query; build de cada kind
└── telegram.markdown.spec.ts   # *b*→<b>, _i_→<i>, escape de < > &
```

### Modificados (mínimos)

| Archivo | Cambio |
|---|---|
| `src/config/env.schema.ts` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `MESSAGING_CHANNEL: z.enum(['whatsapp','telegram']).default('whatsapp')` |
| `src/app.module.ts` | Factory: provee `MESSAGING_PORT` según `MESSAGING_CHANNEL`; registra el controller del canal activo |
| `src/worker.module.ts` | Igual binding de `MESSAGING_PORT` (el listener async manda outbound) |
| `.env.example` | Documentar las 3 vars + nota de `PUBLIC_BASE_URL` (ya existe) |
| `package.json` | `pnpm add grammy` |
| `docs/07`, `docs/12`, `docs/README.md` | Nota del segundo canal |

> **`modules/files` no cambia:** el PDF se sigue hospedando en `…/files/<token>.pdf`
> y Telegram lo envía por URL.

---

## 5. `TelegramAdapter` — contrato

```ts
@Injectable()
export class TelegramAdapter implements MessagingPort {
  constructor(private readonly client: TelegramClient) {}

  async send(message: OutboundMessage): Promise<{ messageId: string }> {
    const chatId = Number(message.to);
    switch (message.kind) {
      case 'text':     // api.sendMessage(chatId, toHtml(body), { parse_mode:'HTML' })
      case 'buttons':  // sendMessage + inline_keyboard [[{ text, callback_data:id }], ...]
      case 'list':     // sendMessage(body + filas) + inline_keyboard apilado
      case 'document': // api.sendDocument(chatId, link, { caption })
    }
  }

  parseWebhook(raw: unknown): InboundMessage[] {
    // update.message.text          -> { type:'text', text }
    // update.callback_query        -> { type:'interactive', interactiveReplyId: data }
    //   + this.client.api.answerCallbackQuery(cbq.id)  // apaga el "reloj"
    // phoneNumber   = String(chat.id)
    // phoneNumberId = 'telegram-bot'  (constante)
    // isNewConversation = (text === '/start')
  }
}
```

**Conversor de copy (`telegram.markdown.ts`):** el copy del bot usa `*negrita*` y
`_itálica_` (estilo WhatsApp) y contiene `~`, `·`, `:`, emojis. MarkdownV2 obligaría a
escapar muchos símbolos → frágil. Por eso **HTML**:
1. Escapar `&`, `<`, `>`.
2. `*texto*` → `<b>texto</b>`, `_texto_` → `<i>texto</i>`.
3. El resto (emojis, `~`, `·`) pasa tal cual.

---

## 6. Webhook

`POST /webhook/telegram` (controller propio, paralelo a `webhook/kapso`):
- Valida el header **`X-Telegram-Bot-Api-Secret-Token`** contra `TELEGRAM_WEBHOOK_SECRET`
  (en `dev`, warn-and-continue como hace el de Kapso).
- `parseWebhook(update)` → encola `processInbound` y responde **200 OK** rápido
  (Telegram reintenta si tardás).
- Reusa **el mismo** `ConversationService` (cero cambios ahí).

---

## 7. Setup manual (una vez)

```bash
# 1. Crear el bot con @BotFather en Telegram → copiar el token
#    /newbot → nombre → username → BOT_TOKEN

# 2. Registrar el webhook (apuntando al túnel/host público):
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<TU-HOST>/webhook/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

# 3. Verificar:
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# 4. (Opcional) menú de comandos visible:
curl "https://api.telegram.org/bot<BOT_TOKEN>/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{"commands":[{"command":"start","description":"Menú principal"}]}'
```

`.env`:
```
MESSAGING_CHANNEL=telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=<aleatorio>
PUBLIC_BASE_URL=https://<TU-HOST>     # ya usado por los PDFs
```

---

## 8. Tests

| Spec | Verifica |
|---|---|
| `telegram.adapter.spec.ts` | `parseWebhook` de `message` (texto) y `callback_query` (botón → `interactiveReplyId`); `send` construye el payload correcto por cada `kind` (text/buttons/list/document) |
| `telegram.markdown.spec.ts` | `*b*`→`<b>`, `_i_`→`<i>`, escape de `< > &`, emojis intactos |
| Suite existente | Sigue **verde sin tocar** — los flujos/presenters no dependen del canal |

> El adapter se mockea (`Api` stub) igual que el spec de `http.util` mockea `fetch`.
> No toca BD (respeta `test` vs `test:repos`).

---

## 9. Suscripciones nativas en Telegram (desbloqueo)

En WhatsApp las suscripciones requerían **WhatsApp Flows** (formulario nativo de Meta)
+ verificación de portafolio + plomería `nfm_reply`. En Telegram **no hay Flows ni
verificación**: la suscripción se arma como un flujo de pasos del motor que ya tenés,
con teclados inline. Plan (fase 2):

1. `subscribe.flow.ts` — pasos: tipo de alerta (Entidad+Objeto / Objeto) → objeto →
   (entidad si aplica) → confirmación.
2. **Gating de plan** (`planPolicy`) inline: Free (3 alertas) vs Premium (10) con
   botones, leyendo `wa_users.plan`. Lo que en WhatsApp eran 2 Flows estáticos, acá
   son ramas del flujo.
3. Reusa el catálogo de entidades (cascada L1/L2/L3) y el `HitDetectionService`
   (pendiente de F5) sin cambios — el canal solo entrega el aviso.

Copy: mantener la regla del proyecto — **nunca "tiempo real"**, usar *"alerta
inmediata al detectar"*.

---

## 10. Deuda consciente (fase 2, opcional)

- **Rename de identidad:** hoy se reusa `phoneNumber`/`phoneNumberId` con el `chat_id`.
  Limpio sería `userKey`/`channel` agnósticos del canal (toca `ConversationState`,
  `ConversationStore` keys, `WaUsersService`, tabla `wa_users`). No bloquea el MVP.
- **Multi-canal por usuario:** si un mismo usuario usa WA y Telegram, hoy son
  registros distintos. Unificar identidad = post-MVP.
- **Rich features Telegram** (no necesarias para paridad): `editMessageText` para
  refrescar tarjetas, `deleteMessage`, comandos `/buscar` directos.

---

## 11. Fases de implementación

| Fase | Entregable testeable |
|---|---|
| **T0 · Setup** | `pnpm add grammy`; env schema + `.env.example`; bot creado en BotFather |
| **T1 · Adapter** | `TelegramAdapter` + `telegram.markdown` + specs verdes (`pnpm test`) |
| **T2 · Webhook + binding** | `telegram-webhook.controller` + factory `MESSAGING_PORT` por `MESSAGING_CHANNEL`; build limpio |
| **T3 · E2E** | `setWebhook` al túnel; `/start` → menú; búsqueda ACF → tarjetas + PDF; resolver de entidad; mensajes de error/timeout |
| **T4 · Suscripciones nativas** (opcional) | `subscribe.flow` con gating Free/Premium inline |

**Criterio de "listo" (paridad con WhatsApp):** desde Telegram se puede recorrer el
menú, buscar anuncios futuros (objeto y objeto+entidad), recibir el PDF cuando hay >5
resultados, resolver una entidad, y recibir mensajes humanos ante 0 resultados / timeout.