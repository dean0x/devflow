import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getInstallationPaths, getClaudeDirectory, getHomeDirectory, getManagedSettingsPath } from '../../targets/claude-code/claude-paths.js';
import { getGitRoot } from '../../core/git.js';
import type { PausedArea } from '../../core/area-pause-notice.js';
import { isSameLocation } from '../../core/same-location.js';
import { DEVFLOW_PLUGINS, SKILL_NAMESPACE, WORKFLOW_FOLDER_NAMES, registeredPluginNames, buildAssetMaps, getAllSkillNames, getAllAgentNames, getAllCommandNames, parsePluginSelection, resolveFeatureRedirect, prefixSkillName, unprefixSkillName, skillsOf, selectedWorkflowFolders, FEATURE_OWNED_SKILLS, type PluginDefinition } from '../../core/plugins.js';
import { readManifest, readManifestPlugins, removeManifestPlugins } from '../../core/manifest.js';
import { sweepOrphanedAssets, mdFileName, mdEntryName, type SweepResult } from '../../core/orphan-sweep.js';
import { LEGACY_SKILL_NAMES } from '../../targets/claude-code/legacy.js';
import { removeAmbientHook } from './ambient.js';
import { removeMemoryHooks } from './memory.js';
import { removeCaptureHooks } from './capture.js';
import { removeDreamHook } from './legacy-hooks.js';
import { removeHudStatusLine } from './hud.js';
import { removeContextHook } from './context.js';
import { applyProxyTeardownToSettings } from './proxy.js';
import { readProxyState, proxyJsonExists } from '../../core/proxy-state.js';
import { hudCacheDir } from '../../core/cache.js';
import {
  effectiveTrackerServers,
  TRACKER_ATTEMPTS_NAMES,
  TRACKER_CLAIM_FILE,
  TRACKER_CONVENTIONS_DIR,
  TRACKER_ENABLED_FILE,
  TRACKER_LEGACY_ATTEMPTS_FILE,
  TRACKER_LEGACY_CONVENTIONS_FILE,
  TRACKER_PROVIDER_IDS,
  TRACKER_STAGED_PREFIX,
} from '../../core/tracker.js';
import { CLAUDE_MD_AUDIT_STAMP_FILE, CLAUDE_MD_AUDIT_STAMP_TMP_PREFIX } from '../../core/claude-md-audit.js';
import { revertExternalAgents } from '../../core/agent-models.js';
import type { Settings } from '../../targets/claude-code/hooks.js';
import { detectShell, getProfilePath } from '../../core/safe-delete.js';
import { isAlreadyInstalled, removeFromProfile } from '../../core/safe-delete-install.js';
import { removeManagedSettings, stripUserDenyList, detectDenyState, DEVFLOW_HISTORICAL_DENY, DEVFLOW_TRACKED_PATHS } from '../../targets/claude-code/post-install.js';
import { writeSettingsFileAtomic } from '../../core/fs-atomic.js';
import { stripFlags } from '../../core/flags.js';
import { stripDevflowTeammateModeFromJson } from '../../core/teammate-mode-cleanup.js';
import { getPackageRoot, isContainedIn } from '../../core/paths.js';
import { firstSymbolicLink } from '../../core/linked-path.js';
import { MANIFEST_LOCK_NAME, MANIFEST_LOCK_STALE_MARK } from '../../core/manifest-lock.js';
import { CURATION_DIR_NAME, CURATION_TUNING_FILE_NAME, LEGACY_NAMES, MOVE_JOURNAL_SUFFIX, MOVE_LOCK_PREFIX, MOVE_LOCK_SUFFIX, getMemoryDir } from '../../core/project-paths.js';
import { probeTrackedArea, type TrackedAreasAnswer } from '../../core/tracked-areas.js';
import { restampInstalledCommands } from '../../targets/claude-code/language-stamp.js';
import { installRenderedCharter, removeHandoffSentinel } from '../../targets/claude-code/charter-render.js';
import { installCommandsAndAgents } from '../../targets/claude-code/installer.js';
import { BACKUP_ROOT_NAME, escapeName } from '../../targets/claude-code/install-backup.js';
import { isUnrealFolder, newLinkReport, refuseUnrealFolder, refusedFolderStatement, type LinkReport } from '../../targets/claude-code/linked-folder.js';
import { formatReplacedLinksSummary, type SummaryLine } from './install-report.js';
import { judgeBareLegacySkill } from './legacy-sweep.js';

/**
 * Which install `uninstall` acts on: the machine-wide install (`user`), or a
 * leftover repo-local install from the retired local scope (`local`).
 */
export type UninstallScope = 'user' | 'local';

/** The directories one install scope occupies. */
interface ScopeInstallPaths {
  claudeDir: string;
  devflowDir: string;
}

/**
 * Where a retired repo-local install lives: `<gitRoot>/.claude` and `<gitRoot>/.devflow`.
 *
 * D-LEGACY-LOCAL-CLEANUP: `init --scope local` no longer exists (D-SCOPE-RETIRED
 * in claude-paths.ts), but repos installed by it still carry its assets, so
 * `uninstall` keeps detecting and removing them. This is the ONLY place a
 * repo-local install path is derived, and it is private to uninstall: nothing
 * installs there any more. A local-only uninstall never reaches the user's
 * settings.json or anything else under HOME — the settings strip edits
 * `<gitRoot>/.claude/settings.json`, the legacy commands-rule purge is skipped,
 * and the machine-wide steps (security deny list, safe-delete) run only when
 * the user scope is being uninstalled too.
 *
 * Returns null when either repo-local directory IS a machine-wide one — a
 * repository rooted at HOME (a dotfiles repo) puts `<gitRoot>/.claude` and
 * `<gitRoot>/.devflow` on `~/.claude` and `~/.devflow`, and a "local" removal
 * there would be a machine-wide uninstall under another name.
 */
async function legacyLocalInstallPaths(gitRoot: string): Promise<ScopeInstallPaths | null> {
  const legacy = {
    claudeDir: path.join(gitRoot, '.claude'),
    devflowDir: path.join(gitRoot, '.devflow'),
  };
  const machine = getInstallationPaths();
  if (await isSameLocation(legacy.claudeDir, machine.claudeDir)) return null;
  if (await isSameLocation(legacy.devflowDir, machine.devflowDir)) return null;
  return legacy;
}

/**
 * The directories for `scope`, or null for a local scope with no repo-local
 * install to act on: outside a git repository, or in one rooted at HOME.
 */
async function scopeInstallPaths(scope: UninstallScope, gitRoot: string | null): Promise<ScopeInstallPaths | null> {
  if (scope === 'user') return getInstallationPaths();
  return gitRoot === null ? null : legacyLocalInstallPaths(gitRoot);
}

/**
 * The check a removal or settings rewrite passes before it acts on `target`: true
 * to go ahead, false when it was skipped, the skip already reported. Never throws.
 */
export type ChangeGuard = (target: string) => Promise<boolean>;

/**
 * The user scope's guard for a path that is not inside a Devflow install folder, and for the removal
 * of a whole entry. It passes everything: `~/.claude` and `~/.devflow` and their other folders, the
 * manifest and `settings.json` are the user's own, so a symbolic link there is followed. `fs.rm` of an
 * entry that is a link removes the link and never what it points to, so a full uninstall removes a
 * linked Devflow folder as it removes a real one.
 *
 * A read, write or removal inside a Devflow install folder never uses this guard: it uses
 * {@link devflowFolderGuard}, which refuses a link.
 */
const changeUserOwned: ChangeGuard = async () => true;

/** The folders directly under `~/.claude` that hold a `devflow` folder of Devflow's own. */
const DEVFLOW_FILE_FOLDERS: readonly string[] = ['commands', 'agents', 'rules'];

/**
 * The Devflow install folder that holds `target` and every folder below it down to the parent of
 * `target`, outermost first; null for a target outside every Devflow install folder. A target that is
 * itself a Devflow install folder (a `skills/devflow:*` folder) gives that folder alone. PURE.
 *
 * The Devflow install folders are `commands/devflow`, `agents/devflow`, `rules/devflow` and each
 * `skills/devflow:*` folder. `~/.claude`, `~/.claude/skills` and the other folders above them are
 * not among them.
 */
function devflowFolderChain(claudeDir: string, target: string): string[] | null {
  const rel = path.relative(claudeDir, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  const inFileFolder = DEVFLOW_FILE_FOLDERS.includes(parts[0]) && parts[1] === 'devflow';
  const inSkillFolder = parts[0] === 'skills' && parts[1] !== undefined && parts[1].startsWith(SKILL_NAMESPACE);
  if (!inFileFolder && !inSkillFolder) return null;
  const chain = [path.join(claudeDir, parts[0], parts[1])];
  for (let depth = 2; depth < parts.length - 1; depth++) {
    chain.push(path.join(chain[chain.length - 1], parts[depth]));
  }
  return chain;
}

/**
 * The guard for a change inside the Devflow install folders of `claudeDir`.
 *
 * Devflow never reads, writes or removes through a link at or below its own install folders. A
 * target is let through only when each Devflow folder on the way to it is a real folder or absent;
 * a folder that is a link, or not a folder, refuses the target. The refusal is recorded once in
 * `report.refusedFolders` and the link is left as it was. A target outside every Devflow install
 * folder passes, and a link to a file that is the target itself is not followed (`fs.rm` removes
 * the link). Never throws.
 */
function devflowFolderGuard(claudeDir: string, report: Pick<LinkReport, 'refusedFolders'>): ChangeGuard {
  return async (target) => {
    const chain = devflowFolderChain(claudeDir, target);
    if (chain === null) return true;
    for (const folder of chain) {
      if (report.refusedFolders.includes(folder)) return false;
      if (await refuseUnrealFolder(report, folder)) return false;
    }
    return true;
  };
}

/**
 * Turn the refused-folder half of an uninstall into summary lines, one per folder.
 *
 * An uninstall removes and changes nothing at a path that is a link, or not a folder where it needs
 * one, and leaves the entry as it was. That looks the same on disk as an uninstall that found nothing
 * to remove, so the line says what was skipped and what to do about it.
 *
 * Pure function — returns lines, logs nothing.
 */
export function formatUninstallRefusedSummary(report: Pick<LinkReport, 'refusedFolders'>): SummaryLine[] {
  return report.refusedFolders.map(folder => ({
    level: 'warn',
    message:
      `${refusedFolderStatement(folder)} Devflow removed and changed nothing there. ` +
      `Remove the link or replace it with a real folder, then run the uninstall again.`,
  }));
}

/** How many folders an uninstall left as they are, in a sentence that agrees with the count. */
function leftAsTheyAre(count: number): string {
  return count === 1 ? '1 folder was left as it is' : `${count} folders were left as they are`;
}

/**
 * The line for one scope's removal. With no refused folder the plugin is removed. With any, the
 * removal is partial: the line says so and counts the folders left as they are, because a refused
 * folder looks the same on disk as a folder that had nothing to remove.
 *
 * @param pluginLabel - Empty, or the selected plugin names as ` (a, b)`.
 *
 * Pure function — returns the line, logs nothing.
 */
export function formatPluginRemovedLine(pluginLabel: string, refusedCount: number): SummaryLine {
  if (refusedCount === 0) return { level: 'success', message: `Plugin removed${pluginLabel}` };
  return { level: 'warn', message: `Plugin removed in part${pluginLabel}: ${leftAsTheyAre(refusedCount)}.` };
}

/**
 * The last line of an uninstall. It says success only when no folder was refused in any scope;
 * otherwise it says the uninstall was done in part and counts the folders left as they are.
 *
 * Pure function — returns the line, logs nothing.
 */
export function formatUninstallOutro(refusedCount: number): string {
  if (refusedCount === 0) {
    return `${color.green('Devflow uninstalled successfully')}${color.dim('  Reinstall: npx devflow-kit@latest init')}`;
  }
  return color.yellow(`Devflow uninstalled in part: ${leftAsTheyAre(refusedCount)}.`);
}

/** Print the links an uninstall replaced or refused, one line each, once per path. */
function logLinkReport(report: LinkReport): void {
  const lines = [
    ...formatReplacedLinksSummary({ replacedLinks: [...new Set(report.replacedLinks)] }),
    ...formatUninstallRefusedSummary({ refusedFolders: [...new Set(report.refusedFolders)] }),
  ];
  for (const line of lines) p.log[line.level](line.message);
}

/**
 * `folder` and every path below it down to `target`, the target included, outermost
 * first, for whichever of the two folders holds `target`; null for a target in
 * neither. PURE.
 */
function pathsDownTo(folders: ScopeInstallPaths, target: string): string[] | null {
  for (const folder of [folders.claudeDir, folders.devflowDir]) {
    const rel = path.relative(folder, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    const chain = [folder];
    for (const part of rel === '' ? [] : rel.split(path.sep)) {
      chain.push(path.join(chain[chain.length - 1], part));
    }
    return chain;
  }
  return null;
}

/**
 * The guard for a legacy local install's removals and settings rewrites.
 *
 * D-CLI-NO-SYMLINK (firstSymbolicLink): a repository can commit `.claude`, `.devflow`
 * or any folder or file in them as a symbolic link, and enough of `.claude` for a
 * plain `uninstall` to detect a legacy install there. `fs.rm` and the settings
 * rewrite act inside whatever folder a link on the way names, so a target is acted
 * on only where neither `<gitRoot>/.claude` or `<gitRoot>/.devflow` nor anything
 * below it on the way to the target, the target included, is a link. Otherwise the
 * target is skipped, the link is left as it was, and one warning per link, opened
 * by `skipped`, names it. A target that cannot be checked, or lies in neither
 * folder, is skipped and reported the same way. The rest of the install is still
 * removed, so a real, unlinked legacy install comes out whole.
 */
function legacyLocalChangeGuard(folders: ScopeInstallPaths, skipped: string): ChangeGuard {
  const reported = new Set<string>();
  const report = (subject: string, reason: string): void => {
    if (reported.has(subject)) return;
    reported.add(subject);
    p.log.warn(`${skipped}: ${reason}`);
  };
  return async (target) => {
    const chain = pathsDownTo(folders, target);
    if (chain === null) {
      report(target, `${target} is outside the legacy install`);
      return false;
    }
    let link: string | null;
    try {
      link = await firstSymbolicLink(chain);
    } catch (error) {
      report(target, `${target} could not be checked for a symbolic link (${error instanceof Error ? error.message : String(error)})`);
      return false;
    }
    if (link === null) return true;
    report(link, `${link} is a symbolic link, and devflow removes or changes nothing through one`);
    return false;
  };
}

/**
 * The guard for one scope's full or selective phase.
 *
 * A legacy local install is checked for a link anywhere on the way to a target. In the user scope the
 * full phase removes whole entries and passes ({@link changeUserOwned}). The selective phase gives
 * its `links` report and gets {@link devflowFolderGuard}, which refuses a linked Devflow folder.
 */
function scopeChangeGuard(scope: UninstallScope, folders: ScopeInstallPaths, links?: LinkReport): ChangeGuard {
  if (scope === 'local') return legacyLocalChangeGuard(folders, 'Legacy local install not fully removed');
  return links === undefined ? changeUserOwned : devflowFolderGuard(folders.claudeDir, links);
}

/**
 * The plugins the manifest records as installed, as registry definitions.
 *
 * Falls back to the whole registry when there is no readable manifest, or when
 * it names nothing this registry still has: that is the pre-manifest and the
 * corrupt-manifest case, and retaining too much is the safe direction for a
 * removal. Names the manifest carries that the registry has since dropped are
 * skipped rather than invented — a definition is what the retained-set
 * arithmetic needs, and there is none for a deleted plugin.
 */
export async function resolveInstalledPlugins(devflowDir: string): Promise<PluginDefinition[]> {
  const manifest = await readManifest(devflowDir).catch(() => null);
  const names = new Set(manifest?.plugins ?? []);
  if (names.size === 0) return DEVFLOW_PLUGINS;
  const resolved = DEVFLOW_PLUGINS.filter(plugin => names.has(plugin.name));
  return resolved.length === 0 ? DEVFLOW_PLUGINS : resolved;
}

/**
 * The plugin names the orchestrator charter is re-rendered for after `uninstall --plugin`, or null when there
 * is no manifest record to render from. Pure.
 *
 * D-CHARTER-INSTALL-RENDER: the set is the manifest record (`readManifestPlugins`) minus the plugins being
 * removed, with a legacy name mapped and only names this registry has kept ({@link registeredPluginNames}).
 * It is deliberately NOT {@link resolveInstalledPlugins}: that falls back to the whole registry when the
 * manifest is missing or names nothing, which is the safe direction for retaining assets, and the wrong one
 * here. The registry would render a charter that routes to every workflow on a machine that installed none
 * of them. With no record the caller leaves the installed charter as it is and takes only the sentinel away.
 * A record that lists no plugin is a record of nothing installed, so it yields the empty set rather than null.
 */
export function charterPluginsAfterRemoval(
  recordedPlugins: readonly string[] | null,
  removedPluginNames: readonly string[],
): string[] | null {
  if (recordedPlugins === null) return null;
  const removed = new Set(removedPluginNames);
  return registeredPluginNames(recordedPlugins).filter(name => !removed.has(name));
}

/**
 * Compute which assets should be removed during selective plugin uninstall.
 * Skills and agents shared by remaining plugins are retained.
 * Rules shared by remaining plugins are also retained.
 *
 * D-RETAIN-FROM-MANIFEST: `installedPlugins` is what the MANIFEST records as
 * installed, not the whole registry. Once skills are plugin-scoped the two stop
 * agreeing, and taking the registry retains assets on behalf of plugins the user
 * never installed — so `devflow uninstall --plugin=X` keeps X's skills alive
 * because some unselected plugin also declares them, and the user is left with
 * exactly the files they asked to remove. Skills are retained across the CLOSURE
 * (`skills ∪ requires`) of the remaining plugins, for the same reason the
 * install set is a closure: a skill another installed plugin merely requires is
 * still a skill it needs.
 *
 * @param installedPlugins - The plugins the manifest records. Callers pass the
 *   registry only when there is no manifest to read, and the dry-run and the
 *   real removal must always be given the SAME list or they describe different
 *   outcomes.
 * @param folderWorkflows - The target-layer set (D-WORKFLOW-FOLDER-INSTALL). A folder
 *   workflow of a selected plugin is a skill to remove, unless a remaining plugin
 *   owns it too, and never a command: it has no command file.
 */
export function computeAssetsToRemove(
  selectedPlugins: PluginDefinition[],
  installedPlugins: PluginDefinition[],
  folderWorkflows: ReadonlySet<string> = WORKFLOW_FOLDER_NAMES,
): { skills: string[]; agents: string[]; commands: string[]; rules: string[] } {
  const selectedNames = new Set(selectedPlugins.map(p => p.name));
  const remainingPlugins = installedPlugins.filter(p => !selectedNames.has(p.name));

  const retainedSkills = skillsOf(remainingPlugins);
  const retainedAgents = new Set<string>();
  const retainedRules = new Set<string>();
  for (const rp of remainingPlugins) {
    for (const a of rp.agents) retainedAgents.add(a);
    for (const r of rp.rules) retainedRules.add(r);
  }

  const skills: string[] = [];
  const agents: string[] = [];
  const commands: string[] = [];
  const rules: string[] = [];

  for (const skill of skillsOf(selectedPlugins)) {
    if (!retainedSkills.has(skill)) skills.push(skill);
  }
  const retainedFolders = selectedWorkflowFolders(remainingPlugins, folderWorkflows);
  for (const name of selectedWorkflowFolders(selectedPlugins, folderWorkflows)) {
    if (!retainedFolders.has(name)) skills.push(name);
  }

  for (const plugin of selectedPlugins) {
    for (const agent of plugin.agents) {
      if (!retainedAgents.has(agent)) agents.push(agent);
    }
    for (const rule of plugin.rules) {
      if (!retainedRules.has(rule)) rules.push(rule);
    }
    commands.push(...plugin.commands.filter(cmd => !folderWorkflows.has(cmd.replace(/^\//, ''))));
  }

  return { skills, agents, commands, rules };
}

/**
 * Format a dry-run plan showing what would be removed.
 * Pure function — no I/O, fully testable.
 */
export function formatDryRunPlan(
  assets: { skills: string[]; agents: string[]; commands: string[]; rules?: string[] },
): string {
  const skills = [...new Set(assets.skills)];
  const agents = [...new Set(assets.agents)];
  const commands = [...new Set(assets.commands)];
  const rules = [...new Set(assets.rules ?? [])];
  const hasAssets = skills.length > 0 || agents.length > 0 || commands.length > 0 || rules.length > 0;

  if (!hasAssets) {
    return 'Nothing to remove.';
  }

  const lines: string[] = [];
  if (skills.length > 0) lines.push(`Skills (${skills.length}): ${skills.join(', ')}`);
  if (agents.length > 0) lines.push(`Agents (${agents.length}): ${agents.join(', ')}`);
  if (commands.length > 0) lines.push(`Commands (${commands.length}): ${commands.join(', ')}`);
  if (rules.length > 0) lines.push(`Rules (${rules.length}): ${rules.join(', ')}`);

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
 * always "preserve", never "prompt" — avoids a half-applied-state hazard.
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
 * Resolve the answer from a Clack confirm prompt for the .devflow/ project data
 * removal question into a boolean removal decision.
 *
 * A cancel (user presses Ctrl-C on this prompt) is treated as decline: the
 * .devflow/ directory is preserved and the uninstall continues with the remaining
 * steps rather than aborting via process.exit().
 *
 * PURE — no I/O, fully testable.
 *
 * @param answer - The value returned by p.confirm(): boolean or a cancel symbol.
 * @returns true only when the user explicitly confirmed removal.
 */
export function resolveProjectDataCleanup(answer: boolean | symbol): boolean {
  return answer === true;
}

/** One entry directly under a repository's `.devflow/`. */
export interface ProjectDataEntry {
  name: string;
  isDir: boolean;
}

/** What the project-data step would do to `<gitRoot>/.devflow`. */
export interface ProjectDataPlan {
  /** `<gitRoot>/.devflow`. */
  dir: string;
  /** Entries a confirmed cleanup deletes, sorted by name. */
  remove: ReadonlyArray<ProjectDataEntry>;
  /** Tracked entries (DEVFLOW_TRACKED_PATHS) present under `dir`; they always stay. */
  keep: ReadonlyArray<ProjectDataEntry>;
  /**
   * Entries of a data area (curation or memory) that git tracks files in, or that git did
   * not answer for; they stay, sorted by name. Empty where git tracks nothing in the
   * area's folders.
   */
  keepPaused: ReadonlyArray<ProjectDataEntry>;
}

/**
 * Why the project-data step does nothing: no git root, a git root that is HOME,
 * a `.devflow` that is the machine-wide devflow directory, a `.devflow` that is a
 * symbolic link to anywhere else, or no `.devflow` at all.
 */
export type ProjectDataSkipReason = 'no-git-root' | 'home-root' | 'machine-dir' | 'symlink' | 'absent';

export type ProjectDataResolution =
  | { kind: 'plan'; plan: ProjectDataPlan }
  | { kind: 'skip'; reason: ProjectDataSkipReason };

/** Tracked entries by name and kind: `features/` is a directory, the rest are files. */
const TRACKED_ENTRIES: ReadonlyArray<ProjectDataEntry> = DEVFLOW_TRACKED_PATHS.map((tracked) => ({
  name: tracked.replace(/\/$/, ''),
  isDir: tracked.endsWith('/'),
}));

/** The memory folder's name under `.devflow/`, by the name the path helper gives it. */
const MEMORY_FOLDER_NAME = path.basename(getMemoryDir(path.sep));

/**
 * The data area an entry under `.devflow/` belongs to, or null. The curation area holds the
 * curation folder, the old ledger folder and the backup folders; the memory area holds the
 * memory folder. Decided by name alone, whatever the kind of entry, and without regard to
 * ASCII letter case, as the tracked-areas check matches them.
 */
function projectDataAreaOf(name: string): PausedArea | null {
  const lower = name.toLowerCase();
  if (lower === CURATION_DIR_NAME || lower === LEGACY_NAMES.folder || lower.startsWith(LEGACY_NAMES.backupPrefix)) return 'curation';
  if (lower === MEMORY_FOLDER_NAME) return 'memory';
  return null;
}

/**
 * Split the entries under a repository's `.devflow/` into what a confirmed cleanup
 * removes and what it keeps (D-UNINSTALL-CARVE-OUT). An entry is kept only when both
 * its name and its kind match a tracked path, so a stray FILE named `features` is
 * not mistaken for the tracked directory. An entry of a paused data area (`pausedAreas`:
 * git tracks files in the area's folders, or did not answer) is kept too, in
 * `keepPaused`. PURE — all three lists sorted by name.
 */
export function partitionProjectData(
  entries: ReadonlyArray<ProjectDataEntry>,
  pausedAreas: ReadonlySet<PausedArea> = new Set(),
): {
  remove: ProjectDataEntry[];
  keep: ProjectDataEntry[];
  keepPaused: ProjectDataEntry[];
} {
  const isTracked = (entry: ProjectDataEntry): boolean =>
    TRACKED_ENTRIES.some((t) => t.name === entry.name && t.isDir === entry.isDir);
  const isPaused = (entry: ProjectDataEntry): boolean => {
    const area = projectDataAreaOf(entry.name);
    return area !== null && pausedAreas.has(area);
  };
  const byName = (a: ProjectDataEntry, b: ProjectDataEntry): number => a.name.localeCompare(b.name);
  return {
    remove: entries.filter((e) => !isTracked(e) && !isPaused(e)).sort(byName),
    keep: entries.filter(isTracked).sort(byName),
    keepPaused: entries.filter((e) => !isTracked(e) && isPaused(e)).sort(byName),
  };
}

/** The answer of the tracked-areas check for `area` at `root`: injected for tests. */
export type ProjectDataAreaProbe = (root: string, area: PausedArea) => Promise<TrackedAreasAnswer>;

/** The check's own answer, from the package's own copy of it. */
const probeProjectDataArea: ProjectDataAreaProbe = async (root, area) => (await probeTrackedArea(root, area)).answer;

/**
 * The data areas that hold an entry in `entries` and are paused at `gitRoot`: git tracks
 * files in the area's folders, or a `.git` entry stands and git did not answer. An area
 * with no entry is not asked, and a root with no `.git` entry makes no git call. A probe
 * that fails to answer counts as `unknown`, so the area is kept.
 */
async function pausedProjectDataAreas(
  gitRoot: string,
  entries: ReadonlyArray<ProjectDataEntry>,
  probe: ProjectDataAreaProbe,
): Promise<Set<PausedArea>> {
  const present = new Set(entries.flatMap((entry) => {
    const area = projectDataAreaOf(entry.name);
    return area === null ? [] : [area];
  }));
  const answers = await Promise.all([...present].map(async (area): Promise<[PausedArea, TrackedAreasAnswer]> => {
    try {
      return [area, await probe(gitRoot, area)];
    } catch {
      return [area, 'unknown'];
    }
  }));
  return new Set(answers.flatMap(([area, answer]) => (answer === 'untracked' ? [] : [area])));
}

/**
 * Resolve the project-data step's target: `<gitRoot>/.devflow`, partitioned.
 *
 * D-UNINSTALL-CARVE-OUT: the step acts on the repository's `.devflow` at its git
 * root — the directory devflow's hooks write — never on whatever `.devflow` the
 * cwd happens to hold. It is skipped with no git root, and when the git root is
 * HOME or its `.devflow` is the machine-wide devflow directory (a dotfiles repo):
 * there `.devflow` is the install itself, not project data. Both comparisons use
 * realpaths, so macOS's `/var` → `/private/var` and a symlinked HOME still match.
 *
 * A `.devflow` that is a symbolic link to anywhere else is skipped too, and never
 * followed: its target is a directory devflow cannot prove it wrote, so a
 * confirmed cleanup must not empty it — nor unlink a link the user made.
 *
 * A folder that git tracks is the repository's content, not devflow's data. The
 * curation area (the curation folder, the old ledger folder and the backup folders)
 * and the memory area (the memory folder) are each asked of the tracked-areas check at
 * the git root, when an entry of the area stands. An area that git tracks files in, or
 * that git did not answer for, moves its entries from the removal list to `keepPaused`.
 */
export async function resolveProjectDataPlan(opts: {
  gitRoot: string | null;
  homeDir: string;
  machineDevflowDir: string;
  /** The tracked-areas check (default: the package's own copy); injected for tests. */
  probe?: ProjectDataAreaProbe;
}): Promise<ProjectDataResolution> {
  if (opts.gitRoot === null) return { kind: 'skip', reason: 'no-git-root' };
  if (await isSameLocation(opts.gitRoot, opts.homeDir)) return { kind: 'skip', reason: 'home-root' };

  const dir = path.join(opts.gitRoot, '.devflow');
  if (await isSameLocation(dir, opts.machineDevflowDir)) return { kind: 'skip', reason: 'machine-dir' };

  try {
    if ((await fs.lstat(dir)).isSymbolicLink()) return { kind: 'skip', reason: 'symlink' };
  } catch {
    return { kind: 'skip', reason: 'absent' };
  }

  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { kind: 'skip', reason: 'absent' };
  }
  const entries = dirents.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
  const paused = await pausedProjectDataAreas(opts.gitRoot, entries, opts.probe ?? probeProjectDataArea);
  const { remove, keep, keepPaused } = partitionProjectData(entries, paused);
  return { kind: 'plan', plan: { dir, remove, keep, keepPaused } };
}

/**
 * The line that tells the user why the project-data step was skipped, or null
 * when there is nothing worth saying (no repository, no `.devflow`). Shared by
 * the real cleanup and the dry run so both say the same. PURE.
 */
export function formatProjectDataSkip(reason: ProjectDataSkipReason, gitRoot: string | null): string | null {
  if (gitRoot === null) return null;
  const dir = path.join(gitRoot, '.devflow');
  switch (reason) {
    case 'home-root':
    case 'machine-dir':
      return `Project data step skipped: ${dir}/ is the machine-wide devflow directory`;
    case 'symlink':
      return `Project data step skipped: ${dir} is a symbolic link — devflow does not follow it; remove it yourself if nothing there is needed`;
    case 'no-git-root':
    case 'absent':
      return null;
  }
}

/** An entry as the prompt shows it: directories carry a trailing `/`. */
function entryLabel(entry: ProjectDataEntry): string {
  return entry.isDir ? `${entry.name}/` : entry.name;
}

/** Comma-separated labels, or `(none)`. */
function entryList(entries: ReadonlyArray<ProjectDataEntry>): string {
  return entries.length === 0 ? '(none)' : entries.map(entryLabel).join(', ');
}

/** Why the entries of a data area stay, said beside a list of them. */
const KEEP_PAUSED_REASON = 'git tracks them, or git did not answer';

/** Why one entry of a data area stays, said beside it. */
const KEEP_PAUSED_REASON_ONE = 'git tracks it, or git did not answer';

/**
 * The lines shown before the project-data confirm: what is removed and what is
 * kept, and, only where there are such entries, what is kept because git tracks them
 * or did not answer. PURE.
 */
export function formatProjectDataPlan(plan: ProjectDataPlan): string[] {
  return [
    `Project data in ${plan.dir}/:`,
    `  Remove: ${entryList(plan.remove)}`,
    `  Keep (shared via git): ${entryList(plan.keep)}`,
    ...(plan.keepPaused.length === 0 ? [] : [`  Keep (${KEEP_PAUSED_REASON}): ${entryList(plan.keepPaused)}`]),
  ];
}

/** A confirm prompt: `p.confirm` unless a caller injects one. */
export type ConfirmPrompt = (opts: { message: string; initialValue?: boolean }) => Promise<boolean | symbol>;

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
 *   4. devflowDir must reside inside $HOME
 *
 * Returns:
 *   - 'artifacts-only' — remove only manifest.json; leave the directory intact
 *   - 'prompt'         — interactive session with user-authored content; caller should ask
 *
 * @D5 Precondition guard: any anomalous devflowDir falls back to 'artifacts-only' rather
 * than throwing — business logic must not throw (engineering rule). The explicit guard
 * makes the invariant present in production code, not only in tests (reliability rule).
 * @D6 The caller must NOT process.exit() after a cancel/decline response;
 * removeAllDevFlow has already run by the time the prompt fires, so removeDevFlowInstallArtifacts
 * must execute on every non-confirm path to leave a clean end-state.
 * @D7 keepDocs gate: when the caller passes --keep-docs, the entire ~/.devflow dir cleanup
 * prompt is suppressed — artifacts-only regardless of isTTY or userContent. This prevents
 * --keep-docs from triggering prompts about skill shadows or preference-profile.md.
 */
export function resolveDevflowDirCleanup(opts: {
  isTTY: boolean;
  userContent: string[];
  devflowDir: string;
  homeDir: string;
  keepDocs?: boolean;
}): 'artifacts-only' | 'prompt' {
  // --keep-docs: suppress the full cleanup prompt entirely; artifacts-only.
  if (opts.keepDocs) return 'artifacts-only';

  // Precondition guard: devflowDir must be a well-known, safe-to-rm path.
  // Any anomalous value (bare homedir, filesystem root, a path outside HOME)
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

/** One user-authored path under `devflowDir` that a full cleanup would delete. */
export interface UserContentEntry {
  /** Path relative to `devflowDir` — the key the @D8 disjointness check intersects. */
  relPath: string;
  /** Directories count as present only when non-empty. */
  isDir?: boolean;
  /** Label rendered in the confirmation prompt. */
  label: string;
}

/**
 * Single source of truth for user-authored content under `devflowDir`.
 *
 * The counterpart to `installArtifactPaths`: together the two lists describe
 * every Devflow-created entry in `~/.devflow`, and they never overlap (@D8).
 * Membership here means "survives every path but a confirmed full-dir rm";
 * membership there means "removed on decline, cancel, non-interactive and
 * --keep-docs alike".
 *
 * NOT listed here: agent-models.json — reclassified as an INSTALL ARTIFACT (AC-P1-F4).
 * Stale per-agent model overrides silently re-apply to renamed/deleted agents on reinstall,
 * so it must be cleaned up by removeDevFlowInstallArtifacts, not preserved behind a confirm gate.
 *
 * @param devflowDir - Absolute path to ~/.devflow (labels quote the shadow dirs).
 */
export function userContentPaths(devflowDir: string): ReadonlyArray<UserContentEntry> {
  return [
    // Skill shadow overrides (~/.devflow/skills/{name}/)
    { relPath: 'skills', isDir: true, label: `skill shadows (${path.join(devflowDir, 'skills')})` },
    // Rule shadow overrides (~/.devflow/rules/{name}.md)
    { relPath: 'rules', isDir: true, label: `rule shadows (${path.join(devflowDir, 'rules')})` },
    // The files an install moved out of the devflow folders because devflow did not ship them.
    // They are the user's own files, so only a confirmed full wipe removes them.
    { relPath: BACKUP_ROOT_NAME, isDir: true, label: `install backups (${path.join(devflowDir, BACKUP_ROOT_NAME)})` },
    // preference-profile.md — user-curated decision-preference profile
    { relPath: 'preference-profile.md', label: 'preference-profile.md' },
    // tracker/ — the inferred, hand-editable issue-tracker conventions, one file
    // per provider (D-TRACKER-PER-PROVIDER-CONVENTIONS).
    //
    // USER CONTENT (OD-15), classified the same way as preference-profile.md above
    // rather than as an install artifact like agent-models.json, because each file
    // is inferred ONCE per machine and then hand-editable: absence is the trigger
    // that re-runs inference, so deleting one on every decline/cancel/--keep-docs
    // path would silently discard work the user may have corrected by hand.
    //
    // REVERSAL CONDITION, recorded: this classification is CONDITIONAL on the
    // provider-mismatch guard shipping. agent-models.json was reclassified to an
    // artifact precisely because stale overrides re-apply *silently*; "silently" is
    // the load-bearing word. A conventions file whose frontmatter provider
    // disagrees with the resolved provider produces
    // `TRACEABILITY: DEGRADED (tracker configuration mismatch (conventions file))`
    // and no tracker call — that is what removes the silence, and the reason names
    // THE FILE rather than the per-repo override so the user is told which of the
    // two to edit. If that guard is ever dropped, reclassify these to install
    // artifacts IN THE SAME CHANGE, otherwise a silently-authoritative stale file
    // survives uninstall.
    {
      relPath: TRACKER_CONVENTIONS_DIR,
      isDir: true,
      label: `issue tracker conventions (${path.join(devflowDir, TRACKER_CONVENTIONS_DIR)})`,
    },
    // tracker.md and tracker.md.{provider}.bak — the conventions earlier releases
    // kept in one machine-wide file, and the copies they moved aside on a provider
    // change. The per-provider migration moves tracker.md when its frontmatter
    // names a provider whose file does not exist yet, and leaves it otherwise;
    // nothing moves or deletes a backup. Both hold what the conventions files
    // hold — the user's site and project key — so the same classification: named
    // by the confirm prompt, kept by every artifacts-only pass. The backup names
    // come from the registry, so every provider an earlier release could have
    // backed up is covered.
    {
      relPath: TRACKER_LEGACY_CONVENTIONS_FILE,
      label: `${TRACKER_LEGACY_CONVENTIONS_FILE} (issue tracker conventions from an earlier release)`,
    },
    ...TRACKER_PROVIDER_IDS.map(id => {
      const name = `${TRACKER_LEGACY_CONVENTIONS_FILE}.${id}.bak`;
      return { relPath: name, label: `${name} (previous issue tracker conventions)` };
    }),
    // The global curate agent tuning config, under both its names: the new name on an
    // upgraded machine, and the old name, which a downgraded machine can still hold.
    { relPath: CURATION_TUNING_FILE_NAME, label: CURATION_TUNING_FILE_NAME },
    { relPath: LEGACY_NAMES.tuningFile, label: LEGACY_NAMES.tuningFile },
    // hud.json — user HUD enable/disable preference and display config
    { relPath: 'hud.json', label: 'hud.json (HUD configuration)' },
  ];
}

/**
 * Enumerate user-authored content in devflowDir that would be deleted by a
 * full cleanup of the directory.
 *
 * Walks `userContentPaths` and returns the label of every entry that exists on
 * disk — a directory counts only when it is non-empty. Empty array means nothing
 * user-authored is present in the directory.
 *
 * Pure I/O — no side effects, no output, fully testable.
 *
 * @D4 Called BEFORE any removal so shadow state is captured from real disk.
 * Avoids the anti-pattern of checking existence after files are removed.
 */
export async function enumerateUserDevFlowContent(devflowDir: string): Promise<string[]> {
  const items: string[] = [];

  for (const entry of userContentPaths(devflowDir)) {
    const fullPath = path.join(devflowDir, entry.relPath);
    try {
      if (entry.isDir) {
        const children = await fs.readdir(fullPath);
        if (children.length === 0) continue;
      } else {
        await fs.access(fullPath);
      }
      items.push(entry.label);
    } catch { /* absent or unreadable */ }
  }

  return items;
}

/** One Devflow-owned install artifact under `devflowDir`. */
export interface InstallArtifactEntry {
  /** Path relative to `devflowDir` — or, when `isPrefix`, a basename prefix. */
  relPath: string;
  /** Directories are removed recursively. */
  isDir?: boolean;
  /**
   * `relPath` is a basename PREFIX matching every direct child of `devflowDir`
   * that starts with it, not a path. For artifacts written under a per-run
   * `mktemp` name, where the set of paths exists only on disk.
   */
  isPrefix?: boolean;
  /**
   * For a prefix entry: the whole basename must also match this shape. A child that
   * starts with the prefix but has another shape is not a Devflow artifact.
   */
  shape?: RegExp;
  /**
   * For a prefix entry: the child must be a real directory. A link or a file with a
   * matching name is left alone, whatever it points at.
   */
  realDirOnly?: boolean;
  /**
   * For a prefix entry: the child must be a regular file. A link or a directory with a
   * matching name is left alone, whatever it points at.
   */
  realFileOnly?: boolean;
}

/** `text` as a regular-expression source, every character literal. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The name of a move lock or journal: the shared prefix, a 16-digit lowercase hex key, then `suffix`. */
function moveFileShape(suffix: string): RegExp {
  return new RegExp(`^${escapeRegExp(MOVE_LOCK_PREFIX)}[0-9a-f]{16}${escapeRegExp(suffix)}$`);
}

/**
 * The curation move's lock, one directory per ledger root, taken directly in the machine
 * directory: `.curation-move-<16 lowercase hex>.lock`. The store builds the name from a
 * hash of the real ledger root, so the names exist only on disk. The prefix and the
 * suffix are the ones the path helpers hold (project-paths.ts).
 */
const CURATION_MOVE_LOCK_SHAPE = moveFileShape(MOVE_LOCK_SUFFIX);

/**
 * The curation move's journal, one regular file per ledger root, beside the lock:
 * `.curation-move-<16 lowercase hex>.journal`, with the same key as the lock. It exists
 * only while a set move is unfinished, and a crash leaves it behind. A file named
 * `.curation-move.journal` inside a project's old ledger folder is no journal of the
 * move and is not matched here.
 */
const CURATION_MOVE_JOURNAL_SHAPE = moveFileShape(MOVE_JOURNAL_SUFFIX);

/**
 * The manifest lock, a directory in the machine directory (manifest-lock.ts), and the
 * directory a stale break moves aside: `manifest.json.lock` and
 * `manifest.json.lock.stale-<digits>-<12 lowercase hex>`. A holder that dies in its
 * critical section leaves the first, a break whose removal failed leaves the second.
 */
const MANIFEST_LOCK_SHAPE = new RegExp(
  `^${escapeRegExp(MANIFEST_LOCK_NAME)}(?:${escapeRegExp(MANIFEST_LOCK_STALE_MARK)}[0-9]+-[0-9a-f]{12})?$`,
);

/** Whether `child` of `devflowDir` is a real directory (a link is not followed). */
async function isRealDirectory(devflowDir: string, child: string): Promise<boolean> {
  try {
    return (await fs.lstat(path.join(devflowDir, child))).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `child` of `devflowDir` is a regular file (a link is not followed). */
async function isRegularFile(devflowDir: string, child: string): Promise<boolean> {
  try {
    return (await fs.lstat(path.join(devflowDir, child))).isFile();
  } catch {
    return false;
  }
}

/**
 * Expand `installArtifactPaths` against real disk.
 *
 * Exact entries pass through untouched; a prefix entry becomes one entry per
 * matching direct child of `devflowDir`. This is the ONE place a prefix turns
 * into paths, so the removal loop and the dry-run preview cannot disagree about
 * what a prefix covers. An unreadable or absent `devflowDir` yields the exact
 * entries alone — absent is the ordinary case here, never an error.
 */
export async function resolveInstallArtifactPaths(
  devflowDir: string,
): Promise<ReadonlyArray<{ relPath: string; isDir?: boolean }>> {
  const resolved: Array<{ relPath: string; isDir?: boolean }> = [];
  let children: string[] | null = null;

  for (const entry of installArtifactPaths(devflowDir)) {
    if (entry.isPrefix !== true) {
      resolved.push({ relPath: entry.relPath, isDir: entry.isDir });
      continue;
    }
    if (children === null) {
      try {
        children = await fs.readdir(devflowDir);
      } catch {
        children = [];
      }
    }
    for (const child of children) {
      if (!child.startsWith(entry.relPath)) continue;
      if (entry.shape !== undefined && !entry.shape.test(child)) continue;
      if (entry.realDirOnly === true && !(await isRealDirectory(devflowDir, child))) continue;
      if (entry.realFileOnly === true && !(await isRegularFile(devflowDir, child))) continue;
      resolved.push({ relPath: child, isDir: entry.isDir });
    }
  }

  return resolved;
}

/**
 * Single source of truth for Devflow-owned install artifacts under `devflowDir`.
 *
 * Returns the paths that the artifact-removal loop inside `removeDevFlowInstallArtifacts`
 * removes. Note: manifest.json is removed by a separate step at the top of that
 * function and is NOT in this list. Having this as a standalone pure function
 * lets callers (dry-run display, tests) enumerate the artifact set without
 * duplicating the list.
 *
 * @D8 Nothing returned here may overlap with `userContentPaths` — the two lists
 * are the whole of what Devflow puts in `~/.devflow`, and a name in both is
 * deleted whatever the user answers to the full-wipe prompt. Checked two ways:
 * mechanically, by intersecting the `relPath` sets of the two functions and
 * checking no user path falls UNDER a prefix entry (so an entry added to either
 * list is covered the day it lands), and behaviourally, by test 9f — every
 * enumerated user item survives an artifact-only removal.
 *
 * Entries marked `isPrefix` name a FAMILY of per-invocation basenames rather
 * than one path; `resolveInstallArtifactPaths` is what turns them into paths.
 * Every consumer goes through that resolver, so a prefix entry is never treated
 * as a literal filename.
 *
 * @param devflowDir - Absolute path to ~/.devflow (used to resolve cache dir).
 */
export function installArtifactPaths(devflowDir: string): ReadonlyArray<InstallArtifactEntry> {
  return [
    // migration run-state — removed so migrations re-run cleanly on reinstall
    { relPath: 'migrations.json' },
    // per-agent model overrides — removed so stale keys (keyed to renamed/deleted agents
    // from the wave-4 agent roster rename) cannot silently re-apply on reinstall (AC-P1-F4)
    { relPath: 'agent-models.json' },
    // cost history — auto-generated session telemetry, not user-authored.
    // The whole costs/ tree is removed so sessions/ and archive.jsonl cannot
    // drift from their write sites in src/hud/cost-history.ts.
    { relPath: 'costs', isDir: true },
    // proxy artifacts
    { relPath: 'proxy.json' },
    { relPath: 'proxy-routing.json' },
    { relPath: 'proxy.pid' },
    { relPath: '.proxy-spawn.lock', isDir: true },
    // tracker runtime artifacts — the Tracker agent's atomic claim file, the
    // per-provider inference attempt counters (and the single counter earlier
    // releases kept), and the machine provider sentinel the SessionStart hook
    // reads. All are machine state with no user-authored content, so they go on
    // this list; the conventions under `tracker/` beside them, and the legacy
    // `tracker.md` and its backups, are USER CONTENT (OD-15) and are deliberately
    // NOT here (@D8: the two lists stay disjoint).
    { relPath: TRACKER_CLAIM_FILE },
    ...TRACKER_ATTEMPTS_NAMES.map(name => ({ relPath: name })),
    { relPath: TRACKER_LEGACY_ATTEMPTS_FILE },
    { relPath: TRACKER_ENABLED_FILE },
    // The CLAUDE.md import audit's stamp (D-AUDIT-STAMP): machine state the SessionStart
    // hook and `devflow init` write, holding paths, existence flags and finding keys and no
    // user-authored content. Its sibling temp file, `<stamp>.tmp.<pid>`, is a prefix family:
    // a SIGKILL between the write and the rename leaves one behind.
    { relPath: CLAUDE_MD_AUDIT_STAMP_FILE },
    { relPath: CLAUDE_MD_AUDIT_STAMP_TMP_PREFIX, isPrefix: true },
    // The agent's scrubbed staging file, one per invocation under a mktemp name
    // it removes from a trap — a SIGKILL outruns the trap and leaves it behind.
    // A prefix, because the names exist only on disk. Content is a scrubbed copy
    // that was never placed, so it is machine state like the three above.
    { relPath: TRACKER_STAGED_PREFIX, isPrefix: true },
    // The curation move's per-root lock directory. A crash between taking the lock and
    // releasing it leaves one behind, and its name carries a hash that exists only on disk.
    // Only a real directory of exactly that shape goes; the move's skip markers sit under
    // logs/ and go with it.
    { relPath: MOVE_LOCK_PREFIX, isPrefix: true, isDir: true, shape: CURATION_MOVE_LOCK_SHAPE, realDirOnly: true },
    // The move's journal beside it. A crash between two renames of the ledger set leaves
    // one behind. Only a regular file of exactly that shape goes.
    { relPath: MOVE_LOCK_PREFIX, isPrefix: true, shape: CURATION_MOVE_JOURNAL_SHAPE, realFileOnly: true },
    // The manifest lock, and the directory a stale break moved aside. A crash inside the
    // critical section leaves the first; a failed cleanup leaves the second, whose name
    // carries a pid and a random suffix. Only a real directory of exactly that shape goes.
    { relPath: MANIFEST_LOCK_NAME, isPrefix: true, isDir: true, shape: MANIFEST_LOCK_SHAPE, realDirOnly: true },
    // per-project hook logs (logs/{project-slug}/) AND global logs — remove the
    // whole logs/ tree; covers proxy.log, debug logs, and any project-slug dirs.
    { relPath: 'logs', isDir: true },
    // Model-discovery + HUD component caches. hudCacheDir() is the authoritative
    // accessor for the cache/ parent (modelCacheDir() resolves beneath it), so the
    // removal site stays byte-locked to the write sites.
    { relPath: path.relative(devflowDir, hudCacheDir(devflowDir)), isDir: true },
  ];
}

/**
 * Remove Devflow install artifacts from devflowDir: manifest.json, migrations.json,
 * proxy artifacts, logs/, costs/, and cache/.
 * The scripts/ directory is already removed by removeAllDevFlow.
 *
 * Used for:
 *   - Local scope (always — never removes project data under .devflow/)
 *   - User scope when full-dir confirm is declined or session is non-interactive
 *
 * @D8 Nothing enumerated by enumerateUserDevFlowContent may appear in this list.
 * This function runs on the decline, cancel, non-interactive AND --keep-docs paths,
 * so an entry here is deleted even when the user answers "no" to the full wipe.
 * User-authored state (everything in `userContentPaths`: skill/rule shadows,
 * the install backups, preference-profile.md, the tracker conventions with the legacy tracker.md and
 * its backups, the global tuning file under both names, hud.json) is removed only by
 * the confirmed full-dir rm.
 * agent-models.json is an INSTALL ARTIFACT (stale per-agent overrides silently
 * re-apply to renamed/deleted agents on reinstall — AC-P1-F4) and therefore
 * belongs in this list, not in enumerateUserDevFlowContent.
 *
 * Each removal passes `mayChange` first, which skips one a symbolic link would
 * redirect in a legacy local install (D-CLI-NO-SYMLINK, legacyLocalChangeGuard).
 */
export async function removeDevFlowInstallArtifacts(
  devflowDir: string,
  verbose: boolean,
  mayChange: ChangeGuard = changeUserOwned,
): Promise<void> {
  const manifestPath = path.join(devflowDir, 'manifest.json');
  if (await mayChange(manifestPath)) {
    try {
      await fs.rm(manifestPath, { force: true });
      if (verbose) {
        p.log.success('Removed manifest.json');
      }
    } catch (error) {
      p.log.warn(`Could not remove manifest.json: ${error}`);
    }
  }

  // Proxy install artifacts — remove non-fatally (per-item failure isolation)
  // Inform the user if a proxy relay process is still running (never kill — informational only).
  try {
    const pidContent = await fs.readFile(path.join(devflowDir, 'proxy.pid'), 'utf-8');
    const pid = parseInt(pidContent.trim(), 10);
    if (!isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // existence check — throws if process is gone
        p.log.warn(
          `Proxy relay process (PID ${pid}) is still running — it will exit when ` +
          `Claude Code closes, or stop it manually: kill ${pid}`,
        );
      } catch { /* process is gone — nothing to report */ }
    }
  } catch { /* proxy.pid absent or unreadable — non-fatal */ }

  // All install artifacts removed non-fatally. Resolved against
  // disk first, so a per-run staging basename is a real path by the time the
  // containment guard below sees it.
  for (const artifact of await resolveInstallArtifactPaths(devflowDir)) {
    const fullPath = path.join(devflowDir, artifact.relPath);
    // Containment invariant: every artifact must resolve to a path STRICTLY inside
    // devflowDir. A derived relPath that ever collapsed to '' or '..' would turn the
    // recursive rm below into a wipe of devflowDir itself (or an ancestor). Asserting
    // it in production code — not only in tests — keeps the invariant load-bearing
    // (reliability rule) and never throws (engineering rule).
    if (!isContainedIn(devflowDir, artifact.relPath)) {
      continue;
    }
    if (!(await mayChange(fullPath))) continue;
    try {
      await fs.rm(fullPath, { force: true, recursive: artifact.isDir === true });
      if (verbose) p.log.success(`Removed ${artifact.relPath}`);
    } catch { /* absent or unreadable — non-fatal */ }
  }
}

/**
 * Check if Devflow is installed at the given claudeDir by detecting any
 * owned namespace: commands/devflow/, agents/devflow/, or any skill dir
 * whose name starts with the devflow: namespace prefix.
 *
 * Keying off commands/devflow/ alone misses installs where the user selected
 * a commandless plugin set — agents and skills may still be present.
 */
export async function isDevFlowInstalled(claudeDir: string): Promise<boolean> {
  // Check commands namespace
  try {
    await fs.access(path.join(claudeDir, 'commands', 'devflow'));
    return true;
  } catch { /* not present */ }

  // Check agents namespace
  try {
    await fs.access(path.join(claudeDir, 'agents', 'devflow'));
    return true;
  } catch { /* not present */ }

  // Check for any installed skill under the devflow: namespace
  try {
    const entries = await fs.readdir(path.join(claudeDir, 'skills'));
    if (entries.some(e => e.startsWith(SKILL_NAMESPACE))) return true;
  } catch { /* skills dir absent or unreadable */ }

  return false;
}

/** Why a bare legacy skill folder stays: its `SKILL.md` is a file that no release of devflow installed. */
const KEPT_NOT_MADE = 'devflow did not make this folder';
/** Why a bare legacy skill folder stays: there is no regular `SKILL.md`, the folder or file is a link, or a read failed. */
const KEPT_UNDECIDED = 'devflow could not tell if it made this folder';

/** The bare legacy skill folders in the skills folder, split by who made them. */
interface BareLegacySkillPlan {
  /** Folders whose `SKILL.md` is a copy that a release of devflow installed: a full uninstall removes them. */
  readonly remove: readonly string[];
  /** Folders that stay, each with the reason the output gives. */
  readonly keep: ReadonlyArray<{ readonly folder: string; readonly reason: string }>;
}

/**
 * Sort the bare legacy skill folders that exist in `skillsDir` into those a full uninstall removes
 * and those it keeps. The skills folder is shared with Claude Code and other tools, so a bare name
 * (`python`, `plan`) does not prove that devflow made the folder. It is removed only when the check
 * `devflow init` uses finds a `SKILL.md` that a release installed (`judgeBareLegacySkill`). The dry
 * run and the removal both take this one list. A `devflow:` name is in the namespace of devflow, and
 * the prefixed pass removes it. Reads one file per folder at most. Never throws.
 */
async function planBareLegacySkills(skillsDir: string): Promise<BareLegacySkillPlan> {
  const remove: string[] = [];
  const keep: Array<{ folder: string; reason: string }> = [];
  for (const name of new Set(LEGACY_SKILL_NAMES)) {
    if (name.startsWith(SKILL_NAMESPACE)) continue;
    const folder = path.join(skillsDir, name);
    const verdict = await judgeBareLegacySkill(folder, name);
    if (verdict === 'devflow') remove.push(folder);
    else if (verdict === 'other') keep.push({ folder, reason: KEPT_NOT_MADE });
    else if (verdict === 'unknown') keep.push({ folder, reason: KEPT_UNDECIDED });
  }
  return { remove, keep };
}

// ---------------------------------------------------------------------------
// Phase runners — extracted from the action function for readability and
// independent testability.  Each covers one logical stage of the uninstall.
// ---------------------------------------------------------------------------

/**
 * Enumerate paths that would be removed by a full uninstall for the given
 * scope directories, intersected with what actually exists on disk.
 *
 * Extracted from the dry-run loop body so the enumeration logic is
 * independently testable (tests must exercise the production
 * path, not only the pure helper functions).
 *
 * Coverage matches removeAllDevFlow exactly:
 *   1. Whole Claude directories (commands/devflow, agents/devflow, rules/devflow)
 *      and the scripts directory inside devflowDir.
 *   2. ALL skill removal candidates (existence-filtered):
 *      - Prefixed (devflow:name): live registry ∪ LEGACY_SKILL_NAMES.
 *      - Bare (name or devflow-name legacy): LEGACY_SKILL_NAMES ONLY, and only a
 *        folder that devflow made (planBareLegacySkills). ~/.claude/skills/ is
 *        shared; bare dirs for live-registry skill names are by construction
 *        foreign to Devflow. A bare folder that stays is listed as `(kept: <reason>)`.
 *   3. manifest.json (removed separately in removeDevFlowInstallArtifacts).
 *   4. Every artifact path from installArtifactPaths(devflowDir) — the single
 *      source of truth shared with the real removal loop.
 *
 * @param claudeDir  - Target Claude Code directory (e.g. ~/.claude)
 * @param devflowDir - Devflow data directory (e.g. ~/.devflow)
 */
export async function enumerateDryRunExtras(
  claudeDir: string,
  devflowDir: string,
  folderWorkflows: ReadonlySet<string> = WORKFLOW_FOLDER_NAMES,
): Promise<string[]> {
  const extras: string[] = [];

  // 1. Whole directories removed by removeAllDevFlow
  for (const dir of [
    path.join(claudeDir, 'commands', 'devflow'),
    path.join(claudeDir, 'agents', 'devflow'),
    path.join(claudeDir, 'rules', 'devflow'),
    path.join(devflowDir, 'scripts'),
  ]) {
    try { await fs.access(dir); extras.push(dir); } catch { /* absent */ }
  }

  // 2. Skills: enumerate ALL removal candidates that exist on disk.
  // Mirrors removeAllDevFlow's split-pass approach:
  //   Prefixed: live registry ∪ LEGACY_SKILL_NAMES ∪ FEATURE_OWNED_SKILLS
  //   Bare: LEGACY_SKILL_NAMES only, and only a folder that devflow made — shared
  //         skills/ dir; live-registry bare dirs are by construction foreign to Devflow.
  // FEATURE_OWNED_SKILLS (compliance) is included so full uninstall removes
  // devflow:compliance even though it left the plugin registry (step 1.5).
  // The workflow skill folders (D-WORKFLOW-FOLDER-INSTALL) join through getAllSkillNames.
  const prefixedSkillNames = new Set([...getAllSkillNames(folderWorkflows), ...LEGACY_SKILL_NAMES, ...FEATURE_OWNED_SKILLS]);
  const skillsDir = path.join(claudeDir, 'skills');
  for (const skillName of prefixedSkillNames) {
    const prefixedPath = path.join(skillsDir, prefixSkillName(skillName));
    try { await fs.access(prefixedPath); extras.push(prefixedPath); } catch { /* absent */ }
  }
  const bareSkills = await planBareLegacySkills(skillsDir);
  extras.push(...bareSkills.remove);
  for (const { folder, reason } of bareSkills.keep) extras.push(`${escapeName(folder)} (kept: ${reason})`);

  // 3. manifest.json — removed separately by removeDevFlowInstallArtifacts
  //    (NOT in installArtifactPaths). List it here so the preview is complete.
  const manifestPath = path.join(devflowDir, 'manifest.json');
  try { await fs.access(manifestPath); extras.push(manifestPath); } catch { /* absent */ }

  // 4. All install artifacts — derived from the single source of truth shared
  //    with the real removal loop (removeDevFlowInstallArtifacts).
  //    Guard with fs.access so files that never existed don't pollute the preview.
  //    (F7: previously pushed unconditionally, inflating the dry-run list with
  //    paths that were never on disk.)
  for (const artifact of await resolveInstallArtifactPaths(devflowDir)) {
    const fullPath = path.join(devflowDir, artifact.relPath);
    try {
      await fs.access(fullPath);
      extras.push(fullPath);
    } catch { /* absent — omit from dry-run preview */ }
  }

  return extras;
}

/**
 * DRY-RUN PHASE: display what would be removed without making any changes.
 *
 * Selective: uses the pure registry-diff plan from formatDryRunPlan.
 * Full: enumerates what is actually on disk for each detected scope so the
 *       output reflects legacy/orphaned assets that the registry cannot see.
 *
 * @param opts.scopesToUninstall - Scopes detected in the setup phase.
 * @param opts.isSelectiveUninstall - true when --plugin was given.
 * @param opts.selectedPlugins - The plugin subset for selective mode.
 * @param opts.installedPlugins - What the manifest records as installed. The
 *   dry-run and the real removal MUST receive the same list, or the preview
 *   describes an outcome the removal does not produce.
 */
export async function runDryRunPhase(opts: {
  scopesToUninstall: ReadonlyArray<UninstallScope>;
  isSelectiveUninstall: boolean;
  selectedPlugins: PluginDefinition[];
  installedPlugins: PluginDefinition[];
}): Promise<void> {
  const { scopesToUninstall, isSelectiveUninstall, selectedPlugins, installedPlugins } = opts;

  p.log.info(`Scope(s): ${[...scopesToUninstall].join(', ')} (dry-run shows all detected scopes)`);

  if (isSelectiveUninstall) {
    // Selective: computed against the INSTALLED list, the same argument the real
    // removal is given below — a preview computed from a different list is a
    // preview of a different uninstall.
    const assets = computeAssetsToRemove(selectedPlugins, installedPlugins);
    const plan = formatDryRunPlan(assets);
    for (const line of plan.split('\n')) {
      p.log.info(line);
    }
  } else {
    // Full uninstall: the real path does rm -rf on entire directories plus a
    // skills sweep. Enumerate what is actually on disk for each detected scope
    // rather than computing from the registry (which misses legacy/orphaned assets).
    const extras: string[] = [];
    const gitRoot = scopesToUninstall.includes('local') ? await getGitRoot() : null;
    for (const scope of [...scopesToUninstall]) {
      const paths = await scopeInstallPaths(scope, gitRoot);
      if (paths === null) continue;
      extras.push(...await enumerateDryRunExtras(paths.claudeDir, paths.devflowDir));
    }
    // Project data under <gitRoot>/.devflow — the same plan the real cleanup phase
    // resolves, so the preview lists exactly what a confirmed removal deletes.
    const projectRoot = await getGitRoot(process.cwd());
    const projectData = await resolveProjectDataPlan({
      gitRoot: projectRoot,
      homeDir: getHomeDirectory(),
      machineDevflowDir: getInstallationPaths().devflowDir,
    });
    if (projectData.kind === 'plan') {
      for (const entry of projectData.plan.remove) {
        extras.push(`${path.join(projectData.plan.dir, entryLabel(entry))} (if confirmed)`);
      }
      for (const entry of projectData.plan.keepPaused) {
        extras.push(`${path.join(projectData.plan.dir, entryLabel(entry))} (kept: ${KEEP_PAUSED_REASON_ONE})`);
      }
    } else {
      const skipped = formatProjectDataSkip(projectData.reason, projectRoot);
      if (skipped !== null) extras.push(skipped);
    }
    extras.push('hooks removed from settings.json');

    for (const line of extras) {
      p.log.info(`  ${line}`);
    }
  }
}

/**
 * After a selective uninstall removed a retired agent file, write the current commands
 * and agents of the plugins that stay installed.
 *
 * A retired agent file only exists on a machine that ran an older release. That
 * release's commands, for the plugins that stay, still spawn the retired name, and the
 * agents that replaced it are not installed. Removing the file without this step would
 * leave those plugins unable to spawn their agents until the next full `devflow init`.
 *
 * Writes only commands and agents, through the same copy path `devflow init` uses
 * ({@link installCommandsAndAgents}). It does not touch the hooks, the scripts or
 * settings.json, so the notice tells the user to run `devflow init` for those.
 *
 * Never runs in a legacy local scope (D-CLI-NO-SYMLINK): a repository can commit a command
 * file as a symbolic link, and the copy writes through it. `devflow init` can not update a
 * legacy local install either, so the warning tells the user to remove it in full.
 *
 * In the user scope the copy writes into neither folder when either is a link or not a folder,
 * whatever the caller's guard says: writing only one folder would pair old commands with new
 * agents. The refused folder is recorded in `links`. A command or agent file that is a link is
 * replaced by a real file and recorded in `links` too; what it pointed to is left as it was.
 *
 * Skipped, with a warning, when there is no readable manifest or it lists no known plugin (the
 * retained set would be a guess), or when a folder is a link, not a folder, or behind a link the
 * caller's guard refuses. Those warnings name `devflow init` as the remedy. When the copy fails, it stops
 * at the first failure: files it wrote before then stay, and the warning names the same
 * remedy. Never throws: an uninstall must finish.
 * Agent model lines are reverted again after the copy, as the selective phase does before
 * its removal, so a freshly written agent carries no external-model line. Like the
 * selective phase, it prints the warnings of that revert only with `verbose`.
 */
export async function refreshRetainedCommandsAndAgents(opts: {
  claudeDir: string;
  devflowDir: string;
  retained: PluginDefinition[];
  retiredAgents: readonly string[];
  /** The scope the directories belong to (default `user`). */
  scope?: UninstallScope;
  /** Whether to print the warnings of the agent model revert, as the selective phase does. */
  verbose?: boolean;
  mayChange?: ChangeGuard;
  /** Where the folders refused and the file links replaced are recorded, for the caller's summary. */
  links?: LinkReport;
}): Promise<void> {
  const { claudeDir, devflowDir, retained, retiredAgents } = opts;
  const scope = opts.scope ?? 'user';
  const verbose = opts.verbose ?? false;
  const mayChange = opts.mayChange ?? changeUserOwned;
  const links = opts.links ?? newLinkReport();
  const agentsDir = path.join(claudeDir, 'agents', 'devflow');
  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  const retired = `Removed the agent file(s) of an older Devflow release: ${retiredAgents.join(', ')}.`;
  const remedy = 'Run `devflow init` to update the commands, agents, hooks and scripts of the plugins that stay installed.';

  if (retained.length === 0) return;

  if (scope === 'local') {
    p.log.warn(`${retired} Devflow does not rewrite files in a legacy local install, so the remaining commands can still name the removed agents. Remove the legacy local install in full with \`devflow uninstall --scope local\`.`);
    return;
  }

  // readManifest returns null for a missing file and for one it can not parse or validate.
  const manifest = await readManifest(devflowDir).catch(() => null);
  if (manifest === null) {
    p.log.warn(`${retired} There is no readable manifest, so Devflow did not rewrite the remaining files. ${remedy}`);
    return;
  }
  if (manifest.plugins.length === 0) {
    p.log.warn(`${retired} The manifest lists no plugins, so Devflow did not rewrite the remaining files. ${remedy}`);
    return;
  }
  // resolveInstalledPlugins falls back to the whole registry when no manifest name resolves, so
  // the retained set would hold plugins that were never installed.
  if (!manifest.plugins.some(name => DEVFLOW_PLUGINS.some(plugin => plugin.name === name))) {
    p.log.warn(`${retired} The manifest lists no known plugin, so Devflow did not rewrite the remaining files. ${remedy}`);
    return;
  }
  let blocked = !(await mayChange(agentsDir)) || !(await mayChange(commandsDir));
  if (!blocked) {
    // The caller's guard may pass everything. Neither folder is written when it is a link or not a folder.
    const agentsRefused = await refuseUnrealFolder(links, agentsDir);
    const commandsRefused = await refuseUnrealFolder(links, commandsDir);
    blocked = agentsRefused || commandsRefused;
  }
  if (blocked) {
    p.log.warn(`${retired} A linked folder blocks the rewrite. ${remedy}`);
    return;
  }

  try {
    await installCommandsAndAgents({
      plugins: retained,
      agentsMap: buildAssetMaps(retained).agentsMap,
      claudeDir,
      curation: manifest.features.curation,
      compliance: manifest.features.compliance.enabled,
      trackerServers: effectiveTrackerServers(manifest.features.tracker),
      links,
      warn: (msg) => p.log.warn(msg),
    });
  } catch (err) {
    p.log.warn(`${retired} Devflow could not write the current commands and agents (${err instanceof Error ? err.message : String(err)}). ${remedy}`);
    return;
  }

  try {
    await revertExternalAgents({ installDir: agentsDir, devflowDir, onWarning: (msg) => { if (verbose) p.log.warn(msg); } });
  } catch { /* the revert is best effort, as in the selective phase */ }

  p.log.info(`${retired} Devflow wrote the current commands and agents of the plugins that stay installed. Run \`devflow init\` to update the hooks and scripts.`);
}

/**
 * Re-render the installed orchestrator charter for the plugins that stay after a selective removal, so it
 * stops routing to a workflow whose skill was just removed, and take the implement sentinel away when
 * implement is among the removed.
 *
 * D-CHARTER-INSTALL-RENDER: the set comes from the MANIFEST record, read without a heal so the file stays
 * byte-identical, which still lists the removed plugins until the caller drops the record, never from the
 * registry fallback of {@link resolveInstalledPlugins}. The record is read only where the change guard lets
 * a change through. With no usable record there is nothing to render from and the installed charter stays
 * as it is, but the sentinel needs no record and goes when implement is among the removed. An uninstall
 * never creates a file, so a machine whose charter is not installed gets none. A failure is a warning,
 * never a failure of the uninstall.
 */
async function rerenderCharterAfterRemoval(
  devflowDir: string,
  removedPluginNames: readonly string[],
  mayChange: ChangeGuard,
): Promise<void> {
  const scriptsDir = path.join(devflowDir, 'scripts');
  const warn = (msg: string): void => p.log.warn(msg);
  const recorded = (await mayChange(path.join(devflowDir, 'manifest.json'))) ? await readManifestPlugins(devflowDir) : null;
  const retained = charterPluginsAfterRemoval(recorded, removedPluginNames);
  if (retained === null) {
    await removeHandoffSentinel({ scriptsDir, removedPlugins: removedPluginNames, warn, mayChange });
    return;
  }
  await installRenderedCharter({ scriptsDir, plugins: retained, warn, mayChange, mode: 'uninstall' });
}

/**
 * SELECTIVE PHASE (per scope): revert agent model overrides, remove the
 * selected plugins' assets, and clean up the ambient hook if the ambient
 * plugin is being removed.
 *
 * @param opts.claudeDir   - Target Claude Code directory for this scope.
 * @param opts.devflowDir  - Devflow data directory for this scope.
 * @param opts.selectedPlugins - Plugin subset to remove.
 * @param opts.verbose     - Whether to emit verbose log lines.
 *
 * Nothing is read, written or removed through a link at or below a Devflow install folder. A
 * Devflow folder that is a link, or not a folder, is left as it was; the phase prints one line for
 * each and returns them, with the file links it replaced, in the {@link LinkReport}.
 */
export async function runSelectivePhaseForScope(opts: {
  claudeDir: string;
  devflowDir: string;
  selectedPlugins: PluginDefinition[];
  verbose: boolean;
  /** What the manifest records as installed — the retained set is computed from it. */
  installedPlugins?: PluginDefinition[];
  /**
   * The scope these directories belong to (default `user`). A `local` scope never
   * purges the legacy commands rule under the user's Claude directory
   * (D-LEGACY-LOCAL-CLEANUP).
   */
  scope?: UninstallScope;
}): Promise<LinkReport> {
  const { claudeDir, devflowDir, selectedPlugins, verbose } = opts;
  const scope = opts.scope ?? 'user';
  const installedPlugins = opts.installedPlugins ?? DEVFLOW_PLUGINS;
  const links = newLinkReport();
  // D-CLI-NO-SYMLINK: a legacy local install's removals and rewrites pass this first. In the user
  // scope the guard refuses a linked Devflow folder and records it in `links`.
  const mayChange = scopeChangeGuard(scope, { claudeDir, devflowDir }, links);

  // Revert GPT agent frontmatter BEFORE removing agent files — strips GPT model
  // lines from installed agent frontmatter while the files are still present.
  // Non-fatal: tolerate missing agents dir or revert errors.
  {
    const agentsInstallDir = path.join(claudeDir, 'agents', 'devflow');
    try {
      await fs.access(agentsInstallDir);
      if (await mayChange(agentsInstallDir)) {
        await revertExternalAgents({
          installDir: agentsInstallDir,
          devflowDir,
          onWarning: (msg) => { if (verbose) p.log.warn(msg); },
        });
      }
    } catch { /* agents dir absent or revert failed — non-fatal */ }
  }

  // In the user scope the removal builds its own guard over the same report, which also checks each
  // orphan it sweeps; a legacy local install keeps the guard above.
  const sweeps = await removeSelectedPlugins(
    claudeDir,
    selectedPlugins,
    verbose,
    installedPlugins,
    scope === 'local' ? mayChange : undefined,
    links,
  );

  // A retired agent file means the install is from an older release, and the commands of the
  // plugins that stay installed still spawn the name that was just removed. Write their
  // current commands and agents so the install stays whole. Runs before the language stamp
  // below, which then restamps the command this wrote.
  if (sweeps.agents.removed.length > 0) {
    const removed = new Set(selectedPlugins.map(sp => sp.name));
    await refreshRetainedCommandsAndAgents({
      claudeDir,
      devflowDir,
      retained: installedPlugins.filter(plugin => !removed.has(plugin.name)),
      retiredAgents: sweeps.agents.removed,
      scope,
      verbose,
      mayChange,
      links,
    });
  }

  // D-LANGUAGE-FOCUS-STAMP: re-stamp the installed /code-review from the selection that REMAINS.
  // A language plugin owns a skill and no command, so removing it deletes the skill while its
  // name would stay on the stamped line, and /code-review would spawn a focus whose skill is gone.
  // The remaining selection is the retained set the removal above used (installedPlugins minus the
  // selected plugins, D-RETAIN-FROM-MANIFEST), so the stamp and the skills on disk cannot disagree.
  // Narrowly scoped: only the stamped line of a command that is still installed is rewritten, and
  // nothing else converges here. A damaged copy is a warning, never a failure.
  {
    const removed = new Set(selectedPlugins.map(sp => sp.name));
    await restampInstalledCommands({
      claudeDir,
      effectivePlugins: installedPlugins.filter(plugin => !removed.has(plugin.name)),
      warn: (msg) => p.log.warn(msg),
      mayChange,
    });
  }

  // D-CHARTER-INSTALL-RENDER: the charter stops routing to the removed workflows. It reads the manifest
  // record, so it runs before the record is dropped below.
  await rerenderCharterAfterRemoval(devflowDir, selectedPlugins.map(sp => sp.name), mayChange);

  // D-UNINSTALL-DROPS-PLUGIN: the manifest is the install record `devflow init` seeds its plugin
  // selection from (a re-init keeps the prior selection), so a plugin removed here but still listed
  // would be installed again by the next plain init. Take the selected names off the list;
  // knownPlugins and every other key stay.
  // Behind the scope guard like every other write here. A failed write is a warning, never a failure.
  {
    const manifestPath = path.join(devflowDir, 'manifest.json');
    if (await mayChange(manifestPath)) {
      const recorded = await removeManifestPlugins(devflowDir, selectedPlugins.map(sp => sp.name));
      if (!recorded.ok) {
        p.log.warn(`Could not drop the plugin from manifest.json — a later devflow init would install it again: ${recorded.error}`);
      } else if (verbose && recorded.removed.length > 0) {
        p.log.success(`Removed ${recorded.removed.join(', ')} from manifest.json`);
      }
    }
  }

  // Clean up ambient hook if ambient plugin is being removed
  if (selectedPlugins.some(sp => sp.name === 'devflow-ambient')) {
    const settingsPath = path.join(claudeDir, 'settings.json');
    try {
      const settings = await fs.readFile(settingsPath, 'utf-8');
      const updated = await removeAmbientHook(settings, { purgeLegacyRule: scope === 'user' });
      if (updated !== settings && await mayChange(settingsPath)) {
        await writeSettingsFileAtomic(settingsPath, updated);
        if (verbose) {
          p.log.success('Ambient mode hooks removed from settings.json');
        }
      }
    } catch { /* settings.json may not exist */ }
  }

  logLinkReport(links);
  return links;
}

/**
 * FULL PHASE (per scope): revert agent model overrides, remove all Devflow
 * assets from the scope, then perform scope-appropriate devflowDir cleanup.
 *
 * Local scope: remove only install artifacts — project data (memory, curation,
 *   docs, features) is always preserved under the git root.
 * User scope: interactive TTY with user-authored content → confirm before wiping
 *   ~/.devflow/; non-interactive or no user content → artifacts-only.
 *
 * @param opts.scope            - 'user' or a legacy 'local' install.
 * @param opts.claudeDir        - Target Claude Code directory for this scope.
 * @param opts.devflowDir       - Devflow data directory for this scope.
 * @param opts.devflowScriptsDir - scripts/ sub-directory removed by removeAllDevFlow.
 * @param opts.verbose          - Whether to emit verbose log lines.
 * @param opts.keepDocs         - When true, suppresses the full-dir prompt (artifacts-only).
 * @param opts.isTTY            - Whether the session is interactive. Injected rather than
 *   read from process.stdin so the prompt gate is an explicit input (matching
 *   resolveDevflowDirCleanup) instead of an ambient global a test cannot control.
 * @param opts.confirm          - The prompt for the full-dir wipe (default `p.confirm`).
 */
export async function runFullPhaseForScope(opts: {
  scope: UninstallScope;
  claudeDir: string;
  devflowDir: string;
  devflowScriptsDir: string;
  verbose: boolean;
  keepDocs: boolean;
  isTTY: boolean;
  confirm?: ConfirmPrompt;
}): Promise<void> {
  const { scope, claudeDir, devflowDir, devflowScriptsDir, verbose, keepDocs, isTTY } = opts;
  const confirm: ConfirmPrompt = opts.confirm ?? p.confirm;
  // D-CLI-NO-SYMLINK: a legacy local install's removals and rewrites pass this first.
  const mayChange = scopeChangeGuard(scope, { claudeDir, devflowDir });

  // Revert GPT agent frontmatter before removing agents — ensures no orphaned
  // GPT model lines remain if agents dir is preserved by a later partial flow.
  // Non-fatal: tolerate missing agents dir or revert errors.
  // The revert rewrites the files in the folder, so a folder that is a link is not reverted: the
  // removal below takes the link away whole and the files it led to stay as they are.
  {
    const agentsInstallDir = path.join(claudeDir, 'agents', 'devflow');
    try {
      await fs.access(agentsInstallDir);
      if (await mayChange(agentsInstallDir) && !(await isUnrealFolder(agentsInstallDir))) {
        await revertExternalAgents({
          installDir: agentsInstallDir,
          devflowDir,
          onWarning: (msg) => { if (verbose) p.log.warn(msg); },
        });
      }
    } catch { /* agents dir absent or revert failed — non-fatal */ }
  }

  // removeAllDevFlow removes Claude Code assets (commands, agents, rules, skills)
  // and devflowDir/scripts/. Scope-aware cleanup handles the rest of devflowDir.
  await removeAllDevFlow(claudeDir, devflowScriptsDir, verbose, mayChange);

  if (scope === 'local') {
    // Local scope: devflowDir is gitRoot/.devflow/ which holds project data
    // (memory, curation, features, docs, config.json). Never remove those —
    // only remove install artifacts: scripts/ (done above) + manifest.json and
    // the other Devflow-generated artifacts (see removeDevFlowInstallArtifacts).
    await removeDevFlowInstallArtifacts(devflowDir, verbose, mayChange);
    p.log.info('Local project data (memory, curation, features, docs) preserved');
  } else {
    // User scope (devflowDir = ~/.devflow/): offer full cleanup behind a confirm gate
    // that enumerates user-authored content worth backing up before wiping the dir.
    // Non-interactive, no user content, or precondition guard failure → artifacts-only.
    const userContent = await enumerateUserDevFlowContent(devflowDir);
    const cleanupDecision = resolveDevflowDirCleanup({
      isTTY,
      userContent,
      devflowDir,
      homeDir: os.homedir(),
      keepDocs,
    });

    if (cleanupDecision === 'artifacts-only') {
      await removeDevFlowInstallArtifacts(devflowDir, verbose);
      if (!isTTY && userContent.length > 0) {
        p.log.info(`${devflowDir} preserved (non-interactive mode — removing scripts and install artifacts only)`);
      }
    } else {
      // cleanupDecision === 'prompt': interactive session with user-authored content present.
      p.log.info(`User-authored content in ${devflowDir}:`);
      for (const item of userContent) {
        p.log.info(`  ${item}`);
      }

      const confirmFullCleanup = await confirm({
        message: `Remove entire ${devflowDir}? (includes the items listed above, plus logs and install metadata)`,
        initialValue: false,
      });

      if (p.isCancel(confirmFullCleanup)) {
        // removeAllDevFlow already ran — clean up the manifest to leave a consistent
        // state. process.exit() here would skip removeDevFlowInstallArtifacts,
        // leaving a stale manifest.json that points to assets no longer on disk.
        await removeDevFlowInstallArtifacts(devflowDir, verbose);
        p.log.info(`${devflowDir} preserved (full removal cancelled; removing scripts and install artifacts only)`);
      } else if (confirmFullCleanup) {
        await fs.rm(devflowDir, { recursive: true, force: true });
        p.log.success(`${devflowDir} removed`);
      } else {
        await removeDevFlowInstallArtifacts(devflowDir, verbose);
        p.log.info(`${devflowDir} preserved (removing scripts and install artifacts only)`);
      }
    }
  }
}

/**
 * The project-data step of the cleanup phase: list what a confirmed cleanup removes
 * from `<gitRoot>/.devflow` and what it keeps, then remove on an explicit yes.
 *
 * D-UNINSTALL-CARVE-OUT: DEVFLOW_TRACKED_PATHS are never removed. `--keep-docs`,
 * a non-interactive run, a decline and a cancel all leave the directory untouched,
 * and a cancel continues the uninstall rather than exiting. The
 * directory itself is removed only when nothing tracked was in it.
 */
async function runProjectDataStep(
  plan: ProjectDataPlan,
  gates: { keepDocs: boolean; isTTY: boolean; confirm: ConfirmPrompt },
): Promise<void> {
  const shown = `${plan.dir}/`;
  if (plan.remove.length === 0) {
    p.log.info(plan.keepPaused.length === 0
      ? `${shown} preserved (holds only files shared via git)`
      : `${shown} preserved (holds only files shared via git, and ${entryList(plan.keepPaused)}, which stay: ${KEEP_PAUSED_REASON})`);
    return;
  }
  if (gates.keepDocs) {
    p.log.info(`${shown} preserved (--keep-docs)`);
    return;
  }
  if (!gates.isTTY) {
    p.log.info(`${shown} preserved (non-interactive mode)`);
    return;
  }

  for (const line of formatProjectDataPlan(plan)) p.log.info(line);
  const answer = await gates.confirm({
    message: `Remove the project data listed above from ${shown}?`,
    initialValue: false,
  });
  if (!resolveProjectDataCleanup(answer)) {
    p.log.info(p.isCancel(answer)
      ? `${shown} preserved (prompt cancelled — continuing cleanup)`
      : `${shown} preserved`);
    return;
  }

  // Each removal is non-fatal: a failure is reported and the remaining cleanup
  // steps (settings.json hooks above all) still run.
  const removed: ProjectDataEntry[] = [];
  const failed: string[] = [];
  for (const entry of plan.remove) {
    try {
      await fs.rm(path.join(plan.dir, entry.name), { recursive: true, force: true });
      removed.push(entry);
    } catch (err) {
      failed.push(`${entryLabel(entry)} (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`);
    }
  }
  if (plan.keep.length === 0 && plan.keepPaused.length === 0 && failed.length === 0) {
    // Nothing tracked was there: drop the now-empty directory. rmdir refuses a
    // directory something wrote into meanwhile, which is then left in place.
    await fs.rmdir(plan.dir).catch(() => undefined);
  }
  if (removed.length > 0) p.log.success(`Removed from ${shown}: ${entryList(removed)}`);
  if (failed.length > 0) p.log.warn(`Could not remove from ${shown}: ${failed.join(', ')}`);
  if (plan.keep.length > 0) p.log.info(`Kept: ${entryList(plan.keep)}`);
  if (plan.keepPaused.length > 0) p.log.info(`Kept: ${entryList(plan.keepPaused)} (${KEEP_PAUSED_REASON})`);
}

/**
 * CLEANUP PHASE: post-loop extras run only on full uninstall.
 *
 * Steps (all non-fatal, every interactive path gated on opts.isTTY):
 *   1. Project data under `<gitRoot>/.devflow`, minus DEVFLOW_TRACKED_PATHS
 *      (resolveProjectDataPlan; skipped outside a repo, in one rooted at HOME, and
 *      when `.devflow` is a symbolic link)
 *   2. .claudeignore
 *   3. settings.json — remove all Devflow hooks and flags
 *   4. Security deny list
 *   5. Safe-delete shell function
 *
 * This phase touches machine-wide state outside `cwd` — the user's settings.json
 * and shell profile — so both of its ambient inputs are injected: `cwd` (which now
 * also seeds the git-root lookup) and `isTTY`. Reading process.stdin.isTTY directly
 * would leave every destructive prompt gated on a global the caller cannot set,
 * which under a TTY test runner points the prompts at the developer's real files.
 *
 * @param opts.scopesToUninstall - Scopes processed by the scope loop. Steps 4 and 5
 *                                 edit machine-wide files under HOME, so they run
 *                                 only when this includes `user` — a legacy
 *                                 local-only uninstall never touches HOME
 *                                 (D-LEGACY-LOCAL-CLEANUP).
 * @param opts.keepDocs          - When true, the project-data and security prompts are suppressed.
 * @param opts.verbose           - Whether to emit verbose log lines.
 * @param opts.cwd               - Working directory the git root is resolved from; it
 *                                 locates `<gitRoot>/.devflow` and `.claudeignore`
 *                                 (the cwd itself is the `.claudeignore` fallback).
 * @param opts.isTTY             - Whether the session is interactive. Every confirm
 *                                 prompt in this phase is gated on it.
 */
export async function runCleanupPhase(opts: {
  scopesToUninstall: ReadonlyArray<UninstallScope>;
  keepDocs: boolean;
  verbose: boolean;
  cwd: string;
  isTTY: boolean;
  /** Pre-captured managed proxy ports per scope, read BEFORE artifact removal.
   * proxy.json is deleted by removeDevFlowInstallArtifacts (inside runFullPhaseForScope),
   * so reading it inside this phase would always yield the DEFAULT_PROXY_PORT fallback
   * and leave a non-default ANTHROPIC_BASE_URL (e.g. port 4200) unstripped. (F6)
   *
   * A scope with no entry means proxy.json did not exist — the env vars are not
   * Devflow's to remove and only the hooks come out (D-STRIP-1). */
  managedProxyPorts?: ReadonlyMap<string, number>;
  /** The prompt every confirm in this phase goes through (default `p.confirm`). */
  confirm?: ConfirmPrompt;
}): Promise<void> {
  const { scopesToUninstall, keepDocs, verbose, cwd, isTTY } = opts;
  const confirm: ConfirmPrompt = opts.confirm ?? p.confirm;
  // Resolve the git root from the injected cwd, not process.cwd(): otherwise
  // .devflow/ resolves under `cwd` while .claudeignore resolves under the process
  // directory, and the two halves of this phase act on different repositories.
  const gitRoot = await getGitRoot(cwd);

  // 1. Project data under <gitRoot>/.devflow (D-UNINSTALL-CARVE-OUT)
  const projectData = await resolveProjectDataPlan({
    gitRoot,
    homeDir: getHomeDirectory(),
    machineDevflowDir: getInstallationPaths().devflowDir,
  });
  if (projectData.kind === 'plan') {
    await runProjectDataStep(projectData.plan, { keepDocs, isTTY, confirm });
  } else {
    const skipped = formatProjectDataSkip(projectData.reason, gitRoot);
    if (skipped !== null) p.log.info(skipped);
  }

  // 2. .claudeignore
  const claudeignorePath = gitRoot
    ? path.join(gitRoot, '.claudeignore')
    : path.join(cwd, '.claudeignore');

  let claudeignoreExists = false;
  try {
    await fs.access(claudeignorePath);
    claudeignoreExists = true;
  } catch { /* doesn't exist */ }

  if (claudeignoreExists) {
    if (isTTY) {
      const removeClaudeignore = await confirm({
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

  // 3. settings.json (Devflow hooks)
  for (const scope of [...scopesToUninstall]) {
    try {
      const paths = await scopeInstallPaths(scope, gitRoot);
      if (paths === null) continue;
      const settingsPath = path.join(paths.claudeDir, 'settings.json');
      const originalContent = await fs.readFile(settingsPath, 'utf-8');

      // Remove all Devflow hooks and flags in one pass (idempotent)
      let settingsContent = await removeAmbientHook(originalContent, { purgeLegacyRule: scope === 'user' });
      settingsContent = removeMemoryHooks(settingsContent);
      settingsContent = removeCaptureHooks(settingsContent);
      settingsContent = removeDreamHook(settingsContent);
      settingsContent = removeHudStatusLine(settingsContent);
      settingsContent = removeContextHook(settingsContent);
      settingsContent = stripFlags(settingsContent); // also strips viewMode via view-mode registry entry
      settingsContent = stripDevflowTeammateModeFromJson(settingsContent);
      // Remove proxy hooks and ANTHROPIC_BASE_URL env in a single parse-mutate-serialize pass.
      // D-STRIP-1: an absent entry in managedProxyPorts means proxy.json did not exist
      // before artifact removal — no evidence Devflow ever wrote the env vars, so
      // applyProxyTeardownToSettings removes only our hooks and leaves the user's
      // ANTHROPIC_BASE_URL / CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT alone.
      // Hook removal is never gated: our hooks must not survive an uninstall.
      // REG-1: the port-scoped URL strip protects any foreign localhost gateway on a
      // different port — the managedPort value is from the pre-captured proxy.json port.
      {
        const parsedSettings = JSON.parse(settingsContent) as Settings;
        applyProxyTeardownToSettings(parsedSettings, opts.managedProxyPorts?.get(scope));
        settingsContent = JSON.stringify(parsedSettings, null, 2) + '\n';
      }

      // D-CLI-NO-SYMLINK: a legacy local install's settings.json is rewritten only
      // where no symbolic link leads it out of `<gitRoot>/.claude`.
      const mayChange = scope === 'local'
        ? legacyLocalChangeGuard(paths, 'settings.json not edited')
        : changeUserOwned;
      if (settingsContent !== originalContent && await mayChange(settingsPath)) {
        await writeSettingsFileAtomic(settingsPath, settingsContent);
        if (verbose) {
          p.log.success(`Devflow hooks removed from settings.json (${scope})`);
        }
      }

      // The Devflow strippers above (removeAmbientHook, removeMemoryHooks, etc.) surgically
      // remove every Devflow-owned hook entry. When they complete, any remaining
      // settings.hooks entries belong to THIRD-PARTY tools and must be preserved.
      // (F5: a prior bulk-removal block here was incorrectly scoped — it only fired when
      // foreign hooks were present, and would have removed them. It is gone now.)
    } catch {
      // settings.json doesn't exist or can't be parsed — skip
    }
  }

  // Steps 4 and 5 edit the user's settings.json and shell profile: a legacy
  // local-only uninstall stops here (D-LEGACY-LOCAL-CLEANUP).
  if (!scopesToUninstall.includes('user')) return;

  // 4. Security deny list

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
      keepDocs,
      isTTY: isTTY,
    });

    let shouldRemoveSecurity = false;

    if (securityDecision === 'prompt') {
      const removeDenyConfirm = await confirm({
        message: `Remove Devflow security deny list from ${locationLabel}?`,
        initialValue: false,
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
          await writeSettingsFileAtomic(userSettingsPathForSecurity, stripped);
          p.log.success(`Security deny list removed from user settings (${removed.length} entries)`);
        }
      }
      // Strip from managed settings (ENOENT-tolerant via removeManagedSettings)
      if (managedExistsForSecurity) {
        await removeManagedSettings(getPackageRoot(), verbose);
      }
    }
  }

  // 5. Safe-delete shell function
  const shell = detectShell();
  const profilePath = getProfilePath(shell);
  if (profilePath && await isAlreadyInstalled(profilePath)) {
    if (isTTY) {
      const removeSafeDelete = await confirm({
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

export const uninstallCommand = new Command('uninstall')
  .description('Uninstall Devflow from Claude Code')
  .option('--keep-docs', 'Keep .devflow/ directory and project data')
  .option('--scope <type>', 'Uninstall from one scope only: user, or local to remove a legacy project-local install (default: auto-detect both)', /^(user|local)$/i)
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
      // Friendly redirect for retired feature plugins (e.g. devflow-compliance → `devflow compliance`).
      // Strip retired names, emit the notice, and continue with the remaining plugins so that a
      // mixed list like `devflow-implement,devflow-compliance` still uninstalls devflow-implement.
      // Exit 0 only when nothing non-retired remains (compliance-only invocation).
      const rawNames = options.plugin.split(',').map((s: string) => s.trim());
      const redirect = resolveFeatureRedirect(rawNames);
      if (redirect.notice) {
        p.log.info(redirect.notice);
      }
      if (redirect.remaining.length === 0) {
        process.exit(0);
      }
      const { selected, invalid } = parsePluginSelection(redirect.remaining.join(','), DEVFLOW_PLUGINS);
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
    let scopesToUninstall: UninstallScope[] = [];
    const gitRoot = await getGitRoot();

    if (options.scope) {
      scopesToUninstall = [options.scope.toLowerCase() as UninstallScope];
      // A local-only uninstall with no repo-local install to act on stops here,
      // before its cleanup phase can reach the cwd — HOME, in a repo rooted there.
      if (scopesToUninstall[0] === 'local' && await scopeInstallPaths('local', gitRoot) === null) {
        p.log.error('No legacy project-local install here: not in a git repository, or the repository root holds the machine-wide install');
        process.exit(1);
      }
    } else {
      if (await isDevFlowInstalled(getClaudeDirectory())) {
        scopesToUninstall.push('user');
      }

      const legacyPaths = gitRoot === null ? null : await legacyLocalInstallPaths(gitRoot);
      if (legacyPaths !== null && await isDevFlowInstalled(legacyPaths.claudeDir)) {
        scopesToUninstall.push('local');
      }

      if (scopesToUninstall.length === 0) {
        p.log.error('No Devflow installation found');
        p.log.info(`Checked user scope (${getClaudeDirectory()}/) and legacy local scope (git-root/.claude/)`);
        process.exit(1);
      }

      if (scopesToUninstall.length > 1 && !dryRun) {
        if (process.stdin.isTTY) {
          const scopeChoice = await p.select({
            message: 'Found Devflow in multiple scopes. Uninstall from:',
            options: [
              { value: 'both', label: 'Both', hint: 'user + local' },
              { value: 'user', label: 'User scope', hint: `${getClaudeDirectory()}/` },
              { value: 'local', label: 'Local scope', hint: 'git-root/.claude/' },
            ],
          });

          if (p.isCancel(scopeChoice)) {
            p.cancel('Uninstall cancelled.');
            process.exit(0);
          }

          if (scopeChoice !== 'both') {
            scopesToUninstall = [scopeChoice as UninstallScope];
          }
        } else {
          p.log.info('Multiple scopes detected, uninstalling from both...');
        }
      }
    }

    // === DRY RUN: show plan and exit ===
    if (dryRun) {
      // One resolution, handed to the dry-run and (below) to the real removal,
      // so the preview and the outcome are computed from the same list.
      let dryRunInstalled: PluginDefinition[] = DEVFLOW_PLUGINS;
      const dryRunPaths = await scopeInstallPaths(scopesToUninstall[0], gitRoot);
      if (dryRunPaths !== null) {
        dryRunInstalled = await resolveInstalledPlugins(dryRunPaths.devflowDir);
      }
      await runDryRunPhase({
        scopesToUninstall,
        isSelectiveUninstall,
        selectedPlugins,
        installedPlugins: dryRunInstalled,
      });
      p.outro(color.dim('No changes made (dry run)'));
      return;
    }

    // Pre-capture managed proxy ports for each scope BEFORE artifact removal.
    // proxy.json is deleted by removeDevFlowInstallArtifacts (inside runFullPhaseForScope),
    // so reading it after the full phase would always yield DEFAULT_PROXY_PORT. (F6)
    //
    // D-STRIP-1: only populate managedProxyPorts when proxy.json exists — evidence that
    // Devflow has managed the proxy on this machine. runCleanupPhase gates the
    // applyProxyTeardownToSettings call on the port being present in the map, so when the file
    // is absent (never managed), no env strip is attempted and a user's own gateway vars
    // are left untouched.
    const managedProxyPorts = new Map<string, number>();
    if (!isSelectiveUninstall) {
      for (const scope of scopesToUninstall) {
        try {
          const paths = await scopeInstallPaths(scope, gitRoot);
          if (paths === null) continue;
          if (await proxyJsonExists(paths.devflowDir)) {
            const proxyState = await readProxyState(paths.devflowDir);
            if (proxyState.ok) managedProxyPorts.set(scope, proxyState.value.port);
          }
        } catch { /* non-fatal */ }
      }
    }

    // Uninstall from each scope. The folders a selective uninstall refused are counted across the
    // scopes, so the last line can say the removal was done in part. A refusal is reported, not a
    // failure: the exit status stays 0, as it does for a legacy install whose links were skipped.
    const refusedFolders = new Set<string>();
    for (const scope of scopesToUninstall) {
      const paths = await scopeInstallPaths(scope, gitRoot);
      if (paths === null) {
        p.log.warn(`Cannot uninstall ${scope} scope: no repo-local install here`);
        continue;
      }
      const { claudeDir, devflowDir } = paths;
      const devflowScriptsDir = path.join(devflowDir, 'scripts');

      if (scope === 'user') {
        p.log.step(`Uninstalling user scope (${claudeDir})`);
      } else {
        p.log.step('Uninstalling legacy local scope (git-root/.claude/)');
      }

      const scopeRefused = new Set<string>();
      if (isSelectiveUninstall) {
        const links = await runSelectivePhaseForScope({
          claudeDir,
          devflowDir,
          selectedPlugins,
          verbose,
          installedPlugins: await resolveInstalledPlugins(devflowDir),
          scope,
        });
        for (const folder of links.refusedFolders) {
          scopeRefused.add(folder);
          refusedFolders.add(folder);
        }
      } else {
        await runFullPhaseForScope({ scope, claudeDir, devflowDir, devflowScriptsDir, verbose, keepDocs: !!options.keepDocs, isTTY: !!process.stdin.isTTY });
      }

      const pluginLabel = isSelectiveUninstall
        ? ` (${selectedPluginNames.join(', ')})`
        : '';
      const removed = formatPluginRemovedLine(pluginLabel, scopeRefused.size);
      p.log[removed.level](removed.message);
    }

    // === CLEANUP EXTRAS (only for full uninstall) ===
    if (!isSelectiveUninstall) {
      await runCleanupPhase({ scopesToUninstall, keepDocs: !!options.keepDocs, verbose, cwd: process.cwd(), isTTY: !!process.stdin.isTTY, managedProxyPorts });
    }

    p.outro(formatUninstallOutro(refusedFolders.size));
  });

/**
 * Remove all Devflow assets (full uninstall).
 *
 * Each removal passes `mayChange` first, which skips one a symbolic link would
 * redirect in a legacy local install (D-CLI-NO-SYMLINK, legacyLocalChangeGuard).
 */
export async function removeAllDevFlow(
  claudeDir: string,
  devflowScriptsDir: string,
  verbose: boolean,
  mayChange: ChangeGuard = changeUserOwned,
  folderWorkflows: ReadonlySet<string> = WORKFLOW_FOLDER_NAMES,
): Promise<void> {
  const devflowDirectories = [
    { path: path.join(claudeDir, 'commands', 'devflow'), name: 'commands' },
    { path: path.join(claudeDir, 'agents', 'devflow'), name: 'agents' },
    { path: path.join(claudeDir, 'rules', 'devflow'), name: 'rules' },
    { path: devflowScriptsDir, name: 'scripts' }
  ];

  for (const dir of devflowDirectories) {
    if (!(await mayChange(dir.path))) continue;
    try {
      await fs.rm(dir.path, { recursive: true, force: true });
      if (verbose) {
        p.log.success(`Removed Devflow ${dir.name}`);
      }
    } catch (error) {
      p.log.warn(`Could not remove ${dir.name}: ${error}`);
    }
  }

  // Remove Devflow skill directories.
  // ~/.claude/skills/ is shared with other tools; the two passes use different
  // name sets to avoid deleting foreign dirs:
  //
  //   Prefixed pass (devflow:name): live registry ∪ LEGACY_SKILL_NAMES ∪ FEATURE_OWNED_SKILLS.
  //     prefixSkillName() is idempotent for already-prefixed legacy entries.
  //     FEATURE_OWNED_SKILLS (compliance) is included so full uninstall removes
  //     devflow:compliance even though it left the plugin registry (step 1.5).
  //   Bare pass (name or devflow-name legacy): LEGACY_SKILL_NAMES ONLY, and only a folder
  //     whose SKILL.md is a copy that a release of devflow installed (planBareLegacySkills).
  //     Any other bare folder stays and is named. A bare dir whose name matches a
  //     live-registry skill is by construction foreign to Devflow (the devflow: namespace
  //     shipped in dcecda3, 2026-03-30). A bare 'compliance/' dir is also foreign (not in LEGACY_SKILL_NAMES).
  //   The workflow skill folders (D-WORKFLOW-FOLDER-INSTALL) are in getAllSkillNames, so the folder is removed.
  const prefixedSkillNames = new Set([...getAllSkillNames(folderWorkflows), ...LEGACY_SKILL_NAMES, ...FEATURE_OWNED_SKILLS]);
  const skillsDir = path.join(claudeDir, 'skills');

  let skillsRemoved = 0;
  for (const skillName of prefixedSkillNames) {
    // Remove prefixed variant (devflow:name) — current naming
    const prefixedPath = path.join(skillsDir, prefixSkillName(skillName));
    try {
      await fs.stat(prefixedPath);
      if (!(await mayChange(prefixedPath))) continue;
      await fs.rm(prefixedPath, { recursive: true, force: true });
      skillsRemoved++;
    } catch { /* Skill doesn't exist */ }
  }
  // Bare variant: frozen legacy list only, never the live registry, and only a folder that devflow made.
  const bareSkills = await planBareLegacySkills(skillsDir);
  for (const barePath of bareSkills.remove) {
    try {
      if (!(await mayChange(barePath))) continue;
      await fs.rm(barePath, { recursive: true, force: true });
      skillsRemoved++;
    } catch (error) {
      p.log.warn(`Could not remove ${escapeName(barePath)}: ${error}`);
    }
  }
  for (const { folder, reason } of bareSkills.keep) {
    p.log.info(`Kept ${escapeName(folder)}: ${reason}`);
  }

  if (skillsRemoved > 0 && verbose) {
    p.log.success(`Removed ${skillsRemoved} Devflow skill directories`);
  }

  // Also remove old nested skills structure if it exists
  const nestedSkillsDir = path.join(claudeDir, 'skills', 'devflow');
  try {
    await fs.stat(nestedSkillsDir);
    if (await mayChange(nestedSkillsDir)) {
      await fs.rm(nestedSkillsDir, { recursive: true, force: true });
    }
  } catch {
    // Old structure doesn't exist
  }

  // Registry-diff sweep: catch any devflow:* skill dirs whose names left the
  // registry (retired, renamed, or deleted). The loop above walks the static
  // registry + LEGACY list; this sweep walks the actual directory, so orphaned
  // dirs from older versions are also cleaned up. (F9)
  await sweepDevflowNamespaces(claudeDir, verbose, mayChange, undefined, folderWorkflows);
}

/** What {@link sweepDevflowNamespaces} did in each namespace. */
export interface NamespaceSweeps {
  agents: SweepResult;
  commands: SweepResult;
  skills: SweepResult;
}

/**
 * Registry-diff sweep of all Devflow-owned namespaces in `claudeDir`:
 *   - agents/devflow/   — entries absent from getAllAgentNames()
 *   - commands/devflow/ — entries absent from getAllCommandNames()
 *   - skills/           — devflow:* entries absent from getAllSkillNames()
 *
 * Called by removeSelectedPlugins after per-plugin removals so that retired
 * asset names (agents/commands renamed or deleted from the registry) are
 * cleaned up promptly rather than accumulating on disk.
 *
 * knownNames spans ALL plugins for each asset type so assets belonging to
 * plugins NOT being uninstalled are never swept.
 *
 * Removals are announced only under `verbose`, but removal FAILURES always warn:
 * a swept-but-not-actually-removed agent or command keeps loading in Claude Code,
 * and the user has no other signal that it is still there.
 *
 * A folder `mayChange` refuses is not swept at all (D-CLI-NO-SYMLINK,
 * legacyLocalChangeGuard). The agents and commands folders are swept only when each is a real folder
 * or absent, whatever `mayChange` says, because the sweep reads and removes inside whatever the
 * folder names; a folder that is a link or not a folder is recorded in `links` and left as it was.
 *
 * With no `mayChange`, the sweep uses the Devflow folder guard, which also refuses each orphan that
 * is a link (a linked `skills/devflow:*` folder): the orphan stays and is recorded in `links`. With a
 * `mayChange` given, an orphan that is itself a link is only unlinked: `fs.rm` never follows the
 * link it is given.
 *
 * Returns what each sweep removed and failed to remove, so a caller can tell that
 * a retired agent was removed (see {@link refreshRetainedCommandsAndAgents}).
 */
export async function sweepDevflowNamespaces(
  claudeDir: string,
  verbose: boolean,
  mayChange?: ChangeGuard,
  links: Pick<LinkReport, 'refusedFolders'> = { refusedFolders: [] },
  folderWorkflows: ReadonlySet<string> = WORKFLOW_FOLDER_NAMES,
): Promise<NamespaceSweeps> {
  const agentsDir = path.join(claudeDir, 'agents', 'devflow');
  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  const skillsDir = path.join(claudeDir, 'skills');
  const noSweep: SweepResult = { scanned: 0, removed: [], failed: [] };
  const guard = mayChange ?? devflowFolderGuard(claudeDir, links);
  const mayRemove = mayChange === undefined ? guard : undefined;
  const sweep = async (...args: Parameters<typeof sweepOrphanedAssets>): Promise<SweepResult> =>
    (await guard(args[0])) ? sweepOrphanedAssets(args[0], args[1], args[2], mayRemove) : noSweep;
  const sweepDevflowFolder = async (...args: Parameters<typeof sweepOrphanedAssets>): Promise<SweepResult> =>
    (await guard(args[0])) && !(await refuseUnrealFolder(links, args[0]))
      ? sweepOrphanedAssets(args[0], args[1], args[2], mayRemove)
      : noSweep;

  const agentsSweep = await sweepDevflowFolder(
    agentsDir,
    new Set(getAllAgentNames()),
    mdEntryName,
  );
  const commandsSweep = await sweepDevflowFolder(
    commandsDir,
    new Set(getAllCommandNames(folderWorkflows)),
    mdEntryName,
  );
  // FEATURE_OWNED_SKILLS (compliance) unioned into knownNames so a selective
  // uninstall of another plugin does not sweep devflow:compliance — nothing
  // converges after selective uninstall (only installViaFileCopy + convergeComplianceArtifacts
  // on full/partial init re-materialize it). D-FO-1 applies.
  // D-WORKFLOW-FOLDER-INSTALL: a workflow skill folder is a known skill, so a selective uninstall of
  // another plugin keeps it, and a stale command file of a folder workflow is an orphan here.
  const skillsSweep = await sweep(
    skillsDir,
    new Set([...getAllSkillNames(folderWorkflows), ...FEATURE_OWNED_SKILLS]),
    (entry) => entry.startsWith(SKILL_NAMESPACE) ? unprefixSkillName(entry) : null,
  );

  const byKind = [
    { kind: 'agent', sweep: agentsSweep },
    { kind: 'command', sweep: commandsSweep },
    { kind: 'skill', sweep: skillsSweep },
  ] as const;

  for (const { kind, sweep } of byKind) {
    if (verbose) {
      for (const name of sweep.removed) p.log.success(`Swept orphaned ${kind} ${name}`);
    }
    for (const failure of sweep.failed) {
      const reason = failure.error instanceof Error ? failure.error.message : String(failure.error);
      p.log.warn(`Could not remove orphaned ${kind} "${failure.name}" (${reason}) — remove it manually`);
    }
  }

  return { agents: agentsSweep, commands: commandsSweep, skills: skillsSweep };
}

/**
 * Remove only specific plugin assets (selective uninstall).
 * For commands and agents: remove files belonging to selected plugins, then
 * sweep the install directory for any orphaned assets whose names left the
 * registry (retired agents/commands survive indefinitely without the sweep).
 * For skills: only remove skills that are NOT used by any remaining plugin.
 * Each removal passes the guard first. A legacy local install passes `mayChange`
 * (D-CLI-NO-SYMLINK, legacyLocalChangeGuard). With none given, the removal uses the
 * Devflow folder guard: nothing is removed in or from a Devflow folder that is a link or
 * not a folder, and each such folder is recorded in `links` and left as it was.
 *
 * Returns what the closing registry-diff sweep removed.
 */
export async function removeSelectedPlugins(
  claudeDir: string,
  plugins: typeof DEVFLOW_PLUGINS,
  verbose: boolean,
  installedPlugins: PluginDefinition[] = DEVFLOW_PLUGINS,
  mayChange?: ChangeGuard,
  links: Pick<LinkReport, 'refusedFolders'> = { refusedFolders: [] },
  folderWorkflows: ReadonlySet<string> = WORKFLOW_FOLDER_NAMES,
): Promise<NamespaceSweeps> {
  const { skills, agents, commands, rules } = computeAssetsToRemove(plugins, installedPlugins, folderWorkflows);
  const guard = mayChange ?? devflowFolderGuard(claudeDir, links);

  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  for (const cmd of commands) {
    const cmdPath = path.join(commandsDir, mdFileName(cmd.replace(/^\//, '')));
    if (!(await guard(cmdPath))) continue;
    try {
      await fs.rm(cmdPath, { force: true });
      if (verbose) {
        p.log.success(`Removed command ${cmd}`);
      }
    } catch {
      // Command file might not exist
    }
  }

  const agentsDir = path.join(claudeDir, 'agents', 'devflow');
  for (const agent of agents) {
    const agentPath = path.join(agentsDir, mdFileName(agent));
    if (!(await guard(agentPath))) continue;
    try {
      await fs.rm(agentPath, { force: true });
      if (verbose) {
        p.log.success(`Removed agent ${agent}`);
      }
    } catch {
      // Agent file might not exist
    }
  }

  const skillsDir = path.join(claudeDir, 'skills');
  for (const skill of skills) {
    // Remove only the prefixed variant (devflow:name) — current naming.
    // Bare dirs (~/.claude/skills/{name}) and legacy devflow-* dirs are owned
    // exclusively by the frozen LEGACY_SKILL_NAMES pass in removeAllDevFlow and
    // in init.ts; live-registry skills never had bare installs (the devflow:
    // namespace shipped in dcecda3, 2026-03-30), so a bare dir for a current
    // registry name is by construction foreign.
    const skillPath = path.join(skillsDir, prefixSkillName(skill));
    if (!(await guard(skillPath))) continue;
    try {
      await fs.rm(skillPath, { recursive: true, force: true });
    } catch { /* Skill might not exist */ }
    if (verbose) {
      p.log.success(`Removed skill ${skill}`);
    }
  }

  const rulesDir = path.join(claudeDir, 'rules', 'devflow');
  for (const rule of rules) {
    const rulePath = path.join(rulesDir, mdFileName(rule));
    if (!(await guard(rulePath))) continue;
    try {
      await fs.rm(rulePath, { force: true });
      if (verbose) {
        p.log.success(`Removed rule ${rule}`);
      }
    } catch { /* Rule file might not exist */ }
  }

  // Registry-diff sweep: agents, commands, AND skills — named step (A6).
  // Removes any orphaned files whose names left the registry (retired, renamed,
  // or deleted from all plugins). Spans ALL plugins so assets belonging to
  // non-selected plugins are never swept.
  return sweepDevflowNamespaces(claudeDir, verbose, mayChange, links, folderWorkflows);
}
