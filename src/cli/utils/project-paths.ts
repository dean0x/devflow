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
 * PR 5b flipped these return values from the old .memory/.features/.docs layout
 * to the new consolidated .devflow/ layout. Every consumer automatically picks
 * up the new paths without further changes.
 *
 * CJS COUNTERPART: scripts/hooks/lib/project-paths.cjs must mirror this file
 * exactly. Keep them in sync when adding or changing functions.
 */

import * as path from 'path';

// ---------------------------------------------------------------------------
// Core directories
// ---------------------------------------------------------------------------

/** .devflow/memory/ — working memory root */
export function getMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory');
}

/** .devflow/sidecar/ — sidecar state directory (promoted from .memory/.sidecar/) */
export function getSidecarDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'sidecar');
}

/** .devflow/decisions/ — decisions and pitfalls subdirectory (promoted from .memory/decisions/) */
export function getDecisionsDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions');
}

/** .devflow/features/ — per-feature knowledge bases (promoted from .features/) */
export function getFeaturesDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features');
}

/** .devflow/docs/ — generated documentation artifacts (promoted from .docs/) */
export function getDocsDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'docs');
}

// ---------------------------------------------------------------------------
// Sidecar files
// ---------------------------------------------------------------------------

/** .devflow/sidecar/config.json — sidecar feature config */
export function getSidecarConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'sidecar', 'config.json');
}

// ---------------------------------------------------------------------------
// Decisions files
// ---------------------------------------------------------------------------

/** .devflow/decisions/decisions.md */
export function getDecisionsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions.md');
}

/** .devflow/decisions/pitfalls.md */
export function getPitfallsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'pitfalls.md');
}

/** .devflow/decisions/.disabled — sentinel that gates decisions sections */
export function getDecisionsDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.disabled');
}

/** .devflow/decisions/decisions.json — project-level decisions config */
export function getDecisionsConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions.json');
}

/** .devflow/decisions/decisions-log.jsonl */
export function getDecisionsLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-log.jsonl');
}

/** .devflow/decisions/.decisions-manifest.json */
export function getDecisionsManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-manifest.json');
}

/** .devflow/decisions/.decisions.lock — mkdir-based lock directory */
export function getDecisionsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions.lock');
}

/** .devflow/decisions/.decisions-usage.json */
export function getDecisionsUsagePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-usage.json');
}

/** .devflow/decisions/.decisions-usage.lock/ — mkdir-based lock directory for usage file */
export function getDecisionsUsageLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-usage.lock');
}

/** .devflow/decisions/.decisions-notifications.json */
export function getDecisionsNotificationsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-notifications.json');
}

/** .devflow/decisions/.decisions-runs-today */
export function getDecisionsRunsTodayPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-runs-today');
}

/** .devflow/decisions/.decisions-batch-ids */
export function getDecisionsBatchIdsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', '.decisions-batch-ids');
}

// ---------------------------------------------------------------------------
// Learning files
// ---------------------------------------------------------------------------

/** .devflow/learning/learning-log.jsonl */
export function getLearningLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'learning-log.jsonl');
}

/** .devflow/learning/learning.json — project-level learning config */
export function getLearningConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'learning.json');
}

/** .devflow/learning/.learning-manifest.json */
export function getLearningManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.learning-manifest.json');
}

/** .devflow/learning/.learning-notified-at */
export function getLearningNotifiedAtPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.learning-notified-at');
}

/** .devflow/learning/.learning-notifications.json */
export function getLearningNotificationsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.learning-notifications.json');
}

/** .devflow/learning/.learning-runs-today */
export function getLearningRunsTodayPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.learning-runs-today');
}

/** .devflow/learning/.learning-session-count */
export function getLearningSessionCountPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.learning-session-count');
}

/** .devflow/learning/.learning-batch-ids */
export function getLearningBatchIdsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.learning-batch-ids');
}

/** .devflow/memory/.learning-disabled — sentinel that gates learning sections */
export function getLearningDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', '.learning-disabled');
}

/** .devflow/memory/.learning.lock — mkdir-based lock directory for learning agent */
export function getLearningLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', '.learning.lock');
}

// ---------------------------------------------------------------------------
// Memory / working-memory files
// ---------------------------------------------------------------------------

/** .devflow/memory/.working-memory-disabled — sentinel that gates all 4 memory hooks */
export function getWorkingMemoryDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'memory', '.working-memory-disabled');
}

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
// Features / knowledge files
// ---------------------------------------------------------------------------

/** .devflow/features/index.json */
export function getFeaturesIndexPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features', 'index.json');
}

/** .devflow/features/{slug}/KNOWLEDGE.md */
export function getKnowledgePath(projectRoot: string, slug: string): string {
  return path.join(projectRoot, '.devflow', 'features', slug, 'KNOWLEDGE.md');
}

/** .devflow/features/.disabled — sentinel that gates knowledge phase/refresh */
export function getFeaturesDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features', '.disabled');
}

/** .devflow/features/.knowledge.lock — transient lock directory for concurrent index writes */
export function getFeaturesLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features', '.knowledge.lock');
}

/** .devflow/features/.knowledge-last-refresh — timestamp of last auto-refresh */
export function getFeaturesLastRefreshPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features', '.knowledge-last-refresh');
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

/** .devflow/docs/handoff-{branchSlug}.md — coder phase handoff artifact */
export function getHandoffPath(projectRoot: string, branchSlug: string): string {
  return path.join(projectRoot, '.devflow', 'docs', `handoff-${branchSlug}.md`);
}

// ---------------------------------------------------------------------------
// Gitignore entries (returned as string arrays for updateGitignore callers)
// ---------------------------------------------------------------------------

/**
 * The canonical list of gitignore entries for a Devflow local-scope install.
 * After PR 5b, .devflow/ is NOT gitignored because it holds committed content
 * (features/, decisions/decisions.md, decisions/pitfalls.md). Only .claude/
 * remains as an install-scope gitignore entry. Internal .devflow/ transients
 * are handled by .devflow/.gitignore.
 */
export function getGitignoreEntries(): string[] {
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
 * CJS is canonical source: scripts/hooks/lib/project-paths.cjs — this must mirror it exactly.
 */
export function getDevflowGitignoreContent(): string {
  return `# Per-developer session state (fully transient)
memory/

# Sidecar dispatch system (fully transient)
sidecar/

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
