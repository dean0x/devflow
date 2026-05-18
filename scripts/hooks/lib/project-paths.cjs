// scripts/hooks/lib/project-paths.cjs
//
// Centralized path construction for all project-relative directories and files.
//
// DESIGN: Every function takes `projectRoot` (absolute path) and returns an
// absolute path string. All construction uses path.join() — no string concatenation.
//
// ARCHITECTURE: This module is the single source of truth for path layout in
// the CJS hook layer. Must match src/cli/utils/project-paths.ts exactly.
// PR 5b (the directory move) will flip the return values here; every hook
// consumer will automatically pick up the new paths without further changes.
//
// TS COUNTERPART: src/cli/utils/project-paths.ts must mirror this file exactly.
// Keep them in sync when adding or changing functions.

'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// Core directories
// ---------------------------------------------------------------------------

/** .memory/ — working memory root */
function getMemoryDir(projectRoot) {
  return path.join(projectRoot, '.memory');
}

/** .memory/.sidecar/ — sidecar state directory */
function getSidecarDir(projectRoot) {
  return path.join(projectRoot, '.memory', '.sidecar');
}

/** .memory/decisions/ — decisions and pitfalls subdirectory */
function getDecisionsDir(projectRoot) {
  return path.join(projectRoot, '.memory', 'decisions');
}

/** .features/ — per-feature knowledge bases */
function getFeaturesDir(projectRoot) {
  return path.join(projectRoot, '.features');
}

/** .docs/ — generated documentation artifacts */
function getDocsDir(projectRoot) {
  return path.join(projectRoot, '.docs');
}

// ---------------------------------------------------------------------------
// Sidecar files
// ---------------------------------------------------------------------------

/** .memory/.sidecar/config.json — sidecar feature config */
function getSidecarConfigPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.sidecar', 'config.json');
}

// ---------------------------------------------------------------------------
// Decisions files
// ---------------------------------------------------------------------------

/** .memory/decisions/decisions.md */
function getDecisionsFilePath(projectRoot) {
  return path.join(projectRoot, '.memory', 'decisions', 'decisions.md');
}

/** .memory/decisions/pitfalls.md */
function getPitfallsFilePath(projectRoot) {
  return path.join(projectRoot, '.memory', 'decisions', 'pitfalls.md');
}

/** .memory/decisions/.disabled — sentinel that gates decisions sections */
function getDecisionsDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.memory', 'decisions', '.disabled');
}

/** .memory/decisions.json — project-level decisions config */
function getDecisionsConfigPath(projectRoot) {
  return path.join(projectRoot, '.memory', 'decisions.json');
}

/** .memory/decisions-log.jsonl */
function getDecisionsLogPath(projectRoot) {
  return path.join(projectRoot, '.memory', 'decisions-log.jsonl');
}

/** .memory/.decisions-manifest.json */
function getDecisionsManifestPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions-manifest.json');
}

/** .memory/.decisions.lock — mkdir-based lock directory */
function getDecisionsLockDir(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions.lock');
}

/** .memory/.decisions-usage.json */
function getDecisionsUsagePath(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions-usage.json');
}

/** .memory/.decisions-usage.lock/ — mkdir-based lock directory for usage file */
function getDecisionsUsageLockDir(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions-usage.lock');
}

/** .memory/.decisions-notifications.json */
function getDecisionsNotificationsPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions-notifications.json');
}

/** .memory/.decisions-runs-today */
function getDecisionsRunsTodayPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions-runs-today');
}

/** .memory/.decisions-batch-ids */
function getDecisionsBatchIdsPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.decisions-batch-ids');
}

// ---------------------------------------------------------------------------
// Learning files
// ---------------------------------------------------------------------------

/** .memory/learning-log.jsonl */
function getLearningLogPath(projectRoot) {
  return path.join(projectRoot, '.memory', 'learning-log.jsonl');
}

/** .memory/learning.json — project-level learning config */
function getLearningConfigPath(projectRoot) {
  return path.join(projectRoot, '.memory', 'learning.json');
}

/** .memory/.learning-manifest.json */
function getLearningManifestPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-manifest.json');
}

/** .memory/.learning-notified-at */
function getLearningNotifiedAtPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-notified-at');
}

/** .memory/.learning-notifications.json */
function getLearningNotificationsPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-notifications.json');
}

/** .memory/.learning-runs-today */
function getLearningRunsTodayPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-runs-today');
}

/** .memory/.learning-session-count */
function getLearningSessionCountPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-session-count');
}

/** .memory/.learning-batch-ids */
function getLearningBatchIdsPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-batch-ids');
}

/** .memory/.learning-disabled — sentinel that gates learning sections */
function getLearningDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.memory', '.learning-disabled');
}

// ---------------------------------------------------------------------------
// Memory / working-memory files
// ---------------------------------------------------------------------------

/** .memory/.working-memory-disabled — sentinel that gates all 4 memory hooks */
function getWorkingMemoryDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.memory', '.working-memory-disabled');
}

/** .memory/WORKING-MEMORY.md */
function getWorkingMemoryPath(projectRoot) {
  return path.join(projectRoot, '.memory', 'WORKING-MEMORY.md');
}

/** .memory/backup.json — pre-compact git state snapshot */
function getBackupPath(projectRoot) {
  return path.join(projectRoot, '.memory', 'backup.json');
}

/** .memory/.pending-turns.jsonl — queue of captured turns */
function getPendingTurnsPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.pending-turns.jsonl');
}

/** .memory/.pending-turns.processing — atomic handoff during processing */
function getPendingTurnsProcessingPath(projectRoot) {
  return path.join(projectRoot, '.memory', '.pending-turns.processing');
}

/** .memory/.pending-turns.lock — mutex for queue operations */
function getPendingTurnsLockDir(projectRoot) {
  return path.join(projectRoot, '.memory', '.pending-turns.lock');
}

// ---------------------------------------------------------------------------
// Features / knowledge files
// ---------------------------------------------------------------------------

/** .features/index.json */
function getFeaturesIndexPath(projectRoot) {
  return path.join(projectRoot, '.features', 'index.json');
}

/** .features/{slug}/KNOWLEDGE.md */
function getKnowledgePath(projectRoot, slug) {
  return path.join(projectRoot, '.features', slug, 'KNOWLEDGE.md');
}

/** .features/.disabled — sentinel that gates knowledge phase/refresh */
function getFeaturesDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.features', '.disabled');
}

/** .features/.knowledge.lock — transient lock directory for concurrent index writes */
function getFeaturesLockDir(projectRoot) {
  return path.join(projectRoot, '.features', '.knowledge.lock');
}

/** .features/.knowledge-last-refresh — timestamp of last auto-refresh */
function getFeaturesLastRefreshPath(projectRoot) {
  return path.join(projectRoot, '.features', '.knowledge-last-refresh');
}

// ---------------------------------------------------------------------------
// Docs files
// ---------------------------------------------------------------------------

/** .docs/reviews/ */
function getReviewsDir(projectRoot) {
  return path.join(projectRoot, '.docs', 'reviews');
}

/** .docs/design/ */
function getDesignDir(projectRoot) {
  return path.join(projectRoot, '.docs', 'design');
}

/** .docs/research/ */
function getResearchDir(projectRoot) {
  return path.join(projectRoot, '.docs', 'research');
}

/** .docs/handoff-{branchSlug}.md — coder phase handoff artifact */
function getHandoffPath(projectRoot, branchSlug) {
  return path.join(projectRoot, '.docs', 'handoff-' + branchSlug + '.md');
}

// ---------------------------------------------------------------------------
// Gitignore entries
// ---------------------------------------------------------------------------

/**
 * The canonical list of gitignore entries for a Devflow local-scope install.
 * Centralised here so PR 5b only changes this array, not every call-site.
 */
function getGitignoreEntries() {
  return [
    '.claude/',
    '.devflow/',
    '.memory/',
    '.docs/',
    '.features/.knowledge.lock',
    '.features/.disabled',
    '.features/.knowledge-last-refresh',
    '.features/.knowledge-refresh.lock',
  ];
}

module.exports = {
  // Core directories
  getMemoryDir,
  getSidecarDir,
  getDecisionsDir,
  getFeaturesDir,
  getDocsDir,
  // Sidecar files
  getSidecarConfigPath,
  // Decisions files
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsDisabledSentinel,
  getDecisionsConfigPath,
  getDecisionsLogPath,
  getDecisionsManifestPath,
  getDecisionsLockDir,
  getDecisionsUsagePath,
  getDecisionsUsageLockDir,
  getDecisionsNotificationsPath,
  getDecisionsRunsTodayPath,
  getDecisionsBatchIdsPath,
  // Learning files
  getLearningLogPath,
  getLearningConfigPath,
  getLearningManifestPath,
  getLearningNotifiedAtPath,
  getLearningNotificationsPath,
  getLearningRunsTodayPath,
  getLearningSessionCountPath,
  getLearningBatchIdsPath,
  getLearningDisabledSentinel,
  // Memory files
  getWorkingMemoryDisabledSentinel,
  getWorkingMemoryPath,
  getBackupPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
  getPendingTurnsLockDir,
  // Features files
  getFeaturesIndexPath,
  getKnowledgePath,
  getFeaturesDisabledSentinel,
  getFeaturesLockDir,
  getFeaturesLastRefreshPath,
  // Docs files
  getReviewsDir,
  getDesignDir,
  getResearchDir,
  getHandoffPath,
  // Gitignore entries
  getGitignoreEntries,
};
