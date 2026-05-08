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
});
