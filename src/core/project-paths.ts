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
 *
 * CJS COUNTERPART: src/assets/scripts/hooks/lib/project-paths.cjs must mirror this file
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

/** .devflow/learning/ — learning state root */
export function getLearningDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning');
}

/** .devflow/features/ — per-feature knowledge bases */
export function getFeaturesDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'features');
}

/** .devflow/docs/ — generated documentation artifacts */
export function getDocsDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'docs');
}

// ---------------------------------------------------------------------------
// Feature config (neutral .devflow root — not inside learning/)
// ---------------------------------------------------------------------------

/** .devflow/config.json — feature toggles {memory, learning, knowledge} */
export function getFeatureConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'config.json');
}

// ---------------------------------------------------------------------------
// Learning queue files
// ---------------------------------------------------------------------------

/** .devflow/learning/.pending-turns.jsonl — decisions detection queue */
export function getLearningPendingTurnsPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.jsonl');
}

/** .devflow/learning/.pending-turns.processing — atomic claim held by the Learning agent while processing */
export function getLearningPendingTurnsProcessingPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.pending-turns.processing');
}

// ---------------------------------------------------------------------------
// Learning content files
// ---------------------------------------------------------------------------

/** .devflow/learning/decisions.md */
export function getDecisionsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions.md');
}

/** .devflow/learning/pitfalls.md */
export function getPitfallsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'pitfalls.md');
}

/** .devflow/learning/learning.json — project-level learning agent tuning config */
export function getLearningTuningConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'learning.json');
}

/** .devflow/learning/decisions-ledger.jsonl — anchored ledger rows (single source of truth for rendering) */
export function getDecisionsLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-ledger.jsonl');
}

/** .devflow/learning/decisions-log.jsonl */
export function getDecisionsLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-log.jsonl');
}

/** .devflow/learning/decisions-log.archive.jsonl — rotated-out stale observing rows (gitignored) */
export function getDecisionsArchivePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'decisions-log.archive.jsonl');
}

/** .devflow/learning/.decisions.lock — mkdir-based lock directory */
export function getDecisionsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.decisions.lock');
}

/** .devflow/learning/.decisions-usage.json */
export function getDecisionsUsagePath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.decisions-usage.json');
}

/** .devflow/learning/.decisions-usage.lock/ — mkdir-based lock directory for usage file */
export function getDecisionsUsageLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.decisions-usage.lock');
}

/** .devflow/learning/index.md — pre-rendered compact index written by render-decisions.cjs */
export function getDecisionsIndexPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', 'index.md');
}

/** .devflow/learning/.observations.lock — mkdir-based lock directory for observation log writes */
export function getObservationsLockDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'learning', '.observations.lock');
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
 * CJS mirror: src/assets/scripts/hooks/lib/project-paths.cjs getGitignoreEntries().
 */
export function getGitignoreEntries(): string[] {
  return ['.claude/'];
}
