import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../src/llm/providers/GeminiProvider';
import { LlmProviderError } from '../../src/llm/ILlmProvider';

describe('GeminiProvider', () => {
  it('normalizes text and functionCall output', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { text: 'resposta final' },
                { functionCall: { name: 'ler_arquivo', args: { path: 'README.md' } } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.0-flash' });
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

    expect(result.text).toBe('resposta final');
    expect(result.toolCalls?.[0]?.name).toBe('ler_arquivo');
    expect(result.toolCalls?.[0]?.arguments).toEqual({ path: 'README.md' });
    expect(result.finishReason).toBe('tool_calls');
  });

  it('throws sanitized provider error on non-ok http response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.0-flash' });
    await expect(
      provider.chat([{ role: 'user', content: 'x' }], undefined, { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});
