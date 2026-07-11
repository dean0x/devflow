import { promises as fs } from 'fs';

/**
 * @file mkdir-lock.ts
 *
 * Generic async mkdir-based lock with stale detection.
 * Used by CLI writers and background pipelines to serialize file mutations.
 */

/**
 * Acquire a mkdir-based lock directory.
 *
 * Used by CLI writers (`--review`, `--dismiss-capacity`) to serialize
 * against the background learning pipeline. `.learning.lock` guards log mutations;
 * `.decisions.lock` guards decisions.md / pitfalls.md — the caller picks the path.
 *
 * Stale detection: if the lock directory is older than `staleMs` we assume the
 * previous holder crashed and remove it. `json-helper.cjs` uses the same
 * 60 s threshold; `background-learning` intentionally uses 300 s (guards the
 * full Sonnet pipeline, not just file I/O — see DESIGN comment in that script).
 *
 * @returns true when the lock was acquired, false on timeout.
 */
export async function acquireMkdirLock(lockDir: string, timeoutMs = 30_000, staleMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockDir);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > staleMs) {
          // D57: Track whether rmdir succeeded. Only retry immediately on success.
          // If the lock dir is un-removable (e.g. ENOTEMPTY, permission error) we must
          // fall through to the timeout guard + backoff below — never spin unconditionally.
          let removed = true;
          try { await fs.rmdir(lockDir); } catch { removed = false; /* race condition OK */ }
          if (removed) continue; // stale lock cleared → retry mkdir immediately
          // else: un-removable stale lock → fall through to timeout guard + backoff
        }
      } catch { /* lock vanished between EEXIST and stat */ }
      if (Date.now() - start >= timeoutMs) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
