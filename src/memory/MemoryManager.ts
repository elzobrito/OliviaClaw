import * as crypto from 'node:crypto';
import { ConversationRepository, Conversation } from '../db/repositories/ConversationRepository.js';
import { MessageRepository } from '../db/repositories/MessageRepository.js';
import { AppError } from '../lib/errors.js';
import { Message } from '../types/index.js';
import { MemoryCompactionStrategy } from './contracts/MemoryCompactionStrategy.js';

function isProviderName(value: string | null): value is NonNullable<Message['provider']> {
    return value === 'gemini' || value === 'deepseek' || value === 'groq' || value === 'openai';
}

export class MemoryManager {
    private conversationRepo: ConversationRepository;
    private messageRepo: MessageRepository;
    private memoryCompactionStrategy?: MemoryCompactionStrategy;
    private defaultMemoryWindowSize: number;

    constructor(
        conversationRepo: ConversationRepository,
        messageRepo: MessageRepository,
        memoryCompactionStrategy?: MemoryCompactionStrategy,
        defaultMemoryWindowSize = 20,
    ) {
        this.conversationRepo = conversationRepo;
        this.messageRepo = messageRepo;
        this.memoryCompactionStrategy = memoryCompactionStrategy;
        this.defaultMemoryWindowSize = defaultMemoryWindowSize;
    }

    /**
     * Tenta localizar uma conversa existente pelo actorId.
     * Se não encontrar, cria uma nova.
     * Cada actorId possui uma única conversa (long term context local).
     * O provider não é parte da identidade da conversa.
     */
    public findOrCreateConversation(actorId: string): Conversation {
        if (!actorId) {
            throw new AppError('actorId is required to find or create a conversation', 'MEMORY_MISSING_ACTOR_ID');
        }

        try {
            const existing = this.conversationRepo.findByActorId(actorId);
            if (existing) {
                return existing;
            }

            const now = new Date().toISOString();
            const newConversation: Conversation = {
                id: crypto.randomUUID(),
                actor_id: actorId,
                created_at: now,
                updated_at: now
            };

            this.conversationRepo.createConversation(newConversation);
            return newConversation;
        } catch (err) {
            if (err instanceof AppError) {
                throw err; // Repassa AppErrors já encapsulados pelo repositório
            }
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppError(`Unexpected error when finding or creating conversation: ${msg}`, 'MEMORY_CONVERSATION_INIT_ERROR');
        }
    }

    /**
     * Atualiza a data de acesso/modificação da conversa.
     */
    public touchConversation(conversationId: string): void {
        const now = new Date().toISOString();
        this.conversationRepo.updateUpdatedAt(conversationId, now);
    }

    private sanitizeMessageContent(content: string): string {
        const withoutNullBytes = content.replace(/\u0000/g, '');
        return withoutNullBytes.trim();
    }

    private sanitizeMetadata(metadata?: Record<string, unknown>): string | null {
        if (!metadata) return null;

        const blockedKeys = ['stack', 'secret', 'token', 'password', 'authorization', 'cookie'];
        const sanitized: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(metadata)) {
            if (blockedKeys.some((blocked) => key.toLowerCase().includes(blocked))) {
                continue;
            }

            if (typeof value === 'object' && value !== null) {
                // Evita persistir estruturas técnicas completas.
                sanitized[key] = '[REDACTED_COMPLEX_OBJECT]';
                continue;
            }

            sanitized[key] = value;
        }

        return Object.keys(sanitized).length > 0 ? JSON.stringify(sanitized) : null;
    }

    public persistMessage(params: {
        conversationId: string;
        role: string;
        content: string;
        provider?: string;
        metadata?: Record<string, unknown>;
        actorIdForCompactionHook?: string;
        memoryWindowSize?: number;
    }): number {
        if (!params.conversationId) {
            throw new AppError('conversationId is required', 'MEMORY_MISSING_CONVERSATION_ID');
        }

        const sanitizedContent = this.sanitizeMessageContent(params.content ?? '');
        if (!sanitizedContent) {
            throw new AppError('message content is empty after sanitization', 'MEMORY_EMPTY_CONTENT');
        }

        const createdAt = new Date().toISOString();
        const messageId = this.messageRepo.insert({
            conversationId: params.conversationId,
            role: params.role,
            content: sanitizedContent,
            provider: params.provider ?? null,
            metadataJson: this.sanitizeMetadata(params.metadata),
            createdAt,
        });

        this.conversationRepo.updateUpdatedAt(params.conversationId, createdAt);
        this.triggerCompactionHook(
            params.actorIdForCompactionHook ?? params.conversationId,
            params.conversationId,
            params.memoryWindowSize ?? this.defaultMemoryWindowSize,
        );
        return messageId;
    }

    public getHistory(conversationId: string, memoryWindowSize: number): Message[] {
        const windowSize = Number.isFinite(memoryWindowSize) && memoryWindowSize > 0
            ? Math.floor(memoryWindowSize)
            : 1;

        try {
            const rows = this.messageRepo.listByConversation(conversationId, windowSize);
            return rows.map((row) => ({
                role: row.role as Message['role'],
                content: row.content,
                createdAt: row.createdAt,
                provider: isProviderName(row.provider) ? row.provider : undefined,
            }));
        } catch {
            // Fallback seguro para não vazar detalhes internos do banco.
            return [];
        }
    }

    private triggerCompactionHook(actorId: string, conversationId: string, memoryWindowSize: number): void {
        if (!this.memoryCompactionStrategy) return;

        const probeWindow = Math.max(memoryWindowSize + 1, 2);
        const history = this.getHistory(conversationId, probeWindow);
        if (history.length <= memoryWindowSize) return;

        // Gancho explícito para compactação futura, sem alterar persistência atual.
        void this.memoryCompactionStrategy
            .compact({
                actorId,
                messages: history,
                maxWindowSize: memoryWindowSize,
            })
            .catch(() => {
                // Melhor esforço: falhas de compactação não quebram o fluxo atual.
            });
    }
}
