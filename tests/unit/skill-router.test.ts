import { describe, expect, it } from 'vitest';
import { SkillRouter } from '../../src/skills/SkillRouter';
import type { Skill } from '../../src/skills/types';

const skills: Skill[] = [
  {
    name: 'general-chat',
    description: 'Conversa geral',
    triggers: ['/chat'],
    tools: [],
    version: '1.0.0',
    skillSystemPrompt: 'x',
    filePath: '/tmp/general/SKILL.md',
  },
  {
    name: 'git-manager',
    description: 'Git operations',
    triggers: ['/git'],
    tools: [],
    version: '1.0.0',
    skillSystemPrompt: 'x',
    filePath: '/tmp/git/SKILL.md',
  },
];

describe('SkillRouter', () => {
  it('routes by explicit trigger case-insensitive', () => {
    const router = new SkillRouter();
    const result = router.route('/GIT status', skills);
    expect(result.skillName).toBe('git-manager');
    expect(result.matchType).toBe('explicit_trigger');
  });

  it('uses fallback provider with strict JSON and known skill only', async () => {
    const router = new SkillRouter({
      fallbackProvider: {
        selectSkill: async () => JSON.stringify({ skillName: 'general-chat' }),
      },
    });

    const result = await router.routeWithFallback('quero conversar', skills);
    expect(result.skillName).toBe('general-chat');
    expect(result.matchType).toBe('llm_fallback');
  });

  it('degrades to null on invalid fallback payload', async () => {
    const router = new SkillRouter({
      fallbackProvider: {
        selectSkill: async () => '{"skill":"ghost"}',
      },
    });

    const result = await router.routeWithFallback('x', skills);
    expect(result.skillName).toBeNull();
    expect(result.matchType).toBe('none');
  });
});
