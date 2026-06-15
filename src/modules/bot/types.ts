import type { OutboundMessage } from '../../ports/messaging.port';

export interface ConversationState {
  userId: string;
  phoneNumber: string;
  phoneNumberId: string;
  flowId: string;
  step: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface FlowContext {
  userId: string;
  phoneNumber: string;
  phoneNumberId: string;
  state: ConversationState;
  input: string;
  /** True en el primer contacto (conversación nueva) o ante `/start`. Lo usa el
   * menú para mostrar el banner de bienvenida solo la primera vez. */
  isNewConversation?: boolean;
  /** Nombre del usuario (Telegram first_name) para personalizar la bienvenida. */
  displayName?: string | null;
  /**
   * Envía un mensaje **intermedio** ya mismo (antes de que el flow termine), para
   * dar feedback durante operaciones lentas (ej. "🔎 Consultando…" antes de una
   * búsqueda en vivo). Los `messages` del `FlowResult` se envían igual al final.
   */
  notify: (message: OutboundMessage) => Promise<{ messageId: string }>;
}

export interface FlowResult {
  messages: OutboundMessage[];
  nextFlowId?: string;
  nextStep?: string;
  dataPatch?: Record<string, unknown>;
  endConversation?: boolean;
  /**
   * Navegación en el mismo espacio (Telegram; degrada a envío normal si el canal no
   * lo soporta o no hay mensaje origen):
   *  - `edit`: reescribe el mensaje del botón pulsado con `messages[0]` (sin alargar
   *    el chat). El resto de `messages` se envía normal.
   *  - `replace`: borra el mensaje origen (efecto desvanecido) y luego envía `messages`.
   */
  navigation?: 'edit' | 'replace';
  /** Ids de mensajes transitorios a borrar tras entregar el resultado (ej. el
   * "Consultando…" enviado vía `notify`). Telegram; ignorado si el canal no borra. */
  deleteMessageIds?: string[];
}

export interface Flow {
  id: string;
  handle(ctx: FlowContext): Promise<FlowResult>;
}
