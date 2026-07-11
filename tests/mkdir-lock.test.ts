// tests/mkdir-lock.test.ts
//
// Behavioral tests for acquireMkdirLock.
//
// Uses a real filesystem (tmp dirs) — no mocks — to verify the actual OS-level
// locking behavior including EEXIST discrimination and stale lock recovery.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireMkdirLock } from '../src/cli/utils/mkdir-lock.js';

describe('acquireMkdirLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkdir-lock-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when lock directory is created successfully', async () => {
    const lockDir = path.join(tmpDir, '.test.lock');
    const acquired = await acquireMkdirLock(lockDir, 1_000);
    expect(acquired).toBe(true);
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it('returns false on timeout when lock is held', async () => {
    const lockDir = path.join(tmpDir, '.test.lock');
    // Pre-create the lock directory to simulate a held lock
    fs.mkdirSync(lockDir);

    // Use a short timeout and a staleMs large enough to skip stale removal
    const acquired = await acquireMkdirLock(lockDir, 200, 60_000);
    expect(acquired).toBe(false);
  });

  it('re-throws non-EEXIST errors from mkdir', async () => {
    // Point the lock at a path whose parent does not exist — mkdir throws ENOENT, not EEXIST
    const lockDir = path.join(tmpDir, 'nonexistent-parent', '.test.lock');

    await expect(acquireMkdirLock(lockDir, 1_000)).rejects.toThrow();
  });

  it('removes stale lock and acquires when lock is older than staleMs', async () => {
    const lockDir = path.join(tmpDir, '.test.lock');
    // Create a lock directory that will appear stale (staleMs = 0 ms means immediately stale)
    fs.mkdirSync(lockDir);

    const acquired = await acquireMkdirLock(lockDir, 1_000, 0);
    expect(acquired).toBe(true);
  });

  it('returns false within timeoutMs when stale lock is un-removable (non-empty dir)', async () => {
    // Regression test: if rmdir fails (e.g. ENOTEMPTY), the loop must not spin indefinitely.
    // Before the fix, `continue` on rmdir failure skipped the timeout guard → infinite spin.
    const lockDir = path.join(tmpDir, '.test.lock');
    fs.mkdirSync(lockDir);
    // Place a file inside so fs.rmdir() fails with ENOTEMPTY — a portable way to make it
    // un-removable without permission hacks.
    fs.writeFileSync(path.join(lockDir, 'sentinel'), '');

    const timeoutMs = 300;
    const before = Date.now();
    // staleMs=1 makes the just-created dir immediately "stale"; timeoutMs=300 bounds the wait.
    const acquired = await acquireMkdirLock(lockDir, timeoutMs, 1);
    const elapsed = Date.now() - before;

    expect(acquired).toBe(false);
    // Must not return instantly (proves it waited for the timeout, not a fast-path bail-out)
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 20);
    // Must complete well within a generous ceiling (not hanging due to the unbounded spin)
    expect(elapsed).toBeLessThan(1_500);
  }, 3_000); // test-level safety net: fail the test at 3s rather than letting the suite hang
});
