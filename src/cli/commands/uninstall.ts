import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

/**
 * Get home directory with proper fallback and validation
 * Priority: process.env.HOME > os.homedir()
 */
function getHomeDirectory(): string {
  const home = process.env.HOME || homedir();
  if (!home) {
    throw new Error('Unable to determine home directory. Set HOME environment variable.');
  }
  return home;
}

/**
 * Get Claude Code directory with environment variable override support
 * Priority: CLAUDE_CODE_DIR env var > ~/.claude
 */
function getClaudeDirectory(): string {
  if (process.env.CLAUDE_CODE_DIR) {
    return process.env.CLAUDE_CODE_DIR;
  }
  return path.join(getHomeDirectory(), '.claude');
}

/**
 * Get DevFlow directory with environment variable override support
 * Priority: DEVFLOW_DIR env var > ~/.devflow
 */
function getDevFlowDirectory(): string {
  if (process.env.DEVFLOW_DIR) {
    return process.env.DEVFLOW_DIR;
  }
  return path.join(getHomeDirectory(), '.devflow');
}

/**
 * Get git repository root directory
 * Returns null if not in a git repository
 */
function getGitRoot(): string | null {
  try {
    const gitRootRaw = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (!gitRootRaw || gitRootRaw.includes('\n') || gitRootRaw.includes(';') || gitRootRaw.includes('&&')) {
      return null;
    }

    const gitRoot = path.resolve(gitRootRaw);
    if (!path.isAbsolute(gitRoot)) {
      return null;
    }

    return gitRoot;
  } catch {
    return null;
  }
}

/**
 * Check if DevFlow is installed at the given paths
 */
async function isDevFlowInstalled(claudeDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(claudeDir, 'commands', 'devflow'));
    return true;
  } catch {
    return false;
  }
}

export const uninstallCommand = new Command('uninstall')
  .description('Uninstall DevFlow from Claude Code')
  .option('--keep-docs', 'Keep .docs/ directory and documentation')
  .option('--scope <type>', 'Uninstall from specific scope only (default: auto-detect all)', /^(user|local)$/i)
  .action(async (options) => {
    console.log('🧹 Uninstalling DevFlow...\n');

    // Determine which scopes to uninstall
    let scopesToUninstall: ('user' | 'local')[] = [];

    if (options.scope) {
      scopesToUninstall = [options.scope.toLowerCase() as 'user' | 'local'];
    } else {
      // Auto-detect installed scopes
      const userClaudeDir = getClaudeDirectory();
      const gitRoot = getGitRoot();

      if (await isDevFlowInstalled(userClaudeDir)) {
        scopesToUninstall.push('user');
      }

      if (gitRoot) {
        const localClaudeDir = path.join(gitRoot, '.claude');
        if (await isDevFlowInstalled(localClaudeDir)) {
          scopesToUninstall.push('local');
        }
      }

      if (scopesToUninstall.length === 0) {
        console.log('❌ No DevFlow installation found');
        console.log('   Checked user scope (~/.claude/) and local scope (git-root/.claude/)\n');
        process.exit(1);
      }

      if (scopesToUninstall.length > 1) {
        console.log('📦 Found DevFlow in multiple scopes:');
        console.log('   - User scope (~/.claude/)');
        console.log('   - Local scope (git-root/.claude/)');
        console.log('\n   Uninstalling from both...\n');
      }
    }

    let hasErrors = false;

    // Uninstall from each scope
    for (const scope of scopesToUninstall) {
      let claudeDir: string;
      let devflowScriptsDir: string;

      if (scope === 'user') {
        claudeDir = getClaudeDirectory();
        devflowScriptsDir = getDevFlowDirectory();
        console.log('📍 Uninstalling user scope (~/.claude/)');
      } else {
        const gitRoot = getGitRoot();
        if (!gitRoot) {
          console.log('⚠️  Cannot uninstall local scope: not in a git repository\n');
          continue;
        }
        claudeDir = path.join(gitRoot, '.claude');
        devflowScriptsDir = path.join(gitRoot, '.devflow');
        console.log('📍 Uninstalling local scope (git-root/.claude/)');
      }

      // DevFlow namespace directories to remove
      const devflowDirectories = [
        { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
        { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
        { path: path.join(claudeDir, 'skills', 'devflow'), name: 'skills' },
        { path: devflowScriptsDir, name: 'scripts' }
      ];

      // Remove all DevFlow directories
      for (const dir of devflowDirectories) {
        try {
          await fs.rm(dir.path, { recursive: true, force: true });
          console.log(`  ✅ Removed DevFlow ${dir.name}`);
        } catch (error) {
          console.error(`  ⚠️ Could not remove ${dir.name}:`, error);
          hasErrors = true;
        }
      }

      console.log();
    }

    // Handle .docs directory
    if (!options.keepDocs) {
      const docsDir = path.join(process.cwd(), '.docs');
      try {
        await fs.access(docsDir);
        console.log('\n⚠️  Found .docs/ directory in current project');
        console.log('   This contains your session documentation and history.');
        console.log('   Use --keep-docs to preserve it, or manually remove it.');
      } catch {
        // .docs doesn't exist, nothing to warn about
      }
    }

    // Remove .claudeignore (with warning)
    const claudeignorePath = path.join(process.cwd(), '.claudeignore');
    try {
      await fs.access(claudeignorePath);
      console.log('\nℹ️  Found .claudeignore file');
      console.log('   Keeping it as it may contain custom rules.');
      console.log('   Remove manually if it was only for DevFlow.');
    } catch {
      // .claudeignore doesn't exist
    }

    if (hasErrors) {
      console.log('\n⚠️ Uninstall completed with warnings');
      console.log('   Some components may not have been removed.');
    } else {
      console.log('\n✅ DevFlow uninstalled successfully');
    }

    console.log('\n💡 To reinstall: npm install -g devflow-kit && devflow init');
  });