import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames } from '../src/core/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'src', 'assets');
const COMMANDS_DIR = path.join(ASSETS_DIR, 'commands');

describe('skill references', () => {
  it('every skill referenced in plugins exists in src/assets/skills/', async () => {
    const allSkills = getAllSkillNames();
    for (const skill of allSkills) {
      const skillDir = path.join(ASSETS_DIR, 'skills', skill);
      const stat = await fs.stat(skillDir);
      expect(stat.isDirectory(), `skill '${skill}' should exist in src/assets/skills/`).toBe(true);
    }
  });

  it('every skill directory has a SKILL.md', async () => {
    const allSkills = getAllSkillNames();
    for (const skill of allSkills) {
      const skillMd = path.join(ASSETS_DIR, 'skills', skill, 'SKILL.md');
      await expect(fs.access(skillMd)).resolves.toBeUndefined();
    }
  });
});

describe('skill frontmatter integrity', () => {
  it('every SKILL.md frontmatter name matches its directory name', async () => {
    const allSkills = getAllSkillNames();
    for (const skill of allSkills) {
      const skillMd = path.join(ASSETS_DIR, 'skills', skill, 'SKILL.md');
      const content = await fs.readFile(skillMd, 'utf-8');
      const match = content.match(/^name:\s*(.+)$/m);
      if (!match) expect.unreachable(`src/assets/skills/${skill}/SKILL.md should have a name: field in frontmatter`);
      expect(
        match[1].trim(),
        `src/assets/skills/${skill}/SKILL.md frontmatter name '${match[1].trim()}' does not match directory name '${skill}'`,
      ).toBe(skill);
    }
  });
});

describe('agent references', () => {
  it('every agent referenced in plugins exists in src/assets/agents/', async () => {
    const allAgents = getAllAgentNames();
    for (const agent of allAgents) {
      const agentFile = path.join(ASSETS_DIR, 'agents', `${agent}.md`);
      await expect(
        fs.access(agentFile),
        `agent '${agent}' should exist in src/assets/agents/`,
      ).resolves.toBeUndefined();
    }
  });
});

describe('rule references', () => {
  it('every rule referenced in plugins exists in src/assets/rules/', async () => {
    const allRules = getAllRuleNames();
    for (const rule of allRules) {
      const ruleFile = path.join(ASSETS_DIR, 'rules', `${rule}.md`);
      await expect(fs.access(ruleFile)).resolves.toBeUndefined();
    }
  });
});

describe('no orphaned declarations', () => {
  // Skills that intentionally exist in src/assets/skills/ but are not distributed to any plugin.
  // These are format specifications consumed by background processes, not by agents or commands.
  // See D9 in .devflow/decisions/decisions.md for rationale.
  const FORMAT_SPEC_SKILLS = new Set(['decisions-format']);

  it('all skills in src/assets/skills/ are referenced by at least one plugin', async () => {
    const skillDirs = await fs.readdir(path.join(ASSETS_DIR, 'skills'));
    const referencedSkills = new Set(getAllSkillNames());

    for (const dir of skillDirs) {
      if (FORMAT_SPEC_SKILLS.has(dir)) continue; // intentionally not plugin-distributed
      expect(referencedSkills.has(dir), `src/assets/skills/${dir} is not referenced by any plugin`).toBe(true);
    }
  });

  it('all agents in src/assets/agents/ are referenced by at least one plugin', async () => {
    const agentFiles = await fs.readdir(path.join(ASSETS_DIR, 'agents'));
    const referencedAgents = new Set(getAllAgentNames());

    for (const file of agentFiles) {
      const name = path.basename(file, '.md');
      expect(referencedAgents.has(name), `src/assets/agents/${file} is not referenced by any plugin`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// agent frontmatter compliance contract (avoids PF-002)
//
// Guards that no shared agent lists devflow:compliance in its frontmatter
// skills: block. The compliance skill is intentionally body-instructed only
// (agents invoke it via Skill() when regulated surface is detected) — adding
// it to frontmatter triggers the re-entrancy guard and silently produces
// zero-work agents while the orchestrator still reports success.
// ---------------------------------------------------------------------------

describe('agent frontmatter compliance contract', () => {
  it('no src/assets/agents/*.md frontmatter skills: block lists devflow:compliance', async () => {
    const agentsPath = path.join(ASSETS_DIR, 'agents');
    const agentFiles = await fs.readdir(agentsPath);

    for (const file of agentFiles.filter(f => f.endsWith('.md'))) {
      const agentName = path.basename(file, '.md');
      const content = await fs.readFile(path.join(agentsPath, file), 'utf-8');

      // Parse only the YAML frontmatter block (between first --- markers), not body text
      const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
      if (!fmMatch) continue;

      const fmLines = fmMatch[1].split('\n');
      let inSkills = false;
      const skillItems: string[] = [];
      for (const line of fmLines) {
        if (/^skills:/.test(line)) { inSkills = true; continue; }
        // A non-indented non-empty line ends the skills block (new top-level YAML key)
        if (inSkills && /^\S/.test(line)) inSkills = false;
        if (inSkills) {
          const m = line.match(/^\s*-\s+(.+)$/);
          if (m) skillItems.push(m[1].trim());
        }
      }

      expect(
        skillItems,
        `src/assets/agents/${agentName}.md frontmatter skills: must not list devflow:compliance — ` +
          `use body-instruction only (avoids PF-002: skill re-entrancy silent bail)`,
      ).not.toContain('devflow:compliance');
    }
  });
});

// ---------------------------------------------------------------------------
// devflow-dynamic declared commands ↔ src/assets/commands/*.mds source parity
//
// Ties the 5 command names declared in DEVFLOW_PLUGINS to the 5 dynamic-*.mds
// host files in src/assets/commands/ whose basename starts with 'dynamic-'.
// In the restructured layout all hosts output to dist/commands/ (single target),
// so the dynamic hosts are identified by name prefix, not by output-dir content.
//
// Deriving from source (not from compiled output) means this test passes even
// on a clean checkout before build:mds has run — the only reliable contract
// (applies ADR-019).
//
// A dynamic host rename (e.g. dynamic-wave.mds → dynamic-orchestrate.mds)
// without updating plugins.ts would fail this test, surfacing the drift before
// it ships.
// ---------------------------------------------------------------------------

describe('devflow-dynamic declared commands ↔ src/assets/commands/ source parity', () => {
  it('declared command names match dynamic-host .mds files in src/assets/commands/ (1:1)', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin, 'devflow-dynamic must be registered in DEVFLOW_PLUGINS').toBeDefined();

    // Derive expected command names from .mds files whose basename starts with 'dynamic-'
    const entries = await fs.readdir(COMMANDS_DIR, { withFileTypes: true });
    const dynamicSourceNames = entries
      .filter(e => e.isFile() && e.name.endsWith('.mds') && e.name.startsWith('dynamic-'))
      .map(e => '/' + path.basename(e.name, '.mds'))
      .sort();

    const declaredCommands = [...dynPlugin!.commands].sort();

    expect(
      declaredCommands,
      `devflow-dynamic declared commands must match dynamic-host sources 1:1.\n` +
      `  declared:  ${declaredCommands.join(', ')}\n` +
      `  from src:  ${dynamicSourceNames.join(', ')}`,
    ).toEqual(dynamicSourceNames);
  });

  it('every declared devflow-dynamic command has a corresponding .mds source file in src/assets/commands/', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin).toBeDefined();

    for (const cmd of dynPlugin!.commands) {
      const sourceName = cmd.replace(/^\//, '') + '.mds';
      const sourcePath = path.join(COMMANDS_DIR, sourceName);
      await expect(
        fs.access(sourcePath),
        `Command '${cmd}' declared in DEVFLOW_PLUGINS has no source at src/assets/commands/${sourceName}`,
      ).resolves.toBeUndefined();
    }
  });

  it('every dynamic-host .mds in src/assets/commands/ is declared as a devflow-dynamic command', async () => {
    const dynPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-dynamic');
    expect(dynPlugin).toBeDefined();

    const declaredSet = new Set(dynPlugin!.commands);
    const entries = await fs.readdir(COMMANDS_DIR, { withFileTypes: true });

    for (const e of entries.filter(e => e.isFile() && e.name.endsWith('.mds') && e.name.startsWith('dynamic-'))) {
      const expectedCmd = '/' + path.basename(e.name, '.mds');
      expect(
        declaredSet.has(expectedCmd),
        `src/assets/commands/${e.name} is a dynamic host but '${expectedCmd}' is not declared in DEVFLOW_PLUGINS. Add it to devflow-dynamic.commands in src/core/plugins.ts`,
      ).toBe(true);
    }
  });
});
