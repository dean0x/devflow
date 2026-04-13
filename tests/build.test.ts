import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames } from '../src/cli/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('plugin manifest validation', () => {
  it('every plugin in DEVFLOW_PLUGINS has a matching plugins/ directory', async () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      const pluginDir = path.join(ROOT, 'plugins', plugin.name);
      const stat = await fs.stat(pluginDir);
      expect(stat.isDirectory(), `${plugin.name} should have a plugins/ directory`).toBe(true);
    }
  });

  it('every plugin has a .claude-plugin/plugin.json', async () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      const manifestPath = path.join(ROOT, 'plugins', plugin.name, '.claude-plugin', 'plugin.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      expect(manifest.name, `${plugin.name} plugin.json should have a name`).toBeTruthy();
    }
  });
});

describe('skill references', () => {
  it('every skill referenced in plugins exists in shared/skills/', async () => {
    const allSkills = getAllSkillNames();
    for (const skill of allSkills) {
      const skillDir = path.join(ROOT, 'shared', 'skills', skill);
      const stat = await fs.stat(skillDir);
      expect(stat.isDirectory(), `skill '${skill}' should exist in shared/skills/`).toBe(true);
    }
  });

  it('every skill directory has a SKILL.md', async () => {
    const allSkills = getAllSkillNames();
    for (const skill of allSkills) {
      const skillMd = path.join(ROOT, 'shared', 'skills', skill, 'SKILL.md');
      await expect(fs.access(skillMd)).resolves.toBeUndefined();
    }
  });
});

describe('skill frontmatter integrity', () => {
  it('every SKILL.md frontmatter name matches its directory name', async () => {
    const allSkills = getAllSkillNames();
    for (const skill of allSkills) {
      const skillMd = path.join(ROOT, 'shared', 'skills', skill, 'SKILL.md');
      const content = await fs.readFile(skillMd, 'utf-8');
      const match = content.match(/^name:\s*(.+)$/m);
      if (!match) expect.unreachable(`shared/skills/${skill}/SKILL.md should have a name: field in frontmatter`);
      expect(
        match[1].trim(),
        `shared/skills/${skill}/SKILL.md frontmatter name '${match[1].trim()}' does not match directory name '${skill}'`,
      ).toBe(skill);
    }
  });
});

describe('agent references', () => {
  it('every shared agent referenced in plugins exists in shared/agents/', async () => {
    const allAgents = getAllAgentNames();
    // Filter to shared agents only (plugin-specific agents live in plugin dirs)
    const sharedAgentFiles = await fs.readdir(path.join(ROOT, 'shared', 'agents'));
    const sharedAgentNames = sharedAgentFiles.map(f => path.basename(f, '.md'));

    for (const agent of allAgents) {
      // Check shared/agents/ first, then fall back to plugin-specific
      if (sharedAgentNames.includes(agent)) {
        const agentFile = path.join(ROOT, 'shared', 'agents', `${agent}.md`);
        await expect(fs.access(agentFile)).resolves.toBeUndefined();
      } else {
        // Plugin-specific agent — find which plugin declares it
        const ownerPlugin = DEVFLOW_PLUGINS.find(p => p.agents.includes(agent));
        expect(ownerPlugin, `agent '${agent}' should have an owning plugin`).toBeTruthy();
        const agentFile = path.join(ROOT, 'plugins', ownerPlugin!.name, 'agents', `${agent}.md`);
        await expect(fs.access(agentFile)).resolves.toBeUndefined();
      }
    }
  });
});

describe('no orphaned declarations', () => {
  // Skills that intentionally exist in shared/skills/ but are not distributed to any plugin.
  // These are format specifications consumed by background processes, not by agents or commands.
  // See D9 in .memory/knowledge/decisions.md for rationale.
  const FORMAT_SPEC_SKILLS = new Set(['knowledge-persistence']);

  it('all skills in shared/skills/ are referenced by at least one plugin', async () => {
    const skillDirs = await fs.readdir(path.join(ROOT, 'shared', 'skills'));
    const referencedSkills = new Set(getAllSkillNames());

    for (const dir of skillDirs) {
      if (FORMAT_SPEC_SKILLS.has(dir)) continue; // intentionally not plugin-distributed
      expect(referencedSkills.has(dir), `shared/skills/${dir} is not referenced by any plugin`).toBe(true);
    }
  });

  it('all agents in shared/agents/ are referenced by at least one plugin', async () => {
    const agentFiles = await fs.readdir(path.join(ROOT, 'shared', 'agents'));
    const referencedAgents = new Set(getAllAgentNames());

    for (const file of agentFiles) {
      const name = path.basename(file, '.md');
      expect(referencedAgents.has(name), `shared/agents/${file} is not referenced by any plugin`).toBe(true);
    }
  });
});
