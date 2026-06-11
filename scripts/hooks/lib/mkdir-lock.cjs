// scripts/hooks/lib/mkdir-lock.cjs
//
// Shared mkdir-based locking helpers used by json-helper.cjs, render-decisions.cjs,
// and any other CJS hook that needs exclusive access to a shared resource.
//
// DESIGN: mkdir is atomic on POSIX — the kernel guarantees that only one caller
// succeeds on a given path. On EEXIST we check staleness (mtime > staleMs) and
// break the lock if it is stale, then retry with a 50 ms idle sleep between attempts.
// Uses Atomics.wait when available (true CPU-idle blocking) or execSync('sleep 0.05')
// as the idle fallback in restricted worker environments where SharedArrayBuffer is
// unavailable. The fallback is allocated/looked-up once at module load to avoid
// per-iteration overhead.

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');

// D001: Hoist SharedArrayBuffer/Int32Array allocation to module scope so the
// Atomics.wait path never allocates per retry iteration. In environments where
// SharedArrayBuffer is unavailable (Dream worker contexts) we fall back to
// execSync('sleep 0.05') which is truly idle — no busy-wait.
/** @type {Int32Array | null} */
const _atomicsBuf = (() => {
  try { return new Int32Array(new SharedArrayBuffer(4)); } catch { return null; }
})();

/**
 * Sleep for ~50 ms in a truly-idle, CPU-friendly way.
 * Prefers Atomics.wait (zero-overhead blocking) when SharedArrayBuffer is available.
 * Falls back to execSync('sleep 0.05') in restricted contexts (Dream hook workers).
 * Never busy-waits.
 *
 * @returns {void}
 */
function _idleSleep50() {
  if (_atomicsBuf !== null) {
    Atomics.wait(_atomicsBuf, 0, 0, 50);
  } else {
    execSync('sleep 0.05');
  }
}

/**
 * Acquire a mkdir-based lock. Returns true on success, false on timeout.
 *
 * Stale-break window (applies ADR-017): a lock directory older than `staleMs`
 * (default 60 s) is forcibly removed and the caller retries. This protects against
 * crashed holders but creates a narrow TOCTOU window: if a holder is actively
 * working and takes longer than 60 s, its lock can be stolen — leading to concurrent
 * ledger writes. Current callers (assign-anchor, retire-anchor, render CLI) perform
 * only synchronous file I/O + JSON parse and complete well under 60 s in practice,
 * so this window is not reachable under normal operation. For long-running callers
 * call refreshLock(lockDir) periodically to reset the mtime and push the deadline
 * out by another staleMs interval.
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
      _idleSleep50();
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

/**
 * Refresh a held lock by touching its mtime, extending the stale-break deadline
 * by another staleMs interval. Call periodically from long-running critical sections
 * to prevent the lock from being stolen by a concurrent acquirer's stale-break check.
 * No-op if the lock directory no longer exists (handles benign ENOENT races).
 *
 * @param {string} lockDir
 */
function refreshLock(lockDir) {
  const now = new Date();
  try { fs.utimesSync(lockDir, now, now); } catch { /* lock released or raced away — ignore */ }
}

module.exports = { acquireMkdirLock, releaseLock, refreshLock };
