# 14 · Actualización de la data (crawler + frescura de búsqueda)

> Cómo se mantiene actualizada la data de SEACE en nuestra BD de Supabase, cómo
> decide el bot si responder desde la BD o ir en vivo, y cómo operarlo en local vs
> producción. Doc de referencia operativa — si una búsqueda "tarda 30s", la respuesta
> está acá (§7).

---

## 0. TL;DR

- **Cadencia del crawler** = cada cuánto traemos data de SEACE → **incremental 1h + completo 12h**.
- **Para ACF**, el bot consulta la **BD completa** (sin umbral de frescura); solo cae a scrape en vivo si el objeto aún no está en BD.
- **Para otras pestañas** (no ACF), aplica `DB_FRESHNESS = 6h` como umbral antes de ir a vivo.
- **Producción:** automático (worker 24/7 + `CRAWLER_ENABLED=true`). **Local:** lo disparás vos con `pnpm crawl:acf`.
- Si una búsqueda no-ACF tarda 30-40s → la data local está vencida (>6h). No es un bug. → §7.

---

## 1. Las dos perillas (clave para no confundirse)

| Perilla | Pregunta que responde | Valor actual | Dónde vive |
|---|---|---|---|
| **Cadencia del crawler** | ¿Cada cuánto *intento* refrescar la data? | incremental **1h** + completo **12h** | `src/workers/crawler.scheduler.ts` |
| **`DB_FRESHNESS`** | ¿Qué tan vieja *tolero* la data antes de ir en vivo? | **6h** (solo aplica a pestañas **no ACF**) | `src/modules/search/search.facade.ts` |

**Regla de oro para pestañas no-ACF:** el umbral debe ser **≥ cadencia + margen**, nunca
igual a la cadencia. Es un *colchón* para que un atraso/caída del crawler no penalice a
los usuarios con 30s. Con crawler de 1h, la data casi siempre tiene <1h → el umbral de 6h
ni se nota; solo actúa de red de seguridad.

**ACF es distinto:** como el dataset es pequeño y el crawler lo mantiene actualizado cada
1h (incremental) + cada 12h (completo), `SearchFacade` **no aplica `DB_FRESHNESS`** a los
anuncios de contratación futura. El bot devuelve todos los ACF que haya en la BD.

---

## 2. El crawler (cómo se refresca la BD)

Vive en el **proceso worker** (no en el API), vía `@nestjs/schedule`. Dos jobs:

| Job | Cron | Cadencia | Qué hace |
|---|---|---|---|
| `acf-incremental` | `0 0 * * * *` | **cada 1h** (minuto 0) | Pagina cada objeto desde la pág. 1 (orden DESC = lo nuevo primero) y **corta apenas una página viene 100% sin cambios** (early-stop). ~4s / ~9 requests sin novedades. |
| `acf-full` | `0 0 */12 * * *` | **cada 12h** (00:00 y 12:00) | Pagina todo. Red de seguridad para ediciones de filas viejas, borrados y churn de igual conteo que el incremental no detecta. |

**Cómo "refresca" la frescura:** cada corrida hace `upsertMany`, que pone
`scrapedAt = now()` en **todas** las filas tocadas — incluso las que no cambiaron
(`processes.repo.ts`). Por eso un crawler corriendo mantiene `scrapedAt` siempre <1h, y
las búsquedas siempre pegan a la BD.

**Idempotente:** identidad por `dedupeKey` (ACF = `contentHash`); si una fila no cambió,
solo se actualiza `scrapedAt`; si cambió, se actualiza el detalle + `lastChangedAt`.

### Gating

```
CRAWLER_ENABLED="false"   # default — el crawler NO corre
```
Para que los crons disparen hacen falta **dos** condiciones (en cualquier entorno):
1. `CRAWLER_ENABLED=true`, **y**
2. el **proceso worker** levantado (es ahí donde vive el scheduler).

---

## 3. Cómo decide el bot: BD vs vivo (cascada de búsqueda)

`SearchFacade.search()` resuelve en 3 niveles:

1. **DB-first** — para ACF no aplica umbral de frescura; para otras pestañas usa
   `scrapedAt >= now − DB_FRESHNESS(6h)`. Si hay filas que matchean → las devuelve
   (`source: cached_db`, **~1s**).
   - Caso especial ACF+entidad: si hay anuncios del objeto en la BD pero ninguno de la
     entidad pedida, devuelve **0 al instante** (SEACE no filtra ACF por entidad
     server-side y el crawler mantiene el set completo → 0 es la respuesta real).
2. **Cache Redis** — misma combinación de filtros pedida hace <30min (resultado de un
   scrape reciente). `source: cache`.
3. **Scrape en vivo** — ni BD ni cache resuelven → encola un job, scrapea SEACE
   (**~30s**) y entrega el resultado de forma asíncrona. `source: queued`.

> La frescura (umbral de 6h) **solo aplica al nivel 1 y solo para pestañas no-ACF**.
> ACF devuelve todo lo que haya en la BD.

---

## 4. Local vs Producción

| Entorno | Cómo se actualiza la data |
|---|---|
| **Producción** | **Automático.** Worker 24/7 + `CRAWLER_ENABLED=true` → incremental cada hora + completo cada 12h. Sin comandos. |
| **Local** | **Manual** (no tenés el worker prendido esperando el tick). Corrés `pnpm crawl:acf` cuando querés data fresca. Opcional: `CRAWLER_ENABLED=true` + worker levantado replica el modo automático, pero hay que esperar al minuto 0 y dejar la máquina prendida. |

---

## 5. Comandos manuales en local (cheat-sheet)

> Mientras trabajás en local (sin el worker corriendo), **vos refrescás la data a mano**.
> No hay error de código: solo hay que volver a llenar cuando la data pasa las 6h.

### 5.1. Refrescar la data (el comando principal)

```bash
pnpm crawl:acf
```
Hace `build` + scrapea los 4 objetos (bien/servicio/obra/consultoría de obra) con un solo
bootstrap de Playwright y luego `fetch` por página, y persiste en `processes` (+
`process_acf` 1:1). Refresca `scrapedAt` → las búsquedas vuelven a salir de la BD en ~1s.

**Cuándo correrlo:** cada vez que notes búsquedas lentas, o simplemente **antes de probar/demostrar**
(si pasaron >6h desde el último llenado, la data ya está vencida).

### 5.2. Variantes útiles

```bash
# Más rápido: solo trae lo nuevo y corta apenas no hay cambios (early-stop)
pnpm crawl:acf --incremental

# Solo algunos objetos (ej. obras y bienes)
pnpm crawl:acf --objetos=obra,bien

# Diagnóstico: cuenta filas sin escribir en la BD
pnpm crawl:acf --dry
```

**Todos los flags** (`scripts/crawl-acf.mjs`):

| Flag | Efecto |
|---|---|
| `--objetos=obra,bien` | Subconjunto de objetos (default: los 4) |
| `--max-pages=500` | Máx. páginas por objeto |
| `--pause=500` | ms de pausa entre objetos |
| `--incremental` | Early-stop por orden DESC (como el job horario) |
| `--dry` | No persiste, solo cuenta (diagnóstico) |

### 5.3. Verificar que quedó fresca

El propio `crawl:acf` ya imprime al final `processes(ACF) before→after` + conteos. Para
revisar el estado de la BD aparte:

```bash
# Total de procesos + los últimos 10 por scraped_at (ver qué tan fresca está)
node --env-file=.env --experimental-strip-types scripts/check-processes.ts
```
Al buscar luego en WhatsApp, en los logs deberías ver `DB-first hit (N)…` (rápido) en vez
de `queued job=…` (vivo).

### 5.4. Scripts relacionados

```bash
pnpm crawl:entities      # poblar/refrescar el catálogo de entidades
```
Otros: `scripts/verify-acf-count.mjs`, `scripts/verify-incremental.mjs`.

### 5.5. Alternativa: modo automático en local (como producción)

Si no querés acordarte del comando, replicá producción: poné `CRAWLER_ENABLED="true"` en
`.env` y dejá el **worker** corriendo:

```bash
pnpm dev:worker        # mantiene vivo el scheduler → crawl automático cada hora
```
Contra: hay que dejar el worker prendido y esperar al minuto 0 de cada hora. Para
testear/demostrar, el comando manual (`pnpm crawl:acf`) suele ser más práctico.

---

## 6. Configuración (env)

```bash
# .env
CRAWLER_ENABLED="true"        # prende los crons del crawler (default false)
```
`DB_FRESHNESS` **no es env** — es una constante en `search.facade.ts` (6h). Aplica solo a
pestañas no-ACF; ACF ignora el umbral y devuelve todo el dataset de la BD.

---

## 7. Troubleshooting — "la búsqueda tarda 30-40s"

**Causa más común (99%) para pestañas no-ACF:** la data local está vencida (>6h) y el
 crawler está apagado → el DB-first la descarta → cae a scrape en vivo.

**Para ACF**, una búsqueda lenta solo pasa si el objeto pedido **aún no está en la BD**
(por ejemplo, nunca se corrió `pnpm crawl:acf` o el objeto está vacío).

**Diagnóstico:**
1. ¿Cuándo corriste `pnpm crawl:acf` por última vez? (solo importa para no-ACF si fue hace >6h).
2. Mirá los logs: `DB-first hit (N) …` = salió de la BD (rápido); `queued job=…` = fue a
   vivo (lento).

**Fix:**
- **Local / demo:** `pnpm crawl:acf` → refresca → próxima búsqueda ACF ~1s.
- **Permanente / prod:** `CRAWLER_ENABLED=true` + worker corriendo → se refresca solo cada
  hora y nunca se vence.

**Lo que NO es el problema en ACF:**
- ❌ El umbral de 6h (ACF ya no lo usa).
- ❌ La BD "caducada" (ACF devuelve todo el dataset).

---

## 8. Resumen de decisiones cerradas

- Cadencia crawler: **incremental 1h + completo 12h**.
- `DB_FRESHNESS`: **6h** para pestañas no-ACF; **ACF no aplica umbral** y devuelve todo el dataset de la BD.
- Todo esto es **independiente del canal** (WhatsApp o Telegram): el crawler y la frescura
  alimentan la BD; el canal solo entrega. Ver [13 · Migración a Telegram](./13-telegram-migracion.md).
