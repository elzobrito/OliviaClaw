import { readFile, stat } from 'node:fs/promises';
import {
  SUPPORTED_AUDIO_MIME_TYPES,
  SUPPORTED_FILE_MIME_TYPES,
  type SupportedAudioMime,
  type SupportedFileMime,
} from '../contracts/MediaIngressPolicy.js';
import type { SpeechToTextPort } from '../contracts/SpeechToTextPort.js';
import type { NormalizedInput, MediaAttachment } from '../../channels/contracts/NormalizedInput.js';
import { assertPathWithinAllowedRoots } from '../../lib/pathSafety.js';
import { sanitizeMessageForSafeOutput } from '../../lib/errors.js';

export interface MediaPreprocessorConfig {
  maxAudioBytes: number;
  maxAudioDurationSeconds: number;
  sttTimeoutMs: number;
  maxDocumentBytes?: number;
  allowedRoots?: string[];
}

export interface MediaPreprocessorDependencies {
  speechToText?: SpeechToTextPort;
}

interface ProcessOutcome {
  textFragments: string[];
  warnings: string[];
}

function normalizeMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-\[\]\(\)!]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePlainText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function appendWithLabel(label: string, value: string): string {
  const normalized = normalizePlainText(value);
  return normalized ? `[${label}]\n${normalized}` : '';
}

function isSupportedAudioMime(mimeType: string): mimeType is SupportedAudioMime {
  return SUPPORTED_AUDIO_MIME_TYPES.includes(mimeType as SupportedAudioMime);
}

function isSupportedFileMime(mimeType: string): mimeType is SupportedFileMime {
  return SUPPORTED_FILE_MIME_TYPES.includes(mimeType as SupportedFileMime);
}

export class MediaPreprocessor {
  private readonly speechToText?: SpeechToTextPort;
  private readonly maxAudioBytes: number;
  private readonly maxAudioDurationSeconds: number;
  private readonly sttTimeoutMs: number;
  private readonly maxDocumentBytes: number;
  private readonly allowedRoots?: string[];

  constructor(config: MediaPreprocessorConfig, deps: MediaPreprocessorDependencies = {}) {
    this.speechToText = deps.speechToText;
    this.maxAudioBytes = config.maxAudioBytes;
    this.maxAudioDurationSeconds = config.maxAudioDurationSeconds;
    this.sttTimeoutMs = config.sttTimeoutMs;
    this.maxDocumentBytes = config.maxDocumentBytes ?? 20 * 1024 * 1024;
    this.allowedRoots = config.allowedRoots;
  }

  private resolveSafePath(filePath: string): string {
    if (!this.allowedRoots || this.allowedRoots.length === 0) {
      return filePath;
    }
    return assertPathWithinAllowedRoots(filePath, this.allowedRoots, process.cwd());
  }

  private async extractPdfText(filePath: string): Promise<string> {
    const rawBuffer = await readFile(this.resolveSafePath(filePath));
    const pdfParseModule = await import('pdf-parse');
    const parser = (pdfParseModule as unknown as { default?: (input: Buffer) => Promise<{ text?: string }> }).default
      ?? (pdfParseModule as unknown as (input: Buffer) => Promise<{ text?: string }>);
    const parsed = await parser(rawBuffer);
    return normalizePlainText(parsed?.text ?? '');
  }

  private async extractTextDocument(filePath: string, markdown: boolean): Promise<string> {
    const raw = await readFile(this.resolveSafePath(filePath), 'utf8');
    return markdown ? normalizeMarkdown(raw) : normalizePlainText(raw);
  }

  private async processAudio(attachment: MediaAttachment): Promise<ProcessOutcome> {
    const warnings: string[] = [];
    const textFragments: string[] = [];
    const mimeType = String(attachment.mimeType ?? '').toLowerCase();

    if (!isSupportedAudioMime(mimeType)) {
      warnings.push('audio_unsupported_mime');
      return { warnings, textFragments };
    }

    const filePath = this.resolveSafePath(attachment.filePath);
    const fileInfo = await stat(filePath).catch(() => null);
    const sizeBytes = attachment.sizeBytes ?? fileInfo?.size ?? 0;
    if (!fileInfo || !fileInfo.isFile() || sizeBytes <= 0 || sizeBytes > this.maxAudioBytes) {
      warnings.push('audio_size_invalid');
      return { warnings, textFragments };
    }

    const durationSeconds = attachment.durationSeconds ?? 0;
    if (durationSeconds > this.maxAudioDurationSeconds) {
      warnings.push('audio_duration_too_long');
      return { warnings, textFragments };
    }

    if (!this.speechToText) {
      warnings.push('stt_unavailable');
      return { warnings, textFragments };
    }

    try {
      const stt = await this.speechToText.transcribe({
        filePath,
        mimeType,
        originalDurationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
        timeoutMs: this.sttTimeoutMs,
      });
      const transcript = appendWithLabel('transcript', stt.text);
      if (transcript) textFragments.push(transcript);
    } catch {
      warnings.push('stt_failed');
    }

    return { warnings, textFragments };
  }

  private async processDocument(attachment: MediaAttachment): Promise<ProcessOutcome> {
    const warnings: string[] = [];
    const textFragments: string[] = [];
    const mimeType = String(attachment.mimeType ?? '').toLowerCase();

    if (!isSupportedFileMime(mimeType)) {
      warnings.push('document_unsupported_mime');
      return { warnings, textFragments };
    }

    const filePath = this.resolveSafePath(attachment.filePath);
    const fileInfo = await stat(filePath).catch(() => null);
    const sizeBytes = attachment.sizeBytes ?? fileInfo?.size ?? 0;
    if (!fileInfo || !fileInfo.isFile() || sizeBytes <= 0 || sizeBytes > this.maxDocumentBytes) {
      warnings.push('document_size_invalid');
      return { warnings, textFragments };
    }

    try {
      if (mimeType === 'application/pdf') {
        const extracted = await this.extractPdfText(filePath);
        const block = appendWithLabel('document', extracted);
        if (block) textFragments.push(block);
        return { warnings, textFragments };
      }
      if (mimeType === 'text/markdown') {
        const extracted = await this.extractTextDocument(filePath, true);
        const block = appendWithLabel('document', extracted);
        if (block) textFragments.push(block);
        return { warnings, textFragments };
      }
      if (mimeType === 'text/plain') {
        const extracted = await this.extractTextDocument(filePath, false);
        const block = appendWithLabel('document', extracted);
        if (block) textFragments.push(block);
        return { warnings, textFragments };
      }

      warnings.push('document_extract_not_supported');
      return { warnings, textFragments };
    } catch {
      warnings.push('document_extract_failed');
      return { warnings, textFragments };
    }
  }

  async preprocess(input: NormalizedInput): Promise<NormalizedInput> {
    const attachments = input.attachments ?? [];
    if (attachments.length === 0) return input;

    const warnings: string[] = [];
    const extractedText: string[] = [];

    for (const attachment of attachments) {
      const mimeType = String(attachment.mimeType ?? '').toLowerCase();
      const outcome = mimeType.startsWith('audio/')
        ? await this.processAudio(attachment)
        : await this.processDocument(attachment);
      warnings.push(...outcome.warnings);
      extractedText.push(...outcome.textFragments);
    }

    const baseText = typeof input.text === 'string' ? input.text.trim() : '';
    const mergedText = [baseText, ...extractedText]
      .filter((item) => item.length > 0)
      .join('\n\n')
      .trim();

    const metadata = {
      ...(input.metadata ?? {}),
      mediaPreprocessor: {
        warnings,
        extractedFragments: extractedText.length,
      },
    };

    return {
      ...input,
      text: mergedText.length > 0 ? sanitizeMessageForSafeOutput(mergedText) : input.text,
      metadata,
    };
  }
}
