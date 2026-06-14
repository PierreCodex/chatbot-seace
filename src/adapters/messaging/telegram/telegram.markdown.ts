/**
 * Convierte el copy del bot (estilo WhatsApp: `*negrita*`, `_itálica_`) a HTML de
 * Telegram. Se usa HTML y no MarkdownV2 porque nuestro copy contiene `~`, `·`, `:`,
 * `(`, `)` y emojis que MarkdownV2 obligaría a escapar uno por uno (frágil). En HTML
 * solo hay que escapar `& < >` y el resto pasa literal.
 *
 * Orden importante: primero escapar los caracteres HTML, luego convertir los
 * marcadores `*`/`_` a tags. El `~` (usado para fechas aprox. "~15") queda literal.
 */
export function waToTelegramHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>');
}
