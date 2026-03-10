/**
 * TASK-008 — Contratos normalizados de canal
 *
 * NormalizedInput: representação canônica de qualquer mensagem recebida de qualquer canal.
 * O adapter de canal é responsável por construir este objeto antes de entregar ao core.
 * O core nunca recebe objetos brutos de SDK (ctx do grammY, Update do Telegram, etc.).
 *
 * Regra canônica de identidade:
 *   actorId = `${channel}:${nativeActorId}`
 *   Para Telegram: actorId = `telegram:${String(from.id)}`
 */

export type InputType = 'text' | 'audio' | 'file' | 'command';
import type { ChannelTargetRef } from './ChannelTargetRef.js';

export interface MediaAttachment {
  /** Caminho local temporário do arquivo (em tmp/) após download */
  filePath: string;
  mimeType: string;
  /** Tamanho em bytes, se disponível */
  sizeBytes?: number;
  /** Duração em segundos, para áudio/vídeo */
  durationSeconds?: number;
  /** Nome original do arquivo, se disponível */
  originalName?: string;
}

export interface NormalizedInput {
  /**
   * Identidade canônica do ator. Formato: `channel:nativeActorId`.
   * Exemplos: `telegram:123456789`, `cli:local`.
   * Tratado como string opaca pelo core — nunca parseado internamente.
   */
  actorId: string;

  /** Identificador do canal de origem. Ex.: `telegram`, `cli`. */
  channel: string;

  /**
   * Referência mínima ao canal necessária para responder.
   * Opaco para o core — repassado intacto ao OutputAdapter.
   */
  channelRef: ChannelTargetRef;

  /** Tipo principal da mensagem recebida. */
  inputType: InputType;

  /** Texto da mensagem, se presente. */
  text?: string;

  /** Anexos de mídia normalizados, se presentes. */
  attachments?: MediaAttachment[];

  /**
   * Indica que o ator espera resposta em áudio (ex.: enviou um voice note).
   * O core pode usar este flag para decidir se chama o serviço TTS na resposta.
   */
  requiresAudioReply: boolean;

  /** Metadados opcionais específicos do canal, opacos para o core. */
  metadata?: Record<string, unknown>;

  /** Timestamp ISO 8601 de quando a mensagem foi recebida pelo adapter. */
  receivedAt: string;
}
