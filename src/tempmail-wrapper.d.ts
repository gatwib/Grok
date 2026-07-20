declare module '@wanglinsaputra/tempmail-wrapper' {
  export interface Message {
    id: string;
    sender: string;
    subject: string;
    date: Date;
    preview?: string;
    hasAttachments?: boolean;
  }

  export interface MessageDetail extends Message {
    bodyText?: string;
    bodyHtml?: string;
  }

  export interface TempMailProvider {
    generateEmail(): Promise<string>;
    getInbox(email: string): Promise<Message[]>;
    readMessage(messageId: string): Promise<MessageDetail>;
    deleteEmail(email: string): Promise<boolean>;
    waitForEmail(email: string, timeoutMs?: number, intervalMs?: number): Promise<Message | null>;
  }

  export function createProvider(name: string, config?: Record<string, unknown>): TempMailProvider;
}
