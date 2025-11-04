import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getInstallationPaths, getClaudeDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';

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

    let hasErrors = false;

    // Uninstall from each scope
    for (const scope of scopesToUninstall) {
      // Get installation paths for this scope
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

      // DevFlow namespace directories to remove
      const devflowDirectories = [
        { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
        { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
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

      // Remove individual DevFlow skills (flat structure)
      const skillsDir = path.join(claudeDir, 'skills');
      const devflowSkills = [
        'pattern-check',
        'test-design',
        'code-smell',
        'research',
        'debug',
        'input-validation',
        'error-handling'
      ];

      let skillsRemoved = 0;
      for (const skillName of devflowSkills) {
        try {
          const skillPath = path.join(skillsDir, skillName);
          await fs.rm(skillPath, { recursive: true, force: true });
          skillsRemoved++;
        } catch (error) {
          // Skill might not exist, continue
        }
      }

      if (skillsRemoved > 0) {
        console.log(`  ✅ Removed ${skillsRemoved} DevFlow skills`);
      }

      // Also remove old nested skills structure if it exists (migration cleanup)
      try {
        await fs.rm(path.join(claudeDir, 'skills', 'devflow'), { recursive: true, force: true });
      } catch {
        // Old structure doesn't exist, ignore
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