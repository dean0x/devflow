/**
 * The manifest lock: a mkdir lock directory beside `manifest.json` that serialises
 * the manifest's read-modify-write writers (the toggle write and the read heal).
 *
 * The stale-lock break renames the stale directory to a unique name first, so only
 * one waiter can win it, and checks that what it moved really was stale. That
 * closes the fault of the shared hook lock, where two waiters that both saw a stale
 * lock could both break it and both hold it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireManifestLock,
  withManifestLock,
  getManifestLockPath,
  MANIFEST_LOCK_STALE_MS,
} from '../../src/core/manifest-lock.js';

describe('manifest lock', () => {
  let devflowDir: string;
  let lockDir: string;

  beforeEach(async () => {
    devflowDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-manifest-lock-'));
    lockDir = getManifestLockPath(devflowDir);
  });

  afterEach(async () => {
    await fs.rm(devflowDir, { recursive: true, force: true });
  });

  const makeStale = async (dir: string): Promise<void> => {
    const old = new Date(Date.now() - 10 * MANIFEST_LOCK_STALE_MS);
    await fs.utimes(dir, old, old);
  };
  const exists = async (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);
  const leftovers = async (): Promise<string[]> =>
    (await fs.readdir(devflowDir)).filter((name) => name !== path.basename(lockDir));

  it('sits beside manifest.json in the machine directory', () => {
    expect(path.dirname(lockDir)).toBe(devflowDir);
    expect(path.basename(lockDir)).toBe('manifest.json.lock');
  });

  it('takes a free lock and removes it on release', async () => {
    const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    expect(lock.ok).toBe(true);
    expect(await exists(lockDir)).toBe(true);
    if (lock.ok) await lock.value.release();
    expect(await exists(lockDir)).toBe(false);
  });

  it('release twice is harmless', async () => {
    const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    if (!lock.ok) throw new Error('lock not taken');
    await lock.value.release();
    await expect(lock.value.release()).resolves.toBeUndefined();
  });

  it('answers not-acquired at once, with a timeout of 0, while a live holder has it', async () => {
    const first = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    if (!first.ok) throw new Error('lock not taken');
    const started = Date.now();
    const second = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    expect(second).toEqual({ ok: false, error: 'not-acquired' });
    expect(Date.now() - started).toBeLessThan(1000);
    await first.value.release();
  });

  it('waits for the holder and takes the lock once it is released', async () => {
    const first = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    if (!first.ok) throw new Error('lock not taken');
    const waiting = acquireManifestLock(devflowDir, { timeoutMs: 3000 });
    setTimeout(() => { void first.value.release(); }, 150);
    const second = await waiting;
    expect(second.ok).toBe(true);
    if (second.ok) await second.value.release();
  });

  it('a wait is bounded: it gives up after its timeout', async () => {
    const first = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    if (!first.ok) throw new Error('lock not taken');
    const started = Date.now();
    const second = await acquireManifestLock(devflowDir, { timeoutMs: 200 });
    expect(second.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    await first.value.release();
  });

  it('breaks a stale lock and takes it, leaving nothing behind', async () => {
    await fs.mkdir(lockDir);
    await makeStale(lockDir);
    const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    expect(lock.ok).toBe(true);
    expect(await leftovers()).toEqual([]);
    if (lock.ok) await lock.value.release();
    expect(await exists(lockDir)).toBe(false);
  });

  it('breaks a stale lock that holds files', async () => {
    await fs.mkdir(lockDir);
    await fs.writeFile(path.join(lockDir, 'owner'), 'dead process');
    await makeStale(lockDir);
    const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    expect(lock.ok).toBe(true);
    expect(await leftovers()).toEqual([]);
    if (lock.ok) await lock.value.release();
  });

  it('does not break a lock younger than the stale age', async () => {
    await fs.mkdir(lockDir);
    const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
    expect(lock.ok).toBe(false);
    expect(await exists(lockDir)).toBe(true);
  });

  it('answers not-acquired when the folder cannot hold a lock, and creates no folder', async () => {
    const missing = path.join(devflowDir, 'not-installed');
    const lock = await acquireManifestLock(missing, { timeoutMs: 0 });
    expect(lock).toEqual({ ok: false, error: 'not-acquired' });
    expect(await exists(missing)).toBe(false);
  });

  it('two waiters that both judged the lock stale cannot both hold it', async () => {
    await fs.mkdir(lockDir);
    await makeStale(lockDir);

    // Hold every waiter at its first stale break until both have judged the lock
    // stale. The first to go on takes the lock; the second goes on only after that
    // holder has it, and so renames the holder's fresh lock, not the stale one.
    const realRename = fs.rename.bind(fs);
    let arrived = 0;
    let bothArrived!: () => void;
    const bothJudgedStale = new Promise<void>((resolve) => { bothArrived = resolve; });
    let firstHolds!: () => void;
    const firstHasLock = new Promise<void>((resolve) => { firstHolds = resolve; });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) !== lockDir) return realRename(from, to);
      arrived += 1;
      const position = arrived;
      if (arrived === 2) bothArrived();
      await bothJudgedStale;
      if (position === 2) await firstHasLock;
      return realRename(from, to);
    });

    const first = acquireManifestLock(devflowDir, { timeoutMs: 400 }).then((result) => {
      if (result.ok) firstHolds();
      return result;
    });
    const second = acquireManifestLock(devflowDir, { timeoutMs: 400 });
    const [a, b] = await Promise.all([first, second]);

    // Exactly one holds. The other waited out its timeout and did not take the lock.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(arrived).toBe(2);
    // The winner's lock is still in place: the loser gave back what it moved.
    expect(await exists(lockDir)).toBe(true);
    expect(await leftovers()).toEqual([]);
    const winner = a.ok ? a : b;
    if (winner.ok) await winner.value.release();
    expect(await exists(lockDir)).toBe(false);
  });

  it('withManifestLock runs its work while holding the lock and releases it after', async () => {
    let heldDuring = false;
    const result = await withManifestLock(devflowDir, { timeoutMs: 0 }, async () => {
      heldDuring = await exists(lockDir);
      return 42;
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(heldDuring).toBe(true);
    expect(await exists(lockDir)).toBe(false);
  });

  it('withManifestLock releases the lock when its work fails, and passes the failure on', async () => {
    await expect(
      withManifestLock(devflowDir, { timeoutMs: 0 }, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(await exists(lockDir)).toBe(false);
  });

  it('withManifestLock does not run its work when the lock is held', async () => {
    await fs.mkdir(lockDir);
    let ran = false;
    const result = await withManifestLock(devflowDir, { timeoutMs: 0 }, async () => { ran = true; });
    expect(result).toEqual({ ok: false, error: 'not-acquired' });
    expect(ran).toBe(false);
  });
});
