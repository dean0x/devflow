import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getInstallationPaths, getClaudeDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { DEVFLOW_PLUGINS, getAllSkillNames, LEGACY_SKILL_NAMES } from '../plugins.js';

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
  .option('--plugin <names>', 'Uninstall specific plugin(s), comma-separated (e.g., implement,review)')
  .option('--verbose', 'Show detailed uninstall output')
  .action(async (options) => {
    console.log('🧹 Uninstalling DevFlow...\n');

    const verbose = options.verbose ?? false;

    // Parse plugin selection
    let selectedPluginNames: string[] = [];
    if (options.plugin) {
      selectedPluginNames = options.plugin.split(',').map((p: string) => {
        const trimmed = p.trim();
        return trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
      });

      const validNames = DEVFLOW_PLUGINS.map(p => p.name);
      const invalidPlugins = selectedPluginNames.filter(p => !validNames.includes(p));
      if (invalidPlugins.length > 0) {
        console.log(`❌ Unknown plugin(s): ${invalidPlugins.join(', ')}`);
        console.log(`   Valid plugins: ${validNames.join(', ')}`);
        process.exit(1);
      }
    }

    const isSelectiveUninstall = selectedPluginNames.length > 0;
    const selectedPlugins = isSelectiveUninstall
      ? DEVFLOW_PLUGINS.filter(p => selectedPluginNames.includes(p.name))
      : [];

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

      // Try to uninstall plugin via Claude CLI first (only for full uninstall)
      let usedCli = false;

      if (cliAvailable && !isSelectiveUninstall) {
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
        if (isSelectiveUninstall) {
          // Selective uninstall: only remove specific plugin assets
          await removeSelectedPlugins(claudeDir, selectedPlugins, verbose);
        } else {
          // Full uninstall: remove everything
          await removeAllDevFlow(claudeDir, devflowScriptsDir, verbose);
        }
      }

      const pluginLabel = isSelectiveUninstall
        ? ` (${selectedPluginNames.join(', ')})`
        : '';
      console.log(`  ✅ Plugin removed${usedCli ? ' (via Claude CLI)' : ''}${pluginLabel}\n`);
    }

    // === CLEANUP EXTRAS (only for full uninstall) ===
    if (!isSelectiveUninstall) {
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

      // Note about settings.json
      if (verbose) {
        console.log('ℹ️  settings.json preserved (may contain other configurations)');
        console.log('   Remove statusLine manually if desired.\n');
      }
    }

    if (hasErrors) {
      console.log('⚠️ Uninstall completed with warnings');
      console.log('   Some components may not have been removed.');
    } else {
      console.log('✅ DevFlow uninstalled successfully');
    }

    console.log('\n💡 To reinstall: npx devflow-kit init');
  });

/**
 * Remove all DevFlow assets (full uninstall).
 */
async function removeAllDevFlow(
  claudeDir: string,
  devflowScriptsDir: string,
  verbose: boolean,
): Promise<void> {
  // DevFlow directories to remove
  const devflowDirectories = [
    { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
    { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
    { path: devflowScriptsDir, name: 'scripts' }
  ];

  for (const dir of devflowDirectories) {
    try {
      await fs.rm(dir.path, { recursive: true, force: true });
      if (verbose) {
        console.log(`  ✅ Removed DevFlow ${dir.name}`);
      }
    } catch (error) {
      console.error(`  ⚠️ Could not remove ${dir.name}:`, error);
    }
  }

  // Remove all DevFlow skills (current + legacy)
  const allSkillNames = [...getAllSkillNames(), ...LEGACY_SKILL_NAMES];
  const skillsDir = path.join(claudeDir, 'skills');

  let skillsRemoved = 0;
  for (const skillName of allSkillNames) {
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

/**
 * Remove only specific plugin assets (selective uninstall).
 *
 * For commands and agents: remove files belonging to selected plugins.
 * For skills: only remove skills that are NOT used by any remaining plugin.
 */
async function removeSelectedPlugins(
  claudeDir: string,
  plugins: typeof DEVFLOW_PLUGINS,
  verbose: boolean,
): Promise<void> {
  const selectedNames = new Set(plugins.map(p => p.name));

  // Collect skills/agents used by plugins that will remain
  const remainingPlugins = DEVFLOW_PLUGINS.filter(p => !selectedNames.has(p.name));
  const retainedSkills = new Set<string>();
  const retainedAgents = new Set<string>();
  for (const rp of remainingPlugins) {
    for (const s of rp.skills) retainedSkills.add(s);
    for (const a of rp.agents) retainedAgents.add(a);
  }

  // Remove commands for selected plugins
  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  for (const plugin of plugins) {
    for (const cmd of plugin.commands) {
      // Command files are named like "review.md" from "/review"
      const cmdFileName = cmd.replace(/^\//, '') + '.md';
      try {
        await fs.rm(path.join(commandsDir, cmdFileName), { force: true });
        if (verbose) {
          console.log(`  ✅ Removed command ${cmd}`);
        }
      } catch {
        // Command file might not exist
      }
    }
  }

  // Remove agents only used by selected plugins (not retained by remaining plugins)
  const agentsDir = path.join(claudeDir, 'agents', 'devflow');
  for (const plugin of plugins) {
    for (const agent of plugin.agents) {
      if (!retainedAgents.has(agent)) {
        try {
          await fs.rm(path.join(agentsDir, `${agent}.md`), { force: true });
          if (verbose) {
            console.log(`  ✅ Removed agent ${agent}`);
          }
        } catch {
          // Agent file might not exist
        }
      } else if (verbose) {
        console.log(`  ⏭️  Kept agent ${agent} (used by other plugins)`);
      }
    }
  }

  // Remove skills only used by selected plugins (not retained by remaining plugins)
  const skillsDir = path.join(claudeDir, 'skills');
  for (const plugin of plugins) {
    for (const skill of plugin.skills) {
      if (!retainedSkills.has(skill)) {
        try {
          await fs.rm(path.join(skillsDir, skill), { recursive: true, force: true });
          if (verbose) {
            console.log(`  ✅ Removed skill ${skill}`);
          }
        } catch {
          // Skill might not exist
        }
      } else if (verbose) {
        console.log(`  ⏭️  Kept skill ${skill} (used by other plugins)`);
      }
    }
  }
}
