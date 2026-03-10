import {
  ILlmProvider,
  LlmCallOptions,
  LlmMessage,
  LlmProviderError,
  LlmResponse,
  LlmToolDefinition,
} from '../ILlmProvider.js';
import { normalizeToolCalls } from '../ToolCallNormalizer.js';

interface DeepSeekProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class DeepSeekProvider implements ILlmProvider {
  readonly providerId = 'deepseek';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: DeepSeekProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://api.deepseek.com/v1/chat/completions';
  }

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[] | undefined,
    options: LlmCallOptions,
  ): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LlmProviderError('DeepSeek request failed.', 'provider_error', true);
      }

      const json = (await response.json()) as any;
      const choice = json?.choices?.[0] ?? {};
      const message = choice?.message ?? {};
      const rawToolCalls = message?.tool_calls;
      const normalizedCalls = normalizeToolCalls('deepseek', rawToolCalls);

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
          model: json?.model,
          id: json?.id,
        },
      };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new LlmProviderError('DeepSeek timeout.', 'timeout', true);
      }
      throw new LlmProviderError('DeepSeek provider error.', 'provider_error', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
