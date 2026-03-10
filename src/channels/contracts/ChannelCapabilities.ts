/**
 * TASK-008 — Contratos normalizados de canal
 *
 * ChannelCapabilities: descreve as capacidades de um canal específico.
 * Usado pelo core ou pelo adapter para decidir o formato de resposta mais adequado.
 */

export interface ChannelCapabilities {
  /** O canal suporta envio de mensagens de texto. */
  supportsText: boolean;

  /** O canal suporta envio de arquivos (documentos, imagens, etc.). */
  supportsFile: boolean;

  /** O canal suporta envio de áudio (voice notes, arquivos de áudio). */
  supportsAudio: boolean;

  /**
   * O canal suporta feedback transitório visível ao usuário enquanto o agente processa.
   * Ex.: "typing..." no Telegram (sendChatAction).
   */
  supportsTransientFeedback: boolean;

  /**
   * Tamanho máximo de mensagem de texto em caracteres, se aplicável.
   * undefined = sem limite conhecido.
   */
  maxTextLength?: number;

  /**
   * Tamanho máximo de arquivo em bytes, se aplicável.
   * undefined = sem limite conhecido.
   */
  maxFileSizeBytes?: number;
}
