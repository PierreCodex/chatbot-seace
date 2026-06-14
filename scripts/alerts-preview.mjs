import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaService } from '../dist/adapters/persistence/prisma/prisma.service.js';
import { AlertNotifierService } from '../dist/modules/alerts/alert-notifier.service.js';
import { SUBSCRIPTIONS_REPO } from '../dist/ports/persistence/subscriptions.repo.port.js';
import { WorkerModule } from '../dist/worker.module.js';

/**
 * Preview local del motor de alertas (docs/09, fase 6b): para un id de Telegram,
 * toma sus alertas activas y le ENVÍA a su chat un aviso con los anuncios actuales
 * que matchean cada alerta — sin esperar a que SEACE publique algo nuevo. Valida la
 * entrega end-to-end en Telegram.
 *
 * Uso:  pnpm alerts:preview -- --id=7079999767
 *       (si se omite --id, usa el primer OWNER_IDS del .env)
 * Requiere build previo (el npm script lo hace) y MESSAGING_CHANNEL=telegram.
 */
function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main() {
  const tgId = arg('id') ?? (process.env.OWNER_IDS ?? '').split(',')[0].trim();
  if (!tgId) {
    console.error('Falta --id=<telegram_id> (o OWNER_IDS en .env).');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const notifier = app.get(AlertNotifierService);
  const subsRepo = app.get(SUBSCRIPTIONS_REPO);

  const user = await prisma.waUser.findUnique({
    where: { channel_channelUserId: { channel: 'telegram', channelUserId: tgId } },
  });
  if (!user) {
    console.error(`No hay usuario Telegram con id ${tgId} (que escriba /start primero).`);
    await app.close();
    process.exit(1);
  }

  const subs = await subsRepo.listByUser(user.id, 'active');
  console.log(`▶ Preview de alertas para ${tgId}: ${subs.length} alerta(s) activa(s).`);
  let total = 0;
  for (const sub of subs) {
    const n = await notifier.previewSub(sub, tgId);
    total += n;
    console.log(
      `   alerta ${sub.id} (${sub.objeto ?? '—'} · ${sub.entityNombre ?? 'todas'}) → ${n} anuncio(s) enviados`,
    );
  }
  console.log(total > 0 ? `✅ Enviado. Revisá tu Telegram.` : 'ℹ️ Sin anuncios que matcheen todavía.');
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
