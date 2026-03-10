import type { BaseTool } from './BaseTool.js';
import { logger } from '../lib/logger.js';

export interface ToolRegistration {
  tool: BaseTool;
  skillName?: string;
}

export class ToolRegistry {
  private readonly ordered: ToolRegistration[] = [];
  private readonly byName = new Map<string, ToolRegistration>();

  register(registration: ToolRegistration): boolean {
    const name = registration.tool.definition.name;

    if (this.byName.has(name)) {
      logger.warn({ toolName: name }, 'Duplicate tool name rejected');
      return false;
    }

    this.byName.set(name, registration);
    this.ordered.push(registration);
    return true;
  }

  getAll(): BaseTool[] {
    return this.ordered.map((entry) => entry.tool);
  }

  getByName(name: string): BaseTool | undefined {
    return this.byName.get(name)?.tool;
  }

  getGlobalTools(): BaseTool[] {
    return this.ordered
      .map((entry) => entry.tool)
      .filter((tool) => tool.definition.isGlobal);
  }

  getToolsForSkill(skillName: string): BaseTool[] {
    return this.ordered
      .filter((entry) => entry.skillName === skillName)
      .map((entry) => entry.tool);
  }
}
