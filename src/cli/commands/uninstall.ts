import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths, getClaudeDirectory, getDevFlowDirectory, getManagedSettingsPath } from '../../targets/claude-code/claude-paths.js';
import { getGitRoot } from '../../core/git.js';
import { DEVFLOW_PLUGINS, getAllSkillNames, parsePluginSelection, prefixSkillName, type PluginDefinition } from '../../core/plugins.js';
import { LEGACY_SKILL_NAMES } from '../../targets/claude-code/legacy.js';
import { removeAmbientHook } from './ambient.js';
import { removeMemoryHooks } from './memory.js';
import { removeCaptureHooks } from './capture.js';
import { removeDreamHook } from './legacy-hooks.js';
import { removeHudStatusLine } from './hud.js';
import { removeContextHook } from './context.js';
import { listShadowed } from './skills.js';
import { listShadowedRules } from './rules.js';
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

export interface ShadowWarning {
  level: 'warn' | 'info';
  message: string;
}

/**
 * Compute shadow-leftover warnings to emit after a full uninstall.
 * Pure function — no I/O, fully testable.
 *
 * Returns [] when isSelectiveUninstall is true (shadow warnings only apply
 * to full uninstall). Each non-empty shadow list produces a warn entry
 * (the leftover notice) followed by an info entry (the cleanup hint).
 *
 * @D3 Shadow state MUST be captured before the removal block. This function
 * operates on pre-captured lists — see KNOWLEDGE.md §Anti-Patterns
 * ("staging shadow state after removal").
 */
export function computeShadowLeftoverWarnings(opts: {
  shadowedSkills: string[];
  shadowedRules: string[];
  isSelectiveUninstall: boolean;
  devflowDir: string;
}): ShadowWarning[] {
  if (opts.isSelectiveUninstall) return [];

  const warnings: ShadowWarning[] = [];

  if (opts.shadowedSkills.length > 0) {
    const shadowPath = path.join(opts.devflowDir, 'skills');
    warnings.push({ level: 'warn', message: `Personal skill overrides remain in ${shadowPath}: ${opts.shadowedSkills.join(', ')}` });
    warnings.push({ level: 'info', message: `Remove manually or run: rm -rf ${shadowPath}` });
  }

  if (opts.shadowedRules.length > 0) {
    const ruleShadowPath = path.join(opts.devflowDir, 'rules');
    warnings.push({ level: 'warn', message: `Personal rule overrides remain in ${ruleShadowPath}: ${opts.shadowedRules.join(', ')}` });
    warnings.push({ level: 'info', message: `Remove manually or run: rm -rf ${ruleShadowPath}` });
  }

  return warnings;
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

    // Belt-and-braces: capture shadow state BEFORE any removal so warnings
    // are correct even if removal scope changes.
    const shadowedSkillsBefore = !isSelectiveUninstall ? await listShadowed() : [];
    const shadowedRulesBefore = !isSelectiveUninstall ? await listShadowedRules() : [];

    // Uninstall from each scope
    for (const scope of scopesToUninstall) {
      let claudeDir: string;
      let devflowScriptsDir: string;

      try {
        const paths = await getInstallationPaths(scope);
        claudeDir = paths.claudeDir;
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
        await removeAllDevFlow(claudeDir, devflowScriptsDir, verbose);
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

    // Warn about personal skill/rule overrides (captured before removal).
    const leftoverWarnings = computeShadowLeftoverWarnings({
      shadowedSkills: shadowedSkillsBefore,
      shadowedRules: shadowedRulesBefore,
      isSelectiveUninstall,
      devflowDir: getDevFlowDirectory(),
    });
    for (const { level, message } of leftoverWarnings) {
      if (level === 'warn') {
        p.log.warn(message);
      } else {
        p.log.info(color.dim(message));
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
