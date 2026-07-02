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

/** .devflow/dream/ — dream state directory */
export function getDreamDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'dream');
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
// Dream files
// ---------------------------------------------------------------------------

/** .devflow/dream/config.json — dream feature config */
export function getDreamConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'dream', 'config.json');
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

/** .devflow/decisions/decisions-ledger.jsonl — committed anchored rows (single source of truth for rendering) */
export function getDecisionsLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-ledger.jsonl');
}

/** .devflow/decisions/decisions-log.jsonl */
export function getDecisionsLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-log.jsonl');
}

/** .devflow/decisions/decisions-log.archive.jsonl — rotated-out stale observing rows (gitignored) */
export function getDecisionsArchivePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'decisions', 'decisions-log.archive.jsonl');
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

/** .devflow/dream/.observations.lock — mkdir-based lock directory for observation log writes */
export function getObservationsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'dream', '.observations.lock');
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

/** .devflow/docs/handoff-{branchSlug}.md — coder phase handoff artifact */
export function getHandoffPath(projectRoot: string, branchSlug: string): string {
  return path.join(projectRoot, '.devflow', 'docs', `handoff-${branchSlug}.md`);
}

// ---------------------------------------------------------------------------
// Gitignore entries (returned as string arrays for updateGitignore callers)
// ---------------------------------------------------------------------------

/**
 * The canonical list of generic gitignore entries Devflow adds to a project's
 * root .gitignore for LOCAL-scope installs. Currently just `.claude/`.
 *
 * `.devflow/` is intentionally NOT here: it is managed by ensureDevflowGitignore
 * (TS) / ensure-root-gitignore (hook), which write the feature-knowledge carve-out
 * for ALL scopes. Adding a bare `.devflow/` here would append a wholesale-ignore
 * line after the carve-out and re-bury it (last match wins in .gitignore).
 *
 * CJS mirror: scripts/hooks/lib/project-paths.cjs getGitignoreEntries().
 */
export function getGitignoreEntries(): string[] {
  return ['.claude/'];
}
