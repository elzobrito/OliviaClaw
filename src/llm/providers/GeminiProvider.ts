import {
  ILlmProvider,
  LlmCallOptions,
  LlmMessage,
  LlmProviderError,
  LlmResponse,
  LlmToolDefinition,
} from '../ILlmProvider.js';
import { normalizeToolCalls } from '../ToolCallNormalizer.js';

interface GeminiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

type GeminiFinishReason = 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | string;

function mapFinishReason(reason: GeminiFinishReason | undefined, hasToolCalls: boolean): LlmResponse['finishReason'] {
  if (hasToolCalls) return 'tool_calls';
  if (!reason) return 'unknown';
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  return 'unknown';
}

function toGeminiTools(tools: LlmToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

export class GeminiProvider implements ILlmProvider {
  readonly providerId = 'gemini';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  async chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[] | undefined,
    options: LlmCallOptions,
  ): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const url = `${this.baseUrl}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          tools: toGeminiTools(tools),
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LlmProviderError('Gemini request failed.', 'provider_error', true);
      }

      const json = (await response.json()) as any;
      const candidate = json?.candidates?.[0] ?? {};
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

      const textParts = parts
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .filter((value: string) => value.trim().length > 0);
      const text = textParts.length > 0 ? textParts.join('\n').trim() : undefined;

      const rawFunctionCalls = parts
        .map((part: any) => part?.functionCall ? { functionCall: part.functionCall } : null)
        .filter((item: unknown) => Boolean(item));
      const toolCalls = normalizeToolCalls('gemini', rawFunctionCalls);

      return {
        text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: mapFinishReason(candidate?.finishReason, toolCalls.length > 0),
        usage: {
          promptTokens: json?.usageMetadata?.promptTokenCount,
          completionTokens: json?.usageMetadata?.candidatesTokenCount,
          totalTokens: json?.usageMetadata?.totalTokenCount,
        },
        providerMetadata: {
          model: this.model,
          safetyRatings: candidate?.safetyRatings,
        },
      };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new LlmProviderError('Gemini timeout.', 'timeout', true);
      }
      throw new LlmProviderError('Gemini provider error.', 'provider_error', true);
    } finally {
      clearTimeout(timer);
    }
  }
}
