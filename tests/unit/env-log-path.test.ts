import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { redactLogObject, redactLogMessage } from '../../src/lib/logRedaction';
import { assertPathWithinAllowedRoots } from '../../src/lib/pathSafety';
import { sanitizeMessageForSafeOutput } from '../../src/lib/errors';

describe('env parser', () => {
  it('loads valid environment with defaults', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_ALLOWED_USER_IDS: '1,2',
      DEFAULT_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key-gemini',
      PROVIDER_TIMEOUT_MS: '45000',
      MAX_ITERATIONS: '8',
      MEMORY_WINDOW_SIZE: '20',
      MAX_QUEUE_SIZE: '100',
      DB_PATH: './data/oliviaclaw.db',
      SKILLS_DIR: './.agents/skills',
      TMP_DIR: './tmp',
      LOG_LEVEL: 'info',
      ALLOWED_TOOL_ROOTS: './src,./docs,./reports',
      ENABLE_GITHUB_PUSH: 'false',
      ENABLE_CODE_ANALYZER: 'true',
      WHISPER_COMMAND: 'whisper',
      EDGE_TTS_COMMAND: 'edge-tts',
      INPUT_DOWNLOAD_TIMEOUT_MS: '30000',
      WHISPER_TIMEOUT_MS: '120000',
      MAX_AUDIO_MB: '20',
      MAX_AUDIO_DURATION_SECONDS: '600',
      MAX_TTS_CHARS: '3000',
    } as unknown as NodeJS.ProcessEnv;

    const config = loadEnv(env);
    expect(config.providers.defaultProvider).toBe('gemini');
    expect(config.telegram.allowedUserIds).toEqual(['1', '2']);
  });

  it('throws on missing required secrets', () => {
    const env = {
      TELEGRAM_ALLOWED_USER_IDS: '1',
      DEFAULT_PROVIDER: 'gemini',
      ALLOWED_TOOL_ROOTS: './src',
    } as unknown as NodeJS.ProcessEnv;

    expect(() => loadEnv(env)).toThrow();
  });
});

describe('log redaction and safe errors', () => {
  it('redacts tokens and masks actor id', () => {
    const redacted = redactLogObject({
      actorId: 'telegram:123456789',
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      nested: { apiKey: 'super-secret-key' },
    });

    expect(String(redacted.actorId)).toContain('***');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(String((redacted.nested as Record<string, unknown>).apiKey)).toBe('[REDACTED]');
  });

  it('removes token-like values from messages', () => {
    const msg = redactLogMessage('Authorization Bearer abcdefghijklmnopqrstuv');
    expect(msg).toContain('[REDACTED]');
  });

  it('sanitizes absolute paths from safe output', () => {
    const sanitized = sanitizeMessageForSafeOutput('failure at C:\\secret\\file.txt');
    expect(sanitized).toContain('[PATH_REDACTED]');
  });
});

describe('path safety', () => {
  it('allows paths inside allowed roots', () => {
    const result = assertPathWithinAllowedRoots('src/lib/logger.ts', ['./src'], process.cwd());
    expect(result.toLowerCase()).toContain('src');
  });

  it('blocks traversal outside allowed roots', () => {
    expect(() =>
      assertPathWithinAllowedRoots('../outside.txt', ['./src'], process.cwd()),
    ).toThrow();
  });
});
