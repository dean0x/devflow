import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames } from '../src/cli/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const COMMANDS_DIR = path.join(ROOT, 'commands');

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
// devflow-dynamic declared commands ↔ commands/*.mds source parity
//
// Ties the 5 command names declared in DEVFLOW_PLUGINS to the 5 dynamic-*.mds
// host files in commands/ whose output-dir points at plugins/devflow-dynamic/.
// Deriving from source (not from gitignored compiled output) means this test
// passes even on a clean checkout before build:mds has run — the only reliable
// contract (applies ADR-019).
//
// A dynamic host rename (e.g. dynamic-wave.mds → dynamic-orchestrate.mds)
// without updating plugins.ts would fail this test, surfacing the drift before
// it ships.
// ---------------------------------------------------------------------------

describe('devflow-dynamic declared commands ↔ commands/ source parity', () => {
  /** Read the output-dir: from a .mds file's frontmatter, or null if absent. */
  async function getOutputDir(filePath: string): Promise<string | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
    if (!fmMatch) return null;
    const odMatch = /^output-dir:[ \t]*(.+?)[ \t]*$/m.exec(fmMatch[1]);
    return odMatch ? odMatch[1].trim() : null;
  }

  it('declared command names match dynamic-host .mds files in commands/ (1:1)', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin, 'devflow-dynamic must be registered in DEVFLOW_PLUGINS').toBeDefined();

    // Derive expected command names from commands/ source files whose output-dir
    // targets plugins/devflow-dynamic/commands (the dynamic hosts).
    const entries = await fs.readdir(COMMANDS_DIR, { withFileTypes: true });
    const hostFiles = entries.filter(
      e => e.isFile() && e.name.endsWith('.mds') && !e.name.startsWith('_'),
    );

    const dynamicSourceNames: string[] = [];
    for (const e of hostFiles) {
      const outputDir = await getOutputDir(path.join(COMMANDS_DIR, e.name));
      if (outputDir && outputDir.includes('devflow-dynamic')) {
        dynamicSourceNames.push('/' + path.basename(e.name, '.mds'));
      }
    }
    dynamicSourceNames.sort();

    const declaredCommands = [...dynPlugin!.commands].sort();

    expect(
      declaredCommands,
      `devflow-dynamic declared commands must match dynamic-host sources 1:1.\n` +
      `  declared:  ${declaredCommands.join(', ')}\n` +
      `  from src:  ${dynamicSourceNames.join(', ')}`,
    ).toEqual(dynamicSourceNames);
  });

  it('every declared devflow-dynamic command has a corresponding .mds source file in commands/', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin).toBeDefined();

    for (const cmd of dynPlugin!.commands) {
      const sourceName = cmd.replace(/^\//, '') + '.mds';
      const sourcePath = path.join(COMMANDS_DIR, sourceName);
      await expect(
        fs.access(sourcePath),
        `Command '${cmd}' declared in DEVFLOW_PLUGINS has no source at commands/${sourceName}`,
      ).resolves.toBeUndefined();
    }
  });

  it('every dynamic-host .mds in commands/ is declared as a devflow-dynamic command', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin).toBeDefined();

    const declaredSet = new Set(dynPlugin!.commands);
    const entries = await fs.readdir(COMMANDS_DIR, { withFileTypes: true });
    const hostFiles = entries.filter(
      e => e.isFile() && e.name.endsWith('.mds') && !e.name.startsWith('_'),
    );

    for (const e of hostFiles) {
      const outputDir = await getOutputDir(path.join(COMMANDS_DIR, e.name));
      if (!outputDir || !outputDir.includes('devflow-dynamic')) continue;
      const expectedCmd = '/' + path.basename(e.name, '.mds');
      expect(
        declaredSet.has(expectedCmd),
        `commands/${e.name} targets devflow-dynamic but '${expectedCmd}' is not declared in DEVFLOW_PLUGINS. Add it to devflow-dynamic.commands in src/cli/plugins.ts`,
      ).toBe(true);
    }
  });
});
