import { describe, expect, it, vi } from 'vitest';
import { MessageRepository } from '../../src/db/repositories/MessageRepository';
import { MemoryManager } from '../../src/memory/MemoryManager';

describe('MessageRepository', () => {
  it('uses prepared statements to insert message', () => {
    const run = vi.fn(() => ({ lastInsertRowid: 42 }));
    const prepare = vi.fn(() => ({ run }));
    const singleton = { getHandle: () => ({ prepare }) } as any;

    const repo = new MessageRepository(singleton);
    const id = repo.insert({
      conversationId: 'c1',
      role: 'user',
      content: 'hello',
      provider: 'gemini',
      metadataJson: '{"k":"v"}',
      createdAt: '2026-03-10T00:00:00Z',
    });

    expect(id).toBe(42);
    expect(prepare).toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
  });

  it('returns ordered and mapped records for history window', () => {
    const all = vi.fn(() => [
      {
        id: 1,
        conversation_id: 'c1',
        role: 'user',
        content: 'a',
        provider: 'gemini',
        metadata_json: null,
        created_at: '2026-03-10T00:00:01Z',
      },
    ]);
    const prepare = vi.fn(() => ({ all }));
    const singleton = { getHandle: () => ({ prepare }) } as any;

    const repo = new MessageRepository(singleton);
    const rows = repo.listByConversation('c1', 10);

    expect(rows[0].conversationId).toBe('c1');
    expect(rows[0].createdAt).toBe('2026-03-10T00:00:01Z');
  });
});

describe('MemoryManager', () => {
  it('creates only one conversation per actor id', () => {
    const findByActorId = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        id: 'conv-1',
        actor_id: 'telegram:1',
        created_at: 'x',
        updated_at: 'x',
      });
    const createConversation = vi.fn();
    const updateUpdatedAt = vi.fn();

    const conversationRepo = { findByActorId, createConversation, updateUpdatedAt } as any;
    const messageRepo = { insert: vi.fn(), listByConversation: vi.fn(() => []) } as any;

    const manager = new MemoryManager(conversationRepo, messageRepo);
    manager.findOrCreateConversation('telegram:1');
    manager.findOrCreateConversation('telegram:1');

    expect(createConversation).toHaveBeenCalledTimes(1);
  });

  it('persists sanitized message and updates conversation timestamp', () => {
    const updateUpdatedAt = vi.fn();
    const conversationRepo = {
      findByActorId: vi.fn(),
      createConversation: vi.fn(),
      updateUpdatedAt,
    } as any;

    const insert = vi.fn(() => 99);
    const messageRepo = { insert, listByConversation: vi.fn(() => []) } as any;

    const manager = new MemoryManager(conversationRepo, messageRepo);
    const id = manager.persistMessage({
      conversationId: 'conv-1',
      role: 'user',
      content: 'hello\u0000world',
      provider: 'gemini',
      metadata: {
        stack: 'internal stack',
        token: 'secret-token',
        note: 'ok',
      },
    });

    expect(id).toBe(99);
    expect(insert).toHaveBeenCalled();
    const payload = insert.mock.calls[0][0];
    expect(payload.content).toBe('helloworld');
    expect(String(payload.metadataJson)).toContain('note');
    expect(String(payload.metadataJson)).not.toContain('token');
    expect(updateUpdatedAt).toHaveBeenCalled();
  });

  it('returns empty history fallback on controlled repository failure', () => {
    const conversationRepo = {
      findByActorId: vi.fn(),
      createConversation: vi.fn(),
      updateUpdatedAt: vi.fn(),
    } as any;
    const messageRepo = {
      insert: vi.fn(),
      listByConversation: vi.fn(() => {
        throw new Error('db fail');
      }),
    } as any;

    const manager = new MemoryManager(conversationRepo, messageRepo);
    const history = manager.getHistory('conv-1', 5);
    expect(history).toEqual([]);
  });

  it('calls compaction hook when history exceeds short window', async () => {
    const conversationRepo = {
      findByActorId: vi.fn(),
      createConversation: vi.fn(),
      updateUpdatedAt: vi.fn(),
    } as any;

    const listByConversation = vi.fn(() => [
      { role: 'user', content: '1', createdAt: 'a', provider: null },
      { role: 'assistant', content: '2', createdAt: 'b', provider: null },
      { role: 'user', content: '3', createdAt: 'c', provider: null },
    ]);

    const messageRepo = {
      insert: vi.fn(() => 1),
      listByConversation,
    } as any;

    const compact = vi.fn(async () => ({ retainedMessages: [], promotedRecords: [] }));
    const strategy = { compact } as any;

    const manager = new MemoryManager(conversationRepo, messageRepo, strategy, 2);
    manager.persistMessage({
      conversationId: 'conv-1',
      role: 'user',
      content: 'payload',
      actorIdForCompactionHook: 'telegram:1',
      memoryWindowSize: 2,
    });

    await Promise.resolve();
    expect(compact).toHaveBeenCalled();
  });
});
