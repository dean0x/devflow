import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { isClaudeCliAvailable } from '../utils/cli.js';
import { installViaCli, installViaFileCopy } from '../utils/installer.js';
import {
  installSettings,
  installClaudeMd,
  installClaudeignore,
  updateGitignore,
  createDocsStructure,
} from '../utils/post-install.js';
import { DEVFLOW_PLUGINS, buildAssetMaps, type PluginDefinition } from '../plugins.js';
import { detectPlatform, getSafeDeleteSuggestion, hasSafeDelete } from '../utils/safe-delete.js';

// Re-export pure functions for tests (canonical source is post-install.ts)
export { substituteSettingsTemplate, computeGitignoreAppend } from '../utils/post-install.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse a comma-separated plugin selection string into normalized plugin names.
 * Validates against known plugins; returns invalid names as errors.
 */
export function parsePluginSelection(
  input: string,
  validPlugins: PluginDefinition[],
): { selected: string[]; invalid: string[] } {
  const selected = input.split(',').map(p => {
    const trimmed = p.trim();
    return trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
  });

  const validNames = validPlugins.map(p => p.name);
  const invalid = selected.filter(p => !validNames.includes(p));
  return { selected, invalid };
}

/**
 * Options for the init command parsed by Commander.js
 */
interface InitOptions {
  skipDocs?: boolean;
  scope?: string;
  verbose?: boolean;
  overrideSettings?: boolean;
  plugin?: string;
  list?: boolean;
}

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--skip-docs', 'Skip creating .docs/ structure')
  .option('--scope <type>', 'Installation scope: user or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
  .option('--override-settings', 'Override existing settings.json with DevFlow configuration')
  .option('--plugin <names>', 'Install specific plugin(s), comma-separated (e.g., implement,review)')
  .option('--list', 'List available plugins')
  .action(async (options: InitOptions) => {
    // Get package version
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    let version = '';
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      version = packageJson.version;
    } catch {
      version = 'unknown';
    }

    const verbose = options.verbose ?? false;

    // Start the CLI flow
    p.intro(color.bgCyan(color.black(` DevFlow v${version} `)));

    // Handle --list option
    if (options.list) {
      const maxNameLen = Math.max(...DEVFLOW_PLUGINS.map(p => p.name.length));
      const pluginList = DEVFLOW_PLUGINS
        .map(plugin => {
          const cmds = plugin.commands.length > 0 ? plugin.commands.join(', ') : '(skills only)';
          const optionalTag = plugin.optional ? color.dim(' (optional)') : '';
          return `${color.cyan(plugin.name.padEnd(maxNameLen + 2))}${color.dim(plugin.description)}${optionalTag}\n${' '.repeat(maxNameLen + 2)}${color.yellow(cmds)}`;
        })
        .join('\n\n');

      p.note(pluginList, 'Available plugins');
      p.outro(color.dim('Install with: npx devflow-kit init --plugin=<name>'));
      return;
    }

    // Parse plugin selection
    let selectedPlugins: string[] = [];
    if (options.plugin) {
      const { selected, invalid } = parsePluginSelection(options.plugin, DEVFLOW_PLUGINS);
      selectedPlugins = selected;

      if (invalid.length > 0) {
        p.log.error(`Unknown plugin(s): ${invalid.join(', ')}`);
        p.log.info(`Valid plugins: ${DEVFLOW_PLUGINS.map(pl => pl.name).join(', ')}`);
        process.exit(1);
      }
    }

    // Determine installation scope
    let scope: 'user' | 'local' = 'user';

    if (options.scope) {
      const normalizedScope = options.scope.toLowerCase();
      if (normalizedScope !== 'user' && normalizedScope !== 'local') {
        p.log.error('Invalid scope. Use "user" or "local"');
        process.exit(1);
      }
      scope = normalizedScope;
    } else if (!process.stdin.isTTY) {
      p.log.info('Non-interactive mode detected, using scope: user');
      scope = 'user';
    } else {
      const selected = await p.select({
        message: 'Installation scope',
        options: [
          { value: 'user', label: 'User', hint: 'all projects (~/.claude/)' },
          { value: 'local', label: 'Local', hint: 'this project only (./.claude/)' },
        ],
      });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }

      scope = selected as 'user' | 'local';
    }

    // Get installation paths
    let claudeDir: string;
    let devflowDir: string;
    let gitRoot: string | null = null;

    try {
      const paths = await getInstallationPaths(scope);
      claudeDir = paths.claudeDir;
      devflowDir = paths.devflowDir;
      gitRoot = await getGitRoot();
    } catch (error) {
      p.log.error(`Path configuration error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Validate target directory
    const s = p.spinner();
    s.start('Installing components');

    if (scope === 'local') {
      try {
        await fs.mkdir(claudeDir, { recursive: true });
      } catch (error) {
        s.stop('Installation failed');
        p.log.error(`Failed to create ${claudeDir}: ${error}`);
        process.exit(1);
      }
    } else {
      try {
        await fs.access(claudeDir);
      } catch {
        s.stop('Installation failed');
        p.log.error(`Claude Code not detected at ${claudeDir}`);
        p.log.info('Install from: https://claude.ai/download');
        process.exit(1);
      }
    }

    // Resolve plugins and deduplication maps
    const rootDir = path.resolve(__dirname, '../..');
    const pluginsDir = path.join(rootDir, 'plugins');

    let pluginsToInstall = selectedPlugins.length > 0
      ? DEVFLOW_PLUGINS.filter(p => selectedPlugins.includes(p.name))
      : DEVFLOW_PLUGINS.filter(p => !p.optional);

    const coreSkillsPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills');
    if (pluginsToInstall.length > 0 && coreSkillsPlugin && !pluginsToInstall.includes(coreSkillsPlugin)) {
      pluginsToInstall = [coreSkillsPlugin, ...pluginsToInstall];
    }

    const { skillsMap, agentsMap } = buildAssetMaps(pluginsToInstall);

    // Install: try native CLI first, fall back to file copy
    const cliAvailable = isClaudeCliAvailable();
    const usedNativeCli = cliAvailable && installViaCli(pluginsToInstall, scope, s);

    if (!usedNativeCli) {
      if (cliAvailable && verbose) {
        p.log.warn('Claude CLI installation failed, falling back to manual copy');
      }

      try {
        await installViaFileCopy({
          plugins: pluginsToInstall,
          claudeDir,
          pluginsDir,
          rootDir,
          devflowDir,
          skillsMap,
          agentsMap,
          selectedPluginNames: selectedPlugins,
          spinner: s,
        });
      } catch (error) {
        s.stop('Installation failed');
        p.log.error(`${error}`);
        process.exit(1);
      }
    }

    // === Post-install extras ===
    await installSettings(claudeDir, rootDir, devflowDir, options.overrideSettings ?? false, verbose);
    await installClaudeMd(claudeDir, rootDir, verbose);
    if (gitRoot) {
      await installClaudeignore(gitRoot, rootDir, verbose);
    }
    if (scope === 'local' && gitRoot) {
      await updateGitignore(gitRoot, verbose);
    }
    if (!options.skipDocs) {
      await createDocsStructure(verbose);
    }

    // Summary output
    if (usedNativeCli) {
      p.log.success('Installed via Claude plugin system');
    } else if (!cliAvailable) {
      p.log.info('Installed via file copy (Claude CLI not available)');
    }

    const installedCommands = pluginsToInstall.flatMap(p => p.commands).filter(c => c.length > 0);
    if (installedCommands.length > 0) {
      const commandsNote = installedCommands
        .map(cmd => color.cyan(cmd))
        .join('  ');
      p.note(commandsNote, 'Available commands');
    }

    // Safe-delete suggestion
    const platform = detectPlatform();
    const safeDeleteInfo = getSafeDeleteSuggestion(platform);
    if (safeDeleteInfo) {
      const safeDeleteAvailable = hasSafeDelete(platform);
      if (safeDeleteAvailable) {
        p.log.info(`💡 Safe-delete available (${color.green(safeDeleteInfo.command)}). Add to shell profile: ${color.cyan(safeDeleteInfo.aliasHint)}`);
      } else {
        p.log.info(`💡 Protect against accidental ${color.red('rm -rf')}: ${color.cyan(safeDeleteInfo.installHint)}`);
      }
    }

    // Verbose mode: show details
    if (verbose) {
      const pluginsList = pluginsToInstall
        .map(plugin => `${color.yellow(plugin.name.padEnd(24))}${color.dim(plugin.description)}`)
        .join('\n');

      p.note(pluginsList, 'Installed plugins');

      p.log.info(`Scope: ${scope}`);
      p.log.info(`Claude dir: ${claudeDir}`);
      p.log.info(`DevFlow dir: ${devflowDir}`);

      const totalSkillDeclarations = pluginsToInstall.reduce((sum, p) => sum + p.skills.length, 0);
      const totalAgentDeclarations = pluginsToInstall.reduce((sum, p) => sum + p.agents.length, 0);
      p.log.info(`Deduplication: ${skillsMap.size} unique skills (from ${totalSkillDeclarations} declarations)`);
      p.log.info(`Deduplication: ${agentsMap.size} unique agents (from ${totalAgentDeclarations} declarations)`);
    }

    p.outro(color.green('Ready! Run any command in Claude Code to get started.'));
  });
