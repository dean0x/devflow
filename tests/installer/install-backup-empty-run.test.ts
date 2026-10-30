/**
 * A backup session that moves nothing leaves nothing behind: no run folder, no backup root the
 * session made, and no parent folder that a failed move made inside the run folder. A folder that
 * holds anything is never removed. Every test works in a temp home with the clock and the random
 * bytes injected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createBackupSession,
  createPathSet,
  type BackupSession,
  type BackupSessionOptions,
} from '../../src/targets/claude-code/install-backup.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

const CLOCK = new Date(Date.UTC(2026, 9, 30, 4, 55, 13, 987));
const RUN_NAME = '20261030T045513Z-a0a1a2a3';

const clock = (): Date => CLOCK;
const stampBytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => 0xa0 + i);

const shipped = createPathSet(['commands/devflow/a.md', 'skills/devflow:git/SKILL.md']);
const retired = createPathSet([]);

let home: string;
let claudeDir: string;
let devflowDir: string;
let backupRoot: string;
let runFolder: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
  assertTempHome(home);
  console.log(`install-backup test home: ${await fs.realpath(home)}`);
  claudeDir = path.join(home, 'claude');
  devflowDir = path.join(home, 'devflow');
  backupRoot = path.join(devflowDir, 'install-backups');
  runFolder = path.join(backupRoot, RUN_NAME);
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

const at = (rel: string): string => path.join(claudeDir, ...rel.split('/'));
const inRun = (rel: string): string => path.join(runFolder, ...rel.split('/'));
const exists = (target: string): Promise<boolean> => fs.lstat(target).then(() => true, () => false);

async function put(rel: string, text = rel): Promise<string> {
  const target = at(rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
  return target;
}

function open(overrides: Partial<BackupSessionOptions> = {}): BackupSession {
  return createBackupSession({ shipped, retired, claudeDir, devflowDir, now: clock, bytes: stampBytes, ...overrides });
}

/** Every entry below `dir` as a sorted list of relative paths, folders suffixed with a slash. */
async function tree(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(`${child}/`, ...(await tree(dir, child)));
    else out.push(child);
  }
  return out;
}

/** Make every rename out of the Claude dir fail with `code`, and let any other rename run. */
function refuseEveryMove(code = 'EXDEV'): void {
  const realRename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(from).startsWith(claudeDir + path.sep)) throw Object.assign(new Error('refused'), { code });
    return realRename(from, to);
  });
}

describe('a run in which every move fails', () => {
  it('leaves no backup root and no run folder, and keeps the files where they are', async () => {
    const one = await put('commands/devflow/one.md');
    const two = await put('commands/devflow/two.md');
    const deep = await put('skills/devflow:git/mine.md');
    refuseEveryMove();
    const session = open();

    await session.prepass([at('commands/devflow'), at('skills/devflow:git')]);

    expect(await exists(backupRoot)).toBe(false);
    expect(session.snapshot().runFolder).toBeNull();
    expect(session.snapshot().moved).toEqual([]);
    expect(session.snapshot().failures).toEqual([
      { path: one, action: 'move', reason: 'EXDEV' },
      { path: two, action: 'move', reason: 'EXDEV' },
      { path: deep, action: 'move', reason: 'EXDEV' },
    ]);
    for (const file of [one, two, deep]) expect(await exists(file)).toBe(true);
  });

  it('adds no run folder to a backup root that an earlier run made, however many runs fail', async () => {
    await fs.mkdir(path.join(backupRoot, 'earlier-run'), { recursive: true });
    await fs.writeFile(path.join(backupRoot, 'earlier-run', 'kept.txt'), 'kept');
    await put('commands/devflow/one.md');
    refuseEveryMove();

    for (let run = 0; run < 3; run++) {
      const bytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, () => run + 1);
      await open({ bytes }).prepass([at('commands/devflow')]);
    }

    expect(await fs.readdir(backupRoot)).toEqual(['earlier-run']);
    expect(await fs.readFile(path.join(backupRoot, 'earlier-run', 'kept.txt'), 'utf8')).toBe('kept');
  });

  it('works the same through a whole-entry move', async () => {
    const mine = await put('skills/mine-skill/SKILL.md');
    refuseEveryMove('EACCES');
    const session = open();

    const result = await session.moveWhole(path.dirname(mine));

    expect(result).toEqual({ status: 'kept', reason: 'EACCES' });
    expect(await exists(backupRoot)).toBe(false);
    expect(await exists(mine)).toBe(true);
  });

  it('makes no run folder at all when the file changed after the scan', async () => {
    const victim = await put('commands/devflow/victim.md', 'original');
    const realLstat = fs.lstat.bind(fs);
    let seen = 0;
    vi.spyOn(fs, 'lstat').mockImplementation(async (target, opts) => {
      if (target === victim && ++seen === 2) {
        const swap = `${victim}.swap`;
        await fs.writeFile(swap, 'replacement');
        await fs.rename(swap, victim);
      }
      return realLstat(target, opts);
    });
    const session = open();

    await session.prepass([at('commands/devflow')]);

    expect(seen).toBe(2);
    expect(await exists(backupRoot)).toBe(false);
    expect(session.snapshot().runFolder).toBeNull();
    expect(session.snapshot().failures).toEqual([{ path: victim, action: 'move', reason: 'changed-since-scan' }]);
  });
});

describe('a run in which one move fails after another succeeded', () => {
  it('removes the parent folders of the failed move and keeps those of the move that worked', async () => {
    const worked = await put('commands/devflow/one.md', 'one');
    const stuck = await put('skills/devflow:git/mine.md', 'mine');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === stuck) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      return realRename(from, to);
    });
    const session = open();

    await session.prepass([at('commands/devflow'), at('skills/devflow:git')]);

    expect(await tree(runFolder)).toEqual(['commands/', 'commands/devflow/', 'commands/devflow/one.md']);
    expect(await fs.readFile(inRun('commands/devflow/one.md'), 'utf8')).toBe('one');
    expect(await fs.readFile(stuck, 'utf8')).toBe('mine');
    expect(await exists(worked)).toBe(false);
    expect(session.snapshot().runFolder).toBe(runFolder);
  });

  it('makes a new run folder for a move that works after an empty one was dropped', async () => {
    const stuck = await put('commands/devflow/across.md', 'across');
    const fine = await put('commands/devflow/fine.md', 'fine');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === stuck) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      return realRename(from, to);
    });
    const session = open();

    await session.prepass([at('commands/devflow')]);

    expect(await tree(runFolder)).toEqual(['commands/', 'commands/devflow/', 'commands/devflow/fine.md']);
    expect(await fs.readdir(backupRoot)).toEqual([RUN_NAME]);
    expect(await exists(fine)).toBe(false);
    expect(session.snapshot().runFolder).toBe(runFolder);
  });
});

describe('a folder that holds something', () => {
  it('stays, at the run folder and at a parent folder of the failed move', async () => {
    const stuck = await put('commands/devflow/mine.md', 'mine');
    vi.spyOn(fs, 'rename').mockImplementation(async from => {
      if (from === stuck) {
        await fs.writeFile(inRun('commands/devflow/late-note.txt'), 'put here while the move ran');
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      throw new Error('unexpected rename');
    });
    const session = open();

    await session.prepass([at('commands/devflow')]);

    expect(await tree(runFolder)).toEqual(['commands/', 'commands/devflow/', 'commands/devflow/late-note.txt']);
    expect(session.snapshot().runFolder).toBe(runFolder);
    expect(session.snapshot().failures).toEqual([{ path: stuck, action: 'move', reason: 'EXDEV' }]);
  });

  it('is never removed with a recursive call', async () => {
    await put('commands/devflow/one.md');
    refuseEveryMove();
    const rm = vi.spyOn(fs, 'rm');

    await open().prepass([at('commands/devflow')]);

    expect(rm).not.toHaveBeenCalled();
  });
});

describe('an empty run folder that cannot be removed', () => {
  it('is named as a failure, and the run goes on', async () => {
    const stuck = await put('commands/devflow/mine.md', 'mine');
    refuseEveryMove();
    const realRmdir = fs.rmdir.bind(fs);
    vi.spyOn(fs, 'rmdir').mockImplementation(async target => {
      if (target === runFolder) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realRmdir(target);
    });
    const session = open();

    await session.prepass([at('commands/devflow')]);

    expect(session.snapshot().failures).toEqual([
      { path: stuck, action: 'move', reason: 'EXDEV' },
      { path: runFolder, action: 'remove', reason: 'EACCES' },
    ]);
    expect(await exists(stuck)).toBe(true);
  });
});

describe('a backup root the session made', () => {
  it('is removed again when the run folder cannot be made', async () => {
    const one = await put('commands/devflow/one.md');
    const realMkdir = fs.mkdir.bind(fs);
    vi.spyOn(fs, 'mkdir').mockImplementation(async (target, opts) => {
      if (String(target).startsWith(backupRoot + path.sep)) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realMkdir(target, opts);
    });
    const session = open();

    await session.prepass([at('commands/devflow')]);

    expect(await exists(backupRoot)).toBe(false);
    expect(await exists(devflowDir)).toBe(true);
    expect(session.snapshot().rootRefusal).toEqual({ path: runFolder, reason: 'EACCES' });
    expect(await exists(one)).toBe(true);
  });

  it('stays when an earlier run made it', async () => {
    await fs.mkdir(backupRoot, { recursive: true });
    await put('commands/devflow/one.md');
    const realMkdir = fs.mkdir.bind(fs);
    vi.spyOn(fs, 'mkdir').mockImplementation(async (target, opts) => {
      if (String(target).startsWith(backupRoot + path.sep)) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realMkdir(target, opts);
    });

    await open().prepass([at('commands/devflow')]);

    expect(await fs.readdir(backupRoot)).toEqual([]);
  });
});
