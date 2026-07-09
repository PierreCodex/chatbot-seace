# Propuesta: Integración de IA + RAG para el módulo ACF

> Documento para validar con el agente Claude antes de implementar.
> Estado: propuesta técnica.

---

## 1. Resumen ejecutivo

Se propone agregar una capa de **inteligencia artificial (IA)** al módulo de **Anuncios de Contratación Futura (ACF)** del bot, para que el usuario pueda consultar en **lenguaje natural** en lugar de seguir un flujo rígido de botones.

La IA se encargará de entender la intención y extraer filtros. La búsqueda en sí se hará con **RAG (Retrieval Augmented Generation)** usando embeddings y pgvector en Supabase, para encontrar anuncios por similitud semántica (sinónimos, conceptos relacionados).

La IA solo se usará para:
1. **NLU**: entender el mensaje y extraer parámetros.
2. **Formato**: opcionalmente decorar la respuesta final.

La búsqueda, filtrado y recuperación de datos la hará el sistema (SQL + pgvector).

---

## 2. Problema / oportunidad

Actualmente el bot ACF funciona con botones y pasos definidos:
1. Elige objeto (obra, servicio, bien, consultoría).
2. Opcionalmente elige entidad.
3. Muestra resultados.

Esto es rígido. El usuario no puede preguntar de forma natural como:
- *"obras para colegios en Piura"*
- *"muéstrame anuncios de carreteras"*
- *"avísame cuando salgan hospitales en Lima"*

La IA + RAG permitiría una experiencia conversacional y búsquedas semánticas más potentes.

---

## 3. Objetivo

Permitir que el usuario consulte anuncios ACF usando **lenguaje natural**, entendiendo:
- Objeto de contratación (obra, servicio, bien, consultoría).
- Subcategorías semánticas (colegio, hospital, carretera, etc.).
- Entidad (GORE, municipalidad, hospital, etc.).
- Ubicación (Piura, Lima, Cusco).
- Intención de suscripción a alertas.

---

## 4. Arquitectura propuesta

```
Usuario (lenguaje natural)
    ↓
IA / NLU (extrae intención y filtros)
    ↓
Sistema genera embedding de la keyword
    ↓
RAG / pgvector busca anuncios similares
    ↓
SQL filtra por objeto, entidad, fecha
    ↓
Resultados reales de la BD
    ↓
IA / Plantilla formatea respuesta
    ↓
Respuesta al usuario
```

### Principio clave: dependencia mínima de la IA

| Tarea | Responsable | ¿Por qué? |
|-------|-------------|-----------|
| Entender mensaje del usuario | IA | Es lo que mejor hace |
| Extraer objeto, keyword, entidad | IA | NLU |
| Generar embeddings | Sistema (modelo de embeddings) | Determinista, rápido, barato |
| Buscar en BD | Sistema (pgvector + SQL) | Determinista, rápido, barato |
| Filtrar por objeto/entidad | Sistema (SQL) | Determinista |
| Formatear respuesta | Plantilla o IA ligera | Control + opcional naturalidad |

---

## 5. Flujo detallado

### Ejemplo: "obras para colegios en Piura"

1. **Usuario envía:** *"obras para colegios en Piura"*
2. **IA extrae:**
   ```json
   {
     "intencion": "buscar_acf",
     "objeto": "obra",
     "keyword": "colegio",
     "entityNombre": "Piura",
     "fecha": null
   }
   ```
3. **Sistema genera embedding** de la keyword ampliada:
   - `"colegio educación escuela I.E. institución educativa servicio educativo"`
4. **RAG busca en BD:**
   ```sql
   SELECT id, entity_nombre, descripcion, fecha_aprox_conv,
          1 - (embedding <=> query_embedding) AS similarity
   FROM processes
   WHERE tab = 'anuncios_futuros'
     AND objeto = 'obra'
     AND entity_nombre ILIKE '%PIURA%'
   ORDER BY embedding <=> query_embedding
   LIMIT 10;
   ```
5. **Resultados:** anuncios ACF de obras educativas en Piura.
6. **Respuesta al usuario:**
   > "Encontré 3 obras para colegios en Piura. El más reciente es de la Municipalidad Provincial de Piura para la I.E. N° 123, con convocatoria aproximada el 20 de julio. ¿Quieres ver el PDF o que te avise cuando salgan nuevos?"

---

## 6. Componentes a implementar

### 6.1. Backend

```
src/modules/ai/
├── ai.module.ts
├── acf-intent.service.ts        # Extrae intención y filtros con LLM
├── acf-intent.schema.ts         # Zod de parámetros extraídos
├── embedding.service.ts         # Genera embeddings
├── acf-rag-search.service.ts    # Búsqueda vectorial + SQL
├── prompts/
│   └── acf.system.prompt.ts     # System prompt para el LLM
└── dto/
    └── acf-intent.dto.ts
```

### 6.2. Adaptación del flujo de Telegram

Modificar `SearchAnunciosFlow` para que, antes de mostrar el menú de botones, detecte si el mensaje es una consulta en lenguaje natural y la envíe al `AcfIntentService`.

### 6.3. Crawler

El crawler debe generar y guardar el embedding de cada anuncio ACF al momento del upsert.

---

## 7. Cambios en base de datos

### 7.1. Habilitar pgvector

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

> Nota: la extensión `vector` ya está disponible en el proyecto de Supabase.

### 7.2. Agregar columna de embeddings

```sql
ALTER TABLE processes ADD COLUMN embedding vector(1536);
```

### 7.3. Índice para búsqueda eficiente

```sql
CREATE INDEX idx_processes_embedding ON processes
USING hnsw (embedding vector_cosine_ops)
WHERE tab = 'anuncios_futuros';
```

### 7.3. Actualizar schema de Prisma

```prisma
model Process {
  // ... campos existentes ...
  embedding    Unsupported("vector")?
}
```

---

## 8. Modelos recomendados

| Uso | Modelo recomendado | Costo aprox. |
|-----|-------------------|--------------|
| Embeddings | OpenAI `text-embedding-3-small` | ~$0.02 por 1M tokens |
| NLU / Function Calling | OpenAI `gpt-4o-mini` | ~$0.15 / $0.60 por 1M tokens |
| Formato de respuesta | Plantilla + datos (sin IA) o `gpt-4o-mini` | Opcional |

Para un MVP, **GPT-4o mini + text-embedding-3-small** son suficientes y económicos.

---

## 9. Funciones que habilitaría

| Función | Ejemplo de uso |
|---------|----------------|
| Buscar por subcategoría | "obras para colegios" |
| Buscar por objeto | "anuncios de servicios" |
| Buscar por entidad | "del GORE Piura" |
| Buscar por lugar | "en Lima" |
| Combinar filtros | "obras para hospitales en Cusco" |
| Buscar por fecha | "que salgan en julio" |
| Suscribirse a alertas | "avísame de obras de carreteras" |
| Sugerir alternativas | "no hay en Piura, pero hay 3 en Cajamarca" |
| Excluir categorías | "obras pero no carreteras" |
| Preguntar aclaración | "¿obras, servicios o bienes?" |

---

## 10. Ejemplo con datos reales de la BD

Consulta actual en producción:

```sql
SELECT COUNT(*) FILTER (WHERE objeto = 'obra') AS total_obras,
       COUNT(*) FILTER (WHERE objeto = 'obra' AND (
         descripcion ILIKE '%colegio%' OR
         descripcion ILIKE '%escuela%' OR
         descripcion ILIKE '%I.E.%' OR
         descripcion ILIKE '%educativo%'
       )) AS obras_educacion
FROM processes
WHERE tab = 'anuncios_futuros';
```

Resultado:

| total_obras | obras_educacion |
|-------------|-----------------|
| 43 | 5 |

Con RAG, la búsqueda de "colegios" también encontraría descripciones con "I.E.", "servicio educativo" e "institución educativa" sin depender de coincidencias exactas.

---

## 11. Costo estimado

### Embeddings

- 179 anuncios ACF actuales.
- Cada descripción ~200 tokens.
- Total: ~36,000 tokens.
- Costo con `text-embedding-3-small`: **menos de $0.001**.

### NLU por consulta

- Cada mensaje de usuario ~50 tokens.
- Respuesta de la IA ~100 tokens.
- Costo por consulta con `gpt-4o-mini`: **menos de $0.0005**.

Para un MVP con pocos usuarios, el costo es casi despreciable.

---

## 12. Riesgos y consideraciones

| Riesgo | Mitigación |
|--------|------------|
| IA extrae mal los parámetros | Validación con Zod + fallback a flujo de botones |
| Embeddings no encuentran resultados | Mantener búsqueda por `ILIKE` como respaldo |
| Costo del LLM en escala | Usar `gpt-4o-mini` y plantillas para el formato final |
| Latencia | Cachear embeddings de keywords frecuentes |
| Dependencia de proveedor externo | Diseñar adapter para cambiar de modelo fácilmente |
| ACF no tiene campo ubicación | Inferir ubicación del nombre de entidad y descripción |

---

## 13. Próximos pasos propuestos

1. Validar esta propuesta con el agente Claude.
2. Definir si el formato de respuesta final será plantilla o IA.
3. Decidir proveedor de embeddings y LLM (recomendado: OpenAI).
4. Implementar:
   - Activación de `pgvector` y migración de BD.
   - `EmbeddingService`.
   - `AcfIntentService` con Function Calling.
   - `AcfRagSearchService`.
   - Integración con `SearchAnunciosFlow`.
   - Actualización del crawler para generar embeddings.
5. Probar localmente con ejemplos reales.
6. Deployar a producción.

---

## 14. Diagrama de flujo para Excalidraw

```mermaid
flowchart TD
    A[👤 Usuario<br/>"obras para colegios en Piura"] --> B
    B[🧠 IA - NLU<br/>Extrae intención y filtros] --> C
    C[📦 Parámetros<br/>objeto=obra<br/>keyword=colegio<br/>entidad=Piura] --> D
    D[🔢 Embedding Service<br/>genera vector numérico] --> E
    E[🗄️ RAG / pgvector<br/>busca anuncios similares] --> F
    F[📋 SQL filtra<br/>objeto + entidad + fecha] --> G
    G[✅ Resultados reales<br/>de la BD] --> H
    H[✍️ Plantilla o IA<br/>formatea respuesta] --> I
    I[📱 Respuesta al usuario]

    classDef user fill:#e3f2fd,stroke:#1565c0,stroke-width:3px,color:#000
    classDef ai fill:#fff3e0,stroke:#ef6c00,stroke-width:3px,color:#000
    classDef system fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px,color:#000
    classDef output fill:#fce4ec,stroke:#c2185b,stroke-width:3px,color:#000

    class A user
    class B ai
    class C,D,E,F,G system
    class H output
    class I output
```

---

## 15. Preguntas abiertas para validar

1. ¿El formato final de la respuesta debe ser generado por IA o con plantillas?
2. ¿Queremos soportar suscripción a alertas desde la conversación natural en esta primera versión?
3. ¿Usamos OpenAI o probamos MiniMax / otro proveedor?
4. ¿Incluimos búsqueda por rango de fecha desde el inicio?
5. ¿El embedding debe incluir solo la descripción o también entidad + objeto?
