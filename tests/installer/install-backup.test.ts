/**
 * The backup session (`install-backup.ts`) in isolation: what it classifies, what it moves, what it
 * removes and what it keeps when a step fails. Every test works in a temp home, with the clock and
 * the random bytes injected, and nothing here reads or writes the real home.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  classify,
  createBackupSession,
  createPathSet,
  DEFAULT_ENTRY_CAP,
  escapeName,
  formatCappedList,
  runFolderName,
  type BackupSession,
  type BackupSessionOptions,
} from '../../src/targets/claude-code/install-backup.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

const CLOCK = new Date(Date.UTC(2026, 9, 30, 4, 55, 13, 987));
const RUN_NAME = '20261030T045513Z-a0a1a2a3';

const clock = (): Date => CLOCK;
const stampBytes = (size: number): Uint8Array => Uint8Array.from({ length: size }, (_, i) => 0xa0 + i);

const shipped = createPathSet([
  'commands/devflow/a.md',
  'commands/devflow/b.md',
  'skills/devflow:git/SKILL.md',
  'skills/devflow:git/references/pr/ensure.md',
  'skills/devflow:compliance/SKILL.md',
]);
const retired = createPathSet(['commands/devflow/old.md', 'skills/devflow:old/SKILL.md']);
const sets = { shipped, retired };

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

const at =(rel: string): string => path.join(claudeDir, ...rel.split('/'));
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

/** Every file below `dir` as a sorted list of relative paths, folders suffixed with a slash. */
async function tree(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await fs.readdir(path.join(dir, rel), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(`${child}/`, ...(await tree(dir, child)));
    else out.push(child);
  }
  return out;
}

describe('classify', () => {
  it('puts a name in both sets under shipped', () => {
    const both = createPathSet(['commands/devflow/x.md']);
    expect(classify('commands/devflow/x.md', 'file', { shipped: both, retired: both })).toBe('shipped');
    expect(classify('commands/devflow/old.md', 'file', sets)).toBe('retired');
    expect(classify('commands/devflow/a.md', 'file', sets)).toBe('shipped');
  });

  it('answers shipped for a folder that holds a shipped path and unknown for one that does not', () => {
    expect(classify('skills/devflow:git/references', 'directory', sets)).toBe('shipped');
    expect(classify('skills/devflow:old', 'directory', sets)).toBe('retired');
    expect(classify('skills/python', 'directory', sets)).toBe('unknown');
  });

  it('knows the exact devflow leftovers as sidecar', () => {
    expect(classify('commands/devflow/a.md.tmp', 'file', sets)).toBe('sidecar');
    expect(classify('commands/devflow/a.md.old', 'file', sets)).toBe('sidecar');
    expect(classify('commands/devflow/a.md.tmp.4242', 'file', sets)).toBe('sidecar');
    expect(classify('skills/devflow:git.tmp', 'directory', sets)).toBe('sidecar');
    expect(classify('skills/devflow:compliance.tmp', 'directory', { shipped: createPathSet([]), retired: createPathSet([]) })).toBe('sidecar');
  });

  it('does not take a user name with a leftover suffix for a sidecar', () => {
    expect(classify('commands/devflow/mine.md.tmp', 'file', sets)).toBe('unknown');
    expect(classify('commands/devflow/a.md.bak', 'file', sets)).toBe('unknown');
    expect(classify('commands/devflow/a.md.tmp.x', 'file', sets)).toBe('unknown');
  });

  it('calls only a .DS_Store file junk', () => {
    expect(classify('commands/devflow/.DS_Store', 'file', sets)).toBe('junk');
    expect(classify('commands/devflow/.DS_Store', 'directory', sets)).toBe('unknown');
    expect(classify('commands/devflow/.DS_Store', 'link', sets)).toBe('unknown');
    expect(classify('commands/devflow/.hidden', 'file', sets)).toBe('unknown');
    expect(classify('commands/devflow/.gitkeep', 'file', sets)).toBe('unknown');
  });

  it('classifies a name the same way through the session', () => {
    expect(open().classify('commands/devflow/old.md', 'file')).toBe('retired');
  });
});

describe('createPathSet', () => {
  it('holds a path, and every folder above it, and nothing else', () => {
    const set = createPathSet(['a/b/c.md']);
    expect(set.files.has('a/b/c.md')).toBe(true);
    expect(set.holds('a')).toBe(true);
    expect(set.holds('a/b')).toBe(true);
    expect(set.holds('a/b/c.md')).toBe(true);
    expect(set.holds('a/x')).toBe(false);
    expect(set.holds('ab')).toBe(false);
  });
});

describe('print helpers', () => {
  it('prints ESC, C0 and C1 control characters as \\xNN and nothing else', () => {
    expect(escapeName('a\u001b[31mred')).toBe('a\\x1b[31mred');
    expect(escapeName('line\nbreak')).toBe('line\\x0abreak');
    expect(escapeName('c1\u009bcsi')).toBe('c1\\x9bcsi');
    expect(escapeName('del\u007f')).toBe('del\\x7f');
    expect(escapeName('plain-é.md')).toBe('plain-é.md');
  });

  it('keeps the name on disk when the printed form is escaped', async () => {
    const name = 'commands/devflow/e\u001bsc.md';
    const target = await put(name, 'user text');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    const [unit] = session.snapshot().moved;
    expect(path.basename(unit.original)).toBe('e\u001bsc.md');
    expect(escapeName(path.basename(unit.original))).toBe('e\\x1bsc.md');
    expect(await fs.readFile(inRun(name), 'utf8')).toBe('user text');
    expect(await exists(target)).toBe(false);
  });

  it('builds the run folder name from the UTC clock and four bytes', () => {
    expect(runFolderName(CLOCK, Uint8Array.of(0xde, 0xad, 0xbe, 0xef))).toBe('20261030T045513Z-deadbeef');
    expect(runFolderName(new Date(Date.UTC(2027, 0, 2, 3, 4, 5)), Uint8Array.of(0, 1, 2, 255))).toBe('20270102T030405Z-000102ff');
    expect(runFolderName(CLOCK, Uint8Array.of(0xab))).toBe('20261030T045513Z-ab000000');
  });

  it('shows the first five names and counts the rest', () => {
    expect(formatCappedList([])).toBe('');
    expect(formatCappedList(['a', 'b', 'c'])).toBe('a, b, c');
    expect(formatCappedList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c, d, e');
    expect(formatCappedList(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe('a, b, c, d, e, 3 more');
    expect(formatCappedList(['x\u001b'])).toBe('x\\x1b');
  });
});

describe('the backup root', () => {
  it('makes no root and no run folder when nothing moves', async () => {
    await put('commands/devflow/a.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    await session.removeListed(at('commands/devflow'));
    expect(await exists(backupRoot)).toBe(false);
    expect(session.snapshot().runFolder).toBeNull();
    expect(session.snapshot().moved).toEqual([]);
  });

  it('makes the root and the run folder with mode 0700 at the first move', async () => {
    await put('commands/devflow/mine.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect((await fs.stat(backupRoot)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(runFolder)).mode & 0o777).toBe(0o700);
    expect(session.snapshot().runFolder).toBe(runFolder);
  });

  it('moves nothing and warns once when a link stands at the root', async () => {
    const outside = path.join(home, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, backupRoot);
    const one = await put('commands/devflow/one.md');
    const two = await put('commands/devflow/two.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(await exists(one)).toBe(true);
    expect(await exists(two)).toBe(true);
    expect(await fs.readdir(outside)).toEqual([]);
    expect(session.snapshot().rootRefusal).toEqual({ path: backupRoot, reason: 'link' });
    expect(session.snapshot().moved).toEqual([]);
    expect(session.snapshot().failures).toEqual([]);
    expect(session.keptUnder(at('commands/devflow'))).toEqual([one, two]);
  });

  it('moves nothing and warns once when a file stands at the root', async () => {
    await fs.writeFile(backupRoot, 'not a folder');
    const one = await put('commands/devflow/one.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(await exists(one)).toBe(true);
    expect(await fs.readFile(backupRoot, 'utf8')).toBe('not a folder');
    expect(session.snapshot().rootRefusal).toEqual({ path: backupRoot, reason: 'not-a-directory' });
  });

  it('moves nothing when the root cannot be made', async () => {
    const realMkdir = fs.mkdir.bind(fs);
    vi.spyOn(fs, 'mkdir').mockImplementation(async (target, opts) => {
      if (target === backupRoot) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realMkdir(target, opts);
    });
    const one = await put('commands/devflow/one.md');
    const two = await put('commands/devflow/two.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(await exists(one)).toBe(true);
    expect(await exists(two)).toBe(true);
    expect(await exists(backupRoot)).toBe(false);
    expect(session.snapshot().rootRefusal).toEqual({ path: backupRoot, reason: 'EACCES' });
    expect(session.snapshot().failures).toEqual([]);
  });

  it('fails the move step after five run folder name collisions and tries no sixth', async () => {
    await fs.mkdir(runFolder, { recursive: true });
    await fs.writeFile(path.join(runFolder, 'earlier-run.txt'), 'kept');
    const bytes = vi.fn(stampBytes);
    const one = await put('commands/devflow/one.md');
    const two = await put('commands/devflow/two.md');
    const session = open({ bytes });
    await session.prepass([at('commands/devflow')]);
    await session.prepass([at('commands/devflow')]);
    expect(bytes).toHaveBeenCalledTimes(5);
    expect(await exists(one)).toBe(true);
    expect(await exists(two)).toBe(true);
    expect(session.snapshot().rootRefusal?.reason).toBe('run-folder-collisions');
    expect(session.snapshot().runFolder).toBeNull();
    expect(await fs.readdir(runFolder)).toEqual(['earlier-run.txt']);
  });

  it('never reuses an earlier run folder', async () => {
    await fs.mkdir(runFolder, { recursive: true });
    await fs.writeFile(path.join(runFolder, 'earlier-run.txt'), 'kept');
    let calls = 0;
    const bytes = (size: number): Uint8Array => (++calls <= 4 ? stampBytes(size) : Uint8Array.from({ length: size }, () => 0xff));
    await put('commands/devflow/mine.md');
    const session = open({ bytes });
    await session.prepass([at('commands/devflow')]);
    const second = path.join(backupRoot, '20261030T045513Z-ffffffff');
    expect(session.snapshot().runFolder).toBe(second);
    expect(await fs.readdir(runFolder)).toEqual(['earlier-run.txt']);
    expect(await exists(path.join(second, 'commands', 'devflow', 'mine.md'))).toBe(true);
  });

  it('uses one run folder for every move of the session', async () => {
    await put('commands/devflow/one.md');
    await put('skills/devflow:git/mine.md');
    const bytes = vi.fn(stampBytes);
    const session = open({ bytes });
    await session.prepass([at('commands/devflow')]);
    await session.prepass([at('skills/devflow:git')]);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect((await fs.readdir(backupRoot))).toEqual([RUN_NAME]);
  });
});

describe('the pre-pass', () => {
  it('moves an unknown file to the same relative path under the run folder, with the same bytes', async () => {
    const mine = await put('commands/devflow/mine.md', 'my own command');
    const session = open();
    const result = await session.prepass([at('commands/devflow')]);
    expect(await exists(mine)).toBe(false);
    expect(await fs.readFile(inRun('commands/devflow/mine.md'), 'utf8')).toBe('my own command');
    expect(result.moved).toEqual([{ original: mine, backup: inRun('commands/devflow/mine.md'), kind: 'file' }]);
  });

  it('lists shipped files for removal and does not move them', async () => {
    const a = await put('commands/devflow/a.md');
    const b = await put('commands/devflow/b.md');
    const session = open();
    const result = await session.prepass([at('commands/devflow')]);
    expect(result.moved).toEqual([]);
    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(true);
    const removal = await session.removeListed(at('commands/devflow'));
    expect([...removal.removed].sort()).toEqual([a, b]);
    expect(removal.folderRemoved).toBe(true);
    expect(await exists(at('commands/devflow'))).toBe(false);
    expect(session.snapshot().retiredRemoved).toEqual([]);
  });

  it('removes a retired file and names it, and moves a user file beside it in a folder that holds nothing shipped', async () => {
    const old = await put('skills/devflow:old/SKILL.md');
    const mine = await put('skills/devflow:old/notes.md', 'my notes');
    const session = open();
    await session.prepass([at('skills/devflow:old')]);
    const removal = await session.removeListed(at('skills/devflow:old'));
    expect(removal.folderRemoved).toBe(true);
    expect(await exists(old)).toBe(false);
    expect(await exists(mine)).toBe(false);
    expect(session.snapshot().retiredRemoved).toEqual([old]);
    expect(session.snapshot().moved.map(unit => unit.original)).toEqual([mine]);
    expect(await fs.readFile(inRun('skills/devflow:old/notes.md'), 'utf8')).toBe('my notes');
  });

  it('descends into a known folder and keeps the relative path of what it moves', async () => {
    const ensure = await put('skills/devflow:git/references/pr/ensure.md');
    await put('skills/devflow:git/SKILL.md');
    await put('skills/devflow:git/references/pr/mine.md', 'pr notes');
    await put('skills/devflow:git/references/extra/deep/file.md', 'deep');
    const session = open();
    await session.prepass([at('skills/devflow:git')]);
    expect(await fs.readFile(inRun('skills/devflow:git/references/pr/mine.md'), 'utf8')).toBe('pr notes');
    expect(await fs.readFile(inRun('skills/devflow:git/references/extra/deep/file.md'), 'utf8')).toBe('deep');
    const removal = await session.removeListed(at('skills/devflow:git'));
    expect(removal.folderRemoved).toBe(true);
    expect(await exists(ensure)).toBe(false);
    expect(await exists(at('skills/devflow:git'))).toBe(false);
  });

  it('removes a .DS_Store without naming it and moves any other dot file', async () => {
    const junk = await put('commands/devflow/.DS_Store');
    const hidden = await put('commands/devflow/.hidden', 'secret settings');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    const removal = await session.removeListed(at('commands/devflow'));
    expect(removal.folderRemoved).toBe(true);
    expect(await exists(junk)).toBe(false);
    expect(session.snapshot().moved.map(unit => unit.original)).toEqual([hidden]);
    expect(JSON.stringify(session.snapshot())).not.toContain('.DS_Store');
    expect(await fs.readFile(inRun('commands/devflow/.hidden'), 'utf8')).toBe('secret settings');
  });

  it('removes a leftover of a devflow name and walks a leftover folder by the name it copies', async () => {
    const leftover = await put('commands/devflow/a.md.tmp.4242');
    const staged = await put('skills/devflow:compliance.tmp/SKILL.md');
    const mine = await put('skills/devflow:compliance.tmp/mine.md', 'mine');
    const session = open();
    await session.prepass([at('commands/devflow'), at('skills/devflow:compliance.tmp')]);
    await session.removeListed(at('commands/devflow'));
    const removal = await session.removeListed(at('skills/devflow:compliance.tmp'));
    expect(await exists(leftover)).toBe(false);
    expect(await exists(staged)).toBe(false);
    expect(removal.folderRemoved).toBe(true);
    expect(session.snapshot().moved.map(unit => unit.original)).toEqual([mine]);
    expect(session.snapshot().retiredRemoved).toEqual([]);
  });

  it('moves a link as a link and leaves its target alone', async () => {
    const outside = path.join(home, 'outside.txt');
    await fs.writeFile(outside, 'the target');
    await fs.utimes(outside, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const before = await fs.stat(outside);
    const link = at('commands/devflow/link.md');
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink('../../../outside.txt', link);
    const session = open();
    await session.prepass([at('commands/devflow')]);
    const moved = inRun('commands/devflow/link.md');
    expect((await fs.lstat(moved)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(moved)).toBe('../../../outside.txt');
    expect(await exists(link)).toBe(false);
    const after = await fs.stat(outside);
    expect(await fs.readFile(outside, 'utf8')).toBe('the target');
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
    expect(session.snapshot().moved[0].kind).toBe('link');
  });

  it('moves a FIFO by rename and never opens it', async () => {
    const fifo = at('commands/devflow/pipe');
    await fs.mkdir(path.dirname(fifo), { recursive: true });
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      return;
    }
    const open_ = vi.spyOn(fs, 'open');
    const readFile = vi.spyOn(fs, 'readFile');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(open_).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(await exists(fifo)).toBe(false);
    expect((await fs.lstat(inRun('commands/devflow/pipe'))).isFIFO()).toBe(true);
    expect(session.snapshot().moved[0].kind).toBe('special');
  });

  it('does not walk a root that is a link', async () => {
    const outside = path.join(home, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'theirs.md'), 'theirs');
    await fs.mkdir(path.join(claudeDir, 'commands'), { recursive: true });
    await fs.symlink(outside, at('commands/devflow'));
    const readdir = vi.spyOn(fs, 'readdir');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(readdir).not.toHaveBeenCalledWith(at('commands/devflow'), expect.anything());
    expect(await tree(outside)).toEqual(['theirs.md']);
    expect(session.snapshot().moved).toEqual([]);
    expect(session.snapshot().failures).toEqual([{ path: at('commands/devflow'), action: 'scan', reason: 'not-a-real-folder' }]);
    expect((await session.removeListed(at('commands/devflow'))).folderRemoved).toBe(false);
    expect((await fs.lstat(at('commands/devflow'))).isSymbolicLink()).toBe(true);
  });

  it('skips a target that is absent and refuses one outside the Claude dir', async () => {
    const session = open();
    const outside = path.join(home, 'elsewhere');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'file.md'), 'x');
    await session.prepass([at('commands/devflow'), outside]);
    expect(session.snapshot().failures).toEqual([{ path: outside, action: 'scan', reason: 'outside-claude-dir' }]);
    expect(await tree(outside)).toEqual(['file.md']);
    expect(await exists(backupRoot)).toBe(false);
  });
});

describe('bounds', () => {
  it('moves an unknown subtree of 10,000 files with one rename and never lists it', async () => {
    const subtree = at('commands/devflow/mine');
    const batches = 100;
    const perBatch = 100;
    for (let b = 0; b < batches; b++) {
      const folder = path.join(subtree, `part-${b}`);
      await fs.mkdir(folder, { recursive: true });
      await Promise.all(Array.from({ length: perBatch }, (_, i) => fs.writeFile(path.join(folder, `f${i}.txt`), '')));
    }
    await put('commands/devflow/a.md');
    const rename = vi.spyOn(fs, 'rename');
    const readdir = vi.spyOn(fs, 'readdir');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(subtree, inRun('commands/devflow/mine'));
    const listed = readdir.mock.calls.map(call => String(call[0]));
    expect(listed.filter(dir => dir.startsWith(subtree))).toEqual([]);
    expect(session.snapshot().moved).toEqual([{ original: subtree, backup: inRun('commands/devflow/mine'), kind: 'directory' }]);
    expect((await fs.readdir(inRun('commands/devflow/mine/part-99'))).length).toBe(perBatch);
  });

  it('keeps a folder whole with one cap line when it holds more entries than the cap', async () => {
    const a = await put('commands/devflow/a.md');
    const mine = await put('commands/devflow/mine.md');
    await put('commands/devflow/b.md');
    await put('commands/devflow/c.md');
    const session = open({ entryCap: 3 });
    const result = await session.prepass([at('commands/devflow')]);
    expect(result.capHits).toEqual([{ folder: at('commands/devflow'), entries: 4, cap: 3 }]);
    expect(result.moved).toEqual([]);
    const removal = await session.removeListed(at('commands/devflow'));
    expect(removal.removed).toEqual([]);
    expect(removal.folderRemoved).toBe(false);
    expect(await exists(a)).toBe(true);
    expect(await exists(mine)).toBe(true);
    expect(await exists(backupRoot)).toBe(false);
    expect(session.keptUnder(at('commands/devflow'))).toEqual([at('commands/devflow')]);
    expect(session.isKept(mine)).toBe(true);
    await session.prepass([at('commands/devflow')]);
    expect(session.snapshot().capHits).toHaveLength(1);
  });

  it('walks a folder that holds exactly the cap', async () => {
    await put('commands/devflow/a.md');
    await put('commands/devflow/mine.md');
    const session = open({ entryCap: 2 });
    const result = await session.prepass([at('commands/devflow')]);
    expect(result.capHits).toEqual([]);
    expect(result.moved).toHaveLength(1);
  });

  it('uses 10,000 as the default cap', () => {
    expect(DEFAULT_ENTRY_CAP).toBe(10_000);
  });
});

describe('failures', () => {
  it('keeps a file and its folder when its rename is refused, and moves the rest', async () => {
    const stuck = await put('commands/devflow/stuck.md', 'stuck');
    const fine = await put('commands/devflow/fine.md');
    const other = await put('skills/devflow:git/references/pr/other.md', 'other');
    await put('commands/devflow/a.md');
    await put('skills/devflow:git/SKILL.md');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === stuck || from === other) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realRename(from, to);
    });
    const session = open();
    await session.prepass([at('commands/devflow'), at('skills/devflow:git')]);
    const commands = await session.removeListed(at('commands/devflow'));
    const skill = await session.removeListed(at('skills/devflow:git'));
    expect(commands.folderRemoved).toBe(false);
    expect(skill.folderRemoved).toBe(false);
    expect(await fs.readFile(stuck, 'utf8')).toBe('stuck');
    expect(await fs.readFile(other, 'utf8')).toBe('other');
    expect(await exists(fine)).toBe(false);
    expect(await exists(at('commands/devflow/a.md'))).toBe(false);
    expect(session.snapshot().failures).toEqual([
      { path: stuck, action: 'move', reason: 'EACCES' },
      { path: other, action: 'move', reason: 'EACCES' },
    ]);
    expect(session.keptUnder(at('commands/devflow'))).toEqual([stuck]);
    expect(session.isKept(stuck)).toBe(true);
    expect(session.isKept(fine)).toBe(false);
  });

  it('leaves a file in place on EXDEV, names the reason and makes no copy', async () => {
    const across = await put('commands/devflow/across.md', 'across');
    const fine = await put('commands/devflow/fine.md');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === across) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      return realRename(from, to);
    });
    const copyFile = vi.spyOn(fs, 'copyFile');
    const cp = vi.spyOn(fs, 'cp');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(await fs.readFile(across, 'utf8')).toBe('across');
    expect(session.snapshot().failures).toEqual([{ path: across, action: 'move', reason: 'EXDEV' }]);
    expect(copyFile).not.toHaveBeenCalled();
    expect(cp).not.toHaveBeenCalled();
    expect(await tree(runFolder)).toEqual(['commands/', 'commands/devflow/', 'commands/devflow/fine.md']);
    expect(await exists(fine)).toBe(false);
  });

  it('refuses a file whose inode changed after the scan, names it, and moves the others', async () => {
    const victim = await put('commands/devflow/victim.md', 'original');
    const other = await put('commands/devflow/other.md', 'other');
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
    expect(await fs.readFile(victim, 'utf8')).toBe('replacement');
    expect(await exists(other)).toBe(false);
    expect(session.snapshot().failures).toEqual([{ path: victim, action: 'move', reason: 'changed-since-scan' }]);
    expect(session.snapshot().moved.map(unit => unit.original)).toEqual([other]);
    expect(session.isKept(victim)).toBe(true);
  });

  it('refuses a move whose destination already exists', async () => {
    const mine = await put('commands/devflow/mine.md', 'mine');
    const realMkdir = fs.mkdir.bind(fs);
    vi.spyOn(fs, 'mkdir').mockImplementation(async (target, opts) => {
      const made = await realMkdir(target, opts);
      if (target === runFolder) {
        await realMkdir(inRun('commands/devflow'), { recursive: true });
        await fs.writeFile(inRun('commands/devflow/mine.md'), 'already here');
      }
      return made;
    });
    const session = open();
    await session.prepass([at('commands/devflow')]);
    expect(await fs.readFile(mine, 'utf8')).toBe('mine');
    expect(await fs.readFile(inRun('commands/devflow/mine.md'), 'utf8')).toBe('already here');
    expect(session.snapshot().failures).toEqual([{ path: mine, action: 'move', reason: 'destination-exists' }]);
  });

  it('keeps a file that cannot be inspected', async () => {
    const mine = await put('commands/devflow/mine.md');
    const realLstat = fs.lstat.bind(fs);
    vi.spyOn(fs, 'lstat').mockImplementation(async (target, opts) => {
      if (target === mine) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realLstat(target, opts);
    });
    const session = open();
    await session.prepass([at('commands/devflow')]);
    vi.restoreAllMocks();
    expect(await exists(mine)).toBe(true);
    expect(session.snapshot().failures).toEqual([{ path: mine, action: 'scan', reason: 'EACCES' }]);
    expect(session.isKept(mine)).toBe(true);
  });

  it('keeps a folder it cannot read', async () => {
    await put('skills/devflow:git/references/pr/ensure.md');
    const unreadable = at('skills/devflow:git/references');
    const realReaddir = fs.readdir.bind(fs);
    vi.spyOn(fs, 'readdir').mockImplementation(async (target, opts) => {
      if (target === unreadable) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return realReaddir(target, opts);
    });
    const session = open();
    await session.prepass([at('skills/devflow:git')]);
    const removal = await session.removeListed(at('skills/devflow:git'));
    expect(removal.folderRemoved).toBe(false);
    expect(session.snapshot().failures).toEqual([{ path: unreadable, action: 'scan', reason: 'EACCES' }]);
    expect(session.keptUnder(at('skills/devflow:git'))).toEqual([unreadable]);
    expect(await exists(at('skills/devflow:git/references/pr/ensure.md'))).toBe(true);
  });
});

describe('removal', () => {
  it('leaves a file that appears after the scan, and keeps its folder', async () => {
    const a = await put('commands/devflow/a.md');
    const b = await put('commands/devflow/b.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    const late = at('commands/devflow/late.md');
    const realUnlink = fs.unlink.bind(fs);
    const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (unlink.mock.calls.length === 1) await fs.writeFile(late, 'added during the run');
      return realUnlink(target);
    });
    const removal = await session.removeListed(at('commands/devflow'));
    expect([...removal.removed].sort()).toEqual([a, b]);
    expect(removal.folderRemoved).toBe(false);
    expect(await fs.readFile(late, 'utf8')).toBe('added during the run');
    expect(session.snapshot().failures).toEqual([]);
  });

  it('never removes recursively', async () => {
    await put('commands/devflow/a.md');
    await put('commands/devflow/mine/deep.md', 'deep');
    const rm = vi.spyOn(fs, 'rm');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    await session.removeListed(at('commands/devflow'));
    expect(rm).not.toHaveBeenCalled();
    expect(await fs.readFile(inRun('commands/devflow/mine/deep.md'), 'utf8')).toBe('deep');
  });

  it('removes nothing from a folder whose identity changed after the scan', async () => {
    const a = await put('commands/devflow/a.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    const moved = path.join(claudeDir, 'commands', 'devflow-moved');
    await fs.rename(at('commands/devflow'), moved);
    await fs.mkdir(at('commands/devflow'));
    await fs.writeFile(at('commands/devflow/a.md'), 'a different folder');
    const removal = await session.removeListed(at('commands/devflow'));
    expect(removal.removed).toEqual([]);
    expect(removal.folderRemoved).toBe(false);
    expect(await fs.readFile(a, 'utf8')).toBe('a different folder');
    expect(session.snapshot().failures).toEqual([{ path: at('commands/devflow'), action: 'remove', reason: 'changed-since-scan' }]);
  });

  it('reports a folder that is already gone as removed and a folder never scanned as not removed', async () => {
    const session = open();
    expect((await session.removeListed(at('commands/devflow'))).folderRemoved).toBe(true);
    await put('rules/devflow/mine.md');
    expect((await session.removeListed(at('rules/devflow'))).folderRemoved).toBe(false);
    expect(await exists(at('rules/devflow/mine.md'))).toBe(true);
  });

  it('removes a listed entry that is a link without touching what it points to', async () => {
    const outside = path.join(home, 'outside.txt');
    await fs.writeFile(outside, 'the target');
    const link = at('commands/devflow/a.md');
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(outside, link);
    const session = open();
    await session.prepass([at('commands/devflow')]);
    await session.removeListed(at('commands/devflow'));
    expect(await exists(link)).toBe(false);
    expect(await fs.readFile(outside, 'utf8')).toBe('the target');
  });
});

describe('moveWhole', () => {
  it('moves a folder with one rename and no walk', async () => {
    await put('skills/python/SKILL.md', 'python skill');
    await put('skills/python/references/deep/notes.md', 'notes');
    const rename = vi.spyOn(fs, 'rename');
    const readdir = vi.spyOn(fs, 'readdir');
    const session = open();
    const result = await session.moveWhole(at('skills/python'));
    expect(result).toEqual({
      status: 'moved',
      unit: { original: at('skills/python'), backup: inRun('skills/python'), kind: 'directory' },
    });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(readdir).not.toHaveBeenCalled();
    expect(await exists(at('skills/python'))).toBe(false);
    expect(await fs.readFile(inRun('skills/python/references/deep/notes.md'), 'utf8')).toBe('notes');
    expect(session.snapshot().moved).toHaveLength(1);
  });

  it('answers absent for a path that is not there and makes no backup root', async () => {
    const session = open();
    expect(await session.moveWhole(at('skills/python'))).toEqual({ status: 'absent' });
    expect(await exists(backupRoot)).toBe(false);
  });

  it('keeps the folder and names the reason when the rename fails', async () => {
    await put('skills/python/SKILL.md');
    vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }));
    const session = open();
    expect(await session.moveWhole(at('skills/python'))).toEqual({ status: 'kept', reason: 'EXDEV' });
    expect(await exists(at('skills/python/SKILL.md'))).toBe(true);
    expect(session.keptUnder(at('skills'))).toEqual([at('skills/python')]);
  });

  it('keeps the folder when the backup root is refused, with the refusal as the reason', async () => {
    await fs.writeFile(backupRoot, 'not a folder');
    await put('skills/python/SKILL.md');
    const session = open();
    expect(await session.moveWhole(at('skills/python'))).toEqual({ status: 'kept', reason: 'not-a-directory' });
    expect(await exists(at('skills/python/SKILL.md'))).toBe(true);
  });

  it('refuses a path outside the Claude dir', async () => {
    const outside = path.join(home, 'outside');
    await fs.mkdir(outside);
    const session = open();
    expect(await session.moveWhole(outside)).toEqual({ status: 'kept', reason: 'outside-claude-dir' });
    expect(await exists(outside)).toBe(true);
    expect(await exists(backupRoot)).toBe(false);
  });
});

describe('the snapshot', () => {
  it('is frozen from the top down', async () => {
    await put('commands/devflow/mine.md');
    await put('commands/devflow/old.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    await session.removeListed(at('commands/devflow'));
    const snap = session.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.moved)).toBe(true);
    expect(Object.isFrozen(snap.moved[0])).toBe(true);
    expect(Object.isFrozen(snap.retiredRemoved)).toBe(true);
    expect(Object.isFrozen(snap.failures)).toBe(true);
    expect(Object.isFrozen(snap.capHits)).toBe(true);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.keptUnder(claudeDir))).toBe(true);
    expect(snap.retiredRemoved).toEqual([at('commands/devflow/old.md')]);
  });

  it('does not change a snapshot taken earlier', async () => {
    await put('commands/devflow/one.md');
    const session = open();
    await session.prepass([at('commands/devflow')]);
    const first = session.snapshot();
    await put('commands/devflow/two.md');
    await session.prepass([at('commands/devflow')]);
    expect(first.moved).toHaveLength(1);
    expect(session.snapshot().moved).toHaveLength(2);
  });
});
