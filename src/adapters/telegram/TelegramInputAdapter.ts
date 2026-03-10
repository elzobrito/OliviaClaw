import type { InputAdapter } from '../../channels/contracts/InputAdapter.js';
import type { ChannelCapabilities } from '../../channels/contracts/ChannelCapabilities.js';
import type { NormalizedInput, MediaAttachment, InputType } from '../../channels/contracts/NormalizedInput.js';
import { SUPPORTED_AUDIO_MIME_TYPES, type SupportedMime } from '../../media/contracts/MediaIngressPolicy.js';
import { logger } from '../../lib/logger.js';

interface TelegramUser {
  id: number | string;
}

interface TelegramChat {
  id: number | string;
  type?: 'private' | 'group' | 'supergroup' | 'channel' | string;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  mime_type?: string;
  duration?: number;
  file_size?: number;
}

export interface TelegramMessageLike {
  message_id: number | string;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  audio?: TelegramAudio;
  voice?: TelegramAudio;
}

export interface TelegramDownloadResult {
  filePath: string;
  mimeType: SupportedMime | string;
  sizeBytes?: number;
  durationSeconds?: number;
  originalName?: string;
}

export interface TelegramRuntime {
  onMessage(handler: (message: TelegramMessageLike) => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendTyping?(chatId: number | string): Promise<void>;
  sendTransientFeedback?(chatId: number | string, action: 'typing' | 'record_voice'): Promise<void>;
}

export interface TelegramInputAdapterConfig {
  allowedUserIds: string[];
  privateOnly?: boolean;
  downloadTimeoutMs: number;
  maxAudioBytes?: number;
  maxAudioDurationSeconds?: number;
  runtime: TelegramRuntime;
  downloadFile: (fileId: string, timeoutMs: number) => Promise<TelegramDownloadResult>;
}

function inferInputType(message: TelegramMessageLike): InputType {
  const text = (message.text ?? message.caption ?? '').trim();
  if (text.startsWith('/')) return 'command';
  if (message.audio || message.voice) return 'audio';
  if (message.document) return 'file';
  return 'text';
}

function buildAttachment(message: TelegramMessageLike, downloaded: TelegramDownloadResult): MediaAttachment {
  const doc = message.document;
  const audio = message.audio ?? message.voice;
  return {
    filePath: downloaded.filePath,
    mimeType: downloaded.mimeType,
    sizeBytes: downloaded.sizeBytes ?? doc?.file_size ?? audio?.file_size,
    durationSeconds: downloaded.durationSeconds ?? audio?.duration,
    originalName: downloaded.originalName ?? doc?.file_name,
  };
}

function isAudioMessage(message: TelegramMessageLike): boolean {
  return Boolean(message.audio || message.voice);
}

export class TelegramInputAdapter implements InputAdapter {
  readonly channelId = 'telegram';
  readonly capabilities: ChannelCapabilities = {
    supportsText: true,
    supportsFile: true,
    supportsAudio: true,
    supportsTransientFeedback: true,
    maxTextLength: 4096,
    maxFileSizeBytes: 50 * 1024 * 1024,
  };

  private readonly allowedUserIds: Set<string>;
  private readonly downloadTimeoutMs: number;
  private readonly privateOnly: boolean;
  private readonly maxAudioBytes: number;
  private readonly maxAudioDurationSeconds: number;
  private readonly runtime: TelegramRuntime;
  private readonly downloadFile: (fileId: string, timeoutMs: number) => Promise<TelegramDownloadResult>;
  private started = false;

  constructor(config: TelegramInputAdapterConfig) {
    this.allowedUserIds = new Set(config.allowedUserIds.map((x) => String(x)));
    this.downloadTimeoutMs = config.downloadTimeoutMs;
    this.privateOnly = config.privateOnly ?? true;
    this.maxAudioBytes = config.maxAudioBytes ?? 20 * 1024 * 1024;
    this.maxAudioDurationSeconds = config.maxAudioDurationSeconds ?? 600;
    this.runtime = config.runtime;
    this.downloadFile = config.downloadFile;
  }

  async start(onMessage: (input: NormalizedInput) => Promise<void>): Promise<void> {
    if (this.started) return;
    this.runtime.onMessage(async (message) => {
      const fromId = message.from?.id != null ? String(message.from.id) : '';
      if (!fromId || !this.allowedUserIds.has(fromId)) {
        logger.warn(
          { channel: 'telegram', userId: fromId || 'unknown' },
          'Telegram message ignored because sender is not allowed',
        );
        return;
      }
      if (this.privateOnly) {
        const isPrivateByType = message.chat.type === 'private';
        const isPrivateById = String(message.chat.id) === fromId;
        if (!isPrivateByType && !isPrivateById) {
          logger.warn(
            { channel: 'telegram', userId: fromId, chatId: String(message.chat.id) },
            'Telegram message ignored because private-only mode is enabled',
          );
          return;
        }
      }

      const inputType = inferInputType(message);
      const rawText = message.text ?? message.caption ?? undefined;
      const requiresAudioReply = Boolean(message.audio || message.voice);

      const normalized: NormalizedInput = {
        actorId: `telegram:${String(message.from!.id)}`,
        channel: 'telegram',
        channelRef: {
          channel: 'telegram',
          ref: {
            chatId: message.chat.id,
            messageId: message.message_id,
          },
        },
        inputType,
        text: rawText,
        requiresAudioReply,
        receivedAt:
          typeof message.date === 'number'
            ? new Date(message.date * 1000).toISOString()
            : new Date().toISOString(),
      };

      const media = message.document ?? message.audio ?? message.voice;
      if (media?.file_id) {
        const downloaded = await this.downloadFile(media.file_id, this.downloadTimeoutMs);
        if (isAudioMessage(message)) {
          const mime = String(downloaded.mimeType ?? '').toLowerCase();
          const sizeBytes = Number(downloaded.sizeBytes ?? message.audio?.file_size ?? message.voice?.file_size ?? 0);
          const durationSeconds = Number(
            downloaded.durationSeconds ?? message.audio?.duration ?? message.voice?.duration ?? 0,
          );
          const mimeAllowed = SUPPORTED_AUDIO_MIME_TYPES.includes(mime as (typeof SUPPORTED_AUDIO_MIME_TYPES)[number]);
          if (!mimeAllowed || sizeBytes <= 0 || sizeBytes > this.maxAudioBytes || durationSeconds > this.maxAudioDurationSeconds) {
            return;
          }
        }
        normalized.attachments = [buildAttachment(message, downloaded)];
      }

      if (this.capabilities.supportsTransientFeedback) {
        if (this.runtime.sendTransientFeedback) {
          const action = inputType === 'audio' ? 'record_voice' : 'typing';
          await this.runtime.sendTransientFeedback(message.chat.id, action).catch(() => undefined);
        } else if (this.runtime.sendTyping) {
          await this.runtime.sendTyping(message.chat.id).catch(() => undefined);
        }
      }

      await onMessage(normalized);
    });

    await this.runtime.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.runtime.stop();
    this.started = false;
  }
}
