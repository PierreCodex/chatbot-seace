/**
 * Gestión del webhook de Telegram: a quién le llegan los mensajes del bot.
 * El bot tiene UN solo webhook — o apunta a producción (Railway) o a tu PC
 * (túnel ngrok). Este script lo cambia y lo consulta sin armar el curl a mano.
 *
 *   pnpm webhook status                       → ¿a dónde apunta ahora?
 *   pnpm webhook local https://abc.ngrok.app  → modo pruebas (tu PC vía ngrok)
 *   pnpm webhook prod                         → devolver a producción
 *
 * Usa TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET del .env. OJO: al volver a
 * prod, el TELEGRAM_WEBHOOK_SECRET de Railway debe ser el MISMO que el local
 * (si no, la API de prod rechazará los updates con 401).
 */
// Cuenta nueva de Railway (migración 2026-07-09); la anterior venció.
const PROD_URL = 'https://api-production-316d.up.railway.app/webhook/telegram';

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token) {
  console.error('Falta TELEGRAM_BOT_TOKEN en .env');
  process.exit(1);
}

const api = (method, params) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  }).then((r) => r.json());

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'status' || !cmd) {
  const { result: r } = await api('getWebhookInfo');
  const destino =
    r.url === PROD_URL ? 'PRODUCCIÓN (Railway)' : r.url ? 'LOCAL/otro' : '(sin webhook)';
  console.log(`Webhook: ${r.url || '(vacío)'}\nModo:    ${destino}`);
  console.log(`Updates pendientes: ${r.pending_update_count}`);
  if (r.last_error_message) {
    console.log(`Último error (${new Date(r.last_error_date * 1000).toISOString()}): ${r.last_error_message}`);
  }
  process.exit(0);
}

if (cmd === 'local') {
  if (!arg || !arg.startsWith('https://')) {
    console.error('Uso: pnpm webhook local https://<tu-subdominio>.ngrok<...>.app');
    process.exit(1);
  }
  const url = `${arg.replace(/\/$/, '')}/webhook/telegram`;
  const res = await api('setWebhook', { url, secret_token: secret || undefined });
  console.log(res.ok ? `✅ Webhook → ${url}\nModo PRUEBAS: los mensajes del bot llegan a tu PC (recuerda tener pnpm dev y ngrok corriendo).\n⚠️ Producción NO recibe mensajes hasta que corras: pnpm webhook prod` : res);
  process.exit(res.ok ? 0 : 1);
}

if (cmd === 'prod') {
  const res = await api('setWebhook', { url: PROD_URL, secret_token: secret || undefined });
  console.log(res.ok ? `✅ Webhook → ${PROD_URL}\nModo PRODUCCIÓN restaurado.` : res);
  process.exit(res.ok ? 0 : 1);
}

console.error('Comandos: status | local <url-https-de-ngrok> | prod');
process.exit(1);
