/**
 * @file manifest-lock.ts
 *
 * A mkdir lock for `<devflowDir>/manifest.json`. It covers two writers, which read the
 * manifest, decide and write it back: the toggle write of the `memory`, `curation`,
 * `knowledge` and `behavior` switches (`writeMachineFeature`) and the read heal
 * (`readManifest`). Without a lock, a heal that parsed the file
 * before a `--disable` landed writes its stale snapshot over the disable, after the
 * toggle reported success. Both writers take this lock around their read and their write.
 *
 * Every other writer of the manifest takes no lock: `syncManifestFeature` (the `hud`,
 * `security`, `proxy` and `tracker` toggles), the `flags` and `rules` writes, the gate
 * level writer and init. Such a write can still overwrite a toggle that lands between its
 * read and its write. That gap is older than this lock and is tracked in issue #587.
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
 *
 * The give-back leaves a short time in which the live holder's directory is not at the
 * path, and a third caller can make a directory there. So a holder records the identity
 * (device and inode) of the directory it made, and `stillHeld()` tells it whether that
 * directory is still the one at the path. A holder calls it just before its write. When
 * it answers false, the holder does not write: the heal skips, and the toggle takes the
 * lock again. A release removes the directory only while it is still the holder's own.
 * The check narrows the window to the time between the check and the write itself; a
 * directory lock cannot close it. A fourth caller that makes a directory which reuses the
 * freed inode number of the first holder's directory would also pass the check.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import * as path from 'path';

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** The lock directory's name, in the machine directory beside `manifest.json`. */
export const MANIFEST_LOCK_NAME = 'manifest.json.lock';

/**
 * What a stale break adds to the lock's name for the directory it moves aside:
 * `manifest.json.lock.stale-<pid>-<12 lowercase hex>`. A break whose removal failed leaves one.
 */
export const MANIFEST_LOCK_STALE_MARK = '.stale-';

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
  /**
   * True while the directory at the lock path is the one this holder made. A holder
   * calls it just before its write, and does not write when it answers false.
   */
  readonly stillHeld: () => Promise<boolean>;
  /**
   * Remove the lock directory, only while it is the one this holder made. Safe to call
   * again, and when the lock is already gone.
   */
  readonly release: () => Promise<void>;
}

/** What a holder asks of its lock while it works. */
export type ManifestLockCheck = Pick<ManifestLock, 'stillHeld'>;

/** The device and inode of a lock directory: the identity of one directory, which a rename keeps. */
interface DirectoryIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
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

/** `made`: this call made the directory, with its identity. `exists`: another caller has it, or it was taken away at once. `unusable`: the folder cannot hold it. */
async function makeLockDir(lockDir: string): Promise<{ readonly made: DirectoryIdentity } | 'exists' | 'unusable'> {
  try {
    await fs.mkdir(lockDir, { recursive: false });
  } catch (err) {
    return errorCode(err) === 'EEXIST' ? 'exists' : 'unusable';
  }
  const identity = await identityOf(lockDir);
  return identity === null ? 'exists' : { made: identity };
}

/** The identity of the directory at `lockDir`, or null when nothing, or something that is not a directory, is there. */
async function identityOf(lockDir: string): Promise<DirectoryIdentity | null> {
  try {
    const stat = await fs.lstat(lockDir, { bigint: true });
    return stat.isDirectory() ? { dev: stat.dev, ino: stat.ino } : null;
  } catch {
    return null;
  }
}

async function isSameDirectory(lockDir: string, identity: DirectoryIdentity): Promise<boolean> {
  const now = await identityOf(lockDir);
  return now !== null && now.dev === identity.dev && now.ino === identity.ino;
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

  const moved = `${lockDir}${MANIFEST_LOCK_STALE_MARK}${process.pid}-${randomBytes(6).toString('hex')}`;
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
  // unless the path was taken again meanwhile; then the moved copy is removed, and its
  // holder finds out through `stillHeld` that its directory is not at the path any more.
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
async function tryOnce(lockDir: string, staleMs: number): Promise<DirectoryIdentity | 'busy' | 'unusable'> {
  const first = await makeLockDir(lockDir);
  if (typeof first === 'object') return first.made;
  if (first === 'unusable') return 'unusable';
  if (!(await breakStaleLock(lockDir, staleMs))) return 'busy';
  const second = await makeLockDir(lockDir);
  if (typeof second === 'object') return second.made;
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
    if (typeof outcome === 'object') {
      return {
        ok: true,
        value: {
          stillHeld: () => isSameDirectory(lockDir, outcome),
          release: async () => {
            if (!(await isSameDirectory(lockDir, outcome))) return;
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
 * is not acquired. `work` gets the holder's `stillHeld` check, to call just before it writes.
 */
export async function withManifestLock<T>(
  devflowDir: string,
  options: ManifestLockOptions,
  work: (lock: ManifestLockCheck) => Promise<T>,
): Promise<Result<T, ManifestLockError>> {
  const lock = await acquireManifestLock(devflowDir, options);
  if (!lock.ok) return lock;
  try {
    return { ok: true, value: await work({ stillHeld: lock.value.stillHeld }) };
  } finally {
    await lock.value.release();
  }
}
