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

## Decisiones de stack confirmadas

- WhatsApp: **Kapso** sobre Meta Cloud API
- Auth de usuarios WA: **Supabase Auth** (phone provider, sin OTP en producción)
- Scraper: **Playwright headless en worker separado** (no in-proc del API)
- Cola: **BullMQ** sobre Redis

## TODO de descubrimiento (siguiente iteración)

1. Inspeccionar la página **Ficha de Selección** (clic en `fichaSeleccion.gif`) y mapear su DOM
2. Probar descarga real del Excel y verificar que incluya `nidProceso`
3. Probar cascade Departamento → Provincia → Distrito en vivo
4. Stress test: 20 búsquedas seguidas en 1 sesión, observar reCAPTCHA score
5. Confirmar que el Anuncio de Contratación Futura tiene datos vigentes (la prueba inicial mostró 0)
6. Volcar el catálogo completo de entidades vía el modal de búsqueda