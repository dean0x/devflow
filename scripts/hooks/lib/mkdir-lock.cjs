// scripts/hooks/lib/mkdir-lock.cjs
//
// Shared mkdir-based locking helpers used by json-helper.cjs, render-decisions.cjs,
// and any other CJS hook that needs exclusive access to a shared resource.
//
// DESIGN: mkdir is atomic on POSIX — the kernel guarantees that only one caller
// succeeds on a given path. On EEXIST we check staleness (mtime > staleMs) and
// break the lock if it is stale, then spin with a 50 ms busy-wait. Falls back to
// a spin loop if SharedArrayBuffer is unavailable (restricted worker environments).

'use strict';

const fs = require('fs');

/**
 * Acquire a mkdir-based lock. Returns true on success, false on timeout.
 *
 * @param {string} lockDir - path to lock directory
 * @param {number} [timeoutMs=30000] - max wait in milliseconds
 * @param {number} [staleMs=60000] - age after which lock is considered stale
 * @returns {boolean}
 */
function acquireMkdirLock(lockDir, timeoutMs = 30000, staleMs = 60000) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockDir);
        const age = Date.now() - stat.mtimeMs;
        if (age > staleMs) {
          try { fs.rmdirSync(lockDir); } catch { /* already gone */ }
          continue;
        }
      } catch { /* lock gone between check and stat */ }
      if (Date.now() - start >= timeoutMs) return false;
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      } catch {
        const end = Date.now() + 50;
        while (Date.now() < end) { /* spin */ }
      }
    }
  }
}

/**
 * Release a mkdir-based lock. No-op if already released.
 *
 * @param {string} lockDir
 */
function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir); } catch { /* already released */ }
}

module.exports = { acquireMkdirLock, releaseLock };
