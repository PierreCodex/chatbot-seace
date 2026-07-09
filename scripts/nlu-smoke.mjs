/**
 * Smoke test del NLU contra la API viva de Anthropic (docs/22, fase 1).
 * Usa el prompt y schema COMPILADOS (dist/) — lo mismo que corre el bot.
 *
 *   pnpm build && node --env-file=.env scripts/nlu-smoke.mjs
 *
 * Golden set mínimo: frase → intent esperado (+ checks extra opcionales).
 * Sale con código 1 si algún caso no matchea, para usarlo como gate.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { nluIntentSchema } from '../dist/modules/ai/intent.schema.js';
import { nluSystemPrompt } from '../dist/modules/ai/prompts/nlu.system.prompt.js';

const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL || 'claude-haiku-4-5';
if (!apiKey) {
  console.error('Falta LLM_API_KEY en .env');
  process.exit(1);
}

/** @type {Array<{text: string, intent: string, check?: (i: any) => string | null}>} */
const GOLDEN = [
  {
    text: 'obras para colegios en Piura',
    intent: 'buscar_acf',
    check: (i) =>
      i.objeto !== 'obra'
        ? `objeto=${i.objeto}, esperaba obra`
        : !i.keyword
          ? 'sin keyword'
          : i.ubicacion?.toLowerCase().includes('piura')
            ? null
            : `ubicacion=${i.ubicacion}, esperaba Piura`,
  },
  {
    text: 'anuncios de servicios',
    intent: 'buscar_acf',
    check: (i) => (i.objeto === 'servicio' ? null : `objeto=${i.objeto}, esperaba servicio`),
  },
  {
    text: 'qué hay para hospitales',
    intent: 'buscar_acf',
    check: (i) => (i.objeto === null ? null : `objeto=${i.objeto}, esperaba null (re-pregunta)`),
  },
  {
    text: 'avísame cuando salgan carreteras',
    intent: 'crear_alerta',
    check: (i) => (i.sinonimos.length >= 2 ? null : 'esperaba sinónimos de carretera'),
  },
  { text: 'mis alertas', intent: 'ver_alertas' },
  {
    text: 'cuál es el RUC del GORE Piura',
    intent: 'buscar_entidad',
    check: (i) => (i.entidadQuery ? null : 'sin entidadQuery'),
  },
  {
    text: '¿qué es un anuncio de contratación futura?',
    intent: 'faq',
    check: (i) => (i.faqId === 'que_es_acf' ? null : `faqId=${i.faqId}, esperaba que_es_acf`),
  },
  { text: 'hola', intent: 'ayuda' },
  { text: 'cuánto está el dólar hoy', intent: 'fuera_de_alcance' },
  {
    text: 'dame el pdf con los 15 últimos servicios del gore cusco',
    intent: 'buscar_acf',
    check: (i) =>
      i.limite !== 15
        ? `limite=${i.limite}, esperaba 15`
        : !i.quierePdf
          ? 'quierePdf=false, esperaba true'
          : i.entidad
            ? null
            : 'sin entidad (gore cusco)',
  },
  {
    text: 'obras pero que no sean carreteras',
    intent: 'buscar_acf',
    check: (i) => (i.excluir.length > 0 ? null : 'esperaba excluir con términos'),
  },
  // Casos reales de usuario (2026-07-09, pruebas por Telegram):
  {
    text: 'Pudes mostarme todos los anuncios de bienes de todas las entidades, osea que me filtre todos los anuncions de bienes de todas las entidades',
    intent: 'buscar_acf',
    check: (i) =>
      i.objeto !== 'bien'
        ? `objeto=${i.objeto}, esperaba bien`
        : i.entidad || i.ubicacion
          ? `entidad/ubicacion=${i.entidad ?? i.ubicacion}, esperaba sin filtro (dijo "todas")`
          : null,
  },
  // F2: alerta por tema (requerimiento del cliente: fibra/telecom).
  {
    text: 'avísame cuando salgan anuncios de internet, fibra óptica o telecomunicaciones',
    intent: 'crear_alerta',
    check: (i) =>
      !i.keyword
        ? 'sin keyword'
        : i.sinonimos.length < 2
          ? 'esperaba sinónimos de telecom'
          : null,
  },
  {
    text: 'pudes darme las ruc de las entidades de la Region Piura',
    intent: 'buscar_entidad',
    check: (i) =>
      !i.entidadQuery
        ? 'sin entidadQuery'
        : i.entidadQuery.trim().length > 12
          ? `entidadQuery="${i.entidadQuery}" — esperaba solo el lugar ("Piura"), sin relleno`
          : null,
  },
];

const client = new Anthropic({ apiKey, maxRetries: 1 });
const system = nluSystemPrompt(new Date());
let failures = 0;

for (const caso of GOLDEN) {
  const started = Date.now();
  try {
    const res = await client.messages.parse(
      {
        model,
        max_tokens: 700,
        system,
        messages: [{ role: 'user', content: caso.text }],
        output_config: { format: zodOutputFormat(nluIntentSchema) },
      },
      { timeout: 15_000 },
    );
    const i = res.parsed_output;
    const ms = Date.now() - started;
    const intentOk = i.intent === caso.intent;
    const extra = intentOk && caso.check ? caso.check(i) : null;
    const ok = intentOk && !extra;
    if (!ok) failures++;
    const detail = [
      i.objeto && `objeto=${i.objeto}`,
      i.keyword && `kw=${i.keyword}(+${i.sinonimos.length})`,
      i.entidad && `ent="${i.entidad}"`,
      i.ubicacion && `ubi="${i.ubicacion}"`,
      i.excluir.length && `excl=[${i.excluir.join(',')}]`,
      i.limite != null && `lim=${i.limite}`,
      i.quierePdf && 'pdf',
      i.faqId && `faq=${i.faqId}`,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `${ok ? '✅' : '❌'} "${caso.text}" → ${i.intent} ${detail} (${ms}ms)` +
        (intentOk ? '' : ` — esperaba ${caso.intent}`) +
        (extra ? ` — ${extra}` : ''),
    );
  } catch (err) {
    failures++;
    console.log(`❌ "${caso.text}" → ERROR: ${err.message}`);
  }
}

console.log(`\n${GOLDEN.length - failures}/${GOLDEN.length} casos OK`);
process.exit(failures > 0 ? 1 : 0);
