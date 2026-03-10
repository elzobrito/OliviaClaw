/**
 * TASK-020 — PipelineContext e contrato de orquestração
 *
 * PipelineContext: objeto agnóstico de canal que representa o estado completo
 * de uma mensagem em processamento pelo AgentLoop.
 *
 * Cada campo tem um dono explícito (componente responsável por preenchê-lo)
 * e uma etapa em que se torna disponível.
 *
 * outputType deve ser um dos valores: 'text' | 'file' | 'audio' | 'error'
 * (alinhado com NormalizedOutput.OutputType de src/channels/contracts/NormalizedOutput.ts)
 */

import type { NormalizedInput } from '../channels/contracts/NormalizedInput.js';
import type { ChannelTargetRef } from '../channels/contracts/ChannelTargetRef.js';
import type { LlmMessage, LlmToolDefinition } from '../llm/ILlmProvider.js';
import type { Skill } from '../skills/types.js';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export type PipelineOutputType = 'text' | 'file' | 'audio' | 'error';

export interface PipelineDiagnostics {
  /** Número de iterações do loop ReAct executadas neste pipeline. */
  iterations: number;
  /** Provider LLM efetivamente usado (pode diferir de `provider` se houve fallback). */
  effectiveProvider?: string;
  /** Erros não-fatais coletados durante o pipeline (tool falhas, fallbacks, etc.). */
  warnings: string[];
  /** Timestamp ISO de início do pipeline. */
  startedAt: string;
  /** Timestamp ISO de fim do pipeline. Preenchido pelo AgentController ao finalizar. */
  finishedAt?: string;
}

// ---------------------------------------------------------------------------
// PipelineContext
// ---------------------------------------------------------------------------

/**
 * Estado completo de uma mensagem em processamento.
 *
 * DONO DE CADA CAMPO (quem preenche e quando):
 *
 * Etapa 1 — InputAdapter (antes de entrar no AgentController):
 *   actorId, channel, channelRef, normalizedInput
 *
 * Etapa 2 — AgentController (ao criar o contexto):
 *   conversationId, provider, diagnostics (inicializado)
 *
 * Etapa 3 — SkillLoader / Router (antes do loop):
 *   resolvedSkill, skillSystemPrompt, availableSkillsSummary
 *
 * Etapa 4 — ToolRegistry (antes do loop):
 *   toolDefinitions
 *
 * Etapa 5 — MemoryManager (antes do loop):
 *   messageHistory
 *
 * Etapa 6 — AgentLoop (durante iterações):
 *   messageHistory (atualizado a cada iteração)
 *   diagnostics.iterations (incrementado)
 *
 * Etapa 7 — AgentLoop (ao produzir resposta final):
 *   finalResponse, outputType, filePath?, audioPath?, requiresAudioReply
 *
 * Etapa 8 — AgentController (ao finalizar):
 *   diagnostics.finishedAt
 */
export interface PipelineContext {
  // -------------------------------------------------------------------------
  // Identidade e roteamento (Etapa 1)
  // -------------------------------------------------------------------------

  /**
   * Identidade canônica do ator. Formato: `channel:nativeActorId`.
   * Dono: InputAdapter. Disponível desde Etapa 1.
   */
  actorId: string;

  /**
   * Identificador do canal de origem. Ex.: `telegram`, `cli`.
   * Dono: InputAdapter. Disponível desde Etapa 1.
   */
  channel: string;

  /**
   * Referência mínima para roteamento da resposta. Opaco para o core.
   * Dono: InputAdapter. Disponível desde Etapa 1.
   */
  channelRef: ChannelTargetRef;

  /**
   * Input normalizado recebido do canal.
   * Dono: InputAdapter. Disponível desde Etapa 1.
   */
  normalizedInput: NormalizedInput;

  // -------------------------------------------------------------------------
  // Contexto de sessão (Etapa 2)
  // -------------------------------------------------------------------------

  /**
   * Identificador da conversa (thread). Derivado de actorId pelo AgentController.
   * Formato sugerido: `${actorId}:${Date.now()}` ou hash estável por ator.
   * Dono: AgentController. Disponível desde Etapa 2.
   */
  conversationId: string;

  /**
   * Provider LLM selecionado para este pipeline. Pode diferir do DEFAULT_PROVIDER
   * se houve fallback — registrado em diagnostics.effectiveProvider.
   * Dono: AgentController. Disponível desde Etapa 2.
   */
  provider: string;

  // -------------------------------------------------------------------------
  // Skills (Etapa 3)
  // -------------------------------------------------------------------------

  /**
   * Skill ativada para este pipeline. null se nenhuma skill foi selecionada.
   * Dono: SkillLoader/Router. Disponível desde Etapa 3.
   */
  resolvedSkill: Skill | null;

  /**
   * Conteúdo de sistema da skill ativada. String vazia se resolvedSkill=null.
   * Dono: SkillLoader/Router. Disponível desde Etapa 3.
   */
  skillSystemPrompt: string;

  /**
   * Resumo das skills disponíveis, formatado para incluir no prompt de sistema
   * quando nenhuma skill específica foi ativada (para seleção semântica pelo LLM).
   * Dono: SkillLoader. Disponível desde Etapa 3.
   */
  availableSkillsSummary: string;

  // -------------------------------------------------------------------------
  // Tools (Etapa 4)
  // -------------------------------------------------------------------------

  /**
   * Definições das tools disponíveis neste pipeline, derivadas do ToolRegistry
   * filtradas pelas ferramentas permitidas para o actorId.
   * Dono: ToolRegistry. Disponível desde Etapa 4.
   */
  toolDefinitions: LlmToolDefinition[];

  // -------------------------------------------------------------------------
  // Histórico de mensagens (Etapa 5 → atualizado na Etapa 6)
  // -------------------------------------------------------------------------

  /**
   * Histórico de mensagens da conversa.
   * Carregado inicialmente pelo MemoryManager (Etapa 5).
   * Atualizado pelo AgentLoop a cada iteração (Etapa 6).
   * Dono: MemoryManager (carga) + AgentLoop (atualização).
   */
  messageHistory: LlmMessage[];

  // -------------------------------------------------------------------------
  // Resposta final (Etapa 7)
  // -------------------------------------------------------------------------

  /**
   * Resposta final gerada pelo AgentLoop.
   * Texto para outputType=text/error, undefined para file/audio.
   * Dono: AgentLoop. Disponível desde Etapa 7.
   */
  finalResponse?: string;

  /**
   * Tipo de output produzido. Alinhado com NormalizedOutput.OutputType.
   * Dono: AgentLoop. Disponível desde Etapa 7.
   */
  outputType?: PipelineOutputType;

  /**
   * Caminho local do arquivo a enviar. Presente apenas quando outputType='file'.
   * Dono: AgentLoop (via tool de geração de arquivo). Disponível desde Etapa 7.
   */
  filePath?: string;

  /**
   * Caminho local do áudio a enviar. Presente apenas quando outputType='audio'.
   * Dono: MediaPreprocessor/TTS. Disponível desde Etapa 7.
   */
  audioPath?: string;

  /**
   * Se true, o OutputAdapter deve converter finalResponse em áudio antes de enviar.
   * Derivado de normalizedInput.requiresAudioReply.
   * Dono: AgentController (copia de normalizedInput). Disponível desde Etapa 2.
   */
  requiresAudioReply: boolean;

  // -------------------------------------------------------------------------
  // Diagnóstico (Etapa 2 → atualizado até Etapa 8)
  // -------------------------------------------------------------------------

  /**
   * Dados de diagnóstico e auditoria do pipeline.
   * Inicializado pelo AgentController (Etapa 2), atualizado durante o pipeline.
   * Dono: AgentController + AgentLoop. Opcional para não bloquear em caso de falha.
   */
  diagnostics?: PipelineDiagnostics;
}
