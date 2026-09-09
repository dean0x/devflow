import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames } from '../src/core/plugins.js';
import { resolveAgentSource, resolveAllAgents } from './helpers.js';

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
      // Dist-first with a src fallback: a generated agent lives in dist/agents/,
      // a hand-authored one in src/assets/agents/. The resolver throws loudly
      // when neither location has it.
      const agentFile = resolveAgentSource(agent).path;
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
  // See D9 in .devflow/learning/decisions.md for rationale.

  it('all skills in src/assets/skills/ are referenced by at least one plugin', async () => {
    const skillDirs = await fs.readdir(path.join(ASSETS_DIR, 'skills'));
    // Union FEATURE_OWNED: compliance asset stays but is feature-managed (step 1.5)
    // Independent literal — not imported from FEATURE_OWNED_SKILLS (avoids oracle trap).
    const referencedSkills = new Set([...getAllSkillNames(), 'compliance']);

    for (const dir of skillDirs) {
      expect(referencedSkills.has(dir), `src/assets/skills/${dir} is not referenced by any plugin`).toBe(true);
    }
  });

  it('all agents in src/assets/agents/ are referenced by at least one plugin', async () => {
    const agentFiles = await fs.readdir(path.join(ASSETS_DIR, 'agents'));
    const referencedAgents = new Set(getAllAgentNames());

    for (const file of agentFiles) {
      // Both extensions declare an agent: `.md` is hand-authored, `.mds` is an
      // MDS generator host compiled into dist/agents/. Stripping only `.md`
      // would let a generator host slip past the orphan check unnoticed.
      const name = file.replace(/\.mds?$/, '');
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
  /**
   * Named collector: the frontmatter `skills:` list of each agent, keyed by agent name.
   * Called by the guard AND by both probes below, so a probe can never pass by
   * re-implementing the parser it is meant to prove (ADR-024).
   */
  function collectFrontmatterSkills(
    sources: ReadonlyMap<string, { content: string }>,
  ): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [name, { content }] of sources) {
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
      result.set(name, skillItems);
    }
    return result;
  }

  it('no agent frontmatter skills: block lists devflow:compliance', () => {
    // Resolved through the dist-preferred resolver so an agent compiled from an
    // .mds generator host is scanned in its shipping form. A readdir filtered to
    // `.md` inside src/assets/agents/ leaves 15 of 16 agents covered while `git`
    // silently drops out (GAP-07) — the assertion below is what makes that loud.
    const agents = resolveAllAgents();
    expect([...agents.keys()]).toEqual(expect.arrayContaining(getAllAgentNames()));

    const skillsByAgent = collectFrontmatterSkills(agents);
    expect(
      [...skillsByAgent.keys()],
      'every registered agent must have had its frontmatter parsed (non-vacuity, PF-018)',
    ).toEqual(expect.arrayContaining(getAllAgentNames()));

    for (const [name, skillItems] of skillsByAgent) {
      expect(
        skillItems,
        `${name}: frontmatter skills: must not list devflow:compliance — ` +
          `use body-instruction only (avoids PF-002: skill re-entrancy silent bail)`,
      ).not.toContain('devflow:compliance');
    }
  });

  it('known-bad probe: a frontmatter block listing devflow:compliance is flagged', () => {
    // Mechanic 2 (H10): synthetic source, no committed file touched.
    const synthetic = new Map([
      ['synthetic', { content: '---\nname: Synthetic\nskills:\n  - devflow:git\n  - devflow:compliance\n---\n\nBody.\n' }],
    ]);
    expect(collectFrontmatterSkills(synthetic).get('synthetic')).toContain('devflow:compliance');
  });

  it("known-bad probe: an .md-only readdir of the agents dir loses the git agent (GAP-07)", async () => {
    // The pre-repoint corpus builder, run against the real directory. It must be
    // strictly weaker than resolveAllAgents() — this is the silent-degradation case.
    const entries = await fs.readdir(path.join(ASSETS_DIR, 'agents'));
    const mdOnly = entries.filter(f => f.endsWith('.md')).map(f => path.basename(f, '.md'));
    expect([...resolveAllAgents().keys()]).toContain('git');
    expect(mdOnly, 'an .md-only filter is the vacuous corpus this guard no longer uses').not.toContain('git');
  });
});

// ---------------------------------------------------------------------------
// devflow-dynamic declared commands ↔ src/assets/commands/*.mds source parity
//
// Ties the 4 command names declared in DEVFLOW_PLUGINS to the 4 dynamic-*.mds
// host files in src/assets/commands/ whose basename starts with 'dynamic-'.
// In the restructured layout all hosts output to dist/commands/ (single target),
// so the dynamic hosts are identified by name prefix, not by output-dir content.
//
// Deriving from source (not from compiled output) means this test passes even
// on a clean checkout before build:mds has run — the only reliable contract
// (applies ADR-019).
//
// A dynamic host rename (e.g. dynamic-plan.mds → dynamic-orchestrate.mds)
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
