export type ProviderName = 'gemini' | 'deepseek' | 'groq' | 'openai';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type CapabilityFlag =
  | 'stt'
  | 'tts'
  | 'code_analyzer'
  | 'github_push'
  | 'documents'
  | 'audio_input';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  provider?: ProviderName;
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  isGlobal: boolean;
}

export interface ToolResult {
  output: string;
  filePath?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolSafeError {
  code:
    | 'TOOL_VALIDATION_ERROR'
    | 'TOOL_EXECUTION_ERROR'
    | 'TOOL_TIMEOUT'
    | 'TOOL_FORBIDDEN_PATH';
  message: string;
  retriable: boolean;
}

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  tools: string[];
}

export interface QueueItem {
  id: string;
  actorId: string;
  text: string;
  createdAt: string;
  channel: string;
  correlationId?: string;
}

export interface SanitizedError {
  code: string;
  message: string;
  severity: Severity;
}
