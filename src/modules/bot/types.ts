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
  /**
   * Envía un mensaje **intermedio** ya mismo (antes de que el flow termine), para
   * dar feedback durante operaciones lentas (ej. "🔎 Consultando…" antes de una
   * búsqueda en vivo). Los `messages` del `FlowResult` se envían igual al final.
   */
  notify: (message: OutboundMessage) => Promise<void>;
}

export interface FlowResult {
  messages: OutboundMessage[];
  nextFlowId?: string;
  nextStep?: string;
  dataPatch?: Record<string, unknown>;
  endConversation?: boolean;
}

export interface Flow {
  id: string;
  handle(ctx: FlowContext): Promise<FlowResult>;
}
