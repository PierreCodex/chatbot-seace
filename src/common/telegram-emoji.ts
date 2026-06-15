/**
 * Registro de custom emoji (animados) de Telegram para DataSeace. Vive en `common/`
 * porque lo usan tanto los presenters (modules/) como el adapter (adapters/), y el
 * boundary prohíbe que modules/ importe de adapters/.
 *
 * Los `custom_emoji_id` se capturaron vía dump de JSON (ver docs/emojis*.md). Notas:
 *  - Renderizan en **texto/caption** (`tgEmoji`) y, desde Bot API 9.4, como **ícono
 *    de botón** (`icon_custom_emoji_id`, usar el `.id`).
 *  - Requieren que el **dueño del bot** tenga Premium (9.4). Quien los *ve* no.
 *  - Cada uno lleva un **fallback** (emoji normal) por si el cliente no los renderiza.
 */
interface CustomEmoji {
  id: string;
  fallback: string;
}

export const TG_EMOJI = {
  ok: { id: '5319153143093665867', fallback: '✅' },
  loading: { id: '5260559811967202833', fallback: '⏳' },
  alert: { id: '5257993594777650079', fallback: '⚡' },
  premium: { id: '5215191209131123104', fallback: '💎' },
  money: { id: '5258487193894143425', fallback: '💸' },
  help: { id: '5258015065319162719', fallback: '❓' },
  back: { id: '5258134705928158693', fallback: '◀️' },
  star: { id: '5257961708940445381', fallback: '⭐' },
  important: { id: '5257975787843243760', fallback: '‼️' },
  fire: { id: '5212920133504212456', fallback: '🔥' },
  dot: { id: '5260284397189346108', fallback: '🔴' },
  search: { id: '5220108512893344933', fallback: '🔎' },
  ruc: { id: '5215480011322042129', fallback: '🔖' },
  write: { id: '5395444784611480792', fallback: '✍️' },
  // /cmds (campos de las tarjetas + categoría Planes)
  cmdComando: { id: '5197371802136892976', fallback: '🔧' },
  cmdUso: { id: '5197269100878907942', fallback: '✍️' },
  planes: { id: '5445221832074483553', fallback: '💼' },
  // Íconos de botones del menú (van como icon_custom_emoji_id, no en el título)
  anunciosBtn: { id: '5274055917766202507', fallback: '🗓️' },
  soon: { id: '5296369303661067030', fallback: '🔒' },
  ayuda: { id: '5420323339723881652', fallback: '⚠️' },
  // Acentos de mensajes
  noEntidades: { id: '5202216593966244027', fallback: '🔍' },
  elige: { id: '5406745015365943482', fallback: '👇' },
  anunciosHdr: { id: '5213285132709929474', fallback: '🗓️' },
  // Bienvenida /start
  tgLogo: { id: '5244763347454300958', fallback: '✨' },
  ownerTag: { id: '5215720576735255650', fallback: '👨‍💻' },
  ownerBadge: { id: '5370941588165893740', fallback: '👑' },
} satisfies Record<string, CustomEmoji>;

export type TgEmojiName = keyof typeof TG_EMOJI;

/** Tag `<tg-emoji>` para usar en texto/caption (requiere html:true). */
export function tgEmoji(name: TgEmojiName): string {
  const e = TG_EMOJI[name];
  return `<tg-emoji emoji-id="${e.id}">${e.fallback}</tg-emoji>`;
}

/**
 * Efectos animados de mensaje (message_effect_id, solo chats privados). Son los 6
 * efectos públicos de Telegram. Swappable: cambiá cuál se usa donde se referencie.
 */
export const TG_EFFECT = {
  celebrate: '5046509860389126442', // 🎉
  fire: '5104841245755180586', // 🔥
  like: '5107584321108051014', // 👍
  heart: '5159385139981059251', // ❤️
} as const;

// Segmento del separador animado (emoji ➿); repetido arma una línea de color.
const DIVIDER_SEGMENT = '5467658560840149395';

/** Línea divisoria animada (n segmentos). Solo en texto/caption con html:true. */
export function tgDivider(segments = 10): string {
  return `<tg-emoji emoji-id="${DIVIDER_SEGMENT}">➿</tg-emoji>`.repeat(segments);
}

// La palabra "ANUNCIOS" en emojis-letra animados (la N se repite en pos. 2 y 4).
// El placeholder de cada `<tg-emoji>` DEBE ser UN emoji válido y NO combinable:
//  - letras ASCII → ENTITY_TEXT_INVALID (no son emoji).
//  - indicadores regionales (🇦🇳…) → dos seguidos se fusionan en bandera y
//    desalinean las entidades → ENTITY_TEXT_INVALID.
// Usamos 🔠 (emoji único, no combinable) como base; el custom emoji lo reemplaza.
const ANUNCIOS_LETTERS: { id: string; ch: string }[] = [
  { id: '5350358953832230891', ch: '🔠' },
  { id: '5350695030728173619', ch: '🔠' },
  { id: '5359351545903197932', ch: '🔠' },
  { id: '5350695030728173619', ch: '🔠' },
  { id: '5350493021236375754', ch: '🔠' },
  { id: '5350376442939059426', ch: '🔠' },
  { id: '5350832748854520730', ch: '🔠' },
  { id: '5350473255796879409', ch: '🔠' },
];

/** "ANUNCIOS" en emojis-letra animados (texto/caption con html:true). */
export function tgAnuncios(): string {
  return ANUNCIOS_LETTERS.map((l) => `<tg-emoji emoji-id="${l.id}">${l.ch}</tg-emoji>`).join('');
}
