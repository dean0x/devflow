import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths, getClaudeDirectory, getManagedSettingsPath } from '../../targets/claude-code/claude-paths.js';
import { getGitRoot } from '../../core/git.js';
import { DEVFLOW_PLUGINS, getAllSkillNames, parsePluginSelection, prefixSkillName, type PluginDefinition } from '../../core/plugins.js';
import { LEGACY_SKILL_NAMES } from '../../targets/claude-code/legacy.js';
import { removeAmbientHook } from './ambient.js';
import { removeMemoryHooks } from './memory.js';
import { removeCaptureHooks } from './capture.js';
import { removeDreamHook } from './legacy-hooks.js';
import { removeHudStatusLine } from './hud.js';
import { removeContextHook } from './context.js';
import { detectShell, getProfilePath } from '../../core/safe-delete.js';
import { isAlreadyInstalled, removeFromProfile } from '../../core/safe-delete-install.js';
import { removeManagedSettings, stripUserDenyList, detectDenyState, DEVFLOW_HISTORICAL_DENY } from '../../targets/claude-code/post-install.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { stripFlags, stripViewMode } from '../../core/flags.js';
import { stripDevflowTeammateModeFromJson } from '../../core/teammate-mode-cleanup.js';
import { getPackageRoot } from '../../core/paths.js';

/**
 * Compute which assets should be removed during selective plugin uninstall.
 * Skills and agents shared by remaining plugins are retained.
 * Rules shared by remaining plugins are also retained.
 */
export function computeAssetsToRemove(
  selectedPlugins: PluginDefinition[],
  allPlugins: PluginDefinition[],
): { skills: string[]; agents: string[]; commands: string[]; rules: string[] } {
  const selectedNames = new Set(selectedPlugins.map(p => p.name));
  const remainingPlugins = allPlugins.filter(p => !selectedNames.has(p.name));

  const retainedSkills = new Set<string>();
  const retainedAgents = new Set<string>();
  const retainedRules = new Set<string>();
  for (const rp of remainingPlugins) {
    for (const s of rp.skills) retainedSkills.add(s);
    for (const a of rp.agents) retainedAgents.add(a);
    for (const r of rp.rules) retainedRules.add(r);
  }

  const skills: string[] = [];
  const agents: string[] = [];
  const commands: string[] = [];
  const rules: string[] = [];

  for (const plugin of selectedPlugins) {
    for (const skill of plugin.skills) {
      if (!retainedSkills.has(skill)) skills.push(skill);
    }
    for (const agent of plugin.agents) {
      if (!retainedAgents.has(agent)) agents.push(agent);
    }
    for (const rule of plugin.rules) {
      if (!retainedRules.has(rule)) rules.push(rule);
    }
    commands.push(...plugin.commands);
  }

  return { skills, agents, commands, rules };
}

/**
 * Format a dry-run plan showing what would be removed.
 * Pure function — no I/O, fully testable.
 */
export function formatDryRunPlan(
  assets: { skills: string[]; agents: string[]; commands: string[]; rules?: string[] },
  extras?: string[],
): string {
  const skills = [...new Set(assets.skills)];
  const agents = [...new Set(assets.agents)];
  const commands = [...new Set(assets.commands)];
  const rules = [...new Set(assets.rules ?? [])];
  const hasAssets = skills.length > 0 || agents.length > 0 || commands.length > 0 || rules.length > 0;
  const hasExtras = extras && extras.length > 0;

  if (!hasAssets && !hasExtras) {
    return 'Nothing to remove.';
  }

  const lines: string[] = [];
  if (skills.length > 0) lines.push(`Skills (${skills.length}): ${skills.join(', ')}`);
  if (agents.length > 0) lines.push(`Agents (${agents.length}): ${agents.join(', ')}`);
  if (commands.length > 0) lines.push(`Commands (${commands.length}): ${commands.join(', ')}`);
  if (rules.length > 0) lines.push(`Rules (${rules.length}): ${rules.join(', ')}`);
  if (hasExtras) lines.push(`Extras: ${extras.join(', ')}`);

  return lines.join('\n');
}

/**
 * Determine whether the security deny list should prompt for removal in an
 * interactive session, and what the non-interactive default is.
 *
 * PURE — no I/O, fully testable.
 *
 * Safety invariant: non-interactive mode NEVER removes the deny list
 * (protective-by-default).  `keepDocs` suppresses the entire section.
 *
 * Returns:
 *   - "skip"    — nothing present, or keepDocs is set; no action needed
 *   - "preserve"  — non-interactive (isTTY=false); deny list preserved
 *   - "prompt"  — interactive (isTTY=true); caller should ask the user
 *
 * @D1 Non-interactive-preserve invariant: when isTTY is false the result is
 * always "preserve", never "prompt" — avoids PF-004 half-applied-state hazard.
 */
export function resolveSecurityRemovalDecision(opts: {
  anySecurityPresent: boolean;
  keepDocs: boolean;
  isTTY: boolean;
}): 'skip' | 'preserve' | 'prompt' {
  if (!opts.anySecurityPresent || opts.keepDocs) return 'skip';
  if (!opts.isTTY) return 'preserve';
  return 'prompt';
}

/**
 * Determine the appropriate cleanup action for the user-scope devflow directory on
 * full uninstall. Mirrors the resolveSecurityRemovalDecision pattern.
 *
 * PURE — no I/O, no side effects, fully testable. All decision logic lives here;
 * the .action() caller performs I/O and prompt rendering only.
 *
 * Safety invariants checked as preconditions (guard fires → 'artifacts-only'):
 *   1. basename(devflowDir) must be '.devflow'
 *   2. devflowDir must not equal homeDir
 *   3. devflowDir must not be the filesystem root '/'
 *   4. devflowDir must reside inside $HOME (guards DEVFLOW_DIR env overrides)
 *
 * Returns:
 *   - 'artifacts-only' — remove only manifest.json; leave the directory intact
 *   - 'prompt'         — interactive session with user-authored content; caller should ask
 *
 * @D5 Precondition guard: any anomalous devflowDir falls back to 'artifacts-only' rather
 * than throwing — business logic must not throw (engineering rule). The explicit guard
 * makes the invariant present in production code, not only in tests (reliability rule).
 * @D6 avoids PF-014: the caller must NOT process.exit() after a cancel/decline response;
 * removeAllDevFlow has already run by the time the prompt fires, so removeDevFlowInstallArtifacts
 * must execute on every non-confirm path to leave a clean end-state (applies ADR-003).
 */
export function resolveDevflowDirCleanup(opts: {
  scope: 'user' | 'local';
  isTTY: boolean;
  userContent: string[];
  devflowDir: string;
  homeDir: string;
}): 'artifacts-only' | 'prompt' {
  // Local scope never removes project data — only install artifacts.
  if (opts.scope !== 'user') return 'artifacts-only';

  // Precondition guard: devflowDir must be a well-known, safe-to-rm path.
  // Any anomalous value (DEVFLOW_DIR override, bare homedir, filesystem root)
  // resolves to artifacts-only — never throw in business logic (engineering rule).
  const isBasenameValid = path.basename(opts.devflowDir) === '.devflow';
  const isNotHomeDir = opts.devflowDir !== opts.homeDir;
  const isNotRoot = opts.devflowDir !== '/';
  const isInsideHome = opts.devflowDir.startsWith(opts.homeDir + path.sep);
  if (!isBasenameValid || !isNotHomeDir || !isNotRoot || !isInsideHome) {
    return 'artifacts-only';
  }

  // Non-interactive: never prompt for or perform full-dir removal.
  if (!opts.isTTY) return 'artifacts-only';

  // No user-authored content: nothing to warn about; artifacts-only without prompting.
  if (opts.userContent.length === 0) return 'artifacts-only';

  return 'prompt';
}

/**
 * Enumerate user-authored content in devflowDir that would be deleted by a
 * full cleanup of the directory.
 *
 * Checks for items that exist on disk and are worth backing up:
 *   devflowDir/skills/   — skill shadow overrides (user-maintained)
 *   devflowDir/rules/    — rule shadow overrides (user-maintained)
 *   devflowDir/preference-profile.md — dynamic-plan preference profile
 *   devflowDir/learning.json         — global learning agent tuning config
 *
 * Returns labels for each item that actually exists. Empty array means nothing
 * user-authored is present in the directory.
 *
 * Pure I/O — no side effects, no output, fully testable.
 *
 * @D4 Called BEFORE any removal so shadow state is captured from real disk.
 * Avoids the anti-pattern of checking existence after files are removed.
 */
export async function enumerateUserDevFlowContent(devflowDir: string): Promise<string[]> {
  const items: string[] = [];

  // Skill shadow overrides (~/.devflow/skills/{name}/)
  try {
    const entries = await fs.readdir(path.join(devflowDir, 'skills'));
    if (entries.length > 0) {
      items.push(`skill shadows (${path.join(devflowDir, 'skills')})`);
    }
  } catch { /* dir absent or unreadable */ }

  // Rule shadow overrides (~/.devflow/rules/{name}.md)
  try {
    const entries = await fs.readdir(path.join(devflowDir, 'rules'));
    if (entries.length > 0) {
      items.push(`rule shadows (${path.join(devflowDir, 'rules')})`);
    }
  } catch { /* dir absent or unreadable */ }

  // preference-profile.md — user-curated decision-preference profile
  try {
    await fs.access(path.join(devflowDir, 'preference-profile.md'));
    items.push('preference-profile.md');
  } catch { /* absent */ }

  // learning.json — global learning agent tuning config
  try {
    await fs.access(path.join(devflowDir, 'learning.json'));
    items.push('learning.json');
  } catch { /* absent */ }

  return items;
}

/**
 * Remove only Devflow install artifacts from devflowDir: manifest.json.
 * The scripts/ directory is already removed by removeAllDevFlow; this handles
 * the remaining install state so the manifest does not outlive the assets.
 *
 * Used for:
 *   - Local scope (always — never removes project data under .devflow/)
 *   - User scope when full-dir confirm is declined or session is non-interactive
 */
async function removeDevFlowInstallArtifacts(devflowDir: string, verbose: boolean): Promise<void> {
  const manifestPath = path.join(devflowDir, 'manifest.json');
  try {
    await fs.rm(manifestPath, { force: true });
    if (verbose) {
      p.log.success('Removed manifest.json');
    }
  } catch (error) {
    p.log.warn(`Could not remove manifest.json: ${error}`);
  }
}

/**
 * Check if Devflow is installed at the given paths
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
  .description('Uninstall Devflow from Claude Code')
  .option('--keep-docs', 'Keep .devflow/ directory and project data')
  .option('--scope <type>', 'Uninstall from specific scope only (default: auto-detect all)', /^(user|local)$/i)
  .option('--plugin <names>', 'Uninstall specific plugin(s), comma-separated (e.g., implement,code-review)')
  .option('--verbose', 'Show detailed uninstall output')
  .option('--dry-run', 'Show what would be removed without actually removing anything')
  .action(async (options) => {
    const dryRun = options.dryRun ?? false;

    p.intro(color.bgRed(color.white(dryRun ? ' Devflow Uninstall (dry run) ' : ' Uninstalling Devflow ')));

    const verbose = options.verbose ?? false;

    // Parse plugin selection
    let selectedPluginNames: string[] = [];
    if (options.plugin) {
      const { selected, invalid } = parsePluginSelection(options.plugin, DEVFLOW_PLUGINS);
      selectedPluginNames = selected;
      if (invalid.length > 0) {
        p.log.error(`Unknown plugin(s): ${invalid.join(', ')}`);
        p.log.info(`Valid plugins: ${DEVFLOW_PLUGINS.map(pl => pl.name).join(', ')}`);
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
        p.log.error('No Devflow installation found');
        p.log.info('Checked user scope (~/.claude/) and local scope (git-root/.claude/)');
        process.exit(1);
      }

      if (scopesToUninstall.length > 1 && !dryRun) {
        if (process.stdin.isTTY) {
          const scopeChoice = await p.select({
            message: 'Found Devflow in multiple scopes. Uninstall from:',
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

    // === DRY RUN: show plan and exit ===
    if (dryRun) {
      p.log.info(`Scope(s): ${scopesToUninstall.join(', ')} (dry-run shows all detected scopes)`);

      const assets = isSelectiveUninstall
        ? computeAssetsToRemove(selectedPlugins, DEVFLOW_PLUGINS)
        : computeAssetsToRemove(DEVFLOW_PLUGINS, DEVFLOW_PLUGINS);

      // Detect extras that would be cleaned up (full uninstall only)
      const extras: string[] = [];
      if (!isSelectiveUninstall) {
        const devflowDataDir = path.join(process.cwd(), '.devflow');
        try { await fs.access(devflowDataDir); extras.push('.devflow/'); } catch { /* noop */ }
        extras.push('hooks in settings.json', 'scripts in ~/.devflow/');
      }

      const plan = formatDryRunPlan(assets, extras.length > 0 ? extras : undefined);
      for (const line of plan.split('\n')) {
        p.log.info(line);
      }

      p.outro(color.dim('No changes made (dry run)'));
      return;
    }

    // Uninstall from each scope
    for (const scope of scopesToUninstall) {
      let claudeDir: string;
      let devflowScriptsDir: string;
      let devflowDir: string;

      try {
        const paths = await getInstallationPaths(scope);
        claudeDir = paths.claudeDir;
        devflowDir = paths.devflowDir;
        devflowScriptsDir = path.join(paths.devflowDir, 'scripts');

        if (scope === 'user') {
          p.log.step('Uninstalling user scope (~/.claude/)');
        } else {
          p.log.step('Uninstalling local scope (git-root/.claude/)');
        }
      } catch (error) {
        p.log.warn(`Cannot uninstall ${scope} scope: ${error instanceof Error ? error.message : error}`);
        continue;
      }

      if (isSelectiveUninstall) {
        await removeSelectedPlugins(claudeDir, selectedPlugins, verbose);

        // Clean up ambient hook if ambient plugin is being removed
        if (selectedPlugins.some(sp => sp.name === 'devflow-ambient')) {
          const settingsPath = path.join(claudeDir, 'settings.json');
          try {
            const settings = await fs.readFile(settingsPath, 'utf-8');
            const updated = await removeAmbientHook(settings);
            if (updated !== settings) {
              await fs.writeFile(settingsPath, updated, 'utf-8');
              if (verbose) {
                p.log.success('Ambient mode hooks removed from settings.json');
              }
            }
          } catch { /* settings.json may not exist */ }
        }
      } else {
        // removeAllDevFlow removes Claude Code assets (commands, agents, rules, skills)
        // and devflowDir/scripts/. Scope-aware cleanup handles the rest of devflowDir.
        await removeAllDevFlow(claudeDir, devflowScriptsDir, verbose);

        if (scope === 'local') {
          // Local scope: devflowDir is gitRoot/.devflow/ which holds project data
          // (memory, learning, features, docs, config.json). Never remove those —
          // only remove install artifacts: scripts/ (done above) + manifest.json.
          await removeDevFlowInstallArtifacts(devflowDir, verbose);
          p.log.info('Local project data (memory, learning, features, docs) preserved');
        } else {
          // User scope (devflowDir = ~/.devflow/): offer full cleanup behind a confirm gate
          // that enumerates user-authored content worth backing up before wiping the dir.
          // Non-interactive, no user content, or precondition guard failure → artifacts-only.
          const userContent = await enumerateUserDevFlowContent(devflowDir);
          const cleanupDecision = resolveDevflowDirCleanup({
            scope: 'user',
            isTTY: process.stdin.isTTY,
            userContent,
            devflowDir,
            homeDir: os.homedir(),
          });

          if (cleanupDecision === 'artifacts-only') {
            await removeDevFlowInstallArtifacts(devflowDir, verbose);
            if (!process.stdin.isTTY && userContent.length > 0) {
              p.log.info(`${devflowDir} preserved (non-interactive mode — removing scripts and manifest only)`);
            }
          } else {
            // cleanupDecision === 'prompt': interactive session with user-authored content present.
            p.log.info(`User-authored content in ${devflowDir}:`);
            for (const item of userContent) {
              p.log.info(`  ${item}`);
            }

            const confirmFullCleanup = await p.confirm({
              message: `Remove entire ${devflowDir}? (includes the items listed above, plus logs and install metadata)`,
              initialValue: false,
            });

            if (p.isCancel(confirmFullCleanup)) {
              // removeAllDevFlow already ran — clean up the manifest to leave a consistent
              // state. avoids PF-014: process.exit() here would skip removeDevFlowInstallArtifacts,
              // leaving a stale manifest.json that points to assets no longer on disk.
              await removeDevFlowInstallArtifacts(devflowDir, verbose);
              p.log.info(`${devflowDir} preserved (full removal cancelled; removing scripts and manifest only)`);
            } else if (confirmFullCleanup) {
              await fs.rm(devflowDir, { recursive: true, force: true });
              p.log.success(`${devflowDir} removed`);
            } else {
              await removeDevFlowInstallArtifacts(devflowDir, verbose);
              p.log.info(`${devflowDir} preserved (removing scripts and manifest only)`);
            }
          }
        }
      }

      const pluginLabel = isSelectiveUninstall
        ? ` (${selectedPluginNames.join(', ')})`
        : '';
      p.log.success(`Plugin removed${pluginLabel}`);
    }

    // === CLEANUP EXTRAS (only for full uninstall) ===
    if (!isSelectiveUninstall) {
      const gitRoot = await getGitRoot();

      // 1. .devflow/ data directory (contains docs/, memory/, learning/, features/, etc.)
      const devflowDataDir = path.join(process.cwd(), '.devflow');
      let devflowDataExists = false;
      try {
        await fs.access(devflowDataDir);
        devflowDataExists = true;
      } catch { /* .devflow doesn't exist */ }

      if (devflowDataExists) {
        let shouldRemoveDevflow = false;

        if (options.keepDocs) {
          shouldRemoveDevflow = false;
        } else if (process.stdin.isTTY) {
          const removeDevflow = await p.confirm({
            message: '.devflow/ directory found. Remove project data (docs, memory, learning)?',
            initialValue: false,
          });

          if (p.isCancel(removeDevflow)) {
            p.cancel('Uninstall cancelled.');
            process.exit(0);
          }

          shouldRemoveDevflow = removeDevflow;
        }

        if (shouldRemoveDevflow) {
          await fs.rm(devflowDataDir, { recursive: true, force: true });
          p.log.success('.devflow/ removed');
        } else {
          p.log.info('.devflow/ preserved');
        }
      }

      // 4. .claudeignore
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

      // 5. settings.json (Devflow hooks)
      for (const scope of scopesToUninstall) {
        try {
          const paths = await getInstallationPaths(scope);
          const settingsPath = path.join(paths.claudeDir, 'settings.json');
          const originalContent = await fs.readFile(settingsPath, 'utf-8');

          // Remove all Devflow hooks and flags in one pass (idempotent)
          let settingsContent = await removeAmbientHook(originalContent);
          settingsContent = removeMemoryHooks(settingsContent);
          settingsContent = removeCaptureHooks(settingsContent);
          settingsContent = removeDreamHook(settingsContent);
          settingsContent = removeHudStatusLine(settingsContent);
          settingsContent = removeContextHook(settingsContent);
          settingsContent = stripFlags(settingsContent);
          settingsContent = stripViewMode(settingsContent);
          settingsContent = stripDevflowTeammateModeFromJson(settingsContent);

          if (settingsContent !== originalContent) {
            await fs.writeFile(settingsPath, settingsContent, 'utf-8');
            if (verbose) {
              p.log.success(`Devflow hooks removed from settings.json (${scope})`);
            }
          }

          const settings = JSON.parse(settingsContent);

          if (settings.hooks) {
            if (process.stdin.isTTY) {
              const removeHooks = await p.confirm({
                message: `Remove Devflow hooks from settings.json (${scope} scope)? Other settings preserved.`,
                initialValue: false,
              });

              if (!p.isCancel(removeHooks) && removeHooks) {
                delete settings.hooks;
                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
                p.log.success(`Devflow hooks removed from settings.json (${scope})`);
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

      // 6. Security deny list (user settings + managed settings)

      // Detect what's installed
      let userSettingsJsonForSecurity: string | null = null;
      const userSettingsPathForSecurity = path.join(getClaudeDirectory(), 'settings.json');
      try { userSettingsJsonForSecurity = await fs.readFile(userSettingsPathForSecurity, 'utf-8'); } catch { /* absent */ }

      let managedExistsForSecurity = false;
      let managedContentForSecurity: string | null = null;
      try {
        const managedPath = getManagedSettingsPath();
        managedContentForSecurity = await fs.readFile(managedPath, 'utf-8');
        managedExistsForSecurity = true;
      } catch { /* absent or unsupported platform */ }

      const detectedSecurity = detectDenyState(
        userSettingsJsonForSecurity,
        managedExistsForSecurity,
        managedContentForSecurity,
      );

      const anySecurityPresent = detectedSecurity.user || detectedSecurity.managed;
      if (anySecurityPresent) {
        const bothLocations = detectedSecurity.user && detectedSecurity.managed;
        const locationLabel = bothLocations ? 'user settings + managed settings'
          : detectedSecurity.user ? 'user settings' : 'managed settings';

        const securityDecision = resolveSecurityRemovalDecision({
          anySecurityPresent,
          keepDocs: !!options.keepDocs,
          isTTY: process.stdin.isTTY,
        });

        let shouldRemoveSecurity = false;

        if (securityDecision === 'prompt') {
          const removeDenyConfirm = await p.confirm({
            message: `Remove Devflow security deny list from ${locationLabel}?`,
            initialValue: false, // Deny list is protective — default to keeping it
          });

          if (!p.isCancel(removeDenyConfirm) && removeDenyConfirm) {
            shouldRemoveSecurity = true;
          } else {
            p.log.info(`Security deny list preserved (${locationLabel})`);
          }
        } else if (securityDecision === 'preserve') {
          p.log.info(`Security deny list preserved (${locationLabel}, non-interactive mode)`);
        }
        // securityDecision === 'skip' when keepDocs is set — no message, no action

        if (shouldRemoveSecurity) {
          // Strip from user settings (ENOENT-tolerant; atomic write via temp+rename).
          // NOTE: unparseable user settings are detected as user=false by detectDenyState
          // (JSON.parse failure sets unknown=true but not user=true), so this branch is
          // only reached when the JSON is valid — stripUserDenyList will not throw.
          // Unlike `devflow security --disable`, uninstall does NOT hard-fail on corrupt
          // JSON; it silently skips the strip instead (user=false → guard below is false).
          if (detectedSecurity.user && userSettingsJsonForSecurity !== null) {
            const { json: stripped, removed } = stripUserDenyList(
              userSettingsJsonForSecurity,
              DEVFLOW_HISTORICAL_DENY,
            );
            if (removed.length > 0) {
              await writeFileAtomicExclusive(userSettingsPathForSecurity, stripped);
              p.log.success(`Security deny list removed from user settings (${removed.length} entries)`);
            }
          }
          // Strip from managed settings (ENOENT-tolerant via removeManagedSettings)
          if (managedExistsForSecurity) {
            await removeManagedSettings(getPackageRoot(), verbose);
          }
        }
      }

      // 7. Safe-delete shell function
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

    const status = color.green('Devflow uninstalled successfully');

    p.outro(`${status}${color.dim('  Reinstall: npx devflow-kit init')}`);
  });

/**
 * Remove all Devflow assets (full uninstall).
 */
async function removeAllDevFlow(
  claudeDir: string,
  devflowScriptsDir: string,
  verbose: boolean,
): Promise<void> {
  const devflowDirectories = [
    { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
    { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
    { path: path.join(claudeDir, 'rules', 'devflow'), name: 'rules' },
    { path: devflowScriptsDir, name: 'scripts' }
  ];

  for (const dir of devflowDirectories) {
    try {
      await fs.rm(dir.path, { recursive: true, force: true });
      if (verbose) {
        p.log.success(`Removed Devflow ${dir.name}`);
      }
    } catch (error) {
      p.log.warn(`Could not remove ${dir.name}: ${error}`);
    }
  }

  // Remove all Devflow skills: prefixed (devflow:name), unprefixed (name), and legacy (devflow-name)
  const allSkillNames = new Set([...getAllSkillNames(), ...LEGACY_SKILL_NAMES]);
  const skillsDir = path.join(claudeDir, 'skills');

  let skillsRemoved = 0;
  for (const skillName of allSkillNames) {
    // Remove prefixed variant (devflow:name) — current naming
    const prefixedPath = path.join(skillsDir, prefixSkillName(skillName));
    try {
      await fs.stat(prefixedPath);
      await fs.rm(prefixedPath, { recursive: true, force: true });
      skillsRemoved++;
    } catch { /* Skill doesn't exist */ }
    // Remove unprefixed/legacy variant (name or devflow-name)
    const barePath = path.join(skillsDir, skillName);
    try {
      await fs.stat(barePath);
      await fs.rm(barePath, { recursive: true, force: true });
      skillsRemoved++;
    } catch { /* Skill doesn't exist */ }
  }

  if (skillsRemoved > 0 && verbose) {
    p.log.success(`Removed ${skillsRemoved} Devflow skill directories`);
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
  const { skills, agents, commands, rules } = computeAssetsToRemove(plugins, DEVFLOW_PLUGINS);

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
    // Remove all naming variants: prefixed (devflow:name), unprefixed (name), and legacy (devflow-name)
    const variants = [
      prefixSkillName(skill),
      skill,
      `devflow-${skill}`,
    ];
    for (const variant of variants) {
      try {
        await fs.rm(path.join(skillsDir, variant), { recursive: true, force: true });
      } catch { /* Skill might not exist */ }
    }
    if (verbose) {
      p.log.success(`Removed skill ${skill}`);
    }
  }

  const rulesDir = path.join(claudeDir, 'rules', 'devflow');
  for (const rule of rules) {
    try {
      await fs.rm(path.join(rulesDir, `${rule}.md`), { force: true });
      if (verbose) {
        p.log.success(`Removed rule ${rule}`);
      }
    } catch { /* Rule file might not exist */ }
  }
}
