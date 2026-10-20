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
 * The repository root named by the output of `git rev-parse --show-toplevel`, or null
 * when the output is not one clean absolute path.
 *
 * Security: validates output to prevent command injection
 * - Rejects paths with injection characters (newlines, semicolons, shell operators)
 * - Ensures path is absolute
 * - Resolves path canonically
 */
export function parseGitToplevel(stdout: string): string | null {
  const gitRootRaw = stdout.trim();

  if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
    return null;
  }

  const gitRoot = path.resolve(gitRootRaw);
  return path.isAbsolute(gitRoot) ? gitRoot : null;
}

/**
 * Get git repository root directory (async, non-blocking)
 * Returns null if not in a git repository
 *
 * @param cwd - Directory to resolve the git root from. Defaults to process.cwd().
 *   Callers that already carry an explicit working directory must pass it, otherwise
 *   they resolve half their paths from the injected dir and half from the process dir.
 */
export async function getGitRoot(cwd: string = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8'
    });
    return parseGitToplevel(stdout);
  } catch {
    return null;
  }
}
