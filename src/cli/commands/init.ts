import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths } from '../utils/paths.js';
import { getGitRoot } from '../utils/git.js';
import { isClaudeCliAvailable } from '../utils/cli.js';
import { installViaCli, installViaFileCopy, copyDirectory } from '../utils/installer.js';
import {
  installSettings,
  installManagedSettings,
  installClaudeignore,
  discoverProjectGitRoots,
  updateGitignore,
  createDocsStructure,
  createMemoryDir,
  migrateMemoryFiles,
  type SecurityMode,
} from '../utils/post-install.js';
import { DEVFLOW_PLUGINS, LEGACY_PLUGIN_NAMES, LEGACY_SKILL_NAMES, LEGACY_COMMAND_NAMES, SHADOW_RENAMES, buildAssetMaps, buildFullSkillsMap, type PluginDefinition } from '../plugins.js';
import { detectPlatform, detectShell, getProfilePath, getSafeDeleteInfo, hasSafeDelete } from '../utils/safe-delete.js';
import { generateSafeDeleteBlock, installToProfile, removeFromProfile, getInstalledVersion, SAFE_DELETE_BLOCK_VERSION } from '../utils/safe-delete-install.js';
import { addAmbientHook, removeAmbientHook } from './ambient.js';
import { addMemoryHooks, removeMemoryHooks } from './memory.js';
import { addLearningHook, removeLearningHook } from './learn.js';
import { addHudStatusLine, removeHudStatusLine } from './hud.js';
import { loadConfig as loadHudConfig, saveConfig as saveHudConfig } from '../hud/config.js';
import { readManifest, writeManifest, resolvePluginList, detectUpgrade } from '../utils/manifest.js';
import { getDefaultFlags, applyFlags, stripFlags, FLAG_REGISTRY } from '../utils/flags.js';

// Re-export pure functions for tests (canonical source is post-install.ts)
export { substituteSettingsTemplate, computeGitignoreAppend, applyTeamsConfig, stripTeamsConfig, mergeDenyList, discoverProjectGitRoots } from '../utils/post-install.js';
export { addAmbientHook, removeAmbientHook, removeLegacyAmbientHook, hasAmbientHook } from './ambient.js';
export { addMemoryHooks, removeMemoryHooks, hasMemoryHooks } from './memory.js';
export { addLearningHook, removeLearningHook, hasLearningHook } from './learn.js';
export { addHudStatusLine, removeHudStatusLine, hasHudStatusLine } from './hud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Classify the safe-delete installation state based on the installed version
 * in the user's shell profile.
 */
export function classifySafeDeleteState(
  installedVersion: number,
  currentVersion: number,
): 'current' | 'outdated' | 'missing' {
  if (installedVersion === currentVersion) return 'current';
  if (installedVersion > 0) return 'outdated';
  return 'missing';
}

async function shadowExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/**
 * Migrate shadow skill overrides from old V2 skill names to new names.
 * Pure function suitable for testing — requires only the devflowDir path.
 *
 * Groups SHADOW_RENAMES entries by their target name so that multiple old
 * names mapping to the same target (e.g. git-safety, git-workflow,
 * github-patterns → git) are processed sequentially within the group.
 * Distinct-target groups still run in parallel via Promise.all, preserving
 * throughput while eliminating the TOCTOU race on shared targets.
 */
export async function migrateShadowOverrides(devflowDir: string): Promise<{ migrated: number; warnings: string[] }> {
  const shadowsRoot = path.join(devflowDir, 'skills');

  // Group entries by target name so many-to-one mappings are serialized.
  const groups = new Map<string, [string, string][]>();
  for (const entry of SHADOW_RENAMES) {
    const [, newName] = entry;
    const group = groups.get(newName) ?? [];
    group.push(entry);
    groups.set(newName, group);
  }

  // Process distinct-target groups in parallel; entries within each group run
  // sequentially so check-then-rename is effectively atomic per target.
  const groupResults = await Promise.all(
    [...groups.values()].map(async (entries) => {
      let migrated = 0;
      const warnings: string[] = [];

      for (const [oldName, newName] of entries) {
        const oldShadow = path.join(shadowsRoot, oldName);
        const newShadow = path.join(shadowsRoot, newName);

        if (!(await shadowExists(oldShadow))) continue;

        if (await shadowExists(newShadow)) {
          // Target already exists (from a previous entry in this group or a
          // pre-existing user shadow) — warn, don't overwrite
          warnings.push(`Shadow '${oldName}' found alongside '${newName}' — keeping '${newName}', old shadow at ${oldShadow}`);
          continue;
        }

        // Target doesn't exist yet — rename
        await fs.rename(oldShadow, newShadow);
        migrated++;
      }

      return { migrated, warnings };
    }),
  );

  return {
    migrated: groupResults.reduce((sum, r) => sum + r.migrated, 0),
    warnings: groupResults.flatMap(r => r.warnings),
  };
}

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
    const normalized = trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
    return LEGACY_PLUGIN_NAMES[normalized] ?? normalized;
  });

  const validNames = validPlugins.map(p => p.name);
  const invalid = selected.filter(p => !validNames.includes(p));
  return { selected, invalid };
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
  learn?: boolean;
  hud?: boolean;
  hudOnly?: boolean;
  recommended?: boolean;
  advanced?: boolean;
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
  .option('--learn', 'Enable self-learning (workflow detection)')
  .option('--no-learn', 'Disable self-learning')
  .option('--hud', 'Enable HUD (git info, context usage, session stats)')
  .option('--no-hud', 'Disable HUD status line')
  .option('--hud-only', 'Install only the HUD (no plugins, hooks, or extras)')
  .option('--recommended', 'Apply recommended defaults after plugin selection (skip advanced prompts)')
  .option('--advanced', 'Show all configuration prompts')
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
      // Resolve paths
      const paths = await getInstallationPaths(scope);
      const claudeDir = paths.claudeDir;
      const devflowDir = paths.devflowDir;

      // Save HUD config
      const existingHud = loadHudConfig();
      saveHudConfig({ enabled: true, detail: existingHud.detail });

      // Update statusLine in settings.json
      const settingsPath = path.join(claudeDir, 'settings.json');
      try {
        let content: string;
        try {
          content = await fs.readFile(settingsPath, 'utf-8');
        } catch {
          content = '{}';
        }
        const updated = addHudStatusLine(content, devflowDir);
        await fs.writeFile(settingsPath, updated, 'utf-8');
      } catch (error) {
        p.log.error(`Failed to update settings: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }

      // Copy HUD scripts to devflow dir
      const rootDir = path.resolve(__dirname, '..', '..');
      const scriptsSource = path.join(rootDir, 'scripts');
      const scriptsTarget = path.join(devflowDir, 'scripts');
      try {
        await fs.mkdir(scriptsTarget, { recursive: true });
        // Copy hud.sh
        await fs.copyFile(
          path.join(scriptsSource, 'hud.sh'),
          path.join(scriptsTarget, 'hud.sh'),
        );
        // Copy hud/ directory
        const hudSource = path.join(scriptsSource, 'hud');
        const hudTarget = path.join(scriptsTarget, 'hud');
        await copyDirectory(hudSource, hudTarget);
        if (process.platform !== 'win32') {
          await fs.chmod(path.join(scriptsTarget, 'hud.sh'), 0o755);
        }
      } catch (error) {
        p.log.error(`Failed to copy HUD scripts: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }

      // Write minimal manifest
      const now = new Date().toISOString();
      try {
        await writeManifest(devflowDir, {
          version,
          plugins: [],
          scope,
          features: { teams: false, ambient: false, memory: false, hud: true, learn: false, flags: [] },
          installedAt: now,
          updatedAt: now,
        });
      } catch { /* non-fatal */ }

      p.log.success('HUD installed');
      p.log.info(`Configure later: ${color.cyan('devflow hud --status')}`);
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
      // Short hints to prevent overflow in multiselect — full descriptions live in plugins.ts
      const pluginHints: Record<string, string> = {
        'devflow-specify': 'feature specs → GitHub issues',
        'devflow-implement': 'explore, plan, code, review',
        'devflow-code-review': 'parallel specialized reviewers',
        'devflow-resolve': 'fix review issues by risk',
        'devflow-debug': 'competing hypotheses',
        'devflow-self-review': 'Simplifier + Scrutinizer',
        'devflow-typescript': 'TypeScript patterns',
        'devflow-react': 'React patterns',
        'devflow-accessibility': 'WCAG compliance',
        'devflow-ui-design': 'typography, color, spacing',
        'devflow-go': 'Go patterns',
        'devflow-java': 'Java patterns',
        'devflow-python': 'Python patterns',
        'devflow-rust': 'Rust patterns',
      };

      const choices = DEVFLOW_PLUGINS
        .filter(pl => pl.name !== 'devflow-core-skills' && pl.name !== 'devflow-ambient' && pl.name !== 'devflow-audit-claude')
        .map(pl => ({
          value: pl.name,
          label: pl.name.replace('devflow-', ''),
          hint: pluginHints[pl.name] ?? pl.description,
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

    // ╭──────────────────────────────────────────────────────────╮
    // │  Setup mode: Recommended vs Advanced                     │
    // ╰──────────────────────────────────────────────────────────╯

    // Determine setup mode: --recommended, --advanced, interactive prompt, or non-TTY default
    if (options.recommended && options.advanced) {
      p.log.error('Cannot use both --recommended and --advanced. Pick one.');
      process.exit(1);
    }

    let useRecommended: boolean;
    if (options.recommended) {
      useRecommended = true;
    } else if (options.advanced) {
      useRecommended = false;
    } else if (!process.stdin.isTTY) {
      useRecommended = true;
    } else {
      const modeChoice = await p.select({
        message: 'Setup mode',
        options: [
          { value: 'recommended', label: 'Recommended', hint: 'sensible defaults, quick setup' },
          { value: 'advanced', label: 'Advanced', hint: 'configure each option individually' },
        ],
      });
      if (p.isCancel(modeChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }
      useRecommended = modeChoice === 'recommended';
    }

    // Early git detection (needed by both paths)
    const earlyGitRoot = await getGitRoot();

    // Feature decisions — defaults for recommended, prompts for advanced
    let teamsEnabled = false;
    let ambientEnabled = true;
    let memoryEnabled = true;
    let learnEnabled = true;
    let hudEnabled = true;
    let enabledFlags = getDefaultFlags();
    let claudeignoreEnabled = !!earlyGitRoot;
    let discoveredProjects: string[] = [];
    let safeDeleteAction: 'install' | 'upgrade' | 'skip' = 'skip';
    let safeDeleteBlock: string | null = null;
    // Default to 'user' mode: recommended path skips managed-settings to avoid a
    // sudo prompt in non-interactive / quick-setup contexts. Advanced mode offers
    // the managed option explicitly with a confirmation step.
    let securityMode: SecurityMode = 'user';
    let managedSettingsConfirmed = false;

    // Safe-delete detection (both paths need this)
    const platform = detectPlatform();
    const shell = detectShell();
    const safeDeleteInfo = getSafeDeleteInfo(platform);
    const safeDeleteAvailable = hasSafeDelete(platform);
    const profilePath = getProfilePath(shell);

    if (useRecommended) {
      // ── Recommended path: apply all defaults silently ──

      // Respect explicit CLI flags even in recommended mode
      if (options.teams !== undefined) teamsEnabled = options.teams;
      if (options.ambient !== undefined) ambientEnabled = options.ambient;
      if (options.memory !== undefined) memoryEnabled = options.memory;
      if (options.learn !== undefined) learnEnabled = options.learn;
      if (options.hud !== undefined) hudEnabled = options.hud;

      // Compute safe-delete block synchronously so we know whether to fetch installed version
      if (profilePath && safeDeleteAvailable) {
        const trashCmd = safeDeleteInfo.command;
        safeDeleteBlock = generateSafeDeleteBlock(shell, process.platform, trashCmd);
      }

      // Run independent I/O in parallel: project discovery + safe-delete version check
      const needsDiscovery = earlyGitRoot && scope === 'user';
      const needsVersionCheck = safeDeleteBlock && profilePath;

      const [discoveredResult, installedVersionResult] = await Promise.all([
        needsDiscovery ? discoverProjectGitRoots() : Promise.resolve([] as string[]),
        needsVersionCheck ? getInstalledVersion(profilePath) : Promise.resolve(0),
      ]);

      discoveredProjects = discoveredResult;

      if (needsVersionCheck) {
        const state = classifySafeDeleteState(installedVersionResult, SAFE_DELETE_BLOCK_VERSION);
        if (state === 'current') safeDeleteAction = 'skip';
        else if (state === 'outdated') safeDeleteAction = 'upgrade';
        else safeDeleteAction = 'install';
      }

      // Print summary
      const defaultFlagCount = enabledFlags.length;
      const summaryLines = [
        `Ambient mode:    ${ambientEnabled ? 'enabled' : 'disabled'}`,
        `Working memory:  ${memoryEnabled ? 'enabled' : 'disabled'}`,
        `Self-learning:   ${learnEnabled ? 'enabled' : 'disabled'}`,
        `HUD:             ${hudEnabled ? 'enabled' : 'disabled'}`,
        `Agent Teams:     ${teamsEnabled ? 'enabled' : 'disabled'}`,
        `Claude Code flags: ${defaultFlagCount} enabled`,
        `${claudeignoreEnabled ? '.claudeignore:   created' : ''}`,
        `${safeDeleteAction !== 'skip' ? 'Safe delete:     installed' : ''}`,
      ].filter(l => l.trim()).join('\n');

      p.note(summaryLines + `\n\nCustomize later: ${color.cyan('devflow init --advanced')}`, 'Recommended settings applied');

    } else {
      // ── Advanced path: full interactive flow ──

      // Advanced mode requires a TTY for interactive prompts. In non-TTY
      // environments, fall back to --recommended or pass explicit flags.
      if (!process.stdin.isTTY) {
        p.log.error('--advanced requires an interactive terminal. Use --recommended or pass explicit flags (e.g., --teams, --no-ambient).');
        process.exit(1);
      }

      // Respect explicit CLI flags — skip prompt when flag is set
      if (options.teams !== undefined) {
        teamsEnabled = options.teams;
      } else {
        p.note(
          'Agent Teams enable peer debate between agents — adversarial\n' +
          'review, competing hypotheses in debugging, and consensus-driven\n' +
          'exploration. Experimental: may be unstable.',
          'Agent Teams',
        );
        const teamsChoice = await p.select({
          message: 'Enable Agent Teams?',
          options: [
            { value: false, label: 'Not yet', hint: 'Recommended' },
            { value: true, label: 'Yes', hint: 'Experimental' },
          ],
        });
        if (p.isCancel(teamsChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        teamsEnabled = teamsChoice as boolean;
      }

      if (options.ambient !== undefined) {
        ambientEnabled = options.ambient;
      } else {
        p.note(
          'Auto-classifies every prompt by intent and depth. Loads relevant\n' +
          'skills automatically and escalates to full agent pipelines\n' +
          '(review, debug, implement) when the task warrants it.\n\n' +
          'Adds a small amount of context to each prompt for classification.',
          'Ambient Mode',
        );
        const ambientChoice = await p.select({
          message: 'Enable ambient mode?',
          options: [
            { value: true, label: 'Yes', hint: 'Recommended' },
            { value: false, label: 'No', hint: 'Manual skill loading via slash commands' },
          ],
        });
        if (p.isCancel(ambientChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        ambientEnabled = ambientChoice as boolean;
      }

      if (options.memory !== undefined) {
        memoryEnabled = options.memory;
      } else {
        p.note(
          'Preserves session context across /clear, restarts, and context\n' +
          'compaction. Clear your session at any point and resume right\n' +
          'where you left off.\n\n' +
          'Runs a background agent on session stop that consumes additional\n' +
          'tokens. Consider skipping if token usage is a concern.',
          'Working Memory',
        );
        const memoryChoice = await p.confirm({
          message: 'Enable working memory? (Recommended)',
          initialValue: true,
        });
        if (p.isCancel(memoryChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        memoryEnabled = memoryChoice;
      }

      if (options.learn !== undefined) {
        learnEnabled = options.learn;
      } else {
        p.note(
          'Detects repeated workflows and creates slash commands\n' +
          'automatically. Runs a background agent on session stop\n' +
          'that consumes additional tokens.',
          'Self-Learning',
        );
        const learnChoice = await p.confirm({
          message: 'Enable self-learning? (Recommended)',
          initialValue: true,
        });
        if (p.isCancel(learnChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        learnEnabled = learnChoice;
      }

      if (options.hud !== undefined) {
        hudEnabled = options.hud;
      } else {
        p.note(
          'The HUD displays git branch, context usage, and session stats\n' +
          'in the Claude Code status bar. Configurable via devflow hud.',
          'HUD',
        );
        const hudChoice = await p.confirm({
          message: 'Enable HUD? (Recommended)',
          initialValue: true,
        });
        if (p.isCancel(hudChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        hudEnabled = hudChoice;
      }

      // Claude Code flags multiselect (advanced only)
      if (process.stdin.isTTY) {
        const flagChoices = FLAG_REGISTRY.map(f => ({
          value: f.id,
          label: f.label,
          hint: f.description,
        }));
        const flagDefaults = getDefaultFlags();

        const flagSelection = await p.multiselect({
          message: 'Claude Code flags',
          options: flagChoices,
          initialValues: flagDefaults,
          required: false,
        });

        if (p.isCancel(flagSelection)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        enabledFlags = flagSelection as string[];
      }

      // .claudeignore prompt
      if (earlyGitRoot) {
        if (scope === 'user') {
          discoveredProjects = await discoverProjectGitRoots();
          p.note(
            'Scans all projects Claude has worked on and creates a\n' +
            '.claudeignore in each git repository. Excludes secrets,\n' +
            'API keys, dependencies, and build artifacts from context.',
            '.claudeignore',
          );
          if (discoveredProjects.length > 0) {
            const maxShow = 5;
            const projectLines = discoveredProjects.slice(0, maxShow).join('\n');
            const overflow = discoveredProjects.length > maxShow
              ? `\n... (${discoveredProjects.length - maxShow} more)`
              : '';
            p.note(projectLines + overflow, `Discovered ${discoveredProjects.length} projects`);
            const claudeignoreChoice = await p.confirm({
              message: `Install .claudeignore to ${discoveredProjects.length} projects? (Recommended)`,
              initialValue: true,
            });
            if (p.isCancel(claudeignoreChoice)) {
              p.cancel('Installation cancelled.');
              process.exit(0);
            }
            claudeignoreEnabled = claudeignoreChoice;
          } else {
            const claudeignoreChoice = await p.confirm({
              message: 'Create .claudeignore? (Recommended)',
              initialValue: true,
            });
            if (p.isCancel(claudeignoreChoice)) {
              p.cancel('Installation cancelled.');
              process.exit(0);
            }
            claudeignoreEnabled = claudeignoreChoice;
          }
        } else {
          p.note(
            'Creates a .claudeignore in this project that excludes\n' +
            'secrets, API keys, dependencies, and build artifacts from\n' +
            'Claude\'s context window.',
            '.claudeignore',
          );
          const claudeignoreChoice = await p.confirm({
            message: 'Create .claudeignore? (Recommended)',
            initialValue: true,
          });
          if (p.isCancel(claudeignoreChoice)) {
            p.cancel('Installation cancelled.');
            process.exit(0);
          }
          claudeignoreEnabled = claudeignoreChoice;
        }
      } else {
        claudeignoreEnabled = false;
      }

      // Safe-delete detection + prompt (advanced only)
      if (process.stdin.isTTY && profilePath && safeDeleteAvailable) {
        const trashCmd = safeDeleteInfo.command;
        safeDeleteBlock = generateSafeDeleteBlock(shell, process.platform, trashCmd);

        if (safeDeleteBlock) {
          const installedVersion = await getInstalledVersion(profilePath);
          const state = classifySafeDeleteState(installedVersion, SAFE_DELETE_BLOCK_VERSION);
          if (state === 'current') {
            safeDeleteAction = 'skip';
          } else if (state === 'outdated') {
            safeDeleteAction = 'upgrade';
          } else {
            p.note(
              'Overrides rm to use your system trash CLI instead of permanent\n' +
              'deletion. Prevents accidental data loss from rm -rf.',
              'Safe Delete',
            );
            const safeDeleteConfirm = await p.confirm({
              message: `Install safe-delete to ${profilePath}? (uses ${trashCmd ?? 'recycle bin'})`,
              initialValue: true,
            });

            if (!p.isCancel(safeDeleteConfirm) && safeDeleteConfirm) {
              safeDeleteAction = 'install';
            }
          }
        }
      }

      // Security deny list placement (user scope + TTY only)
      if (scope === 'user' && process.stdin.isTTY) {
        p.note(
          'DevFlow includes a security deny list that blocks dangerous\n' +
          'commands (rm -rf, sudo, eval, etc). It can be installed as a\n' +
          'read-only system file or in your editable settings.json.',
          'Security Deny List',
        );
        const securityChoice = await p.select({
          message: 'How should DevFlow install the deny list?',
          options: [
            { value: 'managed', label: 'Managed settings', hint: 'Recommended — read-only, cannot be overridden' },
            { value: 'user', label: 'User settings', hint: 'Editable in settings.json' },
          ],
        });

        if (p.isCancel(securityChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }

        securityMode = securityChoice as SecurityMode;
      }

      // Managed settings sudo confirmation (last interactive step)
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
            { value: 'no', label: 'No, fall back to settings.json', hint: 'Editable user settings instead' },
          ],
        });

        if (p.isCancel(sudoChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }

        managedSettingsConfirmed = sudoChoice === 'yes';
      }
    }

    // ╭──────────────────────────────────────────────────────────╮
    // │  All prompts collected — installation begins             │
    // ╰──────────────────────────────────────────────────────────╯

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
      gitRoot = paths.gitRoot ?? earlyGitRoot;
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

    // Skills: install ALL from ALL plugins (skills are tiny markdown files;
    // orchestration skills need skills from other plugins to function)
    const skillsMap = buildFullSkillsMap();
    // Agents: install only from selected plugins
    const { agentsMap } = buildAssetMaps(pluginsToInstall);

    // Migrate shadow overrides from old V2 skill names BEFORE install,
    // so the installer's shadow check finds them at the new name
    const shadowsMigrated = await migrateShadowOverrides(devflowDir);
    if (shadowsMigrated.migrated > 0) {
      p.log.info(`Migrated ${shadowsMigrated.migrated} shadow override(s) to V2 names`);
    }
    for (const warning of shadowsMigrated.warnings) {
      p.log.warn(warning);
    }

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

    // Clean up stale skills from previous installations
    s.message('Cleaning up');
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

    // Clean up legacy hook scripts (e.g., ambient-prompt → preamble)
    const LEGACY_HOOK_SCRIPTS = ['ambient-prompt'];
    const hooksDir = path.join(devflowDir, 'scripts', 'hooks');
    for (const legacy of LEGACY_HOOK_SCRIPTS) {
      const legacyPath = path.join(hooksDir, legacy);
      try { await fs.rm(legacyPath); } catch { /* doesn't exist */ }
    }

    // === Settings & hooks (all automatic based on collected choices) ===
    s.message('Configuring settings');

    // Determine effective security mode (managed settings executed later, after safe-delete)
    let effectiveSecurityMode = securityMode;
    if (securityMode === 'managed' && !managedSettingsConfirmed) {
      effectiveSecurityMode = 'user';
    }
    await installSettings(claudeDir, rootDir, devflowDir, verbose, teamsEnabled, effectiveSecurityMode);

    const settingsPath = path.join(claudeDir, 'settings.json');

    // Configure ambient hook, memory hooks, and HUD statusLine in a single read-modify-write pass
    try {
      let content = await fs.readFile(settingsPath, 'utf-8');
      const original = content;

      // Ambient hook — always remove-then-add to upgrade from legacy ambient-prompt → preamble
      const cleanedForAmbient = removeAmbientHook(content);
      content = ambientEnabled ? addAmbientHook(cleanedForAmbient, devflowDir) : cleanedForAmbient;

      // Memory hooks — always remove-then-add to upgrade hook format (e.g., .sh → run-hook)
      const cleaned = removeMemoryHooks(content);
      content = memoryEnabled ? addMemoryHooks(cleaned, devflowDir) : cleaned;

      // Learning hook — remove-then-add for upgrade safety
      const cleanedForLearn = removeLearningHook(content);
      content = learnEnabled ? addLearningHook(cleanedForLearn, devflowDir) : cleanedForLearn;

      // HUD statusLine
      content = hudEnabled
        ? addHudStatusLine(content, devflowDir)
        : removeHudStatusLine(content);

      // Claude Code flags — strip all managed keys, then re-apply selected flags
      content = stripFlags(content);
      content = applyFlags(content, enabledFlags);

      if (content !== original) {
        await fs.writeFile(settingsPath, content, 'utf-8');
        if (verbose) {
          if (ambientEnabled) p.log.success('Ambient mode hook installed');
          p.log.info(`Working memory ${memoryEnabled ? 'enabled' : 'disabled'}`);
          p.log.info(`HUD ${hudEnabled ? 'enabled' : 'disabled'}`);
        }
      }
    } catch { /* settings.json may not exist yet */ }

    // Ensure .memory/ exists when memory is enabled (hooks are no-ops without it)
    if (memoryEnabled) {
      await createMemoryDir(verbose);
      await migrateMemoryFiles(verbose);
    }

    // Configure HUD
    const existingHud = loadHudConfig();
    saveHudConfig({ enabled: hudEnabled, detail: existingHud.detail });

    // File extras
    if (claudeignoreEnabled) {
      if (scope === 'user' && discoveredProjects.length > 0) {
        const results = await Promise.all(
          discoveredProjects.map(root => installClaudeignore(root, rootDir, verbose)),
        );
        const created = results.filter(Boolean).length;
        if (created > 0) {
          p.log.success(`.claudeignore created in ${created} project(s)`);
        } else {
          p.log.info(`.claudeignore already exists in all ${discoveredProjects.length} project(s)`);
        }
      } else if (gitRoot) {
        await installClaudeignore(gitRoot, rootDir, verbose);
      }
    }
    if (scope === 'local' && gitRoot) {
      await updateGitignore(gitRoot, verbose);
    }
    if (scope === 'local') {
      await createDocsStructure(verbose);
    }

    // Safe-delete execution (decision was captured during prompt phase)
    if (safeDeleteAction === 'install' && safeDeleteBlock && profilePath) {
      await installToProfile(profilePath, safeDeleteBlock);
    } else if (safeDeleteAction === 'upgrade' && safeDeleteBlock && profilePath) {
      await removeFromProfile(profilePath);
      await installToProfile(profilePath, safeDeleteBlock);
    }

    // Managed settings (last install step — sudo may prompt for password)
    if (securityMode === 'managed' && managedSettingsConfirmed) {
      s.stop('Configuring managed settings (may prompt for sudo password)...');
      const managed = await installManagedSettings(rootDir, verbose);
      if (!managed) {
        p.log.warn('Managed settings write failed — falling back to user settings');
      }
      s.start('Finalizing installation...');
    }

    s.stop('Installation complete');

    // Check for jq (hooks degrade gracefully without it, but features are reduced)
    try {
      execSync('command -v jq', { stdio: 'ignore' });
    } catch {
      p.log.warn('jq not found — some hook features will have reduced functionality');
      p.log.info(`Install: ${color.cyan('brew install jq')}`);
    }

    // === Summary ===

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

    // Safe-delete status messages (after spinner)
    if (process.stdin.isTTY && profilePath) {
      if (safeDeleteAction === 'install') {
        p.log.success(`Safe-delete installed to ${color.dim(profilePath)}`);
        p.log.info('Restart your shell or run: ' + color.cyan(`source ${profilePath}`));
      } else if (safeDeleteAction === 'upgrade') {
        p.log.success(`Safe-delete upgraded in ${color.dim(profilePath)}`);
        p.log.info('Restart your shell or run: ' + color.cyan(`source ${profilePath}`));
      } else if (safeDeleteAvailable && safeDeleteBlock) {
        const installedVersion = await getInstalledVersion(profilePath);
        if (classifySafeDeleteState(installedVersion, SAFE_DELETE_BLOCK_VERSION) === 'current') {
          p.log.info(`Safe-delete already configured in ${color.dim(profilePath)}`);
        }
      } else if (!safeDeleteAvailable && safeDeleteInfo.installHint) {
        p.log.info(`Install ${color.cyan(safeDeleteInfo.command ?? 'trash')} first: ${color.dim(safeDeleteInfo.installHint)}`);
        p.log.info(`Then re-run ${color.cyan('devflow init')} to auto-configure safe-delete.`);
      }
    } else if (!process.stdin.isTTY) {
      if (safeDeleteAvailable && safeDeleteInfo.command) {
        p.log.info(`Safe-delete available (${safeDeleteInfo.command}). Run interactively to auto-install.`);
      } else if (safeDeleteInfo.installHint) {
        p.log.info(`Protect against accidental ${color.red('rm -rf')}: ${color.cyan(safeDeleteInfo.installHint)}`);
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
      features: { teams: teamsEnabled, ambient: ambientEnabled, memory: memoryEnabled, learn: learnEnabled, hud: hudEnabled, flags: enabledFlags },
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
