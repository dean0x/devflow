import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * Canonical trunk branch names used by the HUD to determine whether a branch
 * should compare against origin/<branch> rather than the repo's default branch.
 *
 * Keep in exact sync with the Protected Branches (Canonical List) section in
 * src/assets/skills/worktree-support/SKILL.md. Both lists must be updated together.
 */
export const TRUNK_BRANCHES = [
  'main', 'master', 'develop', 'integration', 'trunk', 'staging', 'production',
] as const;

export const TRUNK_BRANCH_PREFIXES = ['release/'] as const;

/**
 * Returns true when `branch` is a canonical trunk branch — i.e., one of the
 * TRUNK_BRANCHES literals or a branch whose name starts with a TRUNK_BRANCH_PREFIXES
 * prefix (e.g. `release/1.2`).
 */
export function isTrunkBranch(branch: string): boolean {
  if ((TRUNK_BRANCHES as readonly string[]).includes(branch)) return true;
  return (TRUNK_BRANCH_PREFIXES as readonly string[]).some(p => branch.startsWith(p));
}

/**
 * Get git repository root directory (async, non-blocking)
 * Returns null if not in a git repository
 *
 * Security: Validates output to prevent command injection
 * - Rejects paths with injection characters (newlines, semicolons, shell operators)
 * - Ensures path is absolute
 * - Resolves path canonically
 */
export async function getGitRoot(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8'
    });

    const gitRootRaw = stdout.trim();

    // Validate git root path (security: prevent injection)
    if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
      return null;
    }

    // Validate it's an absolute path
    const gitRoot = path.resolve(gitRootRaw);
    if (!path.isAbsolute(gitRoot)) {
      return null;
    }

    return gitRoot;
  } catch {
    return null;
  }
}
