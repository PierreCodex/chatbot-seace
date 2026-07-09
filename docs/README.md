# chatbot-seace · documentos de diseño

Diseño técnico inicial del chatbot WhatsApp para consultar contrataciones públicas del Estado peruano vía SEACE 3.0.

| # | Documento | Resumen |
|---|---|---|
| 01 | [Análisis de SEACE](./01-analisis-seace.md) | Inspección Playwright en vivo: forms JSF, IDs, campos obligatorios, reCAPTCHA Enterprise v3, paginación, exportación Excel, modales auxiliares |
| 02 | [Arquitectura](./02-arquitectura.md) | Stack (NestJS + Redis/BullMQ + Worker Playwright + Supabase + Kapso), diagramas, manejo de latencia JSF de forma asíncrona |
| 03 | [Módulos del bot](./03-modulos-bot.md) | Flujos conversacionales: búsqueda por entidad/tipo/objeto/fechas, suscripciones, entrega de archivos, comandos textuales |
| 04 | [Estrategia de scraping](./04-scraping.md) | Pool de sesiones, adapters por pestaña, parseo HTML vs Excel fast-path, manejo de ViewExpired, anti-bot |
| 05 | [Schema Supabase](./05-schema-supabase.md) | 11 tablas con RLS, funciones RPC, vistas, retención |
| 06 | [UX WhatsApp](./06-whatsapp-ux.md) | Mapeo SEACE → Buttons/Lists/Flows, patrones, anti-patrones |
| 07 | [Arquitectura backend](./07-arquitectura-backend.md) | Estructura de carpetas NestJS, Ports & Adapters lite, Strategy por pestaña, separación bot/scraping/persistencia |
| 08 | [Roadmap de implementación](./08-roadmap-implementacion.md) | Plan de fases (F0-F7+) con entregable testeable por fase, anti-scope-creep, stop conditions |
| 09 | [Alertas y suscripciones](./09-alertas-suscripciones.md) | Catálogo de tipos de alerta (Entidad+Objeto, Objeto), restricciones de filtro de SEACE, 2 puntos de entrada y flujos WhatsApp |
| 10 | [Roadmap UX del bot](./10-roadmap-ux-bot.md) | Roadmap para el agente UX: 4 módulos (menú, búsqueda ACF, resolvedor de entidad, suscripciones) como Flows+Presenters, contrato con backend, fases UX-1..UX-6 |
| 11 | [Planes Free vs Premium](./11-planes.md) | Matriz de capacidades por tier (cuota de alertas, frecuencia, duración), modelado vía `wa_users.plan` + `planPolicy`, dos Flows estáticos de suscripción |
| 12 | [Flujos del bot — implementado](./12-flujos-bot-implementados.md) | **As-built**: máquina de estados, flujos ACF y resolver de entidad, cascada L1/L2/L3, reglas de presentación (1/2-10/>10), PDFs (ACF agrupado + entidades), guards, validación con `chat:sim` |
| 13 | [Migración a Telegram](./13-telegram-migracion.md) | Plan completo del bot en Telegram: coexistencia WA+Telegram por env, grammY como `Api`+tipos (no framework), mapeo de `kind`/identidad, adapter+webhook, desbloqueo de suscripciones nativas, fases T0–T4 |
| 14 | [Actualización de la data](./14-actualizacion-de-data.md) | Crawler ACF (incremental 1h + completo 12h); ACF sin umbral de frescura (`DB_FRESHNESS` solo aplica a otras pestañas), cascada BD/cache/vivo, local vs producción, comando manual `crawl:acf`, troubleshooting de "búsqueda lenta" |
| 15 | [Custom emoji Telegram](./15-telegram-emojis.md) | Dónde viven los `custom_emoji_id` (`src/common/telegram-emoji.ts`), registro nombre→id→fallback, reglas Bot API 9.4, cómo capturar/cambiar un emoji |
| 16 | [Telegram — estado](./16-telegram-estado.md) | **Estado vivo**: qué está implementado (canal, identidad, menús, flujos, tarjetas, navegación in-place, typing, efectos) vs pendiente (motor de alertas, mejoras a evaluar) + mapa de archivos |
| 17 | [Roles, permisos y comandos admin](./17-roles-permisos-alertas.md) | **Diseño + estado**: roles owner/seller (env vs BD), planes free/premium, cobro manual (sin Stars), anti-escalamiento, plan efectivo + vencimientos, auditoría inmutable, fases 1–5 implementadas + mapa de archivos |
| 18 | [Comandos del bot — guía práctica](./18-comandos-admin.md) | **Cheatsheet operativo**: cada comando (`/miplan` `/activar` `/extender` `/usuario` `/agregarvendedor` `/panico`…) con sintaxis, ejemplos, quién puede usarlo, flujo típico de cobro y reglas que el bot hace cumplir |
| 19 | [Deploy en Railway](./19-deploy-railway.md) | Despliegue para el test en vivo: 1 `Dockerfile` (con Chromium) + 2 servicios (api/worker) + Redis plugin + Supabase externo; variables de entorno por servicio, `setWebhook` y verificación |
| 20 | [Propuesta IA + RAG (original)](./20-propuesta-ia-acf.md) | Propuesta inicial de NLU + embeddings/pgvector para ACF — superada por el doc 21 (el RAG quedó reservado para Procedimientos) |
| 21 | [IA conversacional NLU-first](./21-propuesta-nlu-conversacional.md) | **Diseño cerrado**: el usuario escribe en lenguaje natural y el LLM solo interpreta (intents, filtros, sinónimos); respuestas siempre por plantilla; re-rank + FAQ curada; guardrails, fases y escenarios |
| 22 | [Checklist de fases NLU](./22-fases-nlu-checklist.md) | **Avance vivo** de la implementación: fase 1 hecha en local (adapter Anthropic, IntentService, NluRouterFlow, filtros, warm-up), pendientes y registro de hitos |
| 23 | [Entornos local vs producción](./23-entornos-local-prod.md) | **Guía operativa**: el webhook decide el entorno; `pnpm webhook status/local/prod`, receta ngrok, tabla de variables por lado, gotchas (secret, cola de updates) y estado actual |

## Decisiones de stack confirmadas

- WhatsApp: **Kapso** sobre Meta Cloud API
- Auth de usuarios WA: **Supabase Auth** (phone provider, sin OTP en producción)
- Scraper: **Playwright headless en worker separado** (no in-proc del API)
- Cola: **BullMQ** sobre Redis

## TODO de descubrimiento (siguiente iteración)

1. Inspeccionar la página **Ficha de Selección** (clic en `fichaSeleccion.gif`) y mapear su DOM — _post-MVP (F7+)_
2. Probar descarga real del Excel y verificar que incluya `nidProceso` — _post-MVP (F7+)_
3. Probar cascade Departamento → Provincia → Distrito en vivo — _post-MVP (F7+)_
4. Stress test: 20 búsquedas seguidas en 1 sesión, observar reCAPTCHA score

> **Resueltos:** ~~ACF tiene datos vigentes~~ (F4.6: 40 filas reales scrapeadas, sin
> bloqueo reCAPTCHA) · ~~volcar el catálogo de entidades vía el modal~~ (en curso en
> **F4.5**, `scripts/crawl-entities.ts`).