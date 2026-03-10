/**
 * TASK-011 — MediaIngressPolicy
 *
 * Contrato de admissão de mídia: define o shape da decisão de ingress
 * e os tipos de mídia suportados. A validação ocorre na borda (adapter),
 * antes de qualquer processamento pesado (FFmpeg, Whisper).
 *
 * O adapter decide se o arquivo pode entrar no pipeline.
 * O core nunca recebe mídia rejeitada.
 */

// ---------------------------------------------------------------------------
// Tipos MIME suportados
// ---------------------------------------------------------------------------

export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
] as const;

export const SUPPORTED_FILE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type SupportedAudioMime = typeof SUPPORTED_AUDIO_MIME_TYPES[number];
export type SupportedFileMime = typeof SUPPORTED_FILE_MIME_TYPES[number];
export type SupportedMime = SupportedAudioMime | SupportedFileMime;

// ---------------------------------------------------------------------------
// Razões de rejeição (sanitizadas — sem paths internos ou detalhes técnicos)
// ---------------------------------------------------------------------------

export type IngressRejectionReason =
  | 'unsupported_mime_type'
  | 'file_too_large'
  | 'duration_too_long'
  | 'download_timeout'
  | 'download_failed'
  | 'mime_type_undetectable'
  | 'zero_byte_file';

// ---------------------------------------------------------------------------
// Resultado da decisão de ingress
// ---------------------------------------------------------------------------

export type MediaIngressDecision =
  | MediaIngressAdmitted
  | MediaIngressRejected;

export interface MediaIngressAdmitted {
  admitted: true;

  /** Caminho local do arquivo em tmp/ após download. */
  filePath: string;

  /** MIME type normalizado e validado. */
  mimeType: SupportedMime;

  /** Tamanho em bytes. */
  sizeBytes: number;

  /** Duração em segundos (apenas para áudio). undefined para arquivos. */
  durationSeconds?: number;

  /** O arquivo pode ser transcrito por Whisper (é áudio suportado). */
  canTranscribe: boolean;

  /** O arquivo pode ser encaminhado como anexo ao canal de saída. */
  canForwardAsAttachment: boolean;
}

export interface MediaIngressRejected {
  admitted: false;

  /** Motivo sanitizado da rejeição. Seguro para logar e exibir. */
  reason: IngressRejectionReason;

  /** Mensagem legível para o usuário (sem detalhes técnicos internos). */
  userMessage: string;
}

// ---------------------------------------------------------------------------
// Limites da política (lidos de env via src/config/env.ts)
// ---------------------------------------------------------------------------

export interface MediaIngressLimits {
  /** Tamanho máximo do arquivo em bytes. */
  maxSizeBytes: number;

  /** Duração máxima de áudio em segundos. */
  maxAudioDurationSeconds: number;

  /** Timeout de download em milissegundos. */
  downloadTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Contrato do validador de ingress
// ---------------------------------------------------------------------------

export interface IMediaIngressValidator {
  /**
   * Avalia se um arquivo recebido pode entrar no pipeline.
   *
   * Contrato:
   * - Nunca lança exceção — retorna MediaIngressRejected em caso de falha.
   * - Realiza download, detecção de MIME e validação de limites.
   * - Em caso de admissão, o arquivo já está em tmp/ e pronto para processamento.
   * - Em caso de rejeição, nenhum arquivo residual é deixado em tmp/.
   *
   * @param remoteUrl URL do arquivo a baixar (ex.: URL do Telegram).
   * @param limits Limites operacionais lidos da configuração.
   */
  validate(remoteUrl: string, limits: MediaIngressLimits): Promise<MediaIngressDecision>;
}
