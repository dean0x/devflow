/**
 * @file project-paths.ts
 *
 * Centralized path construction for all project-relative directories and files.
 *
 * DESIGN: Every function takes `projectRoot: string` (an absolute path to the
 * git repository root or worktree root) and returns an absolute path string.
 * All construction uses `path.join()` — no string concatenation.
 *
 * ARCHITECTURE: This module is the single source of truth for path layout.
 *
 * CJS COUNTERPART: src/assets/scripts/hooks/lib/project-paths.cjs must mirror this file
 * exactly. Keep them in sync when adding or changing functions. The one exception is
 * `curationMoveMarkerKey`: the shell writes the marker it names and only the TypeScript
 * readers compute it.
 */

import * as path from 'path';

// ---------------------------------------------------------------------------
// Core directories
// ---------------------------------------------------------------------------

/** .devflow/memory/ — working memory root */
export function getMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory');
}

/** .devflow/learning/ — learning state root */
export function getLearningDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning');
}

/** .devflow/features/ — per-feature knowledge bases */
export function getFeaturesDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features');
}

/** .devflow/docs/ — generated documentation artifacts */
export function getDocsDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'docs');
}

// ---------------------------------------------------------------------------
// The rename's names: the old names in one frozen block, the new ones beside it
// ---------------------------------------------------------------------------

/**
 * The names the rename retires, kept in one place so the one-time ledger move, the
 * backup readers and uninstall all spell them the same way. The CJS mirror and the
 * shell move shim list the same names (tests/project-paths.test.ts pins both).
 */
export const LEGACY_NAMES = Object.freeze({
  /** The old ledger folder under .devflow/. */
  folder: 'learning',
  /** The prefix of the folder the move leaves behind: `<prefix><UTC stamp>-<random>`. */
  backupPrefix: 'learning.backup-',
  /** The old project tuning file, inside the old folder. */
  tuningFile: 'learning.json',
});

/** The new ledger folder under .devflow/. */
export const CURATION_DIR_NAME = 'curation';

/** The new project tuning file, inside the new folder. */
export const CURATION_TUNING_FILE_NAME = 'curation.json';

/** Letters and digits: the bytes the move marker key keeps as they are. */
const ALPHANUMERIC_BYTE = /^[A-Za-z0-9]$/;

/** The number of trailing root bytes the move marker key spells out. */
const MARKER_KEY_TAIL_BYTES = 60;

/**
 * The key of a ledger root's move-refusal marker (`curation-move.<key>.skip` at
 * the logs root): a 32-bit hash of every UTF-8 byte of the root, as eight
 * lowercase hex characters, then an underscore, then the last 60 bytes of the
 * root with every byte outside letters and digits replaced by an underscore.
 *
 * The hash starts at 5381 and takes each byte as `byte & 255`, setting the hash to
 * 33 times the hash plus the byte, masked to 32 bits. The shell computes the same
 * string with builtins only under LC_ALL=C, so bash 3.2 and bash 5 must agree on a
 * non-ASCII root; status and the HUD read the marker through this function. A key
 * collision only costs one extra move attempt.
 */
export function curationMoveMarkerKey(projectRoot: string): string {
  const bytes = Buffer.from(projectRoot, 'utf8');
  let hash = 5381;
  for (const byte of bytes) hash = (Math.imul(hash, 33) + byte) >>> 0;
  const start = Math.max(0, bytes.length - MARKER_KEY_TAIL_BYTES);
  let tail = '';
  for (const byte of bytes.subarray(start)) {
    const char = String.fromCharCode(byte);
    tail += ALPHANUMERIC_BYTE.test(char) ? char : '_';
  }
  return `${hash.toString(16).padStart(8, '0')}_${tail}`;
}

// ---------------------------------------------------------------------------
// Feature config (neutral .devflow root — not inside learning/)
// ---------------------------------------------------------------------------

/** .devflow/config.json — per-repo facts {reviewPublication, tracker override} */
export function getFeatureConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'config.json');
}

// ---------------------------------------------------------------------------
// Learning queue files
// ---------------------------------------------------------------------------

/** .devflow/learning/.pending-turns.jsonl — decisions detection queue */
export function getLearningPendingTurnsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.jsonl');
}

/** .devflow/learning/.pending-turns.processing — the claimed batch a Curate run holds while it processes it */
export function getLearningPendingTurnsProcessingPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.processing');
}

/** .devflow/learning/.pending-turns.owner — the token of the run that holds the claim (learning-store.cjs) */
export function getLearningClaimOwnerPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.owner');
}

// ---------------------------------------------------------------------------
// Learning content files
// ---------------------------------------------------------------------------

/** .devflow/learning/decisions.md */
export function getDecisionsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions.md');
}

/** .devflow/learning/pitfalls.md */
export function getPitfallsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'pitfalls.md');
}

/** .devflow/learning/learning.json — project-level curate agent tuning config */
export function getCurateTuningConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'learning.json');
}

/** .devflow/learning/decisions-ledger.jsonl — anchored ledger rows (single source of truth for rendering) */
export function getDecisionsLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-ledger.jsonl');
}

/** .devflow/learning/decisions-log.jsonl */
export function getDecisionsLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-log.jsonl');
}

/** .devflow/learning/decisions-log.archive.jsonl — rotated-out stale observing rows (gitignored) */
export function getDecisionsArchivePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-log.archive.jsonl');
}

/** .devflow/learning/decisions-history.jsonl — prior content versions of rewritten entries (learning-store.cjs) */
export function getDecisionsHistoryPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-history.jsonl');
}

/** .devflow/learning/.decisions.lock — mkdir-based lock directory */
export function getDecisionsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.decisions.lock');
}

/** .devflow/learning/index.md — pre-rendered compact index written by render-decisions.cjs */
export function getDecisionsIndexPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'index.md');
}

// ---------------------------------------------------------------------------
// Memory / working-memory files
// ---------------------------------------------------------------------------

/** .devflow/memory/WORKING-MEMORY.md */
export function getWorkingMemoryPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', 'WORKING-MEMORY.md');
}

/** .devflow/memory/backup.json — pre-compact git state snapshot */
export function getBackupPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', 'backup.json');
}

/** .devflow/memory/.pending-turns.jsonl — queue of captured turns */
export function getPendingTurnsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', '.pending-turns.jsonl');
}

/** .devflow/memory/.pending-turns.processing — atomic handoff during processing */
export function getPendingTurnsProcessingPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', '.pending-turns.processing');
}

/** .devflow/memory/.pending-turns.lock — mutex for queue operations */
export function getPendingTurnsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', '.pending-turns.lock');
}

// ---------------------------------------------------------------------------
// Docs files
// ---------------------------------------------------------------------------

/** .devflow/docs/reviews/ */
export function getReviewsDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'docs', 'reviews');
}

/** .devflow/docs/design/ */
export function getDesignDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'docs', 'design');
}

/** .devflow/docs/research/ */
export function getResearchDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'docs', 'research');
}
