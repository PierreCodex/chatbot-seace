import type { FAQ_IDS } from './intent.schema';

type FaqId = (typeof FAQ_IDS)[number];

/**
 * Respuestas FAQ pre-escritas (docs/21: el LLM clasifica, nunca redacta).
 * Texto plano compatible con ambos canales; el flow lo envuelve si hace falta.
 * Sobre temas legales/normativa el bot NO opina — ver `fuera_de_alcance`.
 */
export const FAQ_ANSWERS: Record<FaqId, string> = {
  que_es_acf:
    '📋 Un *Anuncio de Contratación Futura (ACF)* es el aviso que una entidad pública ' +
    'publica en SEACE ANTES de convocar un proceso: qué piensa contratar (obra, bien, ' +
    'servicio o consultoría) y la fecha aproximada de convocatoria.\n\n' +
    'Es tu ventaja competitiva: te enteras y te preparas antes de que salga la convocatoria.',
  que_es_seace:
    '🏛️ El *SEACE* (Sistema Electrónico de Contrataciones del Estado) es la plataforma ' +
    'oficial donde las entidades públicas del Perú publican sus contrataciones. ' +
    'Este bot consulta la versión 3.0 y te trae los anuncios sin que tengas que navegarla.',
  que_es_cui:
    '🔖 El *CUI* (Código Único de Inversiones) identifica un proyecto de inversión pública. ' +
    'Con el CUI puedes rastrear el proyecto en Invierte.pe y cruzarlo con el anuncio del SEACE.',
  que_es_objeto:
    '📦 El *objeto de contratación* es el tipo de lo que se contrata:\n\n' +
    '🏗️ *Obra* — construcción, mejoramiento, rehabilitación\n' +
    '📦 *Bien* — compra de productos/equipos\n' +
    '🛠️ *Servicio* — servicios generales\n' +
    '📐 *Consultoría de obra* — expedientes técnicos, supervisión',
  como_funciona_bot:
    '🤖 Escríbeme lo que buscas en lenguaje natural, por ejemplo:\n\n' +
    '💡 "obras para colegios en Piura"\n💡 "anuncios de servicios del GORE Cusco"\n\n' +
    'También puedes usar el menú de botones. Y con 🔔 *Avísame* creas alertas para ' +
    'enterarte apenas detectemos anuncios nuevos que te interesen.',
  como_alertas:
    '🔔 Haz una búsqueda y toca *Avísame* en los resultados: la alerta hereda esos ' +
    'filtros y te aviso cuando detecte anuncios nuevos que coincidan. ' +
    'Gestiona las tuyas con /misalertas.',
  es_oficial:
    'ℹ️ Este bot NO es un servicio del OSCE ni del Estado. Es una herramienta independiente ' +
    'que consulta los datos *públicos* del SEACE y te los acerca por chat. ' +
    'Para trámites oficiales, usa siempre los canales del OSCE.',
  planes:
    '⭐ Plan *Free*: búsquedas ilimitadas y hasta 3 alertas activas.\n' +
    'Plan *Premium*: hasta 10 alertas, frecuencia inmediata y más beneficios.\n\n' +
    'Para pasar a Premium escríbenos: https://t.me/pierrecodex',
  fecha_convocatoria:
    '🗓️ La fecha de convocatoria de un anuncio es *aproximada*: la declara la entidad y ' +
    'puede moverse. Por eso conviene una alerta 🔔 — te aviso cuando el proceso avance.',
  contacto: '💬 ¿Dudas, sugerencias o Premium? Escríbenos: https://t.me/pierrecodex',
};
