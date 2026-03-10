import { readFile, stat } from 'node:fs/promises';
import { BaseTool } from '../BaseTool.js';
import { ToolDefinition, ToolResult } from '../../types/index.js';
import { assertPathWithinAllowedRoots } from '../../lib/pathSafety.js';

export class AnalisarCodigoTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'analisar_codigo',
    description: 'Realiza análise estática textual de arquivo sem executar código.',
    schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        allowedRoots: { type: 'array', items: { type: 'string' } },
      },
      required: ['filePath', 'allowedRoots'],
      additionalProperties: false,
    },
    isGlobal: false,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.filePath ?? '');
    const allowedRoots = Array.isArray(args.allowedRoots)
      ? args.allowedRoots.map((x) => String(x))
      : [];

    const safePath = assertPathWithinAllowedRoots(filePath, allowedRoots, process.cwd());
    const info = await stat(safePath);
    if (!info.isFile()) {
      return { output: 'Caminho informado não é arquivo analisável.', filePath: safePath };
    }

    const text = await readFile(safePath, 'utf-8');
    const lines = text.split(/\r?\n/);
    const todos = lines.filter((line) => /\bTODO\b/i.test(line)).length;
    const imports = lines.filter((line) => /^\s*import\s+/i.test(line)).length;
    const functions = lines.filter((line) => /\bfunction\b|=>/.test(line)).length;

    const report = {
      filePath: safePath,
      bytes: info.size,
      lines: lines.length,
      imports,
      functions,
      todos,
      note: 'Análise puramente textual; nenhum código foi executado.',
    };

    return {
      output: JSON.stringify(report),
      filePath: safePath,
      mimeType: 'application/json',
      metadata: report,
    };
  }
}
