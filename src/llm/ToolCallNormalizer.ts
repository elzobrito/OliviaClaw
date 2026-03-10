import { LlmToolCall } from './ILlmProvider.js';

type ProviderName = 'gemini' | 'deepseek' | 'groq' | 'openai';

function safeJsonParse(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input !== null) {
    return input as Record<string, unknown>;
  }

  if (typeof input !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function normalizeToolCalls(provider: ProviderName, rawToolCalls: unknown): LlmToolCall[] {
  if (!Array.isArray(rawToolCalls)) return [];

  return rawToolCalls
    .map((raw, index) => {
      const call = (raw ?? {}) as any;

      if (provider === 'gemini') {
        const fn = call?.functionCall ?? call?.function_call ?? call;
        const name = String(fn?.name ?? '').trim();
        if (!name) return null;
        return {
          id: String(call?.id ?? `gemini-call-${index + 1}`),
          name,
          arguments: safeJsonParse(fn?.args ?? fn?.arguments),
        };
      }

      const fn = call?.function ?? call;
      const name = String(fn?.name ?? '').trim();
      if (!name) return null;

      return {
        id: String(call?.id ?? `${provider}-call-${index + 1}`),
        name,
        arguments: safeJsonParse(fn?.arguments ?? fn?.args),
      };
    })
    .filter((item): item is LlmToolCall => Boolean(item));
}
