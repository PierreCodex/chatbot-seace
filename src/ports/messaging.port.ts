export interface ListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

export interface ButtonOption {
  id: string;
  title: string;
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
  timestamp: string;
  isNewConversation: boolean;
}

export type OutboundMessage =
  | {
      kind: 'text';
      to: string;
      phoneNumberId: string;
      body: string;
    }
  | {
      kind: 'list';
      to: string;
      phoneNumberId: string;
      body: string;
      buttonText: string;
      sections: ListSection[];
    }
  | {
      kind: 'buttons';
      to: string;
      phoneNumberId: string;
      body: string;
      buttons: ButtonOption[];
    };

export interface MessagingPort {
  send(message: OutboundMessage): Promise<{ messageId: string }>;
  parseWebhook(raw: unknown): InboundMessage[];
}

export const MESSAGING_PORT = Symbol('MESSAGING_PORT');
