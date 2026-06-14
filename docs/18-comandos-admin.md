# 18 · Comandos del bot — guía práctica

> Referencia operativa de los comandos de administración y planes (Telegram).
> El **diseño** y las reglas de seguridad están en [17](./17-roles-permisos-alertas.md);
> acá va el **cómo se usan** día a día. Identificación siempre por **id numérico**.

---

## Quién es quién

| Rol | Cómo se define | Puede |
|---|---|---|
| **owner** (dueño) | Id en `.env` `OWNER_IDS` | Todo |
| **seller** (vendedor) | Lo agrega el owner con `/agregarvendedor` | Solo gestionar planes de usuarios comunes |
| **usuario** | Cualquiera que escribió `/start` | `/miplan` |

> **Owner y seller son Premium automáticamente por su rol** — no necesitan que se les
> active un plan (su `/miplan` muestra "Premium por tu rol"). Solo los **usuarios
> comunes** necesitan que les actives Premium.

> El owner actual es `7079999767`. Para sumar owners se edita `OWNER_IDS` en `.env`
> (separados por coma) y se reinicia el bot. **No hay comando** para crear owners.

---

## Convenciones

- `<id>` = id numérico de Telegram del usuario (lo obtiene con `/miplan`, o con
  `@userinfobot`).
- `[...]` = argumento **opcional**. `<...>` = **obligatorio**.
- `nota` = texto libre al final (queda guardado en la auditoría; ej. `pago yape 14/06`).
- Los comandos admin **no responden** a usuarios sin permiso (sigilo). El menú nativo
  de comandos tampoco se los muestra.

---

## Comandos públicos (cualquier usuario)

### `/ayuda`
Explica **qué hace el bot** para un usuario común: ver anuncios futuros, consultar
entidad (`/ent`), alertas y `/miplan`. Es la ayuda de cara al cliente. (Alias: `/help`.)

### `/miplan`
Muestra tu **id**, tu **plan** actual, el vencimiento (si es Premium) y tu cupo de alertas.
Es el comando que usa el cliente para **pasarte su id** cuando te paga.

```
/miplan
→ 👤 Tu cuenta
  🆔 Tu id: 7079999767
  📦 Plan: Premium 💎
  🛡️ Premium por tu rol de owner
  🔔 Alertas: hasta 10
```

---

## Ayuda de administración

### `/cmds`
Lista **los comandos de administración** que tenés disponibles **según tu rol** (el owner
ve todo, el seller ve solo los de planes). Es el "índice" para vos y tus sellers — los
usuarios comunes no lo ven (sigilo). Para ellos está `/ayuda`.

---

## Comandos de planes — owner y seller

### `/activar <id> <días|permanente> [nota]`
Activa **Premium**. Con un número → vence en esos días; con `permanente` → sin vencimiento.
Setea el vencimiento de forma **absoluta** (reemplaza el anterior). Avisa al usuario.

```
/activar 123456789 30 pago yape          → Premium 30 días
/activar 123456789 permanente cortesía   → Premium sin vencimiento
```

### `/extender <id> <días> [nota]`
**Suma** días al Premium vigente (si ya venció, cuenta desde hoy). No sirve para Premium
permanente ni para usuarios Free (usá `/activar`).

```
/extender 123456789 15 renovación
```

### `/desactivar <id> [nota]`
Vuelve al usuario a **Free** (borra el vencimiento). Avisa al usuario.

```
/desactivar 123456789 dejó de pagar
```

### `/usuario <id>`
Ficha del usuario: plan efectivo, plan en BD + vencimiento, si está suspendido y su rol.

```
/usuario 123456789
```

### `/premium`
Lista los usuarios **Premium activos** con su vencimiento.

### `/porvencer [días]`
Premiums que **vencen** en los próximos N días (default 7). Útil para avisar/cobrar antes.

```
/porvencer        → vencen en 7 días
/porvencer 3      → vencen en 3 días
```

### `/historial <id>`
Auditoría de un usuario: qué se le hizo, cuándo y con qué nota.

```
/historial 123456789
```

---

## Comandos de owner (exclusivos)

### `/agregarvendedor <id> [nota]`
Da de alta un **seller** (el id debe haber hecho `/start`). Le avisa que ya es seller.

```
/agregarvendedor 555555555 Juan
```

### `/quitarvendedor <id>`
Le quita el rol de seller (queda revocado, no se borra; la auditoría se conserva).

### `/vendedores`
Lista los sellers (🟢 activos · ⚪ revocados).

### `/suspender <id> [nota]`
Bloquea al usuario **de inmediato** (no puede usar el bot). No se puede suspender a un owner.

```
/suspender 123456789 spam
```

### `/reactivar <id>`
Quita la suspensión.

### `/panico <seller_id>`
**Emergencia**: revoca al seller y te muestra sus **últimas acciones** para que revises si
hizo algo indebido.

```
/panico 555555555
```

### `/auditoria`
Últimas acciones administrativas de todo el sistema (actor → objetivo).

---

## Flujo típico de cobro (todo manual, fuera del bot)

1. El cliente quiere Premium → corre `/miplan` y te manda **su id**.
2. Te paga por fuera (Yape/transferencia).
3. Vos (o un seller) corrés `/activar <id> 30 "yape 14/06"`.
4. El cliente recibe el aviso de Premium y ya puede crear hasta 10 alertas.
5. A los 30 días vuelve a Free automáticamente (y se le avisa).

---

## Reglas que el bot hace cumplir (resumen)

- Un **seller** no puede: cambiarse su propio plan, tocar a un owner, tocar a otro
  seller, ni usar comandos de owner.
- El **id** debe ser numérico y haber iniciado el bot; si no, el bot te avisa.
- Premium **vencido** se trata como Free aunque no haya corrido el cron (se respeta el
  vencimiento al instante).
- Todo cambio queda en **auditoría** (no se puede borrar). Los intentos no autorizados
  también se registran.

> Detalle técnico y de seguridad completo: [17 · Roles, permisos y comandos](./17-roles-permisos-alertas.md).
