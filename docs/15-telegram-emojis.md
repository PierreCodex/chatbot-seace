# 15 · Custom emoji de Telegram (DataSeace)

> Dónde viven los IDs de los custom emoji (animados), qué representa cada uno, y cómo
> capturar/cambiar uno. Para edición rápida sin tocar lógica.

## Dónde están los códigos

**Archivo único fuente de verdad:** [`src/common/telegram-emoji.ts`](../src/common/telegram-emoji.ts)

Ahí está el registro `TG_EMOJI` (nombre → `{ id, fallback }`) + los helpers `tgEmoji('nombre')`
y `tgDivider(n)`. Para cambiar un emoji, **editás solo ese archivo** (el resto del código
usa los nombres semánticos, no los IDs).

## Registro actual

| Nombre (`tgEmoji('…')`) | `custom_emoji_id` | Fallback | Uso |
|---|---|---|---|
| `ok` | `5319153143093665867` | ✅ | Estado correcto |
| `loading` | `5260559811967202833` | ⏳ | "Buscando…" |
| `alert` | `5257993594777650079` | ⚡ | Alertas |
| `premium` | `5215191209131123104` | 💎 | Plan Premium |
| `money` | `5258487193894143425` | 💸 | Montos |
| `help` | `5258015065319162719` | ❓ | Ayuda (ícono de botón) |
| `back` | `5258134705928158693` | ◀️ | Menú/volver (ícono de botón) |
| `star` | `5257961708940445381` | ⭐ | Destacado |
| `important` | `5257975787843243760` | ‼️ | Importante |
| `fire` | `5212920133504212456` | 🔥 | Énfasis |

**Separador** (`tgDivider`): segmento `➿` = `5467658560840149395` (repetido arma la línea).
Hay más segmentos de colores capturados en `docs/emojis2-separadores.md` por si querés
otra tonalidad.

## Reglas de uso (Bot API 9.4)

- Los custom emoji renderizan en **texto/caption** (`tgEmoji`, requiere `html: true` en el
  mensaje) y como **ícono de botón** (`iconCustomEmojiId` en el botón).
- Requieren que el **dueño del bot** tenga Telegram Premium. Quien los **ve** no necesita Premium.
- Siempre llevan **fallback** (emoji normal): en clientes viejos o sin soporte, se ve el normal.

## Cómo capturar el ID de un emoji nuevo

1. Con una cuenta **Premium**, escribí el/los custom emoji en un mensaje.
2. Reenvialo a un bot que vuelque el JSON crudo (ej. **@RawDataBot** / **@ShowJSONBot**).
3. En `message.entities`, cada custom emoji aparece como:
   ```json
   { "offset": 0, "length": 2, "type": "custom_emoji", "custom_emoji_id": "5319…" }
   ```
4. Matcheá `offset`/`length` (índices UTF-16 del texto) con el emoji y copiá su `custom_emoji_id`.

> Los dumps originales de captura están en `docs/emojis1.md`, `docs/emojis3.md`
> (íconos) y `docs/emojis2-separadores.md` (líneas).

## Cómo cambiar / agregar uno

En `src/common/telegram-emoji.ts`:

```ts
export const TG_EMOJI = {
  // …
  nuevo: { id: '5xxxxxxxxxxxxxxxxx', fallback: '🔔' },  // agregar
  premium: { id: 'OTRO_ID', fallback: '💎' },           // cambiar
} satisfies Record<string, CustomEmoji>;
```

Luego se usa con `tgEmoji('nuevo')` en cualquier copy con `html: true`. No hay que tocar
nada más — los presenters referencian el nombre, no el ID.
