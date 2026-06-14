# 17 · Roles, permisos y comandos de administración

> Diseño **congelado** del sistema de planes (free/premium), roles de permiso
> (owner/seller) y comandos de admin del bot de Telegram. Base del motor de
> alertas (F5). Complementa: [11 (planes)](./11-planes.md), [09 (alertas)](./09-alertas-suscripciones.md),
> [16 (estado Telegram)](./16-telegram-estado.md).
>
> **Decisión de pago:** NO se usa Telegram Stars ni ninguna pasarela. El cobro es
> **manual y externo** (Yape/transferencia). El plan se activa con **comandos
> propios** dentro del bot. Telegram es solo el canal.

---

## 1. Estructura de roles

Dos ejes **ortogonales** que no se mezclan:

- **Rol de permiso** (capacidad administrativa): `owner` → `seller` → (ninguno)
- **Plan** (acceso a features): `premium` / `free`

Un seller también es un usuario con su plan. Ser seller **no** otorga premium.

| Rol | Dónde vive | Quién lo asigna | Puede |
|---|---|---|---|
| **owner** | **`.env` (`OWNER_IDS`)**, no en BD | Nadie en runtime (inmutable) | Todo |
| **seller** | Tabla `BotSeller` (BD) | Solo owner | Activar/desactivar/extender plan de **usuarios comunes** |
| **premium/free** | `WaUser.plan` | seller u owner | Cuota de alertas (free 3 / premium 10) |

**Decisión de seguridad clave:** el owner vive en `.env`, **nunca en la BD**. Es la
raíz de confianza: inmutable en caliente, ningún comando puede crear/quitar owners.
Soporta múltiples owners (`OWNER_IDS=111,222`).

**Alcance del seller (decisión cerrada):** el seller **solo gestiona planes** de
usuarios comunes. **No** modera (suspender), **no** gestiona staff, **no** toca
configuración. Suspensión, gestión de sellers y auditoría global = **owner-only**.

---

## 2. Modelo de datos

Lo existente se mantiene: `UserPlan {free, premium}`, `WaUser.plan` (default free),
`WaUser.planExpiresAt` (opcional), `WaUser.blocked`. Se agrega:

**`BotSeller`** (staff)
- `telegramId`, `active` (boolean — se **desactiva**, no se borra, para preservar la
  auditoría), `addedByOwnerId`, `note`, `createdAt`, `revokedAt`, `revokedBy`

**`AdminAuditLog`** (append-only, **inmutable** — ningún comando lo edita/borra)
- `actorId`, `actorRole`, `action` (enum), `targetUserId`, `before` (snapshot
  plan+expiry), `after`, `note`, `createdAt`

**`WaUser.blocked`** (ya existe): se reutiliza como **suspensión inmediata**.

**Rate-limit de intentos**: en **Redis** (efímero), contador por `telegramId`.

> Opcional (denormalización de conveniencia, no imprescindible): `WaUser.planGrantedBy`.
> El `AdminAuditLog` ya es la fuente de verdad de "quién activó a quién".

---

## 3. Comandos

Nombres en español, claros, sin `/grant`. Identificación siempre por **id numérico**.

### Públicos (cualquier usuario)
| Comando | Qué hace |
|---|---|
| `/miplan` | Muestra **su id**, plan, vencimiento y **uso de alertas** (ej. 2/3). Es el comando con el que el usuario te pasa su id al pagar |

### Admin — owner **y** seller
| Comando | Formato | Qué hace |
|---|---|---|
| `/activar` | `/activar <id> <días\|permanente> [nota]` | Pone Premium. Días → setea vencimiento; `permanente` (palabra explícita) → sin vencimiento |
| `/extender` | `/extender <id> <días> [nota]` | Suma días al premium vigente |
| `/desactivar` | `/desactivar <id> [nota]` | Vuelve a Free |
| `/usuario` | `/usuario <id>` | Ficha: plan, vencimiento, estado, quién lo activó y cuándo |
| `/premium` | `/premium [página]` | Lista premium activos + vencimientos (paginado) |
| `/porvencer` | `/porvencer [días=7]` | Premiums que vencen en N días |
| `/historial` | `/historial <id>` | Auditoría de cambios de ese usuario |

### Owner exclusivo
| Comando | Formato | Qué hace |
|---|---|---|
| `/vendedores` | — | Lista sellers (activos y revocados) |
| `/agregarvendedor` | `/agregarvendedor <id> [nota]` | Alta de seller (con confirmación) |
| `/quitarvendedor` | `/quitarvendedor <id>` | Baja de seller (con confirmación) |
| `/suspender` | `/suspender <id> [nota]` | Bloquea al usuario **ya** (abuso) |
| `/reactivar` | `/reactivar <id>` | Quita la suspensión |
| `/panico` | `/panico <seller_id>` | **Emergencia**: revoca al seller y marca sus activaciones recientes para revisión |
| `/auditoria` | `/auditoria [página]` | Auditoría global de acciones admin |

---

## 4. Visibilidad de comandos (defensa en capas)

1. **`setMyCommands` con scope por chat** (`BotCommandScopeChat`): el menú nativo de
   comandos muestra los admin **solo** en el chat del owner y de cada seller. El
   público nunca los ve listados.
2. **Sigilo en ejecución:** si un no-autorizado tipea `/activar …` a mano, el bot
   **no responde nada** (decir "no autorizado" confirmaría que el comando existe). Se
   trata como entrada desconocida y se **registra el intento** (rate-limited).

---

## 5. Seguridad y anti-escalamiento

El **router de admin corre ANTES** del router de flujos conversacionales (si no, un
flujo activo "se comería" el comando). Un único punto de autorización.

**Resolución de rol:** owner (env) → seller (BD `active=true`) → ninguno.

**Anti-escalamiento (seller):**
- ❌ No puede targetearse **a sí mismo** (ni auto-premium ni auto-extender)
- ❌ No puede targetear a un **owner ni a otro seller** → solo usuarios comunes
- ❌ No puede agregar/quitar sellers · suspender/reactivar · tocar config

**Protección del owner:** ningún comando puede targetear a un owner. Los owners solo
se gestionan vía `.env`.

**Validación de input:**
- Id **numérico** (`^\d+$`) y de rango Telegram plausible
- Debe **existir en `WaUser`** (haber hecho `/start`). Si no → *"ese usuario aún no ha
  iniciado el bot"*. Evita activar ids con typo o inventados

**Confirmación** (botón inline) en lo destructivo: `/quitarvendedor`, `/panico`,
`/suspender`.

**Rate-limit:** intentos admin fallidos/no-autorizados por id (ej. 5/min) → al superar
el umbral se ignora en silencio y se avisa al owner. Frena enumeración de ids y
fuerza-bruta de sintaxis.

**Atomicidad:** cambio de plan + registro de auditoría en **una transacción**. Si falla
el audit, **se revierte** el cambio. La auditoría es obligatoria → no hay cambios sin
rastro.

---

## 6. Vencimientos y consistencia (casos borde)

**Resolvedor de "plan efectivo"** — única fuente de verdad en todo chequeo:

```
si blocked                                   → suspendido (sin servicio)
si premium y (expiry == null o expiry > now) → premium
en caso contrario                            → free
```

**Doble enforcement del vencimiento:**
- **Lazy (en lectura):** aunque el cron falle, nunca se sirve premium vencido.
- **Cron nocturno:** baja a free los vencidos, escribe audit `auto_vencido` y notifica
  al usuario.

**Estado ambiguo eliminado por diseño:** "premium sin fecha" = **permanente
intencional**, y solo se logra con la palabra `permanente`. `/activar` jamás default-ea
a permanente → no existe "premium sin vencimiento por error".

**Idempotencia:** `/activar` setea el vencimiento de forma **absoluta** (reemplaza);
`/extender` **suma**. Reactivar a alguien ya premium sobrescribe y queda en el audit.
Pago externo → sin doble cobro.

---

## 7. Integración con las alertas (planPolicy)

- `planPolicy.maxAlertas(plan)` → **free: 3 · premium: 10** (única fuente).
- `subscribe.flow` valida `suscripciones_activas < maxAlertas(planEfectivo)` antes de
  crear.
- **Downgrade con exceso** (premium→free con >3 alertas): **no se borran**. Se conservan
  las 3 más recientes activas y el resto pasa a `pausada (over-quota)`; si re-upgrade,
  se reactivan solas. Se avisa al usuario.
- `HitDetection` solo despacha alertas cuyo dueño tiene plan efectivo que las permite
  (saltea suspendidos y pausadas).

---

## 8. Flujo owner → seller → usuario

1. **Owner suma a su amigo:** el amigo hace `/start`, te pasa su id, vos
   `/agregarvendedor 555 "Juan"` → confirmás → Juan queda seller y recibe aviso.
   *(audit: seller_agregado)*
2. **Usuario paga** (Yape/transferencia, fuera del bot), corre `/miplan`, te manda su id.
3. **Seller activa:** `/activar 999 30 "yape 14/06"` → usuario 999 premium 30d, recibe
   *"Premium hasta 14/07"*. *(audit: plan_activado por seller 555)*
4. Usuario ya crea hasta 10 alertas.
5. **A los 30 días** el cron lo baja a free, le avisa, pausa las alertas sobre el límite.
   *(audit: auto_vencido)*
6. **Si el seller abusa:** `/panico 555` → seller revocado + sus activaciones recientes
   marcadas para revisión. *(audit: seller_revocado_emergencia)*

---

## 9. Auditoría

Toda acción con efecto queda registrada con **actor, rol, objetivo, antes/después, nota
y timestamp**:

`plan_activado` · `plan_extendido` · `plan_desactivado` · `auto_vencido` ·
`usuario_suspendido` · `usuario_reactivado` · `seller_agregado` · `seller_revocado` ·
`seller_revocado_emergencia` · `intento_no_autorizado`

Consultable por `/historial <id>` (por usuario) y `/auditoria` (global). Append-only e
inmutable.

---

## 10. Escalabilidad

- Sellers en BD + owners en env → escala a muchos sellers sin tocar código.
- Audit indexado por `targetUserId`, `actorId`, `createdAt` → soporta `/historial`,
  `/auditoria`, `/porvencer`.
- Listados paginados con botones inline.
- Router de admin centralizado y previo al de flujos → un solo punto de autorización,
  fácil de testear.
- Notificaciones automáticas en cada cambio relevante (al usuario y/o al owner).

---

## 11. Plan de implementación por fases

> Estado al 2026-06-14: fases 1–5 ✅ implementadas y testeadas (22 tests).

1. ✅ **Schema + env** — `BotSeller`, `AdminAuditLog`, enums `AdminActorRole`/`AdminAction`;
   `OWNER_IDS` en `.env`/`env.schema.ts`. Migración `20260614130000_admin_roles_audit`
   aplicada a Supabase.
2. ✅ **Resolvedor de rol + plan efectivo** — `RolesService` (owner env / seller BD) y
   `PlanService.getEffectivePlan` con vencimiento lazy + `maxAlertas`.
3. ✅ **Router de admin** (`AdminCommandsService`, previo al de flujos en
   `ConversationService`) + parser + rate-limit Redis + sigilo + auditoría transaccional
   (en `PrismaAdminRepo`).
4. ✅ **Comandos de plan** (`/activar` `/extender` `/desactivar` `/usuario` `/miplan`) +
   notificación al usuario destino.
5. ✅ **Comandos owner** (`/agregarvendedor` `/quitarvendedor` `/vendedores`
   `/suspender` `/reactivar` `/panico` `/auditoria` `/premium` `/porvencer`
   `/historial`).
6. ⏳ **`planPolicy`** (free 3 / premium 10) + integración en `subscribe.flow`.
7. ⏳ **Cron de vencimiento** (`AdminRepo.expireOverdue` ya existe; falta el agendado +
   notificación) + manejo de over-quota.
8. ⏳ **`setMyCommands` por scope** (menú admin solo para owner/sellers).
9. ⏳ **Confirmación inline** en destructivos (`/quitarvendedor` `/panico` `/suspender`).

> El **motor de alertas** (HitDetection + dispatch + subscribe.flow) se apoya en las
> fases 2 y 6. Ver [16 · pendiente](./16-telegram-estado.md).

### Mapa de archivos (fases 1–5)
```
prisma/schema.prisma                              # BotSeller, AdminAuditLog, enums
prisma/migrations/20260614130000_admin_roles_audit/
src/config/env.schema.ts                          # OWNER_IDS
src/ports/persistence/admin.repo.port.ts          # ADMIN_REPO + AdminRepoPort
src/adapters/persistence/prisma/admin.repo.ts     # PrismaAdminRepo (transaccional)
src/modules/admin/
├── roles.service.ts                              # owner/seller
├── plan.service.ts                               # plan efectivo + cuotas
├── admin-commands.service.ts                     # router + comandos
└── admin.module.ts
src/modules/bot/conversation.service.ts           # admin.handle() antes del flujo
```
