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