/**
 * install-backup-sets: the retired set, the shipped set and the lists that feed them.
 *
 * What it asserts
 * ---------------
 * 1. Retired names (`RETIRED_SHIPPED`): the literal is frozen, every name of a legacy list is in
 *    it or is shipped today, and every released name that the registries no longer ship is in it.
 * 2. `retiredPathSet()` maps the lists to Claude-dir relative paths: files only, and a skill
 *    folder of `skills` stays out because the install moves it whole.
 *
 * What a green run does NOT prove
 * -------------------------------
 * The released-name fixture is the audit result at version 3.9.0. A name that a later release
 * shipped is covered only when its PR adds it to `tests/fixtures/released-shipped-names.ts`.
 */

import { describe, it, expect } from 'vitest';

import { LEGACY_AGENT_KEYS } from '../../src/core/agent-models.js';
import { RETIRED_SHIPPED, retiredPathSet } from '../../src/core/retired-shipped-names.js';
import {
  FEATURE_OWNED_RULES,
  FEATURE_OWNED_SKILLS,
  LEGACY_COMMAND_NAMES,
  LEGACY_RULE_NAMES,
  getAllAgentNames,
  getAllCommandNames,
  getAllRuleNames,
  getAllSkillNames,
  prefixSkillName,
} from '../../src/core/plugins.js';
import { LEGACY_SKILL_NAMES } from '../../src/targets/claude-code/legacy.js';
import { RELEASED_SHIPPED_NAMES } from '../fixtures/released-shipped-names.js';

/** The names the registries ship today, by kind. Commands, agents and rules have no `.md`. */
function shippedToday(): {
  readonly commands: ReadonlySet<string>;
  readonly agents: ReadonlySet<string>;
  readonly rules: ReadonlySet<string>;
  readonly skills: ReadonlySet<string>;
} {
  return {
    commands: new Set(getAllCommandNames(new Set())),
    agents: new Set(getAllAgentNames()),
    rules: new Set([...getAllRuleNames(), ...FEATURE_OWNED_RULES]),
    skills: new Set([...getAllSkillNames(new Set()), ...FEATURE_OWNED_SKILLS].map(prefixSkillName)),
  };
}

/** Names that are in neither list, with the fix to apply. */
function unlisted(kind: string, names: Iterable<string>, retired: readonly string[], shipped: ReadonlySet<string>): string[] {
  const inRetired = new Set(retired);
  return [...names]
    .filter(name => !inRetired.has(name) && !shipped.has(name))
    .map(name => `${kind} "${name}" is in a legacy list but is neither in RETIRED_SHIPPED nor shipped today: add it to src/core/retired-shipped-names.ts`);
}

const isFrozenDeep = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isFrozenDeep);
};

describe('RETIRED_SHIPPED', () => {
  it('is frozen all the way down', () => {
    expect(isFrozenDeep(RETIRED_SHIPPED)).toBe(true);
  });

  it('holds each name once per kind', () => {
    for (const [kind, names] of Object.entries(RETIRED_SHIPPED)) {
      if (kind === 'skillFiles') continue;
      const list = names as readonly string[];
      expect(new Set(list).size, `${kind} lists a name twice`).toBe(list.length);
    }
  });

  it('keeps only files of skill folders that exist today in skillFiles', () => {
    const skillsToday = shippedToday().skills;
    expect(Object.keys(RETIRED_SHIPPED.skillFiles).sort()).toEqual(['devflow:agent-references', 'devflow:git']);
    for (const folder of Object.keys(RETIRED_SHIPPED.skillFiles)) {
      expect(skillsToday.has(folder), `${folder} is not a skill folder shipped today`).toBe(true);
    }
  });
});

describe('legacy lists are covered', () => {
  it('every LEGACY_COMMAND_NAMES entry is retired or shipped today', () => {
    const missing = unlisted('command', LEGACY_COMMAND_NAMES, RETIRED_SHIPPED.commands, shippedToday().commands);
    expect(missing).toEqual([]);
  });

  it('every LEGACY_AGENT_KEYS file name is retired or shipped today', () => {
    const missing = unlisted('agent', Object.keys(LEGACY_AGENT_KEYS), RETIRED_SHIPPED.agents, shippedToday().agents);
    expect(missing).toEqual([]);
  });

  it('every LEGACY_RULE_NAMES entry is retired or shipped today', () => {
    const missing = unlisted('rule', LEGACY_RULE_NAMES, RETIRED_SHIPPED.rules, shippedToday().rules);
    expect(missing).toEqual([]);
  });

  it('every LEGACY_SKILL_NAMES folder is retired or shipped today', () => {
    const missing = unlisted('skill folder', LEGACY_SKILL_NAMES, RETIRED_SHIPPED.skills, shippedToday().skills);
    expect(missing).toEqual([]);
  });
});

describe('released names that the registries no longer ship are retired', () => {
  const today = shippedToday();

  it.each([
    ['commands', RELEASED_SHIPPED_NAMES.commands, RETIRED_SHIPPED.commands, today.commands],
    ['agents', RELEASED_SHIPPED_NAMES.agents, RETIRED_SHIPPED.agents, today.agents],
    ['rules', RELEASED_SHIPPED_NAMES.rules, RETIRED_SHIPPED.rules, today.rules],
    ['skill folders', RELEASED_SHIPPED_NAMES.skills, RETIRED_SHIPPED.skills, today.skills],
  ] as const)('every released %s name is retired or shipped today', (kind, released, retired, shipped) => {
    const missing = released.filter(name => !retired.includes(name) && !shipped.has(name));
    expect(missing, `released ${kind} that are neither retired nor shipped today`).toEqual([]);
  });
});

describe('retiredPathSet', () => {
  const retired = retiredPathSet();

  it('maps commands, agents and rules to their install paths', () => {
    expect(retired.files.has('commands/devflow/specify.md')).toBe(true);
    expect(retired.files.has('commands/devflow/specify-teams.md')).toBe(true);
    expect(retired.files.has('agents/devflow/coder.md')).toBe(true);
    expect(retired.holds('commands/devflow')).toBe(true);
    expect(retired.holds('agents/devflow')).toBe(true);
  });

  it('maps the listed files of a skill folder that exists today', () => {
    expect(retired.files.has('skills/devflow:git/references/pr/ensure-pr-ready.md')).toBe(true);
    expect(retired.files.has('skills/devflow:agent-references/references/learning/maintain.md')).toBe(true);
    expect(retired.holds('skills/devflow:git/references/pr')).toBe(true);
  });

  it('holds no file of a shipped skill and no retired skill folder', () => {
    expect(retired.files.has('skills/devflow:git/SKILL.md')).toBe(false);
    expect(retired.holds('skills/typescript')).toBe(false);
    expect(retired.holds('skills/devflow-core-patterns')).toBe(false);
  });

  it('has one file per listed name', () => {
    const listedSkillFiles = Object.values(RETIRED_SHIPPED.skillFiles).reduce((sum, files) => sum + files.length, 0);
    const expected =
      RETIRED_SHIPPED.commands.length +
      RETIRED_SHIPPED.agents.length +
      RETIRED_SHIPPED.rules.length +
      listedSkillFiles;
    expect(retired.files.size).toBe(expected);
  });
});
