import type { Message } from '../../types/index.js';
import type { LongTermMemoryRecord } from './LongTermMemoryPort.js';

export interface MemoryCompactionInput {
  actorId: string;
  messages: Message[];
  maxWindowSize: number;
}

export interface MemoryCompactionResult {
  retainedMessages: Message[];
  promotedRecords: LongTermMemoryRecord[];
  strategyMetadata?: Record<string, unknown>;
}

export interface MemoryCompactionStrategy {
  compact(input: MemoryCompactionInput): Promise<MemoryCompactionResult>;
}
