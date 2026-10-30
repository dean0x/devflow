/**
 * install-backup-sets: the retired set, the shipped set and the lists that feed them.
 *
 * What it asserts
 * ---------------
 * 1. Retired names (`RETIRED_SHIPPED`): the literal is frozen, every released name of a legacy
 *    list is in it or is shipped today, and every released name that the registries no longer
 *    ship is in it. The other direction holds too: every name on a delete list (commands, agents,
 *    rules and skill files) is a name a release shipped, since the install removes such a file
 *    with no backup. Each list has a count floor in `tests/fixtures/numeric-floors.json`.
 * 2. `retiredPathSet()` maps the lists to Claude-dir relative paths: files only, and a skill
 *    folder of `skills` stays out because the install moves it whole.
 * 3. The shipped set: it is built from the full registries and all four variants, it holds the
 *    files the install writes (pinned against the compliance converge and the install-snapshot
 *    goldens), and a valid skill shadow adds its files.
 * 4. The two sets: they are disjoint, a name in both classifies as shipped, every released name
 *    is in one of them, and every name the build ships is in the released-name fixture.
 * 5. Workflow folders: the set holds every file of a registered folder under all four variant
 *    keys, and the old command file of a folder workflow.
 * 6. Sidecars: the name each producer of a temp or displaced folder or file makes classifies as a
 *    sidecar.
 *
 * What a green run does NOT prove
 * -------------------------------
 * The released-name fixture is the audit result at version 3.9.0. A name that a later release
 * shipped is covered only when its PR adds it to `tests/fixtures/released-shipped-names.ts`. The
 * install-snapshot goldens cover the three scenarios they record (GitHub, Jira with HIPAA, all
 * switches off); an install that writes a file in another shape is not seen.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LEGACY_AGENT_KEYS } from '../../src/core/agent-models.js';
import { complianceSkillFiles } from '../../src/core/compliance.js';
import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../src/core/compliance-off-files.js';
import { VARIANT_KEYS } from '../../src/core/curation-variants.js';
import {
  SKILL_REFS_SKILL_NAME,
  WORKFLOW_FOLDERS,
  installedReferenceManifest,
  workflowFolderFiles,
  type WorkflowFolder,
} from '../../src/core/mds-variants.js';
import { atomicTempPath } from '../../src/core/fs-atomic.js';
import { createPathSet, type RetiredSet, type ShippedSet } from '../../src/core/path-set.js';
import {
  FEATURE_OWNED_RULES,
  FEATURE_OWNED_SKILLS,
  LEGACY_COMMAND_NAMES,
  LEGACY_RULE_NAMES,
  DEVFLOW_PLUGINS,
  getAllAgentNames,
  getAllCommandNames,
  getAllRuleNames,
  getAllSkillNames,
  prefixSkillName,
  workflowFolderNames,
} from '../../src/core/plugins.js';
import { RETIRED_SHIPPED, retiredPathSet } from '../../src/core/retired-shipped-names.js';
import { convergeComplianceArtifacts, complianceSkillAsidePath, complianceSkillTempPath } from '../../src/targets/claude-code/compliance-install.js';
import { copyTempPath } from '../../src/targets/claude-code/compliance-off-files.js';
import { curationSwapPaths } from '../../src/targets/claude-code/curation-install.js';
import { classify, type EntryKind } from '../../src/targets/claude-code/install-backup.js';
import {
  backupDirFor,
  overlayOwnedSkillPaths,
  planOverlayUnits,
  stagingDirFor,
} from '../../src/targets/claude-code/installer.js';
import { LEGACY_SKILL_NAMES } from '../../src/targets/claude-code/legacy.js';
import { linkReplacementTempPath } from '../../src/targets/claude-code/linked-folder.js';
import { buildShippedSet, loadShippedSet, type ShippedSetInputs } from '../../src/targets/claude-code/shipped-set.js';
import { backupOf, stagingPrefixOf } from '../../src/targets/claude-code/workflow-folder-install.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';
import { RELEASED_SHIPPED_NAMES } from '../fixtures/released-shipped-names.js';
import { ROOT, testBackups } from '../helpers.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * The problems of a legacy list of files (commands, agents, rules) against what the releases
 * shipped. A name that a release shipped must be retired or shipped today, so the install removes
 * or keeps it as devflow's own. A name that no release shipped must be on no delete list: a file of
 * that name may be the user's, so the install moves it aside and names it like any unknown file.
 */
function legacyFileProblems(
  kind: string,
  names: Iterable<string>,
  released: readonly string[],
  retired: readonly string[],
  shipped: ReadonlySet<string>,
): string[] {
  const wasReleased = new Set(released);
  const onDeleteList = new Set(retired);
  const problems: string[] = [];
  for (const name of names) {
    if (wasReleased.has(name) && !onDeleteList.has(name) && !shipped.has(name)) {
      problems.push(`${kind} "${name}" was released but is neither in RETIRED_SHIPPED nor shipped today: add it to src/core/retired-shipped-names.ts`);
    }
    if (!wasReleased.has(name) && onDeleteList.has(name)) {
      problems.push(`${kind} "${name}" is on a delete list but no release shipped it: take it out of src/core/retired-shipped-names.ts`);
    }
  }
  return problems;
}

/** The names of a delete list that no release shipped. The install removes a listed file with no backup. */
function unreleasedDeleteNames(kind: string, deleteList: readonly string[], released: readonly string[]): string[] {
  const wasReleased = new Set(released);
  return deleteList
    .filter(name => !wasReleased.has(name))
    .map(name => `${kind} "${name}" is on a delete list but no release shipped it`);
}

/** The files of a skill folder's delete list that no release shipped in that folder. */
function unreleasedSkillFiles(
  listed: Readonly<Record<string, readonly string[]>>,
  released: Readonly<Record<string, readonly string[]>>,
): string[] {
  const problems: string[] = [];
  for (const [folder, files] of Object.entries(listed)) {
    const shippedFiles = new Set(Object.hasOwn(released, folder) ? released[folder] : []);
    for (const file of files) {
      if (!shippedFiles.has(file)) problems.push(`skill file "${folder}/${file}" is on a delete list but no release shipped it`);
    }
  }
  return problems;
}

/** The paths that both sets name: a retired file the build ships, or a retired skill folder it ships. */
function sharedNames(shipped: ShippedSet, retired: RetiredSet, retiredSkills: readonly string[]): string[] {
  const shared = [...retired.files].filter(file => shipped.files.has(file));
  for (const folder of retiredSkills) {
    if (shipped.holds(`skills/${folder}`)) shared.push(`skills/${folder}`);
  }
  return shared.sort();
}

const shippedAgain = (name: string): string =>
  `${name} is shipped again: remove it from RETIRED_SHIPPED and the legacy list in the PR that ships it`;

/** The files of a registered folder that the shipped set lacks, over all four variant keys. */
function missingFolderFiles(shipped: ShippedSet, folders: readonly WorkflowFolder[]): string[] {
  const missing: string[] = [];
  for (const folder of folders) {
    for (const key of VARIANT_KEYS) {
      for (const file of workflowFolderFiles(folder, key)) {
        const rel = `skills/devflow:${folder.name}/${file}`;
        if (!shipped.files.has(rel)) missing.push(`${rel} (key ${key})`);
      }
    }
  }
  return missing;
}

const isFrozenDeep = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isFrozenDeep);
};

/** A fresh temp home, asserted and logged before any use. */
async function makeHome(label: string): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
  assertTempHome(home);
  console.log(`${label} test home: ${await fs.realpath(home)}`);
  return home;
}

/** Every file below `dir` as sorted POSIX paths. */
async function listFilesBelow(dir: string): Promise<string[]> {
  const found = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return found
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

// ---------------------------------------------------------------------------
// Retired names
// ---------------------------------------------------------------------------

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
  it('every released LEGACY_COMMAND_NAMES entry is retired or shipped today, and no other is on a delete list', () => {
    const problems = legacyFileProblems(
      'command', LEGACY_COMMAND_NAMES, RELEASED_SHIPPED_NAMES.commands, RETIRED_SHIPPED.commands, shippedToday().commands,
    );
    expect(problems).toEqual([]);
  });

  it('every released LEGACY_AGENT_KEYS file name is retired or shipped today, and no other is on a delete list', () => {
    const problems = legacyFileProblems(
      'agent', Object.keys(LEGACY_AGENT_KEYS), RELEASED_SHIPPED_NAMES.agents, RETIRED_SHIPPED.agents, shippedToday().agents,
    );
    expect(problems).toEqual([]);
  });

  it('every released LEGACY_RULE_NAMES entry is retired or shipped today, and no other is on a delete list', () => {
    const problems = legacyFileProblems(
      'rule', LEGACY_RULE_NAMES, RELEASED_SHIPPED_NAMES.rules, RETIRED_SHIPPED.rules, shippedToday().rules,
    );
    expect(problems).toEqual([]);
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

/**
 * The names that sit in a legacy list but that no release installed as a file. The install removes
 * a file on a delete list with no backup, so each of these is an unknown file: it moves aside and
 * is named. A user may keep a file of that name.
 */
const NEVER_RELEASED = {
  commands: ['review', 'specify-teams'],
  agents: ['bug-analyzer', 'designer', 'evaluator', 'researcher', 'tester', 'triager'],
} as const;

describe('the delete lists name only files that a release shipped', () => {
  it.each([
    ['commands', RETIRED_SHIPPED.commands, RELEASED_SHIPPED_NAMES.commands],
    ['agents', RETIRED_SHIPPED.agents, RELEASED_SHIPPED_NAMES.agents],
    ['rules', RETIRED_SHIPPED.rules, RELEASED_SHIPPED_NAMES.rules],
  ] as const)('every RETIRED_SHIPPED %s name is a name a release shipped', (kind, deleteList, released) => {
    expect(unreleasedDeleteNames(kind, deleteList, released)).toEqual([]);
  });

  it('every RETIRED_SHIPPED skillFiles entry is a file a release shipped in that folder', () => {
    expect(unreleasedSkillFiles(RETIRED_SHIPPED.skillFiles, RELEASED_SHIPPED_NAMES.skillFiles)).toEqual([]);
  });

  it('keeps the eight names that no release shipped off every delete list, and out of the released fixture', () => {
    const retired = retiredPathSet();
    for (const [kind, folder] of [['commands', 'commands'], ['agents', 'agents']] as const) {
      for (const name of NEVER_RELEASED[kind]) {
        expect(RELEASED_SHIPPED_NAMES[kind], `${kind} "${name}" was never released`).not.toContain(name);
        expect(RETIRED_SHIPPED[kind], `${kind} "${name}" is not retired`).not.toContain(name);
        expect(retired.files.has(`${folder}/devflow/${name}.md`), `${folder}/devflow/${name}.md is not a retired path`).toBe(false);
      }
    }
  });

  it('is not vacuous: the guard reports each of the eight names when it is put back on a delete list', () => {
    const putBack = {
      commands: [...new Set([...RETIRED_SHIPPED.commands, ...NEVER_RELEASED.commands])],
      agents: [...new Set([...RETIRED_SHIPPED.agents, ...NEVER_RELEASED.agents])],
    };
    expect(unreleasedDeleteNames('command', putBack.commands, RELEASED_SHIPPED_NAMES.commands).sort()).toEqual(
      NEVER_RELEASED.commands.map(name => `command "${name}" is on a delete list but no release shipped it`).sort(),
    );
    expect(unreleasedDeleteNames('agent', putBack.agents, RELEASED_SHIPPED_NAMES.agents).sort()).toEqual(
      NEVER_RELEASED.agents.map(name => `agent "${name}" is on a delete list but no release shipped it`).sort(),
    );
    expect(
      unreleasedSkillFiles({ 'devflow:git': ['references/pr/never-shipped.md'] }, RELEASED_SHIPPED_NAMES.skillFiles),
    ).toEqual(['skill file "devflow:git/references/pr/never-shipped.md" is on a delete list but no release shipped it']);
    expect(
      legacyFileProblems('agent', ['tester'], RELEASED_SHIPPED_NAMES.agents, [...RETIRED_SHIPPED.agents, 'tester'], new Set()),
    ).toEqual(['agent "tester" is on a delete list but no release shipped it: take it out of src/core/retired-shipped-names.ts']);
  });
});

describe('the name lists only grow', () => {
  const retiredSkillFileCount = Object.values(RETIRED_SHIPPED.skillFiles).reduce((sum, files) => sum + files.length, 0);

  it('keeps each retired list at or above its floor', () => {
    expect(RETIRED_SHIPPED.commands.length).toBeGreaterThanOrEqual(15);
    expect(RETIRED_SHIPPED.agents.length).toBeGreaterThanOrEqual(35);
    expect(RETIRED_SHIPPED.skills.length).toBeGreaterThanOrEqual(189);
    expect(retiredSkillFileCount).toBeGreaterThanOrEqual(2);
  });

  it('keeps each list of the released-name fixture at or above its floor', () => {
    expect(RELEASED_SHIPPED_NAMES.commands.length).toBeGreaterThanOrEqual(29);
    expect(RELEASED_SHIPPED_NAMES.agents.length).toBeGreaterThanOrEqual(55);
    expect(RELEASED_SHIPPED_NAMES.rules.length).toBeGreaterThanOrEqual(15);
    expect(RELEASED_SHIPPED_NAMES.skills.length).toBeGreaterThanOrEqual(84);
    expect(Object.keys(RELEASED_SHIPPED_NAMES.skillFiles).length).toBeGreaterThanOrEqual(84);
  });
});

describe('retiredPathSet', () => {
  const retired = retiredPathSet();

  it('maps commands, agents and rules to their install paths', () => {
    expect(retired.files.has('commands/devflow/specify.md')).toBe(true);
    expect(retired.files.has('commands/devflow/pre-pr.md')).toBe(true);
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

// ---------------------------------------------------------------------------
// The compliance skill folder
// ---------------------------------------------------------------------------

describe('complianceSkillFiles', () => {
  let home: string;

  beforeEach(async () => {
    home = await makeHome('install-backup-sets compliance');
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it.each([true, false])('equals the files the compliance converge installs (compliance %s)', async enabled => {
    const warnings: string[] = [];
    const claudeDir = path.join(home, '.claude');
    const result = await convergeComplianceArtifacts({
      claudeDir,
      devflowDir: path.join(home, '.devflow'),
      enabled,
      frameworks: ['gdpr'],
      rulesEnabled: false,
      warn: message => warnings.push(message),
      backups: await testBackups(home),
    });

    expect(warnings).toEqual([]);
    expect(result.converged).toBe(true);
    const installed = await listFilesBelow(path.join(claudeDir, 'skills', 'devflow:compliance'));
    expect(installed).toEqual([...complianceSkillFiles()].sort());
  });
});

// ---------------------------------------------------------------------------
// The shipped set
// ---------------------------------------------------------------------------

describe('shipped set', () => {
  let home: string;
  let devflowDir: string;

  beforeEach(async () => {
    home = await makeHome('install-backup-sets shipped');
    devflowDir = path.join(home, '.devflow');
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  async function load(extra: { shadowListings?: ReadonlyMap<string, readonly string[]> } = {}): Promise<ShippedSet> {
    const loaded = await loadShippedSet({ devflowDir, packageRoot: ROOT, workflowFolders: WORKFLOW_FOLDERS, ...extra });
    if (!loaded.ok) throw new Error(`the shipped set did not load: ${loaded.reason}`);
    return loaded.shipped;
  }

  it('holds every command, agent and rule of every plugin, the feature-owned rules and the tracker agent', async () => {
    const shipped = await load();
    const commands = DEVFLOW_PLUGINS.flatMap(plugin => plugin.commands.map(cmd => (cmd.startsWith('/') ? cmd.slice(1) : cmd)));
    const missing = [
      ...commands.map(name => `commands/devflow/${name}.md`),
      ...getAllAgentNames().map(name => `agents/devflow/${name}.md`),
      ...getAllRuleNames().map(name => `rules/devflow/${name}.md`),
      ...FEATURE_OWNED_RULES.map(name => `rules/devflow/${name}.md`),
      'agents/devflow/tracker.md',
    ].filter(file => !shipped.files.has(file));
    expect(missing).toEqual([]);
  });

  it('holds the files of every registry skill in the package, curation-gated skills included', async () => {
    const shipped = await load();
    const missing: string[] = [];
    for (const skill of getAllSkillNames(new Set())) {
      const dir = path.join(ROOT, 'src', 'assets', 'skills', skill);
      for (const file of await listFilesBelow(dir)) {
        if (!shipped.files.has(`skills/devflow:${skill}/${file}`)) missing.push(`${skill}/${file}`);
      }
    }
    expect(missing).toEqual([]);
    expect(shipped.files.has('skills/devflow:apply-decisions/SKILL.md')).toBe(true);
  });

  it('holds every generated reference of the compliance-on manifest and the files compliance off removes', async () => {
    const shipped = await load();
    const manifest = installedReferenceManifest({ compliance: true });
    const missing = [
      ...manifest.map(rel => `skills/devflow:${SKILL_REFS_SKILL_NAME}/references/${rel}`),
      ...COMPLIANCE_OFF_REMOVED_SKILL_FILES.map(entry => `skills/${entry}`),
    ].filter(file => !shipped.files.has(file));
    expect(missing).toEqual([]);
  });

  it('holds every path the reference overlay owns, as a file or as a folder', async () => {
    const shipped = await load();
    const owned = [...overlayOwnedSkillPaths(installedReferenceManifest({ compliance: true }))];
    expect(owned.length).toBeGreaterThan(0);
    const missing = owned.filter(rel => !shipped.holds(`skills/devflow:${SKILL_REFS_SKILL_NAME}/${rel}`));
    expect(missing).toEqual([]);
  });

  it('holds the compliance skill the converge writes and not the framework sources', async () => {
    const shipped = await load();
    for (const file of complianceSkillFiles()) {
      expect(shipped.files.has(`skills/devflow:compliance/${file}`), file).toBe(true);
    }
    expect(shipped.holds('skills/devflow:compliance/frameworks')).toBe(false);
  });

  it('is not built from what is installed: an empty Claude dir and a populated one give the same set', async () => {
    const first = await load();
    await fs.mkdir(path.join(home, '.claude', 'commands', 'devflow'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', 'commands', 'devflow', 'mine.md'), 'user file');
    const second = await load();
    expect([...second.files].sort()).toEqual([...first.files].sort());
    expect(second.files.has('commands/devflow/mine.md')).toBe(false);
  });

  it('adds the files of a valid skill shadow beside the shipped ones', async () => {
    const shadow = path.join(devflowDir, 'skills', 'typescript');
    await fs.mkdir(path.join(shadow, 'references'), { recursive: true });
    await fs.writeFile(path.join(shadow, 'SKILL.md'), '# shadow');
    await fs.writeFile(path.join(shadow, 'references', 'own-notes.md'), 'notes');

    const shipped = await load();

    expect(shipped.files.has('skills/devflow:typescript/references/own-notes.md')).toBe(true);
    expect(shipped.files.has('skills/devflow:typescript/SKILL.md')).toBe(true);
    expect(shipped.files.has('skills/devflow:typescript/references/patterns.md')).toBe(true);
  });

  it('ignores a shadow with no SKILL.md, as the install does', async () => {
    const shadow = path.join(devflowDir, 'skills', 'typescript');
    await fs.mkdir(shadow, { recursive: true });
    await fs.writeFile(path.join(shadow, 'own-notes.md'), 'notes');

    const shipped = await load();

    expect(shipped.files.has('skills/devflow:typescript/own-notes.md')).toBe(false);
  });

  it('takes the shadow listings of the caller and reads no shadow from disk then', async () => {
    const shadow = path.join(devflowDir, 'skills', 'typescript');
    await fs.mkdir(shadow, { recursive: true });
    await fs.writeFile(path.join(shadow, 'SKILL.md'), '# shadow');
    await fs.writeFile(path.join(shadow, 'on-disk-only.md'), 'x');

    const shipped = await load({ shadowListings: new Map([['git', ['own-recipe.md']]]) });

    expect(shipped.files.has('skills/devflow:git/own-recipe.md')).toBe(true);
    expect(shipped.files.has('skills/devflow:typescript/on-disk-only.md')).toBe(false);
  });

  it('answers with a reason, not a smaller set, when a registry skill has no source in the package', async () => {
    const emptyRoot = path.join(home, 'package');
    await fs.mkdir(path.join(emptyRoot, 'src', 'assets', 'skills'), { recursive: true });

    const loaded = await loadShippedSet({ devflowDir, packageRoot: emptyRoot, workflowFolders: [] });

    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toMatch(/skill "[a-z-]+": could not read .*ENOENT/);
  });
});

// ---------------------------------------------------------------------------
// The two sets together
// ---------------------------------------------------------------------------

describe('shipped and retired sets', () => {
  let home: string;
  let shipped: ShippedSet;
  const retired = retiredPathSet();

  beforeEach(async () => {
    home = await makeHome('install-backup-sets pair');
    const loaded = await loadShippedSet({ devflowDir: path.join(home, '.devflow'), packageRoot: ROOT, workflowFolders: WORKFLOW_FOLDERS });
    if (!loaded.ok) throw new Error(loaded.reason);
    shipped = loaded.shipped;
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('are disjoint', () => {
    expect(sharedNames(shipped, retired, RETIRED_SHIPPED.skills).map(shippedAgain)).toEqual([]);
  });

  it('reports a name that is in both, with the fix to apply', () => {
    const seeded = createPathSet(['commands/devflow/specify.md', 'skills/typescript/SKILL.md']);

    const shared = sharedNames(seeded, retired, RETIRED_SHIPPED.skills);

    expect(shared.map(shippedAgain)).toEqual([
      'commands/devflow/specify.md is shipped again: remove it from RETIRED_SHIPPED and the legacy list in the PR that ships it',
      'skills/typescript is shipped again: remove it from RETIRED_SHIPPED and the legacy list in the PR that ships it',
    ]);
  });

  it('classify a name in both as shipped', () => {
    const seeded = createPathSet(['commands/devflow/specify.md']);

    expect(classify('commands/devflow/specify.md', 'file', { shipped: seeded, retired })).toBe('shipped');
    expect(classify('commands/devflow/specify.md', 'file', { shipped: createPathSet([]), retired })).toBe('retired');
  });

  it('cover every released name', () => {
    const missing: string[] = [];
    const named = (file: string): boolean => shipped.files.has(file) || retired.files.has(file);
    for (const name of RELEASED_SHIPPED_NAMES.commands) {
      if (!named(`commands/devflow/${name}.md`)) missing.push(`command ${name}`);
    }
    for (const name of RELEASED_SHIPPED_NAMES.agents) {
      if (!named(`agents/devflow/${name}.md`)) missing.push(`agent ${name}`);
    }
    for (const name of RELEASED_SHIPPED_NAMES.rules) {
      if (!named(`rules/devflow/${name}.md`)) missing.push(`rule ${name}`);
    }
    for (const folder of RELEASED_SHIPPED_NAMES.skills) {
      if (!shipped.holds(`skills/${folder}`) && !RETIRED_SHIPPED.skills.includes(folder)) missing.push(`skill folder ${folder}`);
    }
    for (const [folder, files] of Object.entries(RELEASED_SHIPPED_NAMES.skillFiles)) {
      if (RETIRED_SHIPPED.skills.includes(folder)) continue;
      for (const file of files) {
        if (!named(`skills/${folder}/${file}`)) missing.push(`skill file ${folder}/${file}`);
      }
    }
    expect(missing, 'released names that are in neither the shipped nor the retired set').toEqual([]);
  });

  it('ship only names that the released-name fixture holds', () => {
    const released = RELEASED_SHIPPED_NAMES;
    const unreleased: string[] = [];
    for (const file of shipped.files) {
      const top = /^(commands|agents|rules)\/devflow\/(.+)\.md$/.exec(file);
      if (top !== null) {
        const list = top[1] === 'commands' ? released.commands : top[1] === 'agents' ? released.agents : released.rules;
        if (!list.includes(top[2])) unreleased.push(file);
        continue;
      }
      const skill = /^skills\/([^/]+)\/(.+)$/.exec(file);
      if (skill === null || !(released.skillFiles[skill[1]] ?? []).includes(skill[2])) unreleased.push(file);
    }
    expect(
      unreleased.map(file => `${file} is not in tests/fixtures/released-shipped-names.ts: add the name there`),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workflow folders
// ---------------------------------------------------------------------------

describe('workflow folders in the shipped set', () => {
  const emptyInputs = (workflowFolders: readonly WorkflowFolder[]): ShippedSetInputs => ({
    packageSkillFiles: new Map(),
    workflowFolders,
  });

  it('holds every file of a registered folder under all four variant keys', () => {
    const shipped = buildShippedSet(emptyInputs([FIXTURE_FOLDER]));

    expect(missingFolderFiles(shipped, [FIXTURE_FOLDER])).toEqual([]);
    const both = workflowFolderFiles(FIXTURE_FOLDER, 'both-off');
    const on = workflowFolderFiles(FIXTURE_FOLDER, 'on');
    expect(both.length).toBeLessThan(on.length);
    expect(shipped.files.has('skills/devflow:flow/references/evidence-asks.md')).toBe(true);
  });

  it('reports the files of a folder that a shipped set lacks', () => {
    const seeded = buildShippedSet(emptyInputs([]));

    const missing = missingFolderFiles(seeded, [FIXTURE_FOLDER]);

    expect(missing).toContain('skills/devflow:flow/SKILL.md (key on)');
    expect(missing).toContain('skills/devflow:flow/references/evidence-asks.md (key on)');
    expect(missing.some(entry => entry.endsWith('(key both-off)'))).toBe(true);
  });

  it('passes for the registry the build ships, whatever it holds', async () => {
    const home = await makeHome('install-backup-sets registry');
    try {
      const loaded = await loadShippedSet({ devflowDir: path.join(home, '.devflow'), packageRoot: ROOT, workflowFolders: WORKFLOW_FOLDERS });
      if (!loaded.ok) throw new Error(loaded.reason);
      expect(missingFolderFiles(loaded.shipped, WORKFLOW_FOLDERS)).toEqual([]);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('holds the old command file of a folder workflow, which the command registry would drop', () => {
    const folder: WorkflowFolder = { ...FIXTURE_FOLDER, name: 'plan' };

    const shipped = buildShippedSet(emptyInputs([folder]));

    expect(getAllCommandNames(workflowFolderNames([folder]))).not.toContain('plan');
    expect(shipped.files.has('commands/devflow/plan.md')).toBe(true);
    expect(shipped.files.has('skills/devflow:plan/SKILL.md')).toBe(true);
    expect(classify('commands/devflow/plan.md', 'file', { shipped, retired: retiredPathSet() })).toBe('shipped');
  });
});

// ---------------------------------------------------------------------------
// The install-snapshot goldens
// ---------------------------------------------------------------------------

describe('install-snapshot goldens', () => {
  const GOLDEN_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden');
  const INSTALL_FOLDERS = ['commands/devflow', 'agents/devflow', 'rules/devflow', 'skills/devflow:'];

  /** The entries of the `install: HOME` section that lie in a folder devflow installs into. */
  function installedEntries(scenario: string): Array<{ readonly rel: string; readonly kind: EntryKind }> {
    const lines = readFileSync(path.join(GOLDEN_DIR, `install-snapshot-${scenario}.txt`), 'utf-8').split('\n');
    const start = lines.indexOf('## install: HOME');
    expect(start, `${scenario}: the install: HOME section`).toBeGreaterThanOrEqual(0);
    const entries: Array<{ rel: string; kind: EntryKind }> = [];
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith('## ')) break;
      const match = /^([dx\-l]) \.claude\/(.+)$/.exec(line);
      if (match === null) continue;
      const rel = match[2].replace(/\/$/, '');
      if (!INSTALL_FOLDERS.some(folder => rel.startsWith(folder))) continue;
      entries.push({ rel, kind: match[1] === 'd' ? 'directory' : match[1] === 'l' ? 'link' : 'file' });
    }
    return entries;
  }

  let home: string;
  let shipped: ShippedSet;

  beforeEach(async () => {
    home = await makeHome('install-backup-sets goldens');
    const loaded = await loadShippedSet({ devflowDir: path.join(home, '.devflow'), packageRoot: ROOT, workflowFolders: WORKFLOW_FOLDERS });
    if (!loaded.ok) throw new Error(loaded.reason);
    shipped = loaded.shipped;
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it.each(['github', 'jira-hipaa', 'all-off'])('classifies every installed entry of the %s scenario as shipped', scenario => {
    const entries = installedEntries(scenario);
    expect(entries.length, `${scenario}: entries read from the golden`).toBeGreaterThan(100);

    const sets = { shipped, retired: retiredPathSet() };
    const strays = entries
      .map(({ rel, kind }) => ({ rel, verdict: classify(rel, kind, sets) }))
      .filter(({ verdict }) => verdict !== 'shipped' && verdict !== 'sidecar')
      .map(({ rel, verdict }) => `${rel} classifies as ${verdict}`);

    expect(strays).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sidecars
// ---------------------------------------------------------------------------

describe('sidecar names', () => {
  const CLAUDE = path.join(path.sep, 'h', '.claude');
  const rel = (absolute: string): string => toPosix(path.relative(CLAUDE, absolute));

  let home: string;
  let sets: { shipped: ShippedSet; retired: RetiredSet };

  beforeEach(async () => {
    home = await makeHome('install-backup-sets sidecars');
    const loaded = await loadShippedSet({ devflowDir: path.join(home, '.devflow'), packageRoot: ROOT, workflowFolders: WORKFLOW_FOLDERS });
    if (!loaded.ok) throw new Error(loaded.reason);
    sets = { shipped: loaded.shipped, retired: retiredPathSet() };
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it.each([
    ['the atomic writer', () => rel(atomicTempPath(path.join(CLAUDE, 'commands', 'devflow', 'code-review.md'))), 'file'],
    ['the link replacement writer', () => rel(linkReplacementTempPath(path.join(CLAUDE, 'agents', 'devflow', 'tracker.md'))), 'file'],
    ['the compliance-off copy', () => rel(copyTempPath(path.join(CLAUDE, 'skills', 'devflow:git', 'references', 'publication-gate.md'))), 'file'],
    ['the compliance skill build', () => rel(complianceSkillTempPath(CLAUDE)), 'directory'],
    ['the compliance skill aside folder', () => rel(complianceSkillAsidePath(CLAUDE)), 'directory'],
    ['the curation staging folder', () => rel(curationSwapPaths(CLAUDE, 1_730_000_000_000).staging), 'directory'],
    ['the curation backup folder', () => rel(curationSwapPaths(CLAUDE, 1_730_000_000_000).backup), 'directory'],
  ] as const)('%s makes a name that classifies as a sidecar', (_producer, name, kind) => {
    expect(classify(name(), kind, sets)).toBe('sidecar');
  });

  it('classifies the staging and backup folders of every kind of reference overlay unit as sidecars', () => {
    const referencesTarget = path.join(CLAUDE, 'skills', 'devflow:git', 'references');
    const units = planOverlayUnits(installedReferenceManifest({ compliance: true }));
    expect(new Set(units.map(unit => unit.kind))).toEqual(new Set(['provider', 'pr-host', 'cross-cutting']));

    const names: string[] = [];
    for (const unit of units) {
      names.push(rel(stagingDirFor(referencesTarget, unit)));
      if (unit.kind !== 'cross-cutting') names.push(rel(backupDirFor(referencesTarget, unit)));
    }

    const strays = names.filter(name => classify(name, 'directory', sets) !== 'sidecar');
    expect(strays).toEqual([]);
    expect(names.length).toBeGreaterThan(units.length);
  });

  it('classifies the staging folder of a workflow folder install, and its backup, as sidecars', async () => {
    const claudeDir = path.join(home, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    const staging = await fs.mkdtemp(stagingPrefixOf(claudeDir, 'flow'));

    const names = [toPosix(path.relative(claudeDir, staging)), toPosix(path.relative(claudeDir, backupOf(staging)))];

    expect(names.map(name => classify(name, 'directory', sets))).toEqual(['sidecar', 'sidecar']);
  });

  it.each([
    ['a user file that only looks like a temp file', 'commands/devflow/mine.md.tmp.4242', 'file'],
    ['a user folder in the Claude dir', '.devflow-notes', 'directory'],
    ['a user dot folder named like a curation folder', '.devflow-curation-notes', 'directory'],
    ['a plain dot folder in the references', 'skills/devflow:git/references/tracker/.pr-host.pr', 'directory'],
    ['a user file beside a staging folder', 'skills/devflow:git/references/tracker/.pr-host.pr.notes', 'file'],
  ] as const)('does not take %s for a sidecar', (_label, name, kind) => {
    expect(classify(name, kind, sets)).toBe('unknown');
  });
});
