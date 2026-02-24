import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths, getClaudeDirectory, getManagedSettingsPath } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { isClaudeCliAvailable } from '../utils/cli.js';
import { DEVFLOW_PLUGINS, getAllSkillNames, LEGACY_SKILL_NAMES, type PluginDefinition } from '../plugins.js';
import { detectShell, getProfilePath } from '../utils/safe-delete.js';
import { isAlreadyInstalled, removeFromProfile } from '../utils/safe-delete-install.js';
import { removeManagedSettings } from '../utils/post-install.js';

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
        if (process.stdin.isTTY) {
          const scopeChoice = await p.select({
            message: 'Found DevFlow in multiple scopes. Uninstall from:',
            options: [
              { value: 'both', label: 'Both', hint: 'user + local' },
              { value: 'user', label: 'User scope', hint: '~/.claude/' },
              { value: 'local', label: 'Local scope', hint: 'git-root/.claude/' },
            ],
          });

          if (p.isCancel(scopeChoice)) {
            p.cancel('Uninstall cancelled.');
            process.exit(0);
          }

          if (scopeChoice !== 'both') {
            scopesToUninstall = [scopeChoice as 'user' | 'local'];
          }
        } else {
          p.log.info('Multiple scopes detected, uninstalling from both...');
        }
      }
    }

    const cliAvailable = isClaudeCliAvailable();

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
      const gitRoot = await getGitRoot();

      // 1. .docs/ directory
      const docsDir = path.join(process.cwd(), '.docs');
      let docsExist = false;
      try {
        await fs.access(docsDir);
        docsExist = true;
      } catch { /* .docs doesn't exist */ }

      if (docsExist) {
        let shouldRemoveDocs = false;

        if (options.keepDocs) {
          shouldRemoveDocs = false;
        } else if (process.stdin.isTTY) {
          const removeDocs = await p.confirm({
            message: '.docs/ directory found. Remove project documentation?',
            initialValue: false,
          });

          if (p.isCancel(removeDocs)) {
            p.cancel('Uninstall cancelled.');
            process.exit(0);
          }

          shouldRemoveDocs = removeDocs;
        }

        if (shouldRemoveDocs) {
          await fs.rm(docsDir, { recursive: true, force: true });
          p.log.success('.docs/ removed');
        } else {
          p.log.info('.docs/ preserved');
        }
      }

      // 2. .claudeignore
      const claudeignorePath = gitRoot
        ? path.join(gitRoot, '.claudeignore')
        : path.join(process.cwd(), '.claudeignore');

      let claudeignoreExists = false;
      try {
        await fs.access(claudeignorePath);
        claudeignoreExists = true;
      } catch { /* doesn't exist */ }

      if (claudeignoreExists) {
        if (process.stdin.isTTY) {
          const removeClaudeignore = await p.confirm({
            message: '.claudeignore found. Remove it? (may contain custom rules)',
            initialValue: false,
          });

          if (!p.isCancel(removeClaudeignore) && removeClaudeignore) {
            await fs.rm(claudeignorePath, { force: true });
            p.log.success('.claudeignore removed');
          } else {
            p.log.info('.claudeignore preserved');
          }
        } else {
          p.log.info('.claudeignore preserved (non-interactive mode)');
        }
      }

      // 3. settings.json (DevFlow hooks)
      for (const scope of scopesToUninstall) {
        try {
          const paths = await getInstallationPaths(scope);
          const settingsPath = path.join(paths.claudeDir, 'settings.json');
          const settingsContent = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsContent);

          if (settings.hooks) {
            if (process.stdin.isTTY) {
              const removeHooks = await p.confirm({
                message: `Remove DevFlow hooks from settings.json (${scope} scope)? Other settings preserved.`,
                initialValue: false,
              });

              if (!p.isCancel(removeHooks) && removeHooks) {
                delete settings.hooks;
                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
                p.log.success(`DevFlow hooks removed from settings.json (${scope})`);
              } else {
                p.log.info(`settings.json hooks preserved (${scope})`);
              }
            } else {
              p.log.info(`settings.json hooks preserved (${scope}, non-interactive mode)`);
            }
          }
        } catch {
          // settings.json doesn't exist or can't be parsed — skip
        }
      }

      // 4. Managed settings (security deny list)
      let managedSettingsExist = false;
      try {
        const managedPath = getManagedSettingsPath();
        await fs.access(managedPath);
        managedSettingsExist = true;
      } catch {
        // Managed settings don't exist or platform unsupported
      }

      if (managedSettingsExist) {
        if (process.stdin.isTTY) {
          const removeManagedConfirm = await p.confirm({
            message: 'Remove DevFlow security deny list from managed settings?',
            initialValue: false,
          });

          if (!p.isCancel(removeManagedConfirm) && removeManagedConfirm) {
            // Resolve rootDir for the template path — use the dist directory
            const uninstallRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
            await removeManagedSettings(uninstallRootDir, verbose);
          } else {
            p.log.info('Managed settings preserved');
          }
        } else {
          p.log.info('Managed settings preserved (non-interactive mode)');
        }
      }

      // 5. Safe-delete shell function
      const shell = detectShell();
      const profilePath = getProfilePath(shell);
      if (profilePath && await isAlreadyInstalled(profilePath)) {
        if (process.stdin.isTTY) {
          const removeSafeDelete = await p.confirm({
            message: `Remove safe-delete function from ${profilePath}?`,
            initialValue: false,
          });

          if (!p.isCancel(removeSafeDelete) && removeSafeDelete) {
            const removed = await removeFromProfile(profilePath);
            if (removed) {
              p.log.success(`Safe-delete removed from ${profilePath}`);
            } else {
              p.log.warn(`Could not remove safe-delete from ${profilePath}`);
            }
          } else {
            p.log.info('Safe-delete preserved in shell profile');
          }
        } else {
          p.log.info(`Safe-delete function preserved in ${profilePath} (non-interactive mode)`);
        }
      }
    }

    const status = color.green('DevFlow uninstalled successfully');

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
