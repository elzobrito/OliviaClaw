import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BaseTool } from '../BaseTool.js';
import { ToolDefinition, ToolResult } from '../../types/index.js';
import { assertPathWithinAllowedRoots } from '../../lib/pathSafety.js';

export class CriarArquivoTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'criar_arquivo',
    description: 'Cria ou sobrescreve arquivo em roots permitidas.',
    schema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        content: { type: 'string' },
        overwrite: { type: 'boolean' },
        allowedRoots: { type: 'array', items: { type: 'string' } },
      },
      required: ['filePath', 'content', 'allowedRoots'],
      additionalProperties: false,
    },
    isGlobal: true,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.filePath ?? '');
    const content = String(args.content ?? '');
    const overwrite = Boolean(args.overwrite ?? true);
    const allowedRoots = Array.isArray(args.allowedRoots)
      ? args.allowedRoots.map((x) => String(x))
      : [];

    const safePath = assertPathWithinAllowedRoots(filePath, allowedRoots, process.cwd());
    const dir = path.dirname(safePath);
    await mkdir(dir, { recursive: true });

    if (!overwrite) {
      try {
        await writeFile(safePath, content, { flag: 'wx' });
      } catch {
        return { output: 'Arquivo já existe e overwrite=false.', filePath: safePath };
      }
    } else {
      await writeFile(safePath, content, { flag: 'w' });
    }

    return {
      output: 'Arquivo criado com sucesso.',
      filePath: safePath,
      mimeType: 'text/plain',
      metadata: { bytesWritten: Buffer.byteLength(content, 'utf-8') },
    };
  }
}
