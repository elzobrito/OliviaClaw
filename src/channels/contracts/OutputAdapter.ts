/**
 * TASK-008 — Contratos normalizados de canal
 *
 * OutputAdapter: contrato de borda de saída.
 * Cada canal implementa este contrato para traduzir NormalizedOutput em chamadas nativas.
 *
 * O adapter é responsável por:
 *   1. Receber NormalizedOutput do core
 *   2. Traduzir para o formato específico do canal (ex.: sendMessage do Telegram)
 *   3. Usar channelRef para rotear a resposta ao destinatário correto
 *   4. Limpar arquivos temporários após envio (filePath, audioPath)
 *   5. Retornar erro normalizado se o envio falhar
 *
 * O adapter NUNCA expõe erros brutos de SDK para o core.
 */

import type { NormalizedOutput } from './NormalizedOutput.js';

export interface OutputSendResult {
  success: boolean;
  /** ID da mensagem enviada no canal, se disponível. */
  sentMessageId?: string | number;
  /** Descrição do erro, sanitizada, se success=false. */
  errorMessage?: string;
}

export interface OutputAdapter {
  /** Identificador único do canal implementado. Ex.: `telegram`. */
  readonly channelId: string;

  /**
   * Envia um NormalizedOutput ao canal.
   * Nunca lança exceção — retorna OutputSendResult com success=false em caso de falha.
   */
  send(output: NormalizedOutput): Promise<OutputSendResult>;

  /**
   * Envia feedback transitório ao canal enquanto o agente processa (ex.: "typing...").
   * No-op silencioso se o canal não suporta (supportsTransientFeedback=false).
   */
  sendTransientFeedback?(channelRef: NormalizedOutput['channelRef']): Promise<void>;
}
