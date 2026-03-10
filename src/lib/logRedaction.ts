const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /token|api[-_]?key|secret|password|authorization|cookie|set-cookie|session/i;

const TOKEN_VALUE_PATTERN =
  /(Bearer\s+)?[A-Za-z0-9_\-]{16,}(\.[A-Za-z0-9_\-]{10,}){0,2}/g;

function maskIdentifier(value: string): string {
  if (value.length <= 6) return REDACTED;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function sanitizePrimitive(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;

  if (key.toLowerCase() === 'actorid' || key.toLowerCase() === 'userid') {
    return maskIdentifier(value);
  }

  return value.replace(TOKEN_VALUE_PATTERN, REDACTED);
}

function redactValue(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (input == null) return input;

  if (Array.isArray(input)) {
    return input.map((item) => redactValue(item, depth + 1));
  }

  if (input instanceof Error) {
    return redactLogError(input);
  }

  if (typeof input === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = REDACTED;
        continue;
      }

      if (typeof rawValue === 'string') {
        output[key] = sanitizePrimitive(key, rawValue);
        continue;
      }

      output[key] = redactValue(rawValue, depth + 1);
    }
    return output;
  }

  return input;
}

export function normalizeLogContext(input: Record<string, unknown>): Record<string, unknown> {
  const requestId =
    (input.requestId as string | undefined) ??
    (input.reqId as string | undefined) ??
    (input.correlationId as string | undefined);

  const actorId = (input.actorId as string | undefined) ?? (input.userId as string | undefined);
  const provider =
    (input.provider as string | undefined) ?? (input.providerName as string | undefined);

  const normalized: Record<string, unknown> = {};
  if (requestId) normalized.requestId = requestId;
  if (actorId) normalized.actorId = maskIdentifier(actorId);
  if (provider) normalized.provider = provider;
  return normalized;
}

export function redactLogMessage(message: string): string {
  return message.replace(TOKEN_VALUE_PATTERN, REDACTED);
}

export function redactLogError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { error: REDACTED };
  }

  return {
    name: error.name,
    message: redactLogMessage(error.message),
    code: (error as Error & { code?: string }).code,
  };
}

export function redactLogObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const redacted = redactValue(input) as Record<string, unknown>;
  return {
    ...redacted,
    ...normalizeLogContext(redacted),
  };
}
