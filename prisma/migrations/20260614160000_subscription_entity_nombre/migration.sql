-- Alertas ACF (docs/09 §3): los anuncios de contratación futura traen el NOMBRE de
-- la entidad, no el RUC. Para que el matcher A1 (entidad + objeto) pueda cruzar las
-- suscripciones contra las filas scrapeadas, se guarda el nombre de la entidad en la
-- suscripción al momento de crearla. Aditiva, nullable.

ALTER TABLE "subscriptions" ADD COLUMN "entity_nombre" TEXT;
