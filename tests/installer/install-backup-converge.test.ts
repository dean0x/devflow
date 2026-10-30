/**
 * The converge steps under the backup session: the curation and compliance toggles, the init
 * converge and a reference converge keep a file of the user's, move it to the backup folder at the
 * same relative path with the same bytes, and name it. A shipped file is never moved, and a
 * compliance-off converge leaves no posting file under the home or the backup folder.
 *
 * Every test works in a temp home, with the clock and the random bytes injected through the backup
 * session, and nothing here reads or writes the real home. The converge reads the built references
 * (`npm run build` first).
 */
import * as p from '@clack/prompts';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatBackupSummary } from '../../src/cli/commands/install-report.js';
import { runRulesEnable } from '../../src/cli/commands/rules.js';
import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../src/core/compliance-off-files.js';
import { writeManifest } from '../../src/core/manifest.js';
import { installedReferenceManifest } from '../../src/core/mds-variants.js';
import { getAllRuleNames } from '../../src/core/plugins.js';
import { convergeVariantAxes, type ConvergeVariantAxesResult, type VariantMachineState } from '../../src/targets/claude-code/curation-install.js';
import type { BackupSession } from '../../src/targets/claude-code/install-backup.js';
import { convergeReferences } from '../../src/targets/claude-code/reference-converge.js';
import { removeRulesFolder } from '../../src/targets/claude-code/rules-folder.js';
import { assertTempHome } from '../setup/home-isolation.js';
import {
  DEFAULT_PLUGINS,
  at,
  backupRootOf,
  exists,
  filesBelow,
  makeHome,
  onlyRunFolder,
  openSession,
  put,
  removeHome,
  runInstall,
  treeSnapshot,
  type TestHome,
} from './install-backup-harness.js';

let home: TestHome;
let warnings: string[];

beforeEach(async () => {
  home = await makeHome();
  assertTempHome(home.home);
  console.log(`install-backup-converge test home: ${await fs.realpath(home.home)}`);
  warnings = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await removeHome(home);
});

const warn = (message: string): void => { warnings.push(message); };
const inRun = (run: string, rel: string): string => path.join(run, ...rel.split('/'));
const SKILL_APPLY = 'skills/devflow:apply-decisions';
const SKILL_COMPLIANCE = 'skills/devflow:compliance';
const REFERENCES = 'skills/devflow:git/references';

function machine(curation: boolean, compliance: boolean, rules: boolean): VariantMachineState {
  return { features: { curation, compliance: { enabled: compliance, frameworks: [] }, rules } };
}

async function converge(curation: boolean, compliance: boolean, backups: BackupSession, rules = false): Promise<ConvergeVariantAxesResult> {
  return convergeVariantAxes({
    claudeDir: home.claudeDir,
    devflowDir: home.devflowDir,
    manifest: machine(curation, compliance, rules),
    plugins: DEFAULT_PLUGINS,
    warn,
    backups,
  });
}

/** The lines the command prints for the session's record. */
const summaryOf = (backups: BackupSession): string =>
  formatBackupSummary(backups.snapshot()).map(line => line.message).join('\n');

/** Plant a file of the user's, move check: it leaves its place, keeps its bytes in the run folder and is named. */
async function expectKept(rel: string, text: string, backups: BackupSession): Promise<void> {
  expect(await exists(at(home, rel)), `${rel} left its folder`).toBe(false);
  const run = await onlyRunFolder(home);
  expect(await fs.readFile(inRun(run, rel), 'utf8'), `${rel} kept its bytes`).toBe(text);
  expect(summaryOf(backups)).toContain(`${at(home, rel)} -> ${inRun(run, rel)}`);
}

/** Every file below the home, the backup folder included, as absolute paths. */
async function everyFile(): Promise<string[]> {
  return (await filesBelow(home.home)).map(rel => path.join(home.home, rel));
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('shipped and variant files', () => {
  /** Files that stay under every toggle: the tracker agent, the feature rules and a skill shadow. */
  const STAYING: Readonly<Record<string, string>> = {
    'agents/devflow/tracker.md': 'tracker agent bytes\n',
    'rules/devflow/behavior.md': 'behavior rule bytes\n',
  };

  async function seedStaying(): Promise<string> {
    for (const [rel, text] of Object.entries(STAYING)) await put(home, rel, text);
    const shadow = path.join(home.devflowDir, 'skills', 'apply-decisions');
    await fs.mkdir(shadow, { recursive: true });
    await fs.writeFile(path.join(shadow, 'SKILL.md'), 'a shadow of mine\n');
    return shadow;
  }

  async function expectStaying(shadow: string): Promise<void> {
    for (const [rel, text] of Object.entries(STAYING)) {
      expect(await fs.readFile(at(home, rel), 'utf8'), `${rel} stays`).toBe(text);
    }
    expect(await fs.readFile(path.join(shadow, 'SKILL.md'), 'utf8'), 'the shadow stays').toBe('a shadow of mine\n');
    expect(await exists(at(home, `${SKILL_COMPLIANCE}/SKILL.md`)), 'the compliance skill stays').toBe(true);
  }

  it('compliance on then off removes the posting files by name and bytes, and moves nothing', async () => {
    await runInstall(home, { shape: 'full' });
    const posted = new Map<string, string>();
    for (const entry of COMPLIANCE_OFF_REMOVED_SKILL_FILES) {
      const file = at(home, `skills/${entry}`);
      expect(await exists(file), `precondition: ${entry} is installed`).toBe(true);
      posted.set(entry, sha256(await fs.readFile(file)));
    }
    const shadow = await seedStaying();
    await put(home, 'rules/devflow/compliance.md', 'compliance rule bytes\n');
    const backups = await openSession(home);

    const result = await converge(true, false, backups);

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(result.posting).toEqual({ kind: 'clear' });
    for (const entry of COMPLIANCE_OFF_REMOVED_SKILL_FILES) {
      expect(await exists(at(home, `skills/${entry}`)), `${entry} is removed`).toBe(false);
    }
    const names = new Set(COMPLIANCE_OFF_REMOVED_SKILL_FILES.map(entry => path.basename(entry)));
    const remaining = await everyFile();
    expect(remaining.filter(file => names.has(path.basename(file)))).toEqual([]);
    const hashes = new Set(posted.values());
    for (const file of remaining) {
      expect(hashes.has(sha256(await fs.readFile(file))), `${file} holds no posting bytes`).toBe(false);
    }
    expect(backups.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
    expect(await exists(at(home, 'rules/devflow/compliance.md')), 'the compliance rule goes with the switch, as before').toBe(false);
    await expectStaying(shadow);
  });

  it('curation off then on moves no shipped file and leaves the other files in place', async () => {
    await runInstall(home, { shape: 'full' });
    expect(await exists(at(home, `${SKILL_APPLY}/SKILL.md`)), 'precondition: the curation skill is installed').toBe(true);
    const shadow = await seedStaying();
    await put(home, 'rules/devflow/compliance.md', 'compliance rule bytes\n');
    const backups = await openSession(home);

    const off = await converge(false, true, backups, true);

    expect(off.converged, warnings.join('\n')).toBe(true);
    expect(off.skill).toBe('removed');
    expect(await exists(at(home, SKILL_APPLY))).toBe(false);
    expect(backups.snapshot().moved).toEqual([]);

    const on = await converge(true, true, backups, true);

    expect(on.converged, warnings.join('\n')).toBe(true);
    expect(on.skill).toBe('installed');
    expect(await exists(at(home, `${SKILL_APPLY}/SKILL.md`))).toBe(true);
    expect(await exists(at(home, 'rules/devflow/compliance.md')), 'the compliance rule stays').toBe(true);
    expect(backups.snapshot().moved).toEqual([]);
    expect(backups.snapshot().failures).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
    await expectStaying(shadow);
  });

  it('a second converge of the same state moves nothing and leaves no folder behind', async () => {
    await runInstall(home, { shape: 'full' });
    const backups = await openSession(home);

    await converge(true, true, backups);
    await converge(true, true, backups);

    expect(backups.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
    const claude = await fs.readdir(home.claudeDir);
    expect(claude.filter(entry => entry.startsWith('.devflow-'))).toEqual([]);
    expect((await fs.readdir(at(home, 'skills'))).filter(entry => /\.(tmp|old)$/.test(entry))).toEqual([]);
  });
});

describe('each converge keeps one file of the user and names it', () => {
  it('a reference converge, with compliance off and on', async () => {
    await runInstall(home, { shape: 'full' });
    const mineTracker = `${REFERENCES}/tracker/mine-notes.md`;
    const minePr = `${REFERENCES}/pr/mine-pr.md`;
    await put(home, mineTracker, 'my tracker notes\n');
    await put(home, minePr, 'my pr notes\n');
    const backups = await openSession(home);

    const result = await convergeReferences({
      claudeDir: home.claudeDir, devflowDir: home.devflowDir, compliance: false, warn, backups,
    });

    expect(result.converged, warnings.join('\n')).toBe(true);
    await expectKept(mineTracker, 'my tracker notes\n', backups);
    await expectKept(minePr, 'my pr notes\n', backups);
    expect(result.removed.some(name => name.endsWith('mine-notes.md') || name.endsWith('mine-pr.md'))).toBe(false);

    await put(home, mineTracker, 'my second tracker notes\n');
    const again = await openSession(home);
    const enabled = await convergeReferences({
      claudeDir: home.claudeDir, devflowDir: home.devflowDir, compliance: true, warn, backups: again,
    });
    expect(enabled.converged, warnings.join('\n')).toBe(true);
    expect(await exists(at(home, mineTracker))).toBe(false);
    expect(summaryOf(again)).toContain(at(home, mineTracker));
  });

  it('reports a leftover of devflow that the prune removed, and moves nothing', async () => {
    await runInstall(home, { shape: 'full' });
    const shippedOp = installedReferenceManifest({ compliance: false }).find(rel => /^tracker\/[^/]+$/.test(rel));
    if (shippedOp === undefined) throw new Error('the manifest holds no tracker reference');
    const leftover = `${REFERENCES}/${shippedOp}.tmp.4242`;
    await put(home, leftover, 'an interrupted write left this\n');
    const backups = await openSession(home);

    const result = await convergeReferences({
      claudeDir: home.claudeDir, devflowDir: home.devflowDir, compliance: false, warn, backups,
    });

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(result.removed).toContain(`devflow:git/references/${shippedOp}.tmp.4242`);
    expect(await exists(at(home, leftover))).toBe(false);
    expect(backups.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });

  it('curation disable', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, `${SKILL_APPLY}/mine.md`, 'my note on decisions\n');
    const backups = await openSession(home);

    const result = await converge(false, true, backups);

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(result.skill).toBe('removed');
    expect(await exists(at(home, SKILL_APPLY)), 'the folder is gone').toBe(false);
    await expectKept(`${SKILL_APPLY}/mine.md`, 'my note on decisions\n', backups);
  });

  it('curation enable', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, `${SKILL_APPLY}/mine.md`, 'my note on decisions\n');
    const backups = await openSession(home);

    const result = await converge(true, true, backups);

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(result.skill).toBe('installed');
    expect(await exists(at(home, `${SKILL_APPLY}/SKILL.md`))).toBe(true);
    await expectKept(`${SKILL_APPLY}/mine.md`, 'my note on decisions\n', backups);
  });

  it.each([['disable', false], ['enable', true]] as const)('compliance %s', async (_label, enabled) => {
    await runInstall(home, { shape: 'full', compliance: !enabled });
    await converge(true, !enabled, await openSession(home));
    await put(home, `${SKILL_COMPLIANCE}/mine.md`, 'my compliance note\n');
    await put(home, `${SKILL_COMPLIANCE}/references/mine-ref.md`, 'my reference\n');
    const backups = await openSession(home);

    const result = await converge(true, enabled, backups);

    expect(result.compliance.converged, warnings.join('\n')).toBe(true);
    expect(await exists(at(home, `${SKILL_COMPLIANCE}/SKILL.md`)), 'the skill stands').toBe(true);
    await expectKept(`${SKILL_COMPLIANCE}/mine.md`, 'my compliance note\n', backups);
    await expectKept(`${SKILL_COMPLIANCE}/references/mine-ref.md`, 'my reference\n', backups);
    expect((await fs.readdir(at(home, 'skills'))).filter(entry => /\.(tmp|old)$/.test(entry))).toEqual([]);
  });
});

describe('a file that cannot move', () => {
  function failRenameOf(fileName: string): void {
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(from)) === fileName) throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' });
      return realRename(from, to);
    });
  }

  it('compliance: the swap is skipped, the shipped files are written into the folder and the file stays', async () => {
    await runInstall(home, { shape: 'full' });
    await converge(true, true, await openSession(home));
    const skill = at(home, `${SKILL_COMPLIANCE}/SKILL.md`);
    const shipped = await fs.readFile(skill, 'utf8');
    await fs.writeFile(skill, 'an old SKILL.md\n');
    await put(home, `${SKILL_COMPLIANCE}/mine.md`, 'my compliance note\n');
    failRenameOf('mine.md');
    const backups = await openSession(home);

    const result = await converge(true, true, backups);

    expect(result.compliance.converged, warnings.join('\n')).toBe(true);
    expect(await fs.readFile(at(home, `${SKILL_COMPLIANCE}/mine.md`), 'utf8'), 'the file stays where it is').toBe('my compliance note\n');
    expect(await fs.readFile(skill, 'utf8'), 'the shipped file is current').toBe(shipped);
    expect(backups.snapshot().failures).toEqual([
      { path: at(home, `${SKILL_COMPLIANCE}/mine.md`), action: 'move', reason: 'EACCES' },
    ]);
    expect(summaryOf(backups)).toContain('Could not move');
    expect((await fs.readdir(at(home, 'skills'))).filter(entry => /\.(tmp|old)$/.test(entry))).toEqual([]);
  });

  it('compliance: a file in the aside folder of an earlier run stays, the swap is skipped and the shipped files are current', async () => {
    await runInstall(home, { shape: 'full' });
    await converge(true, true, await openSession(home));
    const skill = at(home, `${SKILL_COMPLIANCE}/SKILL.md`);
    const shipped = await fs.readFile(skill, 'utf8');
    await fs.writeFile(skill, 'an old SKILL.md\n');
    await put(home, `${SKILL_COMPLIANCE}.old/mine.md`, 'my note from an earlier run\n');
    failRenameOf('mine.md');
    const backups = await openSession(home);

    const result = await converge(true, true, backups);

    expect(result.compliance.converged, warnings.join('\n')).toBe(true);
    expect(await fs.readFile(at(home, `${SKILL_COMPLIANCE}.old/mine.md`), 'utf8'), 'the file stays in the aside folder').toBe('my note from an earlier run\n');
    expect(await fs.readFile(skill, 'utf8'), 'the shipped file is current').toBe(shipped);
    expect((await fs.lstat(at(home, SKILL_COMPLIANCE))).isDirectory(), 'the target stays a real folder').toBe(true);
    expect(backups.snapshot().failures).toEqual([
      { path: at(home, `${SKILL_COMPLIANCE}.old/mine.md`), action: 'move', reason: 'EACCES' },
    ]);
  });

  it('curation enable: the swap is skipped, the shipped files are written into the folder and the file stays', async () => {
    await runInstall(home, { shape: 'full' });
    const skill = at(home, `${SKILL_APPLY}/SKILL.md`);
    const shipped = await fs.readFile(skill, 'utf8');
    await fs.writeFile(skill, 'an old SKILL.md\n');
    await put(home, `${SKILL_APPLY}/mine.md`, 'my note\n');
    failRenameOf('mine.md');
    const backups = await openSession(home);

    const result = await converge(true, true, backups);

    expect(result.skill).toBe('installed');
    expect(await fs.readFile(at(home, `${SKILL_APPLY}/mine.md`), 'utf8')).toBe('my note\n');
    expect(await fs.readFile(skill, 'utf8')).toBe(shipped);
    expect((await fs.readdir(home.claudeDir)).filter(entry => entry.startsWith('.devflow-curation-'))).toEqual([]);
  });

  it('curation disable: the shipped files go, the folder and the file stay, and the converge says so', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, `${SKILL_APPLY}/mine.md`, 'my note\n');
    failRenameOf('mine.md');
    const backups = await openSession(home);

    const result = await converge(false, true, backups);

    expect(result.skill).toBe('failed');
    expect(result.converged).toBe(false);
    expect(warnings.join('\n')).toContain(at(home, SKILL_APPLY));
    expect(await fs.readFile(at(home, `${SKILL_APPLY}/mine.md`), 'utf8')).toBe('my note\n');
    expect(await exists(at(home, `${SKILL_APPLY}/SKILL.md`)), 'the shipped file is removed').toBe(false);
  });

  it('a file in the place of a skill folder moves whole and the skill is installed', async () => {
    await runInstall(home, { shape: 'full' });
    await fs.rm(at(home, SKILL_APPLY), { recursive: true });
    await put(home, SKILL_APPLY, 'a file where the folder goes\n');
    const backups = await openSession(home);

    const result = await converge(true, true, backups);

    expect(result.skill).toBe('installed');
    expect(await exists(at(home, `${SKILL_APPLY}/SKILL.md`))).toBe(true);
    const run = await onlyRunFolder(home);
    expect(await fs.readFile(inRun(run, SKILL_APPLY), 'utf8')).toBe('a file where the folder goes\n');
  });
});

describe('a file of the user in a references unit folder, when its move fails', () => {
  const UNITS = ['pr', 'tracker/github'] as const;

  function refuseMove(from: string): void {
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, to) => {
      if (source === from) throw Object.assign(new Error('EXDEV: injected'), { code: 'EXDEV' });
      return realRename(source, to);
    });
  }

  it.each(UNITS)('a reference converge keeps it in references/%s with its folder', async unit => {
    await runInstall(home, { shape: 'full' });
    const folder = at(home, `${REFERENCES}/${unit}`);
    // With compliance off the manifest omits some operation files, which the converge prunes.
    const shippedNames = installedReferenceManifest({ compliance: false })
      .filter(rel => rel.startsWith(`${unit}/`))
      .map(rel => path.basename(rel));
    const mine = await put(home, `${REFERENCES}/${unit}/mine-note.md`, 'my note\n');
    refuseMove(mine);
    const backups = await openSession(home);

    const result = await convergeReferences({
      claudeDir: home.claudeDir, devflowDir: home.devflowDir, compliance: false, warn, backups,
    });

    expect(result.converged, warnings.join('\n')).toBe(true);
    expect(await fs.readFile(mine, 'utf8'), 'the file keeps its bytes').toBe('my note\n');
    expect(await filesBelow(folder), 'the folder keeps its files').toEqual([...shippedNames, 'mine-note.md'].sort());
    expect(backups.snapshot().failures).toEqual([{ path: mine, action: 'move', reason: 'EXDEV' }]);
    expect(backups.snapshot().moved).toEqual([]);
    expect(summaryOf(backups)).toContain('Could not move');
  });
});

describe('a skills folder that is a link, with an earlier install of devflow below it', () => {
  async function linkSkillsFolder(): Promise<{ readonly slot: string; readonly outside: string }> {
    await runInstall(home, { shape: 'full' });
    const outside = path.join(home.home, 'outside-skills');
    const slot = at(home, 'skills');
    await fs.rename(slot, outside);
    await fs.symlink(outside, slot);
    for (const rel of [
      'devflow:git/references/pr/mine-note.md',
      'devflow:git/references/tracker/github/mine-note.md',
      'devflow:apply-decisions/mine-note.md',
      'devflow:compliance/mine-note.md',
    ]) {
      const target = path.join(outside, ...rel.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `my file ${rel}\n`);
    }
    await fs.writeFile(path.join(outside, 'devflow:git', 'references', 'pr', 'check-ci-status.md'), 'a stale copy\n');
    return { slot, outside };
  }

  it.each([true, false])('a reference converge changes nothing in the folder the link points to (compliance %s)', async compliance => {
    const { outside } = await linkSkillsFolder();
    const before = await treeSnapshot(outside);
    const backups = await openSession(home);

    const result = await convergeReferences({ claudeDir: home.claudeDir, devflowDir: home.devflowDir, compliance, warn, backups });

    expect(await treeSnapshot(outside)).toEqual(before);
    expect(result.converged).toBe(false);
    expect(result.rewritten).toEqual([]);
    expect(result.unproven, 'with compliance off the converge cannot prove the posting files are gone').toBe(!compliance);
    expect(warnings.join('\n')).toContain(at(home, 'skills'));
    expect(backups.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });

  it.each([
    { curation: true, compliance: true },
    { curation: false, compliance: true },
    { curation: true, compliance: false },
    { curation: false, compliance: false },
  ])('the variant converge changes nothing in the folder the link points to (curation $curation, compliance $compliance)', async ({ curation, compliance }) => {
    const { slot, outside } = await linkSkillsFolder();
    const before = await treeSnapshot(outside);
    const backups = await openSession(home);

    const result = await converge(curation, compliance, backups);

    expect(await treeSnapshot(outside)).toEqual(before);
    expect(result.converged).toBe(false);
    expect(result.skill).toBe('failed');
    expect(result.compliance.refusedFolders).toContain(slot);
    expect(result.compliance.converged).toBe(false);
    expect(result.references.converged).toBe(false);
    expect(backups.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});

describe('one run folder for the install and the converge', () => {
  it('makes at most one run folder when both steps move a file', async () => {
    await runInstall(home, { shape: 'full' });
    await put(home, 'commands/devflow/mine-command.md', 'my command\n');
    await put(home, `${SKILL_COMPLIANCE}/mine-notes.md`, 'my compliance note\n');
    const backups = await openSession(home);

    await runInstall(home, { shape: 'full', backups });
    expect(backups.snapshot().moved.map(unit => unit.original)).toEqual([at(home, 'commands/devflow/mine-command.md')]);
    await converge(true, true, backups);

    const root = backupRootOf(home);
    if (root === null) throw new Error('no backup folder was made');
    expect(await fs.readdir(root), 'one run folder').toHaveLength(1);
    const run = await onlyRunFolder(home);
    expect(await fs.readFile(inRun(run, 'commands/devflow/mine-command.md'), 'utf8')).toBe('my command\n');
    expect(await fs.readFile(inRun(run, `${SKILL_COMPLIANCE}/mine-notes.md`), 'utf8')).toBe('my compliance note\n');
    expect(backups.snapshot().runFolder).toBe(run);
  });
});

describe('the rules folder', () => {
  const RULES = 'rules/devflow';
  const shippedRule = (): string => `${RULES}/${getAllRuleNames()[0]}.md`;

  async function seedManifest(): Promise<void> {
    await writeManifest(home.devflowDir, {
      version: '2.0.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: {
        ambient: false, memory: false, hud: false, knowledge: false, learning: false, rules: true, proxy: false,
        flags: [], compliance: { enabled: false, frameworks: [] },
      },
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }

  it('removeRulesFolder moves a file of the user, removes the shipped rules and the folder, and names the move', async () => {
    await put(home, shippedRule(), 'a shipped rule\n');
    await put(home, `${RULES}/mine-rule.md`, 'my rule\n');
    const backups = await openSession(home);

    expect(await removeRulesFolder(at(home, RULES), backups)).toBe('removed');

    expect(await exists(at(home, RULES)), 'the folder is gone').toBe(false);
    await expectKept(`${RULES}/mine-rule.md`, 'my rule\n', backups);
    expect(backups.snapshot().retiredRemoved, 'a shipped rule is removed without a record').toEqual([]);
  });

  it('removeRulesFolder keeps the folder when the move of a file fails', async () => {
    await put(home, `${RULES}/mine-rule.md`, 'my rule\n');
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('EACCES: injected'), { code: 'EACCES' }));
    const backups = await openSession(home);

    expect(await removeRulesFolder(at(home, RULES), backups)).toBe('kept');

    expect(await fs.readFile(at(home, `${RULES}/mine-rule.md`), 'utf8')).toBe('my rule\n');
    expect(backups.snapshot().failures).toEqual([{ path: at(home, `${RULES}/mine-rule.md`), action: 'move', reason: 'EACCES' }]);
  });

  it('removeRulesFolder unlinks a link, leaves what it points to, and refuses a file in the folder\'s place', async () => {
    const outside = path.join(home.home, 'outside-rules');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'mine-rule.md'), 'in another place\n');
    await fs.mkdir(at(home, 'rules'), { recursive: true });
    await fs.symlink(outside, at(home, RULES));
    const backups = await openSession(home);

    expect(await removeRulesFolder(at(home, RULES), backups)).toBe('unlinked');
    expect(await exists(at(home, RULES))).toBe(false);
    expect(await fs.readFile(path.join(outside, 'mine-rule.md'), 'utf8')).toBe('in another place\n');

    await fs.writeFile(at(home, RULES), 'a file in the way\n');
    expect(await removeRulesFolder(at(home, RULES), backups)).toBe('refused');
    expect(await fs.readFile(at(home, RULES), 'utf8')).toBe('a file in the way\n');
    expect(await removeRulesFolder(at(home, 'rules/absent'), backups)).toBe('absent');
  });

  it('rules --enable moves a file of the user out of the rules folder, names it and installs the rules', async () => {
    await seedManifest();
    await put(home, `${RULES}/mine-rule.md`, 'my rule\n');
    const infos: string[] = [];
    vi.spyOn(p.log, 'info').mockImplementation(message => { infos.push(String(message)); });
    vi.spyOn(p.log, 'success').mockImplementation(() => undefined);
    vi.spyOn(p.log, 'warn').mockImplementation(() => undefined);
    const backups = await openSession(home);

    await runRulesEnable(home.claudeDir, home.devflowDir, backups);

    await expectKept(`${RULES}/mine-rule.md`, 'my rule\n', backups);
    const run = await onlyRunFolder(home);
    expect(infos.join('\n')).toContain(`${at(home, `${RULES}/mine-rule.md`)} -> ${inRun(run, `${RULES}/mine-rule.md`)}`);
    expect((await fs.readdir(at(home, RULES))).length, 'the rules are installed').toBeGreaterThan(0);
    expect(await exists(at(home, `${RULES}/mine-rule.md`))).toBe(false);
  });
});
