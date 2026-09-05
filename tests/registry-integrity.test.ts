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
 *   Fails LOUD when dist/commands/ is absent (was previously a silent skip).
 *
 * These guards replace the plugin.json manifest checks that were removed in the
 * src/ restructure. The DEVFLOW_PLUGINS registry in src/core/plugins.ts is now the
 * sole source of truth for asset membership.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames, getAllCommandNames } from '../src/core/plugins.js';
import { resolveAgentSource } from './helpers.js';

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

  it('every agent in DEVFLOW_PLUGINS is resolvable (dist-preferred, src-fallback)', () => {
    // Routed through resolveAgentSource so Phase 1 needs zero test edits when
    // git.md becomes git.mds and is served from dist/agents/ instead (AC-0.7).
    const allAgents = getAllAgentNames();

    for (const agent of allAgents) {
      expect(
        () => resolveAgentSource(agent),
        `Agent '${agent}' is declared in DEVFLOW_PLUGINS but could not be resolved from dist/agents/ or src/assets/agents/`,
      ).not.toThrow();
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
    // Union FEATURE_OWNED skills — compliance asset stays in src/assets/skills/ but is
    // managed by the feature system, not any plugin (step 1.5 de-registration).
    // Independent literal per EXCLUDED-as-oracle trap (avoids PF-018 pattern).
    const referencedSkills = new Set([...getAllSkillNames(), 'compliance']);
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
    // Union FEATURE_OWNED rules — compliance rule stays in src/assets/rules/ but is
    // managed by the feature system, not any plugin (step 1.5 de-registration).
    // Independent literal per EXCLUDED-as-oracle trap (avoids PF-018 pattern).
    const referencedRules = new Set([...getAllRuleNames(), 'compliance']);
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
// Fails LOUD when dist/commands/ is absent — a silent skip is not a guard.

describe('Guard 5 (build-gated): spawned agents ↔ plugin agent declarations', () => {
  const distCommandsDir = path.join(ROOT, 'dist', 'commands');

  // Matches both Agent(subagent_type="Name") and subagent_type: "Name" syntax.
  const SPAWN_RE = /subagent_type[=:]\s*"([^"]+)"/gi;

  // Also matches agentType: "Name" (used by dynamic-* Workflow commands).
  // Harvesting this signal lets Guard 5 verify dynamic plugin agents without a blanket exemption.
  const AGENT_TYPE_RE = /agentType:\s*"([^"]+)"/gi;

  // Built-in agent not backed by a src/assets/agents/ file — excluded from all checks.
  const EXCLUDED_AGENTS_NORMALIZED = new Set(['explore']);

  /**
   * Normalize an agent name for comparison across naming conventions:
   *   - Registry uses filenames:   diagnose, code
   *   - subagent_type uses frontmatter name field: Diagnose, Code
   * Strip hyphens and lowercase so both representations collapse to the same key.
   */
  const normalize = (name: string) => name.replace(/-/g, '').toLowerCase();

  it('spawned subagent_types are declared, and declared agents are spawned (fail-loud when dist absent)', async () => {
    const distExists = await fs.access(distCommandsDir).then(() => true).catch(() => false);
    // FAIL-LOUD: a guard that silently skips on a missing build artifact is not a guard.
    // This was previously a silent `return` — now it fails visibly so the developer knows to build.
    expect(
      distExists,
      'dist/commands/ is absent — run `npm run build` first (Guard 5 cannot verify without compiled files)',
    ).toBe(true);

    // Build: command name → owning plugin
    const commandOwner = new Map<string, typeof DEVFLOW_PLUGINS[number]>();
    for (const plugin of DEVFLOW_PLUGINS) {
      for (const cmd of plugin.commands) {
        const name = cmd.replace(/^\//, '');
        commandOwner.set(name, plugin);
      }
    }

    const violations: string[] = [];

    // Aggregates spawned agents per plugin across ALL its commands.
    // Used by the reverse check so a declared agent only needs to appear
    // in at least one of the plugin's commands — not every command.
    const pluginAggregateSpawned = new Map<string, Set<string>>();

    for (const [cmdName, plugin] of commandOwner) {
      const filePath = path.join(distCommandsDir, `${cmdName}.md`);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue; // dist file absent — Guard 4 dist-check catches this
      }

      // Collect all spawned agent names (normalized, deduplicated).
      // Harvest both subagent_type= / subagent_type: AND agentType: so that dynamic-*
      // Workflow commands (which use agentType) are covered without a blanket exemption.
      const spawned = new Set<string>();
      for (const m of content.matchAll(SPAWN_RE)) {
        const norm = normalize(m[1]);
        if (!EXCLUDED_AGENTS_NORMALIZED.has(norm)) spawned.add(norm);
      }
      for (const m of content.matchAll(AGENT_TYPE_RE)) {
        const norm = normalize(m[1]);
        if (!EXCLUDED_AGENTS_NORMALIZED.has(norm)) spawned.add(norm);
      }

      // If the command uses no known spawn syntax at all, skip both checks.
      if (spawned.size === 0) continue;

      const declaredAgents = new Set(plugin.agents.map(normalize));

      // Forward: spawned → declared (per-command)
      for (const agentNorm of spawned) {
        if (!declaredAgents.has(agentNorm)) {
          violations.push(
            `${cmdName}.md spawns '${agentNorm}' but '${plugin.name}'.agents does not declare it`,
          );
        }
      }

      // Accumulate per-plugin for the post-loop reverse check.
      const aggregate = pluginAggregateSpawned.get(plugin.name) ?? new Set<string>();
      for (const agentNorm of spawned) aggregate.add(agentNorm);
      pluginAggregateSpawned.set(plugin.name, aggregate);
    }

    // Reverse: declared → spawned (per-plugin aggregate).
    // Checks that each declared agent is spawned in AT LEAST ONE of the plugin's
    // compiled commands — not necessarily every command.
    // Both subagent_type and agentType are now harvested, so dynamic-* agents that use
    // agentType (Workflow runtime) are covered without a blanket plugin exemption.
    for (const plugin of DEVFLOW_PLUGINS) {
      const aggregate = pluginAggregateSpawned.get(plugin.name);
      if (aggregate === undefined) continue; // no known spawn syntax in any command — skip

      const declaredAgents = new Set(plugin.agents.map(normalize));
      for (const agentNorm of declaredAgents) {
        if (!aggregate.has(agentNorm)) {
          violations.push(
            `'${plugin.name}'.agents declares '${agentNorm}' but none of its compiled commands spawn it via subagent_type`,
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

// ---------------------------------------------------------------------------
// Guard 6: Build-gated operation contract — OPERATION: values in Git-agent
//   spawn blocks ↔ ## Operation: headings in git.md
//
// Forward:  every OPERATION: X inside a Git-agent spawn block in a compiled
//           command is declared as `## Operation: X` in git.md.
// Reverse:  every `## Operation: X` in git.md is referenced by name in at
//           least one compiled command, OR is listed in INTERNAL_OPS.
//
// INTERNAL_OPS: operations that are invoked by other git.md operations rather
// than directly from a compiled command. Each entry must have a comment
// explaining why it is exempt from the reverse caller check.
// ---------------------------------------------------------------------------

describe('Guard 6 (build-gated): OPERATION: values ↔ git.md ## Operation: declarations', () => {
  const distCommandsDir = path.join(ROOT, 'dist', 'commands');
  // Dist-preferred resolver — zero test edits needed in Phase 1 when git.md → git.mds (AC-0.7)
  const gitAgentPath = resolveAgentSource('git').path;

  // Operations that are not directly invoked from compiled commands.
  // Each entry must have a comment explaining the exemption.
  const INTERNAL_OPS = new Set([
    // Invoked by setup-task step 1b when .devflow/conventions.md is absent — internal
    // to the Git agent; no compiled command calls it directly.
    'learn-conventions',
    // SG-11: fetch-issues-batch is now wired live from plan.mds Gate 0 (multi-issue path) —
    // it is no longer internal-only. Removed from INTERNAL_OPS; added to REQUIRED_OPS in
    // git-agent.test.ts (AC-0.11).
  ]);

  it('spawned OPERATION: values match git.md declarations (fail-loud when dist absent)', async () => {
    const distExists = await fs.access(distCommandsDir).then(() => true).catch(() => false);
    // FAIL-LOUD: a guard that silently skips on a missing build artifact is not a guard.
    expect(
      distExists,
      'dist/commands/ is absent — run `npm run build:mds` first (Guard 6 cannot verify without compiled files)',
    ).toBe(true);

    // --- Parse declared operations from git.md ---
    const gitContent = await fs.readFile(gitAgentPath, 'utf-8');
    const declaredOps = new Set<string>();
    for (const m of gitContent.matchAll(/^## Operation: (\S+)/gm)) {
      declaredOps.add(m[1]);
    }
    expect(
      declaredOps.size,
      'git.md must declare at least one ## Operation: heading — is the file empty or renamed?',
    ).toBeGreaterThan(0);

    // --- Scan compiled commands ---
    const distFiles = await fs.readdir(distCommandsDir);
    const violations: string[] = [];

    // Forward check state: ops seen in Git-agent spawn blocks across all compiled commands.
    const calledOpsInGitBlocks = new Set<string>();

    // Reverse check state: op names found anywhere in compiled command content.
    // This catches both OPERATION: block calls and prose references (e.g. "spawn Git with
    // `gather-release-evidence` operation"). Operations that genuinely have NO reference
    // in any compiled command must be in INTERNAL_OPS.
    const opNameFoundInAnyFile = new Map<string, boolean>();
    for (const op of declaredOps) opNameFoundInAnyFile.set(op, false);

    for (const file of distFiles.filter(f => f.endsWith('.md'))) {
      const content = await fs.readFile(path.join(distCommandsDir, file), 'utf-8');

      // Reverse check: mark any declared op whose name appears anywhere in this file.
      for (const op of declaredOps) {
        if (content.includes(op)) opNameFoundInAnyFile.set(op, true);
      }

      // Forward check: scan code fence blocks for Git-agent spawns.
      // A fence is a Git-agent block if it contains Agent(subagent_type="Git") or agentType: "Git".
      const fencePattern = /```[^\n]*\n([\s\S]*?)```/g;
      let match;
      while ((match = fencePattern.exec(content)) !== null) {
        const block = match[0];
        const isGitBlock =
          /Agent\(subagent_type="Git"/.test(block) ||
          /agentType:\s*"Git"/.test(block);
        if (!isGitBlock) continue;

        // Parse OPERATION: lines (at start of line within the fence).
        for (const opMatch of block.matchAll(/^OPERATION: (\S+)/gm)) {
          const opName = opMatch[1];
          calledOpsInGitBlocks.add(opName);
          if (!declaredOps.has(opName)) {
            violations.push(
              `${file}: Git-agent spawn calls OPERATION: ${opName} but git.md has no ## Operation: ${opName} heading`,
            );
          }
        }
      }
    }

    // Reverse check: every declared op must be referenced in at least one compiled
    // command (by name, in any context) or be explicitly internal.
    for (const op of declaredOps) {
      if (!opNameFoundInAnyFile.get(op) && !INTERNAL_OPS.has(op)) {
        violations.push(
          `git.md declares ## Operation: ${op} but no compiled command references it ` +
          `(add to INTERNAL_OPS if this op is invoked internally by another git.md operation)`,
        );
      }
    }

    expect(
      violations,
      `Operation contract violations (fix src/assets/agents/git.md or caller commands):\n  ${violations.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
