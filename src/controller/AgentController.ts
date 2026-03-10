import type { NormalizedInput } from '../channels/contracts/NormalizedInput.js';
import type { NormalizedOutput } from '../channels/contracts/NormalizedOutput.js';
import type { PipelineContext } from './PipelineContext.js';
import { MessageQueue } from './MessageQueue.js';
import type { LlmMessage, LlmToolDefinition, LlmToolParameter } from '../llm/ILlmProvider.js';
import type { Skill } from '../skills/types.js';
import { sanitizeMessageForSafeOutput } from '../lib/errors.js';

interface ConversationLike {
  id: string;
}

interface MemoryMessageLike {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface MemoryManagerPort {
  findOrCreateConversation(actorId: string): ConversationLike;
  getHistory(conversationId: string, memoryWindowSize: number): MemoryMessageLike[];
  persistMessage(params: {
    conversationId: string;
    role: string;
    content: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  }): number;
}

interface MediaPreprocessorPort {
  preprocess(input: NormalizedInput): Promise<NormalizedInput>;
}

interface SkillLoaderPort {
  load(): Promise<{ skills: Skill[]; errors: unknown[] }>;
  buildAvailableSkillsSummary?(skills?: Skill[]): string;
}

interface SkillRouterPort {
  routeWithFallback(input: string, skills: Skill[]): Promise<{ skillName: string | null }>;
}

interface ToolLike {
  definition: {
    name: string;
    description: string;
    schema: unknown;
  };
}

interface ToolRegistryPort {
  getGlobalTools(): ToolLike[];
  getByName(name: string): ToolLike | undefined;
}

interface AgentLoopPort {
  run(context: PipelineContext): Promise<PipelineContext>;
}

export interface AgentControllerConfig {
  provider: string;
  memoryWindowSize: number;
}

export interface AgentControllerDependencies {
  messageQueue: MessageQueue;
  mediaPreprocessor: MediaPreprocessorPort;
  memoryManager: MemoryManagerPort;
  skillLoader: SkillLoaderPort;
  skillRouter: SkillRouterPort;
  toolRegistry: ToolRegistryPort;
  agentLoop: AgentLoopPort;
}

function buildAvailableSkillsSummary(skills: Skill[]): string {
  return skills
    .map((skill) => {
      const triggers = skill.triggers.length > 0 ? skill.triggers.join(', ') : '-';
      return `${skill.name} [${triggers}] - ${skill.description}`;
    })
    .sort()
    .join('\n');
}

function toLlmToolDefinition(tool: { definition: { name: string; description: string; schema: any } }): LlmToolDefinition {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: {
      type: 'object',
      properties: (tool.definition.schema?.properties ?? {}) as Record<string, LlmToolParameter>,
      required: Array.isArray(tool.definition.schema?.required)
        ? [...tool.definition.schema.required]
        : undefined,
    },
  };
}

export class AgentController {
  private readonly provider: string;
  private readonly memoryWindowSize: number;
  private readonly deps: AgentControllerDependencies;

  constructor(config: AgentControllerConfig, deps: AgentControllerDependencies) {
    this.provider = config.provider;
    this.memoryWindowSize = config.memoryWindowSize;
    this.deps = deps;
  }

  private resolveOutput(context: PipelineContext): NormalizedOutput {
    if (context.filePath) {
      return {
        outputType: 'file',
        filePath: context.filePath,
        text: context.finalResponse,
        channelRef: context.channelRef,
      };
    }

    if (context.audioPath) {
      return {
        outputType: 'audio',
        audioPath: context.audioPath,
        text: context.finalResponse,
        channelRef: context.channelRef,
      };
    }

    if (context.outputType === 'text' && context.finalResponse) {
      return {
        outputType: 'text',
        text: context.finalResponse,
        channelRef: context.channelRef,
      };
    }

    return {
      outputType: 'error',
      text: context.finalResponse ?? 'Falha controlada: sem resposta final.',
      channelRef: context.channelRef,
    };
  }

  private persistAssistantFinalMessage(context: PipelineContext, output: NormalizedOutput): void {
    if (output.outputType === 'error') {
      return;
    }

    const content =
      output.outputType === 'file'
        ? context.finalResponse ?? 'Arquivo gerado.'
        : output.outputType === 'audio'
          ? context.finalResponse ?? 'Áudio gerado.'
          : output.text ?? context.finalResponse ?? '';

    const normalized = String(content).trim();
    if (!normalized) return;

    try {
      this.deps.memoryManager.persistMessage({
        conversationId: context.conversationId,
        role: 'assistant',
        content: normalized,
        provider: context.provider,
        metadata: {
          outputType: output.outputType,
        },
      });
    } catch {
      context.diagnostics?.warnings.push('postloop_persist_failed');
    }
  }

  async enqueue(
    input: NormalizedInput,
    onOutput: (output: NormalizedOutput, context: PipelineContext) => Promise<void>,
  ): Promise<boolean> {
    return this.deps.messageQueue.enqueue(input.actorId, async () => {
      const { output, context } = await this.process(input);
      await onOutput(output, context);
    });
  }

  async process(input: NormalizedInput): Promise<{ output: NormalizedOutput; context: PipelineContext }> {
    const context = await this.prepareContext(input);
    let loopContext = context;

    try {
      loopContext = await this.deps.agentLoop.run(context);
    } catch (error) {
      const safeError = sanitizeMessageForSafeOutput(error instanceof Error ? error.message : String(error));
      loopContext.finalResponse = `Falha controlada no loop: ${safeError}`;
      loopContext.outputType = 'error';
      loopContext.diagnostics?.warnings.push('agent_loop_failed');
    }

    const output = this.resolveOutput(loopContext);
    this.persistAssistantFinalMessage(loopContext, output);

    return { output, context: loopContext };
  }

  async prepareContext(input: NormalizedInput): Promise<PipelineContext> {
    const normalizedInput = await this.deps.mediaPreprocessor.preprocess(input);
    const conversation = this.deps.memoryManager.findOrCreateConversation(normalizedInput.actorId);
    const warnings: string[] = [];

    const normalizedTextForModel = String(normalizedInput.text ?? '').trim();
    if (normalizedTextForModel.length > 0) {
      try {
        this.deps.memoryManager.persistMessage({
          conversationId: conversation.id,
          role: 'user',
          content: normalizedTextForModel,
          provider: this.provider,
          metadata: {
            channel: normalizedInput.channel,
            inputType: normalizedInput.inputType,
          },
        });
      } catch {
        warnings.push('preloop_persist_failed');
      }
    }

    const loaded = await this.deps.skillLoader.load();
    const availableSkillsSummary = this.deps.skillLoader.buildAvailableSkillsSummary
      ? this.deps.skillLoader.buildAvailableSkillsSummary(loaded.skills)
      : buildAvailableSkillsSummary(loaded.skills);
    const routeResult = await this.deps.skillRouter.routeWithFallback(
      normalizedInput.text ?? '',
      loaded.skills,
    );
    const resolvedSkill = routeResult.skillName
      ? loaded.skills.find((skill) => skill.name === routeResult.skillName) ?? null
      : null;
    const skillSystemPrompt = resolvedSkill?.skillSystemPrompt ?? '';

    const globalTools = this.deps.toolRegistry.getGlobalTools();
    const skillTools = resolvedSkill?.tools
      .map((toolName) => this.deps.toolRegistry.getByName(toolName))
      .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool)) ?? [];

    const uniqueTools = [...globalTools, ...skillTools].filter((tool, index, all) => {
      const firstIndex = all.findIndex((item) => item.definition.name === tool.definition.name);
      return firstIndex === index;
    });
    const toolDefinitions: LlmToolDefinition[] = uniqueTools.map(toLlmToolDefinition);

    const messageHistory: LlmMessage[] = this.deps.memoryManager
      .getHistory(conversation.id, this.memoryWindowSize)
      .map((item) => ({ role: item.role, content: item.content }));

    if (loaded.errors.length > 0) {
      warnings.push(`skill_load_errors=${loaded.errors.length}`);
    }

    return {
      actorId: normalizedInput.actorId,
      channel: normalizedInput.channel,
      channelRef: normalizedInput.channelRef,
      normalizedInput,
      conversationId: conversation.id,
      provider: this.provider,
      resolvedSkill,
      skillSystemPrompt,
      availableSkillsSummary,
      toolDefinitions,
      messageHistory,
      requiresAudioReply: normalizedInput.requiresAudioReply,
      diagnostics: {
        iterations: 0,
        warnings,
        startedAt: new Date().toISOString(),
      },
    };
  }
}
