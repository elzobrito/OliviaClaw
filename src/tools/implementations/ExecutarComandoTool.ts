import { spawn } from 'node:child_process';
import { BaseTool } from '../BaseTool.js';
import { ToolDefinition, ToolResult } from '../../types/index.js';
import { parseCommand } from '../command/CommandArgumentParser.js';
import { validateCommandPolicy } from '../command/CommandPolicyValidator.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_STDOUT_CHARS = 8_000;
const MAX_STDERR_CHARS = 4_000;

function appendLimited(current: string, nextChunk: unknown, limit: number): string {
  if (current.length >= limit) return current;
  const chunk = String(nextChunk);
  const remaining = limit - current.length;
  return current + chunk.slice(0, remaining);
}

export class ExecutarComandoTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'executar_comando',
    description: 'Executa comando permitido pela DSL com validação estrita.',
    schema: {
      type: 'object',
      properties: {
        commandLine: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['commandLine', 'cwd'],
      additionalProperties: false,
    },
    isGlobal: true,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const commandLine = String(args.commandLine ?? '');
    const cwd = String(args.cwd ?? './');
    const timeoutMs = Number.isFinite(Number(args.timeoutMs))
      ? Number(args.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

    const parsed = parseCommand(commandLine);
    if (!parsed.ok || !parsed.command) {
      return { output: `Comando rejeitado: ${parsed.error?.code ?? 'UNKNOWN'}` };
    }

    const validated = validateCommandPolicy(parsed.command, cwd, process.cwd());
    if (!validated.ok || !validated.plan) {
      return { output: `Política rejeitou comando: ${validated.error?.code ?? 'UNKNOWN'}` };
    }

    const { command, args: finalArgs, cwd: safeCwd } = validated.plan;

    const output = await new Promise<string>((resolve) => {
      const child = spawn(command, finalArgs, {
        cwd: safeCwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill();
        resolve('Execução interrompida por timeout.');
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout = appendLimited(stdout, chunk, MAX_STDOUT_CHARS);
      });

      child.stderr.on('data', (chunk) => {
        stderr = appendLimited(stderr, chunk, MAX_STDERR_CHARS);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim() || 'Comando executado sem saída.');
          return;
        }
        resolve((stderr || stdout || `Comando falhou com código ${code}`).trim());
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve('Falha ao iniciar processo do comando permitido.');
      });
    });

    return {
      output:
        output.length >= MAX_STDOUT_CHARS
          ? `${output.slice(0, MAX_STDOUT_CHARS)}\n[output truncated]`
          : output,
      metadata: {
        command,
        args: finalArgs,
        cwd: safeCwd,
      },
    };
  }
}
