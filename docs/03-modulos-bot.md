# 03 · Módulos y flujos conversacionales del bot

## Principios de diseño UX

1. **El usuario nunca escribe lo que puede tocar.** Listas y botones siempre que sea posible.
2. **Hay máximo 3 niveles antes del resultado.** Pasos largos rompen el flujo en chat.
3. **Cada paso muestra el filtro acumulado.** Para que el usuario sepa qué está pidiendo.
4. **Siempre hay salida.** Cada estado tiene "Cancelar" o "Volver al inicio".
5. **El bot promete poco.** Si algo puede tardar, lo dice. Si falla, propone alternativa.

## Mapa de flujos (alto nivel)

```
                          /start
                            │
                ┌───────────┴────────────┐
                ▼                        ▼
        [MENÚ PRINCIPAL]          (deep links de Kapso:
                │                  WA me/+51... ?text=...)
   ┌────────────┼────────────────────────────┐
   ▼            ▼                            ▼
 1.Buscar    2.Mis            3.Otras consultas
 procesos    suscripciones    (entidad, RUC, ayuda)
```

## Módulo 1 — Búsqueda de procesos (core)

El módulo más importante. Mapea a las 6 pestañas de SEACE pero las **agrupa por intención** del usuario, no por nomenclatura interna del Estado.

### 1.1 Submódulo "¿Qué quieres buscar?"

Primer paso. Lista interactiva nativa de WhatsApp (3-5 items max recomendado por UX):

```
🔎 ¿Qué información de SEACE buscas?

  [📋 Procesos de selección]  ← Procedimientos de Selección
  [📅 Anuncios próximos]      ← Anuncio de Contratación Futura
  [📝 Otros tipos]            ← submenu (Exp. Interés, Difusión, OCOS, CCO)
```

Si elige "Otros tipos" se muestra una segunda lista:
```
  [💬 Expresiones de interés]
  [📢 Difusión de requerimientos]
  [🛒 Órdenes de compra/servicio]
  [⚖️ Condiciones de contratación]
```

### 1.2 Submódulo "Buscar Procesos de Selección"

Es el flujo más usado. Cuatro vectores de búsqueda excluyentes:

| Vector | UX | SEACE filter |
|---|---|---|
| **Por entidad** | Usuario tipea nombre/RUC, el bot resuelve match contra cache de entidades | `nombreEntidad` o RUC (vía modal) |
| **Por nomenclatura** | Pega el código tipo `LP-001-2026-MINSA` | `numeroSeleccion` |
| **Por objeto** | Lista: Bien, Servicio, Obra, Consultoría | `cbxObjContratacion_input` |
| **Por palabras clave** | Tipea descripción libre | `descripcionObjeto` |

**Flujo recomendado: por entidad** (el más demandado)

```
Bot: ¿De qué entidad quieres ver procesos?
     Escribe el nombre, sigla o RUC. Ej: MINSA, 20131373237

User: MINSA

Bot: Encontré estas coincidencias:

     1️⃣ MINISTERIO DE SALUD (RUC 20131373237)
     2️⃣ MINSA - HOSPITAL CAYETANO HEREDIA (RUC ...)
     3️⃣ MINSA - INSTITUTO NACIONAL DE SALUD (RUC ...)

     Responde con el número o "ninguna" para refinar.

User: 1

Bot: Perfecto. ¿Qué año?
     [Lista: 2026 · 2025 · 2024 · Otro año]

User: [tap 2026]

Bot: ¿Qué tipo? (puedes elegir varios o "Todos")
     [Lista: 🏗️ Obra · 🛒 Bien · 🛠️ Servicio · 📐 Consultoría de Obra · Todos]

User: [tap Obra]

Bot: 🔎 Buscando obras de MINISTERIO DE SALUD del 2026...

      (3-8 segundos)

Bot: Encontré 47 procesos. Te muestro los 5 más recientes:

     1) LP-001-2026-MINSA/OBRAS — Construcción Hospital X
        💵 S/ 1,972,856 · 📅 25/05/2026
        [Ver ficha] [Bases] [Cronograma]

     2) AS-012-2026-MINSA — Mantenimiento Centro Y
        💵 S/ 350,000 · 📅 23/05/2026
        [Ver ficha] [Bases] [Cronograma]

     ...

     [Ver más resultados] [Refinar búsqueda] [Suscribirme a esta búsqueda]
```

### 1.3 Submódulo "Suscribirme a esta búsqueda"

Al final del listado siempre aparece el CTA. Al pulsarlo:

```
Bot: Te avisaré cuando MINISTERIO DE SALUD publique nuevos procesos de Obra.
     ¿Cada cuánto quieres recibir el aviso?
     [Tiempo real (cada hora)] [1 vez al día] [1 vez a la semana]

User: [1 vez al día]

Bot: ✅ Suscripción creada.
     Te escribiré cada día a las 8:00 am con los procesos nuevos.
     Para gestionar tus suscripciones escribe /suscripciones o usa el menú.
```

### 1.4 Submódulo "Refinar búsqueda"

Si el resultado es grande (>20), bot ofrece refinar añadiendo filtros opcionales:

```
Bot: Tienes 154 resultados. ¿Quieres acotar?
     [Por rango de fechas] [Por departamento] [Por palabra clave] [Mostrar todos]
```

- **Rango de fechas**: pide "desde" y "hasta" usando Flow de Meta (datepicker nativo) o input texto.
- **Departamento**: lista de 25 regiones de Perú + Lima Metropolitana, paginada en 2 listas.
- **Palabra clave**: input texto libre que mapea a `descripcionObjeto`.

### 1.5 Submódulo "Anuncios próximos" (ACF)

Más simple que Procedimientos. Una pestaña, una pregunta obligatoria.

```
Bot: 📅 Buscador de Anuncios de Contratación Futura

     Selecciona qué quieres ver:
     [🏗️ Obras] [🛒 Bienes] [🛠️ Servicios] [📐 Consultoría]

     (luego) ¿Filtrar por entidad o ver todos?
     [Todos] [Por entidad]
```

### 1.6 Submódulo "Órdenes de compra y servicio"

OCOS requiere Año + Mes obligatorios. Se asume que aquí el usuario es más experto (típicamente proveedor que quiere ver sus órdenes).

```
Bot: 🛒 Búsqueda de Órdenes de Compra/Servicio

     ¿De qué año?
     [2026] [2025] [2024] [Otro]

User: [2026]

Bot: ¿De qué mes?
     [Lista de 12 meses paginada en 2 listas de 6]

User: [Mayo]

Bot: ¿Por qué quieres filtrar?
     [Por entidad contratante]
     [Por RUC del contratista (proveedor)]
     [Ver todos]
```

### 1.7 Submódulo "Expresiones de Interés / Difusión de Requerimientos / Condiciones de Contratación"

Estos 3 son nicho. Flujo unificado y minimalista:

```
Bot: 💬 Expresiones de Interés
     
     ¿Para qué tipo de objeto?
     [Bien] [Servicio] [Obra] [Consultoría]
     
     (Opcional) ¿De qué entidad? Tipea o "saltar".
     
     ...muestra resultados similar a 1.2
```

## Módulo 2 — Detalle de un proceso (Ver ficha)

Al pulsar "Ver ficha" en un resultado:

```
Bot: 📋 LP-001-2026-MINSA/OBRAS

     🏛️ Entidad: MINISTERIO DE SALUD
     📅 Publicado: 25/05/2026 11:15
     📦 Objeto: Obra
     💵 Valor referencial: S/ 1,972,856.46
     🆔 Versión SEACE: 3
     📍 Estado: Convocada
     
     Descripción:
     CONSTRUCCION DE PUENTE; EN EL(LA) CAMINO VECINAL AM-608
     EN LA LOCALIDAD EL PALTO, DISTRITO DE YAMON,
     PROVINCIA UTCUBAMBA...
     
     ¿Qué quieres ver?
     [📄 Bases] [📅 Cronograma] [👥 Postores] [🔗 Link SEACE]
```

- **Bases**: descarga el PDF desde URL repositorio (Supabase Storage proxy), lo envía como documento WhatsApp (límite 100MB).
- **Cronograma**: parse de la sección "Calendario" de la ficha; render como tabla en texto.
- **Postores**: solo aparece si el proceso ya tiene postores registrados (típicamente después de la presentación).
- **Link SEACE**: deep link a la página oficial (para abrir en navegador).

## Módulo 3 — Mis suscripciones

```
User: /suscripciones (o tap en menú)

Bot: Tus suscripciones activas (3):

     1) 🏥 MINISTERIO DE SALUD · Obras · Diaria
        Último aviso: hace 2 días (3 procesos nuevos)
        [Pausar] [Eliminar]
     
     2) 🏗️ Cualquier entidad · Obras · Lima · Semanal
        Último aviso: hace 5 días (12 procesos nuevos)
        [Pausar] [Eliminar]
     
     3) 🔍 Palabra clave: "ambulancia" · Diaria
        Último aviso: hoy (0 procesos)
        [Pausar] [Eliminar]
     
     [➕ Nueva suscripción]
```

Operaciones por suscripción: pausar, reactivar, eliminar, cambiar frecuencia.

Límites del MVP:
- Máx 10 suscripciones por usuario (para evitar spam y costos de scraping).
- Frecuencias: tiempo real (cada 1h), diaria (8am), semanal (lunes 8am).
- Cuotas: si una suscripción genera >50 alertas en una corrida, se agrupa en un solo mensaje "MINSA publicó 60 procesos. [Ver todos]".

## Módulo 4 — Entrega de archivos

Cuando un proceso tiene anexos (bases, pliego absolutorio, acta, etc.), el bot:

1. Verifica que el archivo esté en Supabase Storage (lo descarga la primera vez vía Playwright/scraper).
2. Genera URL firmada (válida 1h).
3. Envía como adjunto WhatsApp con caption: nombre del documento + entidad + nomenclatura.

Si el archivo pesa >100MB (límite de WhatsApp para documentos):

```
Bot: 📄 Las bases de LP-001-2026-MINSA pesan 187MB y excede el límite de WhatsApp.
     Aquí tienes el link directo (válido por 24h):
     https://...supabase.co/storage/v1/...
```

## Módulo 5 — Búsqueda de entidad (auxiliar)

Comando dedicado para resolver dudas:

```
User: /entidad MINSA  (o "ruc minsa")

Bot: Entidades que coinciden con "MINSA":

     • MINISTERIO DE SALUD — RUC 20131373237
     • MINSA - HOSPITAL CAYETANO HEREDIA — RUC ...
     • MINSA - INSTITUTO NACIONAL DE SALUD — RUC ...
     
     [Buscar procesos de la primera]
```

Internamente usa el modal de búsqueda de entidad de SEACE (campo `txtNombreEntidad`).

## Módulo 6 — Ayuda y onboarding

Primera vez que un número escribe:

```
Bot: 👋 ¡Hola! Soy el asistente de SEACE en WhatsApp.
     Te ayudo a buscar procesos de contratación del Estado peruano
     sin tener que entrar a la web.
     
     ¿Qué puedo hacer por ti?
     [🔎 Buscar procesos]
     [📅 Ver anuncios próximos]
     [🔔 Configurar alertas]
     [❓ Ver todo lo que puedo hacer]
```

Comandos textuales (también activan flujos):
- `/start`, `/menu` → menú principal
- `/buscar [texto]` → atajo de búsqueda libre
- `/suscripciones` → módulo 3
- `/entidad [nombre]` → módulo 5
- `/ayuda` → ayuda completa
- `/cancelar` → resetea flujo activo

## Manejo de errores y edge cases

| Caso | Respuesta del bot |
|---|---|
| SEACE no responde (timeout) | "SEACE está respondiendo lento. Lo intento de nuevo en 1 min. 🕐" + retry automático |
| reCAPTCHA bloqueó al worker | Job reencolado con delay 2 min. Si vuelve a fallar 3 veces, mensaje al usuario "SEACE no nos deja pasar ahora. Intenta en 15 min." |
| 0 resultados | "No encontré procesos con esos filtros. [Ampliar búsqueda] [Empezar de nuevo]" |
| >500 resultados | "Hay 587 resultados, demasiados para mostrarlos todos. Vamos a acotar. [Refinar]" |
| Usuario inactivo en flujo (>30 min) | Borrado de sesión Redis; próximo mensaje vuelve a menú principal |
| Mensaje no reconocido | "No entendí. Escribe /menu para ver opciones." (3 strikes → menú forzado) |

## Métricas que el bot debe registrar

| Evento | Para qué |
|---|---|
| `search.started` (filters, user_id) | Heatmap de uso |
| `search.completed` (ms, n_results) | Latencia y conversion |
| `search.failed` (error_class) | Detección de cambios en SEACE |
| `result.detail_viewed` (process_id) | Engagement |
| `file.downloaded` (file_type, size) | Storage cost |
| `subscription.created/triggered/dismissed` | Retención |
| `bot.error` (stack, conv_state) | Bugs |

## Roadmap de flujos (post-MVP)

- **Búsqueda por mapa**: "procesos cerca de mí" usando `departamento_input`+`provincia_input`+`distrito_input`.
- **Comparador**: 2 procesos lado a lado.
- **Watch list**: marcar procesos individuales y avisar cuando cambie el estado.
- **Alertas por monto**: notificar solo si valor referencial > X.
- **Análisis**: "muéstrame las 10 entidades que más contrataron en mayo".
- **Export por mail**: si el usuario pide >50 resultados, ofrecer enviarlos como Excel a su email.