/**
 * The SHAPE of an install: which skills land, which are removed, which shadows
 * go dormant, and how the sweep and the pre-clean divide the skills directory
 * between them.
 *
 * Skills became plugin-scoped in this wave, and the two directions of that are
 * tested together because only the pair is a guarantee: a selection that
 * installs its closure but never removes anything is the old universal install
 * with extra steps, and one that removes without the `--plugin` gate silently
 * deletes assets an add-one run was never asked to touch (AC-22).
 *
 * HOME safety (applies PF-060): every test injects an mkdtemp claudeDir and
 * devflowDir. No test reads or writes the real ~/.claude or ~/.devflow, and no
 * test shells out to dist/cli.js.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { installViaFileCopy, type Spinner } from '../../src/targets/claude-code/installer.js';
import {
  formatSkillScopeSummary,
  formatTrackerAssetSummary,
} from '../../src/cli/commands/install-report.js';
import {
  DEVFLOW_PLUGINS,
  FEATURE_OWNED_SKILLS,
  buildScopedSkillsMap,
  getAllSkillNames,
  prefixSkillName,
  skillsOf,
  type PluginDefinition,
} from '../../src/core/plugins.js';

const noopSpinner: Spinner = { start() {}, stop() {}, message() {} };

let claudeDir: string;
let devflowDir: string;
let warnings: string[];

const plugin = (name: string): PluginDefinition => {
  const found = DEVFLOW_PLUGINS.find(p => p.name === name);
  if (found === undefined) throw new Error(`no such plugin: ${name}`);
  return found;
};

async function installedSkillDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(claudeDir, 'skills'));
    return entries.sort();
  } catch { return []; }
}

async function run(opts: {
  plugins: PluginDefinition[];
  effectivePlugins?: PluginDefinition[];
  isPartialInstall: boolean;
}) {
  const effective = opts.effectivePlugins ?? opts.plugins;
  return installViaFileCopy({
    plugins: opts.plugins,
    effectivePlugins: effective,
    claudeDir,
    devflowDir,
    skillsMap: buildScopedSkillsMap(effective),
    agentsMap: new Map(),
    trackerProvider: 'github',
    isPartialInstall: opts.isPartialInstall,
    spinner: noopSpinner,
    warn: (msg) => { warnings.push(msg); },
  });
}

beforeEach(async () => {
  claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shape-claude-'));
  devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-shape-home-'));
  warnings = [];
});

afterEach(async () => {
  await fs.rm(claudeDir, { recursive: true, force: true });
  await fs.rm(devflowDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// What lands
// ---------------------------------------------------------------------------

describe('install set: a selection installs its closure and nothing else', () => {
  it('a full install lands exactly skillsOf(selected), prefixed', async () => {
    const selected = [plugin('devflow-core-skills'), plugin('devflow-explore')];
    await run({ plugins: selected, isPartialInstall: false });

    const expected = [...skillsOf(selected)].map(prefixSkillName).sort();
    expect(await installedSkillDirs()).toEqual(expected);
  });

  it('no presence-gated language skill lands for a non-language selection', async () => {
    await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });
    const installed = await installedSkillDirs();
    for (const lang of ['typescript', 'go', 'rust', 'react']) {
      expect(installed, `${lang} ships with its own optional plugin`).not.toContain(prefixSkillName(lang));
    }
  });

  it('selecting the language plugin is what installs its skill', async () => {
    await run({ plugins: [plugin('devflow-typescript')], isPartialInstall: false });
    expect(await installedSkillDirs()).toContain(prefixSkillName('typescript'));
  });

  it('the default (non-optional) selection is a strict subset of the registry', async () => {
    const nonOptional = DEVFLOW_PLUGINS.filter(p => !p.optional);
    await run({ plugins: nonOptional, isPartialInstall: false });
    const installed = await installedSkillDirs();
    expect(installed.length).toBeLessThan(getAllSkillNames().length);
    expect(installed.length).toBe(skillsOf(nonOptional).size);
  });
});

// ---------------------------------------------------------------------------
// What is removed — and what is not
// ---------------------------------------------------------------------------

describe('removal: scoped, gated, and never beyond the registry', () => {
  it('a full re-init removes exactly the set difference', async () => {
    // Install wide, then re-install narrow.
    await run({ plugins: DEVFLOW_PLUGINS, isPartialInstall: false });
    expect(await installedSkillDirs()).toHaveLength(getAllSkillNames().length);

    const narrow = [plugin('devflow-core-skills'), plugin('devflow-explore')];
    const report = await run({ plugins: narrow, isPartialInstall: false });

    const kept = skillsOf(narrow);
    const expectedRemoved = [...skillsOf(DEVFLOW_PLUGINS)].filter(s => !kept.has(s)).sort();
    expect([...report.removedSkills].sort()).toEqual(expectedRemoved);
    expect(await installedSkillDirs()).toEqual([...kept].map(prefixSkillName).sort());
  });

  it('a partial (--plugin) install removes NOTHING (AC-22)', async () => {
    await run({ plugins: DEVFLOW_PLUGINS, isPartialInstall: false });
    const before = await installedSkillDirs();

    const report = await run({
      plugins: [plugin('devflow-explore')],
      effectivePlugins: DEVFLOW_PLUGINS,
      isPartialInstall: true,
    });

    expect(report.removedSkills).toEqual([]);
    expect(await installedSkillDirs(), 'an add-one run subtracts nothing').toEqual(before);
  });

  it('a deselection survives a shared requires — the closure is a union, not a difference', async () => {
    // core-skills and implement both reach `git`, `test-driven-development` and
    // `software-design`. Dropping implement must not take them with it.
    const wide = [plugin('devflow-core-skills'), plugin('devflow-plan'), plugin('devflow-implement')];
    await run({ plugins: wide, isPartialInstall: false });

    const narrower = [plugin('devflow-core-skills'), plugin('devflow-plan')];
    await run({ plugins: narrower, isPartialInstall: false });

    const installed = await installedSkillDirs();
    for (const shared of ['git', 'test-driven-development', 'software-design']) {
      expect(
        installed,
        `${shared} is still owned or required by a selected plugin`,
      ).toContain(prefixSkillName(shared));
    }
  });

  it('never removes a feature-owned skill, even when no plugin claims it', async () => {
    const owned = prefixSkillName(FEATURE_OWNED_SKILLS[0]);
    await fs.mkdir(path.join(claudeDir, 'skills', owned), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'skills', owned, 'SKILL.md'), '# feature-owned\n', 'utf-8');

    const report = await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });

    expect(report.removedSkills).not.toContain(FEATURE_OWNED_SKILLS[0]);
    expect(
      await installedSkillDirs(),
      'the compliance feature owns its own artifact lifecycle (applies ADR-024)',
    ).toContain(owned);
  });

  it('a name the registry does not have at all is the SWEEP\'s, never a deselection', async () => {
    // The removal set is registry arithmetic over declared skills, never a
    // readdir of the install tree. A `devflow:` directory naming nothing in the
    // registry is an orphan, and it leaves through the orphan sweep — reported
    // as such, so the summary says "no longer in the registry" rather than
    // "no selected plugin requires it", which would be a different fact.
    const foreign = 'devflow:not-a-registry-skill';
    await fs.mkdir(path.join(claudeDir, 'skills', foreign), { recursive: true });

    const report = await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });

    expect(report.removedSkills, 'the deselection arithmetic never sees it').not.toContain('not-a-registry-skill');
    expect(report.sweptOrphans.map(o => `${o.kind}:${o.name}`)).toContain('skill:not-a-registry-skill');
    expect(await installedSkillDirs()).not.toContain(foreign);
  });

  it('a BARE (pre-namespace) directory is left alone by both mechanisms (avoids PF-012)', async () => {
    const bare = 'security';
    await fs.mkdir(path.join(claudeDir, 'skills', bare), { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'skills', bare, 'SKILL.md'), '# not ours\n', 'utf-8');

    await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });

    expect(
      await installedSkillDirs(),
      'a bare dir whose name collides with a registry skill is foreign to devflow',
    ).toContain(bare);
  });
});

// ---------------------------------------------------------------------------
// Sweep vs pre-clean — the deliberately opposite scoping
// ---------------------------------------------------------------------------

describe('sweep and pre-clean are scoped in opposite directions, on purpose', () => {
  it('the SWEEP is unscoped: a partial install still prunes a name the registry lost', async () => {
    const retired = 'devflow:retired-skill-probe';
    await fs.mkdir(path.join(claudeDir, 'skills', retired), { recursive: true });

    await run({
      plugins: [plugin('devflow-explore')],
      effectivePlugins: DEVFLOW_PLUGINS,
      isPartialInstall: true,
    });

    expect(
      await installedSkillDirs(),
      'a name no plugin declares at all is gone whatever the selection',
    ).not.toContain(retired);
  });

  it('the PRE-CLEAN is scoped: a partial install leaves another plugin\'s skill intact', async () => {
    await run({ plugins: DEVFLOW_PLUGINS, isPartialInstall: false });
    const sentinel = path.join(claudeDir, 'skills', prefixSkillName('rust'), 'SENTINEL.md');
    await fs.writeFile(sentinel, 'left by the previous install\n', 'utf-8');

    await run({
      plugins: [plugin('devflow-explore')],
      effectivePlugins: DEVFLOW_PLUGINS,
      isPartialInstall: true,
    });

    expect(
      await fs.readFile(sentinel, 'utf-8'),
      'the pre-clean must not empty a directory this run does not rewrite',
    ).toContain('left by the previous install');
  });

  it('the PRE-CLEAN does run on a full install — stale content never bleeds through', async () => {
    await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });
    const stale = path.join(claudeDir, 'skills', prefixSkillName('worktree-support'), 'STALE.md');
    await fs.writeFile(stale, 'from the previous install\n', 'utf-8');

    await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });

    await expect(fs.access(stale)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

describe('shadows: applied in scope, dormant out of scope, never deleted', () => {
  async function writeShadow(name: string, body: string): Promise<void> {
    const dir = path.join(devflowDir, 'skills', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), body, 'utf-8');
  }

  it('a shadow inside the install set is applied', async () => {
    await writeShadow('worktree-support', '# mine\nSHADOW-IN-SCOPE\n');
    const report = await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });

    expect(report.shadowedSkills).toContain('worktree-support');
    expect(report.dormantShadows).not.toContain('worktree-support');
    expect(
      await fs.readFile(path.join(claudeDir, 'skills', prefixSkillName('worktree-support'), 'SKILL.md'), 'utf-8'),
    ).toContain('SHADOW-IN-SCOPE');
  });

  it('a shadow outside the install set is reported dormant and its directory survives', async () => {
    await writeShadow('rust', '# mine\nSHADOW-OUT-OF-SCOPE\n');
    const report = await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });

    expect(report.dormantShadows).toContain('rust');
    expect(report.shadowedSkills).not.toContain('rust');
    expect(
      await fs.readFile(path.join(devflowDir, 'skills', 'rust', 'SKILL.md'), 'utf-8'),
      '~/.devflow/skills/ is user content and is never deleted (applies ADR-024)',
    ).toContain('SHADOW-OUT-OF-SCOPE');
    expect(await installedSkillDirs()).not.toContain(prefixSkillName('rust'));
  });

  it('selecting the plugin wakes the dormant shadow', async () => {
    await writeShadow('rust', '# mine\nSHADOW-WAKES\n');
    const dormant = await run({ plugins: [plugin('devflow-explore')], isPartialInstall: false });
    expect(dormant.dormantShadows).toContain('rust');

    const awake = await run({
      plugins: [plugin('devflow-explore'), plugin('devflow-rust')],
      isPartialInstall: false,
    });
    expect(awake.dormantShadows).not.toContain('rust');
    expect(awake.shadowedSkills).toContain('rust');
  });
});

// ---------------------------------------------------------------------------
// The summary lines — the only place a user learns any of this happened
// ---------------------------------------------------------------------------

describe('formatSkillScopeSummary', () => {
  it('renders nothing when nothing moved', () => {
    expect(formatSkillScopeSummary({ removedSkills: [], dormantShadows: [] }, true)).toEqual([]);
  });

  it('names the removals and how to get them back — but only on an unchanged plugin list', () => {
    const report = { removedSkills: ['go', 'rust'], dormantShadows: [] };

    const unchanged = formatSkillScopeSummary(report, true);
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0].message).toContain('Removed 2 skill(s) no selected plugin requires: go, rust');
    expect(unchanged[0].message).toContain('Re-run devflow init and select the plugin that provides them');

    expect(
      formatSkillScopeSummary(report, false),
      'a user who deselected a plugin asked for the removal and needs no notice (L2)',
    ).toEqual([]);
  });

  it('reports each dormant shadow regardless of whether the plugin list moved', () => {
    for (const unchanged of [true, false]) {
      const lines = formatSkillScopeSummary({ removedSkills: [], dormantShadows: ['rust'] }, unchanged);
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toContain('Shadow for rust is inactive');
      expect(lines[0].message).toContain('the plugin that uses it is not selected');
    }
  });
});

describe('formatTrackerAssetSummary', () => {
  const base = { installedRefs: 0, removedRefs: 0, agent: 'unchanged' as const };

  it('always names the active provider', () => {
    const lines = formatTrackerAssetSummary({ provider: 'jira', previous: 'jira', isDefault: false, ...base });
    expect(lines[0].message).toContain('Tracker: jira');
  });

  it('marks an unchosen default as such', () => {
    const lines = formatTrackerAssetSummary({ provider: 'github', previous: undefined, isDefault: true, ...base });
    expect(lines[0].message).toContain('Tracker: github');
    expect(lines[0].message).toContain('(default)');
  });

  it('states the previous provider on a change or a self-heal', () => {
    const lines = formatTrackerAssetSummary({ provider: 'github', previous: 'jira', isDefault: true, ...base });
    expect(lines[0].message).toContain('(was jira)');
    expect(lines[0].message, 'a change is not a default').not.toContain('(default)');
  });

  it('states the asset delta only when something moved', () => {
    expect(
      formatTrackerAssetSummary({ provider: 'github', previous: 'github', isDefault: true, ...base }),
    ).toHaveLength(1);

    const moved = formatTrackerAssetSummary({
      provider: 'jira',
      previous: 'github',
      isDefault: false,
      installedRefs: 24,
      removedRefs: 0,
      agent: 'installed',
    });
    expect(moved).toHaveLength(2);
    expect(moved[1].message).toContain('+24 reference(s)');
    expect(moved[1].message).toContain('tracker agent installed');
  });

  it('names the agent removal on the way back to github', () => {
    const lines = formatTrackerAssetSummary({
      provider: 'github',
      previous: 'linear',
      isDefault: true,
      installedRefs: 13,
      removedRefs: 11,
      agent: 'removed',
    });
    expect(lines[1].message).toContain('−11 reference(s)');
    expect(lines[1].message).toContain('tracker agent removed');
  });
});
