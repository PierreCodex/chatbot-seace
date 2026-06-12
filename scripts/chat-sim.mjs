import 'reflect-metadata';
import { createInterface } from 'node:readline';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { MESSAGING_PORT } from '../dist/ports/messaging.port.js';
import { ConversationService } from '../dist/modules/bot/conversation.service.js';
import { ConversationStore } from '../dist/modules/bot/conversation.store.js';

/**
 * Simulador de conversación local. Levanta el grafo DI real (AppModule: flujos,
 * SearchFacade, BD, entidades) pero **reemplaza MESSAGING_PORT** por un impresor
 * a consola. Permite validar los flujos del bot (📅 ACF y 🔎 Consultar entidad)
 * sin depender de WhatsApp/Meta.
 *
 * Uso:
 *   node --env-file=.env scripts/chat-sim.mjs            # interactivo
 *   node --env-file=.env scripts/chat-sim.mjs --script="anuncios;objeto:obra;acf:buscar;nudge:all"
 *
 * Entrada: una línea por turno. Si contiene ':' se trata como id de botón/lista
 * (interactiveReplyId); si no, como texto libre. Comandos: ":reset", ":quit".
 */
const PHONE = '51999000111';
const PHONE_ID = 'SIM';
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bot: (s) => `\x1b[36m${s}\x1b[0m`,
  you: (s) => `\x1b[33m${s}\x1b[0m`,
  id: (s) => `\x1b[35m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
};

function printOutbound(msg) {
  if (msg.kind === 'text') {
    console.log(C.bot('🤖 ') + msg.body);
  } else if (msg.kind === 'buttons') {
    console.log(C.bot('🤖 ') + msg.body);
    for (const b of msg.buttons) console.log(`   ${C.id('[' + b.id + ']')} ${b.title}`);
  } else if (msg.kind === 'list') {
    console.log(C.bot('🤖 ') + msg.body + C.dim(`   (${msg.buttonText})`));
    for (const s of msg.sections) {
      console.log(C.dim(`   — ${s.title} —`));
      for (const r of s.rows)
        console.log(`   ${C.id('[' + r.id + ']')} ${r.title}${r.description ? C.dim(' · ' + r.description) : ''}`);
    }
  } else if (msg.kind === 'document') {
    console.log(C.bot('🤖 📎 PDF: ') + `${msg.filename}\n   ${C.dim(msg.link)}${msg.caption ? '\n   ' + msg.caption : ''}`);
  }
}

async function main() {
  const scriptArg = process.argv.find((a) => a.startsWith('--script='));
  const scripted = scriptArg ? scriptArg.slice('--script='.length).split(';').map((s) => s.trim()).filter(Boolean) : null;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MESSAGING_PORT)
    .useValue({
      send: async (message) => {
        printOutbound(message);
        return { messageId: 'sim-' + Math.random().toString(36).slice(2, 8) };
      },
      parseWebhook: () => [],
    })
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const convo = app.get(ConversationService);
  const store = app.get(ConversationStore);
  await store.del(PHONE).catch(() => {}); // sesión limpia

  let seq = 0;
  const turn = async (raw) => {
    const input = raw.trim();
    if (!input) return true;
    if (input === ':quit') return false;
    if (input === ':reset') {
      await store.del(PHONE).catch(() => {});
      console.log(C.ok('(conversación reiniciada)'));
      return true;
    }
    const isId = /^[a-z][\w-]*:/i.test(input);
    console.log(C.you('👤 ' + input) + C.dim(isId ? '  [botón]' : '  [texto]'));
    await convo.processInbound({
      messageId: 'sim-in-' + ++seq,
      phoneNumber: PHONE,
      phoneNumberId: PHONE_ID,
      conversationId: 'sim-convo',
      type: isId ? 'interactive' : 'text',
      text: isId ? undefined : input,
      interactiveReplyId: isId ? input : undefined,
      timestamp: String(Date.now()),
      isNewConversation: seq === 1,
    });
    console.log('');
    return true;
  };

  console.log(C.ok('═══ chat-sim listo. ') + C.dim('Escribe texto o ids (ej. "anuncios", "objeto:obra"). ":reset" / ":quit".'));
  console.log('');

  if (scripted) {
    for (const line of scripted) {
      if (!(await turn(line))) break;
    }
    await app.close();
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: C.you('› ') });
  rl.prompt();
  rl.on('line', async (line) => {
    const cont = await turn(line).catch((e) => {
      console.error('error:', e.message);
      return true;
    });
    if (!cont) {
      rl.close();
      return;
    }
    rl.prompt();
  });
  rl.on('close', async () => {
    await app.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
