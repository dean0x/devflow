/**
 * @file learning-queue-cleanup.ts
 *
 * Shared cleanup helpers for `.devflow/learning/`. Imported solely by
 * `src/cli/commands/learning.ts`:
 * - `sweepLegacyDreamMarkers` — used by `devflow learning --reset`
 * - `drainLearningQueue` — used by `devflow learning --clear` / `--disable`
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import {
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
} from './project-paths.js';

// ---------------------------------------------------------------------------
// Legacy marker-pipeline sweep
// ---------------------------------------------------------------------------

/** Fixed-name stamps left by the retired dream marker pipeline. */
const LEGACY_FIXED_STAMPS = ['.decisions-runs-today', '.curation-last', '.processor-spawned-at'];

/** Per-session marker variants: (decisions|curation).*.{json,processing,retries,failed} */
function isLegacyPerSessionMarker(name: string): boolean {
  return (
    (name.startsWith('decisions.') || name.startsWith('curation.')) &&
    (name.endsWith('.json') || name.endsWith('.processing') || name.endsWith('.retries') || name.endsWith('.failed'))
  );
}

/**
 * Sweep legacy marker-pipeline files from a `.devflow/learning/` directory:
 * the fixed-name stamps above, plus per-session `decisions.*`/`curation.*`
 * markers. Never touches `learning.json` or the live
 * `.pending-turns.jsonl`/`.pending-turns.processing` queue files.
 *
 * ENOENT-idempotent (missing learning dir or already-removed files are not
 * errors). Non-ENOENT errors are rethrown — callers that need best-effort
 * semantics (e.g. `--reset`, which must still finish releasing its lock)
 * should wrap the call in their own try/catch.
 *
 * @returns number of files removed
 */
export async function sweepLegacyDreamMarkers(learningDir: string): Promise<number> {
  let removed = 0;

  for (const name of LEGACY_FIXED_STAMPS) {
    try {
      await fs.unlink(path.join(learningDir, name));
      removed++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  try {
    const entries = await fs.readdir(learningDir);
    for (const entry of entries) {
      if (isLegacyPerSessionMarker(entry)) {
        try {
          await fs.unlink(path.join(learningDir, entry));
          removed++;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') throw err;
        }
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Live queue drain
// ---------------------------------------------------------------------------

/**
 * Drain the learning (decisions-detection) pending-turns queue so stale turns
 * don't process later — used by both `--clear` and `--disable`. A mid-run
 * Learning agent whose claimed batch vanishes aborts without changes, which is
 * the desired outcome in both cases. ENOENT-tolerant; other errors propagate.
 */
export async function drainLearningQueue(gitRoot: string): Promise<void> {
  await Promise.all([
    fs.unlink(getLearningPendingTurnsPath(gitRoot)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    }),
    fs.unlink(getLearningPendingTurnsProcessingPath(gitRoot)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    }),
  ]);
}
