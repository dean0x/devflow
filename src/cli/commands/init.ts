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
  applyUserSecurityDenyList,
  stripUserDenyList,
  detectDenyState,
  resolveSecurityAction,
  assertHistoricalDenySuperset,
  DEVFLOW_HISTORICAL_DENY,
  loadTemplateDenyEntries,
  stripUserSecurityDenyList,
  type SecurityMode,
} from '../utils/post-install.js';
import { DEVFLOW_PLUGINS, LEGACY_PLUGIN_NAMES, LEGACY_SKILL_NAMES, LEGACY_COMMAND_NAMES, LEGACY_RULE_NAMES, buildAssetMaps, buildFullSkillsMap, buildRulesMap, partitionSelectablePlugins, WORKFLOW_ORDER, type PluginDefinition } from '../plugins.js';
import { detectPlatform, detectShell, getProfilePath, getSafeDeleteInfo, hasSafeDelete } from '../utils/safe-delete.js';
import { generateSafeDeleteBlock, installToProfile, removeFromProfile, getInstalledVersion, SAFE_DELETE_BLOCK_VERSION } from '../utils/safe-delete-install.js';
import { addAmbientHook, removeAmbientHook } from './ambient.js';
import { addMemoryHooks, removeMemoryHooks } from './memory.js';
// Settings/HookMatcher types used by hook utilities — each in their own module
import { addHudStatusLine, removeHudStatusLine } from './hud.js';
import { loadConfig as loadHudConfig, saveConfig as saveHudConfig } from '../hud/config.js';
import { readManifest, writeManifest, resolvePluginList, detectUpgrade } from '../utils/manifest.js';
import { getDefaultFlags, applyFlags, stripFlags, applyViewMode, stripViewMode, FLAG_REGISTRY, ViewMode, VIEW_MODES } from '../utils/flags.js';
import { addContextHook, removeContextHook, hasContextHook } from './context.js';
import { manageSentinel } from '../utils/sentinel.js';
import { writeFileAtomicExclusive } from '../utils/fs-atomic.js';
import { writeConfig as writeDreamConfig } from '../utils/dream-config.js';
import { getFeaturesDir, getFeaturesIndexPath, getFeaturesDisabledSentinel, getDecisionsDisabledSentinel, getPendingTurnsPath, getPendingTurnsProcessingPath } from '../utils/project-paths.js';
import * as os from 'os';

// Re-export pure functions for tests (canonical source is post-install.ts)
export { substituteSettingsTemplate, computeGitignoreAppend, mergeDenyList, discoverProjectGitRoots } from '../utils/post-install.js';
export { addAmbientHook, removeAmbientHook, hasAmbientHook } from './ambient.js';
export { addMemoryHooks, removeMemoryHooks, hasMemoryHooks } from './memory.js';
export { addHudStatusLine, removeHudStatusLine, hasHudStatusLine } from './hud.js';
// Re-export migrateShadowOverrides under its original name for backward compatibility
export { migrateShadowOverridesRegistry as migrateShadowOverrides } from '../utils/shadow-overrides-migration.js';

import { type RunMigrationsResult, type Migration, type MigrationLogger, reportMigrationResult } from '../utils/migrations.js';

export type { MigrationLogger };

/**
 * D32/D35: Orchestrates the init-level migration-runner seam.
 *
 * Computes the project list with the D37 fallback rule:
 *   1. Use discoveredProjects when non-empty.
 *   2. Fall back to [gitRoot] when discoveredProjects is empty and gitRoot is set.
 *   3. Run with no per-project targets when both are absent (global-only; per-project
 *      migrations are vacuously applied per D37 semantics).
 *
 * Must run BEFORE installViaFileCopy (D7/PF-007) so V1→V2 shadow renames are
 * complete before the installer looks for V2-named directories.
 *
 * The `runner` parameter accepts the runMigrations function — injected to make
 * this helper testable without real filesystem migration state.
 */
export async function runMigrationsWithFallback(
  discoveredProjects: string[],
  gitRoot: string | null,
  devflowDir: string,
  logger: MigrationLogger,
  verbose: boolean,
  runner: (
    ctx: { devflowDir: string },
    projects: string[],
    registry?: readonly Migration[],
  ) => Promise<RunMigrationsResult>,
): Promise<RunMigrationsResult> {
  const projectsForMigration =
    discoveredProjects.length > 0 ? discoveredProjects : (gitRoot ? [gitRoot] : []);

  const migrationResult = await runner({ devflowDir }, projectsForMigration);

  reportMigrationResult(migrationResult, logger, verbose);

  return migrationResult;
}

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

export { addContextHook, removeContextHook, hasContextHook };

/**
 * Parse a comma-separated plugin selection string into normalized plugin names.
 * Validates against known plugins; returns invalid names as errors.
 */
export function parsePluginSelection(
  input: string,
  validPlugins: PluginDefinition[],
): { selected: string[]; invalid: string[] } {
  const selected = input.split(',').map(raw => {
    const trimmed = raw.trim();
    const normalized = trimmed.startsWith('devflow-') ? trimmed : `devflow-${trimmed}`;
    return LEGACY_PLUGIN_NAMES[normalized] ?? normalized;
  });

  const validNames = validPlugins.map(pl => pl.name);
  const invalid = selected.filter(name => !validNames.includes(name));
  return { selected, invalid };
}

/**
 * Combine workflow and language selections into a single plugin list.
 * Returns the merged array and whether a valid (non-empty) selection was made.
 *
 * Pure function — no I/O, no side effects; extracted for testability.
 */
export function combineSelection(
  workflowSelected: string[],
  languageSelected: string[],
): { plugins: string[]; accepted: boolean } {
  const plugins = [...workflowSelected, ...languageSelected];
  return { plugins, accepted: plugins.length > 0 };
}

/**
 * Returns true when the selection loop should retry: selection was empty and
 * the attempt ceiling has not been reached. Returns false when accepted or
 * when attempts are exhausted (caller should exit).
 *
 * Pure function — no I/O, no side effects; extracted for testability.
 */
export function shouldRetry(attempt: number, maxAttempts: number, accepted: boolean): boolean {
  if (accepted) return false;
  return attempt < maxAttempts;
}

/**
 * Options for the init command parsed by Commander.js
 */
interface InitOptions {
  scope?: string;
  verbose?: boolean;
  plugin?: string;
  ambient?: boolean;
  memory?: boolean;
  hud?: boolean;
  knowledge?: boolean;
  decisions?: boolean;
  rules?: boolean;
  security?: SecurityMode;
  hudOnly?: boolean;
  recommended?: boolean;
  advanced?: boolean;
}

export const initCommand = new Command('init')
  .description('Initialize Devflow for Claude Code')
  .option('--scope <type>', 'Installation scope: user or local (project-only)', /^(user|local)$/i)
  .option('--verbose', 'Show detailed installation output')
  .option('--plugin <names>', 'Install specific plugin(s), comma-separated (e.g., implement,code-review)')
  .option('--ambient', 'Enable ambient mode (keyword + plan auto-detection)')
  .option('--no-ambient', 'Disable ambient mode')
  .option('--memory', 'Enable working memory (session context preservation)')
  .option('--no-memory', 'Disable working memory hooks')
  .option('--hud', 'Enable HUD (git info, context usage, session stats)')
  .option('--no-hud', 'Disable HUD status line')
  .option('--knowledge', 'Enable feature knowledge bases')
  .option('--no-knowledge', 'Disable feature knowledge bases')
  .option('--decisions', 'Enable decision/pitfall tracking')
  .option('--no-decisions', 'Disable decision/pitfall tracking')
  .option('--rules', 'Enable rules (always-on engineering principles)')
  .option('--no-rules', 'Disable rules')
  .option('--security <mode>', 'Security deny list location: user, managed, or none', /^(user|managed|none)$/i)
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
    p.intro(color.bgCyan(color.black(` Devflow v${version} `)));

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
          features: { ambient: false, memory: false, hud: true, knowledge: false, decisions: false, rules: false, flags: [] },
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
        'devflow-plan': 'gap analysis, design review',
        'devflow-implement': 'code, validate, self-review, PR',
        'devflow-code-review': 'parallel specialized reviewers',
        'devflow-resolve': 'fix review issues by risk',
        'devflow-debug': 'competing hypotheses',
        'devflow-explore': 'codebase exploration + knowledge bases',
        'devflow-research': 'multi-type research with synthesis',
        'devflow-release': 'adaptive release with learned config',
        'devflow-self-review': 'Simplifier + Scrutinizer',
        'devflow-bug-analysis': 'proactive bug finding, post-pipeline',
        'devflow-typescript': 'TypeScript patterns',
        'devflow-react': 'React patterns',
        'devflow-accessibility': 'WCAG compliance',
        'devflow-ui-design': 'typography, color, spacing',
        'devflow-go': 'Go patterns',
        'devflow-java': 'Java patterns',
        'devflow-python': 'Python patterns',
        'devflow-rust': 'Rust patterns',
      };

      const { workflow, language } = partitionSelectablePlugins(DEVFLOW_PLUGINS);

      const toChoice = (pl: PluginDefinition) => ({
        value: pl.name,
        label: pl.name.replace('devflow-', ''),
        hint: pluginHints[pl.name] ?? pl.description,
      });

      const workflowChoices = workflow.map(toChoice);
      const languageChoices = language.map(toChoice);

      const workflowInitialValues = workflow
        .filter(pl => !pl.optional)
        .map(pl => pl.name);

      // Bounded selection loop — max 3 attempts (reliability rule: no unbounded loops)
      const MAX_ATTEMPTS = 3;
      let attempts = 0;

      while (attempts < MAX_ATTEMPTS) {
        attempts++;

        // Step 1 — Workflow plugins (skip if empty bucket)
        let workflowSelected: string[] = [];
        if (workflowChoices.length > 0) {
          const step1 = await p.multiselect({
            message: 'Step 1 — Workflow plugins',
            options: workflowChoices,
            initialValues: workflowInitialValues,
            required: false,
          });
          if (p.isCancel(step1)) {
            p.cancel('Installation cancelled.');
            process.exit(0);
          }
          workflowSelected = step1;
        }

        // Step 2 — Language plugins (skip if empty bucket)
        let languageSelected: string[] = [];
        if (languageChoices.length > 0) {
          const step2 = await p.multiselect({
            message: 'Step 2 — Language plugins',
            options: languageChoices,
            required: false,
          });
          if (p.isCancel(step2)) {
            p.cancel('Installation cancelled.');
            process.exit(0);
          }
          languageSelected = step2;
        }

        const { plugins: combined, accepted } = combineSelection(workflowSelected, languageSelected);

        if (accepted) {
          selectedPlugins = combined;
          break;
        }

        if (!shouldRetry(attempts, MAX_ATTEMPTS, accepted)) {
          p.cancel('Installation cancelled — no plugins selected.');
          process.exit(0);
        }
        p.log.warn('Select at least one plugin.');
      }
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
    let ambientEnabled = true;
    let memoryEnabled = true;
    let hudEnabled = true;
    let knowledgeEnabled = true;
    let decisionsEnabled = true;
    let rulesEnabled = true;
    let enabledFlags = getDefaultFlags();
    let viewMode: ViewMode = 'default';
    let claudeignoreEnabled = !!earlyGitRoot;
    let discoveredProjects: string[] = [];
    let safeDeleteAction: 'install' | 'upgrade' | 'skip' = 'skip';
    let safeDeleteBlock: string | null = null;
    // Security mode is resolved from flag + manifest + detected reality via resolveSecurityAction.
    // The final value is written to the manifest and consumed by the dedicated security step.
    let securityMode: SecurityMode = 'user'; // placeholder; overwritten below by resolve
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
      if (options.ambient !== undefined) ambientEnabled = options.ambient;
      if (options.memory !== undefined) memoryEnabled = options.memory;
      if (options.hud !== undefined) hudEnabled = options.hud;
      if (options.knowledge !== undefined) knowledgeEnabled = options.knowledge;
      if (options.decisions !== undefined) decisionsEnabled = options.decisions;
      if (options.rules !== undefined) rulesEnabled = options.rules;

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
        `Decisions:       ${decisionsEnabled ? 'enabled' : 'disabled'}`,
        `Rules:           ${rulesEnabled ? 'enabled' : 'disabled'}`,
        `HUD:             ${hudEnabled ? 'enabled' : 'disabled'}`,
        `Knowledge bases: ${knowledgeEnabled ? 'enabled' : 'disabled'}`,
        `View mode:       ${viewMode}`,
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
        p.log.error('--advanced requires an interactive terminal. Use --recommended or pass explicit flags (e.g., --no-ambient).');
        process.exit(1);
      }

      if (options.ambient !== undefined) {
        ambientEnabled = options.ambient;
      } else {
        p.note(
          'Detects workflow intent in your prompt and runs it automatically.\n' +
          'Start a prompt with implement, explore, research, debug, or plan\n' +
          '(or paste a structured plan) and the matching workflow runs —\n' +
          'no slash command needed.\n\n' +
          'Zero overhead for normal prompts.',
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

      if (options.knowledge !== undefined) {
        knowledgeEnabled = options.knowledge;
      } else {
        p.note(
          'Per-feature knowledge bases capture cross-cutting patterns,\n' +
          'conventions, and gotchas. Auto-refreshed when files change.\n' +
          'Consumes a background agent session on staleness detection.',
          'Feature Knowledge Bases',
        );
        const knowledgeChoice = await p.confirm({
          message: 'Enable feature knowledge bases? (Recommended)',
          initialValue: true,
        });
        if (p.isCancel(knowledgeChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        knowledgeEnabled = knowledgeChoice;
      }

      if (options.decisions !== undefined) {
        decisionsEnabled = options.decisions;
      } else {
        p.note(
          'Detects architectural decisions and pitfalls from your session\n' +
          'dialogs. Runs a background agent on session stop that consumes\n' +
          'additional tokens.',
          'Decision/Pitfall Tracking',
        );
        const decisionsChoice = await p.confirm({
          message: 'Enable decision/pitfall tracking? (Recommended)',
          initialValue: true,
        });
        if (p.isCancel(decisionsChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        decisionsEnabled = decisionsChoice;
      }

      if (options.rules !== undefined) {
        rulesEnabled = options.rules;
      } else {
        p.note(
          'Rules are ultra-condensed engineering principles (~10-15 lines each).\n' +
          'They only load when you edit or generate code in a matching language —\n' +
          'e.g., TypeScript rules activate for .ts files, Go rules for .go files.\n' +
          'Not loaded all at once; minimal token cost.',
          'Rules',
        );
        const rulesChoice = await p.confirm({
          message: 'Enable rules? (Recommended)',
          initialValue: true,
        });
        if (p.isCancel(rulesChoice)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        rulesEnabled = rulesChoice;
      }

      // Claude Code flags multiselect (advanced only)
      const recommended = FLAG_REGISTRY.filter(f => f.defaultEnabled);
      const optional = FLAG_REGISTRY.filter(f => !f.defaultEnabled);
      const flagChoices = [
        ...recommended.map(f => ({
          value: f.id,
          label: f.label,
          hint: `${f.hint} · recommended`,
        })),
        { value: '_separator', label: color.dim('── Optional (skip if unsure) ──'), hint: '' },
        ...optional.map(f => ({
          value: f.id,
          label: f.label,
          hint: f.hint,
        })),
      ];
      const flagDefaults = getDefaultFlags();

      p.note(
        'Recommended flags are pre-selected. Optional flags are for\n' +
        'advanced users — if you don\'t recognize one, skip it.',
        'Claude Code Flags',
      );

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
      enabledFlags = (flagSelection as string[]).filter(id => id !== '_separator');

      // View mode selector (advanced only)
      p.note(
        'Controls how much detail Claude Code shows in the transcript.\n' +
        '• default — normal display with expandable tool output\n' +
        '• verbose — shows everything including thinking blocks\n' +
        '• focus — minimal: prompt, one-line tool summaries, final response',
        'View Mode',
      );
      const viewModeChoice = await p.select({
        message: 'View mode',
        options: [
          { value: 'default', label: 'Default', hint: 'expandable tool output · recommended' },
          { value: 'verbose', label: 'Verbose', hint: 'shows everything including thinking' },
          { value: 'focus', label: 'Focus', hint: 'minimal output, one-line summaries' },
        ],
        initialValue: 'default',
      });
      if (p.isCancel(viewModeChoice)) {
        p.cancel('Installation cancelled.');
        process.exit(0);
      }
      viewMode = viewModeChoice as 'default' | 'verbose' | 'focus';

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
          'Devflow includes a security deny list that blocks dangerous\n' +
          'commands (rm -rf, sudo, eval, etc). It can be installed as a\n' +
          'read-only system file or in your editable settings.json.',
          'Security Deny List',
        );
        const securityChoice = await p.select({
          message: 'How should Devflow install the deny list?',
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
          '  "I\'m installing Devflow and it wants to write a\n' +
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

    // Detect current deny list state in user settings (read-only; write happens in security step)
    {
      const userSettingsPath = path.join(claudeDir, 'settings.json');
      let userSettingsJson: string | null = null;
      try { userSettingsJson = await fs.readFile(userSettingsPath, 'utf-8'); } catch { /* absent */ }

      let managedExists = false;
      let managedContentJson: string | null = null;
      try {
        const { getManagedSettingsPath: getMgdPath } = await import('../utils/paths.js');
        const mgdPath = getMgdPath();
        managedContentJson = await fs.readFile(mgdPath, 'utf-8');
        managedExists = true;
      } catch { /* absent or unsupported platform */ }

      const detected = detectDenyState(userSettingsJson, managedExists, managedContentJson);

      const flagValue = options.security as SecurityMode | undefined;
      const manifestMode = existingManifest?.features.security as SecurityMode | undefined;
      const resolution = resolveSecurityAction(flagValue, manifestMode, detected, process.stdin.isTTY);

      if (resolution.warn) {
        p.log.warn(resolution.warn);
      }

      // In TTY + CONFLICT, prompt the user (the pure fn returned prompt descriptor)
      if (resolution.prompt && process.stdin.isTTY) {
        // Default: keep detected reality (the safe choice — don't remove protection silently)
        const keep = await p.confirm({ message: resolution.prompt, initialValue: true });
        if (p.isCancel(keep)) {
          p.cancel('Installation cancelled.');
          process.exit(0);
        }
        // If user declines to keep, switch to the manifest mode
        if (!keep && manifestMode !== undefined) {
          securityMode = manifestMode === 'none' ? 'none' : manifestMode as SecurityMode;
        } else {
          securityMode = resolution.target === 'none' ? 'none' : resolution.target;
        }
      } else {
        securityMode = resolution.target === 'none' ? 'none' : resolution.target;
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
    // commands need skills from other plugins to function)
    const skillsMap = buildFullSkillsMap();
    // Agents: install only from selected plugins
    const { agentsMap } = buildAssetMaps(pluginsToInstall);
    // Rules: install only from selected plugins (plugin-scoped, not universal)
    const rulesMap = rulesEnabled ? buildRulesMap(pluginsToInstall) : new Map<string, string>();

    // D32/D35: Apply one-time migrations (global + per-project) tracked at ~/.devflow/migrations.json.
    // Runs BEFORE installViaFileCopy so V1→V2 shadow renames are complete before the
    // installer looks for V2-named directories. Migrations are always-run-unapplied:
    // helpers short-circuit when the target data is absent, so fresh installs are safe
    // no-ops. State lives at the home-dir ~/.devflow location regardless of install
    // scope (D30).
    {
      const { runMigrations } = await import('../utils/migrations.js');
      const userDevflowDir = path.join(os.homedir(), '.devflow');
      await runMigrationsWithFallback(
        discoveredProjects,
        gitRoot,
        userDevflowDir,
        { warn: p.log.warn, info: p.log.info, success: p.log.success },
        verbose,
        runMigrations,
      );
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
          rulesMap,
          isPartialInstall: !!options.plugin,
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
    const skillRemoveResults = await Promise.allSettled(
      LEGACY_SKILL_NAMES.map(legacy =>
        fs.rm(path.join(skillsDir, legacy), { recursive: true })
      )
    );
    const staleRemoved = skillRemoveResults.filter(r => r.status === 'fulfilled').length;
    if (staleRemoved > 0 && verbose) {
      p.log.info(`Cleaned up ${staleRemoved} legacy skill(s)`);
    }

    // Clean up stale commands from previous installations (e.g., /review → /code-review)
    const commandsDir = path.join(claudeDir, 'commands', 'devflow');
    let staleCommandsRemoved = 0;
    for (const legacy of LEGACY_COMMAND_NAMES) {
      for (const suffix of ['.md']) {
        const legacyPath = path.join(commandsDir, `${legacy}${suffix}`);
        try {
          await fs.rm(legacyPath);
          staleCommandsRemoved++;
        } catch {
          // Doesn't exist — expected for most entries
        }
      }
    }
    // Sweep orphaned *-teams.md workflow command variants left by the Agent Teams
    // refactor. None are ever re-installed, so a blanket sweep is safe on any
    // install type (the full-install dir wipe only covers full installs). (PF-009)
    try {
      for (const f of await fs.readdir(commandsDir)) {
        if (f.endsWith('-teams.md')) {
          try { await fs.rm(path.join(commandsDir, f)); staleCommandsRemoved++; }
          catch { /* already gone */ }
        }
      }
    } catch { /* commands dir absent — nothing to sweep */ }
    if (staleCommandsRemoved > 0 && verbose) {
      p.log.info(`Cleaned up ${staleCommandsRemoved} legacy command(s)`);
    }

    // Clean up stale rules from previous installations
    const rulesDir = path.join(claudeDir, 'rules', 'devflow');
    let staleRulesRemoved = 0;
    for (const legacy of LEGACY_RULE_NAMES) {
      const legacyPath = path.join(rulesDir, `${legacy}.md`);
      try {
        await fs.rm(legacyPath);
        staleRulesRemoved++;
      } catch {
        // Doesn't exist — expected for most entries
      }
    }
    if (staleRulesRemoved > 0 && verbose) {
      p.log.info(`Cleaned up ${staleRulesRemoved} legacy rule(s)`);
    }

    // Disable rules directory if rules not enabled
    if (!rulesEnabled) {
      try {
        await fs.rm(path.join(claudeDir, 'rules', 'devflow'), { recursive: true, force: true });
      } catch { /* ignore */ }
    }

    // Clean up legacy hook scripts and lib files (paths relative to hooksDir)
    const LEGACY_HOOK_FILES = [
      'ambient-prompt',
      // Ambient simplification: session-start-classification removed (plan detection + commands rule)
      'session-start-classification',
      // kb → knowledge rename: hook scripts replaced by session-end-knowledge-refresh / background-knowledge-refresh
      'session-end-kb-refresh',
      'background-kb-refresh',
      // kb → knowledge rename: CJS module replaced by feature-knowledge.cjs
      'lib/feature-kb.cjs',
      // decisions agent decoupling: background-learning replaced by TypeScript CLI (devflow learn --run-background)
      'background-learning',
      // Pre-sidecar hooks replaced by the dream hooks (dream-capture/dispatch/evaluate)
      'prompt-capture-memory',
      'stop-update-memory',
      'stop-update-learning',
      'session-end-learning',
      'session-end-decisions',
      'session-end-knowledge-refresh',
      'background-knowledge-refresh',
      // Learning pipeline removed: eval-learning/eval-reinforce no longer sourced by dream-evaluate
      'eval-learning',
      'eval-reinforce',
    ];
    const hooksDir = path.join(devflowDir, 'scripts', 'hooks');
    for (const legacy of LEGACY_HOOK_FILES) {
      const legacyPath = path.join(hooksDir, legacy);
      try { await fs.rm(legacyPath); } catch { /* doesn't exist */ }
    }

    // === Settings & hooks (all automatic based on collected choices) ===
    s.message('Configuring settings');

    await installSettings(claudeDir, rootDir, devflowDir, verbose);

    const settingsPath = path.join(claudeDir, 'settings.json');

    // Configure ambient hook, memory hooks, and HUD statusLine in a single read-modify-write pass
    try {
      let content = await fs.readFile(settingsPath, 'utf-8');
      const original = content;

      // Ambient hook — always remove-then-add to upgrade from legacy ambient-prompt → preamble
      const cleanedForAmbient = await removeAmbientHook(content);
      content = ambientEnabled ? await addAmbientHook(cleanedForAmbient, devflowDir) : cleanedForAmbient;

      // Memory hooks — always remove-then-add to upgrade hook format (e.g., .sh → run-hook)
      // Memory hooks include the unified dream hooks (dream-dispatch, dream-capture,
      // dream-evaluate) which handle memory, decisions, and knowledge in the background.
      const cleaned = removeMemoryHooks(content);
      content = memoryEnabled ? addMemoryHooks(cleaned, devflowDir) : cleaned;

      // HUD statusLine
      content = hudEnabled
        ? addHudStatusLine(content, devflowDir)
        : removeHudStatusLine(content);

      // Context hook — always-on, remove-then-add for upgrade safety
      const cleanedForContext = removeContextHook(content);
      content = addContextHook(cleanedForContext, devflowDir);

      // Claude Code flags — strip all managed keys, then re-apply selected flags
      content = stripFlags(content);
      content = applyFlags(content, enabledFlags);

      // Preserve existing viewMode before stripping (user may have set it via /focus or settings.json)
      try {
        const parsed: unknown = JSON.parse(content);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const existing = (parsed as Record<string, unknown>).viewMode;
          if (VIEW_MODES.includes(existing as ViewMode) && existing !== 'default') {
            viewMode = existing as ViewMode;
          }
        }
      } catch { /* malformed settings.json — keep default */ }

      // View mode — strip then apply for upgrade safety
      content = stripViewMode(content);
      content = applyViewMode(content, viewMode);

      if (content !== original) {
        await fs.writeFile(settingsPath, content, 'utf-8');
        if (verbose) {
          if (ambientEnabled) p.log.success('Ambient mode hook installed');
          p.log.info(`Working memory ${memoryEnabled ? 'enabled' : 'disabled'}`);
          p.log.info(`HUD ${hudEnabled ? 'enabled' : 'disabled'}`);
        }
      }
    } catch { /* settings.json may not exist yet */ }


    // Create .devflow/features/ directory with empty index (feature knowledge bases)
    // .devflow/features/ is committed to the project repo (not scope-dependent)
    if (gitRoot && knowledgeEnabled) {
      const featuresDir = getFeaturesDir(gitRoot);
      await fs.mkdir(featuresDir, { recursive: true });
      const featuresIndexPath = getFeaturesIndexPath(gitRoot);
      try {
        await fs.access(featuresIndexPath);
      } catch {
        await fs.writeFile(featuresIndexPath, JSON.stringify({ version: 1, features: {} }, null, 2) + '\n');
        if (verbose) {
          p.log.success('.devflow/features/index.json created');
        }
      }
    }

    // Manage runtime-disable sentinels for session-start-context gating
    if (gitRoot) {
      await manageSentinel(getFeaturesDisabledSentinel(gitRoot), knowledgeEnabled);
      await manageSentinel(getDecisionsDisabledSentinel(gitRoot), decisionsEnabled);
    }

    // Write dream config.json to manage per-feature enable/disable at runtime.
    // Uses writeConfig (full atomic write) rather than four updateFeature calls because
    // init always sets all four features at once and is never concurrent with toggle
    // commands — it is a one-time setup action. See D1 in dream-config.ts for the
    // concurrency assumption shared by both write strategies.
    if (gitRoot) {
      // autoCommit: preserve existing value (if set by user), default ON for new installs.
      // We read the current config to avoid clobbering a user-set autoCommit=false.
      const { readConfig: readDreamConfig } = await import('../utils/dream-config.js');
      const existingDreamConfig = await readDreamConfig(gitRoot);
      await writeDreamConfig(gitRoot, {
        memory: memoryEnabled,
        decisions: decisionsEnabled,
        knowledge: knowledgeEnabled,
        autoCommit: existingDreamConfig.autoCommit,
      });

      // Drain orphaned queue files when memory is disabled so stale turns
      // don't process on a future re-enable. Mirrors memory.ts --disable drain.
      if (!memoryEnabled) {
        await Promise.all([
          fs.unlink(getPendingTurnsPath(gitRoot)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }),
          fs.unlink(getPendingTurnsProcessingPath(gitRoot)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }),
        ]);
      }
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

    // ── Dedicated security step (always targets ~/.claude/settings.json for user mode) ──
    // Runs AFTER managed-install so effective mode is known.
    // Reads the current template deny list, asserts historical superset at install time.
    {
      const userSettingsPath = path.join(claudeDir, 'settings.json');

      // Use canonical loadTemplateDenyEntries (avoids duplicating parse logic here).
      const templateDeny = await loadTemplateDenyEntries(rootDir);
      if (templateDeny.length > 0) {
        // Catch any drift where a new template entry was not added to DEVFLOW_HISTORICAL_DENY
        try { assertHistoricalDenySuperset(templateDeny); } catch (e) {
          p.log.warn(`Security template drift: ${e instanceof Error ? e.message : e}`);
        }
      } else if (verbose) {
        p.log.warn('Could not read managed-settings template; deny list unchanged');
      }

      if (securityMode === 'managed') {
        if (managedSettingsConfirmed) {
          // Managed path: attempt sudo write, fall back to user on failure
          s.stop('Configuring managed settings (may prompt for sudo password)...');
          const managed = await installManagedSettings(rootDir, verbose);
          if (!managed) {
            // Real fallback: actually write to user settings (not just a warning)
            p.log.warn('Managed settings write failed — deny list written to user settings instead');
            try {
              await applyUserSecurityDenyList(userSettingsPath, templateDeny);
              securityMode = 'user'; // update so manifest reflects reality
              if (verbose) p.log.success('Security deny list written to ~/.claude/settings.json (fallback)');
            } catch (e) {
              p.log.warn(`Could not write deny list to user settings either: ${e instanceof Error ? e.message : e}`);
            }
          } else {
            // Managed write succeeded — strip from user settings to avoid duplication.
            // Uses the canonical helper (atomic temp+rename; ENOENT-safe; only-write-if-changed).
            const stripResult = await stripUserSecurityDenyList(userSettingsPath);
            if (stripResult && verbose) p.log.info('Removed deny list from user settings (now in managed settings)');
          }
          s.start('Finalizing installation...');
        } else {
          // applies ADR-010: user declined sudo and chose the settings.json fallback.
          // securityMode is 'managed' (from resolveSecurityAction or interactive choice) but
          // managedSettingsConfirmed is false — honor the "fall back to settings.json" label
          // by writing to user settings. Manifest will record 'user' to match reality.
          if (templateDeny.length > 0) {
            try {
              await applyUserSecurityDenyList(userSettingsPath, templateDeny);
              securityMode = 'user'; // manifest must reflect where the deny list actually landed
              if (verbose) p.log.success('Security deny list written to ~/.claude/settings.json (declined managed)');
            } catch (e) {
              p.log.warn(`Could not write deny list to user settings: ${e instanceof Error ? e.message : e}`);
            }
          }
        }
      } else if (securityMode === 'user') {
        // User mode (default): merge deny list into ~/.claude/settings.json
        if (templateDeny.length > 0) {
          try {
            await applyUserSecurityDenyList(userSettingsPath, templateDeny);
            if (verbose) p.log.success('Security deny list applied to ~/.claude/settings.json');
          } catch (e) {
            if (verbose) p.log.warn(`Could not apply security deny list: ${e instanceof Error ? e.message : e}`);
          }
        }
      } else if (securityMode === 'none') {
        // None: strip Devflow deny entries from user settings.
        // Uses the canonical helper (atomic temp+rename; ENOENT-safe; only-write-if-changed).
        const stripResult = await stripUserSecurityDenyList(userSettingsPath);
        if (stripResult && verbose) p.log.info(`Security deny list removed (${stripResult.removed.length} entries stripped)`);
      } else {
        // Exhaustive guard — if TypeScript reaches here, a new SecurityMode variant was added
        // without a matching branch. avoids PF-009 (stale references after rename/refactor).
        const _exhaustive: never = securityMode;
        void _exhaustive;
      }
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

    const installedSet = new Set(pluginsToInstall.flatMap(p => p.commands).filter(c => c.length > 0));
    const orderedCommands = WORKFLOW_ORDER.filter(cmd => installedSet.has(cmd));
    if (orderedCommands.length > 0) {
      const commandsNote = orderedCommands
        .map(cmd => color.cyan(cmd))
        .join('\n');
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
      p.log.info(`Devflow dir: ${devflowDir}`);

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
      features: { ambient: ambientEnabled, memory: memoryEnabled, hud: hudEnabled, knowledge: knowledgeEnabled, decisions: decisionsEnabled, rules: rulesEnabled, flags: enabledFlags, viewMode, security: securityMode },
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
