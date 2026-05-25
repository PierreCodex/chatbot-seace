# 01 · Análisis técnico de SEACE 3.0

Inspección realizada con Playwright el 2026-05-25 contra
`https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml`.

## 1. Stack del sitio

| Componente | Detalle |
|---|---|
| Framework | JavaServer Faces (JSF 2.x) + PrimeFaces |
| ViewState | Campo `javax.faces.ViewState` por formulario (ej. `-3202841247927097521:-264782468153858245`) |
| Sesión | `JSESSIONID` con sufijo de nodo (`...slave2:seace-main`) en path `/seacebus-uiwd-pub` |
| Balanceo | Cookie `X-Oracle-BMC-LBS-Route` (Oracle Cloud Infra) — sticky por sesión |
| Anti-bot | reCAPTCHA Enterprise v3 (invisible, score-based), site key `6Lfhnb0pAAAAAB3RxPrOlihIByQUBjpZCAjX-cY2` |
| AJAX | Llamadas `PrimeFaces.ab(...)` que devuelven XML parcial al mismo endpoint `.xhtml` |

**Implicancia**: el scraping no puede hacerse con HTTP plano (axios + cheerio). reCAPTCHA v3 requiere ejecución real de JS y huella consistente de navegador. Hay que usar Playwright headless con `playwright-extra` + `puppeteer-extra-plugin-stealth` (o similar) y sesiones de larga duración con cookies persistidas.

## 2. Inventario de pestañas

El componente raíz es un `<p:tabView id="tbBuscador">` con 6 pestañas. Cada pestaña encapsula su propio `<form>` JSF con identificador único.

| # | Pestaña | Form ID | Tab ID | Notas |
|---|---|---|---|---|
| 7 | Anuncio de Contratación Futura | `tbBuscador:idFormbuscarACF` | `#tbBuscador:tab7` | Default al abrir |
| 1 | Buscador de Procedimientos de Selección | `tbBuscador:idFormBuscarProceso` | `#tbBuscador:tab1` | **El más usado**. Búsqueda Avanzada colapsable. |
| 3 | Buscador de Expresiones de Interés | `tbBuscador:idFormbuscarexpresionInteres` | `#tbBuscador:tab3` | |
| 4 | Buscador de Difusión de Requerimientos | `tbBuscador:idFormbuscarDifusionRequerimientos` | `#tbBuscador:tab4` | |
| 5 | Órdenes de Compra/Servicio | `tbBuscador:idFormbuscarOCOS` | `#tbBuscador:tab5` | |
| 6 | Condiciones de Contratación | `tbBuscador:idFormbuscarCCO` | `#tbBuscador:tab6` | |

Adicionalmente hay 2 formularios fuera del tabView: `frmMesajes` (mensajería global) y `j_idt1125` (footer/utilitario).

### 2.1 Anuncio de Contratación Futura (ACF)

| Campo | ID JSF (sufijo del form) | Tipo | Obligatorio |
|---|---|---|---|
| Nombre o Sigla de Entidad | `nombreEntidad` | text | No |
| Tipo de Selección | `cbxTipoSeleccion_input` | select | No |
| Objeto de Contratación | `cbxObjContratacion_input` | select | **Sí** |
| Fecha publicación desde / hasta | `dfechaInicioPubACF_input` / `dfechaFinPubACF_input` | datepicker | No |
| Descripción del objeto | `descripcionObjeto` | text | No |
| Fecha convocatoria desde / hasta | `dfechaInicioAproxConvACF_input` / `dfechaFinAproxConvACF_input` | datepicker | No |
| Botón Buscar | `btnBuscarSel` | submit | — |
| Botón Limpiar | `btnLimpiarSel` | submit | — |
| Botón Exportar Excel | `btnExportar` | submit | — |

Columnas de resultado: N°, Nombre/Sigla Entidad, Fecha Publicación, Tipo Selección, Objeto Contratación, Descripción, Alcance, Cantidad, Plazo (días), Fecha Aprox. Convocatoria.

### 2.2 Procedimientos de Selección (la pestaña principal)

Campos básicos:

| Campo | ID JSF | Tipo | Obligatorio |
|---|---|---|---|
| Nombre o Sigla de Entidad | `nombreEntidad` | text | No |
| Tipo de Selección | `j_idt179_input` | select (89 opciones) | No |
| Objeto de Contratación | `j_idt188_input` | select (4 opciones: Bien, Servicio, Obra, Consultoría de Obra) | No |
| Nro. Selección | `numeroSeleccion` | text | No |
| Descripción del Objeto | `descripcionObjeto` | text | No |
| Año de la Convocatoria | `anioConvocatoria_input` | select (años 2003-2026) | **Sí** |
| Versión SEACE | `j_idt214_input` | select (Seace 2, Seace 3) | No |
| Código SNIP | `codigoSnip` | text | No |
| Código Único de Inversión | `CUI` | text | No |

Campos de Búsqueda Avanzada (panel colapsado por defecto):

| Campo | ID JSF | Tipo |
|---|---|---|
| Siglas de la Entidad | `siglasEntidad` | text |
| Departamento | `departamento_input` | select (regiones de Perú) |
| Provincia | `provincia_input` | select cascada |
| Distrito | `distrito_input` | select cascada |
| Número de Convocatoria | `numeroConvocatoria` | text |
| Reiniciado Desde (estado) | `j_idt269_input` | select |
| Fecha publicación inicio / fin | `dfechaInicio_input` / `dfechaFin_input` | datepicker |

Modal de búsqueda de entidad (popup invocado desde el icono de lupa al lado del campo "Nombre o Sigla de Entidad"): inputs `txtNombreEntidad`, `txtRucEntidad`, `txtsigla` y una tabla de resultados con paginación propia.

> **Nota**: los IDs `j_idt179`, `j_idt188`, `j_idt214`, `j_idt242`, `j_idt269` son IDs **generados** por JSF (autoincremento de componente). Pueden cambiar si OECE/OSCE modifica el árbol de componentes. Hay que detectarlos vía heurística (label asociado, posición) en el scraper, no hardcodearlos en strings.

Columnas de resultado (13): N°, Entidad, Fecha y Hora Publicación, Nomenclatura, Reiniciado Desde, Objeto Contratación, Descripción, Código SNIP, Código Único Inversión, VR/VE/Cuantía, Moneda, Versión SEACE, Acciones.

Por cada fila en la columna **Acciones** hay 4 íconos:

| Ícono | Acción | Mecanismo |
|---|---|---|
| `btnLupa.gif` (1°) | Lista de códigos SNIP | `PrimeFaces.ab(...)` AJAX, popula modal `frmListaCodigoSnip` |
| `btnLupa.gif` (2°) | Lista de códigos CUI | `PrimeFaces.ab(...)` AJAX, popula modal `frmListaCodigoCUI` |
| `btnHistorial.png` | Historial del proceso | Form submit con `nidConvocatoria`, `nidProceso` |
| `fichaSeleccion.gif` | Ficha de Selección (detalle completo) | Form submit con `nidConvocatoria`, `nidProceso`, `nidSistema=3`, `ntipo=1` |

Identificadores opacos enviados con cada acción:
- `nidConvocatoria`: token cifrado (~50 chars Base64), distinto por sesión (ej. `WKi7+XLxiySMGxp3EIz5mDFuS3MQ+0npM7yC/9UY6rj92JbnzjKI`)
- `nidProceso`: ID interno numérico (ej. `1016256`)
- `nidSistema`: `2` para Seace 2, `3` para Seace 3

> **Consecuencia**: para abrir la ficha de detalle no basta con guardar el `nidProceso` — el `nidConvocatoria` cifrado solo es válido en la sesión que lo emitió. Si guardamos el `nidProceso` en Supabase y luego queremos abrir la ficha, hay que **re-buscar** el proceso primero para regenerar el token. Alternativa: scrapear la ficha en el mismo job que lista los resultados y persistir el HTML/JSON ya parseado.

### 2.3 Expresiones de Interés

| Campo | ID JSF | Obligatorio |
|---|---|---|
| Nombre/Sigla Entidad | `nombreEntidad` | No |
| Objeto de Contratación | `cbxObjContratacion_input` | **Sí** |
| Descripción de Expresión | `idDescExpreInteres` | No |
| N° de Expresión | `idNumExpreInteres` | No |
| Fecha publicación desde/hasta | `dfechaInicio_input` / `dfechaFin_input` | No |

Columnas de resultado: Entidad, N° Exp. Interés, Descripción, Archivos (URL repositorio), Fecha Publicación, Fecha Consultas Técnicas, Fecha Evaluación Consultas, Cronograma Reuniones, Pliego Absolutorio Preliminar, Informe Absolución, PEC Convocado, Notificaciones Supervisión, Cronograma Presenciales, Acta Absolución Presencial, Fecha Publicación Acta, Acciones.

### 2.4 Difusión de Requerimientos

Estructura idéntica a Expresiones de Interés (mismos IDs JSF: `nombreEntidad`, `cbxObjContratacion_input`, `idDescExpreInteres`, `idNumExpreInteres`, `dfechaInicio_input`, `dfechaFin_input`). La diferencia es semántica: aquí los items son "requerimientos" en lugar de "expresiones de interés".

### 2.5 Órdenes de Compra y Servicio (OCOS)

| Campo | ID JSF | Obligatorio |
|---|---|---|
| Nombre Entidad Contratante | `nombreEntidad` | No |
| Año | `idCmbAnioOCOS_input` | **Sí** |
| Mes | `idCmbMesOCOS_input` | **Sí** |
| RUC del Contratista | `rucOCOS` | No |

Columnas: Entidad, Tipo de Orden, Número de Orden, Tipo de Contratación, Fecha Emisión, Fecha Compromiso, Monto, RUC, Razón Social, Estado, Estado Registro, Observaciones.

> Esta pestaña **exige Año + Mes**, lo que la convierte en la más restrictiva. Para el bot esto se mapea a un flujo de 2 pasos obligatorios antes de cualquier otro filtro.

### 2.6 Condiciones de Contratación (CCO)

| Campo | ID JSF | Obligatorio |
|---|---|---|
| Nombre/Sigla Entidad | `nombreEntidad` | No |
| Tipo de Procedimiento | `cbxTipProc_input` | No |
| Descripción Objeto | `idDescExpreInteres` | No |
| Objeto | `cbxObjContratacion_input` | No |
| Número | `idNumExpreInteres` | No |
| Año | `cbxAnyo_input` (valores 2024-2026) | **Sí** |

## 3. Mecánica de búsqueda y AJAX

Al pulsar Buscar:
1. JS de PrimeFaces serializa todo el form (campos visibles + `javax.faces.ViewState` + token oculto `tokenBus*`).
2. Hace `POST` al mismo URL `.xhtml;jsessionid=...` con `Faces-Request: partial/ajax` y cuerpo `application/x-www-form-urlencoded`.
3. La respuesta es XML con `<partial-response>` que contiene `<update id="...">` con HTML que reemplaza el datatable de resultados, y `<update id="javax.faces.ViewState">` con un nuevo ViewState.
4. El cliente actualiza el DOM. Playwright lo observa esperando por el cambio en el datatable o por `network.idle`.

En la prueba con `Año=2026` (sin otros filtros) la búsqueda devolvió **499 resultados, 34 páginas, 15 filas/página por defecto** (también 10 y 20 disponibles).

Endpoint único: todo (búsquedas, paginación, cascadas, modales, exportación) llega a
`/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml;jsessionid=...`.

## 4. Paginación

Cada datatable tiene un widget `<div id="...{tableId}_paginator_bottom" class="ui-paginator ui-paginator-bottom">` con:
- `.ui-paginator-first`, `.ui-paginator-prev`, `.ui-paginator-next`, `.ui-paginator-last`
- `.ui-paginator-current` con texto literal `[ Mostrando de X a Y del total Z - Página: A/B ]`
- Combobox de tamaño de página (10/15/20)

Para navegar el scraper:
1. Parsea `.ui-paginator-current` con regex `Página:\s*(\d+)\/(\d+)` para conocer total de páginas.
2. Itera clic en `.ui-paginator-next:not(.ui-state-disabled)` y espera por `partial-response` o por el cambio de número de página.
3. Tope práctico: 500 procesos × 50 entidades × 6 tipos => millones. Hay que limitar por sesión y rangos de fecha estrechos.

## 5. Reglas de obligatoriedad y combinación

| Pestaña | Campo(s) obligatorio(s) |
|---|---|
| ACF | Objeto de Contratación |
| Procedimientos | Año de la Convocatoria |
| Expresiones de Interés | Objeto de Contratación |
| Difusión Requerimientos | Objeto de Contratación |
| OCOS | Año + Mes |
| Condiciones Contratación | Año |

Hay también validación cliente: si se elige un rango de fechas muy amplio sin filtro de entidad, la web responde con resultados pero la UI advierte de tiempos de espera. En la práctica, sin paginar más allá de 20-30 páginas suele ser suficiente.

## 6. Cascadas y dependencias

- **Departamento → Provincia → Distrito**: cada select dispara un `<p:ajax listener="...">` que repobla el siguiente nivel. El scraper debe esperar la respuesta antes de seleccionar el nivel hijo.
- **Versión SEACE → Tipo de Selección**: al cambiar a Seace 2 cambian los tipos disponibles (el dataset histórico incluye procesos previos al D.L. 1017). En la práctica para el bot conviene fijar Seace 3 por default y exponer Seace 2 solo en modo avanzado.

## 7. Exportación a Excel

Cada formulario tiene un botón `btnExportar` (clase `btnExportar_buscadorProcesos` en la pestaña 2). Es un `<button type="submit">` sin `onclick` propio: al pulsarlo se envía un POST estándar (no AJAX) y la respuesta es un `Content-Disposition: attachment` con el `.xlsx`.

> **Optimización**: para volúmenes grandes el Excel es **mucho más eficiente que paginar HTML**. Una sola descarga reemplaza 34 páginas × parseo HTML. Estrategia: si el usuario pide más de N (ej. 50) resultados, el scraper hace clic en Exportar Excel, descarga el `.xlsx` en disco temporal, parsea con `xlsx` o `exceljs` y lo trata como dataset. **Esta es probablemente la vía más robusta a futuro.**

Caveat: hay que validar que la columna *Acciones* y los identificadores (`nidConvocatoria`, `nidProceso`) **aparezcan en el Excel**. Si el Excel solo trae datos planos sin tokens, perdemos la capacidad de re-navegar a la ficha. Comprobar en próxima iteración.

## 8. Modales auxiliares

Tres modales se invocan vía AJAX y comparten patrón:

| Modal | Disparador | Campos | Resultado |
|---|---|---|---|
| Búsqueda de entidad | Lupa al lado de "Nombre Entidad" | `txtNombreEntidad`, `txtRucEntidad`, `txtsigla` | DataTable: N°, RUC, Tipo Documento, Entidad |
| Listado SNIP | Lupa en columna "Acciones" | (consulta automática) | DataTable: N°, Código SNIP |
| Listado CUI | Lupa en columna "Acciones" | (consulta automática) | DataTable: N°, Código Único de Inversión |

El modal de entidad es útil para el bot: cuando el usuario escribe `MINSA` el scraper puede usarlo para resolver el RUC oficial y luego buscar procesos de esa entidad por RUC (más estable que por sigla).

## 9. Anti-bot (reCAPTCHA Enterprise v3)

- Sitekey: `6Lfhnb0pAAAAAB3RxPrOlihIByQUBjpZCAjX-cY2`
- Modo: invisible/v3 (badge "protección de reCAPTCHA"), genera score 0.0-1.0 con base en huella del cliente.
- Mensaje observado en página: *"Este sitio supera la cuota gratuita de reCAPTCHA Enterprise"* — OECE paga la licencia, lo que sugiere uso activo.
- En cada form existe un input hidden `tokenBus*` (`tokenBusACF`, `tokenBusProceso`, `tokenBusExpInt`, `tokenBusDifReq`, `tokenBusOrdComSer`, `tokenBusCCO`) que **se llena por JS al momento de submit** con la respuesta de `grecaptcha.execute(siteKey, {action: 'search'})`.
- En la prueba inicial la búsqueda **funcionó incluso con el token vacío** — indicio de que el bloqueo es por score acumulado, no por presencia de token. Significa que sesiones limpias y poco frecuentes pasan; sesiones con muchas búsquedas/min se degradan.

**Implicancias para el scraper:**
1. Usar Playwright real (no requests/cheerio). El token se genera vía JS de Google.
2. Distribuir carga: múltiples workers con IPs distintas (proxies residenciales o múltiples salidas) si se requiere alto volumen.
3. Throttling: ≤1 búsqueda cada 5-10s por sesión, ≤200 búsquedas por sesión antes de reciclar cookies.
4. `playwright-extra` + `stealth` para reducir huella de automatización (`navigator.webdriver`, plugins, fonts, etc.).
5. Reusar `JSESSIONID` mientras dure (típicamente 30 min de inactividad) para no consumir cuota.

## 10. Errores y comportamiento extraño observado

- Si se envía el form sin completar un campo obligatorio, la página responde con un `<div id="frmMesajes">` poblado de mensajes de validación; los resultados anteriores quedan congelados. El scraper debe inspeccionar este nodo después de cada submit.
- El `JSESSIONID` está atado a un nodo específico del cluster (sufijo `slave2:seace-main`) vía la cookie `X-Oracle-BMC-LBS-Route`. Si esa cookie expira/cambia, JSF tira `ViewExpiredException`. Mantenerla y refrescarla con el resto.
- El campo *Año de la Convocatoria* viene preseleccionado en `2026` y dispara un AJAX al cargar la página que decide qué año mostrar. No es necesario forzar el cambio para buscar el año en curso.

## 11. Lo que NO se ha probado (deuda de descubrimiento)

Para un alcance honesto, queda pendiente para la próxima iteración:

1. Abrir la **ficha de detalle** (`fichaSeleccion.gif`) y mapear su estructura — es la página de mayor valor para el bot (cronograma, bases, postores, contratista adjudicado, monto, calendario).
2. Probar la descarga real del Excel y validar columnas/encoding.
3. Probar el cascade Departamento → Provincia → Distrito en vivo y medir latencia.
4. Probar comportamiento bajo carga (10-20 búsquedas seguidas) y observar si reCAPTCHA empieza a degradar.
5. Validar si la pestaña de Anuncio de Contratación Futura está activa con datos (la prueba inicial mostró 0 resultados — puede que esté en deshuso o que requiera fecha específica).
6. Listar el contenido del modal "Búsqueda de Entidad" para obtener la lista canónica de entidades + RUCs.

## 12. Resumen ejecutivo

- Sitio JSF/PrimeFaces, 6 pestañas, 1 endpoint POST común, AJAX parcial.
- Cada pestaña tiene un form con IDs JSF estables en su mayoría; algunos campos usan IDs autogenerados (`j_idt*`) que deben localizarse por label/posición.
- reCAPTCHA Enterprise v3 activo pero permisivo en sesión nueva — Playwright real es obligatorio.
- Paginación server-side estándar PrimeFaces, máx 20 filas/página.
- **Exportar Excel** es la palanca clave para batch scraping de gran volumen.
- Tokens opacos (`nidConvocatoria`) atan los detalles a la sesión; persistir el HTML/JSON parseado al momento del scrape, no los IDs.
