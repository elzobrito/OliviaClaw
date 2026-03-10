/**
 * TASK-008 — Contratos normalizados de canal
 *
 * InputAdapter: contrato de borda de entrada.
 * Cada canal implementa este contrato para traduzir eventos nativos em NormalizedInput.
 *
 * O adapter é responsável por:
 *   1. Receber eventos do canal (ex.: updates do Telegram)
 *   2. Verificar autorização (actorId em TELEGRAM_ALLOWED_USER_IDS)
 *   3. Baixar e normalizar mídia, se presente
 *   4. Construir o NormalizedInput com actorId canônico
 *   5. Entregar ao core via callback ou queue
 *
 * O adapter NUNCA passa objetos de SDK (ctx, Update, etc.) além desta fronteira.
 */

import type { NormalizedInput } from './NormalizedInput.js';
import type { ChannelCapabilities } from './ChannelCapabilities.js';

export interface InputAdapter {
  /** Identificador único do canal implementado. Ex.: `telegram`. */
  readonly channelId: string;

  /** Capacidades do canal. */
  readonly capabilities: ChannelCapabilities;

  /**
   * Inicia o adapter (ex.: registra handlers de update, inicia polling/webhook).
   * @param onMessage Callback invocado para cada mensagem normalizada recebida.
   */
  start(onMessage: (input: NormalizedInput) => Promise<void>): Promise<void>;

  /** Para o adapter de forma limpa. */
  stop(): Promise<void>;
}
