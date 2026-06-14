export interface ListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

export interface ButtonOption {
  id: string;
  title: string;
  // Color del botón (Telegram Bot API 9.4): primary=azul, success=verde, danger=rojo.
  // Clientes viejos / WhatsApp lo ignoran (color por defecto).
  style?: 'primary' | 'success' | 'danger';
  // Custom emoji animado como ícono del botón (Telegram 9.4). WhatsApp lo ignora.
  iconCustomEmojiId?: string;
}

export interface InboundMessage {
  messageId: string;
  phoneNumber: string;
  phoneNumberId: string;
  conversationId: string;
  type: 'text' | 'interactive' | 'image' | 'unknown';
  text?: string;
  interactiveReplyId?: string;
  interactiveReplyTitle?: string;
  // Id del mensaje que contenía el botón pulsado (Telegram callback_query). Permite
  // editar/borrar ese mensaje para navegación en el mismo espacio. WhatsApp: undefined.
  sourceMessageId?: string;
  timestamp: string;
  isNewConversation: boolean;
}

// `imagePath` (opcional): ruta a una imagen de cabecera. Telegram la envía como
// foto con el texto de caption (sendPhoto); WhatsApp/Kapso lo ignora. Se usa para
// el banner de bienvenida.
// `effectId` (opcional): id de efecto animado de Telegram (message_effect_id, solo
// chats privados). WhatsApp/Kapso lo ignora.
export type OutboundMessage =
  | {
      kind: 'text';
      to: string;
      phoneNumberId: string;
      body: string;
      imagePath?: string;
      // `html: true` → el body ya viene como HTML de Telegram (no se re-escapa).
      html?: boolean;
      effectId?: string;
    }
  | {
      kind: 'list';
      to: string;
      phoneNumberId: string;
      body: string;
      buttonText: string;
      sections: ListSection[];
      imagePath?: string;
      effectId?: string;
    }
  | {
      kind: 'buttons';
      to: string;
      phoneNumberId: string;
      body: string;
      buttons: ButtonOption[];
      // Agrupación de botones por fila (Telegram), ej. [1,2,1] = grilla. Default: 1/fila.
      buttonLayout?: number[];
      imagePath?: string;
      html?: boolean;
      effectId?: string;
    }
  | {
      // Documento alojado (PDF de anuncios ACF cuando hay >5 resultados).
      // El render del PDF lo provee el backend (modules/files); aquí solo se
      // envía el enlace ya hospedado vía Meta Cloud API.
      kind: 'document';
      to: string;
      phoneNumberId: string;
      link: string;
      filename: string;
      caption?: string;
      effectId?: string;
    };

export interface MessagingPort {
  send(message: OutboundMessage): Promise<{ messageId: string }>;
  parseWebhook(raw: unknown): InboundMessage[];
  // Capacidades opcionales (Telegram). Permiten navegar en el mismo espacio sin
  // alargar el chat. Canales que no las soportan (Kapso) las omiten → el orquestador
  // hace fallback a `send`.
  editMessage?(message: OutboundMessage, messageId: string): Promise<{ messageId: string }>;
  deleteMessage?(to: string, messageId: string): Promise<void>;
  /** Indicador "escribiendo…" (Telegram sendChatAction). Fire-and-forget. */
  sendChatAction?(to: string, action: 'typing' | 'upload_document'): Promise<void>;
}

export const MESSAGING_PORT = Symbol('MESSAGING_PORT');
