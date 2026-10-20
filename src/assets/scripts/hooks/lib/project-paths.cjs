// src/assets/scripts/hooks/lib/project-paths.cjs
//
// Centralized path construction for all project-relative directories and files.
//
// DESIGN: Every function takes `projectRoot` (absolute path) and returns an
// absolute path string. All construction uses path.join() — no string concatenation.
//
// ARCHITECTURE: This module is the single source of truth for path layout in
// the CJS hook layer. Must match src/core/project-paths.ts exactly.
//
// TS COUNTERPART: src/core/project-paths.ts must mirror this file exactly.
// Keep them in sync when adding or changing functions.

'use strict';

const crypto = require('crypto');
const path = require('path');

// ---------------------------------------------------------------------------
// Core directories
// ---------------------------------------------------------------------------

/** .devflow/memory/ — working memory root */
function getMemoryDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory');
}

/** .devflow/curation/ — curation state root */
function getCurationDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation');
}

/** .devflow/features/ — per-feature knowledge bases */
function getFeaturesDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'features');
}

/** .devflow/docs/ — generated documentation artifacts */
function getDocsDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'docs');
}

// ---------------------------------------------------------------------------
// The rename's names: the old names in one frozen block, the new ones beside it
// ---------------------------------------------------------------------------

/**
 * The names the rename retires, kept in one place so the one-time ledger move, the
 * backup readers and uninstall all spell them the same way. The TypeScript mirror
 * and the shell move shim list the same names (tests/project-paths.test.ts pins both).
 */
const LEGACY_NAMES = Object.freeze({
  /** The old ledger folder under .devflow/. */
  folder: 'learning',
  /** The prefix of the folder the move leaves behind: `<prefix><UTC stamp>-<random>`. */
  backupPrefix: 'learning.backup-',
  /** The old project tuning file, inside the old folder. */
  tuningFile: 'learning.json',
});

/** The new ledger folder under .devflow/. */
const CURATION_DIR_NAME = 'curation';

/** The new project tuning file, inside the new folder. */
const CURATION_TUNING_FILE_NAME = 'curation.json';

/**
 * The global curate-agent tuning file inside the machine directory (`~/.devflow`).
 * The one place that names it: the configure writer, the TypeScript reader, the
 * shell reader (`df_global_tuning_file` in the hooks' git-marker library) and the
 * global-file lists all come through here.
 */
function getGlobalCurateTuningConfigPath(machineDir) {
  return path.join(machineDir, CURATION_TUNING_FILE_NAME);
}

// ---------------------------------------------------------------------------
// Feature config (neutral .devflow root — not inside curation/)
// ---------------------------------------------------------------------------

/** .devflow/config.json — per-repo facts {reviewPublication, tracker override} */
function getFeatureConfigPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'config.json');
}

// ---------------------------------------------------------------------------
// Curation queue files
// ---------------------------------------------------------------------------

/** .devflow/curation/.pending-turns.jsonl — decisions detection queue */
function getCurationPendingTurnsPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.pending-turns.jsonl');
}

/** .devflow/curation/.pending-turns.processing — the claimed batch a Curate run holds while it processes it */
function getCurationPendingTurnsProcessingPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.pending-turns.processing');
}

/** .devflow/curation/.pending-turns.owner — the token of the run that holds the claim (curation-store.cjs) */
function getCurationClaimOwnerPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.pending-turns.owner');
}

// ---------------------------------------------------------------------------
// Curation content files
// ---------------------------------------------------------------------------

/** .devflow/curation/decisions.md */
function getDecisionsFilePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'decisions.md');
}

/** .devflow/curation/pitfalls.md */
function getPitfallsFilePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'pitfalls.md');
}

/** .devflow/curation/curation.json — project-level curate agent tuning config */
function getCurateTuningConfigPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'curation.json');
}

/** .devflow/curation/decisions-ledger.jsonl — anchored ledger rows (single source of truth for rendering) */
function getDecisionsLedgerPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'decisions-ledger.jsonl');
}

/** .devflow/curation/decisions-log.jsonl */
function getDecisionsLogPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'decisions-log.jsonl');
}

/** .devflow/curation/decisions-log.archive.jsonl — rotated-out stale observing rows (gitignored) */
function getDecisionsArchivePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'decisions-log.archive.jsonl');
}

/** .devflow/curation/decisions-history.jsonl — prior content versions of rewritten entries (curation-store.cjs) */
function getDecisionsHistoryPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'decisions-history.jsonl');
}

/** .devflow/curation/.decisions.lock — mkdir-based lock directory */
function getDecisionsLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.decisions.lock');
}

/** .devflow/curation/index.md — pre-rendered compact index written by render-decisions.cjs */
function getDecisionsIndexPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', 'index.md');
}

// ---------------------------------------------------------------------------
// Memory / working-memory files
// ---------------------------------------------------------------------------

/** .devflow/memory/WORKING-MEMORY.md */
function getWorkingMemoryPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory', 'WORKING-MEMORY.md');
}

/** .devflow/memory/backup.json — pre-compact git state snapshot */
function getBackupPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory', 'backup.json');
}

/** .devflow/memory/.pending-turns.jsonl — queue of captured turns */
function getPendingTurnsPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory', '.pending-turns.jsonl');
}

/** .devflow/memory/.pending-turns.processing — atomic handoff during processing */
function getPendingTurnsProcessingPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory', '.pending-turns.processing');
}

/** .devflow/memory/.pending-turns.lock — mutex for queue operations */
function getPendingTurnsLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory', '.pending-turns.lock');
}

// ---------------------------------------------------------------------------
// Docs files
// ---------------------------------------------------------------------------

/** .devflow/docs/reviews/ */
function getReviewsDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'docs', 'reviews');
}

/** .devflow/docs/design/ */
function getDesignDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'docs', 'design');
}

/** .devflow/docs/research/ */
function getResearchDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'docs', 'research');
}

// ---------------------------------------------------------------------------
// The ledger move's machine-side names
// ---------------------------------------------------------------------------
//
// Not project paths: the move lock and the move journal stand in the machine
// directory (`$HOME/.devflow`), keyed by the ledger root, never inside a repository.
// They sit here, and not in curation-move.cjs, because the store's write guard reads
// the journal and must not load the move module to do it. CJS only: no TypeScript code
// builds them (a named exception of the export parity test).

/** A move lock is `<prefix><16 hex characters of the root key><suffix>` in the machine directory. */
const MOVE_LOCK_PREFIX = '.curation-move-';
const MOVE_LOCK_SUFFIX = '.lock';

/** A move journal is `<prefix><16 hex characters of the root key><suffix>` in the machine directory, next to the move lock. */
const MOVE_JOURNAL_SUFFIX = '.journal';

/**
 * The key of a ledger root's move lock: the first 16 hex characters of the sha256 of
 * the root's physical path. Two spellings of one root give one key, so two movers
 * meet at one lock.
 *
 * @param {string} realRoot - the root's realpath
 * @returns {string}
 */
function curationMoveLockKey(realRoot) {
  return crypto.createHash('sha256').update(realRoot).digest('hex').slice(0, 16);
}

/** The move lock's directory, under the machine directory. */
function curationMoveLockDir(machineDir, realRoot) {
  return path.join(machineDir, `${MOVE_LOCK_PREFIX}${curationMoveLockKey(realRoot)}${MOVE_LOCK_SUFFIX}`);
}

/**
 * The move journal's file, under the machine directory and keyed exactly like the move
 * lock. While it exists every store write on the root returns busy.
 */
function curationMoveJournalPath(machineDir, realRoot) {
  return path.join(machineDir, `${MOVE_LOCK_PREFIX}${curationMoveLockKey(realRoot)}${MOVE_JOURNAL_SUFFIX}`);
}

module.exports = {
  // The rename's names
  LEGACY_NAMES,
  CURATION_DIR_NAME,
  CURATION_TUNING_FILE_NAME,
  // Core directories
  getMemoryDir,
  getCurationDir,
  getFeaturesDir,
  getDocsDir,
  // Feature config
  getFeatureConfigPath,
  // Curation queue files
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
  getCurationClaimOwnerPath,
  // Curation content files
  getDecisionsFilePath,
  getPitfallsFilePath,
  getCurateTuningConfigPath,
  getGlobalCurateTuningConfigPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsHistoryPath,
  getDecisionsLockDir,
  getDecisionsIndexPath,
  // Memory files
  getWorkingMemoryPath,
  getBackupPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
  getPendingTurnsLockDir,
  // Docs files
  getReviewsDir,
  getDesignDir,
  getResearchDir,
  // The ledger move's machine-side names
  curationMoveLockKey,
  curationMoveLockDir,
  curationMoveJournalPath,
};
