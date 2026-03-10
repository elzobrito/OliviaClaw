import {
  ILlmProvider,
  LlmCallOptions,
  LlmMessage,
  LlmProviderError,
  LlmResponse,
  LlmToolDefinition,
} from '../ILlmProvider.js';
import { normalizeToolCalls } from '../ToolCallNormalizer.js';
import { sanitizeMessageForSafeOutput } from '../../lib/errors.js';

interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fallbackModels?: string[];
}

function toOpenAIMessages(messages: LlmMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
      };
    }

    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

export class OpenAIProvider implements ILlmProvider {
  readonly providerId = 'openai';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fallbackModels: string[];

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1/chat/completions';
    this.fallbackModels = config.fallbackModels ?? [
      'gpt-5-mini',
      'gpt-5-mini-2025-08-07',
      'gpt-5-nano',
      'gpt-5-nano-2025-08-07',
      'gpt-4o',
      'gpt-4-turbo-2024-04-09',
      'gpt-3.5-turbo',
    ];
  }

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[] | undefined,
    options: LlmCallOptions,
  ): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const toolPayload = Array.isArray(tools) && tools.length > 0
      ? tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined;
    const modelCandidates = [
      this.model,
      ...this.fallbackModels.filter((model) => model && model !== this.model),
    ];
    const openaiMessages = toOpenAIMessages(messages);

    try {
      let lastError: LlmProviderError | null = null;

      for (const model of modelCandidates) {
        const isGpt5Family = model.startsWith('gpt-5');
        const tokenLimitPayload =
          typeof options.maxTokens === 'number'
            ? (isGpt5Family
                ? { max_completion_tokens: options.maxTokens }
                : { max_tokens: options.maxTokens })
            : {};

        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: openaiMessages,
            tools: toolPayload,
            temperature: options.temperature,
            ...tokenLimitPayload,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let details = `HTTP ${response.status}`;
          let providerCode: string | undefined;
          try {
            const payload = (await response.json()) as {
              error?: { message?: string; code?: string; type?: string };
            };
            const message = payload?.error?.message;
            providerCode = payload?.error?.code ?? payload?.error?.type;
            if (message) {
              details = sanitizeMessageForSafeOutput(message);
            }
          } catch {
            // Best effort only; keep generic details on malformed body.
          }

          const code =
            response.status === 401
              ? 'auth'
              : response.status === 429
                ? 'rate_limit'
                : response.status === 400 || response.status === 403
                  ? 'invalid_request'
                  : 'provider_error';
          const retryable = response.status >= 500 || response.status === 429;
          const suffix = providerCode ? ` [${providerCode}]` : '';
          const error = new LlmProviderError(
            `OpenAI request failed (${response.status}): ${details}${suffix} (model=${model})`,
            code,
            retryable,
          );

          const canFallback = response.status === 403 && providerCode === 'model_not_found';
          if (canFallback) {
            lastError = error;
            continue;
          }
          throw error;
        }

        const json = (await response.json()) as any;
        const choice = json?.choices?.[0] ?? {};
        const message = choice?.message ?? {};
        const rawToolCalls = message?.tool_calls;
        const normalizedCalls = normalizeToolCalls('openai', rawToolCalls);

        return {
          text: typeof message?.content === 'string' ? message.content : undefined,
          toolCalls: normalizedCalls.length > 0 ? normalizedCalls : undefined,
          finishReason: normalizedCalls.length > 0 ? 'tool_calls' : (choice?.finish_reason ?? 'unknown'),
          usage: {
            promptTokens: json?.usage?.prompt_tokens,
            completionTokens: json?.usage?.completion_tokens,
            totalTokens: json?.usage?.total_tokens,
          },
          providerMetadata: {
            model: json?.model ?? model,
            id: json?.id,
          },
        };
      }

      if (lastError) {
        throw lastError;
      }
      throw new LlmProviderError('OpenAI provider error.', 'provider_error', true);
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new LlmProviderError('OpenAI timeout.', 'timeout', true);
      }
      throw new LlmProviderError('OpenAI provider error.', 'provider_error', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
