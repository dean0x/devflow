/**
 * Registry integrity guards.
 *
 * Guard 1 (forward): every skill/agent/rule declared in DEVFLOW_PLUGINS exists on disk
 *   in src/assets/{skills,agents,rules}/.
 * Guard 2 (reverse/orphan): every file in src/assets/{skills,agents,rules}/ is claimed
 *   by at least one plugin in DEVFLOW_PLUGINS (with a known exception list for
 *   format-spec skills that are consumed by background processes, not plugin agents).
 *
 * These guards replace the plugin.json manifest checks that were removed in the
 * src/ restructure. The DEVFLOW_PLUGINS registry in src/core/plugins.ts is now the
 * sole source of truth for asset membership.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEVFLOW_PLUGINS, getAllSkillNames, getAllAgentNames, getAllRuleNames } from '../src/core/plugins.js';

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

/**
 * Skills that intentionally live in src/assets/skills/ but are not distributed
 * through any plugin. These are format specifications consumed by background
 * processes (the Learning agent), not by agents or commands.
 * See D9 in .devflow/learning/decisions.md for rationale.
 */
const FORMAT_SPEC_SKILLS = new Set(['decisions-format']);

describe('Guard 2 (reverse/orphan): every on-disk asset is claimed by a plugin', () => {
  it('every dir in src/assets/skills/ is declared in DEVFLOW_PLUGINS (or is a known format-spec)', async () => {
    const referencedSkills = new Set(getAllSkillNames());
    const skillDirs = await fs.readdir(path.join(ASSETS_DIR, 'skills'));

    const orphans = skillDirs.filter(
      dir => !referencedSkills.has(dir) && !FORMAT_SPEC_SKILLS.has(dir),
    );

    expect(
      orphans,
      `Orphaned skill dirs in src/assets/skills/ are not declared in DEVFLOW_PLUGINS:\n  ${orphans.join('\n  ')}\nAdd them to a plugin in src/core/plugins.ts or to FORMAT_SPEC_SKILLS if intentionally undistributed.`,
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
