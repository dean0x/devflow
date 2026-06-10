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

/** .devflow/memory/.working-memory-disabled — sentinel that gates all 4 memory hooks */
function getWorkingMemoryDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.devflow', 'memory', '.working-memory-disabled');
}

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

/** .devflow/features/index.json */
function getFeaturesIndexPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'features', 'index.json');
}

/** .devflow/features/{slug}/KNOWLEDGE.md */
function getKnowledgePath(projectRoot, slug) {
  return path.join(projectRoot, '.devflow', 'features', slug, 'KNOWLEDGE.md');
}

/** .devflow/features/.disabled — sentinel that gates knowledge phase/refresh */
function getFeaturesDisabledSentinel(projectRoot) {
  return path.join(projectRoot, '.devflow', 'features', '.disabled');
}

/** .devflow/features/.knowledge.lock — transient lock directory for concurrent index writes */
function getFeaturesLockDir(projectRoot) {
  return path.join(projectRoot, '.devflow', 'features', '.knowledge.lock');
}

/** .devflow/features/.knowledge-last-refresh — timestamp of last auto-refresh */
function getFeaturesLastRefreshPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'features', '.knowledge-last-refresh');
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
 * The canonical list of gitignore entries for a Devflow local-scope install.
 * After PR 5b, .devflow/ is NOT gitignored — it holds committed content.
 * Internal .devflow/ transients are handled by .devflow/.gitignore.
 */
function getGitignoreEntries() {
  return ['.claude/'];
}

/**
 * The canonical content of .devflow/.gitignore — lists all transient per-developer
 * files that must NOT be committed.
 *
 * Single source of truth: migrations.ts imports this function instead of
 * maintaining an inline copy. The shell hook (ensure-devflow-init) keeps its
 * heredoc in sync manually — a comment in that file points here as canonical.
 *
 * CANONICAL SOURCE — TS counterpart at src/cli/utils/project-paths.ts must mirror this exactly.
 */
function getDevflowGitignoreContent() {
  return `# .devflow/ git-tracking policy
# ---------------------------------------------------------------------------
# Only curated, shared team knowledge is committed to git:
#   - decisions/decisions.md, decisions/pitfalls.md      (ADR / pitfall records)
#   - features/index.json, features/<slug>/KNOWLEDGE.md  (feature knowledge bases)
#
# Everything else under .devflow/ is per-developer or transient (memory, dream,
# docs, locks, runtime state, manifest, scratch results) and is
# intentionally ignored. Model: ignore-by-default, then re-include the curated
# files. Any NEW file under .devflow/ is ignored unless explicitly listed below.

# 1. Ignore everything under .devflow/ by default
*

# 2. Keep this policy file
!.gitignore

# 3. Track the decisions knowledge (not its log / config / locks / usage state)
!decisions/
!decisions/decisions.md
!decisions/pitfalls.md
!decisions/decisions-ledger.jsonl

# 4. Track the feature knowledge bases (not locks / sentinels / scratch results)
!features/
!features/index.json
!features/*/
!features/*/KNOWLEDGE.md
`;
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
  getDevflowGitignoreContent,
};
