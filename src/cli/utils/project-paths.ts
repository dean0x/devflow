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
