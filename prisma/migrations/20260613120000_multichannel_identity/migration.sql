-- Identidad multi-canal (WhatsApp + Telegram) — docs/13-telegram-migracion.md §"tablas".
-- No agrega tablas: evoluciona `wa_users` para identificar al usuario por (canal, id-de-canal)
-- en vez de solo el teléfono, de modo que un usuario de Telegram (chat_id, sin teléfono)
-- pueda guardarse. Aditiva + backfill; los registros WhatsApp existentes quedan intactos.

-- 1) Canal del usuario
CREATE TYPE "UserChannel" AS ENUM ('whatsapp', 'telegram');
ALTER TABLE "wa_users" ADD COLUMN "channel" "UserChannel" NOT NULL DEFAULT 'whatsapp';

-- 2) Id dentro del canal (chat_id en TG, teléfono en WA). Nullable para el backfill.
ALTER TABLE "wa_users" ADD COLUMN "channel_user_id" TEXT;
UPDATE "wa_users" SET "channel_user_id" = "phone_e164" WHERE "channel_user_id" IS NULL;
ALTER TABLE "wa_users" ALTER COLUMN "channel_user_id" SET NOT NULL;

-- 3) El teléfono pasa a OPCIONAL (Telegram puede no tenerlo). Conserva su índice único
--    (en Postgres un UNIQUE permite múltiples NULL, así que varios usuarios TG sin
--     teléfono conviven sin chocar).
ALTER TABLE "wa_users" ALTER COLUMN "phone_e164" DROP NOT NULL;

-- 4) Unicidad real de identidad: (canal, id-de-canal).
CREATE UNIQUE INDEX "wa_users_channel_channel_user_id_key" ON "wa_users" ("channel", "channel_user_id");
