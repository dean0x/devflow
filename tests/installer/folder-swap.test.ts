/**
 * The swap of a folder devflow owns (`swapFolderIn`), at the compliance skill folder and its fixed
 * aside name `skills/devflow:compliance.old`: the failure branches that leave a file of the user's
 * where it is, and the file at the aside name that a rename must never replace.
 *
 * Every test works in a temp home, with the clock and the random bytes injected through the backup
 * session, and nothing here reads or writes the real home.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { swapFolderIn, type FolderSwapOutcome } from '../../src/targets/claude-code/folder-swap.js';
import { copyDirectory } from '../../src/targets/claude-code/installer.js';
import { newLinkReport, type LinkReport } from '../../src/targets/claude-code/linked-folder.js';
import { assertTempHome } from '../setup/home-isolation.js';
import { at, exists, makeHome, onlyRunFolder, openSession, put, removeHome, type TestHome } from './install-backup-harness.js';

let home: TestHome;

beforeEach(async () => {
  home = await makeHome();
  assertTempHome(home.home);
  console.log(`folder-swap test home: ${await fs.realpath(home.home)}`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await removeHome(home);
});

const SKILL = 'skills/devflow:compliance';
const ASIDE = `${SKILL}.old`;
const STAGED = '.devflow-compliance-staged.tmp';

const MERGED_BYTES = 'merged shipped bytes\n';
const STAGED_BYTES = 'new shipped bytes\n';

interface SwapRun {
  readonly links: LinkReport;
  readonly merged: () => number;
  readonly swap: () => Promise<FolderSwapOutcome>;
}

interface SwapSetup {
  /** The files of the staged folder, by path below it. Without it the staged folder holds `SKILL.md`. */
  readonly staged?: Readonly<Record<string, string>>;
  /** What a merge does. Without it the merge writes `MERGED_BYTES` into `SKILL.md`. */
  readonly merge?: (target: string, staged: string) => Promise<void>;
}

/** One `swapFolderIn` over the compliance paths. The merge counts its calls. */
async function prepareSwap(setup: SwapSetup = {}): Promise<SwapRun> {
  const stagedFiles = setup.staged ?? { 'SKILL.md': STAGED_BYTES };
  for (const [rel, text] of Object.entries(stagedFiles)) await put(home, `${STAGED}/${rel}`, text);
  const backups = await openSession(home);
  const links = newLinkReport();
  let mergeCalls = 0;
  return {
    links,
    merged: () => mergeCalls,
    swap: () => swapFolderIn({
      backups,
      target: at(home, SKILL),
      staged: at(home, STAGED),
      aside: at(home, ASIDE),
      links,
      mergeInto: async () => {
        mergeCalls += 1;
        if (setup.merge !== undefined) return setup.merge(at(home, SKILL), at(home, STAGED));
        await fs.mkdir(at(home, SKILL), { recursive: true });
        await fs.writeFile(path.join(at(home, SKILL), 'SKILL.md'), MERGED_BYTES);
      },
    }),
  };
}

/** Make `fs.rename` throw for the calls that `fails` accepts; every other call goes through. */
function failRename(fails: (from: string, to: string, call: number) => boolean): void {
  const realRename = fs.rename.bind(fs);
  let call = 0;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    call += 1;
    if (fails(String(from), String(to), call)) throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' });
    return realRename(from, to);
  });
}

const read = (target: string): Promise<string> => fs.readFile(target, 'utf8');

/** The error a swap throws, or null when it finishes. */
async function thrownBy(swap: () => Promise<FolderSwapOutcome>): Promise<Error | null> {
  try {
    await swap();
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

describe('an aside folder left by an earlier run that holds a file which cannot move', () => {
  it('merges the shipped files into the target and keeps the file and the target as they are', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    await put(home, `${ASIDE}/mine.md`, 'my note in the aside\n');
    failRename(from => path.basename(from) === 'mine.md');
    const run = await prepareSwap();

    const outcome = await run.swap();

    expect(outcome).toBe('merged');
    expect(run.merged()).toBe(1);
    expect(await read(at(home, `${ASIDE}/mine.md`)), 'the file in the aside keeps its bytes').toBe('my note in the aside\n');
    expect(await read(at(home, `${SKILL}/SKILL.md`)), 'the shipped file is current').toBe(MERGED_BYTES);
    expect(await exists(at(home, STAGED)), 'the staged folder was not renamed in').toBe(true);
  });
});

describe('a merge into a folder that keeps a file of the user', () => {
  const REFERENCE = 'references/detection.md';

  it('leaves the old shipped file in place when the copy of the new files fails part-way', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    await put(home, `${SKILL}/mine.md`, 'my note\n');
    failRename(from => path.basename(from) === 'mine.md');
    const run = await prepareSwap({
      merge: async target => {
        await fs.mkdir(path.join(target, 'references'), { recursive: true });
        await fs.writeFile(path.join(target, 'references', 'part.md'), 'half of a new file');
        throw Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' });
      },
    });

    const error = await thrownBy(run.swap);

    expect(error?.message).toContain('ENOSPC: injected');
    expect(run.merged()).toBe(1);
    expect(await read(at(home, `${SKILL}/SKILL.md`)), 'the old shipped file keeps its bytes').toBe('an old SKILL.md\n');
    expect(await read(at(home, `${SKILL}/mine.md`)), 'the file of the user stays').toBe('my note\n');
  });

  it('writes the new files, removes the listed leftovers that the new folder lacks and keeps the file', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    await put(home, `${SKILL}/${REFERENCE}`, 'an old reference\n');
    await put(home, `${SKILL}/.DS_Store`, 'junk\n');
    await put(home, `${SKILL}/references/.DS_Store`, 'junk\n');
    await put(home, `${SKILL}/mine.md`, 'my note\n');
    failRename(from => path.basename(from) === 'mine.md');
    const run = await prepareSwap({
      staged: { 'SKILL.md': STAGED_BYTES, [REFERENCE]: 'a new reference\n' },
      merge: (target, staged) => copyDirectory(staged, target),
    });

    const outcome = await run.swap();

    expect(outcome).toBe('merged');
    expect(await read(at(home, `${SKILL}/SKILL.md`)), 'the shipped file is the new one').toBe(STAGED_BYTES);
    expect(await read(at(home, `${SKILL}/${REFERENCE}`)), 'the nested shipped file is the new one').toBe('a new reference\n');
    expect(await exists(at(home, `${SKILL}/.DS_Store`)), 'the junk file goes').toBe(false);
    expect(await exists(at(home, `${SKILL}/references/.DS_Store`)), 'the nested junk file goes').toBe(false);
    expect(await read(at(home, `${SKILL}/mine.md`)), 'the file of the user stays').toBe('my note\n');
  });
});

describe('a failed rename of the staged folder', () => {
  it('puts the old folder back with its bytes and throws the error of the rename', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    failRename((from, to) => from === at(home, STAGED) && to === at(home, SKILL));
    const run = await prepareSwap();

    const error = await thrownBy(run.swap);

    expect(error?.message).toContain('EACCES: injected');
    expect(await read(at(home, `${SKILL}/SKILL.md`)), 'the old folder is back').toBe('an old SKILL.md\n');
    expect(await exists(at(home, ASIDE)), 'nothing waits in the aside').toBe(false);
    expect(await read(at(home, `${STAGED}/SKILL.md`)), 'the staged folder is untouched').toBe(STAGED_BYTES);
    expect(run.links.replacedLinks).toEqual([]);
  });

  it('names the aside path when the old folder cannot be put back, and keeps the old folder there', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    failRename((from, to) => to === at(home, SKILL) && (from === at(home, STAGED) || from === at(home, ASIDE)));
    const run = await prepareSwap();

    const error = await thrownBy(run.swap);

    expect(error?.message).toContain('could not be put back');
    expect(error?.message).toContain(`is kept at ${at(home, ASIDE)}`);
    expect(await read(at(home, `${ASIDE}/SKILL.md`)), 'the old folder keeps its bytes at the aside').toBe('an old SKILL.md\n');
    expect(await exists(at(home, SKILL))).toBe(false);
  });
});

describe('a file at the aside name', () => {
  async function linkTarget(): Promise<string> {
    const outside = path.join(home.home, 'outside-skill');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, 'keep.md'), 'outside bytes\n');
    await fs.mkdir(path.dirname(at(home, SKILL)), { recursive: true });
    await fs.symlink(outside, at(home, SKILL));
    return outside;
  }

  it('moves to the backup folder before a link target is moved aside, and the swap goes on', async () => {
    const outside = await linkTarget();
    await put(home, ASIDE, 'a file of mine at the aside name\n');
    const run = await prepareSwap();

    const outcome = await run.swap();

    expect(outcome).toBe('swapped');
    expect(run.links.replacedLinks).toEqual([at(home, SKILL)]);
    expect(await read(at(home, `${SKILL}/SKILL.md`)), 'a real folder stands at the target').toBe(STAGED_BYTES);
    expect(await read(path.join(outside, 'keep.md')), 'what the link pointed to is as it was').toBe('outside bytes\n');
    expect(await exists(at(home, ASIDE))).toBe(false);
    const saved = path.join(await onlyRunFolder(home), ...ASIDE.split('/'));
    expect(await read(saved), 'the file is in the backup folder with its bytes').toBe('a file of mine at the aside name\n');
  });

  it('stays where it is, with the link, when it cannot move', async () => {
    const outside = await linkTarget();
    await put(home, ASIDE, 'a file of mine at the aside name\n');
    failRename(from => from === at(home, ASIDE));
    const run = await prepareSwap();

    const error = await thrownBy(run.swap);

    expect(error, 'the swap cannot finish').not.toBeNull();
    expect(error?.message).toContain(at(home, ASIDE));
    expect(await read(at(home, ASIDE)), 'the file keeps its bytes').toBe('a file of mine at the aside name\n');
    expect((await fs.lstat(at(home, SKILL))).isSymbolicLink(), 'the link stays').toBe(true);
    expect(await read(path.join(outside, 'keep.md'))).toBe('outside bytes\n');
    expect(run.links.replacedLinks).toEqual([]);
    expect(await exists(at(home, STAGED)), 'the staged folder was not renamed in').toBe(true);
  });

  it('moves to the backup folder before a real target is swapped', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    await put(home, ASIDE, 'a file of mine at the aside name\n');
    const run = await prepareSwap();

    const outcome = await run.swap();

    expect(outcome).toBe('swapped');
    expect(run.merged()).toBe(0);
    expect(await read(at(home, `${SKILL}/SKILL.md`))).toBe(STAGED_BYTES);
    const saved = path.join(await onlyRunFolder(home), ...ASIDE.split('/'));
    expect(await read(saved)).toBe('a file of mine at the aside name\n');
  });

  it('keeps a real target in place and merges when it cannot move', async () => {
    await put(home, `${SKILL}/SKILL.md`, 'an old SKILL.md\n');
    await put(home, ASIDE, 'a file of mine at the aside name\n');
    failRename(from => from === at(home, ASIDE));
    const run = await prepareSwap();

    const outcome = await run.swap();

    expect(outcome).toBe('merged');
    expect(await read(at(home, ASIDE)), 'the file keeps its bytes').toBe('a file of mine at the aside name\n');
    expect(await read(at(home, `${SKILL}/SKILL.md`))).toBe(MERGED_BYTES);
  });
});
