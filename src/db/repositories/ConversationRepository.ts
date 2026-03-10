import { DatabaseSingleton } from '../DatabaseSingleton.js';
import { AppError } from '../../lib/errors.js';

export interface Conversation {
    id: string;
    actor_id: string;
    created_at: string;
    updated_at: string;
}

export class ConversationRepository {
    private dbSingleton: DatabaseSingleton;

    constructor(dbSingleton: DatabaseSingleton) {
        this.dbSingleton = dbSingleton;
    }

    /**
     * Busca uma conversa pelo actorId (channel:nativeActorId)
     */
    public findByActorId(actorId: string): Conversation | null {
        try {
            const db = this.dbSingleton.getHandle();
            const stmt = db.prepare('SELECT id, actor_id, created_at, updated_at FROM conversations WHERE actor_id = ?');
            const row = stmt.get(actorId) as Conversation | undefined;
            return row || null;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError(`Failed to fetch conversation by actorId: ${msg}`, 'DB_FETCH_CONVERSATION_ERROR');
        }
    }

    /**
     * Cria uma nova conversa.
     * Lança erro caso o actorId ou o id já existam na base.
     */
    public createConversation(conversation: Conversation): void {
        try {
            const db = this.dbSingleton.getHandle();
            const stmt = db.prepare(
                'INSERT INTO conversations (id, actor_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
            );
            stmt.run(
                conversation.id,
                conversation.actor_id,
                conversation.created_at,
                conversation.updated_at
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError(`Failed to create conversation: ${msg}`, 'DB_CREATE_CONVERSATION_ERROR');
        }
    }

    /**
     * Atualiza a data de última modificação da conversa (updated_at).
     */
    public updateUpdatedAt(id: string, updatedAt: string): void {
        try {
            const db = this.dbSingleton.getHandle();
            const stmt = db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?');
            const result = stmt.run(updatedAt, id);

            if (result.changes === 0) {
                throw new AppError(`Conversation with id ${id} not found for update`, 'DB_UPDATE_CONVERSATION_NOT_FOUND', { id });
            }
        } catch (err) {
            if (err instanceof AppError) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError(`Failed to update conversation: ${msg}`, 'DB_UPDATE_CONVERSATION_ERROR');
        }
    }
}
