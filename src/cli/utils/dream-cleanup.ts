/**
 * @file dream-cleanup.ts
 *
 * Shared cleanup helpers for `.devflow/dream/` — used by both the
 * `purge-dream-marker-pipeline-v1` migration and `devflow decisions --reset`
 * (legacy marker sweep), and by `devflow decisions --clear`/`--disable`
 * (live queue drain). Centralizing these predicates keeps the two call
 * sites of each behavior byte-identical instead of hand-copied.
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
 * Sweep legacy marker-pipeline files from a `.devflow/dream/` directory:
 * the fixed-name stamps above, plus per-session `decisions.*`/`curation.*`
 * markers. Never touches `config.json` or the live
 * `.pending-turns.jsonl`/`.pending-turns.processing` queue files.
 *
 * ENOENT-idempotent (missing dream dir or already-removed files are not
 * errors). Non-ENOENT errors are rethrown — callers that need best-effort
 * semantics (e.g. `--reset`, which must still finish releasing its lock)
 * should wrap the call in their own try/catch.
 *
 * @returns number of files removed
 */
export async function sweepLegacyDreamMarkers(dreamDir: string): Promise<number> {
  let removed = 0;

  for (const name of LEGACY_FIXED_STAMPS) {
    try {
      await fs.unlink(path.join(dreamDir, name));
      removed++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  try {
    const entries = await fs.readdir(dreamDir);
    for (const entry of entries) {
      if (isLegacyPerSessionMarker(entry)) {
        try {
          await fs.unlink(path.join(dreamDir, entry));
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
 * Drain the dream (decisions-detection) pending-turns queue so stale turns
 * don't process later — used by both `--clear` and `--disable`. A mid-run
 * Dream agent whose claimed batch vanishes aborts without changes, which is
 * the desired outcome in both cases. ENOENT-tolerant; other errors propagate.
 */
export async function drainDreamQueue(gitRoot: string): Promise<void> {
  await Promise.all([
    fs.unlink(getLearningPendingTurnsPath(gitRoot)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    }),
    fs.unlink(getLearningPendingTurnsProcessingPath(gitRoot)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    }),
  ]);
}
