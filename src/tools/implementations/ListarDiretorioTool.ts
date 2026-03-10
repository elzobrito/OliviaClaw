import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { BaseTool } from '../BaseTool.js';
import { ToolDefinition, ToolResult } from '../../types/index.js';
import { assertPathWithinAllowedRoots } from '../../lib/pathSafety.js';

export class ListarDiretorioTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'listar_diretorio',
    description: 'Lista diretório com metadados seguros.',
    schema: {
      type: 'object',
      properties: {
        dirPath: { type: 'string' },
        allowedRoots: { type: 'array', items: { type: 'string' } },
      },
      required: ['dirPath', 'allowedRoots'],
      additionalProperties: false,
    },
    isGlobal: true,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = String(args.dirPath ?? '');
    const allowedRoots = Array.isArray(args.allowedRoots)
      ? args.allowedRoots.map((x) => String(x))
      : [];

    const safePath = assertPathWithinAllowedRoots(dirPath, allowedRoots, process.cwd());
    const entries = await readdir(safePath);

    const result: Array<{ name: string; type: 'file' | 'dir' | 'other'; size?: number }> = [];
    for (const name of entries) {
      const full = path.join(safePath, name);
      const info = await stat(full);
      if (info.isFile()) {
        result.push({ name, type: 'file', size: info.size });
      } else if (info.isDirectory()) {
        result.push({ name, type: 'dir' });
      } else {
        result.push({ name, type: 'other' });
      }
    }

    return {
      output: JSON.stringify(result),
      filePath: safePath,
      metadata: { count: result.length },
    };
  }
}
