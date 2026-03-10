import { readFile, stat } from 'node:fs/promises';
import { BaseTool } from '../BaseTool.js';
import { ToolDefinition, ToolResult } from '../../types/index.js';
import { assertPathWithinAllowedRoots } from '../../lib/pathSafety.js';

const DEFAULT_MAX_BYTES = 1024 * 1024;

export class LerArquivoTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'ler_arquivo',
    description: 'Lê arquivo de roots permitidas com limite de tamanho.',
    schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        maxBytes: { type: 'number' },
        allowedRoots: { type: 'array', items: { type: 'string' } },
      },
      required: ['filePath', 'allowedRoots'],
      additionalProperties: false,
    },
    isGlobal: true,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.filePath ?? '');
    const maxBytes = Number.isFinite(Number(args.maxBytes)) ? Number(args.maxBytes) : DEFAULT_MAX_BYTES;
    const allowedRoots = Array.isArray(args.allowedRoots)
      ? args.allowedRoots.map((x) => String(x))
      : [];

    const safePath = assertPathWithinAllowedRoots(filePath, allowedRoots, process.cwd());
    const info = await stat(safePath);
    if (!info.isFile()) {
      return { output: 'Caminho informado não é um arquivo.', filePath: safePath };
    }
    if (info.size > maxBytes) {
      return { output: 'Arquivo excede o limite permitido para leitura.', filePath: safePath };
    }

    const content = await readFile(safePath, 'utf-8');
    return {
      output: content,
      filePath: safePath,
      mimeType: 'text/plain',
      metadata: { bytesRead: info.size },
    };
  }
}
