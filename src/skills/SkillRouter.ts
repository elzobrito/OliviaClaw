import type { Skill } from './types.js';

export interface SkillRouteResult {
  skillName: string | null;
  matchType: 'explicit_trigger' | 'llm_fallback' | 'none';
}

export interface SkillFallbackProvider {
  selectSkill(
    input: string,
    skills: Array<{ name: string; description: string; triggers: string[] }>,
  ): Promise<string>;
}

interface SkillRouterConfig {
  fallbackProvider?: SkillFallbackProvider;
}

export class SkillRouter {
  private readonly fallbackProvider?: SkillFallbackProvider;

  constructor(config: SkillRouterConfig = {}) {
    this.fallbackProvider = config.fallbackProvider;
  }

  route(input: string, skills: Skill[]): SkillRouteResult {
    const normalizedInput = input.trim().toLowerCase();
    if (!normalizedInput) {
      return { skillName: null, matchType: 'none' };
    }

    let bestMatch: { skillName: string; triggerLength: number } | null = null;

    for (const skill of skills) {
      for (const trigger of skill.triggers) {
        const candidate = trigger.trim().toLowerCase();
        if (!candidate) continue;
        if (!normalizedInput.startsWith(candidate)) continue;

        // Estratégia determinística para colisão:
        // 1) trigger mais longo (mais específico), 2) nome da skill em ordem lexicográfica.
        if (
          !bestMatch ||
          candidate.length > bestMatch.triggerLength ||
          (candidate.length === bestMatch.triggerLength &&
            skill.name.localeCompare(bestMatch.skillName) < 0)
        ) {
          bestMatch = { skillName: skill.name, triggerLength: candidate.length };
        }
      }
    }

    if (!bestMatch) {
      return { skillName: null, matchType: 'none' };
    }

    return { skillName: bestMatch.skillName, matchType: 'explicit_trigger' };
  }

  async routeWithFallback(input: string, skills: Skill[]): Promise<SkillRouteResult> {
    const direct = this.route(input, skills);
    if (direct.skillName) {
      return direct;
    }
    if (!this.fallbackProvider) {
      return direct;
    }

    try {
      const raw = await this.fallbackProvider.selectSkill(
        input,
        skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          triggers: skill.triggers,
        })),
      );

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { skillName: null, matchType: 'none' };
      }

      const payload = parsed as Record<string, unknown>;
      const keys = Object.keys(payload);
      if (keys.length !== 1 || keys[0] !== 'skillName') {
        return { skillName: null, matchType: 'none' };
      }

      const skillName = payload.skillName;
      if (skillName === null) {
        return { skillName: null, matchType: 'none' };
      }
      if (typeof skillName !== 'string' || skillName.trim().length === 0) {
        return { skillName: null, matchType: 'none' };
      }

      const exists = skills.some((skill) => skill.name === skillName);
      if (!exists) {
        return { skillName: null, matchType: 'none' };
      }

      return { skillName, matchType: 'llm_fallback' };
    } catch {
      return { skillName: null, matchType: 'none' };
    }
  }
}
