/**
 * Registry integrity guards.
 *
 * Guard 1 (forward): every skill/agent/rule declared in DEVFLOW_PLUGINS exists on disk
 *   in src/assets/{skills,agents,rules}/.
 * Guard 2 (reverse/orphan): every file in src/assets/{skills,agents,rules}/ is claimed
 *   by at least one plugin in DEVFLOW_PLUGINS.
 *
 * Guard 4 (commands forward/reverse): every declared command has a source file in
 *   src/assets/commands/; every host source is declared in DEVFLOW_PLUGINS.
 *   Dist check skipped when dist/commands/ is absent.
 *
 * Guard 5 (build-gated, spawn accuracy): every subagent_type spawned in a compiled
 *   dist/commands/ file is declared in the owning plugin's agents array, AND every
 *   declared agent is actually spawned in at least one of the plugin's compiled commands
 *   (bidirectional; skips commands that use no subagent_type syntax).
 *   Skipped entirely when dist/commands/ is absent.
 *
 * These guards replace the plugin.json manifest checks that were removed in the
 * src/ restructure. The DEVFLOW_PLUGINS registry in src/core/plugins.ts is now the
 * sole source of truth for asset membership.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames, getAllCommandNames } from '../src/core/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'src', 'assets');

// ---------------------------------------------------------------------------
// Guard 1: Forward — registry → disk
// ---------------------------------------------------------------------------

describe('Guard 1 (forward): every declared asset exists on disk', () => {
  it('every skill in DEVFLOW_PLUGINS exists as src/assets/skills/{name}/SKILL.md', async () => {
    const allSkills = getAllSkillNames();

    for (const skill of allSkills) {
      const skillMd = path.join(ASSETS_DIR, 'skills', skill, 'SKILL.md');
      await expect(
        fs.access(skillMd),
        `Skill '${skill}' is declared in DEVFLOW_PLUGINS but src/assets/skills/${skill}/SKILL.md does not exist`,
      ).resolves.toBeUndefined();
    }
  });

  it('every agent in DEVFLOW_PLUGINS exists as src/assets/agents/{name}.md', async () => {
    const allAgents = getAllAgentNames();

    for (const agent of allAgents) {
      const agentFile = path.join(ASSETS_DIR, 'agents', `${agent}.md`);
      await expect(
        fs.access(agentFile),
        `Agent '${agent}' is declared in DEVFLOW_PLUGINS but src/assets/agents/${agent}.md does not exist`,
      ).resolves.toBeUndefined();
    }
  });

  it('every rule in DEVFLOW_PLUGINS exists as src/assets/rules/{name}.md', async () => {
    const allRules = getAllRuleNames();

    for (const rule of allRules) {
      const ruleFile = path.join(ASSETS_DIR, 'rules', `${rule}.md`);
      await expect(
        fs.access(ruleFile),
        `Rule '${rule}' is declared in DEVFLOW_PLUGINS but src/assets/rules/${rule}.md does not exist`,
      ).resolves.toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 2: Reverse/orphan — disk → registry
// ---------------------------------------------------------------------------

describe('Guard 2 (reverse/orphan): every on-disk asset is claimed by a plugin', () => {
  it('every dir in src/assets/skills/ is declared in DEVFLOW_PLUGINS', async () => {
    const referencedSkills = new Set(getAllSkillNames());
    const skillDirs = await fs.readdir(path.join(ASSETS_DIR, 'skills'));

    const orphans = skillDirs.filter(dir => !referencedSkills.has(dir));

    expect(
      orphans,
      `Orphaned skill dirs in src/assets/skills/ are not declared in DEVFLOW_PLUGINS:\n  ${orphans.join('\n  ')}\nAdd them to a plugin in src/core/plugins.ts.`,
    ).toHaveLength(0);
  });

  it('every file in src/assets/agents/ is declared in DEVFLOW_PLUGINS', async () => {
    const referencedAgents = new Set(getAllAgentNames());
    const agentFiles = await fs.readdir(path.join(ASSETS_DIR, 'agents'));

    const orphans = agentFiles
      .filter(f => f.endsWith('.md'))
      .map(f => path.basename(f, '.md'))
      .filter(name => !referencedAgents.has(name));

    expect(
      orphans,
      `Orphaned agent files in src/assets/agents/ are not declared in DEVFLOW_PLUGINS:\n  ${orphans.join('\n  ')}\nAdd them to a plugin in src/core/plugins.ts.`,
    ).toHaveLength(0);
  });

  it('every file in src/assets/rules/ is declared in DEVFLOW_PLUGINS', async () => {
    const referencedRules = new Set(getAllRuleNames());
    const ruleFiles = await fs.readdir(path.join(ASSETS_DIR, 'rules'));

    const orphans = ruleFiles
      .filter(f => f.endsWith('.md'))
      .map(f => path.basename(f, '.md'))
      .filter(name => !referencedRules.has(name));

    expect(
      orphans,
      `Orphaned rule files in src/assets/rules/ are not declared in DEVFLOW_PLUGINS:\n  ${orphans.join('\n  ')}\nAdd them to a plugin in src/core/plugins.ts.`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Guard 3: Intra-plugin duplicates and rule ownership
// ---------------------------------------------------------------------------
//
// Skills and agents are intentionally shared across plugins — e.g. `git` is
// used by plan, implement, resolve, and others; `apply-feature-knowledge` is
// used by several plugins. getAllSkillNames() / getAllAgentNames() deduplicate
// via Set internally. Guard 3 therefore checks two things:
//
//   (a) No plugin declares the same asset twice within its own list (accidental
//       in-plugin duplicate that would be a copy-paste error).
//   (b) Rules are plugin-scoped and MUST be unique across plugins — each rule
//       is owned and installed by exactly one plugin.

describe('Guard 3 (intra-plugin duplicates + rule ownership)', () => {
  it('no plugin declares the same skill twice in its own list', () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      const seen = new Set<string>();
      for (const skill of plugin.skills) {
        expect(
          seen.has(skill),
          `Plugin '${plugin.name}' declares skill '${skill}' more than once in its skills list.`,
        ).toBe(false);
        seen.add(skill);
      }
    }
  });

  it('no plugin declares the same agent twice in its own list', () => {
    for (const plugin of DEVFLOW_PLUGINS) {
      const seen = new Set<string>();
      for (const agent of plugin.agents) {
        expect(
          seen.has(agent),
          `Plugin '${plugin.name}' declares agent '${agent}' more than once in its agents list.`,
        ).toBe(false);
        seen.add(agent);
      }
    }
  });

  it('each rule is declared by exactly one plugin (rules are plugin-scoped)', () => {
    const seen = new Map<string, string>(); // rule → first plugin

    for (const plugin of DEVFLOW_PLUGINS) {
      for (const rule of plugin.rules) {
        if (seen.has(rule)) {
          expect.unreachable(
            `Rule '${rule}' is declared by both '${seen.get(rule)}' and '${plugin.name}'. ` +
            `Rules are plugin-scoped and must belong to exactly one plugin.`,
          );
        }
        seen.set(rule, plugin.name);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Guard 4: Command source integrity — declared ↔ src/assets/commands/ sources
// ---------------------------------------------------------------------------

describe('Guard 4 (command integrity): declared commands ↔ source files', () => {
  const commandsSrcDir = path.join(ROOT, 'src', 'assets', 'commands');
  const distCommandsDir = path.join(ROOT, 'dist', 'commands');

  it('every declared command has a source file in src/assets/commands/', async () => {
    const declaredCommands = getAllCommandNames();

    for (const name of declaredCommands) {
      const mdsPath = path.join(commandsSrcDir, `${name}.mds`);
      const mdPath = path.join(commandsSrcDir, `${name}.md`);
      const mdsExists = await fs.access(mdsPath).then(() => true).catch(() => false);
      const mdExists = await fs.access(mdPath).then(() => true).catch(() => false);
      expect(
        mdsExists || mdExists,
        `Command '${name}' declared in DEVFLOW_PLUGINS has no source file in src/assets/commands/ (.mds or .md)`,
      ).toBe(true);
    }
  });

  it('every host source in src/assets/commands/ is declared in DEVFLOW_PLUGINS', async () => {
    const allFiles = await fs.readdir(commandsSrcDir);
    // Host sources: non-partial (.mds or .md) files — partials start with _ or live in _partials/
    const hostSources = allFiles
      .filter(f => !f.startsWith('_') && (f.endsWith('.mds') || f.endsWith('.md')))
      .map(f => f.replace(/\.(mds|md)$/, ''));

    const declaredSet = new Set(getAllCommandNames());
    const orphans = hostSources.filter(name => !declaredSet.has(name));

    expect(
      orphans,
      `Orphaned command source files in src/assets/commands/ not declared in DEVFLOW_PLUGINS:\n  ${orphans.join('\n  ')}\nAdd them to a plugin commands[] in src/core/plugins.ts.`,
    ).toHaveLength(0);
  });

  it('compiled dist/commands/ matches declared commands (skipped when dist absent)', async () => {
    const distExists = await fs.access(distCommandsDir).then(() => true).catch(() => false);
    if (!distExists) return; // not a failure — dist may not be built yet

    const distFiles = await fs.readdir(distCommandsDir);
    const compiledNames = distFiles.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
    const declaredSet = new Set(getAllCommandNames());

    const orphanDist = compiledNames.filter(name => !declaredSet.has(name));
    expect(
      orphanDist,
      `Compiled dist/commands/ files not declared in DEVFLOW_PLUGINS:\n  ${orphanDist.join('\n  ')}`,
    ).toHaveLength(0);

    const missingCompiled = [...declaredSet].filter(name => !compiledNames.includes(name));
    expect(
      missingCompiled,
      `Declared commands missing from dist/commands/ (run npm run build:mds):\n  ${missingCompiled.join('\n  ')}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Guard 5: Build-gated spawn accuracy — subagent_type ↔ plugin agents arrays
// ---------------------------------------------------------------------------
//
// For each plugin that has compiled commands (dist/commands/{name}.md):
//   Forward:  every subagent_type="X" spawned in a compiled command is declared in
//             the owning plugin's agents array.
//   Reverse:  every agent declared in the plugin's agents array is spawned (with
//             subagent_type syntax) in at least one of the plugin's compiled commands.
//
// Commands that contain NO subagent_type pattern at all are skipped from both
// checks (they use a different spawn syntax, e.g. agentType in dynamic-*).
//
// Built-in Explore agent (not a registered agent file) is excluded from both checks.
// Skipped entirely when dist/commands/ is absent.

describe('Guard 5 (build-gated): spawned agents ↔ plugin agent declarations', () => {
  const distCommandsDir = path.join(ROOT, 'dist', 'commands');

  // Matches both Agent(subagent_type="Name") and subagent_type: "Name" syntax.
  const SPAWN_RE = /subagent_type[=:]\s*"([^"]+)"/gi;

  // Built-in agent not backed by a src/assets/agents/ file — excluded from all checks.
  const EXCLUDED_AGENTS_NORMALIZED = new Set(['explore']);

  /**
   * Normalize an agent name for comparison across naming conventions:
   *   - Registry uses filenames:   bug-analyzer, claude-md-auditor
   *   - subagent_type uses frontmatter name field: BugAnalyzer, claude-md-auditor
   * Strip hyphens and lowercase so both representations collapse to the same key.
   */
  const normalize = (name: string) => name.replace(/-/g, '').toLowerCase();

  it('spawned subagent_types are declared, and declared agents are spawned (skipped when dist absent)', async () => {
    const distExists = await fs.access(distCommandsDir).then(() => true).catch(() => false);
    if (!distExists) return; // not a failure — dist may not be built

    // Build: command name → owning plugin
    const commandOwner = new Map<string, typeof DEVFLOW_PLUGINS[number]>();
    for (const plugin of DEVFLOW_PLUGINS) {
      for (const cmd of plugin.commands) {
        const name = cmd.replace(/^\//, '');
        commandOwner.set(name, plugin);
      }
    }

    const violations: string[] = [];

    for (const [cmdName, plugin] of commandOwner) {
      const filePath = path.join(distCommandsDir, `${cmdName}.md`);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue; // dist file absent — Guard 4 dist-check catches this
      }

      // Collect all spawned agent names (normalized, deduplicated)
      const spawned = new Set<string>();
      for (const m of content.matchAll(SPAWN_RE)) {
        const norm = normalize(m[1]);
        if (!EXCLUDED_AGENTS_NORMALIZED.has(norm)) spawned.add(norm);
      }

      // If the command uses no subagent_type syntax at all, skip both checks
      // (it uses a different spawn mechanism, e.g. agentType in dynamic-* commands)
      if (spawned.size === 0) continue;

      const declaredAgents = new Set(plugin.agents.map(normalize));

      // Forward: spawned → declared
      for (const agentNorm of spawned) {
        if (!declaredAgents.has(agentNorm)) {
          violations.push(
            `${cmdName}.md spawns '${agentNorm}' but '${plugin.name}'.agents does not declare it`,
          );
        }
      }

      // Reverse: declared → spawned (only when the command uses subagent_type syntax)
      for (const agentNorm of declaredAgents) {
        if (!spawned.has(agentNorm)) {
          violations.push(
            `'${plugin.name}'.agents declares '${agentNorm}' but ${cmdName}.md never spawns it via subagent_type`,
          );
        }
      }
    }

    expect(
      violations,
      `Agent spawn mismatches (fix agents[] in src/core/plugins.ts):\n  ${violations.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
