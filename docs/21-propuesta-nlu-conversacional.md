# Propuesta: Bot conversacional con IA (NLU-first, sin pasos guiados)

> Contrapropuesta a `docs/20-propuesta-ia-acf.md`, aterrizada al código actual.
> Estado: propuesta técnica para validar.
>
> **Tesis:** el usuario escribe lo que quiere en lenguaje natural y el bot lo
> resuelve en un solo turno. Los botones no desaparecen: dejan de ser el camino
> obligatorio y pasan a ser accesos rápidos, desambiguación y fallback.
> **Sin pgvector ni embeddings en esta fase** — el mismo resultado se logra con
> NLU + sinónimos + el filtro `ILIKE` que ya existe (`processes.repo.ts`).

---

## 1. Qué cambia para el usuario

**Hoy** (wizard rígido):

```
Usuario: [Anuncios futuros] → [🏗️ Obra] → [Filtrar entidad] → "GORE Piura"
         → [elige de la lista] → [🔍 Buscar ahora]
```

**Propuesto** (un solo mensaje):

```
Usuario: obras para colegios en Piura
Bot:     🔍 3 anuncios de Obra (colegios · Piura)
         [tarjeta paginada de siempre, con PDF y 🔔 Avísame]
```

Más ejemplos que debe resolver el mismo mecanismo:

| Mensaje | Acción |
|---|---|
| "anuncios de servicios" | Búsqueda ACF objeto=servicio |
| "muéstrame carreteras del GORE Cusco" | objeto=obra, keyword=carretera, entidad resuelta |
| "avísame cuando salgan hospitales en Lima" | Crear alerta (hereda filtros extraídos) |
| "mis alertas" | Abre gestión de alertas |
| "¿qué RUC tiene la muni de Sullana?" | Lookup de entidad (flujo `/ent` existente) |
| "hola" / "qué puedes hacer" | Saludo + hint de lenguaje natural + menú |
| "obras pero no carreteras" | Búsqueda con exclusión (fase 3) |

El menú de botones sigue existiendo (`/start`, "menú") y cada paso del wizard
actual sigue funcionando — nadie queda obligado a escribir.

---

## 2. Principio de diseño (heredado del doc 20, se mantiene)

**La IA solo interpreta; el sistema ejecuta.**

| Tarea | Responsable |
|---|---|
| Entender el mensaje, extraer intención + filtros + sinónimos | LLM (1 llamada) |
| Resolver entidad/ubicación contra el catálogo | `EntitySearchService` (ya existe) |
| Buscar | `SearchFacade` + `processes.repo` con `ILIKE ANY(sinónimos)` |
| Presentar resultados | `AcfResultsPresenter` (plantilla, **sin IA**) |
| Crear/gestionar alertas | `SubscribeFlow` (ya existe, hereda filtros vía `lastAcf`) |

Diferencia clave con el doc 20: **se elimina la etapa embeddings/pgvector**.
El LLM ya expande "colegio" → `["colegio", "escuela", "I.E.", "institución
educativa", "educativo"]` en la misma llamada del NLU; esos términos van
directo al filtro SQL existente. Con ~180 anuncios ACF (~43 por objeto), eso
da la misma cobertura semántica que el RAG propuesto, sin migración de BD,
sin crawler modificado y sin segundo proveedor. El diseño RAG del doc 20 queda
reservado para la pestaña **Procedimientos** (miles de filas), donde sí se paga.

---

## 3. Arquitectura

### 3.1. Dónde se intercepta el texto libre

Hoy `MainMenuFlow` tira cualquier texto libre al menú (`default:` en
`main-menu.flow.ts`). Ese es exactamente el punto de entrada del NLU:

```
ConversationService.processInbound
  ├─ admin router            (igual que hoy, corta antes)
  ├─ comandos globales       (menú/salir, /ent, /misalertas — igual que hoy)
  ├─ flujo activo espera texto libre  → va al flujo (awaiting-entity, etc.)
  ├─ input es id de botón (`^\w+:`)   → va al flujo (igual que hoy)
  └─ texto libre en main-menu/idle    → NUEVO: NluRouterFlow
```

Regla de enrutamiento (determinista, sin IA):

1. Ids de botón (`acf:buscar`, `acfpage:2`, `objeto:obra`…) → flujos actuales.
2. Comandos (`/...`, "menú", "salir"…) → igual que hoy.
3. El flujo activo está en un paso que espera texto (p. ej. `awaiting-entity`
   de `SearchAnunciosFlow`, pasos de `SubscribeFlow`) → ese texto es para el
   flujo, NO para el NLU. Se implementa con una marca `expectsFreeText` por
   paso (hoy implícito en cada flow; se hace explícito).
4. Todo lo demás → `NluRouterFlow`. Esto reemplaza el `default:` de
   `MainMenuFlow` que hoy responde con el menú.

Así el NLU nunca "roba" input a un wizard a medio camino, y el usuario puede
escribir lenguaje natural desde el estado normal de la conversación (que es
donde hoy recibe el menú).

### 3.2. Módulo nuevo

```
src/modules/ai/
├── ai.module.ts
├── nlu-router.flow.ts        # Flow que orquesta: intent → acción → presenter
├── intent.service.ts         # 1 llamada LLM (tool use / structured output)
├── intent.schema.ts          # Zod: unión discriminada de intents
├── llm.port.ts + adapters/   # Port agnóstico de proveedor (como pide doc 20 §12)
└── prompts/
    └── nlu.system.prompt.ts
```

`NluRouterFlow` es un `Flow` más (implementa `handle(ctx)`), registrado en
`FlowRegistry`. No toca `ConversationService` salvo la regla de enrutamiento.

### 3.3. Schema del intent (Zod, salida estructurada del LLM)

```ts
const NluIntent = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('buscar_acf'),
    objeto: z.enum(['obra', 'bien', 'servicio', 'consultoria_obra']).nullable(),
    keyword: z.string().nullable(),          // término del usuario ("colegio")
    sinonimos: z.array(z.string()).max(8),   // expansión para el ILIKE
    entidad: z.string().nullable(),          // "GORE Piura", "muni de Sullana"
    ubicacion: z.string().nullable(),        // "Piura" — NO es lo mismo que entidad
    excluir: z.array(z.string()).default([]),// "pero no carreteras" (fase 3)
    fechaDesde: z.string().nullable(),       // ISO, para fecha_aprox_conv
    fechaHasta: z.string().nullable(),
    limite: z.number().int().positive().nullable(), // "los 15 más recientes"
    quierePdf: z.boolean().default(false),   // "dame el PDF de..." → fuerza PDF
  }),
  z.object({ intent: z.literal('crear_alerta'), /* mismos campos de filtro */ }),
  z.object({ intent: z.literal('ver_alertas') }),
  z.object({ intent: z.literal('buscar_entidad'), query: z.string() }),
  z.object({ intent: z.literal('faq'), tema: z.string() }), // elige respuesta pre-escrita
  z.object({ intent: z.literal('ayuda') }),
  z.object({ intent: z.literal('fuera_de_alcance') }), // charla, spam, otros temas
]);
```

Nota deliberada: `entidad` y `ubicacion` son campos **separados**. El doc 20
las mezclaba (`entityNombre: "Piura"`). "En Piura" es una ubicación que se
resuelve contra el catálogo `entities` (GORE, munis, UGELs de Piura…); "GORE
Piura" es una entidad concreta. ACF no tiene campo región (hallazgo previo:
la tabla trae 10 columnas sin región), así que la ubicación se materializa
como *conjunto de entidades cuyo nombre matchea la zona* — y la respuesta debe
decir "de entidades de Piura", no "en Piura".

### 3.4. Ejecución por intent (todo con piezas existentes)

- **`buscar_acf`** →
  1. Si falta `objeto` (obligatorio en SEACE): UNA pregunta con los 4 botones
     de siempre; la respuesta retoma el intent guardado en `state.data`. Es el
     único paso guiado que sobrevive, porque el dato es obligatorio.
  2. `entidad`/`ubicacion` → `EntitySearchService.search()`. 1 match → directo;
     2–10 → la lista de desambiguación actual (botones); la elección retoma la
     búsqueda. La desambiguación por botones es MEJOR que texto: se conserva.
  3. `SearchFacade.search({ tab: 'anuncios_futuros', filters })` con
     `keywords: string[]` (ver §4).
  4. Resultados → `AcfResultsPresenter` tal cual (paginación in-place, PDF,
     botón 🔔 Avísame). Se guarda `lastAcf` incluyendo la keyword, para que
     "Avísame" herede también el término (hoy solo hereda objeto+entidad,
     `search-anuncios.flow.ts` §runSearch).
- **`crear_alerta`** → mismo pipeline de filtros y luego
  `SubscribeFlow.startCreate(ctx)` con el draft precargado. La confirmación de
  la alerta (frecuencia, límite del plan) sigue siendo con botones — crear una
  suscripción merece confirmación explícita.
- **`ver_alertas`** → `SubscribeFlow.startManage(ctx)` (ya existe).
- **`buscar_entidad`** → `EntityResolverFlow` con query (el path de `/ent X`).
- **`ayuda` / `fuera_de_alcance`** → respuesta plantilla + menú. **Nunca** se
  reenvía texto generado por el LLM al usuario en esta fase: cero riesgo de
  alucinación/inyección de cara al usuario.

### 3.5. Diagrama

```mermaid
flowchart TD
    A[👤 Texto libre<br/>"obras para colegios en Piura"] --> B{Router determinista<br/>¿botón/comando/paso-que-espera-texto?}
    B -- sí --> C[Flujos actuales<br/>sin cambios]
    B -- no --> D[🧠 IntentService<br/>1 llamada LLM → Zod]
    D -- inválido / timeout / límite --> E[Fallback: menú de botones<br/>experiencia actual]
    D -- ok --> F{intent}
    F -- buscar_acf --> G[EntitySearchService<br/>resuelve entidad/ubicación]
    G --> H[SearchFacade + repo<br/>ILIKE ANY sinónimos]
    H --> I[AcfResultsPresenter<br/>plantilla + 🔔 Avísame]
    F -- crear_alerta --> J[SubscribeFlow<br/>draft precargado + confirmación]
    F -- ver_alertas/entidad/ayuda --> K[Flujos existentes]
```

---

## 4. Cambios en código y BD (mínimos)

| Cambio | Alcance |
|---|---|
| `SearchFilters.keywords?: string[]` | `ports/persistence/types.ts` — junto al `keyword` actual |
| Repo: `descripcion ILIKE` con `OR` sobre `keywords` | `processes.repo.ts:37` (hoy: un solo `contains`) |
| `expectsFreeText` por paso de flow | marca explícita en los flows que piden texto |
| `NluRouterFlow` + `IntentService` + `LlmPort` | módulo nuevo `src/modules/ai/` |
| `lastAcf` guarda también `keyword`/`sinonimos` | `search-anuncios.flow.ts` / `subscribe.flow.ts` |
| Suscripciones: `keyword_terms text[]` | migración pequeña (solo fase 2, ver §6) |
| Env: `LLM_API_KEY`, `NLU_ENABLED`, límites por tier | `env.schema.ts` |

**Sin pgvector. Sin columna embedding. Sin cambios en el crawler.**

Opcional barato y determinista: extensión `unaccent` en Postgres para que
"educación"/"educacion" matcheen (o pedir al LLM sinónimos con y sin tilde —
las descripciones de SEACE van en mayúsculas y con acentuación inconsistente).

---

## 5. Guardrails (lo que hace esto seguro de lanzar)

1. **Fallback total**: Zod inválido, timeout (presupuesto ~4 s), API caída o
   límite alcanzado → se responde exactamente lo que el bot responde hoy (menú
   + hint). El NLU es una mejora progresiva, nunca un punto único de falla.
   `NLU_ENABLED=false` apaga todo el mecanismo sin deploy de emergencia.
2. **Gating por plan** — DECIDIDO: **sin límite al lanzar** (pocos usuarios;
   medir uso real con el log del punto 5 y el kill-switch como red de
   seguridad). El diseño del contador queda listo para activarse después:
   consultas NLU/día por usuario en Redis (misma infra del
   `ConversationStore`), con límites por tier a definir con datos.
3. **Sin texto libre del LLM hacia el usuario**: toda respuesta sale de
   presenters/plantillas. La superficie de prompt-injection queda reducida a
   "filtros raros", que el Zod y el catálogo de entidades neutralizan.
4. **Cache de intents**: hash del texto normalizado → intent parseado (TTL
   horas, Redis). Mensajes repetidos ("obras", "servicios") no pagan LLM.
5. **Log de cada parse** (texto → intent → resultado hallado/vacío): es el
   insumo para afinar el prompt y construye el golden set del §7.

---

## 6. Fases

**Fase 1 — Búsqueda ACF en lenguaje natural** *(el 80% del valor)*
`LlmPort` + `IntentService` + `NluRouterFlow` con `buscar_acf`, `faq`,
`ayuda` y `fuera_de_alcance`. Keywords→ILIKE, entidad vía catálogo, presenter
actual. Incluye (decisión 2026-07-09, costo cubierto):
- **Re-rank LLM**: tras el filtro SQL, los ≤50 candidatos pasan al LLM que
  devuelve solo los IDs realmente relevantes (filtra "vigilancia para el
  colegio" cuando pidieron construcción, y habilita exclusiones "pero no
  carreteras" desde el día 1). Si falla → resultado del ILIKE tal cual.
- **FAQ curada**: el LLM elige entre ~15-20 respuestas pre-escritas
  ("¿qué es un ACF?", "¿qué es CUI?"). Clasificación, no generación.
Kill-switch + logging desde el día 1 (gating diseñado, se activa después
con datos de uso).

**Fase 2 — Alertas en lenguaje natural**
`crear_alerta` y `ver_alertas`. Las alertas con keyword **congelan los
sinónimos al crearse** (columna `keyword_terms text[]`): el matcher del
fan-out sigue siendo SQL determinista — una alerta jamás depende de una
llamada a un LLM en el momento del crawl. Mapea solo a los tipos de alerta ya
soportados (objeto / objeto+entidad, + keyword como refinamiento).
Incluye el **resumen ejecutivo grounded** como feature Premium: una línea
redactada por el LLM SOLO a partir de las filas recuperadas, arriba de las
tarjetas de siempre (que siguen siendo la fuente de verdad verificable).
Único punto donde el LLM redacta texto hacia el usuario.

**Fase 3 — Refinamientos**
Aclaración multi-turno ("¿obra o servicio?" ya cae del schema con
`objeto: null`); fechas relativas finas ("este mes", "la próxima semana");
gestión de alertas por frase ("ya no me avises de carreteras").

**Fase 4 — RAG (doc 20) cuando toque Procedimientos**
pgvector + embeddings tienen sentido con miles de procesos y descripciones
largas. Ahí se retoma el doc 20 §7 tal cual (con la columna en la tabla hija,
no en `processes` base).

---

## 7. Modelo, costo y pruebas

- **Modelo** — DECIDIDO: **OpenAI, el "mini" vigente al implementar**, con
  structured outputs, detrás de `LlmPort` (cambiar de proveedor después no
  reescribe nada). La tabla del doc 20 (§8, `gpt-4o-mini`) está
  desactualizada; verificar el modelo mini actual al crear el adapter.
  MiniMax: descartado para esta pieza — el JSON estructurado es justo lo que
  no puede fallar.
- **Costo por consulta**: system prompt ~400 tokens (cacheable por proveedor)
  + mensaje ~50 + salida ~120 → fracciones de centavo. Con el gating del §5,
  el peor caso mensual es acotado y predecible.
- **Latencia**: +0.5–1.5 s sobre la búsqueda BD-first actual (que es
  instantánea). Se cubre con el "🔎 Consultando…" que ya existe (`ctx.notify`).
- **Pruebas**: `pnpm chat:sim` gana un modo NLU con `LlmPort` mockeado
  (fixtures de intents) para CI, y un golden set de ~50 frases reales
  (alimentado por el log del §5) que corre contra el LLM vivo antes de cada
  cambio de prompt. Los flows existentes no cambian → sus specs actuales
  siguen válidos.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El LLM extrae mal los filtros | Zod + objeto obligatorio re-preguntado + golden set |
| Resultados vacíos por sinónimos pobres | Log de parses vacíos → iterar prompt; fallback a búsqueda solo-objeto con aviso "no encontré 'X', te muestro todas las obras" |
| Costo/abuso | Gating por tier + cache + kill-switch `NLU_ENABLED` |
| Latencia/API caída | Timeout 4 s → experiencia actual de botones |
| Usuario mezcla texto y wizard | Regla `expectsFreeText`: el wizard siempre tiene prioridad sobre el NLU |
| "En Piura" promete más de lo que ACF permite | Copy honesto: "anuncios de entidades de Piura" |

---

## 9. Anexo: escenarios de conversación

Cómo se ve cada tipo de mensaje con la IA integrada. La respuesta siempre sale
de los presenters existentes (plantilla); la IA solo interpreta la entrada.

### Búsquedas (`buscar_acf`)

| # | Usuario escribe | Qué hace el bot |
|---|---|---|
| 1 | "obras para colegios en Piura" | objeto=obra, sinónimos=[colegio, escuela, I.E., …], entidades de Piura → tarjeta paginada de siempre. Hoy: 5 toques; con IA: 1 mensaje |
| 2 | "anuncios de servicios" | objeto=servicio, sin más filtros → equivale a [Servicio]+[Buscar ahora] |
| 3 | "qué hay para hospitales" | keyword detectada, objeto=null → ÚNICA re-pregunta (4 botones de objeto); el intent queda en `state.data` y la respuesta retoma la búsqueda |
| 4 | "obras de la muni de piura" | Entidad ambigua → lista de desambiguación actual (botones). La IA no adivina |
| 5 | "qué obras hay en Cusco" | Ubicación → entidades de Cusco vía catálogo. Copy honesto: "obras **de entidades de** Cusco" (ACF no tiene campo región) |
| 6 | "obras de puentes colgantes en Tacna" (sin match) | Degradación útil: "No encontré X; te muestro las 2 obras de Tacna" + botón **🔔 Avísame si sale** (búsqueda vacía → suscripción) |
| 7 | "obras que se convoquen en agosto" | fechaDesde/Hasta → filtro sobre `fecha_aprox_conv` |

### Alertas (`crear_alerta`, `ver_alertas`)

| # | Usuario escribe | Qué hace el bot |
|---|---|---|
| 8 | "avísame cuando salgan carreteras" | Draft de alerta precargado (objeto=obra, sinónimos congelados) → `SubscribeFlow` confirma frecuencia con botones |
| 9 | "qué alertas tengo" / "ya no me avises de carreteras" | `startManage` existente; pausar/borrar por frase en fase 2+ |

### Entidades y utilitarios

| # | Usuario escribe | Qué hace el bot |
|---|---|---|
| 10 | "cuál es el RUC del GORE Piura" | `buscar_entidad` → mismo path de `/ent` (ficha existente) |
| 11 | "hola" / "qué puedes hacer" | Bienvenida + ejemplos de frases ("obras para colegios en Piura") + menú. Aquí se le enseña al usuario el modo natural |

### Bordes y guardrails

| # | Escenario | Qué hace el bot |
|---|---|---|
| 12 | "cuánto está el dólar" | `fuera_de_alcance` → plantilla "yo sé de SEACE" + ejemplo + menú. Nunca texto del LLM |
| 13 | Límite diario alcanzado (cuando se active el gating; al lanzar no hay límite) | Mensaje de límite + upsell Premium + menú (los botones no se limitan) |
| 14 | LLM caído / timeout 4 s | Fallback invisible: el menú de hoy, como si el NLU no existiera |
| 15 | Texto a mitad de wizard (ej. `awaiting-entity`) | El texto va al wizard, NO al NLU (regla `expectsFreeText`). "GORE Piura" ahí es la entidad, no una búsqueda nueva |
| 16 | "obras pero no carreteras" | Fase 3: excluir=[carretera, …] → `NOT ILIKE`. Las negaciones son el punto débil de embeddings y el fuerte de NLU+SQL |

---

## 10. Decisiones que este doc cierra (vs. preguntas abiertas del doc 20)

1. **¿Respuesta por IA o plantilla?** Plantilla siempre (presenters actuales).
2. **¿Alertas por conversación en v1?** Sí, en fase 2, mapeando a los tipos de
   alerta existentes y con sinónimos congelados al crear.
3. **¿OpenAI o MiniMax?** OpenAI (mini vigente) detrás del `LlmPort`
   agnóstico. MiniMax no.
4. **¿Fechas desde el inicio?** El campo va en el schema desde fase 1; el
   parsing fino de fechas relativas se pule en fase 3.
5. **¿Qué se embeddea?** Nada por ahora. Cuando llegue Procedimientos:
   descripción + entidad (el objeto ya es filtro duro).
