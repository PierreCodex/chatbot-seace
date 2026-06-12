# 11 · Planes Free vs Premium — Producto / Pricing

> **Estado:** propuesta para **validar**. Define qué capacidades separan los planes
> y cómo se mapean al modelo de datos (`wa_users.plan`). Refina y centraliza la
> matriz de tier que hoy vive dispersa en `09-alertas-suscripciones.md` §2.3/§8.
> Los **números y palancas marcados con 🔲 son decisiones de negocio pendientes**.

## 0. Relación con otros docs

| Tema | Vive en |
|---|---|
| Catálogo de alertas (A1/A2), disparo ingesta+fan-out, duración, schema | `09-alertas-suscripciones.md` |
| Flows de WhatsApp para suscribir (`subscribe_acf_*`) | `docs/flows/`, `10-roadmap-ux-bot.md` |
| Schema `wa_users.plan` / `plan_expires_at`, `subscriptions.expires_at` | `05-schema-supabase.md`, migración `..._add_subscription_expiry_and_user_plan` |

Este doc **no** redefine el motor de alertas; sólo decide **qué opciones se ofrecen
a cada plan**. El motor es idéntico para ambos (ver §1).

## 1. Filosofía del tier

**El plan sólo limita qué opciones se ofrecen; nunca cambia el motor.** Mismo
crawler, mismo matcher, mismo notifier para todos. Esto es deliberado: monetizar no
debe implicar reescribir lógica, sólo abrir/cerrar opciones en la UI y validar en el
backend.

Consecuencias:
- El gating es una **lista de capacidades permitidas por plan**, evaluada en NestJS.
- La frescura de datos es la **misma** para todos (la marca el crawler global,
  4×/día). El premium **no** obtiene data más fresca — obtiene *entrega prioritaria*
  y *más control* (ver §3.2). **Regla de copy: nunca "tiempo real" ni "instantáneo".**

## 2. Matriz de capacidades (PROPUESTA)

| Capacidad | **Free** | **Premium** | Estado |
|---|---|---|---|
| **Máx. alertas activas** | **3** | **10** | ✅ CERRADO |
| **Frecuencia de aviso** | Diaria · Semanal | + ⚡ Inmediata (al detectar) | ✅ CERRADO |
| **Duración de la alerta** | Presets: 1 día · 1 semana | **Calendario** (fecha exacta, máx 1 año) · Indefinida | ✅ CERRADO |
| **Tipo de alerta A1** (Entidad + Objeto) | ✅ | ✅ | ✅ CERRADO |
| **Tipo de alerta A2** (Objeto-solo, alto volumen) | ✅ | ✅ | ✅ CERRADO (ambos) |
| **PDF con todos los resultados** (>5) | ✅ | ✅ | ✅ CERRADO (ambos) |
| **Reactivar alerta vencida** | ✅ | ✅ | ✅ CERRADO |
| **Objetos por alerta** | 1 | **Varios** (multi-objeto) | ✅ premium · 🔲 post-MVP |

> **Multi-objeto** queda definido como **diferenciador premium**, pero su construcción
> es **post-MVP** (alinea con `09` decisión #2): en el MVP ambos planes usan 1 objeto;
> cuando se implemente multi-objeto, será exclusivo de premium.

## 3. Detalle por capacidad

### 3.1 Cuota de alertas activas
Refina el "máx 10" genérico de `03-modulos-bot.md` §3, ahora segmentado:
- **Free: 3** activas. Suficiente para un proveedor que vigila pocas entidades/objetos.
- **Premium: 10** activas.
- Sólo cuentan `status='active'`. Las `expired`/`paused` no consumen cuota.
- Al topar el límite, el bot ofrece **upgrade** o **liberar una alerta** (ver §5).

### 3.2 Frecuencia (cadencia de ENTREGA, no de scraping)
- **Free:** `daily`, `weekly`.
- **Premium:** `+ hourly`, presentado como **"⚡ Inmediata (al detectar)"** = se
  entrega tras la corrida del crawler que detectó el match. Es el **techo honesto**
  de frescura; no se ofrece "cada N horas" arbitrario porque la data sólo se refresca
  con el crawler (ver decisión en §6).

### 3.3 Duración (vigencia `expires_at`)
- **Free — presets fijos:** `1 día` (`now()+1d`), `1 semana` (`now()+7d`, default).
- **Premium — calendario:** `CalendarPicker` para elegir **fecha exacta** de
  vencimiento (`min = mañana`, `max = hoy + 1 año`), **+ OptIn "Sin vencimiento"**
  (`expires_at = NULL`, indefinida).
- El calendario es honesto porque `expires_at` es independiente del crawler.

## 4. Cómo se modela (técnico)

### 4.1 Datos
- `wa_users.plan` ∈ {`free`, `premium`} (default `free`).
- `wa_users.plan_expires_at` — fin de la ventana premium (`NULL` = sin vencimiento).
  Un usuario con `plan='premium'` y `plan_expires_at < now()` se trata como **free**
  (el backend lo degrada en la evaluación, sin tocar el registro hasta el job).
- `subscriptions.expires_at` — vigencia de la alerta (`NULL` = indefinida).

### 4.2 Política de tier (única fuente de verdad en NestJS)
Una función pura `planPolicy(plan)` devuelve las capacidades; **todo** gating la
consulta (flows, validación de `nfm_reply`, cuota):

```
planPolicy('free')    → { maxActive: 3,  frequencies: [daily, weekly],
                          durations: [1d, 1w], customCalendar: false }
planPolicy('premium') → { maxActive: 10, frequencies: [daily, weekly, hourly],
                          customCalendar: true, calendarMaxDays: 365, allowIndef: true,
                          multiObjeto: true /* post-MVP */ }
```

### 4.3 Dos Flows estáticos (sin endpoint)
El backend **elige qué Flow enviar** según el plan — tier-gating real, cero Function:
- **`subscribe_acf_free`** → dropdowns con presets free.
- **`subscribe_acf_premium`** → frecuencia + `CalendarPicker` + OptIn "Sin vencimiento".

Al recibir el `nfm_reply`, el backend **revalida** contra `planPolicy` (defensa en
profundidad: aunque alguien forzara un Flow ajeno, no se crea una alerta fuera de su
plan).

## 5. UX de gating y upsell

- **Free topa cuota (3):** "Ya tienes 3 alertas activas (límite del plan Free).
  Libera una o pásate a Premium para tener hasta 15." → `[Ver mis alertas] [Premium]`.
- **Free intenta una opción premium:** no la ve (los Flows son distintos), así que no
  hay frustración de opción gris. El upsell aparece sólo en los puntos de tope.
- **Alerta vencida:** botón **reactivar** (retención + empujón a premium si quiere
  duración más larga).

## 6. Decisiones cerradas (heredadas o nuevas)

1. **[CERRADO]** Frecuencia **no** admite "cada N horas" personalizado: la entrega no
   puede ser más fresca que el crawler (4×/día). El número libre vendería frescura
   inexistente y rompe la regla de copy. Techo = "⚡ Inmediata (al detectar)".
2. **[NUEVO]** Duración **premium por calendario** (`CalendarPicker` + OptIn
   indefinida); free queda en presets. Se implementa como **dos Flows estáticos**.
3. **[HEREDADO de `09`]** El tier sólo limita opciones; motor único. Copy: nunca
   "tiempo real".

## 7. Decisiones validadas (cerradas)

Todas confirmadas con producto:

1. **Cuotas:** Free **3** / Premium **10** activas. ✅
2. **A2 (objeto-solo):** disponible en **ambos** planes (bajo volumen en ACF). ✅
3. **PDF (>5 resultados):** disponible en **ambos** planes (valor core, no se mutila). ✅
4. **Calendario premium:** fecha exacta con **máx 1 año** + opción **Indefinida**. ✅
5. **Multi-objeto por alerta:** **diferenciador premium**, pero **post-MVP** (no se
   construye ahora; en MVP ambos usan 1 objeto). ✅

## 8. Mapeo a implementación

| Necesidad | Dónde | Estado |
|---|---|---|
| `wa_users.plan` / `plan_expires_at` | schema (migración aplicada) | ✅ |
| `planPolicy(plan)` (capacidades) | `modules/subscriptions` (o `users`) | ⚠️ por crear |
| Cuota máx. activas | validación en `SubscriptionsService.create` | ⚠️ por crear |
| Selección de Flow por plan | flow de suscripción (UX-4) | ⚠️ por crear |
| Flow `subscribe_acf_free` | `docs/flows/subscribe_acf_free.flow.json` | ✅ creado (falta publicar + flow_id) |
| Flow `subscribe_acf_premium` | `docs/flows/subscribe_acf_premium.flow.json` | ✅ creado (falta publicar + flow_id) |
| Kind `flow` + parseo `nfm_reply` | `MessagingPort` + `KapsoAdapter` | ⚠️ por crear (plomería) |
| Validación `nfm_reply` (rango fecha/no_expiry, tier) | flow UX-4 + `planPolicy` | ⚠️ por crear |
| Revalidación de `nfm_reply` vs plan | parseWebhook → flow UX-4 | ⚠️ por crear |
| Job degradar premium vencido | worker | ⚠️ por crear |
