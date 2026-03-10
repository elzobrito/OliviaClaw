export interface LongTermMemoryRecord {
  actorId: string;
  content: string;
  tags?: string[];
  sourceMessageIds?: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface LongTermMemoryQuery {
  actorId: string;
  query: string;
  limit?: number;
  minScore?: number;
}

export interface LongTermMemoryPort {
  upsert(records: LongTermMemoryRecord[]): Promise<void>;
  search(params: LongTermMemoryQuery): Promise<LongTermMemoryRecord[]>;
}
