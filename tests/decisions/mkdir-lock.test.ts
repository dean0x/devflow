/**
 * acquireMkdirLock (hooks/lib/mkdir-lock.cjs): every wait is bounded by its timeout.
 *
 * A stale lock is broken with rmdir. When the rmdir fails (the lock holds files, or
 * something other than a directory sits at its path), the lock is waited on like a
 * live one, so the call answers false once the timeout passes. The no-wait callers
 * (the ledger move, with a timeout of 0) answer at once instead of spinning.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ROOT } from './curation-fixtures.js';

interface MkdirLockApi {
  acquireMkdirLock(lockDir: string, timeoutMs?: number, staleMs?: number): boolean;
  releaseLock(lockDir: string): void;
}

const lock = createRequire(import.meta.url)(path.join(ROOT, 'src/assets/scripts/hooks/lib/mkdir-lock.cjs')) as MkdirLockApi;

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mkdir-lock-')));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Set `target`'s mtime 10 minutes into the past, so any stale age below that calls it stale. */
function makeOld(target: string): void {
  const past = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(target, past, past);
}

describe('acquireMkdirLock', () => {
  it('breaks a stale empty lock and takes it', () => {
    const lockDir = path.join(dir, '.decisions.lock');
    fs.mkdirSync(lockDir);
    makeOld(lockDir);
    expect(lock.acquireMkdirLock(lockDir, 0, 1000)).toBe(true);
    expect(fs.statSync(lockDir).mtimeMs).toBeGreaterThan(Date.now() - 60 * 1000);
    lock.releaseLock(lockDir);
  });

  it('answers false at once, with no wait, for a stale lock that holds a file', () => {
    const lockDir = path.join(dir, '.decisions.lock');
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'pid'), '1\n');
    makeOld(lockDir);
    const start = Date.now();
    expect(lock.acquireMkdirLock(lockDir, 0, 1000)).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8')).toBe('1\n');
  });

  it('answers false at once for a stale file at the lock path, and leaves the file', () => {
    const lockDir = path.join(dir, '.decisions.lock');
    fs.writeFileSync(lockDir, 'not a lock\n');
    makeOld(lockDir);
    expect(lock.acquireMkdirLock(lockDir, 0, 1000)).toBe(false);
    expect(fs.readFileSync(lockDir, 'utf8')).toBe('not a lock\n');
  });

  it('waits no longer than its timeout for a stale lock it cannot break', () => {
    const lockDir = path.join(dir, '.decisions.lock');
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, 'pid'), '1\n');
    makeOld(lockDir);
    const start = Date.now();
    expect(lock.acquireMkdirLock(lockDir, 200, 1000)).toBe(false);
    const waited = Date.now() - start;
    expect(waited).toBeGreaterThanOrEqual(200);
    expect(waited).toBeLessThan(5000);
  });
});
