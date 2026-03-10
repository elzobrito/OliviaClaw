import type { Message } from '../../types/index.js';

export interface ShortTermMemoryStore {
  append(actorId: string, message: Message): Promise<void>;
  readWindow(actorId: string, limit: number): Promise<Message[]>;
  clear(actorId: string): Promise<void>;
}
