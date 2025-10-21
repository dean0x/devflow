import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';

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

export const uninstallCommand = new Command('uninstall')
  .description('Uninstall DevFlow from Claude Code')
  .option('--keep-docs', 'Keep .docs/ directory and documentation')
  .action(async (options) => {
    console.log('🧹 Uninstalling DevFlow...\n');

    let claudeDir: string;
    let devflowScriptsDir: string;

    try {
      claudeDir = getClaudeDirectory();
      devflowScriptsDir = getDevFlowDirectory();
    } catch (error) {
      console.error('❌ Path configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }

    let hasErrors = false;

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