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

const path = require('path');

// ---------------------------------------------------------------------------
// Core directories
// ---------------------------------------------------------------------------

/** .devflow/memory/ — working memory root */
function getMemoryDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory');
}

/** .devflow/curation/ — curation state root */
function getLearningDir(projectRoot) {
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
// Learning queue files
// ---------------------------------------------------------------------------

/** .devflow/curation/.pending-turns.jsonl — decisions detection queue */
function getLearningPendingTurnsPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.pending-turns.jsonl');
}

/** .devflow/curation/.pending-turns.processing — the claimed batch a Curate run holds while it processes it */
function getLearningPendingTurnsProcessingPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.pending-turns.processing');
}

/** .devflow/curation/.pending-turns.owner — the token of the run that holds the claim (curation-store.cjs) */
function getLearningClaimOwnerPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'curation', '.pending-turns.owner');
}

// ---------------------------------------------------------------------------
// Learning content files
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

module.exports = {
  // The rename's names
  LEGACY_NAMES,
  CURATION_DIR_NAME,
  CURATION_TUNING_FILE_NAME,
  // Core directories
  getMemoryDir,
  getLearningDir,
  getFeaturesDir,
  getDocsDir,
  // Feature config
  getFeatureConfigPath,
  // Learning queue files
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
  getLearningClaimOwnerPath,
  // Learning content files
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
};
