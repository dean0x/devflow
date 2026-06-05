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

/** .devflow/decisions/decisions-log.jsonl */
function getDecisionsLogPath(projectRoot) {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-log.jsonl');
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
  return `# Per-developer session state (fully transient)
memory/

# Dream dispatch system (fully transient)
dream/

# Per-developer observation logs and transient state
learning/learning-log.jsonl
learning/learning-log.v1.jsonl.bak
learning/learning.json
learning/.learning-manifest.json
learning/.learning-notified-at
learning/.learning-notifications.json
learning/.learning-runs-today
learning/.learning-session-count
learning/.learning-batch-ids
learning/debug/

# Per-developer decisions observation log and transient state
decisions/decisions-log.jsonl
decisions/decisions.json
decisions/.decisions-manifest.json
decisions/.decisions.lock/
decisions/.decisions-usage.json
decisions/.decisions-usage.lock/
decisions/.decisions-notifications.json
decisions/.decisions-runs-today
decisions/.decisions-batch-ids
decisions/.disabled

# Ephemeral doc artifacts
docs/handoff-*.md
docs/reviews/*/.last-review-head

# Transient files in features
features/.knowledge.lock/
features/.knowledge-last-refresh
features/.knowledge-refresh.lock
features/.disabled
features/.gitignore-configured

# Install state (local-scope only)
manifest.json

# Init marker
.gitignore-configured
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
  getDecisionsLogPath,
  getDecisionsManifestPath,
  getDecisionsLockDir,
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
