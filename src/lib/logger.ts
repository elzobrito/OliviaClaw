import pino, { LoggerOptions } from 'pino';
import { redactLogError, redactLogMessage, redactLogObject } from './logRedaction.js';

const allowedLevels = ['debug', 'info', 'warn', 'error'] as const;
type AllowedLogLevel = (typeof allowedLevels)[number];

function resolveLogLevel(input: string | undefined): AllowedLogLevel {
  const normalized = (input ?? 'info').toLowerCase();
  if ((allowedLevels as readonly string[]).includes(normalized)) {
    return normalized as AllowedLogLevel;
  }
  return 'info';
}

const options: LoggerOptions = {
  name: 'oliviaclaw',
  level: resolveLogLevel(process.env.LOG_LEVEL),
  redact: {
    paths: [
      'token',
      'apiKey',
      'secret',
      'password',
      'authorization',
      'headers.authorization',
      'headers.cookie',
      'headers.set-cookie',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    log(object) {
      return redactLogObject(object);
    },
  },
  hooks: {
    logMethod(args, method) {
      const safeArgs = args.map((arg) => {
        if (arg instanceof Error) return redactLogError(arg);
        if (typeof arg === 'string') return redactLogMessage(arg);
        if (arg && typeof arg === 'object') return redactLogObject(arg);
        return arg;
      });
      Reflect.apply(method as (...values: unknown[]) => void, this, safeArgs);
    },
  },
};

// Singleton de logger para reuso transversal em toda a aplicação.
export const logger = pino(options);
