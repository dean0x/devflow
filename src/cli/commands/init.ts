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
  installManagedSettings,
  installClaudeignore,
  updateGitignore,
  createDocsStructure,
  createMemoryDir,
  migrateMemoryFiles,
  type SecurityMode,
} from '../utils/post-install.js';
import { DEVFLOW_PLUGINS, LEGACY_SKILL_NAMES, LEGACY_COMMAND_NAMES, buildAssetMaps, type PluginDefinition } from '../plugins.js';
import { detectPlatform, detectShell, getProfilePath, getSafeDeleteInfo, hasSafeDelete } from '../utils/safe-delete.js';
import { generateSafeDeleteBlock, isAlreadyInstalled, installToProfile, removeFromProfile, getInstalledVersion, SAFE_DELETE_BLOCK_VERSION } from '../utils/safe-delete-install.js';
import { addAmbientHook, removeAmbientHook, hasAmbientHook } from './ambient.js';
import { addMemoryHooks, removeMemoryHooks, hasMemoryHooks } from './memory.js';
import { addHudStatusLine, removeHudStatusLine, hasHudStatusLine } from './hud.js';
import { PRESETS, DEFAULT_PRESET, saveConfig as saveHudConfig } from '../hud/config.js';
import type { PresetName } from '../hud/types.js';
import { readManifest, writeManifest, resolvePluginList, detectUpgrade } from '../utils/manifest.js';

// Re-export pure functions for tests (canonical source is post-install.ts)
export { substituteSettingsTemplate, computeGitignoreAppend, applyTeamsConfig, stripTeamsConfig, mergeDenyList } from '../utils/post-install.js';
export { addAmbientHook, removeAmbientHook, hasAmbientHook } from './ambient.js';
export { addMemoryHooks, removeMemoryHooks, hasMemoryHooks } from './memory.js';
export { addHudStatusLine, removeHudStatusLine, hasHudStatusLine } from './hud.js';

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

export type ExtraId = 'settings' | 'claudeignore' | 'gitignore' | 'docs' | 'safe-delete';

interface ExtraOption {
  value: ExtraId;
  label: string;
  hint: string;
}

/**
 * Build the list of configuration extras available for the given scope/git context.
 * Pure function — no I/O, no side effects.
 */
export function buildExtrasOptions(scope: 'user' | 'local', gitRoot: string | null): ExtraOption[] {
  const options: ExtraOption[] = [
    { value: 'settings', label: 'Settings & Working Memory', hint: 'Model defaults, session memory hooks, status line' },
  ];

  if (gitRoot) {
    options.push({ value: 'claudeignore', label: '.claudeignore', hint: 'Exclude secrets, deps, build artifacts from Claude context' });
  }

  if (scope === 'local' && gitRoot) {
    options.push({ value: 'gitignore', label: '.gitignore entries', hint: 'Add .claude/ and .devflow/ to .gitignore' });
  }

  if (scope === 'local') {
    options.push({ value: 'docs', label: '.docs/ directory', hint: 'Review reports, dev logs, status tracking for this project' });
  }

  options.push({ value: 'safe-delete', label: 'Safe-delete (rm → trash)', hint: 'Override rm to use trash CLI — prevents accidental deletion' });

  return options;
}

/**
 * Options for the init command parsed by Commander.js
 */
interface InitOptions {
  scope?: string;
  verbose?: boolean;
  plugin?: string;
  teams?: boolean;
  ambient?: boolean;
  memory?: boolean;
  hud?: string;
  hudOnly?: boolean;
}

export const initCommand = new Command('init')
  .description('Initialize DevFlow for Claude Code')
  .option('--scope <type>', 'Installation scope: user or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
  .option('--plugin <names>', 'Install specific plugin(s), comma-separated (e.g., implement,code-review)')
  .option('--teams', 'Enable Agent Teams (peer debate, adversarial review)')
  .option('--no-teams', 'Disable Agent Teams (use parallel subagents instead)')
  .option('--ambient', 'Enable ambient mode (classifies intent, loads skills, orchestrates agents)')
  .option('--no-ambient', 'Disable ambient mode')
  .option('--memory', 'Enable working memory (session context preservation)')
  .option('--no-memory', 'Disable working memory hooks')
  .option('--hud <preset>', 'HUD preset (minimal, classic, standard, full, off)')
  .option('--hud-only', 'Install only the HUD (no plugins, hooks, or extras)')
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

    // Determine installation scope
    let scope: 'user' | 'local' = 'user';

    if (options.hudOnly) {
      // --hud-only: skip scope prompt, always user scope
      scope = 'user';
    } else if (options.scope) {
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

    // --hud-only: install only HUD (skip plugins, hooks, extras)
    if (options.hudOnly) {
      // Resolve HUD preset
      let hudPreset: PresetName | 'off' = DEFAULT_PRESET;
      if (options.hud !== undefined) {
        const val = options.hud;
        if (val === 'off') {
          hudPreset = 'off';
        } else if (val in PRESETS) {
          hudPreset = val as PresetName;
        } else {
          p.log.error(`Unknown HUD preset: ${val}. Valid: minimal, classic, standard, full, off`);
          process.exit(1);
        }
      } else if (process.stdin.isTTY) {
        const hudChoice = await p.select({
          message: 'Choose HUD preset',
          options: [
            { value: 'standard', label: 'Standard (Recommended)', hint: 'directory, git, model, context, version, session, usage' },
            { value: 'minimal', label: 'Minimal', hint: 'directory, git branch, model, context usage' },
            { value: 'classic', label: 'Classic', hint: 'Like statusline.sh with version badge' },
            { value: 'full', label: 'Full', hint: 'All 14 components' },
            { value: 'off', label: 'No HUD', hint: 'Disable status line entirely' },
          ],
          initialValue: 'standard',
        });
        if (p.isCancel(hudChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        hudPreset = hudChoice as PresetName | 'off';
      }

      // Resolve paths
      const paths = await getInstallationPaths(scope);
      const claudeDir = paths.claudeDir;
      const devflowDir = paths.devflowDir;

      // Save HUD config
      if (hudPreset !== 'off') {
        saveHudConfig({ preset: hudPreset, components: PRESETS[hudPreset] });
      }

      // Update statusLine in settings.json
      const settingsPath = path.join(claudeDir, 'settings.json');
      try {
        let content: string;
        try {
          content = await fs.readFile(settingsPath, 'utf-8');
        } catch {
          content = '{}';
        }
        const updated = hudPreset !== 'off'
          ? addHudStatusLine(content, devflowDir)
          : removeHudStatusLine(content);
        await fs.writeFile(settingsPath, updated, 'utf-8');
      } catch (error) {
        p.log.error(`Failed to update settings: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }

      // Write minimal manifest
      const now = new Date().toISOString();
      try {
        await writeManifest(devflowDir, {
          version,
          plugins: [],
          scope,
          features: { teams: false, ambient: false, memory: false, hud: hudPreset === 'off' ? false as const : String(hudPreset) },
          installedAt: now,
          updatedAt: now,
        });
      } catch { /* non-fatal */ }

      if (hudPreset !== 'off') {
        p.log.success(`HUD installed (preset: ${hudPreset})`);
      } else {
        p.log.info('HUD disabled');
      }
      p.log.info(`Configure later: ${color.cyan('devflow hud --configure')}`);
      p.outro(color.green('HUD-only install complete.'));
      return;
    }

    // Select plugins to install
    let selectedPlugins: string[] = [];
    if (options.plugin) {
      const { selected, invalid } = parsePluginSelection(options.plugin, DEVFLOW_PLUGINS);
      selectedPlugins = selected;

      if (invalid.length > 0) {
        p.log.error(`Unknown plugin(s): ${invalid.join(', ')}`);
        p.log.info(`Valid plugins: ${DEVFLOW_PLUGINS.map(pl => pl.name).join(', ')}`);
        process.exit(1);
      }
    } else if (process.stdin.isTTY) {
      const choices = DEVFLOW_PLUGINS
        .filter(pl => pl.name !== 'devflow-core-skills' && pl.name !== 'devflow-ambient' && pl.name !== 'devflow-audit-claude')
        .map(pl => ({
          value: pl.name,
          label: pl.name.replace('devflow-', ''),
          hint: pl.description,
        }));

      const preSelected = DEVFLOW_PLUGINS
        .filter(pl => !pl.optional && pl.name !== 'devflow-core-skills' && pl.name !== 'devflow-ambient')
        .map(pl => pl.name);

      const pluginSelection = await p.multiselect({
        message: 'Select plugins to install',
        options: choices,
        initialValues: preSelected,
        required: true,
      });

      if (p.isCancel(pluginSelection)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }

      selectedPlugins = pluginSelection as string[];
    }

    // Agent Teams variant selection
    let teamsEnabled: boolean;
    if (options.teams !== undefined) {
      teamsEnabled = options.teams;
    } else if (!process.stdin.isTTY) {
      teamsEnabled = false;
    } else {
      const teamsChoice = await p.select({
        message: 'Enable Agent Teams?',
        options: [
          { value: false, label: 'No (Recommended)', hint: 'Experimental — may be unstable' },
          { value: true, label: 'Yes', hint: 'Advanced — peer debate in review, exploration, debugging' },
        ],
      });
      if (p.isCancel(teamsChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }
      teamsEnabled = teamsChoice as boolean;
    }

    // Ambient mode selection
    let ambientEnabled: boolean;
    if (options.ambient !== undefined) {
      ambientEnabled = options.ambient;
    } else if (!process.stdin.isTTY) {
      ambientEnabled = true;
    } else {
      const ambientChoice = await p.select({
        message: 'Enable ambient mode?',
        options: [
          { value: true, label: 'Yes (Recommended)', hint: 'Classifies intent, loads skills, orchestrates agents' },
          { value: false, label: 'No', hint: 'Full control — load skills manually' },
        ],
      });
      if (p.isCancel(ambientChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }
      ambientEnabled = ambientChoice as boolean;
    }

    // Working memory selection (defaults ON — foundational feature)
    let memoryEnabled: boolean;
    if (options.memory !== undefined) {
      memoryEnabled = options.memory;
    } else if (!process.stdin.isTTY) {
      memoryEnabled = true;
    } else {
      const memoryChoice = await p.confirm({
        message: 'Enable working memory? (automatic session context preservation)',
        initialValue: true,
      });
      if (p.isCancel(memoryChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }
      memoryEnabled = memoryChoice;
    }

    // HUD preset selection
    let hudPreset: PresetName | 'off' = DEFAULT_PRESET;
    if (options.hud !== undefined) {
      const val = options.hud;
      if (val === 'off') {
        hudPreset = 'off';
      } else if (val in PRESETS) {
        hudPreset = val as PresetName;
      } else {
        p.log.error(`Unknown HUD preset: ${val}. Valid: minimal, classic, standard, full, off`);
        process.exit(1);
      }
    } else if (process.stdin.isTTY) {
      const hudChoice = await p.select({
        message: 'Choose HUD preset',
        options: [
          { value: 'standard', label: 'Standard (Recommended)', hint: 'directory, git, model, context, version, session, usage' },
          { value: 'minimal', label: 'Minimal', hint: 'directory, git branch, model, context usage' },
          { value: 'classic', label: 'Classic', hint: 'Like statusline.sh with version badge' },
          { value: 'full', label: 'Full', hint: 'All 14 components' },
          { value: 'off', label: 'No HUD', hint: 'Disable status line entirely' },
        ],
        initialValue: 'standard',
      });
      if (p.isCancel(hudChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }
      hudPreset = hudChoice as PresetName | 'off';
    }

    // Security deny list placement (user scope + TTY only)
    let securityMode: SecurityMode = 'user';
    if (scope === 'user' && process.stdin.isTTY) {
      const securityChoice = await p.select({
        message: 'How should DevFlow install the security deny list?',
        options: [
          { value: 'managed', label: 'Managed settings (Recommended)', hint: 'Cannot be overridden, requires admin' },
          { value: 'user', label: 'User settings', hint: 'Included in settings.json, editable' },
        ],
      });

      if (p.isCancel(securityChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }

      securityMode = securityChoice as SecurityMode;
    }

    // Start spinner immediately after prompts — covers path resolution + git detection
    const s = p.spinner();
    s.start('Resolving paths');

    // Get installation paths
    let claudeDir: string;
    let devflowDir: string;
    let gitRoot: string | null = null;

    try {
      const paths = await getInstallationPaths(scope);
      claudeDir = paths.claudeDir;
      devflowDir = paths.devflowDir;
      gitRoot = paths.gitRoot ?? await getGitRoot();
    } catch (error) {
      s.stop('Path resolution failed');
      p.log.error(`Path configuration error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Check existing manifest for upgrade detection
    const existingManifest = await readManifest(devflowDir);
    if (existingManifest) {
      const upgrade = detectUpgrade(version, existingManifest.version);
      if (upgrade.isUpgrade) {
        s.message(`Upgrading from v${upgrade.previousVersion} to v${version}`);
      } else if (upgrade.isSameVersion) {
        s.message('Reinstalling same version');
      }
    }

    // Validate target directory
    s.message('Validating target directory');

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
    s.message('Installing components');
    const rootDir = path.resolve(__dirname, '../..');
    const pluginsDir = path.join(rootDir, 'plugins');

    let pluginsToInstall = selectedPlugins.length > 0
      ? DEVFLOW_PLUGINS.filter(p => selectedPlugins.includes(p.name))
      : DEVFLOW_PLUGINS.filter(p => !p.optional);

    const coreSkillsPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills');
    if (pluginsToInstall.length > 0 && coreSkillsPlugin && !pluginsToInstall.includes(coreSkillsPlugin)) {
      pluginsToInstall = [coreSkillsPlugin, ...pluginsToInstall];
    }

    const ambientPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    if (ambientEnabled && ambientPlugin && !pluginsToInstall.includes(ambientPlugin)) {
      pluginsToInstall.push(ambientPlugin);
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
          isPartialInstall: !!options.plugin,
          teamsEnabled,
          spinner: s,
        });
      } catch (error) {
        s.stop('Installation failed');
        p.log.error(`${error}`);
        process.exit(1);
      }
    }

    s.stop('Plugins installed');

    // Clean up stale skills from previous installations
    const skillsDir = path.join(claudeDir, 'skills');
    let staleRemoved = 0;
    for (const legacy of LEGACY_SKILL_NAMES) {
      const legacyPath = path.join(skillsDir, legacy);
      try {
        await fs.rm(legacyPath, { recursive: true });
        staleRemoved++;
      } catch {
        // Doesn't exist — expected for most entries
      }
    }
    if (staleRemoved > 0 && verbose) {
      p.log.info(`Cleaned up ${staleRemoved} legacy skill(s)`);
    }

    // Clean up stale commands from previous installations (e.g., /review → /code-review)
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    let staleCommandsRemoved = 0;
    for (const legacy of LEGACY_COMMAND_NAMES) {
      for (const suffix of ['.md', '-teams.md']) {
        const legacyPath = path.join(commandsDir, `${legacy}${suffix}`);
        try {
          await fs.rm(legacyPath);
          staleCommandsRemoved++;
        } catch {
          // Doesn't exist — expected for most entries
        }
      }
    }
    if (staleCommandsRemoved > 0 && verbose) {
      p.log.info(`Cleaned up ${staleCommandsRemoved} legacy command(s)`);
    }

    // === Configuration extras ===
    const extrasOptions = buildExtrasOptions(scope, gitRoot);
    let selectedExtras: ExtraId[];

    if (process.stdin.isTTY) {
      const extrasSelection = await p.multiselect({
        message: 'Configure extras',
        options: extrasOptions,
        initialValues: extrasOptions.map(o => o.value),
        required: false,
      });

      if (p.isCancel(extrasSelection)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }

      selectedExtras = extrasSelection as ExtraId[];
    } else {
      selectedExtras = extrasOptions.map(o => o.value);
    }

    // Settings may trigger its own TTY sub-prompt — run outside spinner
    if (selectedExtras.includes('settings')) {
      // Attempt managed settings write if user chose managed mode
      let effectiveSecurityMode = securityMode;
      if (securityMode === 'managed') {
        p.note(
          'This writes a read-only security deny list to a system directory\n' +
          'and may prompt for your password (sudo).\n\n' +
          'Not sure about this? Paste this into another Claude Code session:\n\n' +
          '  "I\'m installing DevFlow and it wants to write a\n' +
          '   managed-settings.json file using sudo. Review the source\n' +
          '   at https://github.com/dean0x/devflow and tell me if\n' +
          '   it\'s safe."',
          'Managed Settings',
        );

        const sudoChoice = await p.select({
          message: 'Continue with managed settings?',
          options: [
            { value: 'yes', label: 'Yes, continue', hint: 'May prompt for your password' },
            { value: 'no', label: 'No, fall back to settings.json', hint: 'Deny list stored in editable user settings instead' },
          ],
        });

        if (p.isCancel(sudoChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }

        if (sudoChoice === 'yes') {
          const managed = await installManagedSettings(rootDir, verbose);
          if (!managed) {
            p.log.warn('Managed settings write failed — falling back to user settings');
            effectiveSecurityMode = 'user';
          }
        } else {
          effectiveSecurityMode = 'user';
        }
      }
      await installSettings(claudeDir, rootDir, devflowDir, verbose, teamsEnabled, effectiveSecurityMode);

      // Install ambient hook if enabled
      if (ambientEnabled) {
        const settingsPath = path.join(claudeDir, 'settings.json');
        try {
          const content = await fs.readFile(settingsPath, 'utf-8');
          const updated = addAmbientHook(content, devflowDir);
          if (updated !== content) {
            await fs.writeFile(settingsPath, updated, 'utf-8');
            if (verbose) {
              p.log.success('Ambient mode hook installed');
            }
          }
        } catch { /* settings.json may not exist yet */ }
      }

      // Manage memory hooks based on user choice
      const settingsPath = path.join(claudeDir, 'settings.json');
      try {
        const content = await fs.readFile(settingsPath, 'utf-8');
        // Always remove-then-add to upgrade hook format (e.g., .sh → run-hook)
        const cleaned = removeMemoryHooks(content);
        const updated = memoryEnabled
          ? addMemoryHooks(cleaned, devflowDir)
          : cleaned;
        if (updated !== content) {
          await fs.writeFile(settingsPath, updated, 'utf-8');
          if (verbose) {
            p.log.info(`Working memory ${memoryEnabled ? 'enabled' : 'disabled'}`);
          }
        }
      } catch { /* settings.json may not exist yet */ }

      // Ensure .memory/ exists when memory is enabled (hooks are no-ops without it)
      if (memoryEnabled) {
        await createMemoryDir(verbose);
        await migrateMemoryFiles(verbose);
      }

      // Configure HUD
      if (hudPreset !== 'off') {
        saveHudConfig({ preset: hudPreset, components: PRESETS[hudPreset] });
      }

      // Update statusLine in settings.json (add or remove based on preset)
      try {
        const hudContent = await fs.readFile(settingsPath, 'utf-8');
        const hudUpdated = hudPreset !== 'off'
          ? addHudStatusLine(hudContent, devflowDir)
          : removeHudStatusLine(hudContent);
        if (hudUpdated !== hudContent) {
          await fs.writeFile(settingsPath, hudUpdated, 'utf-8');
          if (verbose) {
            if (hudPreset !== 'off') {
              p.log.success(`HUD enabled (preset: ${hudPreset})`);
            } else {
              p.log.info('HUD disabled');
            }
          }
        }
      } catch { /* settings.json may not exist yet */ }
    }

    const fileExtras = selectedExtras.filter(e => e !== 'settings' && e !== 'safe-delete');
    if (fileExtras.length > 0) {
      const sExtras = p.spinner();
      sExtras.start('Configuring extras');

      if (selectedExtras.includes('claudeignore') && gitRoot) {
        await installClaudeignore(gitRoot, rootDir, verbose);
      }
      if (selectedExtras.includes('gitignore') && gitRoot) {
        await updateGitignore(gitRoot, verbose);
      }
      if (selectedExtras.includes('docs')) {
        await createDocsStructure(verbose);
      }

      sExtras.stop('Extras configured');
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

    // Safe-delete auto-install (gated by extras selection)
    if (selectedExtras.includes('safe-delete')) {
      const platform = detectPlatform();
      const shell = detectShell();
      const safeDeleteInfo = getSafeDeleteInfo(platform);
      const safeDeleteAvailable = hasSafeDelete(platform);
      const profilePath = getProfilePath(shell);

      if (process.stdin.isTTY && profilePath) {
        if (!safeDeleteAvailable && safeDeleteInfo.installHint) {
          p.log.info(`Install ${color.cyan(safeDeleteInfo.command ?? 'trash')} first: ${color.dim(safeDeleteInfo.installHint)}`);
          p.log.info(`Then re-run ${color.cyan('devflow init')} to auto-configure safe-delete.`);
        } else if (safeDeleteAvailable) {
          const trashCmd = safeDeleteInfo.command;
          const block = generateSafeDeleteBlock(shell, process.platform, trashCmd);

          if (block) {
            const installedVersion = await getInstalledVersion(profilePath);
            if (installedVersion === SAFE_DELETE_BLOCK_VERSION) {
              p.log.info(`Safe-delete already configured in ${color.dim(profilePath)}`);
            } else if (installedVersion > 0) {
              await removeFromProfile(profilePath);
              await installToProfile(profilePath, block);
              p.log.success(`Safe-delete upgraded in ${color.dim(profilePath)}`);
              p.log.info('Restart your shell or run: ' + color.cyan(`source ${profilePath}`));
            } else {
              const confirm = await p.confirm({
                message: `Install safe-delete to ${profilePath}? (overrides rm to use ${trashCmd ?? 'recycle bin'})`,
                initialValue: true,
              });

              if (!p.isCancel(confirm) && confirm) {
                await installToProfile(profilePath, block);
                p.log.success(`Safe-delete installed to ${color.dim(profilePath)}`);
                p.log.info('Restart your shell or run: ' + color.cyan(`source ${profilePath}`));
              }
            }
          }
        }
      } else if (!process.stdin.isTTY) {
        if (safeDeleteAvailable && safeDeleteInfo.command) {
          p.log.info(`Safe-delete available (${safeDeleteInfo.command}). Run interactively to auto-install.`);
        } else if (safeDeleteInfo.installHint) {
          p.log.info(`Protect against accidental ${color.red('rm -rf')}: ${color.cyan(safeDeleteInfo.installHint)}`);
        }
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

    // Write installation manifest for upgrade tracking (non-fatal — install already succeeded)
    const installedPluginNames = pluginsToInstall.map(pl => pl.name);
    const now = new Date().toISOString();
    const manifestData = {
      version,
      plugins: resolvePluginList(installedPluginNames, existingManifest, !!options.plugin),
      scope,
      features: { teams: teamsEnabled, ambient: ambientEnabled, memory: memoryEnabled, hud: hudPreset === 'off' ? false as const : String(hudPreset) },
      installedAt: existingManifest?.installedAt ?? now,
      updatedAt: now,
    };
    try {
      await writeManifest(devflowDir, manifestData);
    } catch (error) {
      p.log.warn(`Failed to write installation manifest (install succeeded): ${error instanceof Error ? error.message : error}`);
    }

    p.outro(color.green('Ready! Run any command in Claude Code to get started.'));
  });
