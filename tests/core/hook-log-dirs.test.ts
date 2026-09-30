/**
 * D-LOG-DIR-CAP — pruneHookLogDirs keeps the most recently written hook log
 * folders and removes the rest, oldest first, in bounded passes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  pruneHookLogDirs, MAX_HOOK_LOG_DIRS, MAX_LOG_DIRS_PRUNED_PER_RUN, MAX_LOG_DIRS_SCANNED,
} from '../../src/core/hook-log-dirs.js';

let root: string;
let logs: string;

/** A log folder whose folder and file mtimes are `ageDays` in the past. */
async function seedDir(name: string, ageDays: number, fileAgeDays = ageDays): Promise<string> {
  const dir = path.join(logs, name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, '.capture-turn.log');
  await fs.writeFile(file, 'log line\n');
  const at = (days: number): Date => new Date(Date.now() - days * 86_400_000);
  await fs.utimes(file, at(fileAgeDays), at(fileAgeDays));
  await fs.utimes(dir, at(ageDays), at(ageDays));
  return dir;
}

async function remaining(): Promise<string[]> {
  const entries = await fs.readdir(logs, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-logdirs-'));
  logs = path.join(root, 'logs');
  await fs.mkdir(logs);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('pruneHookLogDirs', () => {
  it('keeps the newest folders and removes the rest, oldest first', async () => {
    for (let i = 0; i < 6; i++) await seedDir(`d${i}`, i + 1);

    const result = await pruneHookLogDirs(logs, { keep: 3 });

    expect(result).toEqual({ ok: true, value: { removed: 3, overCap: 0 } });
    expect(await remaining()).toEqual(['d0', 'd1', 'd2']);
  });

  it('ranks a folder by its newest log, not the folder mtime an append never moves', async () => {
    // The busy project: folder created long ago, log appended to today.
    await seedDir('busy', 400, 0);
    for (let i = 0; i < 3; i++) await seedDir(`idle${i}`, 10 + i);

    await pruneHookLogDirs(logs, { keep: 2 });

    expect(await remaining()).toEqual(['busy', 'idle0']);
  });

  it('removes at most maxRemovals per run and reports what is left for the next run', async () => {
    for (let i = 0; i < 10; i++) await seedDir(`d${i}`, i + 1);

    const first = await pruneHookLogDirs(logs, { keep: 2, maxRemovals: 3 });
    expect(first).toEqual({ ok: true, value: { removed: 3, overCap: 5 } });
    // The oldest three went first.
    expect(await remaining()).not.toContain('d9');
    expect(await remaining()).toContain('d6');

    const second = await pruneHookLogDirs(logs, { keep: 2, maxRemovals: 100 });
    expect(second).toEqual({ ok: true, value: { removed: 5, overCap: 0 } });
    expect(await remaining()).toEqual(['d0', 'd1']);
  });

  it('one run with the default bounds clears every scanned folder beyond the cap', async () => {
    // The removal bound is the scan bound, so a backlog one init can read is gone after that init.
    expect(MAX_LOG_DIRS_PRUNED_PER_RUN).toBe(MAX_LOG_DIRS_SCANNED);
    for (let i = 0; i < 12; i++) await seedDir(`d${i}`, i + 1);

    const result = await pruneHookLogDirs(logs, { keep: 2 });

    expect(result).toEqual({ ok: true, value: { removed: 10, overCap: 0 } });
    expect(await remaining()).toEqual(['d0', 'd1']);
  });

  it('never touches files at the logs root or symbolic links', async () => {
    for (let i = 0; i < 3; i++) await seedDir(`d${i}`, i + 1);
    await fs.writeFile(path.join(logs, 'proxy.log'), 'proxy\n');
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
    await fs.symlink(outside, path.join(logs, 'linked'));

    await pruneHookLogDirs(logs, { keep: 0 });

    expect(await remaining()).toEqual([]);
    expect(await fs.readFile(path.join(logs, 'proxy.log'), 'utf-8')).toBe('proxy\n');
    expect((await fs.lstat(path.join(logs, 'linked'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf-8')).toBe('keep');
  });

  it('does nothing at or under the cap, or with no logs directory', async () => {
    await seedDir('only', 1);
    expect(await pruneHookLogDirs(logs)).toEqual({ ok: true, value: { removed: 0, overCap: 0 } });
    expect(await pruneHookLogDirs(path.join(root, 'nothing', 'logs'))).toEqual({ ok: true, value: { removed: 0, overCap: 0 } });
    expect(MAX_HOOK_LOG_DIRS).toBeGreaterThan(0);
  });

  it('refuses a directory that is not a devflow logs directory', async () => {
    const other = path.join(root, 'projects');
    await fs.mkdir(other);
    await fs.mkdir(path.join(other, 'a'));
    const result = await pruneHookLogDirs(other, { keep: 0 });
    expect(result.ok).toBe(false);
    expect(await fs.readdir(other)).toEqual(['a']);
    expect((await pruneHookLogDirs('logs', { keep: 0 })).ok).toBe(false);
  });
});
