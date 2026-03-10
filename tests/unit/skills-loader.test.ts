import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader } from '../../src/skills/SkillLoader';
import { SkillRouter } from '../../src/skills/SkillRouter';

const tempDirs: string[] = [];

async function createSkillsRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'skills-loader-'));
  tempDirs.push(root);
  return root;
}

async function writeSkill(root: string, folder: string, content: string): Promise<void> {
  const skillDir = path.join(root, folder);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('SkillLoader', () => {
  it('parses valid frontmatter and body into skillSystemPrompt', async () => {
    const root = await createSkillsRoot();
    await writeSkill(
      root,
      'chat',
      [
        '---',
        'name: general-chat',
        'description: Conversa',
        'version: 1.0.0',
        'triggers:',
        '  - /chat',
        'tools:',
        '  - ler_arquivo',
        '---',
        'Prompt da skill',
      ].join('\n'),
    );

    const loader = new SkillLoader({ skillsDir: root, allowedToolNames: ['ler_arquivo'] });
    const loaded = await loader.load();

    expect(loaded.errors).toHaveLength(0);
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0]?.name).toBe('general-chat');
    expect(loaded.skills[0]?.skillSystemPrompt).toContain('<<SKILL_PROMPT_BEGIN:general-chat>>');
    expect(loaded.skills[0]?.skillSystemPrompt).toContain('Prompt da skill');
    expect(loaded.skills[0]?.skillSystemPrompt).toContain('<<SKILL_PROMPT_END:general-chat>>');
  });

  it('rejects duplicate names and trigger collisions with safe degradation', async () => {
    const root = await createSkillsRoot();
    await writeSkill(
      root,
      'a',
      ['---', 'name: same', 'description: one', 'version: 1.0.0', 'triggers:', '  - /x', '---', 'body'].join('\n'),
    );
    await writeSkill(
      root,
      'b',
      ['---', 'name: same', 'description: two', 'version: 1.0.0', 'triggers:', '  - /x', '---', 'body'].join('\n'),
    );

    const loader = new SkillLoader({ skillsDir: root });
    const loaded = await loader.load();

    expect(loaded.skills).toHaveLength(1);
    expect(loaded.errors.some((e) => !e.ok && (e.reason === 'name_duplicate' || e.reason === 'trigger_collision'))).toBe(true);
  });

  it('supports hot reload by re-reading changed SKILL.md', async () => {
    const root = await createSkillsRoot();
    await writeSkill(
      root,
      'prd',
      ['---', 'name: prd-manager', 'description: v1', 'version: 1.0.0', '---', 'body v1'].join('\n'),
    );
    const loader = new SkillLoader({ skillsDir: root });

    const first = await loader.load();
    expect(first.skills[0]?.description).toBe('v1');

    await writeSkill(
      root,
      'prd',
      ['---', 'name: prd-manager', 'description: v2', 'version: 1.0.1', '---', 'body v2'].join('\n'),
    );
    const second = await loader.load();

    expect(second.skills[0]?.description).toBe('v2');
    expect(second.skills[0]?.version).toBe('1.0.1');
  });

  it('loads a single skill by name and builds deterministic summary', async () => {
    const root = await createSkillsRoot();
    await writeSkill(
      root,
      'one',
      ['---', 'name: alpha', 'description: Alpha skill', 'version: 1.0.0', 'triggers:', '  - /a', '---', 'body alpha'].join('\n'),
    );
    await writeSkill(
      root,
      'two',
      ['---', 'name: beta', 'description: Beta skill', 'version: 1.0.0', 'triggers:', '  - /b', '---', 'body beta'].join('\n'),
    );

    const loader = new SkillLoader({ skillsDir: root });
    const loaded = await loader.load();
    const byName = await loader.loadByName('beta');
    const summary = loader.buildAvailableSkillsSummary(loaded.skills);

    expect(byName?.name).toBe('beta');
    expect(byName?.skillSystemPrompt).toContain('<<SKILL_PROMPT_BEGIN:beta>>');
    expect(summary).toBe('alpha [/a] - Alpha skill\nbeta [/b] - Beta skill');
  });
});

describe('SkillRouter fallback and summary', () => {
  it('returns deterministic available skills summary from loaded skills', async () => {
    const root = await createSkillsRoot();
    await writeSkill(
      root,
      'one',
      ['---', 'name: alpha', 'description: Alpha', 'version: 1.0.0', 'triggers:', '  - /a', '---', 'body'].join('\n'),
    );
    await writeSkill(
      root,
      'two',
      ['---', 'name: beta', 'description: Beta', 'version: 1.0.0', 'triggers:', '  - /b', '---', 'body'].join('\n'),
    );
    const loader = new SkillLoader({ skillsDir: root });
    const loaded = await loader.load();

    const availableSkillsSummary = loaded.skills
      .map((s) => `${s.name}(${s.triggers.join(',') || '-'})`)
      .sort()
      .join('; ');

    expect(availableSkillsSummary).toBe('alpha(/a); beta(/b)');
  });

  it('degrades fallback to null on malformed provider response', async () => {
    const router = new SkillRouter({
      fallbackProvider: {
        selectSkill: async () => 'not-json',
      },
    });

    const result = await router.routeWithFallback('x', [
      {
        name: 'alpha',
        description: 'Alpha',
        triggers: [],
        tools: [],
        version: '1.0.0',
        skillSystemPrompt: 'body',
        filePath: '/tmp/a/SKILL.md',
      },
    ]);

    expect(result.skillName).toBeNull();
    expect(result.matchType).toBe('none');
  });
});
