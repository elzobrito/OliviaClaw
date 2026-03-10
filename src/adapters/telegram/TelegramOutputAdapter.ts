import type { OutputAdapter, OutputSendResult } from '../../channels/contracts/OutputAdapter.js';
import type { NormalizedOutput } from '../../channels/contracts/NormalizedOutput.js';
import { stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../lib/logger.js';

const TELEGRAM_MAX_TEXT = 4096;
const TELEGRAM_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_RETRY_AFTER_SECONDS = 10;

interface TelegramSendApi {
  sendMessage(
    chatId: number | string,
    text: string,
    options?: { reply_to_message_id?: number | string },
  ): Promise<{ message_id?: number | string }>;
  sendDocument(
    chatId: number | string,
    document: string,
    options?: { reply_to_message_id?: number | string; filename?: string },
  ): Promise<{ message_id?: number | string }>;
  sendAudio(
    chatId: number | string,
    audio: string,
    options?: { reply_to_message_id?: number | string },
  ): Promise<{ message_id?: number | string }>;
}

interface TelegramRef {
  chatId?: number | string;
  chat_id?: number | string;
  messageId?: number | string;
  message_id?: number | string;
}

interface TelegramApiLikeError {
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
  message?: string;
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((x) => x.trim()).filter((x) => x.length > 0);
}

function splitLines(text: string): string[] {
  return text.split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 0);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 0);
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).map((x) => x.trim()).filter((x) => x.length > 0);
}

function packUnits(units: string[], joiner: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (unit.length > maxLen) {
      throw new Error('Unit exceeds maximum length');
    }

    const candidate = current.length === 0 ? unit : `${current}${joiner}${unit}`;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
    }
    current = unit;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function chunkByHierarchy(segment: string, maxLen: number, level = 0): string[] {
  if (segment.length <= maxLen) {
    return [segment];
  }

  const levels = [
    { split: splitParagraphs, joiner: '\n\n' },
    { split: splitLines, joiner: '\n' },
    { split: splitSentences, joiner: ' ' },
    { split: splitWords, joiner: ' ' },
  ] as const;

  const current = levels[level];
  if (!current) {
    throw new Error('Unable to chunk text without breaking words');
  }

  const units = current.split(segment);
  if (units.length <= 1) {
    return chunkByHierarchy(segment, maxLen, level + 1);
  }

  const packed = packUnits(units, current.joiner, maxLen);
  const final: string[] = [];

  for (const chunk of packed) {
    if (chunk.length <= maxLen) {
      final.push(chunk);
      continue;
    }

    final.push(...chunkByHierarchy(chunk, maxLen, level + 1));
  }

  return final;
}

function chunkTelegramText(text: string, maxLen = TELEGRAM_MAX_TEXT): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) return [''];
  return chunkByHierarchy(normalized, maxLen);
}

function resolveChatRef(output: NormalizedOutput): {
  chatId: number | string;
  replyToMessageId?: number | string;
} {
  const ref = output.channelRef.ref as TelegramRef;
  const chatId = ref.chatId ?? ref.chat_id;

  if (chatId == null) {
    throw new Error('Missing Telegram chatId in channelRef');
  }

  const replyToMessageId =
    output.replyMetadata?.replyToMessageId ?? ref.messageId ?? ref.message_id;

  return { chatId, replyToMessageId };
}

function inferSafeFilename(filePath: string): string {
  const base = path.basename(filePath);
  const fallback = 'file.bin';
  const raw = base && base.trim().length > 0 ? base : fallback;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function requiresAudioReply(output: NormalizedOutput): boolean {
  const flag = output.replyMetadata?.extra?.requiresAudioReply;
  return flag === true;
}

function parseRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as TelegramApiLikeError;
  const retryAfter = e.parameters?.retry_after;
  if (e.error_code === 429 && typeof retryAfter === 'number' && retryAfter > 0) {
    return retryAfter;
  }
  return null;
}

function isUserBlockedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as TelegramApiLikeError;
  const description = (e.description ?? e.message ?? '').toLowerCase();
  return e.error_code === 403 && description.includes('blocked');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramOutputAdapter implements OutputAdapter {
  readonly channelId = 'telegram';

  constructor(private readonly api: TelegramSendApi) {}

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isUserBlockedError(error)) {
        logger.warn({}, 'Telegram user blocked bot; stopping delivery without retry');
        throw error;
      }

      const retryAfterSeconds = parseRetryAfterSeconds(error);
      if (retryAfterSeconds == null) {
        throw error;
      }

      if (retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) {
        logger.warn({ retryAfterSeconds }, 'Retry-After exceeds adapter threshold; degrading delivery');
        throw error;
      }

      await sleep(retryAfterSeconds * 1000);
      return operation();
    }
  }

  private async cleanupTemporaryPath(filePath?: string): Promise<void> {
    if (!filePath) return;
    try {
      await unlink(filePath);
    } catch {
      // Cleanup é melhor esforço; falha não deve quebrar entrega.
    }
  }

  async send(output: NormalizedOutput): Promise<OutputSendResult> {
    try {
      if (
        output.outputType !== 'text' &&
        output.outputType !== 'error' &&
        output.outputType !== 'file' &&
        output.outputType !== 'audio'
      ) {
        return { success: false, errorMessage: 'TelegramOutputAdapter supports text, error, file and audio outputs.' };
      }

      const { chatId, replyToMessageId } = resolveChatRef(output);
      let lastMessageId: string | number | undefined;

        if (output.outputType === 'file') {
        if (!output.filePath) {
          return { success: false, errorMessage: 'Missing filePath for file output.' };
        }

        const info = await stat(output.filePath);
        if (!info.isFile()) {
          return { success: false, errorMessage: 'Provided filePath is not a file.' };
        }
        if (info.size > TELEGRAM_MAX_DOCUMENT_BYTES) {
          return { success: false, errorMessage: 'File exceeds Telegram document size limit.' };
        }

        const filePath = output.filePath;
        const sent = await this.withRetry(() => this.api.sendDocument(chatId, filePath, {
          reply_to_message_id: replyToMessageId,
          filename: inferSafeFilename(filePath),
        }));
        lastMessageId = sent.message_id;
        await this.cleanupTemporaryPath(output.filePath);
      } else if (output.outputType === 'audio' || requiresAudioReply(output)) {
        if (output.audioPath) {
          const info = await stat(output.audioPath);
          if (!info.isFile()) {
            return { success: false, errorMessage: 'Provided audioPath is not a file.' };
          }

          const sent = await this.withRetry(() => this.api.sendAudio(chatId, output.audioPath!, {
            reply_to_message_id: replyToMessageId,
          }));
          lastMessageId = sent.message_id;
          await this.cleanupTemporaryPath(output.audioPath);
        } else {
          const fallbackText = output.text ?? '';
          const chunks = chunkTelegramText(fallbackText, TELEGRAM_MAX_TEXT);
          for (const chunk of chunks) {
            const sent = await this.withRetry(() => this.api.sendMessage(chatId, chunk, {
              reply_to_message_id: replyToMessageId,
            }));
            lastMessageId = sent.message_id;
          }
        }
      } else {
        const text = output.text ?? '';
        const chunks = chunkTelegramText(text, TELEGRAM_MAX_TEXT);

        for (const chunk of chunks) {
          const sent = await this.withRetry(() => this.api.sendMessage(chatId, chunk, {
            reply_to_message_id: replyToMessageId,
          }));
          lastMessageId = sent.message_id;
        }
      }

      return { success: true, sentMessageId: lastMessageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send Telegram output.';
      return { success: false, errorMessage: message };
    }
  }
}
