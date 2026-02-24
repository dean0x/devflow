import { homedir, platform } from 'os';
import * as path from 'path';
import { getGitRoot } from './git.js';

/**
 * Get the OS-specific path for Claude Code managed settings.
 * Managed settings have highest precedence and cannot be overridden by users.
 * - macOS: /Library/Application Support/ClaudeCode/managed-settings.json
 * - Linux: /etc/claude-code/managed-settings.json
 *
 * @throws {Error} On unsupported platforms (Windows)
 */
export function getManagedSettingsPath(): string {
  const os = platform();
  if (os === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  if (os === 'linux') {
    return '/etc/claude-code/managed-settings.json';
  }
  throw new Error(`Managed settings not supported on platform: ${os}`);
}

/**
 * Get home directory with proper fallback and validation
 * Priority: process.env.HOME > os.homedir()
 *
 * @throws {Error} If unable to determine home directory
 */
export function getHomeDirectory(): string {
  const home = process.env.HOME || homedir();
  if (!home) {
    throw new Error('Unable to determine home directory. Set HOME environment variable.');
  }
  return home;
}

/**
 * Get Claude Code directory with environment variable override support
 * Priority: CLAUDE_CODE_DIR env var > ~/.claude
 *
 * @throws {Error} If CLAUDE_CODE_DIR is invalid (not absolute, outside home)
 */
export function getClaudeDirectory(): string {
  if (process.env.CLAUDE_CODE_DIR) {
    const customDir = process.env.CLAUDE_CODE_DIR;

    // Validate path is absolute
    if (!path.isAbsolute(customDir)) {
      throw new Error('CLAUDE_CODE_DIR must be an absolute path');
    }

    // Warn if outside home directory (security best practice)
    const home = getHomeDirectory();
    if (!customDir.startsWith(home)) {
      console.warn('⚠️  CLAUDE_CODE_DIR is outside home directory. Ensure this is intentional.');
    }

    return customDir;
  }
  return path.join(getHomeDirectory(), '.claude');
}

/**
 * Get DevFlow directory with environment variable override support
 * Priority: DEVFLOW_DIR env var > ~/.devflow
 *
 * @throws {Error} If DEVFLOW_DIR is invalid (not absolute, outside home)
 */
export function getDevFlowDirectory(): string {
  if (process.env.DEVFLOW_DIR) {
    const customDir = process.env.DEVFLOW_DIR;

    // Validate path is absolute
    if (!path.isAbsolute(customDir)) {
      throw new Error('DEVFLOW_DIR must be an absolute path');
    }

    // Warn if outside home directory (security best practice)
    const home = getHomeDirectory();
    if (!customDir.startsWith(home)) {
      console.warn('⚠️  DEVFLOW_DIR is outside home directory. Ensure this is intentional.');
    }

    return customDir;
  }
  return path.join(getHomeDirectory(), '.devflow');
}

/**
 * Get installation paths based on scope (async, non-blocking)
 * @param scope - 'user' or 'local'
 * @returns Object with claudeDir and devflowDir
 * @throws {Error} If local scope selected but not in a git repository
 */
export async function getInstallationPaths(scope: 'user' | 'local'): Promise<{ claudeDir: string; devflowDir: string; gitRoot: string | null }> {
  if (scope === 'user') {
    return {
      claudeDir: getClaudeDirectory(),
      devflowDir: getDevFlowDirectory(),
      gitRoot: null,
    };
  } else {
    // Local scope - install to git repository root
    const gitRoot = await getGitRoot();
    if (!gitRoot) {
      throw new Error('Local scope requires a git repository. Run "git init" first or use --scope user');
    }
    return {
      claudeDir: path.join(gitRoot, '.claude'),
      devflowDir: path.join(gitRoot, '.devflow'),
      gitRoot,
    };
  }
}
