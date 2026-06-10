# 06 · UX de WhatsApp — cómo replicar los selectores de SEACE sin matar la experiencia

## 0. Capacidades nativas de Meta WhatsApp Cloud API (resumen, mid-2026)

| Tipo de mensaje | Límite | Cuándo usar |
|---|---|---|
| **Texto** | 4096 chars | Respuestas libres, descripciones |
| **Buttons (Reply Buttons)** | Hasta **3 botones**, cada uno con label máx 20 chars | Decisiones rápidas binarias/ternarias |
| **List Message** | 1 botón que abre lista con hasta **10 secciones**, **10 items por sección**, **100 items totales**. Cada item: title (24 chars) + description (72 chars) | Catálogos finitos pequeños (años, meses, objetos) |
| **Flows** | UI nativa multi-paso: dropdowns con paginación, inputs, date pickers, radios. Hasta **20 pantallas** por flow | Selectores grandes (Tipo de Selección con 89 opciones), formularios multi-campo |
| **Documento** | Hasta 100MB | Bases, Excel, PDFs |
| **Plantillas** | Aprobación previa por Meta. Categorías: Marketing, Utility, Authentication | Mensajes >24h después del último input del usuario |
| **Quick replies dentro de plantilla** | Hasta 3 botones; o 1 URL/Phone button | Notificaciones que requieren acción |
| **CTA URL Button** | 1 botón con URL externa | Abrir SEACE oficial |

Restricciones clave:
- Buttons + List Message **no se mezclan** en el mismo mensaje. Es buttons O list.
- Lists no se anidan: cada selección cierra la lista; para sub-niveles se envía un nuevo mensaje.
- Flows son la única forma de tener un picker tipo "scroll-to-find" o multi-select.

Kapso simplifica todo esto exponiendo primitivas: `sendButtons`, `sendList`, `sendFlow`, `sendDocument`, `sendTemplate`.

## 1. Mapeo SEACE → componentes de WhatsApp

| Selector SEACE | # opciones | Componente WA recomendado | Por qué |
|---|---|---|---|
| Objeto de Contratación | 4 (Bien, Servicio, Obra, Consultoría) | **Buttons** + texto "o escribe Todos" | 4 supera el límite de 3 botones → ver §2.1 |
| Versión SEACE | 2 (Seace 2 / 3) | **Buttons** (2) | Caso ideal |
| Año Convocatoria | 24 (2003-2026) | **Lista** (3 secciones: 2024-2026 destacado, 2020-2023, 2003-2019) | Lista nativa cubre fácilmente |
| Mes (OCOS) | 12 | **Lista** (2 secciones de 6) | Sobra capacidad |
| Tipo de Selección | **89** | **Flow** con dropdown searcheable | Único componente que tolera 89 |
| Departamento | 25 | **Lista** (3 secciones de ~9) | Lista alcanza |
| Provincia | 5-15 (depende depto) | **Lista** dinámica | Lista alcanza, cascadea bien |
| Distrito | 5-30 (depende prov) | **Lista** o **Flow** si >100 | Flow si pasa 100, lista si no |
| Entidad (RUC/nombre) | ~50,000+ | **Texto libre** + autocompletado por bot | No hay forma de listar todas, autocompletado server-side |
| Fechas (desde/hasta) | continuo | **Flow** con DatePicker nativo | Único componente nativo de date |
| Descripción/keywords | libre | **Texto** | Trivial |
| Código SNIP / CUI | libre | **Texto** | Trivial |

## 2. Patrones de diseño

### 2.1 Patrón "Botones + escape texto" (cuando hay 4 opciones)

WhatsApp solo permite 3 botones. Para "Objeto de Contratación" hay 4 opciones (Bien, Servicio, Obra, Consultoría). Dos caminos:

**Opción A — usar lista de 1 sección con 4 items (recomendada)**
```
✉️ ¿Qué tipo de objeto?
   [Selecciona ▼]
   ├ 🛒 Bien
   ├ 🛠️ Servicio
   ├ 🏗️ Obra
   └ 📐 Consultoría de Obra
   └ 🌐 Todos
```

Trade-off: 1 toque para abrir lista vs 0 toques de botón.

**Opción B — 3 botones + "más opciones"**
```
[🛒 Bien] [🛠️ Servicio] [🏗️ Obra]
✏️ Escribe "Consultoría" o "Todos" para esas opciones.
```

Trade-off: confusión textual. **Preferimos A** por consistencia visual.

### 2.2 Patrón "Cascada con sub-listas"

Para Departamento → Provincia → Distrito, cada paso envía un nuevo mensaje con lista:

```
Bot: 📍 ¿Departamento?
     [Selecciona ▼]
     │ Lima · Cusco · Arequipa · ...

User: [tap Cusco]

Bot: 📍 ¿Provincia de Cusco?
     [Selecciona ▼]
     │ Cusco · Acomayo · Anta · Calca · ...

User: [tap Cusco]

Bot: 📍 ¿Distrito de Cusco/Cusco?
     [Selecciona ▼]
     │ Cusco · Ccorca · Poroy · San Jerónimo · ...
```

Cada respuesta dispara un AJAX al worker (warm session) que abre el select correspondiente en SEACE y recibe las opciones del siguiente nivel. Caché agresivo en Redis (estas listas casi nunca cambian).

### 2.3 Patrón "Flow para selector gigante" (Tipo de Selección, 89 opciones)

Aquí WhatsApp Flows es indispensable. Definimos un Flow con una sola pantalla:

```json
{
  "screens": [{
    "id": "TIPO_SELECCION",
    "title": "Tipo de Selección",
    "data": {},
    "layout": {
      "type": "SingleColumnLayout",
      "children": [
        {
          "type": "Dropdown",
          "label": "Selecciona el tipo",
          "name": "tipo_seleccion",
          "data-source": [
            { "id": "790", "title": "Adjudicación Abreviada" },
            { "id": "271", "title": "Adjudicación Simplificada" },
            { "id": "590", "title": "Concurso Público" },
            { "id": "490", "title": "Licitación Pública" },
            "... (89 items)"
          ],
          "required": true
        },
        {
          "type": "Footer",
          "label": "Continuar",
          "on-click-action": {
            "name": "complete",
            "payload": { "tipo_seleccion": "${form.tipo_seleccion}" }
          }
        }
      ]
    }
  }]
}
```

El usuario ve un dropdown nativo searcheable. La respuesta llega al webhook con el `id` ("790") y el `title` legible.

**Mejora UX**: agrupar los 89 tipos en 4-5 categorías visibles primero (Adjudicación, Concurso, Contratación Directa, Licitación, etc.) y solo mostrar las opciones del grupo elegido. Eso se implementa con un Flow de 2 pantallas: pantalla 1 (radio con 5 categorías) → pantalla 2 (dropdown con los ~15-30 items de esa categoría).

### 2.4 Patrón "Búsqueda de entidad por texto"

50,000+ entidades no caben en ninguna lista. Solución:

```
Bot: 🏛️ ¿De qué entidad? Escribe nombre, sigla o RUC.

User: minsa

Bot: Encontré 3 coincidencias:
     [Lista]
     ├ MINISTERIO DE SALUD (RUC 20131373237)
     ├ MINSA - HOSPITAL CAYETANO HEREDIA
     └ MINSA - INSTITUTO NACIONAL DE SALUD

User: [tap MINISTERIO DE SALUD]

Bot: ✅ Filtraré por MINISTERIO DE SALUD. ¿Algo más?
```

Bajo el capó, el bot:
1. Consulta `entities` en Supabase con `nombre ILIKE '%minsa%' OR sigla ILIKE '%minsa%' OR ruc = 'minsa'` (ya con `pg_trgm`).
2. Si <10 hits → muestra lista directa.
3. Si >10 → pide refinar: "Hay 47 coincidencias. Sé más específico o pega el RUC".
4. Si 0 hits en cache → llama al modal de búsqueda de entidad de SEACE (lupa al lado del campo) y popula `entities`.

### 2.5 Patrón "Resumen de filtros antes de buscar"

Antes de disparar la búsqueda real, el bot confirma:

```
Bot: 📋 Resumen de tu búsqueda:
     • Entidad: MINISTERIO DE SALUD
     • Año: 2026
     • Objeto: Obra
     
     ¿Buscamos?
     [✅ Buscar] [✏️ Modificar] [❌ Cancelar]
```

Esto evita gastar un scrape por error de tipeo. Es **muy importante en SEACE** porque las búsquedas son lentas y reCAPTCHA penaliza.

### 2.6 Patrón "Tarjeta de resultado individual"

Cada proceso se muestra como un bloque de texto + 3 botones de acción:

```
1️⃣ LP-001-2026-MINSA/OBRAS
🏥 MINISTERIO DE SALUD
🏗️ Obra · 💵 S/ 1,972,856 · 📅 25/05/2026

CONSTRUCCION DE PUENTE; CAMINO VECINAL AM-608
EL PALTO, YAMON, UTCUBAMBA

[Ver ficha] [Bases] [Cronograma]
```

3 botones es el máximo. Si hace falta más, se ofrece "Ver más opciones" que abre un mensaje secundario.

### 2.7 Patrón "Pagineo de resultados"

WhatsApp no soporta carousel/scroll horizontal. Los resultados se muestran como N mensajes consecutivos (5 por defecto), con un mensaje final:

```
Bot: Te muestro los 5 más recientes de 47 resultados.
     [Ver 5 más] [Refinar] [Suscribirme] [Cancelar]
```

### 2.8 Patrón "Notificación de suscripción (>24h)"

Cuando una alerta dispara más de 24h después del último mensaje del usuario, hay que usar **plantilla**:

```
Plantilla aprobada: "subscription_hit_v1" (categoria UTILITY)
"Hola {{1}}, tu alerta '{{2}}' encontró {{3}} nuevo(s) proceso(s) hoy.
Toca para ver los detalles."
[Ver procesos]  ← Quick Reply Button
```

Cuando el usuario toca "Ver procesos", la ventana de 24h se reabre y el bot puede enviar mensajes libres con la lista.

## 3. Flow ejemplo: filtros completos en un solo flow

Para usuarios avanzados (o el rol "investigador"), un Flow único con todos los filtros es más eficiente que 6 mensajes ida-y-vuelta:

```
Pantalla 1 — Filtros básicos:
  • Dropdown: Año
  • Dropdown: Objeto
  • Input texto: Entidad (con auto-complete server-side)
  • Botón "Siguiente"

Pantalla 2 — Filtros opcionales:
  • Dropdown: Departamento
  • Date picker: Fecha desde
  • Date picker: Fecha hasta
  • Input texto: Palabra clave
  • Botón "Buscar"

Pantalla 3 — Resumen + confirmación
  • Muestra filtros elegidos
  • Botón "Confirmar" envía completarse → webhook con payload
```

Beneficio: 3 toques de WhatsApp en lugar de 8-10 mensajes.
Costo: el Flow es más complejo de testear y requiere aprobación de Meta si se distribuye a nivel comercial.

## 4. Bottom line por flujo del bot

| Flujo (cap 03) | Componentes WA |
|---|---|
| Menú principal | List Message (3-5 items) |
| Elegir tipo de búsqueda | Buttons (3) o List (4+) |
| Tipear nombre de entidad | Texto + List dinámica con resultados |
| Elegir año | List (3 secciones) |
| Elegir objeto | List (1 sección, 5 items) |
| Elegir tipo de selección | **Flow** (1 pantalla, dropdown con 89 items) |
| Cascada Dept→Prov→Dist | List × 3 mensajes |
| Rango de fechas | **Flow** (1 pantalla, 2 date pickers) |
| Búsqueda avanzada completa | **Flow** (2-3 pantallas) |
| Confirmar antes de buscar | Buttons (3: Sí / Editar / Cancelar) |
| Mostrar resultados | Texto + Buttons por tarjeta |
| Más resultados | Buttons en último mensaje |
| Crear suscripción | List (frecuencia) + Buttons (confirmar) |
| Mis suscripciones | Texto + Buttons por suscripción |
| Notificación de alerta (>24h) | **Plantilla** UTILITY + Quick Reply |
| Entregar archivo | Documento + caption |
| Ayuda | Texto + List (categorías de ayuda) |

## 5. Anti-patrones que evitar

| ❌ Anti-patrón | Por qué no | ✅ Alternativa |
|---|---|---|
| Lista con 100 items planos | UX terrible, scroll infinito | Flow con dropdown o agrupación en secciones temáticas |
| Mandar 20 procesos en un solo mensaje | Texto se corta en 4096 chars; usuario se pierde | Paginar 5 por mensaje, ofrecer "ver más" |
| Dejar al usuario tipear año en formato libre | Errores ("2,026", "26") → falla scrape | List con años predefinidos |
| Pedir múltiples filtros en texto separados por comas | Casi nadie sigue el formato | Flow secuencial pantalla por pantalla |
| Botón "Buscar" sin previo resumen | Búsqueda errónea quema sesión scraping | Confirmar primero |
| Notificación "tienes 60 procesos nuevos" sin agrupar | Spam, usuario silencia | Mensaje resumen + link a vista detallada |
| Mostrar el `nidConvocatoria` al usuario | Token interno, asustador | Botones legibles ("Ver ficha", "Bases") |
| Lista con descripción en mayúsculas y sin acentos (como SEACE) | Difícil de leer | Capitalizar y normalizar |

## 6. Idioma e iconografía

- Tono: **tú** (no "usted"), informal pero profesional. El usuario peruano del SEACE es típicamente proveedor del Estado, ingeniero, abogado, gerente comercial; espera eficiencia.
- Emojis: solo funcionales (🏥, 💵, 📅, 📍). Nunca decorativos.
- Acrónimos: expandir la primera vez por sesión ("RUC = Registro Único de Contribuyentes", "SEACE = Sistema Electrónico de Contrataciones del Estado").
- Sin "señor/señora" forzado, sin "estimado usuario".
- Errores en lenguaje humano: "SEACE está caído ahora" en lugar de "ERR_TIMEOUT".

## 7. Accesibilidad

- Texto suficientemente contrastado (el cliente de WhatsApp se encarga).
- Sin depender solo de color para significado.
- En tablas largas (cronogramas) usar formato lista con bullets, no tablas de texto monoespaciado (no se renderizan).
- Voz: no soportada inicialmente (WhatsApp manda audios; Meta tiene Whisper pero no integrado). Roadmap.

## 8. Testing UX

Cada flow nuevo se prueba con:
1. **Smoke** end-to-end: con un número de prueba contra Kapso sandbox + worker mock.
2. **Tap-tap-tap** real: 3 personas haciendo búsquedas a ciegas, medir tiempo a primer resultado.
3. **Adversarial**: usuario tipea cosas raras ("aaaaa", emojis, links). El bot no debe romperse, debe pedir reintento.

## 9. Resumen

- Buttons para 2-3 opciones.
- Lista para 4-100 opciones agrupables.
- Flows para selectores gigantes, fechas, formularios multicampo.
- Cascadas como mensajes consecutivos con List.
- Confirmar antes de scrapear.
- Resultados como tarjetas con 3 botones de acción.
- Notificaciones diferidas vía plantilla, expanden ventana al primer tap.
- Tono directo, sin floritura.

Si todo lo anterior se respeta, el bot replica los selectores de SEACE en 3-5 toques por consulta, contra los 8-12 clicks que toma navegar la web directamente.

---

## 10. Flujo concreto del MVP — Búsqueda ACF (canónico)

> **Esta es la spec del módulo de Búsqueda ACF.** Estructura elegida: **Variante A
> (menú dinámico de filtros con resumen acumulativo) + "empujón suave"**. Es la
> evolución corregida de `docs/flujo.md`. Las secciones §1-§9 son referencia
> general; ésta es la que se implementa primero. Aplica solo a `tab=acf`.

### 10.1 Principio

Lo **único obligatorio es el objeto**. Todo lo demás (entidad, tipo de selección,
fechas) es **opcional** y se agrega desde un menú con resumen acumulativo. "Buscar
ahora" está disponible en todo momento tras elegir el objeto.

### 10.2 Componentes WhatsApp por paso

| Paso | Componente |
|---|---|
| Menú principal | List (Anuncios futuros · Mis alertas · Consultar entidad · Ayuda) |
| Objeto (obligatorio) | List (1 sección, 4 items) |
| Menú dinámico de filtros | Buttons (Buscar ahora + agregar filtro) / List si >3 acciones |
| Resolver entidad | Texto libre → List de coincidencias |
| Tipo de selección | **Flow** (dropdown 89, agrupado por categoría) |
| Rango de fechas | **Flow** (2 date pickers; validar desde ≤ hasta) |
| Empujón suave (búsqueda amplia) | Buttons (Buscar todos / Filtrar por entidad) |
| Resultados ≤5 | Tarjetas ACF en chat |
| Resultados >5 | Resumen + **PDF ficha-por-anuncio** (documento) |
| Suscribirse | Buttons (frecuencia) → Buttons (duración) |

### 10.3 Happy path (A2 — objeto solo → PDF → suscripción)

```
Bot: 👋 Bienvenido a ContrataBot. ¿Qué deseas hacer?
     ▼ [Ver opciones]
       📅 Anuncios de Contratación Futura
       🔔 Mis alertas
       🔎 Consultar entidad
       ❓ Ayuda

User: [📅 Anuncios de Contratación Futura]

Bot: Para empezar elige el objeto (obligatorio):
     ▼  🏗️ Obra · 🛒 Bien · 🛠️ Servicio · 📐 Consultoría
User: [🏗️ Obra]

Bot: ✅ Filtros actuales: Obra
     ¿Buscas así o quieres afinar?
     [🔍 Buscar ahora]  [➕ Agregar filtro]

User: [🔍 Buscar ahora]      ← va a búsqueda amplia → EMPUJÓN SUAVE:

Bot: Vas a ver TODOS los anuncios futuros de Obra (suelen ser varios).
     ¿Buscar así o acotar por entidad?
     [🌎 Buscar todos]  [🏢 Filtrar por entidad]
User: [🌎 Buscar todos]

Bot: 🔎 Buscando anuncios futuros...
Bot: Encontré 28 anuncios de Obra. Como son varios, te los envío en PDF 👇
     📄 anuncios-futuros-obra.pdf
     [🔔 Suscribirme]  [✏️ Refinar]

User: [🔔 Suscribirme]
Bot: ¿Cada cuánto te aviso?
     [⚡ Inmediata (Premium)]  [1 vez al día]  [1 vez a la semana]
User: [1 vez al día]
Bot: ¿Por cuánto tiempo? [1 día]  [1 semana]   (Premium: +1 mes / Sin vencimiento)
User: [1 semana]
Bot: ✅ Alerta creada · Obra · Todas · diaria · vence en 1 semana
     Gestiónala en /alertas
```

### 10.4 Sub-flujo: agregar filtro "Entidad" (resolvedor compartido)

El usuario **no necesita el RUC**: escribe nombre, sigla o RUC y el bot resuelve
contra `entities` (pg_trgm) mostrando el RUC en cada opción.

```
User: [➕ Agregar filtro] → [🏢 Entidad]
Bot:  Escribe el nombre, sigla o RUC. Ej: "GORE Piura", "Muni Sullana", 20154265061
User: Piura
Bot:  Encontré varias, ¿cuál?
      ▼  GOBIERNO REGIONAL DE PIURA (RUC 20154...)
         MUNICIPALIDAD PROVINCIAL DE PIURA (RUC ...)
         HOSPITAL SANTA ROSA — PIURA (...)
      [No es ninguna / refinar]
User: [GOBIERNO REGIONAL DE PIURA]
Bot:  ✅ Filtros actuales: Obra + GOBIERNO REGIONAL DE PIURA
      [🔍 Buscar ahora]  [➕ Agregar filtro]
```

Casos borde:
- **RUC pegado** → match directo, se salta la lista ("✅ … confirmado por RUC").
- **Demasiadas coincidencias (>10)** → "Hay 312 con 'muni'. Sé más específico o pega
  el RUC." + opción `[📄 Ver directorio de <depto>]` (PDF de respaldo).
- **0 en cache** → el worker abre el modal de entidad de SEACE, puebla `entities` y
  reintenta (depende del pre-crawl de entidades, F4.5).

**Resolvedor compartido**: el mismo componente se usa standalone (Módulo 5,
`/entidad` o "🔎 Consultar entidad"); al resolver, ofrece
`[📅 Ver anuncios futuros de esta entidad]` y `[🔔 Crear alerta]` para enlazar de
vuelta a este flujo. Con entidad elegida, la alerta es **A1**; sin ella, **A2**.

### 10.5 Tarjeta ACF (resultados ≤5) — distinta a la genérica §2.6

ACF **no tiene ficha/bases/cronograma** (sin `nidProceso`). La tarjeta lleva solo
datos + descripción truncada:

```
1️⃣ MUNICIPALIDAD DISTRITAL DE KAÑARIS
📅 Publicado 29/05/2026 · 📐 Consultoría de Obra
🗓️ Conv. aprox. 03/08/2026 · ⏱️ 45 días
"Supervisión de la obra Mejoramiento y Ampliación del Servicio de Atención de
 Salud Básicos en La Succha…"
[Ver descripción completa]
```

`[🔔 Suscribirme]` va en el mensaje final (no por tarjeta).

### 10.6 PDF "ficha por anuncio" (resultados >5)

Umbral: **>5 → PDF**. Se **renderiza desde las filas de `processes`** (no del xlsx),
una ficha por anuncio con la descripción completa (formato elegido en §10, ver
mockup en la decisión de producto). Generado **al vuelo** en el worker (sin guardar,
para no servir PDFs obsoletos: la data ACF cambia a diario). 10 columnas =
entidad, publicación, tipo, objeto, descripción, alcance, cantidad, plazo, conv.

### 10.7 Reglas transversales

- **Objeto siempre primero y obligatorio.** Sin objeto no hay "Buscar ahora".
- **Empujón suave** solo cuando se busca sin ningún filtro de alcance (camino A2).
- **Frecuencia/duración** gateadas por tier (`09` §2.3). Copy: la opción `hourly` es
  **"⚡ Inmediata (al detectar)"** — nunca "tiempo real" ni "instantáneo".
- **Estado del flujo en Redis** (`conv:{phone}`): `{ flow:'acf-search', step,
  filters:{ objeto, entityRuc?, tipoSeleccionIds?, fechaDesde?, fechaHasta? } }`.
  El menú dinámico se re-pinta desde `filters`.
- **Suscribirse en 2 puntos**: post-búsqueda (hereda `filters`) y desde el menú
  (arma `filters` y guarda). Ambos → mismo `POST /subscriptions`.