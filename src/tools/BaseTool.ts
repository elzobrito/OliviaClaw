import type { ToolDefinition, ToolResult, ToolSafeError } from '../types/index.js';

export interface BaseTool {
  readonly definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export type ToolExecutionResult =
  | { ok: true; result: ToolResult }
  | { ok: false; error: ToolSafeError };
