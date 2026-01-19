import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getInstallationPaths, getClaudeDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';

/**
 * Check if Claude CLI is available
 */
function isClaudeCliAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Uninstall plugin using Claude CLI
 */
function uninstallPluginViaCli(scope: 'user' | 'local'): boolean {
  try {
    const cliScope = scope === 'local' ? 'project' : 'user';
    execSync(`claude plugin uninstall devflow --scope ${cliScope}`, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
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
  .option('--verbose', 'Show detailed uninstall output')
  .action(async (options) => {
    console.log('🧹 Uninstalling DevFlow...\n');

    const verbose = options.verbose ?? false;

    // Determine which scopes to uninstall
    let scopesToUninstall: ('user' | 'local')[] = [];

    if (options.scope) {
      scopesToUninstall = [options.scope.toLowerCase() as 'user' | 'local'];
    } else {
      // Auto-detect installed scopes
      const userClaudeDir = getClaudeDirectory();
      const gitRoot = await getGitRoot();

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

    const cliAvailable = isClaudeCliAvailable();
    let hasErrors = false;

    // Uninstall from each scope
    for (const scope of scopesToUninstall) {
      let claudeDir: string;
      let devflowScriptsDir: string;

      try {
        const paths = await getInstallationPaths(scope);
        claudeDir = paths.claudeDir;
        devflowScriptsDir = paths.devflowDir;

        if (scope === 'user') {
          console.log('📍 Uninstalling user scope (~/.claude/)');
        } else {
          console.log('📍 Uninstalling local scope (git-root/.claude/)');
        }
      } catch (error) {
        console.log(`⚠️  Cannot uninstall ${scope} scope: ${error instanceof Error ? error.message : error}\n`);
        continue;
      }

      // Try to uninstall plugin via Claude CLI first
      let usedCli = false;

      if (cliAvailable) {
        if (verbose) {
          console.log('  🔌 Uninstalling plugin via Claude CLI...');
        }
        usedCli = uninstallPluginViaCli(scope);
        if (!usedCli && verbose) {
          console.log('  ⚠️  Claude CLI uninstall failed, falling back to manual removal');
        }
      }

      // If CLI uninstall failed or unavailable, do manual removal
      if (!usedCli) {
        // DevFlow directories to remove
        const devflowDirectories = [
          { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
          { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
          { path: devflowScriptsDir, name: 'scripts' }
        ];

        // Remove all DevFlow directories
        for (const dir of devflowDirectories) {
          try {
            await fs.rm(dir.path, { recursive: true, force: true });
            if (verbose) {
              console.log(`  ✅ Removed DevFlow ${dir.name}`);
            }
          } catch (error) {
            console.error(`  ⚠️ Could not remove ${dir.name}:`, error);
            hasErrors = true;
          }
        }

        // Remove individual DevFlow skills
        const skillsDir = path.join(claudeDir, 'skills');
        const devflowSkills = [
          // Tier 1: Foundation Skills
          'devflow-core-patterns',
          'devflow-review-methodology',
          'devflow-docs-framework',
          'devflow-git-safety',
          'devflow-implementation-patterns',
          'devflow-codebase-navigation',
          // Tier 2: Specialized Skills
          'devflow-test-design',
          'devflow-code-smell',
          'devflow-research',
          'devflow-commit',
          'devflow-pull-request',
          'devflow-input-validation',
          'devflow-self-review',
          // Tier 3: Domain-Specific Skills
          'devflow-typescript',
          'devflow-react',
          // Review Pattern Skills (used by Reviewer agent)
          'devflow-architecture-patterns',
          'devflow-complexity-patterns',
          'devflow-consistency-patterns',
          'devflow-database-patterns',
          'devflow-dependencies-patterns',
          'devflow-documentation-patterns',
          'devflow-performance-patterns',
          'devflow-regression-patterns',
          'devflow-security-patterns',
          'devflow-tests-patterns',
          // Deprecated (for cleanup of old installs)
          'devflow-pattern-check',
          'devflow-error-handling',
          'devflow-debug'
        ];

        let skillsRemoved = 0;
        for (const skillName of devflowSkills) {
          try {
            const skillPath = path.join(skillsDir, skillName);
            await fs.rm(skillPath, { recursive: true, force: true });
            skillsRemoved++;
          } catch {
            // Skill might not exist
          }
        }

        if (skillsRemoved > 0 && verbose) {
          console.log(`  ✅ Removed ${skillsRemoved} DevFlow skills`);
        }

        // Also remove old nested skills structure if it exists
        try {
          await fs.rm(path.join(claudeDir, 'skills', 'devflow'), { recursive: true, force: true });
        } catch {
          // Old structure doesn't exist
        }
      }

      console.log(`  ✅ Plugin removed${usedCli ? ' (via Claude CLI)' : ''}\n`);
    }

    // === CLEANUP EXTRAS ===

    // Handle .docs directory
    if (!options.keepDocs) {
      const docsDir = path.join(process.cwd(), '.docs');
      try {
        await fs.access(docsDir);
        console.log('⚠️  Found .docs/ directory in current project');
        console.log('   This contains your session documentation and history.');
        console.log('   Use --keep-docs to preserve it, or manually remove it.\n');
      } catch {
        // .docs doesn't exist
      }
    }

    // Warn about .claudeignore
    const claudeignorePath = path.join(process.cwd(), '.claudeignore');
    try {
      await fs.access(claudeignorePath);
      console.log('ℹ️  Found .claudeignore file');
      console.log('   Keeping it as it may contain custom rules.');
      console.log('   Remove manually if it was only for DevFlow.\n');
    } catch {
      // .claudeignore doesn't exist
    }

    // Note about settings.json (we don't remove statusLine as it might have other settings)
    if (verbose) {
      console.log('ℹ️  settings.json preserved (may contain other configurations)');
      console.log('   Remove statusLine manually if desired.\n');
    }

    if (hasErrors) {
      console.log('⚠️ Uninstall completed with warnings');
      console.log('   Some components may not have been removed.');
    } else {
      console.log('✅ DevFlow uninstalled successfully');
    }

    console.log('\n💡 To reinstall: npx devflow-kit init');
  });
