import { describe, expect, it, vi } from 'vitest';
import { AgentLoop, buildLoopMessages, composeSystemPrompt } from '../../src/agent/AgentLoop';
import { BASE_SYSTEM_PROMPT } from '../../src/agent/BaseSystemPrompt';
import type { ILlmProvider } from '../../src/llm/ILlmProvider';

describe('AgentLoop prompt composition', () => {
  it('composes system prompt in deterministic order', () => {
    const systemPrompt = composeSystemPrompt({
      skillSystemPrompt: '<<SKILL_PROMPT_BEGIN:git>>\nuse git safely\n<<SKILL_PROMPT_END:git>>',
      availableSkillsSummary: 'git-manager [/git] - Git flow',
      toolDefinitions: [
        {
          name: 'executar_comando',
          description: 'Executar',
          parameters: { type: 'object', properties: { commandLine: { type: 'string' } }, required: ['commandLine'] },
        },
      ],
    });

    const iBase = systemPrompt.indexOf(BASE_SYSTEM_PROMPT.trim());
    const iSkill = systemPrompt.indexOf('<<SKILL_PROMPT_BEGIN:git>>');
    const iSummary = systemPrompt.indexOf('git-manager [/git] - Git flow');
    const iTools = systemPrompt.indexOf('TOOLS_SCHEMA_BEGIN');

    expect(iBase).toBeGreaterThanOrEqual(0);
    expect(iSkill).toBeGreaterThan(iBase);
    expect(iSummary).toBeGreaterThan(iSkill);
    expect(iTools).toBeGreaterThan(iSummary);
  });

  it('builds loop messages with system + history + current user input', () => {
    const messages = buildLoopMessages({
      skillSystemPrompt: 's',
      availableSkillsSummary: 'a',
      toolDefinitions: [],
      messageHistory: [{ role: 'assistant', content: 'hist' }],
      normalizedInput: {
        actorId: 'telegram:1',
        channel: 'telegram',
        channelRef: { channel: 'telegram', ref: { chatId: 1 } },
        inputType: 'text',
        text: 'pergunta atual',
        requiresAudioReply: false,
        receivedAt: new Date().toISOString(),
      },
    });

    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.content).toBe('hist');
    expect(messages[2]?.role).toBe('user');
    expect(messages[2]?.content).toBe('pergunta atual');
  });
});

describe('AgentLoop engine and telemetry', () => {
  it('finishes with text output on provider response', async () => {
    const provider: ILlmProvider = {
      providerId: 'gemini',
      chat: async () => ({ text: 'resposta final', finishReason: 'stop' }),
    };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const loop = new AgentLoop({ maxIterations: 3, providerTimeoutMs: 5000 }, { provider, logger });

    const context = await loop.run({
      actorId: 'telegram:1',
      channel: 'telegram',
      channelRef: { channel: 'telegram', ref: { chatId: 1 } },
      normalizedInput: {
        actorId: 'telegram:1',
        channel: 'telegram',
        channelRef: { channel: 'telegram', ref: { chatId: 1 } },
        inputType: 'text',
        text: 'oi',
        requiresAudioReply: false,
        receivedAt: new Date().toISOString(),
      },
      conversationId: 'c1',
      provider: 'gemini',
      resolvedSkill: null,
      skillSystemPrompt: '',
      availableSkillsSummary: '',
      toolDefinitions: [],
      messageHistory: [],
      requiresAudioReply: false,
      diagnostics: { iterations: 0, warnings: [], startedAt: new Date().toISOString() },
    });

    expect(context.finalResponse).toBe('resposta final');
    expect(context.outputType).toBe('text');
    expect(logger.info).toHaveBeenCalled();
  });

  it('handles tool calls and continues loop safely', async () => {
    let iteration = 0;
    const provider: ILlmProvider = {
      providerId: 'gemini',
      chat: async () => {
        iteration += 1;
        if (iteration === 1) {
          return {
            finishReason: 'tool_calls',
            toolCalls: [{ id: '1', name: 'ler_arquivo', arguments: { path: 'README.md' } }],
          };
        }
        return { text: 'ok apos tool', finishReason: 'stop' };
      },
    };

    const loop = new AgentLoop(
      { maxIterations: 3, providerTimeoutMs: 5000 },
      {
        provider,
        executeToolCall: async () => ({ observation: 'arquivo lido' }),
      },
    );

    const context = await loop.run({
      actorId: 'telegram:1',
      channel: 'telegram',
      channelRef: { channel: 'telegram', ref: { chatId: 1 } },
      normalizedInput: {
        actorId: 'telegram:1',
        channel: 'telegram',
        channelRef: { channel: 'telegram', ref: { chatId: 1 } },
        inputType: 'text',
        text: 'oi',
        requiresAudioReply: false,
        receivedAt: new Date().toISOString(),
      },
      conversationId: 'c1',
      provider: 'gemini',
      resolvedSkill: null,
      skillSystemPrompt: '',
      availableSkillsSummary: '',
      toolDefinitions: [],
      messageHistory: [],
      requiresAudioReply: false,
      diagnostics: { iterations: 0, warnings: [], startedAt: new Date().toISOString() },
    });

    expect(context.finalResponse).toBe('ok apos tool');
    expect(context.diagnostics?.iterations).toBe(2);
  });

  it('applies bounded self-correction for malformed tool calls', async () => {
    let iteration = 0;
    const provider: ILlmProvider = {
      providerId: 'gemini',
      chat: async () => {
        iteration += 1;
        if (iteration === 1) {
          return {
            finishReason: 'tool_calls',
            toolCalls: [{ id: '1', name: 'ler_arquivo', arguments: {} }],
          };
        }
        return { text: 'resposta apos reparo', finishReason: 'stop' };
      },
    };

    const executeToolCall = vi.fn(async () => ({ observation: 'nunca chamado' }));
    const loop = new AgentLoop(
      { maxIterations: 3, providerTimeoutMs: 5000, maxToolRepairAttemptsPerIteration: 1 },
      { provider, executeToolCall },
    );

    const context = await loop.run({
      actorId: 'telegram:1',
      channel: 'telegram',
      channelRef: { channel: 'telegram', ref: { chatId: 1 } },
      normalizedInput: {
        actorId: 'telegram:1',
        channel: 'telegram',
        channelRef: { channel: 'telegram', ref: { chatId: 1 } },
        inputType: 'text',
        text: 'oi',
        requiresAudioReply: false,
        receivedAt: new Date().toISOString(),
      },
      conversationId: 'c1',
      provider: 'gemini',
      resolvedSkill: null,
      skillSystemPrompt: '',
      availableSkillsSummary: '',
      toolDefinitions: [
        {
          name: 'ler_arquivo',
          description: 'Ler',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      ],
      messageHistory: [],
      requiresAudioReply: false,
      diagnostics: { iterations: 0, warnings: [], startedAt: new Date().toISOString() },
    });

    expect(context.finalResponse).toBe('resposta apos reparo');
    expect(context.diagnostics?.warnings).toContain('tool_self_correction_limit_reached');
    expect(executeToolCall).toHaveBeenCalledTimes(0);
  });

  it('falls back safely on repeated provider errors and still returns finalResponse/outputType', async () => {
    const provider: ILlmProvider = {
      providerId: 'gemini',
      chat: async () => {
        throw new Error('timeout at C:\\internal\\secret.log');
      },
    };
    const loop = new AgentLoop({ maxIterations: 2, providerTimeoutMs: 1000 }, { provider });

    const context = await loop.run({
      actorId: 'telegram:1',
      channel: 'telegram',
      channelRef: { channel: 'telegram', ref: { chatId: 1 } },
      normalizedInput: {
        actorId: 'telegram:1',
        channel: 'telegram',
        channelRef: { channel: 'telegram', ref: { chatId: 1 } },
        inputType: 'text',
        text: 'oi',
        requiresAudioReply: false,
        receivedAt: new Date().toISOString(),
      },
      conversationId: 'c1',
      provider: 'gemini',
      resolvedSkill: null,
      skillSystemPrompt: '',
      availableSkillsSummary: '',
      toolDefinitions: [],
      messageHistory: [],
      requiresAudioReply: false,
      diagnostics: { iterations: 0, warnings: [], startedAt: new Date().toISOString() },
    });

    expect(context.finalResponse).toBeTruthy();
    expect(context.outputType).toBe('error');
    expect(context.diagnostics?.warnings.some((w) => w.startsWith('provider_error:'))).toBe(true);
  });

  it('blocks unsafe output through OutputSafetyValidator', async () => {
    const provider: ILlmProvider = {
      providerId: 'gemini',
      chat: async () => ({ text: 'BEGIN SYSTEM PROMPT: segredo', finishReason: 'stop' }),
    };
    const loop = new AgentLoop(
      { maxIterations: 2, providerTimeoutMs: 1000 },
      {
        provider,
        outputSafetyValidator: {
          validate: (text: string) => ({
            allowed: !text.includes('SYSTEM PROMPT'),
            sanitizedText: text,
            blockedReasons: text.includes('SYSTEM PROMPT') ? ['blocked'] : [],
          }),
        } as any,
      },
    );

    const context = await loop.run({
      actorId: 'telegram:1',
      channel: 'telegram',
      channelRef: { channel: 'telegram', ref: { chatId: 1 } },
      normalizedInput: {
        actorId: 'telegram:1',
        channel: 'telegram',
        channelRef: { channel: 'telegram', ref: { chatId: 1 } },
        inputType: 'text',
        text: 'oi',
        requiresAudioReply: false,
        receivedAt: new Date().toISOString(),
      },
      conversationId: 'c1',
      provider: 'gemini',
      resolvedSkill: null,
      skillSystemPrompt: '',
      availableSkillsSummary: '',
      toolDefinitions: [],
      messageHistory: [],
      requiresAudioReply: false,
      diagnostics: { iterations: 0, warnings: [], startedAt: new Date().toISOString() },
    });

    expect(context.outputType).toBe('error');
    expect(context.finalResponse).toContain('segurança');
    expect(context.diagnostics?.warnings).toContain('output_blocked_by_safety_validator');
  });
});
