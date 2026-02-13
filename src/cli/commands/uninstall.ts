import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths, getClaudeDirectory } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { isClaudeCliAvailable } from '../utils/cli.js';
import { DEVFLOW_PLUGINS, getAllSkillNames, LEGACY_SKILL_NAMES, type PluginDefinition } from '../plugins.js';

/**
 * Compute which assets should be removed during selective plugin uninstall.
 * Skills and agents shared by remaining plugins are retained.
 */
export function computeAssetsToRemove(
  selectedPlugins: PluginDefinition[],
  allPlugins: PluginDefinition[],
): { skills: string[]; agents: string[]; commands: string[] } {
  const selectedNames = new Set(selectedPlugins.map(p => p.name));
  const remainingPlugins = allPlugins.filter(p => !selectedNames.has(p.name));

  const retainedSkills = new Set<string>();
  const retainedAgents = new Set<string>();
  for (const rp of remainingPlugins) {
    for (const s of rp.skills) retainedSkills.add(s);
    for (const a of rp.agents) retainedAgents.add(a);
  }

  const skills: string[] = [];
  const agents: string[] = [];
  const commands: string[] = [];

  for (const plugin of selectedPlugins) {
    for (const skill of plugin.skills) {
      if (!retainedSkills.has(skill)) skills.push(skill);
    }
    for (const agent of plugin.agents) {
      if (!retainedAgents.has(agent)) agents.push(agent);
    }
    commands.push(...plugin.commands);
  }

  return { skills, agents, commands };
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
    p.intro(color.bgRed(color.white(' Uninstalling DevFlow ')));

    const verbose = options.verbose ?? false;

    // Parse plugin selection
    let selectedPluginNames: string[] = [];
    if (options.plugin) {
      selectedPluginNames = options.plugin.split(',').map((s: string) => {
        const trimmed = s.trim();
        return trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
      });

      const validNames = DEVFLOW_PLUGINS.map(p => p.name);
      const invalidPlugins = selectedPluginNames.filter(n => !validNames.includes(n));
      if (invalidPlugins.length > 0) {
        p.log.error(`Unknown plugin(s): ${invalidPlugins.join(', ')}`);
        p.log.info(`Valid plugins: ${validNames.join(', ')}`);
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
        p.log.error('No DevFlow installation found');
        p.log.info('Checked user scope (~/.claude/) and local scope (git-root/.claude/)');
        process.exit(1);
      }

      if (scopesToUninstall.length > 1) {
        p.log.info(
          `Found DevFlow in multiple scopes:\n` +
          `  ${color.dim('User scope')}  ~/.claude/\n` +
          `  ${color.dim('Local scope')}  git-root/.claude/\n` +
          `Uninstalling from both...`
        );
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
          p.log.step('Uninstalling user scope (~/.claude/)');
        } else {
          p.log.step('Uninstalling local scope (git-root/.claude/)');
        }
      } catch (error) {
        p.log.warn(`Cannot uninstall ${scope} scope: ${error instanceof Error ? error.message : error}`);
        continue;
      }

      // Try to uninstall plugin via Claude CLI first (only for full uninstall)
      let usedCli = false;

      if (cliAvailable && !isSelectiveUninstall) {
        if (verbose) {
          p.log.info('Uninstalling plugin via Claude CLI...');
        }
        usedCli = uninstallPluginViaCli(scope);
        if (!usedCli && verbose) {
          p.log.warn('Claude CLI uninstall failed, falling back to manual removal');
        }
      }

      // If CLI uninstall failed or unavailable, do manual removal
      if (!usedCli) {
        if (isSelectiveUninstall) {
          await removeSelectedPlugins(claudeDir, selectedPlugins, verbose);
        } else {
          await removeAllDevFlow(claudeDir, devflowScriptsDir, verbose);
        }
      }

      const pluginLabel = isSelectiveUninstall
        ? ` (${selectedPluginNames.join(', ')})`
        : '';
      p.log.success(`Plugin removed${usedCli ? ' (via Claude CLI)' : ''}${pluginLabel}`);
    }

    // === CLEANUP EXTRAS (only for full uninstall) ===
    if (!isSelectiveUninstall) {
      if (!options.keepDocs) {
        const docsDir = path.join(process.cwd(), '.docs');
        try {
          await fs.access(docsDir);
          p.log.warn('Found .docs/ directory in current project');
          p.log.info(
            'Contains session documentation and history.\n' +
            'Use --keep-docs to preserve it, or manually remove it.'
          );
        } catch {
          // .docs doesn't exist
        }
      }

      const claudeignorePath = path.join(process.cwd(), '.claudeignore');
      try {
        await fs.access(claudeignorePath);
        p.log.info(
          'Found .claudeignore file — keeping it (may contain custom rules).\n' +
          'Remove manually if it was only for DevFlow.'
        );
      } catch {
        // .claudeignore doesn't exist
      }

      if (verbose) {
        p.log.info(
          'settings.json preserved (may contain other configurations).\n' +
          'Remove statusLine manually if desired.'
        );
      }
    }

    if (hasErrors) {
      p.log.warn('Uninstall completed with warnings — some components may not have been removed.');
    }

    const status = hasErrors
      ? color.yellow('DevFlow uninstalled with warnings')
      : color.green('DevFlow uninstalled successfully');

    p.outro(`${status}${color.dim('  Reinstall: npx devflow-kit init')}`);
  });

/**
 * Remove all DevFlow assets (full uninstall).
 */
async function removeAllDevFlow(
  claudeDir: string,
  devflowScriptsDir: string,
  verbose: boolean,
): Promise<void> {
  const devflowDirectories = [
    { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
    { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
    { path: devflowScriptsDir, name: 'scripts' }
  ];

  for (const dir of devflowDirectories) {
    try {
      await fs.rm(dir.path, { recursive: true, force: true });
      if (verbose) {
        p.log.success(`Removed DevFlow ${dir.name}`);
      }
    } catch (error) {
      p.log.warn(`Could not remove ${dir.name}: ${error}`);
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
    p.log.success(`Removed ${skillsRemoved} DevFlow skills`);
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
 * For commands and agents: remove files belonging to selected plugins.
 * For skills: only remove skills that are NOT used by any remaining plugin.
 */
async function removeSelectedPlugins(
  claudeDir: string,
  plugins: typeof DEVFLOW_PLUGINS,
  verbose: boolean,
): Promise<void> {
  const { skills, agents, commands } = computeAssetsToRemove(plugins, DEVFLOW_PLUGINS);

  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  for (const cmd of commands) {
    const cmdFileName = cmd.replace(/^\//, '') + '.md';
    try {
      await fs.rm(path.join(commandsDir, cmdFileName), { force: true });
      if (verbose) {
        p.log.success(`Removed command ${cmd}`);
      }
    } catch {
      // Command file might not exist
    }
  }

  const agentsDir = path.join(claudeDir, 'agents', 'devflow');
  for (const agent of agents) {
    try {
      await fs.rm(path.join(agentsDir, `${agent}.md`), { force: true });
      if (verbose) {
        p.log.success(`Removed agent ${agent}`);
      }
    } catch {
      // Agent file might not exist
    }
  }

  const skillsDir = path.join(claudeDir, 'skills');
  for (const skill of skills) {
    try {
      await fs.rm(path.join(skillsDir, skill), { recursive: true, force: true });
      if (verbose) {
        p.log.success(`Removed skill ${skill}`);
      }
    } catch {
      // Skill might not exist
    }
  }
}
