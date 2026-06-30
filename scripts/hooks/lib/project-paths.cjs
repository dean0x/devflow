// scripts/hooks/lib/project-paths.cjs
//
// Centralized path construction for all project-relative directories and files.
//
// DESIGN: Every function takes `projectRoot` (absolute path) and returns an
// absolute path string. All construction uses path.join() — no string concatenation.
//
// ARCHITECTURE: This module is the single source of truth for path layout in
// the CJS hook layer. Must match src/cli/utils/project-paths.ts exactly.
// PR 5b flipped these return values from the old .memory/.features/.docs layout
// to the new consolidated .devflow/ layout.
//
// TS COUNTERPART: src/cli/utils/project-paths.ts must mirror this file exactly.
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

/** .devflow/dream/ — dream state directory */
function getDreamDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'dream');
}

/** .devflow/decisions/ — decisions and pitfalls subdirectory (promoted from .memory/decisions/) */
function getDecisionsDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions');
}

/** .devflow/features/ — per-feature knowledge bases (promoted from .features/) */
function getFeaturesDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'features');
}

/** .devflow/docs/ — generated documentation artifacts (promoted from .docs/) */
function getDocsDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'docs');
}

// ---------------------------------------------------------------------------
// Dream files
// ---------------------------------------------------------------------------

/** .devflow/dream/config.json — dream feature config */
function getDreamConfigPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'dream', 'config.json');
}

// ---------------------------------------------------------------------------
// Decisions files
// ---------------------------------------------------------------------------

/** .devflow/decisions/decisions.md */
function getDecisionsFilePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions.md');
}

/** .devflow/decisions/pitfalls.md */
function getPitfallsFilePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'pitfalls.md');
}

/** .devflow/decisions/.disabled — sentinel that gates decisions sections */
function getDecisionsDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.disabled');
}

/** .devflow/decisions/decisions.json — project-level decisions config */
function getDecisionsConfigPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions.json');
}

/** .devflow/decisions/decisions-ledger.jsonl — committed anchored rows (single source of truth for rendering) */
function getDecisionsLedgerPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-ledger.jsonl');
}

/** .devflow/decisions/decisions-log.jsonl */
function getDecisionsLogPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-log.jsonl');
}

/** .devflow/decisions/decisions-log.archive.jsonl — rotated-out stale observing rows (gitignored) */
function getDecisionsArchivePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-log.archive.jsonl');
}

/** .devflow/decisions/.decisions-manifest.json */
function getDecisionsManifestPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-manifest.json');
}

/** .devflow/decisions/.decisions.lock — mkdir-based lock directory */
function getDecisionsLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions.lock');
}

/** .devflow/decisions/.decisions-usage.json */
function getDecisionsUsagePath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-usage.json');
}

/** .devflow/decisions/.decisions-usage.lock/ — mkdir-based lock directory for usage file */
function getDecisionsUsageLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-usage.lock');
}

/** .devflow/dream/.observations.lock — mkdir-based lock directory for observation log writes */
function getObservationsLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'dream', '.observations.lock');
}

/** .devflow/decisions/.decisions-notifications.json */
function getDecisionsNotificationsPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-notifications.json');
}

/** .devflow/decisions/.decisions-runs-today */
function getDecisionsRunsTodayPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-runs-today');
}

/** .devflow/decisions/.decisions-batch-ids */
function getDecisionsBatchIdsPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-batch-ids');
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
// Features / knowledge files
// ---------------------------------------------------------------------------

/** .devflow/features/{slug}/KNOWLEDGE.md */
function getKnowledgePath(projectRoot, slug) {
  return path.join(projectRoot, '.devflow', 'features', slug, 'KNOWLEDGE.md');
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

/** .devflow/docs/handoff-{branchSlug}.md — coder phase handoff artifact */
function getHandoffPath(projectRoot, branchSlug) {
  return path.join(projectRoot, '.devflow', 'docs', `handoff-${branchSlug}.md`);
}

// ---------------------------------------------------------------------------
// Gitignore entries
// ---------------------------------------------------------------------------

/**
 * The canonical list of generic gitignore entries Devflow adds to a project's
 * root .gitignore for LOCAL-scope installs. Currently just `.claude/`.
 *
 * `.devflow/` is intentionally NOT here: it is managed by ensureDevflowGitignore
 * (TS) / ensure-root-gitignore (hook), which write the feature-knowledge carve-out
 * for ALL scopes. Adding a bare `.devflow/` here would append a wholesale-ignore
 * line after the carve-out and re-bury it (last match wins in .gitignore).
 */
function getGitignoreEntries() {
  return ['.claude/'];
}

module.exports = {
  // Core directories
  getMemoryDir,
  getDreamDir,
  getDecisionsDir,
  getFeaturesDir,
  getDocsDir,
  // Dream files
  getDreamConfigPath,
  // Decisions files
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsDisabledSentinel,
  getDecisionsConfigPath,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsManifestPath,
  getDecisionsLockDir,
  getObservationsLockDir,
  getDecisionsUsagePath,
  getDecisionsUsageLockDir,
  getDecisionsNotificationsPath,
  getDecisionsRunsTodayPath,
  getDecisionsBatchIdsPath,
  // Memory files
  getWorkingMemoryPath,
  getBackupPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
  getPendingTurnsLockDir,
  // Features files
  getKnowledgePath,
  // Docs files
  getReviewsDir,
  getDesignDir,
  getResearchDir,
  getHandoffPath,
  // Gitignore entries
  getGitignoreEntries,
};
