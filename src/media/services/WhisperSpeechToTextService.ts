import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  SpeechToTextInput,
  SpeechToTextPort,
  SpeechToTextResult,
  SpeechToTextError,
} from '../contracts/SpeechToTextPort.js';
import { sanitizeMessageForSafeOutput } from '../../lib/errors.js';

export interface WhisperSpeechToTextServiceConfig {
  command?: string;
  maxAudioBytes: number;
  maxAudioDurationSeconds: number;
  resourceAvailable?: boolean;
}

function throwSttError(code: SpeechToTextError['code'], message: string, retriable: boolean): never {
  throw {
    code,
    message: sanitizeMessageForSafeOutput(message),
    retriable,
  } as SpeechToTextError;
}

function isCommandAvailable(command: string): boolean {
  const hasPathHint = command.includes('/') || command.includes('\\') || path.isAbsolute(command);
  if (hasPathHint && existsSync(command)) {
    return true;
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

function splitCommand(commandLine: string): { executable: string; baseArgs: string[] } {
  const trimmed = commandLine.trim();
  if (!trimmed) return { executable: '', baseArgs: [] };

  const quoted = trimmed.match(/^"([^"]+)"(?:\s+(.*))?$/);
  if (quoted?.[1]) {
    const remainder = quoted[2] ?? '';
    const baseArgs = remainder
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return { executable: quoted[1], baseArgs };
  }

  const parts = trimmed.split(/\s+/).map((x) => x.trim()).filter((x) => x.length > 0);
  return { executable: parts[0] ?? '', baseArgs: parts.slice(1) };
}

export class WhisperSpeechToTextService implements SpeechToTextPort {
  private readonly command: string;
  private readonly maxAudioBytes: number;
  private readonly maxAudioDurationSeconds: number;
  private readonly resourceAvailable: boolean;

  constructor(config: WhisperSpeechToTextServiceConfig) {
    this.command = config.command ?? 'whisper';
    this.maxAudioBytes = config.maxAudioBytes;
    this.maxAudioDurationSeconds = config.maxAudioDurationSeconds;
    this.resourceAvailable = config.resourceAvailable ?? true;
  }

  async transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult> {
    if (!this.resourceAvailable) {
      throwSttError('STT_EXECUTION_FAILED', 'Speech-to-text resource unavailable.', false);
    }

    if (!input.filePath || input.filePath.trim().length === 0) {
      throwSttError('STT_VALIDATION_ERROR', 'Audio file path is required.', false);
    }

    if (input.mimeType && !input.mimeType.toLowerCase().startsWith('audio/')) {
      throwSttError('STT_UNSUPPORTED_MEDIA', 'Unsupported media for transcription.', false);
    }

    if (
      typeof input.originalDurationSeconds === 'number' &&
      input.originalDurationSeconds > this.maxAudioDurationSeconds
    ) {
      throwSttError('STT_VALIDATION_ERROR', 'Audio duration exceeded configured limit.', false);
    }

    const fileInfo = await stat(input.filePath).catch(() => null);
    if (!fileInfo || !fileInfo.isFile()) {
      throwSttError('STT_VALIDATION_ERROR', 'Audio file is invalid or inaccessible.', false);
    }
    if (fileInfo.size <= 0 || fileInfo.size > this.maxAudioBytes) {
      throwSttError('STT_VALIDATION_ERROR', 'Audio size exceeded configured limit.', false);
    }

    const { executable, baseArgs } = splitCommand(this.command);
    if (!executable || !isCommandAvailable(executable)) {
      throwSttError('STT_EXECUTION_FAILED', 'Whisper command is not available on host.', false);
    }

    const timeoutMs = input.timeoutMs > 0 ? input.timeoutMs : 120000;

    const text = await new Promise<string>((resolve, reject) => {
      const args = [...baseArgs, input.filePath];
      const child = spawn(executable, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      child.on('error', () => {
        clearTimeout(timer);
        reject({
          code: 'STT_EXECUTION_FAILED',
          message: 'Whisper process could not start.',
          retriable: false,
        } as SpeechToTextError);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject({
            code: 'STT_TIMEOUT',
            message: 'Whisper transcription timed out.',
            retriable: true,
          } as SpeechToTextError);
          return;
        }
        if (code !== 0) {
          reject({
            code: 'STT_EXECUTION_FAILED',
            message: sanitizeMessageForSafeOutput(stderr || 'Whisper transcription failed.'),
            retriable: false,
          } as SpeechToTextError);
          return;
        }
        resolve(stdout.trim());
      });
    });

    if (!text) {
      throwSttError('STT_EXECUTION_FAILED', 'Whisper returned empty transcription.', false);
    }

    return {
      text: sanitizeMessageForSafeOutput(text),
      language: input.languageHint,
      durationSeconds: input.originalDurationSeconds,
      metadata: {
        provider: 'whisper',
        model: 'default',
      },
    };
  }
}
