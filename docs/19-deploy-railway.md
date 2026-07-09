# 19 · Deploy en Railway (test de 1 semana)

> **MIGRACIÓN 2026-07-09**: la cuenta original de Railway venció. Todo se
> recreó en la cuenta nueva (`deveuser001@gmail.com`): proyecto `dataseace`,
> servicios `api`/`worker` (mismo esquema de abajo), **Redis de Railway**
> (reemplaza a Upstash — coherente con la decisión "Redis propio",
> `REDIS_URL=${{Redis.REDIS_URL}}`), dominio nuevo
> `https://api-production-316d.up.railway.app`, y las variables del NLU
> (`LLM_PROVIDER/LLM_API_KEY/LLM_MODEL/NLU_ENABLED/NLU_TIMEOUT_MS`) en `api`.
> El primer deploy se hizo con `railway up` (código local, fase 1+2 NLU);
> el servicio `api` quedó además conectado al repo GitHub — un push a `main`
> re-deploya, así que **commitear antes de pushear** para no volver atrás.
>
> **Gotchas del deploy en cuenta nueva (2026-07-09):**
> 1. **NO usar pre-deploy command con `pnpm prisma migrate deploy`**: en el
>    contenedor de pre-deploy el proceso termina el trabajo ("No pending
>    migrations") pero NO SALE (probable prompt de corepack sin TTY) → el
>    contenedor principal nunca arranca → "Healthcheck failed!" tras 5 min de
>    "service unavailable". Migraciones: aplicarlas manualmente desde local
>    (`pnpm prisma:migrate:deploy`) antes de deployar cambios de schema.
> 2. El start command con `&&` NO corre en shell (mismo síntoma).
> 3. En GraphQL `serviceInstanceUpdate`, **`null` = "no cambiar"**, no "borrar"
>    — para limpiar `preDeployCommand` hay que mandar `[]`.
> 4. `railway redeploy` reutiliza el manifiesto del deployment anterior — los
>    cambios de config solo aplican con un deploy NUEVO (`railway up` / push).

> Cómo desplegar DataSeace a Railway desde GitHub para el test en vivo. Usa **un
> solo `Dockerfile`** (incluye Chromium para el crawler) y **dos servicios** (API +
> worker) que comparten el mismo repo/imagen, cambiando solo el *start command*.

## Arquitectura en Railway

```
GitHub (este repo)
   │  (Railway build con Dockerfile)
   ├── Servicio "api"     → node dist/main.js        (webhook + /files + /health)   [dominio público]
   └── Servicio "worker"  → node dist/worker.main.js (crawler + matcher + notifier) [sin dominio]
Plugins / externos:
   ├── Redis (plugin de Railway)         → REDIS_URL
   └── Supabase (Postgres, externo)      → DATABASE_URL / DIRECT_URL
```

- **Base de datos:** seguimos usando **Supabase** (no el Postgres de Railway). Las
  migraciones ya están aplicadas; el start de la API corre `prisma migrate deploy`
  (idempotente) por las dudas.
- **Redis:** agregar el plugin **Redis** de Railway y referenciar su `REDIS_URL`.
- **Chromium:** va en la imagen (lo bootstrapea el worker para el crawl ACF).

## Pasos

1. **Subir el repo a GitHub** (rama `main`).
2. En Railway: **New Project → Deploy from GitHub repo** → elegí este repo.
   Railway detecta el `Dockerfile` automáticamente.
3. Ese primer servicio será la **API**. Renombralo `api` y configurá:
   - **Start command:** `pnpm prisma migrate deploy && node dist/main.js`
   - **Healthcheck path:** `/health`
   - **Generar dominio** (Settings → Networking → Generate Domain). Copiá la URL
     `https://<api>.up.railway.app`.
4. **Agregar Redis:** New → Database → **Redis**. Copiá su `REDIS_URL` (o referencialo
   con `${{Redis.REDIS_URL}}`).
5. **Crear el segundo servicio (worker):** New → **GitHub Repo** (el mismo) → renombralo
   `worker` y configurá:
   - **Start command:** `node dist/worker.main.js`
   - Sin dominio (no recibe tráfico).
6. **Variables de entorno** (ver tabla abajo) en **cada** servicio.
7. **Registrar el webhook de Telegram** apuntando a la API (una sola vez):
   ```
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://<api>.up.railway.app/webhook/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
8. **Probar:** `/start` en Telegram; crear una alerta; revisar logs del `worker`
   (debería loguear "crawler ACF habilitado" y las corridas).

## Variables de entorno

| Variable | api | worker | Valor |
|---|---|---|---|
| `SERVICE` | `api` | `worker` | (lo fija el entrypoint igual; opcional) |
| `MESSAGING_CHANNEL` | ✅ | ✅ | `telegram` |
| `TELEGRAM_BOT_TOKEN` | ✅ | ✅ | token de @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | — | el secret del webhook |
| `OWNER_IDS` | ✅ | ✅ | tu id (`7079999767`) |
| `DATABASE_URL` | ✅ | ✅ | Supabase (pooler) |
| `DIRECT_URL` | ✅ | ✅ | Supabase (directo, para migraciones) |
| `REDIS_URL` | ✅ | ✅ | `${{Redis.REDIS_URL}}` |
| `PUBLIC_BASE_URL` | ✅ | ✅ | `https://<api>.up.railway.app` (para el PDF) |
| `CRAWLER_ENABLED` | `false` | **`true`** | el crawler/alertas corren en el worker |
| `NODE_ENV` | `production` | `production` | (la imagen ya lo setea) |

> **Importante:** `PUBLIC_BASE_URL` debe ser el dominio de la **API** (no del worker) —
> es quien sirve `/files/:token.pdf`. Con esto el botón "PDF con todos" abre bien (ya
> no es localhost/ngrok). El worker también lo necesita porque el notifier puede armar
> links de PDF.

## Notas

- **Costo/escala:** 2 servicios + Redis. Para el test alcanza con los planes chicos.
- **Crawler:** con `CRAWLER_ENABLED=true` en el worker corre incremental cada hora +
  completo cada 12h + digests de alertas (8am / lunes 8am) + expiración (03:30).
- **Cold start del worker:** la primera corrida del crawler bootstrapea Playwright
  (~unos segundos); es normal.
- **Logs:** Railway → cada servicio → Deployments → Logs.
- **Imagen pesada:** incluye Chromium (~400MB). Aceptable para el test; si se quiere
  optimizar luego, separar imágenes api/worker o usar multi-stage.
