export type ProviderName = 'gemini' | 'deepseek' | 'groq' | 'openai';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface EnvConfig {
  telegram: {
    botToken: string;
    allowedUserIds: string[];
    privateOnly: boolean;
  };
  providers: {
    defaultProvider: ProviderName;
    apiKeys: Partial<Record<ProviderName, string>>;
    timeoutMs: number;
  };
  runtime: {
    maxIterations: number;
    memoryWindowSize: number;
    maxQueueSize: number;
    logLevel: LogLevel;
  };
  paths: {
    dbPath: string;
    skillsDir: string;
    tmpDir: string;
    allowedToolRoots: string[];
  };
  features: {
    githubPushEnabled: boolean;
    codeAnalyzerEnabled: boolean;
  };
  media: {
    whisperCommand: string | null;
    edgeTtsCommand: string | null;
    inputDownloadTimeoutMs: number;
    whisperTimeoutMs: number;
    maxAudioMb: number;
    maxAudioDurationSeconds: number;
    maxTtsChars: number;
  };
  degradedCapabilities: string[];
}

export interface SanitizedEnvError {
  code: 'ENV_VALIDATION_ERROR';
  message: string;
  invalidFields: string[];
}

class EnvValidationError extends Error {
  public readonly invalidFields: string[];

  constructor(message: string, invalidFields: string[]) {
    super(message);
    this.name = 'EnvValidationError';
    this.invalidFields = invalidFields;
  }

  toSanitized(): SanitizedEnvError {
    return {
      code: 'ENV_VALIDATION_ERROR',
      message: this.message,
      invalidFields: this.invalidFields,
    };
  }
}

function getString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getRequiredString(env: NodeJS.ProcessEnv, key: string, errors: string[]): string {
  const value = getString(env, key);
  if (!value) {
    errors.push(key);
    return '';
  }
  return value;
}

function getInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
  errors: string[],
): number {
  const raw = getString(env, key);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    errors.push(key);
    return fallback;
  }
  if (opts.min != null && parsed < opts.min) {
    errors.push(key);
    return fallback;
  }
  if (opts.max != null && parsed > opts.max) {
    errors.push(key);
    return fallback;
  }

  return parsed;
}

function getBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean, errors: string[]): boolean {
  const raw = getString(env, key);
  if (!raw) return fallback;

  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;

  errors.push(key);
  return fallback;
}

function getCsv(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = getString(env, key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseProviderName(value: string | undefined, errors: string[]): ProviderName {
  const normalized = (value ?? 'gemini').toLowerCase();
  if (normalized === 'gemini' || normalized === 'deepseek' || normalized === 'groq' || normalized === 'openai') {
    return normalized;
  }
  errors.push('DEFAULT_PROVIDER');
  return 'gemini';
}

function parseLogLevel(value: string | undefined, errors: string[]): LogLevel {
  const normalized = (value ?? 'info').toLowerCase();
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  errors.push('LOG_LEVEL');
  return 'info';
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const errors: string[] = [];

  const telegramBotToken = getRequiredString(env, 'TELEGRAM_BOT_TOKEN', errors);
  const telegramAllowedUserIds = getCsv(env, 'TELEGRAM_ALLOWED_USER_IDS');
  const telegramPrivateOnly = getBool(env, 'TELEGRAM_PRIVATE_ONLY', true, errors);

  if (telegramAllowedUserIds.length === 0) {
    errors.push('TELEGRAM_ALLOWED_USER_IDS');
  }

  const defaultProvider = parseProviderName(getString(env, 'DEFAULT_PROVIDER'), errors);
  const providerTimeoutMs = getInt(env, 'PROVIDER_TIMEOUT_MS', 45000, { min: 1000, max: 300000 }, errors);

  const apiKeys: Partial<Record<ProviderName, string>> = {};
  const geminiKey = getString(env, 'GEMINI_API_KEY');
  const deepseekKey = getString(env, 'DEEPSEEK_API_KEY');
  const groqKey = getString(env, 'GROQ_API_KEY');
  const openaiKey = getString(env, 'OPENAI_API_KEY');
  if (geminiKey) apiKeys.gemini = geminiKey;
  if (deepseekKey) apiKeys.deepseek = deepseekKey;
  if (groqKey) apiKeys.groq = groqKey;
  if (openaiKey) apiKeys.openai = openaiKey;

  const maxIterations = getInt(env, 'MAX_ITERATIONS', 8, { min: 1, max: 32 }, errors);
  const memoryWindowSize = getInt(env, 'MEMORY_WINDOW_SIZE', 20, { min: 1, max: 500 }, errors);
  const maxQueueSize = getInt(env, 'MAX_QUEUE_SIZE', 100, { min: 1, max: 5000 }, errors);
  const logLevel = parseLogLevel(getString(env, 'LOG_LEVEL'), errors);

  const dbPath = getString(env, 'DB_PATH') ?? './data/oliviaclaw.db';
  const skillsDir = getString(env, 'SKILLS_DIR') ?? './.agents/skills';
  const tmpDir = getString(env, 'TMP_DIR') ?? './tmp';
  const allowedToolRoots = getCsv(env, 'ALLOWED_TOOL_ROOTS');
  if (allowedToolRoots.length === 0) {
    errors.push('ALLOWED_TOOL_ROOTS');
  }

  const githubPushEnabled = getBool(env, 'ENABLE_GITHUB_PUSH', false, errors);
  const codeAnalyzerEnabled = getBool(env, 'ENABLE_CODE_ANALYZER', true, errors);

  const whisperCommand = getString(env, 'WHISPER_COMMAND') ?? null;
  const edgeTtsCommand = getString(env, 'EDGE_TTS_COMMAND') ?? null;
  const inputDownloadTimeoutMs = getInt(env, 'INPUT_DOWNLOAD_TIMEOUT_MS', 30000, { min: 1000, max: 600000 }, errors);
  const whisperTimeoutMs = getInt(env, 'WHISPER_TIMEOUT_MS', 120000, { min: 1000, max: 900000 }, errors);
  const maxAudioMb = getInt(env, 'MAX_AUDIO_MB', 20, { min: 1, max: 500 }, errors);
  const maxAudioDurationSeconds = getInt(env, 'MAX_AUDIO_DURATION_SECONDS', 600, { min: 1, max: 36000 }, errors);
  const maxTtsChars = getInt(env, 'MAX_TTS_CHARS', 3000, { min: 1, max: 100000 }, errors);

  if (errors.length > 0) {
    const unique = Array.from(new Set(errors));
    throw new EnvValidationError(
      `Invalid or missing environment configuration: ${unique.join(', ')}`,
      unique,
    );
  }

  const degradedCapabilities: string[] = [];

  if (!apiKeys[defaultProvider]) {
    throw new EnvValidationError(
      `DEFAULT_PROVIDER (${defaultProvider}) is not configured with an API key.`,
      ['DEFAULT_PROVIDER'],
    );
  }

  if (Object.keys(apiKeys).length === 0) {
    throw new EnvValidationError('No provider API key configured.', [
      'GEMINI_API_KEY',
      'DEEPSEEK_API_KEY',
      'GROQ_API_KEY',
      'OPENAI_API_KEY',
    ]);
  }

  if (!whisperCommand) {
    degradedCapabilities.push('stt');
  }

  if (!edgeTtsCommand) {
    degradedCapabilities.push('tts');
  }

  if (!codeAnalyzerEnabled) {
    degradedCapabilities.push('code_analyzer');
  }

  if (!githubPushEnabled) {
    degradedCapabilities.push('github_push');
  }

  return {
    telegram: {
      botToken: telegramBotToken,
      allowedUserIds: telegramAllowedUserIds,
      privateOnly: telegramPrivateOnly,
    },
    providers: {
      defaultProvider,
      apiKeys,
      timeoutMs: providerTimeoutMs,
    },
    runtime: {
      maxIterations,
      memoryWindowSize,
      maxQueueSize,
      logLevel,
    },
    paths: {
      dbPath,
      skillsDir,
      tmpDir,
      allowedToolRoots,
    },
    features: {
      githubPushEnabled,
      codeAnalyzerEnabled,
    },
    media: {
      whisperCommand,
      edgeTtsCommand,
      inputDownloadTimeoutMs,
      whisperTimeoutMs,
      maxAudioMb,
      maxAudioDurationSeconds,
      maxTtsChars,
    },
    degradedCapabilities,
  };
}

export function toSanitizedEnvError(error: unknown): SanitizedEnvError {
  if (error instanceof EnvValidationError) {
    return error.toSanitized();
  }

  return {
    code: 'ENV_VALIDATION_ERROR',
    message: 'Invalid environment configuration.',
    invalidFields: [],
  };
}
