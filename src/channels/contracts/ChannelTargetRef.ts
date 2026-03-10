/**
 * TASK-008 — Contratos normalizados de canal
 *
 * ChannelTargetRef: referência mínima necessária para o OutputAdapter
 * enviar uma resposta ao canal correto, sem vazar tipos específicos de SDK.
 *
 * O core não inspeciona nem modifica este objeto — ele é passado de volta
 * intacto ao OutputAdapter que sabe interpretá-lo.
 */

export interface ChannelTargetRef {
  /** Identificador do canal. Ex.: `telegram`, `cli`. */
  channel: string;

  /**
   * Payload opaco específico do canal, necessário para rotear a resposta.
   * Para Telegram: pode conter chatId e messageId para reply.
   * O core nunca acessa campos internos deste objeto.
   */
  ref: Record<string, unknown>;
}
