/**
 * TASK-017 — Contratos de provider LLM
 *
 * ILlmProvider: contrato único para todos os providers LLM (Gemini, DeepSeek, Groq).
 * O AgentLoop usa exclusivamente este contrato — nunca SDKs de vendor diretamente.
 * Cada provider implementa este contrato e normaliza as diferenças de API internamente.
 */

// ---------------------------------------------------------------------------
// Tipos de mensagem (input)
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: MessageRole;
  content: string;
  /** Presente quando role='tool': identificador da tool call que gerou este resultado. */
  toolCallId?: string;
  /** Nome da tool, presente quando role='tool'. */
  toolName?: string;
  /** Presente quando role='assistant' e o provider solicitou tool calls. */
  toolCalls?: LlmToolCall[];
}

// ---------------------------------------------------------------------------
// Definição de tools (enviadas ao provider)
// ---------------------------------------------------------------------------

export interface LlmToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: LlmToolParameter;
  properties?: Record<string, LlmToolParameter>;
  required?: string[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, LlmToolParameter>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Resultado de tool call (retornado pelo provider)
// ---------------------------------------------------------------------------

export interface LlmToolCall {
  /** ID único desta tool call, gerado pelo provider. */
  id: string;
  /** Nome da tool a ser executada. */
  name: string;
  /** Argumentos como objeto já parseado (não string JSON). */
  arguments: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Opções de chamada
// ---------------------------------------------------------------------------

export interface LlmCallOptions {
  /** Timeout em milissegundos para a chamada ao provider. */
  timeoutMs: number;
  /** Temperatura, se suportada pelo provider. */
  temperature?: number;
  /** Número máximo de tokens na resposta. */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Resultado normalizado
// ---------------------------------------------------------------------------

export type FinishReason =
  | 'stop'        // Resposta textual completa
  | 'tool_calls'  // Provider solicitou execução de tools
  | 'length'      // Truncado por limite de tokens
  | 'error'       // Erro normalizado
  | 'timeout'     // Timeout da chamada
  | 'unknown';    // Motivo não mapeado pelo provider

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmResponse {
  /**
   * Texto gerado pelo provider.
   * Ausente quando finishReason='tool_calls'.
   * Presente (mas pode ser vazio) quando finishReason='stop'.
   */
  text?: string;

  /**
   * Tool calls solicitadas pelo provider.
   * Presente apenas quando finishReason='tool_calls'.
   * Nunca misturado com text na mesma resposta.
   */
  toolCalls?: LlmToolCall[];

  /** Motivo de término da geração. */
  finishReason?: FinishReason;

  /** Uso de tokens, se reportado pelo provider. */
  usage?: LlmUsage;

  /**
   * Metadados opacos específicos do provider.
   * O AgentLoop não deve depender deste campo para lógica de negócio.
   * Útil para logging/debugging.
   */
  providerMetadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Erro normalizado
// ---------------------------------------------------------------------------

/**
 * Erro sanitizado retornado pelo provider.
 * O provider NUNCA propaga erros brutos de SDK para o AgentLoop.
 */
export class LlmProviderError extends Error {
  constructor(
    /** Mensagem sanitizada, sem dados internos do provider. */
    message: string,
    /** Código de erro para categorização no AgentLoop. */
    public readonly code: 'timeout' | 'rate_limit' | 'auth' | 'invalid_request' | 'provider_error' | 'unknown',
    /** Indica se uma retry pode ser tentada. */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

// ---------------------------------------------------------------------------
// Contrato do provider
// ---------------------------------------------------------------------------

export interface ILlmProvider {
  /** Identificador do provider. Ex.: `gemini`, `deepseek`, `groq`. */
  readonly providerId: string;

  /**
   * Envia uma conversa ao provider e retorna a resposta normalizada.
   *
   * Contrato de comportamento:
   * - Nunca lança exceção nativa de SDK — sempre retorna LlmResponse ou lança LlmProviderError.
   * - Timeout deve ser enforced internamente com base em options.timeoutMs.
   * - Em caso de timeout, lança LlmProviderError com code='timeout'.
   * - Ausência de texto E ausência de toolCalls indica finishReason='unknown'.
   * - O provider normaliza formatos de tool calls de cada vendor antes de retornar.
   *
   * @param messages Histórico de mensagens da conversa.
   * @param tools Definições de tools disponíveis (opcional).
   * @param options Opções de chamada (timeoutMs obrigatório).
   * @throws LlmProviderError em caso de falha.
   */
  chat(
    messages: LlmMessage[],
    tools: LlmToolDefinition[] | undefined,
    options: LlmCallOptions,
  ): Promise<LlmResponse>;
}
