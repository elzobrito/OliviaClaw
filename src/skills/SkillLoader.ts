import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { logger } from '../lib/logger.js';
import type {
  ISkillLoader,
  Skill,
  SkillFrontmatter,
  SkillLoadError,
  SkillLoadResult,
  SkillRouteDecision,
} from './types.js';

export interface SkillLoaderConfig {
  skillsDir: string;
  allowedToolNames?: string[];
}

function buildSkillSystemPrompt(name: string, body: string): string {
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return [
    `<<SKILL_PROMPT_BEGIN:${name}>>`,
    normalizedBody,
    `<<SKILL_PROMPT_END:${name}>>`,
  ].join('\n');
}

function parseSkillMarkdown(content: string): { frontmatterRaw: string; body: string } | null {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return {
    frontmatterRaw: match[1] ?? '',
    body: (match[2] ?? '').trim(),
  };
}

function toLoadError(reason: SkillLoadError, filePath: string): SkillLoadResult {
  return { ok: false, reason, filePath };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export class SkillLoader implements ISkillLoader {
  private readonly skillsDir: string;
  private readonly allowedToolNames: Set<string>;
  private loadedSkills: Skill[] = [];

  constructor(config: SkillLoaderConfig) {
    this.skillsDir = path.resolve(config.skillsDir);
    this.allowedToolNames = new Set(config.allowedToolNames ?? []);
  }

  private parseOne(filePath: string): SkillLoadResult {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      return toLoadError('frontmatter_missing', filePath);
    }

    const parsed = parseSkillMarkdown(raw);
    if (!parsed) {
      return toLoadError('frontmatter_missing', filePath);
    }
    if (!parsed.body) {
      return toLoadError('body_empty', filePath);
    }

    let frontmatter: SkillFrontmatter;
    try {
      const yamlObject = yaml.load(parsed.frontmatterRaw);
      if (!yamlObject || typeof yamlObject !== 'object') {
        return toLoadError('frontmatter_invalid_yaml', filePath);
      }
      frontmatter = yamlObject as SkillFrontmatter;
    } catch {
      return toLoadError('frontmatter_invalid_yaml', filePath);
    }

    const name = asNonEmptyString(frontmatter.name);
    const description = asNonEmptyString(frontmatter.description);
    const version = asNonEmptyString(frontmatter.version);

    if (!name || !description || !version) {
      return toLoadError('frontmatter_missing_field', filePath);
    }

    const triggers = Array.isArray(frontmatter.triggers)
      ? frontmatter.triggers
          .map((item) => asNonEmptyString(item))
          .filter((item): item is string => Boolean(item))
          .map((item) => item.toLowerCase())
      : [];

    const declaredTools = Array.isArray(frontmatter.tools)
      ? frontmatter.tools
          .map((item) => asNonEmptyString(item))
          .filter((item): item is string => Boolean(item))
      : [];

    const tools =
      this.allowedToolNames.size === 0
        ? declaredTools
        : declaredTools.filter((toolName) => {
            const keep = this.allowedToolNames.has(toolName);
            if (!keep) {
              logger.warn({ skillFile: filePath, toolName }, 'Skill declared unknown tool and it was removed');
            }
            return keep;
          });

    return {
      ok: true,
      skill: {
        name,
        description,
        version,
        triggers,
        tools,
        skillSystemPrompt: buildSkillSystemPrompt(name, parsed.body),
        filePath,
      },
    };
  }

  private findSkillFileByName(skillName: string): string | null {
    if (!fs.existsSync(this.skillsDir)) return null;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const parsed = this.parseOne(skillFile);
      if (parsed.ok && parsed.skill.name === skillName) {
        return skillFile;
      }
    }

    return null;
  }

  async load(): Promise<{ skills: Skill[]; errors: SkillLoadResult[] }> {
    const skills: Skill[] = [];
    const errors: SkillLoadResult[] = [];
    const names = new Set<string>();
    const triggers = new Map<string, string>();

    if (!fs.existsSync(this.skillsDir)) {
      logger.warn({ skillsDir: this.skillsDir }, 'Skills directory does not exist; loading empty skill set');
      this.loadedSkills = [];
      return { skills: [], errors: [] };
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    } catch {
      logger.warn({ skillsDir: this.skillsDir }, 'Could not read skills directory');
      this.loadedSkills = [];
      return { skills: [], errors: [] };
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      const result = this.parseOne(skillFile);
      if (!result.ok) {
        logger.warn({ filePath: skillFile, reason: result.reason }, 'Invalid skill ignored');
        errors.push(result);
        continue;
      }

      const { skill } = result;
      if (names.has(skill.name)) {
        logger.warn({ filePath: skill.filePath, skillName: skill.name }, 'Duplicate skill name ignored');
        errors.push(toLoadError('name_duplicate', skill.filePath));
        continue;
      }

      const collision = skill.triggers.find((trigger) => triggers.has(trigger));
      if (collision) {
        logger.warn(
          { filePath: skill.filePath, trigger: collision, otherSkill: triggers.get(collision) },
          'Skill trigger collision; skill ignored',
        );
        errors.push(toLoadError('trigger_collision', skill.filePath));
        continue;
      }

      names.add(skill.name);
      for (const trigger of skill.triggers) {
        triggers.set(trigger, skill.name);
      }
      skills.push(skill);
    }

    this.loadedSkills = skills;
    return { skills, errors };
  }

  async loadByName(skillName: string): Promise<Skill | null> {
    const normalized = skillName.trim();
    if (!normalized) return null;

    const fromCache = this.loadedSkills.find((skill) => skill.name === normalized);
    if (fromCache) return fromCache;

    const filePath = this.findSkillFileByName(normalized);
    if (!filePath) return null;

    const parsed = this.parseOne(filePath);
    if (!parsed.ok) {
      logger.warn({ skillName: normalized, reason: parsed.reason }, 'Failed to load skill by name');
      return null;
    }

    return parsed.skill;
  }

  buildAvailableSkillsSummary(skills: Skill[] = this.loadedSkills): string {
    return skills
      .map((skill) => {
        const triggers = skill.triggers.length > 0 ? skill.triggers.join(', ') : '-';
        return `${skill.name} [${triggers}] - ${skill.description}`;
      })
      .sort((a, b) => a.localeCompare(b))
      .join('\n');
  }

  route(input: string): SkillRouteDecision {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return { matched: false, fallback: 'llm_default' };

    const triggerMatch = this.loadedSkills.find((skill) =>
      skill.triggers.some((trigger) => normalized.startsWith(trigger)),
    );
    if (triggerMatch) {
      return { matched: true, skill: triggerMatch, matchType: 'explicit_trigger' };
    }

    const semanticMatch = this.loadedSkills.find((skill) => {
      const candidateTerms = [skill.name, ...skill.description.toLowerCase().split(/\s+/)];
      return candidateTerms.some((term) => term.length >= 4 && normalized.includes(term));
    });
    if (semanticMatch) {
      return { matched: true, skill: semanticMatch, matchType: 'semantic' };
    }

    return { matched: false, fallback: 'llm_default' };
  }
}
