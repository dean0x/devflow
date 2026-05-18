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
 * PR 5b (the directory move) will flip the return values here; every consumer
 * will automatically pick up the new paths without further changes.
 *
 * CJS COUNTERPART: scripts/hooks/lib/project-paths.cjs must mirror this file
 * exactly. Keep them in sync when adding or changing functions.
 */

import * as path from 'path';

// ---------------------------------------------------------------------------
// Core directories
// ---------------------------------------------------------------------------

/** .memory/ — working memory root */
export function getMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, '.memory');
}

/** .memory/.sidecar/ — sidecar state directory */
export function getSidecarDir(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.sidecar');
}

/** .memory/decisions/ — decisions and pitfalls subdirectory */
export function getDecisionsDir(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'decisions');
}

/** .features/ — per-feature knowledge bases */
export function getFeaturesDir(projectRoot: string): string {
  return path.join(projectRoot, '.features');
}

/** .docs/ — generated documentation artifacts */
export function getDocsDir(projectRoot: string): string {
  return path.join(projectRoot, '.docs');
}

// ---------------------------------------------------------------------------
// Sidecar files
// ---------------------------------------------------------------------------

/** .memory/.sidecar/config.json — sidecar feature config */
export function getSidecarConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.sidecar', 'config.json');
}

// ---------------------------------------------------------------------------
// Decisions files
// ---------------------------------------------------------------------------

/** .memory/decisions/decisions.md */
export function getDecisionsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'decisions', 'decisions.md');
}

/** .memory/decisions/pitfalls.md */
export function getPitfallsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'decisions', 'pitfalls.md');
}

/** .memory/decisions/.disabled — sentinel that gates decisions sections */
export function getDecisionsDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'decisions', '.disabled');
}

/** .memory/decisions.json — project-level decisions config */
export function getDecisionsConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'decisions.json');
}

/** .memory/decisions-log.jsonl */
export function getDecisionsLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'decisions-log.jsonl');
}

/** .memory/.decisions-manifest.json */
export function getDecisionsManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions-manifest.json');
}

/** .memory/.decisions.lock — mkdir-based lock directory */
export function getDecisionsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions.lock');
}

/** .memory/.decisions-usage.json */
export function getDecisionsUsagePath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions-usage.json');
}

/** .memory/.decisions-usage.lock/ — mkdir-based lock directory for usage file */
export function getDecisionsUsageLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions-usage.lock');
}

/** .memory/.decisions-notifications.json */
export function getDecisionsNotificationsPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions-notifications.json');
}

/** .memory/.decisions-runs-today */
export function getDecisionsRunsTodayPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions-runs-today');
}

/** .memory/.decisions-batch-ids */
export function getDecisionsBatchIdsPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.decisions-batch-ids');
}

// ---------------------------------------------------------------------------
// Learning files
// ---------------------------------------------------------------------------

/** .memory/learning-log.jsonl */
export function getLearningLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'learning-log.jsonl');
}

/** .memory/learning.json — project-level learning config */
export function getLearningConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'learning.json');
}

/** .memory/.learning-manifest.json */
export function getLearningManifestPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-manifest.json');
}

/** .memory/.learning-notified-at */
export function getLearningNotifiedAtPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-notified-at');
}

/** .memory/.learning-notifications.json */
export function getLearningNotificationsPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-notifications.json');
}

/** .memory/.learning-runs-today */
export function getLearningRunsTodayPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-runs-today');
}

/** .memory/.learning-session-count */
export function getLearningSessionCountPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-session-count');
}

/** .memory/.learning-batch-ids */
export function getLearningBatchIdsPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-batch-ids');
}

/** .memory/.learning-disabled — sentinel that gates learning sections */
export function getLearningDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.learning-disabled');
}

// ---------------------------------------------------------------------------
// Memory / working-memory files
// ---------------------------------------------------------------------------

/** .memory/.working-memory-disabled — sentinel that gates all 4 memory hooks */
export function getWorkingMemoryDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.working-memory-disabled');
}

/** .memory/WORKING-MEMORY.md */
export function getWorkingMemoryPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'WORKING-MEMORY.md');
}

/** .memory/backup.json — pre-compact git state snapshot */
export function getBackupPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', 'backup.json');
}

/** .memory/.pending-turns.jsonl — queue of captured turns */
export function getPendingTurnsPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.pending-turns.jsonl');
}

/** .memory/.pending-turns.processing — atomic handoff during processing */
export function getPendingTurnsProcessingPath(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.pending-turns.processing');
}

/** .memory/.pending-turns.lock — mutex for queue operations */
export function getPendingTurnsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.memory', '.pending-turns.lock');
}

// ---------------------------------------------------------------------------
// Features / knowledge files
// ---------------------------------------------------------------------------

/** .features/index.json */
export function getFeaturesIndexPath(projectRoot: string): string {
  return path.join(projectRoot, '.features', 'index.json');
}

/** .features/{slug}/KNOWLEDGE.md */
export function getKnowledgePath(projectRoot: string, slug: string): string {
  return path.join(projectRoot, '.features', slug, 'KNOWLEDGE.md');
}

/** .features/.disabled — sentinel that gates knowledge phase/refresh */
export function getFeaturesDisabledSentinel(projectRoot: string): string {
  return path.join(projectRoot, '.features', '.disabled');
}

/** .features/.knowledge.lock — transient lock directory for concurrent index writes */
export function getFeaturesLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.features', '.knowledge.lock');
}

/** .features/.knowledge-last-refresh — timestamp of last auto-refresh */
export function getFeaturesLastRefreshPath(projectRoot: string): string {
  return path.join(projectRoot, '.features', '.knowledge-last-refresh');
}

// ---------------------------------------------------------------------------
// Docs files
// ---------------------------------------------------------------------------

/** .docs/reviews/ */
export function getReviewsDir(projectRoot: string): string {
  return path.join(projectRoot, '.docs', 'reviews');
}

/** .docs/design/ */
export function getDesignDir(projectRoot: string): string {
  return path.join(projectRoot, '.docs', 'design');
}

/** .docs/research/ */
export function getResearchDir(projectRoot: string): string {
  return path.join(projectRoot, '.docs', 'research');
}

/** .docs/handoff-{branchSlug}.md — coder phase handoff artifact */
export function getHandoffPath(projectRoot: string, branchSlug: string): string {
  return path.join(projectRoot, '.docs', `handoff-${branchSlug}.md`);
}

// ---------------------------------------------------------------------------
// Gitignore entries (returned as string arrays for updateGitignore callers)
// ---------------------------------------------------------------------------

/**
 * The canonical list of gitignore entries for a Devflow local-scope install.
 * Centralised here so PR 5b only changes this array, not every call-site.
 */
export function getGitignoreEntries(): string[] {
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
