import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames } from '../src/cli/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const RECIPES_DIR = path.join(ROOT, 'shared', 'recipes');

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

describe('rule references', () => {
  it('every rule referenced in plugins exists in shared/rules/', async () => {
    const allRules = getAllRuleNames();
    for (const rule of allRules) {
      const ruleFile = path.join(ROOT, 'shared', 'rules', `${rule}.md`);
      await expect(fs.access(ruleFile)).resolves.toBeUndefined();
    }
  });
});

describe('no orphaned declarations', () => {
  // Skills that intentionally exist in shared/skills/ but are not distributed to any plugin.
  // These are format specifications consumed by background processes, not by agents or commands.
  // See D9 in .devflow/decisions/decisions.md for rationale.
  const FORMAT_SPEC_SKILLS = new Set(['decisions-format']);

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

// ---------------------------------------------------------------------------
// marketplace.json ↔ DEVFLOW_PLUGINS name parity (applies ADR-014)
//
// Guards the whole project: every plugin in src/cli/plugins.ts must have a
// corresponding entry in .claude-plugin/marketplace.json (and vice-versa).
// This is the test that would have caught the missing devflow-dynamic entry
// before it shipped silently (regression from PR #242 review).
// ---------------------------------------------------------------------------

describe('marketplace.json ↔ DEVFLOW_PLUGINS parity', () => {
  it('every plugin in DEVFLOW_PLUGINS has a marketplace.json entry', async () => {
    const raw = await fs.readFile(MARKETPLACE_PATH, 'utf-8');
    const marketplace = JSON.parse(raw) as { plugins: Array<{ name: string }> };
    const marketplaceNames = new Set(marketplace.plugins.map(p => p.name));

    for (const plugin of DEVFLOW_PLUGINS) {
      expect(
        marketplaceNames.has(plugin.name),
        `Plugin '${plugin.name}' is in DEVFLOW_PLUGINS but missing from marketplace.json — add an entry to .claude-plugin/marketplace.json`,
      ).toBe(true);
    }
  });

  it('every marketplace.json entry has a corresponding DEVFLOW_PLUGINS registration', async () => {
    const raw = await fs.readFile(MARKETPLACE_PATH, 'utf-8');
    const marketplace = JSON.parse(raw) as { plugins: Array<{ name: string }> };
    const registryNames = new Set(DEVFLOW_PLUGINS.map(p => p.name));

    for (const entry of marketplace.plugins) {
      expect(
        registryNames.has(entry.name),
        `marketplace.json entry '${entry.name}' has no corresponding plugin in DEVFLOW_PLUGINS (src/cli/plugins.ts)`,
      ).toBe(true);
    }
  });

  it('marketplace.json plugin count matches DEVFLOW_PLUGINS count', async () => {
    const raw = await fs.readFile(MARKETPLACE_PATH, 'utf-8');
    const marketplace = JSON.parse(raw) as { plugins: Array<{ name: string }> };
    expect(marketplace.plugins.length).toBe(DEVFLOW_PLUGINS.length);
  });
});

// ---------------------------------------------------------------------------
// devflow-dynamic declared commands ↔ shared/recipes/ source parity
//
// Ties the 5 command names declared in DEVFLOW_PLUGINS to the 5 non-partial
// .mds recipe source files in shared/recipes/. Deriving from source (not from
// gitignored compiled output) means this test passes even on a clean checkout
// before build:recipes has run — which is the only reliable contract (applies ADR-019).
//
// A recipe rename (e.g. dynamic-wave.mds → dynamic-orchestrate.mds) without
// updating plugins.ts would fail this test, surfacing the drift before it ships.
// ---------------------------------------------------------------------------

describe('devflow-dynamic declared commands ↔ recipe sources parity', () => {
  it('declared command names match non-partial .mds files in shared/recipes/ (1:1)', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin, 'devflow-dynamic must be registered in DEVFLOW_PLUGINS').toBeDefined();

    // Derive expected command names from shared/recipes/ source files.
    // Non-partial = file does NOT start with `_`. Strip .mds suffix and prepend /.
    const entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
    const commandSourceNames = entries
      .filter(e => e.isFile() && e.name.endsWith('.mds') && !e.name.startsWith('_'))
      .map(e => '/' + path.basename(e.name, '.mds'))
      .sort();

    const declaredCommands = [...dynPlugin!.commands].sort();

    expect(
      declaredCommands,
      `devflow-dynamic declared commands must match non-partial recipe sources 1:1.\n` +
      `  declared:  ${declaredCommands.join(', ')}\n` +
      `  from src:  ${commandSourceNames.join(', ')}`,
    ).toEqual(commandSourceNames);
  });

  it('every declared devflow-dynamic command has a corresponding .mds source file', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin).toBeDefined();

    for (const cmd of dynPlugin!.commands) {
      // Strip leading / to get the basename, append .mds
      const sourceName = cmd.replace(/^\//, '') + '.mds';
      const sourcePath = path.join(RECIPES_DIR, sourceName);
      await expect(
        fs.access(sourcePath),
        `Command '${cmd}' declared in DEVFLOW_PLUGINS has no recipe source at shared/recipes/${sourceName}`,
      ).resolves.toBeUndefined();
    }
  });

  it('every non-partial .mds in shared/recipes/ is declared as a devflow-dynamic command', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin).toBeDefined();

    const declaredSet = new Set(dynPlugin!.commands);
    const entries = await fs.readdir(RECIPES_DIR, { withFileTypes: true });
    const commandSources = entries.filter(
      e => e.isFile() && e.name.endsWith('.mds') && !e.name.startsWith('_'),
    );

    for (const src of commandSources) {
      const expectedCmd = '/' + path.basename(src.name, '.mds');
      expect(
        declaredSet.has(expectedCmd),
        `Recipe source '${src.name}' is not declared as a command in DEVFLOW_PLUGINS. Add '${expectedCmd}' to devflow-dynamic.commands in src/cli/plugins.ts`,
      ).toBe(true);
    }
  });
});
