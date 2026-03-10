import type { ToolCallValidationError } from './ToolCallValidator.js';

export interface SelfCorrectionObservationInput {
  toolName?: string;
  error: ToolCallValidationError;
}

const REASON_MAP: Record<ToolCallValidationError['code'], string> = {
  TOOL_CALL_INVALID_SHAPE: 'invalid_tool_call_shape',
  TOOL_NOT_REGISTERED: 'unknown_tool',
  TOOL_ARGS_NOT_OBJECT: 'invalid_arguments_payload',
  TOOL_ARGS_REQUIRED_MISSING: 'required_argument_missing',
  TOOL_ARGS_SCHEMA_MISMATCH: 'arguments_schema_mismatch',
};

function sanitizeToken(value: string | undefined): string {
  if (!value) return 'unknown';
  return value.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80) || 'unknown';
}

export function buildSelfCorrectionObservation(input: SelfCorrectionObservationInput): string {
  const reason = REASON_MAP[input.error.code] ?? 'tool_call_error';
  const tool = sanitizeToken(input.toolName);
  const field = sanitizeToken(input.error.fieldPath);

  return [
    'ToolCallRejected:',
    `reason=${reason};`,
    `tool=${tool};`,
    `field=${field};`,
    'retry_with_registered_tool_and_valid_arguments=true.',
  ].join(' ');
}
