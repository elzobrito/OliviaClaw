import type { BaseTool } from './BaseTool.js';
import { ToolRegistry } from './ToolRegistry.js';
import { logger as defaultLogger } from '../lib/logger.js';

export interface ToolFactoryDependencies {
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  pathSafety?: {
    assertPathWithinAllowedRoots: (inputPath: string, allowedRoots: string[], baseDir?: string) => string;
  };
  fsUtils?: {
    exists: (path: string) => boolean;
    readText: (path: string) => string;
  };
}

export type ToolCreator = (deps: ToolFactoryDependencies) => BaseTool;

export class ToolFactory {
  private readonly creatorByName = new Map<string, ToolCreator>();
  private readonly deps: ToolFactoryDependencies;
  private readonly registry?: ToolRegistry;

  constructor(deps: ToolFactoryDependencies = {}, registry?: ToolRegistry) {
    this.deps = deps;
    this.registry = registry;
  }

  registerCreator(name: string, creator: ToolCreator): void {
    this.creatorByName.set(name, creator);
  }

  create(name: string): BaseTool {
    const creator = this.creatorByName.get(name);
    if (creator) {
      return creator(this.deps);
    }

    const registeredTool = this.registry?.getByName(name);
    if (registeredTool) {
      // Each call returns a fresh wrapper to avoid sharing mutable tool state.
      return {
        definition: { ...registeredTool.definition },
        execute: (args: Record<string, unknown>) => registeredTool.execute(args),
      };
    }

    const log = this.deps.logger ?? defaultLogger;
    log.warn({ toolName: name }, 'Unknown tool requested');
    throw new Error(`Unknown tool: ${name}`);
  }
}
