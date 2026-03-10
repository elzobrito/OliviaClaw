import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  TextToSpeechInput,
  TextToSpeechPort,
  TextToSpeechResult,
  TextToSpeechError,
} from '../contracts/TextToSpeechPort.js';

export interface EdgeTtsServiceConfig {
  command?: string;
  timeoutMs: number;
  maxTtsChars: number;
  tmpDir?: string;
  voiceId?: string;
  resourceAvailable?: boolean;
}

function isCommandAvailable(command: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'pipe', encoding: 'utf-8' });
  return result.status === 0;
}

function createTtsError(code: TextToSpeechError['code'], message: string, retriable: boolean): never {
  throw { code, message, retriable } as TextToSpeechError;
}

export class EdgeTtsService implements TextToSpeechPort {
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly maxTtsChars: number;
  private readonly baseTmpDir: string;
  private readonly defaultVoiceId: string;
  private readonly resourceAvailable: boolean;

  constructor(config: EdgeTtsServiceConfig) {
    this.command = config.command ?? 'edge-tts';
    this.timeoutMs = config.timeoutMs;
    this.maxTtsChars = config.maxTtsChars;
    this.baseTmpDir = config.tmpDir ?? path.join(tmpdir(), 'oliviaclaw-tts');
    this.defaultVoiceId = config.voiceId ?? 'en-US-AriaNeural';
    this.resourceAvailable = config.resourceAvailable ?? true;
  }

  async synthesize(input: TextToSpeechInput): Promise<TextToSpeechResult> {
    if (!this.resourceAvailable) {
      createTtsError('TTS_EXECUTION_FAILED', 'TTS resource unavailable.', false);
    }

    if (input.text.length > this.maxTtsChars || input.text.length > input.maxChars) {
      createTtsError('TTS_INPUT_TOO_LONG', 'Text exceeded maximum character limit.', false);
    }

    const executable = this.command.trim().split(/\s+/)[0] ?? this.command;
    if (!isCommandAvailable(executable)) {
      createTtsError('TTS_EXECUTION_FAILED', 'edge-tts command not available on host.', false);
    }

    await mkdir(this.baseTmpDir, { recursive: true });
    const runDir = await mkdtemp(path.join(this.baseTmpDir, 'run-'));

    const format = input.targetFormat ?? 'mp3';
    const outputPath = path.join(runDir, `${randomUUID()}.${format}`);
    const voiceId = input.voiceId ?? this.defaultVoiceId;

    const args = [
      '--voice',
      voiceId,
      '--text',
      input.text,
      '--write-media',
      outputPath,
    ];

    const timeoutMs = input.timeoutMs > 0 ? input.timeoutMs : this.timeoutMs;

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.command, args, { shell: true, stdio: 'ignore' });

      const timer = setTimeout(() => {
        child.kill();
        reject({
          code: 'TTS_TIMEOUT',
          message: 'TTS command timed out.',
          retriable: true,
        } as TextToSpeechError);
      }, timeoutMs);

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject({
          code: 'TTS_EXECUTION_FAILED',
          message: 'TTS command failed to execute.',
          retriable: false,
        } as TextToSpeechError);
      });

      child.on('error', () => {
        clearTimeout(timer);
        reject({
          code: 'TTS_EXECUTION_FAILED',
          message: 'TTS process could not start.',
          retriable: false,
        } as TextToSpeechError);
      });
    });

    const mimeType = format === 'wav' ? 'audio/wav' : format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';

    return {
      filePath: outputPath,
      mimeType,
      metadata: {
        provider: 'edge-tts',
        voiceId,
      },
    };
  }
}
