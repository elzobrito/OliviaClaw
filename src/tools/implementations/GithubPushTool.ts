import { spawn } from 'node:child_process';
import { BaseTool } from '../BaseTool.js';
import { ToolDefinition, ToolResult } from '../../types/index.js';
import { parseCommand } from '../command/CommandArgumentParser.js';
import { validateCommandPolicy } from '../command/CommandPolicyValidator.js';

export class GithubPushTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'github_push',
    description: 'Executa fluxo seguro de status Git e push controlado (stub inicial).',
    schema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
      },
      required: ['cwd'],
      additionalProperties: false,
    },
    isGlobal: false,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    if (process.env.ENABLE_GITHUB_PUSH !== 'true') {
      return { output: 'GithubPushTool desabilitada por política (ENABLE_GITHUB_PUSH=false).' };
    }

    const cwd = String(args.cwd ?? './');

    const parsed = parseCommand('git --short --branch status');
    if (!parsed.ok || !parsed.command) {
      return { output: 'Falha de validação do comando git permitido.' };
    }

    const validated = validateCommandPolicy(parsed.command, cwd, process.cwd());
    const plan = validated.plan;
    if (!validated.ok || !plan) {
      return { output: `Política rejeitou execução git: ${validated.error?.code ?? 'UNKNOWN'}` };
    }

    const output = await new Promise<string>((resolve) => {
      const child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.on('exit', (code) => {
        if (code === 0) {
          resolve(`Stub seguro ativo. Status atual:\n${stdout.trim()}`);
          return;
        }
        resolve(`Falha no status git: ${(stderr || stdout || 'erro desconhecido').trim()}`);
      });
      child.on('error', () => resolve('Não foi possível iniciar processo git.'));
    });

    return { output, metadata: { mode: 'stub', command: 'git status' } };
  }
}
