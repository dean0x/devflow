/**
 * What the install does when a move or a removal cannot go as planned, and what it does at a root
 * that is a link or not a folder: a link of the user's moves as a link, a refused move leaves the
 * file and its folder, a file that appears after the scan stays, and a refused root gets no move and
 * no removal. Every test works in a temp home, with the clock and the random bytes injected through
 * the backup session, and nothing here reads or writes the real home.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sweepLegacySkillFolders } from '../../src/cli/commands/legacy-sweep.js';
import { formatBackupSummary } from '../../src/cli/commands/install-report.js';
import { RETIRED_SHIPPED } from '../../src/core/retired-shipped-names.js';
import { createBackupSession, createPathSet, type BackupSession } from '../../src/targets/claude-code/install-backup.js';
import { LEGACY_SKILL_NAMES } from '../../src/targets/claude-code/legacy.js';
import { FIXTURE_FOLDER } from '../fixtures/workflow-folder.js';
import { testBackups } from '../helpers.js';
import { assertTempHome } from '../setup/home-isolation.js';
import {
  at,
  backupRootOf,
  exists,
  filesBelow,
  firstPrefixedLegacyName,
  makeHome,
  onlyRunFolder,
  openSession,
  put,
  removeHome,
  runInstall,
  treeSnapshot,
  type TestHome,
  USER_SKILL_FOLDER,
} from './install-backup-harness.js';

let home: TestHome;

beforeEach(async () => {
  home = await makeHome();
  assertTempHome(home.home);
  console.log(`install-backup-failures test home: ${await fs.realpath(home.home)}`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await removeHome(home);
});

const inRun = (run: string, rel: string): string => path.join(run, ...rel.split('/'));
const relativeToClaude = (target: string): string => path.relative(home.claudeDir, target).split(path.sep).join('/');
const warnLines = (report: { backups: Parameters<typeof formatBackupSummary>[0] }): string[] =>
  formatBackupSummary(report.backups).filter(line => line.level === 'warn').map(line => line.message);

describe('a link of the user', () => {
  it('moves as a link with its text unchanged and leaves the file it points to alone', async () => {
    await runInstall(home, { shape: 'full' });
    const outside = path.join(home.home, 'outside');
    await fs.mkdir(outside);
    const pointedTo = path.join(outside, 'target.txt');
    await fs.writeFile(pointedTo, 'the file the links point to\n');
    const before = await fs.stat(pointedTo);
    const relativeText = path.join('..', '..', '..', 'outside', 'target.txt');
    const absoluteLink = at(home, 'commands/devflow/mine-absolute.md');
    const relativeLink = at(home, 'commands/devflow/mine-relative.md');
    await fs.symlink(pointedTo, absoluteLink);
    await fs.symlink(relativeText, relativeLink);

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    for (const [link, text] of [[absoluteLink, pointedTo], [relativeLink, relativeText]] as const) {
      const moved = inRun(run, relativeToClaude(link));
      expect((await fs.lstat(moved)).isSymbolicLink(), `${link} moved as a link`).toBe(true);
      expect(await fs.readlink(moved), `${link} kept its text`).toBe(text);
      expect(await exists(link), `${link} left its folder`).toBe(false);
    }
    expect(report.backups.moved.map(unit => [unit.original, unit.kind]).sort()).toEqual([
      [absoluteLink, 'link'],
      [relativeLink, 'link'],
    ]);
    const after = await fs.stat(pointedTo);
    expect(await fs.readFile(pointedTo, 'utf8')).toBe('the file the links point to\n');
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('is not walked when it stands at a root, and the install replaces it as it always did', async () => {
    await runInstall(home, { shape: 'full' });
    const outside = path.join(home.home, 'outside-commands');
    await fs.mkdir(path.join(outside, 'nested'), { recursive: true });
    await fs.writeFile(path.join(outside, 'mine.md'), 'mine\n');
    await fs.writeFile(path.join(outside, 'nested', 'deep.md'), 'deep\n');
    await fs.writeFile(path.join(outside, `${RETIRED_SHIPPED.commands[0]}.md`), 'a retired name, in another place\n');
    const slot = at(home, 'commands/devflow');
    await fs.rm(slot, { recursive: true });
    await fs.symlink(outside, slot);
    const before = await treeSnapshot(outside);

    const report = await runInstall(home, { shape: 'full' });

    expect(await treeSnapshot(outside), 'nothing moved or removed in the folder the link points to').toEqual(before);
    expect(report.replacedLinks).toContain(slot);
    expect((await fs.lstat(slot)).isDirectory(), 'a real folder stands where the link was').toBe(true);
    expect(report.backups.moved).toEqual([]);
    expect(report.backups.retiredRemoved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});

describe('a move that is refused', () => {
  it('keeps the file and its folder, moves the rest, completes and warns once per file (EACCES)', async () => {
    await runInstall(home, { shape: 'full' });
    const stuckCommand = await put(home, 'commands/devflow/stuck.md', 'stuck command\n');
    const stuckAgent = await put(home, 'agents/devflow/stuck.md', 'stuck agent\n');
    const fineCommand = await put(home, 'commands/devflow/fine.md', 'fine command\n');
    const fineRule = await put(home, 'rules/devflow/fine.md', 'fine rule\n');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === stuckCommand || from === stuckAgent) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return realRename(from, to);
    });

    const report = await runInstall(home, { shape: 'full' });

    const run = await onlyRunFolder(home);
    expect(await fs.readFile(stuckCommand, 'utf8')).toBe('stuck command\n');
    expect(await fs.readFile(stuckAgent, 'utf8')).toBe('stuck agent\n');
    expect(await filesBelow(at(home, 'commands/devflow')), 'the folder keeps the file and the install wrote into it').toContain('stuck.md');
    expect(await filesBelow(at(home, 'agents/devflow'))).toContain('stuck.md');
    expect(await exists(fineCommand)).toBe(false);
    expect(await exists(fineRule)).toBe(false);
    expect(await fs.readFile(inRun(run, 'commands/devflow/fine.md'), 'utf8')).toBe('fine command\n');
    expect(await fs.readFile(inRun(run, 'rules/devflow/fine.md'), 'utf8')).toBe('fine rule\n');
    expect([...report.backups.failures].sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual([
      { path: stuckAgent, action: 'move', reason: 'EACCES' },
      { path: stuckCommand, action: 'move', reason: 'EACCES' },
    ]);
    expect(report.overlayFailures).toEqual([]);

    const warnings = warnLines(report);
    expect(warnings).toHaveLength(2);
    for (const stuck of [stuckCommand, stuckAgent]) {
      expect(warnings.filter(message => message.includes(stuck)), `${stuck} is named once`).toHaveLength(1);
    }
  });

  it('leaves a file in place on EXDEV, names the reason and makes no copy', async () => {
    await runInstall(home, { shape: 'full' });
    const across = await put(home, 'commands/devflow/across.md', 'across\n');
    const fine = await put(home, 'commands/devflow/fine.md', 'fine\n');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === across) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      return realRename(from, to);
    });
    const copyFile = vi.spyOn(fs, 'copyFile');
    const cp = vi.spyOn(fs, 'cp');

    const report = await runInstall(home, { shape: 'full' });

    const backupRoot = path.join(home.devflowDir, 'install-backups');
    const intoBackups = (calls: ReadonlyArray<ReadonlyArray<unknown>>): unknown[][] =>
      calls.filter(call => String(call[1]).startsWith(backupRoot)).map(call => [...call]);
    expect(intoBackups(copyFile.mock.calls), 'no copy into the backup folder').toEqual([]);
    expect(intoBackups(cp.mock.calls), 'no recursive copy into the backup folder').toEqual([]);
    expect(await fs.readFile(across, 'utf8')).toBe('across\n');
    expect(report.backups.failures).toEqual([{ path: across, action: 'move', reason: 'EXDEV' }]);
    expect(warnLines(report).filter(message => message.includes(across) && message.includes('EXDEV'))).toHaveLength(1);
    const run = await onlyRunFolder(home);
    expect(await exists(fine)).toBe(false);
    expect(await filesBelow(run)).toEqual(['commands/devflow/fine.md']);
  });
});

describe('a file that appears after the scan', () => {
  it('stays, with its folder, and the run completes', async () => {
    await runInstall(home, { shape: 'full' });
    const commandsFolder = at(home, 'commands/devflow');
    const late = path.join(commandsFolder, 'late.md');
    const realUnlink = fs.unlink.bind(fs);
    let injected = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (!injected && String(target).startsWith(`${commandsFolder}${path.sep}`)) {
        injected = true;
        await fs.writeFile(late, 'added during the run\n');
      }
      return realUnlink(target);
    });

    const report = await runInstall(home, { shape: 'full' });

    expect(injected, 'the file was written between the scan and the removal').toBe(true);
    expect(await fs.readFile(late, 'utf8')).toBe('added during the run\n');
    expect(report.backups.failures).toEqual([]);
    expect(report.backups.moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});

describe('a root that is a link or not a folder', () => {
  it('gets no move and no removal when it is not a folder, while the other roots go on', async () => {
    await runInstall(home, { shape: 'full' });
    const slot = at(home, 'commands/devflow');
    await fs.rm(slot, { recursive: true });
    await fs.writeFile(slot, 'in the way\n');
    const retiredAgent = await put(home, `agents/devflow/${RETIRED_SHIPPED.agents[0]}.md`);
    const mineAgent = await put(home, 'agents/devflow/mine.md', 'mine\n');

    const report = await runInstall(home, { shape: 'full' });

    expect((await fs.lstat(slot)).isFile(), 'the file at the root stays a file').toBe(true);
    expect(await fs.readFile(slot, 'utf8')).toBe('in the way\n');
    expect(report.refusedFolders).toContain(slot);
    expect(await exists(retiredAgent), 'an exact-name removal in another root still runs').toBe(false);
    expect(report.backups.retiredRemoved).toContain(retiredAgent);
    expect(await exists(mineAgent)).toBe(false);
    const run = await onlyRunFolder(home);
    expect(await fs.readFile(inRun(run, 'agents/devflow/mine.md'), 'utf8')).toBe('mine\n');
    expect(report.backups.moved.map(unit => unit.original)).toEqual([mineAgent]);
  });

  it('gets no move and no removal when it is a link that stays, while the other roots go on', async () => {
    await runInstall(home, { shape: 'full' });
    const outside = path.join(home.home, 'outside-commands');
    await fs.mkdir(path.join(outside, 'nested'), { recursive: true });
    await fs.writeFile(path.join(outside, 'mine.md'), 'mine\n');
    await fs.writeFile(path.join(outside, 'nested', 'deep.md'), 'deep\n');
    await fs.writeFile(path.join(outside, `${RETIRED_SHIPPED.commands[0]}.md`), 'a retired name, in another place\n');
    const slot = at(home, 'commands/devflow');
    await fs.rm(slot, { recursive: true });
    await fs.symlink(outside, slot);
    const retiredAgent = await put(home, `agents/devflow/${RETIRED_SHIPPED.agents[0]}.md`);
    const before = await treeSnapshot(outside);

    const report = await runInstall(home, { shape: 'partial' });

    expect(await treeSnapshot(outside), 'the folder the link points to is as it was').toEqual(before);
    expect(await fs.readlink(slot)).toBe(outside);
    expect(report.refusedFolders).toContain(slot);
    expect(await exists(retiredAgent), 'an exact-name removal in another root still runs').toBe(false);
    expect(report.sweptOrphans).toContainEqual({ kind: 'agent', name: RETIRED_SHIPPED.agents[0] });
    expect(report.backups.moved).toEqual([]);
  });

  it('gets no move and no removal below a skills root that is a link, and says so', async () => {
    await runInstall(home, { shape: 'full' });
    const outside = path.join(home.home, 'outside-skills');
    await fs.mkdir(path.join(outside, `devflow:${USER_SKILL_FOLDER}`), { recursive: true });
    await fs.writeFile(path.join(outside, `devflow:${USER_SKILL_FOLDER}`, 'SKILL.md'), 'my skill\n');
    const slot = at(home, 'skills');
    await fs.rm(slot, { recursive: true });
    await fs.symlink(outside, slot);

    const report = await runInstall(home, { shape: 'full' });

    expect(await fs.readFile(path.join(outside, `devflow:${USER_SKILL_FOLDER}`, 'SKILL.md'), 'utf8')).toBe('my skill\n');
    expect((await fs.lstat(slot)).isSymbolicLink()).toBe(true);
    expect(report.backups.moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
    expect(report.refusedFolders.filter(folder => folder === slot), 'the skills root is named once').toHaveLength(1);
  });

  describe('with an earlier install of devflow below it', () => {
    /** The skills folder of the install, moved to another place and linked back, with a file of the user in each place devflow looks. */
    async function linkSkillsRootWithEarlierInstall(): Promise<{ readonly slot: string; readonly outside: string }> {
      await runInstall(home, { shape: 'full' });
      const outside = path.join(home.home, 'outside-skills');
      const slot = at(home, 'skills');
      await fs.rename(slot, outside);
      await fs.symlink(outside, slot);
      for (const rel of [
        'devflow:git/references/pr/mine-note.md',
        'devflow:git/references/tracker/github/mine-note.md',
        'devflow:git/references/mine-root-note.md',
        'devflow:git/mine-skill-note.md',
        'devflow:compliance/mine-note.md',
        `devflow:${USER_SKILL_FOLDER}/SKILL.md`,
      ]) {
        const target = path.join(outside, ...rel.split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `my file ${rel}\n`);
      }
      // A shipped file that differs from this release, so that a write below the link would show.
      await fs.writeFile(path.join(outside, 'devflow:git', 'references', 'pr', 'check-ci-status.md'), 'a stale copy\n');
      return { slot, outside };
    }

    it.each([
      { shape: 'full', compliance: true },
      { shape: 'partial', compliance: true },
      { shape: 'full', compliance: false },
    ] as const)('moves, removes and writes nothing in the folder the link points to ($shape install, compliance $compliance)', async ({ shape, compliance }) => {
      const { slot, outside } = await linkSkillsRootWithEarlierInstall();
      const before = await treeSnapshot(outside);

      const report = await runInstall(home, { shape, compliance });

      expect(await treeSnapshot(outside), 'the folder the link points to is as it was').toEqual(before);
      expect((await fs.lstat(slot)).isSymbolicLink()).toBe(true);
      expect(report.refusedFolders.filter(folder => folder === slot), 'the skills root is named once').toHaveLength(1);
      expect(report.backups.moved).toEqual([]);
      expect(report.backups.failures).toEqual([]);
      expect(backupRootOf(home)).toBeNull();
      expect(report.overlaidRefs).toEqual([]);
      expect(report.removedSkills).toEqual([]);
    });
  });
});

describe('a legacy skill folder whose move is refused', () => {
  const PREFIXED = firstPrefixedLegacyName();
  const denyMoveOf = (...stuck: string[]): void => {
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (stuck.includes(String(from))) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realRename(from, to);
    });
  };
  const warnings = (session: BackupSession): string[] =>
    formatBackupSummary(session.snapshot()).filter(line => line.level === 'warn').map(line => line.message);

  it('keeps a prefixed folder and its files after a full install, and warns once (EACCES)', async () => {
    await runInstall(home, { shape: 'full' });
    const folder = at(home, `skills/${PREFIXED}`);
    const kept = await put(home, `skills/${PREFIXED}/mine.md`, 'mine\n');
    const other = await put(home, 'skills/typescript/SKILL.md', 'an old bare skill\n');
    denyMoveOf(folder);
    const session = await openSession(home);

    await runInstall(home, { shape: 'full', backups: session });
    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    expect(await fs.readFile(kept, 'utf8'), 'the file stays in its folder').toBe('mine\n');
    expect(await exists(folder), 'the folder stays').toBe(true);
    expect(await exists(other), 'the other legacy folder still moves').toBe(false);
    expect(session.snapshot().failures).toEqual([{ path: folder, action: 'move', reason: 'EACCES' }]);
    expect(warnings(session).filter(message => message.includes(folder) && message.includes('EACCES'))).toHaveLength(1);
  });

  it('keeps the file and the folder of a listed legacy skill when the move of the file fails', async () => {
    const name = `devflow:${FIXTURE_FOLDER.name}`;
    const listed = `skills/${name}/SKILL.md`;
    const session = createBackupSession({
      shipped: createPathSet([]),
      retired: createPathSet([listed]),
      claudeDir: home.claudeDir,
      devflowDir: home.devflowDir,
      now: () => new Date(Date.UTC(2026, 9, 30, 12, 0, 0)),
      bytes: size => new Uint8Array(size).fill(9),
    });
    const listedFile = await put(home, listed);
    const mine = await put(home, `skills/${name}/mine.md`, 'mine\n');
    denyMoveOf(mine);

    await sweepLegacySkillFolders({
      claudeDir: home.claudeDir, backups: session, legacySkills: [name], retiredFiles: { [name]: ['SKILL.md'] },
    });

    expect(await fs.readFile(mine, 'utf8')).toBe('mine\n');
    expect(await exists(listedFile), 'the listed file is removed').toBe(false);
    expect(await exists(at(home, `skills/${name}`)), 'the folder stays with the file').toBe(true);
    expect(session.snapshot().failures).toEqual([{ path: mine, action: 'move', reason: 'EACCES' }]);
    expect(session.snapshot().retiredRemoved).toEqual([listedFile]);
  });

  it('moves nothing below a skills folder that is a link', async () => {
    await runInstall(home, { shape: 'full' });
    const outside = path.join(home.home, 'outside-skills');
    await fs.mkdir(path.join(outside, 'typescript'), { recursive: true });
    await fs.writeFile(path.join(outside, 'typescript', 'SKILL.md'), 'in another place\n');
    const slot = at(home, 'skills');
    await fs.rm(slot, { recursive: true });
    await fs.symlink(outside, slot);
    const before = await treeSnapshot(outside);
    const session = await openSession(home);

    await sweepLegacySkillFolders({ claudeDir: home.claudeDir, backups: session, legacySkills: LEGACY_SKILL_NAMES });

    expect(await treeSnapshot(outside)).toEqual(before);
    expect(session.snapshot().moved).toEqual([]);
    expect(backupRootOf(home)).toBeNull();
  });
});

describe('a file of the user in a references unit folder', () => {
  const REFERENCES = 'skills/devflow:git/references';
  /** The two folders the overlay swaps whole: the pr-host unit and one provider unit. */
  const UNITS = ['pr', 'tracker/github'] as const;

  /** Make the rename of `from` fail with `code`, and let every other rename run. */
  function refuseMove(from: string, code = 'EXDEV'): void {
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, to) => {
      if (source === from) throw Object.assign(new Error(`${code}: injected`), { code });
      return realRename(source, to);
    });
  }

  /** Overwrite one file devflow ships in `unit`, so that the next install has bytes to refresh there. */
  async function staleShippedFile(unit: string): Promise<{ readonly file: string; readonly shipped: Buffer }> {
    const folder = at(home, `${REFERENCES}/${unit}`);
    const [name] = await filesBelow(folder);
    const file = path.join(folder, name);
    const shipped = await fs.readFile(file);
    await fs.writeFile(file, 'a stale copy\n');
    return { file, shipped };
  }

  /** The scratch folders and files a swap leaves beside the live references. */
  async function scratchBelowReferences(): Promise<string[]> {
    return Object.keys(await treeSnapshot(at(home, REFERENCES))).filter(entry => /\.(old|tmp)\b/.test(entry));
  }

  it.each(UNITS)('stays in references/%s with its folder when its move fails (EXDEV)', async unit => {
    await runInstall(home, { shape: 'full' });
    const folder = at(home, `${REFERENCES}/${unit}`);
    const shippedNames = await filesBelow(folder);
    const stale = await staleShippedFile(unit);
    const mine = await put(home, `${REFERENCES}/${unit}/mine-note.md`, 'my note\n');
    refuseMove(mine);

    const report = await runInstall(home, { shape: 'full' });

    expect(await fs.readFile(mine, 'utf8'), 'the file keeps its bytes').toBe('my note\n');
    expect(await filesBelow(folder), 'the folder keeps its files').toEqual([...shippedNames, 'mine-note.md'].sort());
    expect((await fs.readFile(stale.file)).equals(stale.shipped), 'the shipped file is current').toBe(true);
    expect(report.backups.failures).toEqual([{ path: mine, action: 'move', reason: 'EXDEV' }]);
    expect(report.backups.moved).toEqual([]);
    expect(report.overlayFailures).toEqual([]);
    expect(await scratchBelowReferences()).toEqual([]);
    expect(warnLines(report).filter(message => message.includes(mine) && message.includes('EXDEV'))).toHaveLength(1);
  });

  it.each(UNITS)('stays in references/%s on the next run too, and the unit counts as unchanged', async unit => {
    await runInstall(home, { shape: 'full' });
    const mine = await put(home, `${REFERENCES}/${unit}/mine-note.md`, 'my note\n');
    refuseMove(mine);
    await runInstall(home, { shape: 'full' });

    const report = await runInstall(home, { shape: 'full' });

    expect(await fs.readFile(mine, 'utf8')).toBe('my note\n');
    expect(report.overlayFailures).toEqual([]);
    expect(report.overlaidRefs.filter(rel => rel.startsWith(`${unit}/`)), 'nothing was written').toEqual([]);
    expect(report.unchangedRefs.some(rel => rel.startsWith(`${unit}/`))).toBe(true);
  });

  it('stay in both folders when the backup root is refused, and the shipped files are refreshed', async () => {
    await runInstall(home, { shape: 'full' });
    const staleFiles = await Promise.all(UNITS.map(staleShippedFile));
    const mineFiles = await Promise.all(UNITS.map(unit => put(home, `${REFERENCES}/${unit}/mine-note.md`, `note in ${unit}\n`)));
    await fs.writeFile(path.join(home.devflowDir, 'install-backups'), 'in the way\n');

    const report = await runInstall(home, { shape: 'full' });

    expect(report.backups.rootRefusal?.reason).toBe('not-a-directory');
    for (const [index, mine] of mineFiles.entries()) {
      expect(await fs.readFile(mine, 'utf8')).toBe(`note in ${UNITS[index]}\n`);
      expect((await fs.readFile(staleFiles[index].file)).equals(staleFiles[index].shipped)).toBe(true);
    }
    expect(report.overlayFailures).toEqual([]);
    expect(await scratchBelowReferences()).toEqual([]);
  });

  it('stay in both folders when the references subtrees are over the entry cap, and nothing in them moves', async () => {
    await runInstall(home, { shape: 'full' });
    const staleFiles = await Promise.all(UNITS.map(staleShippedFile));
    const mineFiles = await Promise.all(UNITS.map(unit => put(home, `${REFERENCES}/${unit}/mine-note.md`, `note in ${unit}\n`)));
    const mineFlat = await put(home, `${REFERENCES}/tracker/mine-flat.md`, 'a flat note\n');
    const capped = await testBackups(home.home, { claudeDir: home.claudeDir, devflowDir: home.devflowDir, entryCap: 1 });

    const report = await runInstall(home, { shape: 'full', backups: capped });

    expect(report.backups.capHits.map(hit => hit.folder)).toContain(at(home, `${REFERENCES}/pr`));
    for (const [index, mine] of mineFiles.entries()) {
      expect(await fs.readFile(mine, 'utf8')).toBe(`note in ${UNITS[index]}\n`);
      expect((await fs.readFile(staleFiles[index].file)).equals(staleFiles[index].shipped)).toBe(true);
    }
    expect(await fs.readFile(mineFlat, 'utf8'), 'the prune moved nothing out of a capped folder').toBe('a flat note\n');
    expect(report.backups.moved.filter(unit => unit.original.startsWith(at(home, REFERENCES)))).toEqual([]);
    expect(report.overlayFailures).toEqual([]);
    expect(await scratchBelowReferences()).toEqual([]);
  });

  it.each(UNITS)('is moved, not deleted, when it appears in references/%s after the scan', async unit => {
    await runInstall(home, { shape: 'full' });
    const folder = at(home, `${REFERENCES}/${unit}`);
    const stale = await staleShippedFile(unit);
    const realRename = fs.rename.bind(fs);
    let injected = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, to) => {
      if (!injected && source === folder) {
        injected = true;
        await fs.writeFile(path.join(folder, 'late-note.md'), 'added during the run\n');
      }
      return realRename(source, to);
    });

    const report = await runInstall(home, { shape: 'full' });

    expect(injected, 'the file was written between the scan and the swap').toBe(true);
    expect((await fs.readFile(stale.file)).equals(stale.shipped)).toBe(true);
    const run = await onlyRunFolder(home);
    const kept = (await filesBelow(run)).filter(file => file.endsWith('/late-note.md'));
    expect(kept, 'the late file is in the backup folder').toHaveLength(1);
    expect(await fs.readFile(path.join(run, kept[0]), 'utf8')).toBe('added during the run\n');
    expect(report.backups.moved.map(unit => path.basename(unit.original))).toEqual(['late-note.md']);
    expect(report.overlayFailures).toEqual([]);
  });

  it('stays in a stranded .old folder of a provider when its move fails', async () => {
    await runInstall(home, { shape: 'full' });
    const stale = await staleShippedFile('tracker/github');
    const mine = await put(home, `${REFERENCES}/tracker/github.old/mine-note.md`, 'my note\n');
    refuseMove(mine);

    const report = await runInstall(home, { shape: 'full' });

    expect(await fs.readFile(mine, 'utf8')).toBe('my note\n');
    expect((await fs.readFile(stale.file)).equals(stale.shipped), 'the shipped file is current').toBe(true);
    expect(report.backups.failures).toEqual([{ path: mine, action: 'move', reason: 'EXDEV' }]);
    expect(report.overlayFailures).toEqual([]);
  });
});

describe('a folder over the entry cap', () => {
  const capped = (): Promise<BackupSession> =>
    testBackups(home.home, { claudeDir: home.claudeDir, devflowDir: home.devflowDir, entryCap: 1 });

  it.each(['agents', 'commands'] as const)('keeps a retired file and a file of the user in %s/devflow, and the sweep removes nothing', async kind => {
    await runInstall(home, { shape: 'full' });
    const retiredName = RETIRED_SHIPPED[kind][0];
    const retired = await put(home, `${kind}/devflow/${retiredName}.md`);
    const mine = await put(home, `${kind}/devflow/mine.md`, 'mine\n');

    const report = await runInstall(home, { shape: 'partial', backups: await capped() });

    expect(report.backups.capHits.map(hit => hit.folder), 'precondition: the folder is over the cap').toContain(at(home, `${kind}/devflow`));
    expect(await exists(retired), 'the retired file stays').toBe(true);
    expect(await fs.readFile(mine, 'utf8')).toBe('mine\n');
    expect(report.sweptOrphans).not.toContainEqual({ kind: kind === 'agents' ? 'agent' : 'command', name: retiredName });
    expect(report.backups.moved.filter(unit => unit.original.startsWith(at(home, `${kind}/devflow`)))).toEqual([]);
  });

  it('keeps a leftover of devflow in a references subtree, and the prune removes nothing from it', async () => {
    await runInstall(home, { shape: 'full' });
    const leftover = await put(home, 'skills/devflow:git/references/tracker/_contract.md.tmp.4242', 'an interrupted write left this\n');
    const mine = await put(home, 'skills/devflow:git/references/tracker/mine-flat.md', 'a flat note\n');

    const report = await runInstall(home, { shape: 'full', backups: await capped() });

    expect(report.backups.capHits.map(hit => hit.folder)).toContain(at(home, 'skills/devflow:git/references/tracker'));
    expect(await exists(leftover), 'the leftover stays').toBe(true);
    expect(await fs.readFile(mine, 'utf8')).toBe('a flat note\n');
    expect(report.sweptOrphans.filter(orphan => orphan.kind === 'reference')).toEqual([]);
  });
});

describe('the sweeps of the commands and agents folders', () => {
  it.each(['agents', 'commands'] as const)('remove a retired file of %s/devflow with unlink, never with a recursive rm', async kind => {
    await runInstall(home, { shape: 'full' });
    const retiredName = RETIRED_SHIPPED[kind][0];
    const retired = await put(home, `${kind}/devflow/${retiredName}.md`);
    const rm = vi.spyOn(fs, 'rm');

    const report = await runInstall(home, { shape: 'partial' });

    expect(await exists(retired), 'the retired file is removed').toBe(false);
    expect(report.sweptOrphans).toContainEqual({ kind: kind === 'agents' ? 'agent' : 'command', name: retiredName });
    expect(rm.mock.calls.filter(call => String(call[0]) === retired), 'no recursive removal of the file').toEqual([]);
  });
});
