/**
 * @file manifest-lock.ts
 *
 * A mkdir lock for `<devflowDir>/manifest.json`. Two writers read the manifest, decide
 * and write it back: the toggle write (`writeMachineFeature`) and the read heal
 * (`readManifest`). Without a lock, a heal that parsed the file before a `--disable`
 * landed writes its stale snapshot over the disable, after the toggle reported
 * success. Both writers take this lock around their read and their write.
 *
 * The lock is a directory beside the manifest. `mkdir` is atomic, so one caller makes
 * it and every other caller sees EEXIST. A holder that died leaves the directory
 * behind; a directory older than {@link MANIFEST_LOCK_STALE_MS} counts as left over
 * and a waiter breaks it.
 *
 * Breaking is where the shared hook lock (`hooks/lib/mkdir-lock.cjs`) is weak: two
 * waiters that both saw the same stale lock can both remove it, and the second
 * removal can hit the lock that the first waiter took in between. This module breaks
 * a lock in two steps. The waiter renames the directory to a unique name, so only one
 * waiter can move it, and then checks that the directory it moved really was stale.
 * A waiter that moved a fresh lock gives it back and counts the lock as busy.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** The lock directory's name, in the machine directory beside `manifest.json`. */
export const MANIFEST_LOCK_NAME = 'manifest.json.lock';

/**
 * Age after which a lock directory counts as left behind by a dead holder. The
 * critical sections are one read and one atomic write, so a live holder is done in
 * milliseconds.
 */
export const MANIFEST_LOCK_STALE_MS = 5_000;

/**
 * The longest a toggle waits for the lock. It is longer than the stale age, so a lock
 * left by a dead holder is always broken inside the wait.
 */
export const MANIFEST_LOCK_WAIT_MS = 7_000;

const POLL_MS = 25;

/** Why a lock was not taken: held by a live holder past the wait, or its folder cannot hold a lock. */
export type ManifestLockError = 'not-acquired';

export interface ManifestLock {
  /** Remove the lock directory. Safe to call again, and when the lock is already gone. */
  readonly release: () => Promise<void>;
}

export interface ManifestLockOptions {
  /** Longest wait in milliseconds. 0 tries once and never waits. Default {@link MANIFEST_LOCK_WAIT_MS}. */
  readonly timeoutMs?: number;
  /** Age in milliseconds after which a lock counts as stale. Default {@link MANIFEST_LOCK_STALE_MS}. */
  readonly staleMs?: number;
}

/** The lock directory for `devflowDir`. */
export function getManifestLockPath(devflowDir: string): string {
  return path.join(devflowDir, MANIFEST_LOCK_NAME);
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `made`: this call made the directory. `exists`: another caller has it. `unusable`: the folder cannot hold it. */
async function makeLockDir(lockDir: string): Promise<'made' | 'exists' | 'unusable'> {
  try {
    await fs.mkdir(lockDir, { recursive: false });
    return 'made';
  } catch (err) {
    return errorCode(err) === 'EEXIST' ? 'exists' : 'unusable';
  }
}

async function removeQuietly(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover renamed directory holds no lock.
  }
}

/**
 * Break a stale lock. True when the lock path is free to take again (this call removed
 * a stale lock, or it was already gone); false when it is held by a live holder or
 * could not be moved.
 *
 * The directory is renamed to a unique name before anything is removed, so of any
 * number of waiters that judged the same lock stale, one rename succeeds and the rest
 * get ENOENT. The rename is also where a late waiter can hit a lock that a new holder
 * has taken since it judged: the age of the moved directory tells the two apart, and
 * a fresh one is put back.
 */
async function breakStaleLock(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const seen = await fs.stat(lockDir);
    if (Date.now() - seen.mtimeMs <= staleMs) return false;
  } catch (err) {
    return errorCode(err) === 'ENOENT';
  }

  const moved = `${lockDir}.stale-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await fs.rename(lockDir, moved);
  } catch (err) {
    // ENOENT: another waiter broke it, or the holder released it, since the age check.
    return errorCode(err) === 'ENOENT';
  }

  let movedAge: number;
  try {
    movedAge = Date.now() - (await fs.stat(moved)).mtimeMs;
  } catch {
    return false;
  }
  if (movedAge > staleMs) {
    await removeQuietly(moved);
    return true;
  }

  // A live holder took the lock between the age check and the rename. Give it back,
  // unless the path was taken again meanwhile; then the moved copy is a lock nobody
  // can name any more and is removed.
  try {
    await fs.lstat(lockDir);
    await removeQuietly(moved);
  } catch {
    try {
      await fs.rename(moved, lockDir);
    } catch {
      await removeQuietly(moved);
    }
  }
  return false;
}

/** One try: make the lock, or break a stale one and make it once more. */
async function tryOnce(lockDir: string, staleMs: number): Promise<'held' | 'busy' | 'unusable'> {
  const first = await makeLockDir(lockDir);
  if (first === 'made') return 'held';
  if (first === 'unusable') return 'unusable';
  if (!(await breakStaleLock(lockDir, staleMs))) return 'busy';
  const second = await makeLockDir(lockDir);
  if (second === 'made') return 'held';
  return second === 'exists' ? 'busy' : 'unusable';
}

/**
 * Take the manifest lock. Waits at most `timeoutMs` (polling every 25 ms), then gives
 * up with `not-acquired`; with `timeoutMs: 0` it tries once. The number of tries is
 * fixed by the timeout, so no wait is unbounded. A folder that cannot hold a lock (it
 * does not exist, or it is read-only) also answers `not-acquired`, at once, and this
 * call never creates the folder.
 */
export async function acquireManifestLock(
  devflowDir: string,
  options: ManifestLockOptions = {},
): Promise<Result<ManifestLock, ManifestLockError>> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? MANIFEST_LOCK_WAIT_MS);
  const staleMs = options.staleMs ?? MANIFEST_LOCK_STALE_MS;
  const lockDir = getManifestLockPath(devflowDir);
  const tries = Math.floor(timeoutMs / POLL_MS) + 1;

  for (let attempt = 0; attempt < tries; attempt++) {
    const outcome = await tryOnce(lockDir, staleMs);
    if (outcome === 'held') {
      return {
        ok: true,
        value: {
          release: async () => {
            try { await fs.rmdir(lockDir); } catch { /* already released */ }
          },
        },
      };
    }
    if (outcome === 'unusable') break;
    if (attempt < tries - 1) await sleep(POLL_MS);
  }
  return { ok: false, error: 'not-acquired' };
}

/**
 * Run `work` while holding the manifest lock, and release it after, whether `work`
 * returns or throws (a throw goes on to the caller). `work` does not run when the lock
 * is not acquired.
 */
export async function withManifestLock<T>(
  devflowDir: string,
  options: ManifestLockOptions,
  work: () => Promise<T>,
): Promise<Result<T, ManifestLockError>> {
  const lock = await acquireManifestLock(devflowDir, options);
  if (!lock.ok) return lock;
  try {
    return { ok: true, value: await work() };
  } finally {
    await lock.value.release();
  }
}
