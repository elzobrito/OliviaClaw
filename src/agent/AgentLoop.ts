import { BASE_SYSTEM_PROMPT } from './BaseSystemPrompt.js';
import type { PipelineContext } from '../controller/PipelineContext.js';
import type { ILlmProvider, LlmMessage, LlmToolCall, LlmToolDefinition } from '../llm/ILlmProvider.js';
import { normalizeToolCalls } from '../llm/ToolCallNormalizer.js';
import { validateToolCall } from '../llm/ToolCallValidator.js';
import { buildSelfCorrectionObservation } from '../llm/SelfCorrectionObservationBuilder.js';
import type { OutputSafetyValidator } from './OutputSafetyValidator.js';
import { sanitizeMessageForSafeOutput } from '../lib/errors.js';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

function renderToolSchemas(tools: LlmToolDefinition[]): string {
  if (!tools || tools.length === 0) return '[]';
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return stableStringify(
    sorted.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  );
}

export function composeSystemPrompt(context: Pick<PipelineContext, 'skillSystemPrompt' | 'availableSkillsSummary' | 'toolDefinitions'>): string {
  const sections = [
    BASE_SYSTEM_PROMPT.trim(),
    context.skillSystemPrompt?.trim() || '',
    context.availableSkillsSummary?.trim() || '',
    `TOOLS_SCHEMA_BEGIN\n${renderToolSchemas(context.toolDefinitions)}\nTOOLS_SCHEMA_END`,
  ];

  return sections.filter((section) => section.length > 0).join('\n\n');
}

export function buildLoopMessages(context: Pick<PipelineContext, 'messageHistory' | 'normalizedInput' | 'skillSystemPrompt' | 'availableSkillsSummary' | 'toolDefinitions'>): LlmMessage[] {
  const systemMessage: LlmMessage = {
    role: 'system',
    content: composeSystemPrompt(context),
  };

  const history = Array.isArray(context.messageHistory) ? context.messageHistory : [];
  const userInput = String(context.normalizedInput.text ?? '').trim();
  const userMessage: LlmMessage = {
    role: 'user',
    content: userInput,
  };

  return [systemMessage, ...history, userMessage];
}

export interface ToolExecutionOutcome {
  observation: string;
  filePath?: string;
  audioPath?: string;
}

export interface AgentLoopDependencies {
  provider: ILlmProvider;
  executeToolCall?: (call: LlmToolCall, context: PipelineContext) => Promise<ToolExecutionOutcome>;
  outputSafetyValidator?: OutputSafetyValidator;
  logger?: {
    info: (payload: Record<string, unknown>, message: string) => void;
    warn: (payload: Record<string, unknown>, message: string) => void;
  };
}

export interface AgentLoopConfig {
  maxIterations: number;
  providerTimeoutMs: number;
  maxToolRepairAttemptsPerIteration?: number;
}

function truncateForTelemetry(input: string, max = 240): string {
  const value = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export class AgentLoop {
  private readonly deps: AgentLoopDependencies;
  private readonly maxIterations: number;
  private readonly providerTimeoutMs: number;
  private readonly maxToolRepairAttemptsPerIteration: number;

  constructor(config: AgentLoopConfig, deps: AgentLoopDependencies) {
    this.maxIterations = Math.max(1, config.maxIterations);
    this.providerTimeoutMs = Math.max(1000, config.providerTimeoutMs);
    this.maxToolRepairAttemptsPerIteration = Math.max(1, config.maxToolRepairAttemptsPerIteration ?? 2);
    this.deps = deps;
  }

  private finalize(
    context: PipelineContext,
    text: string,
    outputType: PipelineContext['outputType'] = 'text',
  ): PipelineContext {
    const raw = String(text ?? '').trim();
    const safe = this.deps.outputSafetyValidator
      ? this.deps.outputSafetyValidator.validate(raw)
      : { allowed: true, sanitizedText: raw, blockedReasons: [] };

    if (!safe.allowed) {
      context.diagnostics?.warnings.push('output_blocked_by_safety_validator');
      context.finalResponse = 'Não posso fornecer essa resposta com segurança.';
      context.outputType = 'error';
      return context;
    }

    context.finalResponse = safe.sanitizedText || 'Não foi possível gerar conteúdo útil.';
    context.outputType = outputType ?? 'text';
    return context;
  }

  async run(context: PipelineContext): Promise<PipelineContext> {
    const messages = buildLoopMessages(context);
    const diagnostics = context.diagnostics ?? {
      iterations: 0,
      warnings: [],
      startedAt: new Date().toISOString(),
    };
    context.diagnostics = diagnostics;

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      diagnostics.iterations = iteration;
      diagnostics.effectiveProvider = this.deps.provider.providerId;

      let llmResponse: Awaited<ReturnType<ILlmProvider['chat']>>;
      try {
        llmResponse = await this.deps.provider.chat(
          messages,
          context.toolDefinitions,
          { timeoutMs: this.providerTimeoutMs },
        );
      } catch (error) {
        const safeMessage = sanitizeMessageForSafeOutput(error instanceof Error ? error.message : String(error));
        diagnostics.warnings.push(`provider_error:${safeMessage}`);

        this.deps.logger?.warn(
          {
            provider: this.deps.provider.providerId,
            iteration,
            action: 'provider_error',
            observation: truncateForTelemetry(safeMessage),
            status: 'continue',
          },
          'AgentLoop iteration telemetry',
        );
        continue;
      }

      const finishReason = llmResponse.finishReason ?? 'unknown';
      const providerName = ['gemini', 'deepseek', 'groq', 'openai'].includes(this.deps.provider.providerId)
        ? (this.deps.provider.providerId as 'gemini' | 'deepseek' | 'groq' | 'openai')
        : 'gemini';
      const normalizedToolCalls = Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0
        ? llmResponse.toolCalls
        : normalizeToolCalls(providerName, (llmResponse.providerMetadata as any)?.rawToolCalls ?? []);
      const hasToolCalls = normalizedToolCalls.length > 0;

      if (hasToolCalls) {
        let actionName = 'tool_calls';
        let lastObservation = '';
        let repairAttempts = 0;

        messages.push({
          role: 'assistant',
          content: llmResponse.text ?? '',
          toolCalls: normalizedToolCalls,
        });

        for (const call of normalizedToolCalls) {
          const validated = validateToolCall(call, context.toolDefinitions);
          if (!validated.ok) {
            repairAttempts += 1;
            const observation = buildSelfCorrectionObservation({
              toolName: call.name,
              error: validated.error,
            });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: observation,
            });
            lastObservation = observation;
            actionName = `repair:${call.name}`;

            if (repairAttempts >= this.maxToolRepairAttemptsPerIteration) {
              diagnostics.warnings.push('tool_self_correction_limit_reached');
              break;
            }
            continue;
          }

          actionName = call.name;
          if (!this.deps.executeToolCall) {
            diagnostics.warnings.push('tool_bridge_unavailable');
            lastObservation = 'Tool bridge unavailable.';
            continue;
          }

          try {
            const outcome = await this.deps.executeToolCall(call, context);
            lastObservation = String(outcome.observation ?? '');
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: outcome.observation,
            });

            if (outcome.filePath) context.filePath = outcome.filePath;
            if (outcome.audioPath) context.audioPath = outcome.audioPath;
          } catch {
            diagnostics.warnings.push(`tool_execution_failed:${call.name}`);
            lastObservation = `Tool execution failed for ${call.name}.`;
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: lastObservation,
            });
          }
        }

        this.deps.logger?.info(
          {
            provider: this.deps.provider.providerId,
            iteration,
            action: actionName,
            observation: truncateForTelemetry(lastObservation),
            status: 'continue',
          },
          'AgentLoop iteration telemetry',
        );
        continue;
      }

      if (typeof llmResponse.text === 'string' && llmResponse.text.trim().length > 0) {
        const outputType = context.filePath
          ? 'file'
          : context.audioPath
            ? 'audio'
            : 'text';
        this.finalize(context, llmResponse.text.trim(), outputType);

        this.deps.logger?.info(
          {
            provider: this.deps.provider.providerId,
            iteration,
            action: 'respond_final',
            observation: truncateForTelemetry(context.finalResponse ?? ''),
            status: 'done',
          },
          'AgentLoop iteration telemetry',
        );
        return context;
      }

      this.deps.logger?.warn(
        {
          provider: this.deps.provider.providerId,
          iteration,
          action: 'no_output',
          observation: truncateForTelemetry(finishReason),
          status: 'continue',
        },
        'AgentLoop iteration telemetry',
      );
    }

    this.finalize(
      context,
      context.finalResponse ?? 'Não foi possível concluir a resposta com segurança.',
      context.outputType ?? 'error',
    );
    diagnostics.warnings.push('max_iterations_reached');
    return context;
  }
}
