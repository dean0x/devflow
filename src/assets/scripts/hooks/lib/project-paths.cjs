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

/** .devflow/learning/ — learning state root */
function getLearningDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning');
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
// Feature config (neutral .devflow root — not inside learning/)
// ---------------------------------------------------------------------------

/** .devflow/config.json — per-repo facts {reviewPublication, tracker override} */
function getFeatureConfigPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'config.json');
}

// ---------------------------------------------------------------------------
// Learning queue files
// ---------------------------------------------------------------------------

/** .devflow/learning/.pending-turns.jsonl — decisions detection queue */
function getLearningPendingTurnsPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.jsonl');
}

/** .devflow/learning/.pending-turns.processing — atomic claim held by the Learning agent while processing */
function getLearningPendingTurnsProcessingPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.processing');
}

// ---------------------------------------------------------------------------
// Learning content files
// ---------------------------------------------------------------------------

/** .devflow/learning/decisions.md */
function getDecisionsFilePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions.md');
}

/** .devflow/learning/pitfalls.md */
function getPitfallsFilePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'pitfalls.md');
}

/** .devflow/learning/learning.json — project-level learning agent tuning config */
function getLearningTuningConfigPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'learning.json');
}

/** .devflow/learning/decisions-ledger.jsonl — anchored ledger rows (single source of truth for rendering) */
function getDecisionsLedgerPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-ledger.jsonl');
}

/** .devflow/learning/decisions-log.jsonl */
function getDecisionsLogPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-log.jsonl');
}

/** .devflow/learning/decisions-log.archive.jsonl — rotated-out stale observing rows (gitignored) */
function getDecisionsArchivePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-log.archive.jsonl');
}

/** .devflow/learning/decisions-history.jsonl — prior content versions of rewritten entries (learning-store.cjs) */
function getDecisionsHistoryPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-history.jsonl');
}

/** .devflow/learning/.decisions.lock — mkdir-based lock directory */
function getDecisionsLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', '.decisions.lock');
}

/** .devflow/learning/index.md — pre-rendered compact index written by render-decisions.cjs */
function getDecisionsIndexPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', 'index.md');
}

/** .devflow/learning/.observations.lock — mkdir-based lock directory for observation log writes */
function getObservationsLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'learning', '.observations.lock');
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

/** .devflow/docs/handoff-{branchSlug}.md — Code agent phase handoff artifact */
function getHandoffPath(projectRoot, branchSlug) {
  return path.join(projectRoot, '.devflow', 'docs', `handoff-${branchSlug}.md`);
}

module.exports = {
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
  // Learning content files
  getDecisionsFilePath,
  getPitfallsFilePath,
  getLearningTuningConfigPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsHistoryPath,
  getDecisionsLockDir,
  getObservationsLockDir,
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
  getHandoffPath,
};
