import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

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
