import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../src/llm/providers/OpenAIProvider';
import { LlmProviderError } from '../../src/llm/ILlmProvider';

describe('OpenAIProvider', () => {
  it('normalizes text and tool_calls output', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-1',
        model: 'gpt-4o-mini',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: 'resposta openai',
              tool_calls: [
                {
                  id: 'call-1',
                  function: { name: 'ler_arquivo', arguments: JSON.stringify({ path: 'README.md' }) },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const provider = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' });
    const result = await provider.chat(
      [{ role: 'user', content: 'oi' }],
      [
        {
          name: 'ler_arquivo',
          description: 'Ler',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      ],
      { timeoutMs: 1000 },
    );

    expect(result.text).toBe('resposta openai');
    expect(result.toolCalls?.[0]?.name).toBe('ler_arquivo');
    expect(result.toolCalls?.[0]?.arguments).toEqual({ path: 'README.md' });
    expect(result.finishReason).toBe('tool_calls');
  });

  it('throws sanitized provider error on non-ok response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const provider = new OpenAIProvider({ apiKey: 'k', model: 'gpt-4o-mini' });
    await expect(
      provider.chat([{ role: 'user', content: 'x' }], undefined, { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});
