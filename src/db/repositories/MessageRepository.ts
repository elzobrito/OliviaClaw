import { DatabaseSingleton } from '../DatabaseSingleton.js';

export interface MessageInsertInput {
  conversationId: string;
  role: string;
  content: string;
  provider?: string | null;
  metadataJson?: string | null;
  createdAt: string;
}

export interface MessageRecord {
  id: number;
  conversationId: string;
  role: string;
  content: string;
  provider: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export class MessageRepository {
  insert(input: MessageInsertInput): number {
    const db = DatabaseSingleton.get().getHandle();
    const statement = db.prepare(
      'INSERT INTO messages (conversation_id, role, content, provider, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );

    const result = statement.run(
      input.conversationId,
      input.role,
      input.content,
      input.provider ?? null,
      input.metadataJson ?? null,
      input.createdAt,
    );

    return Number(result.lastInsertRowid);
  }

  listByConversation(conversationId: string, limit: number): MessageRecord[] {
    const db = DatabaseSingleton.get().getHandle();
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;

    const statement = db.prepare(
      'SELECT id, conversation_id, role, content, provider, metadata_json, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?',
    );

    const rows = statement.all(conversationId, safeLimit) as Array<{
      id: number;
      conversation_id: string;
      role: string;
      content: string;
      provider: string | null;
      metadata_json: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      provider: row.provider,
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
    }));
  }
}
