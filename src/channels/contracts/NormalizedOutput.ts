/**
 * TASK-008 — Contratos normalizados de canal
 *
 * NormalizedOutput: representação canônica de qualquer resposta produzida pelo core.
 * O OutputAdapter recebe este objeto e o traduz para o formato específico do canal.
 * O core nunca conhece como o canal envia texto, áudio ou arquivo.
 */

import type { ChannelTargetRef } from './ChannelTargetRef.js';

/**
 * Tipo de output produzido pelo core.
 * Enum fechado — novos tipos requerem atualização deste contrato.
 */
export type OutputType = 'text' | 'file' | 'audio' | 'error';

export interface ReplyMetadata {
  /** ID da mensagem original à qual esta é resposta, se aplicável. */
  replyToMessageId?: string | number;
  /** Metadados adicionais opacos para o adapter. */
  extra?: Record<string, unknown>;
}

export interface NormalizedOutput {
  /** Tipo de conteúdo desta resposta. */
  outputType: OutputType;

  /** Texto da resposta, presente quando outputType = 'text' ou outputType = 'error'. */
  text?: string;

  /**
   * Caminho local do arquivo a ser enviado.
   * Presente quando outputType = 'file'.
   * O adapter é responsável por ler e enviar o arquivo, depois descartá-lo.
   */
  filePath?: string;

  /**
   * Caminho local do arquivo de áudio a ser enviado.
   * Presente quando outputType = 'audio'.
   * O adapter é responsável por ler e enviar o áudio, depois descartá-lo.
   */
  audioPath?: string;

  /** MIME type do arquivo, quando aplicável. */
  mimeType?: string;

  /**
   * Referência ao canal e contexto para envio.
   * Repassada do NormalizedInput.channelRef sem modificação pelo core.
   */
  channelRef: ChannelTargetRef;

  /** Metadados opcionais de reply. */
  replyMetadata?: ReplyMetadata;
}
