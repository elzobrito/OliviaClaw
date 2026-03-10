import { describe, expect, it, vi } from 'vitest';
import { AgentController } from '../../src/controller/AgentController';
import { MessageQueue } from '../../src/controller/MessageQueue';
import type { NormalizedInput } from '../../src/channels/contracts/NormalizedInput';
import type { Skill } from '../../src/skills/types';

function baseInput(): NormalizedInput {
  return {
    actorId: 'telegram:123',
    channel: 'telegram',
    channelRef: { channel: 'telegram', ref: { chatId: 1, messageId: 2 } },
    inputType: 'text',
    text: '/git status',
    attachments: [],
    requiresAudioReply: false,
    receivedAt: new Date().toISOString(),
  };
}

describe('AgentController stage: media + conversation + skills', () => {
  it('prepares PipelineContext with resolved conversation, skills and tools', async () => {
    const preprocess = vi.fn(async (input: NormalizedInput) => ({
      ...input,
      text: `${input.text ?? ''} enriched`,
    }));

    const findOrCreateConversation = vi.fn(() => ({ id: 'conv-1' }));
    const getHistory = vi.fn(() => [{ role: 'user' as const, content: 'oi' }]);
    const persistMessage = vi.fn(() => 1);

    const skills: Skill[] = [
      {
        name: 'git-manager',
        description: 'Git flow',
        triggers: ['/git'],
        tools: ['github_push'],
        version: '1.0.0',
        skillSystemPrompt: 'prompt git',
        filePath: '/tmp/skill.md',
      },
    ];

    const load = vi.fn(async () => ({ skills, errors: [] }));
    const routeWithFallback = vi.fn(async () => ({ skillName: 'git-manager' }));

    const globalTool = {
      definition: {
        name: 'ler_arquivo',
        description: 'Ler arquivo',
        schema: { properties: {}, required: [] },
      },
    };
    const skillTool = {
      definition: {
        name: 'github_push',
        description: 'Push',
        schema: { properties: {}, required: [] },
      },
    };

    const controller = new AgentController(
      { provider: 'gemini', memoryWindowSize: 20 },
      {
        messageQueue: new MessageQueue({ maxQueueSize: 20 }),
        mediaPreprocessor: { preprocess },
        memoryManager: { findOrCreateConversation, getHistory, persistMessage },
        skillLoader: { load },
        skillRouter: { routeWithFallback },
        toolRegistry: {
          getGlobalTools: () => [globalTool],
          getByName: (name: string) => (name === 'github_push' ? skillTool : undefined),
        },
        agentLoop: { run: async (ctx) => ({ ...ctx, finalResponse: 'ok', outputType: 'text' }) },
      },
    );

    const context = await controller.prepareContext(baseInput());

    expect(preprocess).toHaveBeenCalledTimes(1);
    expect(findOrCreateConversation).toHaveBeenCalledWith('telegram:123');
    expect(routeWithFallback).toHaveBeenCalled();
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        role: 'user',
      }),
    );
    expect(context.conversationId).toBe('conv-1');
    expect(context.resolvedSkill?.name).toBe('git-manager');
    expect(context.toolDefinitions.map((t) => t.name).sort()).toEqual(['github_push', 'ler_arquivo']);
    expect(context.messageHistory).toEqual([{ role: 'user', content: 'oi' }]);
  });

  it('supports enqueue by actorId using MessageQueue facade', async () => {
    const controller = new AgentController(
      { provider: 'gemini', memoryWindowSize: 10 },
      {
        messageQueue: new MessageQueue({ maxQueueSize: 2 }),
        mediaPreprocessor: { preprocess: async (input) => input },
        memoryManager: {
          findOrCreateConversation: () => ({ id: 'conv-2' }),
          getHistory: () => [],
          persistMessage: () => 1,
        },
        skillLoader: { load: async () => ({ skills: [], errors: [] }) },
        skillRouter: { routeWithFallback: async () => ({ skillName: null }) },
        toolRegistry: { getGlobalTools: () => [], getByName: () => undefined },
        agentLoop: { run: async (ctx) => ({ ...ctx, finalResponse: 'ok', outputType: 'text' }) },
      },
    );

    const seen: string[] = [];
    const accepted = await controller.enqueue(baseInput(), async (_output, ctx) => {
      seen.push(ctx.conversationId);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(accepted).toBe(true);
    expect(seen).toEqual(['conv-2']);
  });

  it('keeps flow alive when pre-loop persistence fails', async () => {
    const controller = new AgentController(
      { provider: 'gemini', memoryWindowSize: 10 },
      {
        messageQueue: new MessageQueue({ maxQueueSize: 2 }),
        mediaPreprocessor: { preprocess: async (input) => input },
        memoryManager: {
          findOrCreateConversation: () => ({ id: 'conv-3' }),
          getHistory: () => [],
          persistMessage: () => {
            throw new Error('db down');
          },
        },
        skillLoader: { load: async () => ({ skills: [], errors: [] }) },
        skillRouter: { routeWithFallback: async () => ({ skillName: null }) },
        toolRegistry: { getGlobalTools: () => [], getByName: () => undefined },
        agentLoop: { run: async (ctx) => ({ ...ctx, finalResponse: 'ok', outputType: 'text' }) },
      },
    );

    const context = await controller.prepareContext(baseInput());
    expect(context.diagnostics?.warnings).toContain('preloop_persist_failed');
  });

  it('invokes AgentLoop and returns normalized output with controlled error fallback', async () => {
    const controller = new AgentController(
      { provider: 'gemini', memoryWindowSize: 10 },
      {
        messageQueue: new MessageQueue({ maxQueueSize: 2 }),
        mediaPreprocessor: { preprocess: async (input) => input },
        memoryManager: {
          findOrCreateConversation: () => ({ id: 'conv-4' }),
          getHistory: () => [],
          persistMessage: () => 1,
        },
        skillLoader: { load: async () => ({ skills: [], errors: [] }) },
        skillRouter: { routeWithFallback: async () => ({ skillName: null }) },
        toolRegistry: { getGlobalTools: () => [], getByName: () => undefined },
        agentLoop: {
          run: async () => {
            throw new Error('provider timeout at C:\\internal\\path');
          },
        },
      },
    );

    const result = await controller.process(baseInput());
    expect(result.output.outputType).toBe('error');
    expect(result.output.text).toContain('Falha controlada no loop');
  });

  it('persists assistant final message only for successful outputs', async () => {
    const persistMessage = vi.fn(() => 1);
    const controller = new AgentController(
      { provider: 'gemini', memoryWindowSize: 10 },
      {
        messageQueue: new MessageQueue({ maxQueueSize: 2 }),
        mediaPreprocessor: { preprocess: async (input) => input },
        memoryManager: {
          findOrCreateConversation: () => ({ id: 'conv-5' }),
          getHistory: () => [],
          persistMessage,
        },
        skillLoader: { load: async () => ({ skills: [], errors: [] }) },
        skillRouter: { routeWithFallback: async () => ({ skillName: null }) },
        toolRegistry: { getGlobalTools: () => [], getByName: () => undefined },
        agentLoop: { run: async (ctx) => ({ ...ctx, finalResponse: 'resposta ok', outputType: 'text' }) },
      },
    );

    const okResult = await controller.process(baseInput());
    expect(okResult.output.outputType).toBe('text');
    expect(persistMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));

    persistMessage.mockClear();
    const errorController = new AgentController(
      { provider: 'gemini', memoryWindowSize: 10 },
      {
        messageQueue: new MessageQueue({ maxQueueSize: 2 }),
        mediaPreprocessor: { preprocess: async (input) => input },
        memoryManager: {
          findOrCreateConversation: () => ({ id: 'conv-6' }),
          getHistory: () => [],
          persistMessage,
        },
        skillLoader: { load: async () => ({ skills: [], errors: [] }) },
        skillRouter: { routeWithFallback: async () => ({ skillName: null }) },
        toolRegistry: { getGlobalTools: () => [], getByName: () => undefined },
        agentLoop: { run: async (ctx) => ({ ...ctx, finalResponse: 'erro tecnico', outputType: 'error' }) },
      },
    );

    const errorResult = await errorController.process(baseInput());
    expect(errorResult.output.outputType).toBe('error');
    expect(persistMessage).toHaveBeenCalledTimes(1); // apenas persistência pré-loop
  });
});
