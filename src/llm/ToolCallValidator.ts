import type { LlmToolCall, LlmToolDefinition, LlmToolParameter } from './ILlmProvider.js';

export type ToolCallValidationCode =
  | 'TOOL_CALL_INVALID_SHAPE'
  | 'TOOL_NOT_REGISTERED'
  | 'TOOL_ARGS_NOT_OBJECT'
  | 'TOOL_ARGS_REQUIRED_MISSING'
  | 'TOOL_ARGS_SCHEMA_MISMATCH';

export interface ToolCallValidationError {
  code: ToolCallValidationCode;
  message: string;
  fieldPath?: string;
}

export type ToolCallValidationResult =
  | { ok: true; call: LlmToolCall }
  | { ok: false; error: ToolCallValidationError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeArgs(args: unknown): Record<string, unknown> | null {
  if (isPlainObject(args)) return args;
  if (typeof args !== 'string') return null;

  try {
    const parsed = JSON.parse(args);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTypeMatch(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
}

function validateValueAgainstParameter(
  value: unknown,
  parameter: LlmToolParameter,
  fieldPath: string,
): ToolCallValidationError | null {
  if (!isTypeMatch(value, parameter.type)) {
    return {
      code: 'TOOL_ARGS_SCHEMA_MISMATCH',
      message: `Argument type mismatch at ${fieldPath}.`,
      fieldPath,
    };
  }

  if (parameter.enum && !parameter.enum.includes(String(value))) {
    return {
      code: 'TOOL_ARGS_SCHEMA_MISMATCH',
      message: `Argument value is outside enum at ${fieldPath}.`,
      fieldPath,
    };
  }

  if (parameter.type === 'array' && parameter.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nestedError = validateValueAgainstParameter(
        value[i],
        parameter.items,
        `${fieldPath}[${i}]`,
      );
      if (nestedError) return nestedError;
    }
  }

  if (parameter.type === 'object' && parameter.properties && isPlainObject(value)) {
    const required = parameter.required ?? [];
    for (const requiredKey of required) {
      if (!(requiredKey in value)) {
        return {
          code: 'TOOL_ARGS_REQUIRED_MISSING',
          message: `Required nested argument missing: ${fieldPath}.${requiredKey}.`,
          fieldPath: `${fieldPath}.${requiredKey}`,
        };
      }
    }

    for (const [key, nestedParam] of Object.entries(parameter.properties)) {
      if (!(key in value)) continue;
      const nestedError = validateValueAgainstParameter(
        value[key],
        nestedParam,
        `${fieldPath}.${key}`,
      );
      if (nestedError) return nestedError;
    }
  }

  return null;
}

export function validateToolCall(
  call: unknown,
  toolDefinitions: LlmToolDefinition[],
): ToolCallValidationResult {
  if (!isPlainObject(call)) {
    return {
      ok: false,
      error: { code: 'TOOL_CALL_INVALID_SHAPE', message: 'Tool call payload is not an object.' },
    };
  }

  const id = String(call.id ?? '').trim();
  const name = String(call.name ?? '').trim();
  const args = normalizeArgs(call.arguments);

  if (!id || !name) {
    return {
      ok: false,
      error: { code: 'TOOL_CALL_INVALID_SHAPE', message: 'Tool call id/name is required.' },
    };
  }

  if (!args) {
    return {
      ok: false,
      error: { code: 'TOOL_ARGS_NOT_OBJECT', message: 'Tool call arguments must be an object.' },
    };
  }

  const definition = toolDefinitions.find((item) => item.name === name);
  if (!definition) {
    return {
      ok: false,
      error: { code: 'TOOL_NOT_REGISTERED', message: `Tool "${name}" is not registered.` },
    };
  }

  const requiredFields = definition.parameters.required ?? [];
  for (const requiredField of requiredFields) {
    if (!(requiredField in args)) {
      return {
        ok: false,
        error: {
          code: 'TOOL_ARGS_REQUIRED_MISSING',
          message: `Required argument missing: ${requiredField}.`,
          fieldPath: requiredField,
        },
      };
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const schema = definition.parameters.properties[key];
    if (!schema) {
      return {
        ok: false,
        error: {
          code: 'TOOL_ARGS_SCHEMA_MISMATCH',
          message: `Unexpected argument: ${key}.`,
          fieldPath: key,
        },
      };
    }

    const schemaError = validateValueAgainstParameter(value, schema, key);
    if (schemaError) {
      return { ok: false, error: schemaError };
    }
  }

  return { ok: true, call: { id, name, arguments: args } };
}

export function validateToolCalls(
  calls: unknown,
  toolDefinitions: LlmToolDefinition[],
): { valid: LlmToolCall[]; errors: ToolCallValidationError[] } {
  if (!Array.isArray(calls)) {
    return {
      valid: [],
      errors: [{ code: 'TOOL_CALL_INVALID_SHAPE', message: 'Tool calls payload must be an array.' }],
    };
  }

  const valid: LlmToolCall[] = [];
  const errors: ToolCallValidationError[] = [];

  for (const rawCall of calls) {
    const result = validateToolCall(rawCall, toolDefinitions);
    if (result.ok) {
      valid.push(result.call);
      continue;
    }
    errors.push(result.error);
  }

  return { valid, errors };
}
