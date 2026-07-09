# Entornos: pruebas en local vs producción

> Guía operativa: cómo dirigir el bot de Telegram a tu PC (pruebas con ngrok)
> o a Railway (producción), qué variable vive en cada lado y los gotchas.
> Creado 2026-07-09 al probar la fase 1 del NLU (docs/21, docs/22).

---

## 1. El modelo mental: el "entorno" lo decide el webhook

El bot de Telegram tiene **UN solo webhook** registrado en los servidores de
Telegram. Todos los mensajes que le escriban van a esa URL — o a Railway
(producción) o a tu PC vía túnel ngrok. **Nada en tu `.env` cambia esto**: el
`.env` local y las variables de Railway son mundos separados; lo único que
"cambia de entorno" es ese puntero, y se cambia con la API de Telegram
(`setWebhook`).

```
                         ┌────────────────────────────┐
  Telegram (usuarios) ──▶│ webhook registrado (1 solo)│
                         └──────────────┬─────────────┘
                     pnpm webhook prod  │  pnpm webhook local <url>
                              ▼         │         ▼
               Railway api (producción) │  ngrok → localhost:3000 (pnpm dev)
```

### El script `pnpm webhook` (scripts/webhook.mjs)

| Comando | Qué hace |
|---|---|
| `pnpm webhook status` | Muestra a dónde apunta ahora (PRODUCCIÓN / LOCAL), updates pendientes y el último error de entrega |
| `pnpm webhook local https://<sub>.ngrok-free.app` | Modo pruebas: los mensajes llegan a tu PC |
| `pnpm webhook prod` | Restaura producción (Railway) |

Usa `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` de tu `.env`. La URL de
producción está en el propio script (`PROD_URL`) — actualízala si cambia el
dominio de Railway.

---

## 2. Receta: probar en local con ngrok

```
Terminal 1:  pnpm dev                                  # API :3000 + worker :3001
Terminal 2:  ngrok http 3000                           # copia la URL https
Terminal 3:  pnpm webhook local https://<tu-url>.ngrok-free.app
```

Desde ese momento le escribes al bot en Telegram y responde **tu código local**
(con NLU). Extras:

- **PDFs en local**: pon `PUBLIC_BASE_URL="https://<tu-url-ngrok>"` en `.env` y
  reinicia `pnpm dev`. Sin esto el bot omite el PDF y muestra solo tarjetas.
- La URL de ngrok **cambia en cada arranque** (plan free): si reinicias ngrok,
  repite el `pnpm webhook local <nueva-url>`.
- **Al terminar: `pnpm webhook prod`.** Mientras apunte a tu PC, producción no
  recibe ningún mensaje.

### Alternativa sin Telegram: `pnpm chat:sim`

Para validar flujos no hace falta tocar el webhook: el simulador levanta el
grafo DI real (BD, Redis local, flujos, NLU si hay key) e imprime la
conversación en consola. Interactivo o scripted:

```
pnpm chat:sim
node --env-file=.env scripts/chat-sim.mjs --script="hola;obras para colegios"
```

---

## 3. Qué variable vive en cada lado

| Variable | `.env` local (pruebas) | Railway (producción) |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `REDIS_URL` | `redis://localhost:6379` (Docker local, contenedor `redis`) | Upstash — ⚠️ ver §5 |
| `DATABASE_URL` / `DIRECT_URL` | Supabase (compartida hoy) | Supabase (la misma) |
| `MESSAGING_CHANNEL` | `telegram` | `telegram` |
| `TELEGRAM_BOT_TOKEN` | el del bot | el mismo (mismo bot) |
| `TELEGRAM_WEBHOOK_SECRET` | X | **el MISMO valor X** — ver gotcha §4 |
| `PUBLIC_BASE_URL` | URL de ngrok (o vacío = sin PDF) | `https://api-production-316d.up.railway.app` (cuenta nueva desde 2026-07-09) |
| `PROXY_URL` | vacío (IP de Perú sirve directo) | proxy residencial de Perú (IP de Railway bloqueada por SEACE) |
| `CRAWLER_ENABLED` | `false` (no scrapear en cada arranque) | `true` (solo en el servicio worker) |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | `anthropic` / key / `claude-haiku-4-5` | **pendiente de agregar** al deployar la fase 1 NLU |
| `NLU_ENABLED` / `NLU_TIMEOUT_MS` | `true` / `8000` | idem al deployar |

Nota: hoy local y prod **comparten la BD de Supabase** — lo que escribas
probando (usuarios, alertas, searches) queda en la misma base que usa prod.

---

## 4. Gotchas

1. **El secret debe coincidir en ambos lados.** El controller
   (`telegram-webhook.controller.ts`) valida el header
   `X-Telegram-Bot-Api-Secret-Token` contra su `TELEGRAM_WEBHOOK_SECRET`. El
   script registra el webhook con el secret de TU `.env`; si el de Railway
   fuera distinto, al volver a prod los updates se rechazarían con 401
   (silencio total). Mantén el mismo valor en ambos lados.
2. **Webhook en tu PC + tu PC apagada = mensajes en cola.** Telegram reintenta
   y `pending_update_count` crece; al restaurar prod, le llegan de golpe.
   `pnpm webhook status` te muestra si quedó algo colgado.
3. **`pnpm dev` recompila en watch**, pero si acabas de hacer `git pull` con
   cambios de dependencias: `pnpm install` primero.
4. **Redis local**: Docker Desktop abierto y el contenedor `redis` corriendo
   (arranca solo con `--restart unless-stopped`). Sin Redis, el bot no procesa
   nada (ConversationStore).

---

## 5. Solución definitiva recomendada: un bot de desarrollo

Para no cambiar el webhook nunca más: crear un **segundo bot** en @BotFather
(ej. `@DataSeaceDevBot`).

- Su token va **solo** en tu `.env` local (`TELEGRAM_BOT_TOKEN`).
- Su webhook se registra **una vez** hacia ngrok (con dominio estático de ngrok
  o re-registrando al arrancar).
- El bot real queda apuntando fijo a Railway.

Dev y prod dejan de competir por el mismo puntero; pruebas cuando quieras sin
tocar producción. Pendiente de configurar (opcional).

---

## 6. Estado al 2026-07-09

- Webhook: apunta a **producción** (verificado con `pnpm webhook status`).
- ⚠️ **Producción caída por Redis**: Upstash agotó el free tier (500k
  requests) → `ConversationStore` falla y el bot no responde nada. Opciones:
  Redis como servicio en Railway (coherente con la decisión "Redis propio",
  ver docs/22) o esperar el reset mensual de Upstash. Al deployar la fase 1
  NLU conviene resolver esto primero.
- Fase 1 NLU: funciona en local (chat:sim y smoke 11/11); prod aún corre el
  código previo sin NLU.
