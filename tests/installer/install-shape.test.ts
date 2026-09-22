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
  isPluginListUnchanged,
} from '../../src/cli/commands/install-report.js';
import { installedReferenceManifest, SKILL_REFS_SKILL_NAME } from "../../src/core/mds-variants.js";
import { convergeTrackerArtifacts } from '../../src/targets/claude-code/tracker-install.js';
import {
  DEVFLOW_PLUGINS,
  FEATURE_OWNED_SKILLS,
  buildAssetMaps,
  buildScopedSkillsMap,
  getAllAgentNames,
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

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

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
  trackerProvider?: string;
}) {
  const effective = opts.effectivePlugins ?? opts.plugins;
  return installViaFileCopy({
    plugins: opts.plugins,
    effectivePlugins: effective,
    claudeDir,
    devflowDir,
    skillsMap: buildScopedSkillsMap(effective),
    agentsMap: new Map(),
    trackerProvider: opts.trackerProvider ?? 'github',
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
    // Composed rather than spelled inline: tests/skill-references.test.ts scans
    // every tests/**/*.ts for a `devflow:` name that is not a registry skill,
    // which is exactly what this probe needs on DISK and must not leave in
    // SOURCE. The directory name is byte-identical either way.
    const foreign = `${prefixSkillName('not-a-registry-skill')}`;
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
    // Composed, for the same reason as the foreign-directory probe below.
    const retired = `${prefixSkillName('retired-skill-probe')}`;
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

  // -------------------------------------------------------------------------
  // The OTHER half of L2: the answer, not the rendering of it.
  //
  // Every arm above hands `pluginListUnchanged` in as a boolean. What decides
  // that boolean — a prior manifest exists AND its plugin set equals this run's —
  // lived inline in init.ts with nothing executing it, so the renderer could be
  // exhaustively covered while the predicate feeding it was wrong in either
  // direction: a first install explaining an upgrade nobody had, or a re-init
  // deleting skills and saying nothing.
  // -------------------------------------------------------------------------

  describe('isPluginListUnchanged (L2)', () => {
    it('a first install is never "unchanged", even when the selection is empty both ways', () => {
      expect(
        isPluginListUnchanged(null, ['devflow-plan']),
        'no prior manifest means nothing was removed from this user — the notice would explain ' +
        'an upgrade they did not have',
      ).toBe(false);
      expect(
        isPluginListUnchanged(null, []),
        'and the empty case is the one a set comparison alone gets wrong: ∅ equals ∅',
      ).toBe(false);
    });

    it('equal SETS are unchanged — order and duplicates are not a different selection', () => {
      expect(isPluginListUnchanged(['devflow-plan', 'devflow-explore'], ['devflow-plan', 'devflow-explore'])).toBe(true);
      expect(
        isPluginListUnchanged(['devflow-explore', 'devflow-plan'], ['devflow-plan', 'devflow-explore']),
        'order is an artifact of how the selection was assembled',
      ).toBe(true);
      expect(
        isPluginListUnchanged(['devflow-plan', 'devflow-plan'], ['devflow-plan']),
        'a duplicate in the manifest is a manifest detail, not a second plugin',
      ).toBe(true);
      expect(isPluginListUnchanged([], [])).toBe(true);
    });

    it('any difference in either direction is a change', () => {
      expect(
        isPluginListUnchanged(['devflow-plan'], ['devflow-plan', 'devflow-explore']),
        'an ADDED plugin moved the selection',
      ).toBe(false);
      expect(
        isPluginListUnchanged(['devflow-plan', 'devflow-explore'], ['devflow-plan']),
        'a DESELECTED plugin is the case the notice must stay silent for — the removal is what ' +
        'the user asked for',
      ).toBe(false);
      expect(
        isPluginListUnchanged(['devflow-plan'], ['devflow-explore']),
        'same size, different members',
      ).toBe(false);
    });

    it('feeds the renderer: the same manifest that is unchanged is the one that gets the line', () => {
      const report = { removedSkills: ['rust'], dormantShadows: [] };
      const prior = ['devflow-plan'];

      expect(
        formatSkillScopeSummary(report, isPluginListUnchanged(prior, ['devflow-plan'])),
        'a re-init on the same selection that deleted a skill has to say so',
      ).toHaveLength(1);
      expect(
        formatSkillScopeSummary(report, isPluginListUnchanged(null, ['devflow-plan'])),
        'a first install that removed the same skill has nothing to explain',
      ).toEqual([]);
    });
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

// ---------------------------------------------------------------------------
// The pre-clean vs the reference overlay — who owns `references/` on a full install
// ---------------------------------------------------------------------------

/**
 * A full re-init must be idempotent over the generated reference tree.
 *
 * The pre-clean empties every skill directory this run rewrites, and the overlay then
 * converges `references/` onto the manifest. If the pre-clean takes the overlay-owned
 * subtree with it, the overlay has nothing left to compare against and force-promotes
 * every unit — so a re-init that changed nothing still reports the whole manifest as
 * installed, and `unchangedRefs` can never be non-empty in an install (QA S2).
 *
 * The arms below pin BOTH halves of the ownership split: what the pre-clean must leave
 * for the overlay, and what it must still take.
 */
describe('a full re-init leaves the overlay-owned reference tree for the overlay to converge', () => {
  const core = (): PluginDefinition[] => [plugin('devflow-core-skills')];
  const refsRoot = (): string =>
    path.join(claudeDir, 'skills', prefixSkillName(SKILL_REFS_SKILL_NAME), 'references');
  const jiraManifest = (): string[] => [...installedReferenceManifest({ provider: 'jira' })].sort();

  async function installJira() {
    return run({ plugins: core(), isPartialInstall: false, trackerProvider: 'jira' });
  }

  it('the FIRST install writes every reference; the SECOND writes none and reports them unchanged', async () => {
    const first = await installJira();
    expect([...first.overlaidRefs].sort(), 'a fresh install writes the whole install set').toEqual(jiraManifest());
    expect(first.unchangedRefs).toEqual([]);

    const second = await installJira();
    expect(
      second.overlaidRefs,
      'nothing changed between the two runs, so nothing may be written',
    ).toEqual([]);
    expect([...second.unchangedRefs].sort()).toEqual(jiraManifest());
  });

  it('a hand-edited reference is restored on the next run and REPORTED as written', async () => {
    await installJira();
    const edited = jiraManifest().find(r => r.startsWith('tracker/jira/'));
    if (edited === undefined) throw new Error('the jira install set has no provider reference');
    const editedPath = path.join(refsRoot(), edited);
    const canonical = await fs.readFile(editedPath, 'utf-8');
    await fs.writeFile(editedPath, 'hand-edited\n', 'utf-8');

    const report = await installJira();

    expect(await fs.readFile(editedPath, 'utf-8'), 'drift is converged away').toBe(canonical);
    expect(report.overlaidRefs, 'and reported, never hidden behind an unchanged count').toContain(edited);
    expect(report.unchangedRefs).not.toContain(edited);
  });

  it('a stale file the manifest does not name is pruned from the tracker subtree (converge, not merge)', async () => {
    await installJira();
    const stale = path.join(refsRoot(), 'tracker', 'jira', 'not-in-the-manifest.md');
    await fs.writeFile(stale, 'left by an older build\n', 'utf-8');

    await installJira();

    await expect(fs.access(stale)).rejects.toThrow();
  });

  it('a stale file OUTSIDE the overlay-owned set is still removed by the pre-clean', async () => {
    await installJira();
    const straySkillFile = path.join(claudeDir, 'skills', prefixSkillName(SKILL_REFS_SKILL_NAME), 'SKILL.md.bak');
    const strayReference = path.join(refsRoot(), 'stale.md');
    await fs.writeFile(straySkillFile, 'from a previous install\n', 'utf-8');
    await fs.writeFile(strayReference, 'a reference no manifest names\n', 'utf-8');

    await installJira();

    await expect(fs.access(straySkillFile)).rejects.toThrow();
    await expect(
      fs.access(strayReference),
      'the references ROOT is not the overlay\'s to prune, so the pre-clean has to reach it',
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Who owns agents/devflow/tracker.md
// ---------------------------------------------------------------------------

/**
 * The Tracker agent is `convergeTrackerArtifacts`'s file, not the agent loop's.
 *
 * The agent stays DECLARED in `devflow-core-skills.agents` — the roster floor and the
 * reverse-spawn guards both key on the registry — but its presence on disk is
 * conditional on the provider, and exactly one owner may decide that (plan A3). While
 * the generic copy loop also wrote it, every install did the work twice and the two
 * owners disagreed in both directions: a github re-run reported `tracker agent removed`
 * for a file only that same run had put there, and a fresh jira install never reported
 * `installed` because converge found the loop's byte-identical copy already in place.
 *
 * The arms below pin the split from the loop's side. The converge side — both
 * directions of the biconditional — is tests/tracker-install.test.ts.
 */
describe('the agent copy loop leaves the Tracker agent to convergeTrackerArtifacts', () => {
  const everyPlugin = (): PluginDefinition[] => [...DEVFLOW_PLUGINS];
  const trackerAgentFile = (): string => path.join(claudeDir, 'agents', 'devflow', 'tracker.md');

  async function installedAgents(): Promise<string[]> {
    try { return (await fs.readdir(path.join(claudeDir, 'agents', 'devflow'))).sort(); }
    catch { return []; }
  }

  /** Every declared agent but the Tracker agent, as installed filenames. */
  const everyOtherAgent = (): string[] =>
    getAllAgentNames().filter(name => name !== 'tracker').map(name => `${name}.md`).sort();

  async function installAll(trackerProvider: string) {
    return installViaFileCopy({
      plugins: everyPlugin(),
      effectivePlugins: everyPlugin(),
      claudeDir,
      devflowDir,
      skillsMap: buildScopedSkillsMap(everyPlugin()),
      agentsMap: buildAssetMaps(everyPlugin()).agentsMap,
      trackerProvider,
      isPartialInstall: false,
      spinner: noopSpinner,
      warn: (msg) => { warnings.push(msg); },
    });
  }

  it.each(['github', 'jira'] as const)(
    'writes every other agent and never the Tracker agent (provider %s)',
    async (provider) => {
      await installAll(provider);

      expect(
        await exists(trackerAgentFile()),
        'the loop has no business deciding a provider-conditional file',
      ).toBe(false);
      expect(
        await installedAgents(),
        'and skipping one agent must not cost any of the others',
      ).toEqual(everyOtherAgent());
    },
  );

  it('converge is what puts the agent there under jira', async () => {
    await installAll('jira');
    expect(await exists(trackerAgentFile())).toBe(false);

    const result = await convergeTrackerArtifacts({
      claudeDir,
      provider: 'jira',
      warn: (msg) => { warnings.push(msg); },
    });

    expect(result.agent, 'a fresh install has an agent to announce').toBe('installed');
    expect(await exists(trackerAgentFile())).toBe(true);
  });

  it('a re-install leaves a converged Tracker agent standing for converge to compare', async () => {
    await installAll('jira');
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn: () => {} });
    const converged = await fs.readFile(trackerAgentFile(), 'utf-8');

    await installAll('jira');

    // Both halves of the carve-out, and the reason for it: converge reports
    // `unchanged` only if there is still an installed copy to compare against.
    expect(
      await exists(trackerAgentFile()),
      'the pre-clean empties the directory AROUND it and the sweep keys on the full registry',
    ).toBe(true);
    expect(await fs.readFile(trackerAgentFile(), 'utf-8')).toBe(converged);

    const second = await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn: () => {} });
    expect(second.agent, 'a steady-state re-init has nothing to announce').toBe('unchanged');
  });

  it('everything else in the agent directory still goes', async () => {
    await installAll('jira');
    await convergeTrackerArtifacts({ claudeDir, provider: 'jira', warn: () => {} });
    const stray = path.join(claudeDir, 'agents', 'devflow', 'from-an-older-install.md');
    await fs.writeFile(stray, 'from a previous install\n', 'utf-8');

    await installAll('jira');

    await expect(fs.access(stray)).rejects.toThrow();
    expect(await exists(trackerAgentFile())).toBe(true);
  });
});
