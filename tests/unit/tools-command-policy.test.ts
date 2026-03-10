import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BaseTool } from '../../src/tools/BaseTool';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { ToolFactory } from '../../src/tools/ToolFactory';
import { parseCommand } from '../../src/tools/command/CommandArgumentParser';
import { validateCommandPolicy } from '../../src/tools/command/CommandPolicyValidator';
import { ExecutarComandoTool } from '../../src/tools/implementations/ExecutarComandoTool';

const tempScripts: string[] = [];

async function createTempScript(name: string, content: string): Promise<string> {
  const target = path.join(process.cwd(), 'tmp', name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  tempScripts.push(target);
  return target;
}

function relPath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
}

afterEach(async () => {
  await Promise.all(
    tempScripts.splice(0).map(async (file) => {
      await fs.rm(file, { force: true });
    }),
  );
});

describe('ToolRegistry and ToolFactory', () => {
  it('rejects duplicate tool names in registry', () => {
    const registry = new ToolRegistry();
    const tool: BaseTool = {
      definition: {
        name: 'dup_tool',
        description: 'd',
        schema: { type: 'object', properties: {} },
        isGlobal: true,
      },
      execute: async () => ({ output: 'ok' }),
    };

    expect(registry.register({ tool })).toBe(true);
    expect(registry.register({ tool })).toBe(false);
  });

  it('throws on unknown tool creation', () => {
    const factory = new ToolFactory();
    expect(() => factory.create('missing_tool')).toThrow('Unknown tool');
  });
});

describe('Command parser and policy', () => {
  it('blocks shell bypass metacharacters', () => {
    const parsed = parseCommand('npm test && whoami');
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('FORBIDDEN_METACHAR');
  });

  it('rejects unknown commands', () => {
    const parsed = parseCommand('powershell -Command Get-Date');
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('UNKNOWN_COMMAND');
  });

  it('rejects invalid cwd outside policy roots', () => {
    const parsed = parseCommand('node src/main.ts');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.command) return;

    const validated = validateCommandPolicy(parsed.command, '../', process.cwd());
    expect(validated.ok).toBe(false);
    expect(validated.error?.code).toBe('COMMAND_INVALID_CWD');
  });

  it('rejects extra positional args (sensitive env-style payload)', () => {
    const parsed = parseCommand('node src/main.ts SECRET_TOKEN=abc123');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.command) return;

    const validated = validateCommandPolicy(parsed.command, './', process.cwd());
    expect(validated.ok).toBe(false);
    expect(validated.error?.code).toBe('COMMAND_INVALID_ARG_COUNT');
  });
});

describe('ExecutarComandoTool secure execution limits', () => {
  it('limits stdout size and truncates excessive output', async () => {
    const script = await createTempScript(
      'emit-stdout.js',
      "process.stdout.write('A'.repeat(15000));",
    );
    const tool = new ExecutarComandoTool();

    const result = await tool.execute({
      commandLine: `node ${relPath(script)}`,
      cwd: './',
      timeoutMs: 5000,
    });

    expect(result.output.length).toBeLessThanOrEqual(8100);
    expect(result.output).toContain('[output truncated]');
  });

  it('limits stderr size on command failures', async () => {
    const script = await createTempScript(
      'emit-stderr.js',
      "process.stderr.write('E'.repeat(12000)); process.exit(1);",
    );
    const tool = new ExecutarComandoTool();

    const result = await tool.execute({
      commandLine: `node ${relPath(script)}`,
      cwd: './',
      timeoutMs: 5000,
    });

    expect(result.output.length).toBeLessThanOrEqual(4200);
  });
});
