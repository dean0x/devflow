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
    // waiter has settled, and so renames the holder's fresh lock, not the stale one.
    // The roles follow the arrival at the rename, not the start order: two calls
    // started together reach it in either order (their file system calls finish on
    // the thread pool). The waiter held second can not settle, so the first to
    // settle is the one that arrived first.
    const realRename = fs.rename.bind(fs);
    let arrived = 0;
    let bothArrived!: () => void;
    const bothJudgedStale = new Promise<void>((resolve) => { bothArrived = resolve; });
    let firstSettles!: () => void;
    const firstHasSettled = new Promise<void>((resolve) => { firstSettles = resolve; });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) !== lockDir) return realRename(from, to);
      arrived += 1;
      const position = arrived;
      if (arrived === 2) bothArrived();
      await bothJudgedStale;
      if (position === 2) await firstHasSettled;
      return realRename(from, to);
    });

    const settle = (result: Awaited<ReturnType<typeof acquireManifestLock>>) => {
      firstSettles();
      return result;
    };
    const [a, b] = await Promise.all([
      acquireManifestLock(devflowDir, { timeoutMs: 400 }).then(settle),
      acquireManifestLock(devflowDir, { timeoutMs: 400 }).then(settle),
    ]);

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

  describe('a holder can tell that its lock directory is still the one it made', () => {
    it('stillHeld is true while the lock is held and false once it is released', async () => {
      const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
      if (!lock.ok) throw new Error('lock not taken');
      expect(await lock.value.stillHeld()).toBe(true);
      await lock.value.release();
      expect(await lock.value.stillHeld()).toBe(false);
    });

    it('stillHeld is false when the lock directory is gone, and when another directory stands at the path', async () => {
      const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
      if (!lock.ok) throw new Error('lock not taken');
      await fs.rm(lockDir, { recursive: true });
      expect(await lock.value.stillHeld()).toBe(false);
      await fs.mkdir(lockDir);
      expect(await lock.value.stillHeld()).toBe(false);
    });

    it('stillHeld is false for another directory even when the file system gives it the same device and inode numbers', async () => {
      // Linux file systems often hand a freed inode number to the next directory made.
      // The stat of the lock path is made to answer with one fixed device and inode, as
      // that reuse would, so the check cannot rely on those two numbers.
      const realLstat = fs.lstat.bind(fs);
      vi.spyOn(fs, 'lstat').mockImplementation((async (target: Parameters<typeof fs.lstat>[0], options?: Parameters<typeof fs.lstat>[1]) => {
        const stat = await realLstat(target, options as never);
        if (String(target) !== lockDir) return stat;
        return new Proxy(stat, {
          get(inner, key) {
            if (key === 'dev' || key === 'ino') return typeof inner[key] === 'bigint' ? 1n : 1;
            const value = Reflect.get(inner, key) as unknown;
            return typeof value === 'function' ? value.bind(inner) : value;
          },
        });
      }) as typeof fs.lstat);
      try {
        const lock = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
        if (!lock.ok) throw new Error('lock not taken');
        await fs.rm(lockDir, { recursive: true });
        await fs.mkdir(lockDir);
        expect(await lock.value.stillHeld(), 'an empty directory at the path').toBe(false);
        const other = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
        expect(other.ok, 'the path is taken by a directory without a holder token').toBe(false);
        await fs.rm(lockDir, { recursive: true });
        const next = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
        if (!next.ok) throw new Error('second lock not taken');
        expect(await lock.value.stillHeld(), 'a second holder\'s directory at the path').toBe(false);
        expect(await next.value.stillHeld()).toBe(true);
        await lock.value.release();
        expect(await exists(lockDir), 'the first holder\'s release leaves the second holder\'s lock').toBe(true);
        await next.value.release();
        expect(await exists(lockDir)).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('withManifestLock hands its work the same check', async () => {
      const seen: boolean[] = [];
      await withManifestLock(devflowDir, { timeoutMs: 0 }, async (lock) => {
        seen.push(await lock.stillHeld());
        await fs.rm(lockDir, { recursive: true });
        seen.push(await lock.stillHeld());
      });
      expect(seen).toEqual([true, false]);
    });

    it('three callers: B moves the live lock of A, C takes the free path, B gives the lock back. A is told it lost it, C holds, and A\'s release leaves C\'s lock', async () => {
      // A dead lock is on the path. A and B both judge it stale. A breaks it and takes
      // a fresh lock. B then moves A's fresh lock away (it had judged the dead one).
      // While the path is empty, C takes it. B finds the moved lock fresh and gives it
      // back, and the path is C's: B removes A's directory.
      await fs.mkdir(lockDir);
      await makeStale(lockDir);

      const realRename = fs.rename.bind(fs);
      const realStat = fs.stat.bind(fs);
      let arrived = 0;
      let aArrived!: () => void;
      const aAtRename = new Promise<void>((resolve) => { aArrived = resolve; });
      let bothArrived!: () => void;
      const bothJudgedStale = new Promise<void>((resolve) => { bothArrived = resolve; });
      let aHolds!: () => void;
      const aHasLock = new Promise<void>((resolve) => { aHolds = resolve; });
      let aTookLock = false;
      let c: Awaited<ReturnType<typeof acquireManifestLock>> | undefined;
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (String(from) !== lockDir) return realRename(from, to);
        arrived += 1;
        const position = arrived;
        if (arrived === 1) aArrived();
        if (arrived === 2) bothArrived();
        await bothJudgedStale;
        if (position === 2) await aHasLock;
        return realRename(from, to);
      });
      // B has just moved A's lock, and its next call is the age check of the moved
      // directory. The path is empty at that point, and C takes it.
      vi.spyOn(fs, 'stat').mockImplementation((async (...args: Parameters<typeof fs.stat>) => {
        if (aTookLock && c === undefined && String(args[0]).startsWith(`${lockDir}.stale-`)) {
          c = await acquireManifestLock(devflowDir, { timeoutMs: 0 });
        }
        return realStat(...args);
      }) as typeof fs.stat);

      const callerA = acquireManifestLock(devflowDir, { timeoutMs: 0 }).then((result) => {
        if (result.ok) { aTookLock = true; aHolds(); }
        return result;
      });
      // B starts only once A waits at the rename, so A is the first to arrive there. Two
      // calls started together reach the rename in either order (their file system calls
      // finish on the thread pool), and a B that came first would wait for A for ever.
      // The race fails at once, with a name, when A settles without reaching the rename.
      const first = await Promise.race([
        aAtRename.then(() => 'rename' as const),
        callerA.then(() => 'settled' as const),
      ]);
      expect(first, 'A reached the rename before it settled').toBe('rename');
      const callerB = acquireManifestLock(devflowDir, { timeoutMs: 0 });
      const [a, b] = await Promise.all([callerA, callerB]);

      expect(a.ok).toBe(true);
      expect(b).toEqual({ ok: false, error: 'not-acquired' });
      expect(arrived).toBe(2);
      if (!a.ok || c === undefined || !c.ok) throw new Error('the sequence did not run');

      expect(await a.value.stillHeld(), 'A lost its directory to B and C').toBe(false);
      expect(await c.value.stillHeld(), 'C holds the path').toBe(true);
      await a.value.release();
      expect(await exists(lockDir), 'A\'s release does not remove the lock C holds').toBe(true);
      expect(await c.value.stillHeld()).toBe(true);
      await c.value.release();
      expect(await exists(lockDir)).toBe(false);
      expect(await leftovers()).toEqual([]);
    });
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
