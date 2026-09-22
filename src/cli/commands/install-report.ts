/**
 * Rendering for the post-install summary — pure functions that turn an
 * {@link InstallReport} into lines, logging nothing (applies ADR-013).
 *
 * Its own module rather than a section of init.ts because `devflow tracker --set`
 * renders the same overlay outcomes from a different command. A CLI command
 * importing a renderer out of a 2,450-line sibling couples two commands through
 * a file neither of them owns; both import from here instead (design review M5).
 */
import color from 'picocolors';

import { overlayUnitLabel, type InstallReport, type OverlayFailureState } from '../../targets/claude-code/installer.js';
import { SKILL_REFS_SKILL_NAME } from '../../core/mds-variants.js';
import { prefixSkillName } from '../../core/plugins.js';

/** One line of post-install summary output, with the severity it should be logged at. */
export interface SummaryLine {
  level: 'info' | 'warn';
  message: string;
}

/**
 * Turn the reference-overlay half of an InstallReport into summary lines.
 *
 * The overlay rewrites files inside an installed skill directory the user may have
 * shadowed, and a unit it could not refresh is left in one of the states
 * {@link OverlayFailureState} enumerates — running on the previous install, half
 * replaced, absent, or recoverable only from a backup path. None of that is visible from
 * the filesystem at a glance, so all of it reaches the summary — PF-015: a report field
 * with no render site is not a report, and a render site that flattens four states into
 * one sentence is the same defect one layer up.
 *
 * Pure function — returns lines, logs nothing (applies ADR-013).
 *
 * @param provider - The resolved tracker provider the overlay converged to. The
 *   count alone cannot say WHICH mechanics are installed, and after the install
 *   became selection-scoped that is the number's whole meaning.
 * @param skillName - Bare name of the skill hosting the generated references,
 *   rendered `devflow:`-prefixed. Defaults to the core constant the build path and
 *   the installer's overlay trigger both read, so the renderer is never a third
 *   independent statement of which skill owns them — the divergence PF-013
 *   describes, where changing the answer means finding every retyped spelling and
 *   nothing fails if one is missed.
 */
export function formatOverlaySummary(
  report: Pick<InstallReport, 'overlaidRefs' | 'overlayFailures'>,
  provider?: string,
  skillName: string = SKILL_REFS_SKILL_NAME,
): SummaryLine[] {
  const lines: SummaryLine[] = [];

  if (report.overlaidRefs.length > 0) {
    const scope = provider === undefined ? '' : ` (${provider} tracker mechanics)`;
    lines.push({
      level: 'info',
      message:
        `Installed ${report.overlaidRefs.length} generated skill reference(s) for ` +
        prefixSkillName(skillName) + scope,
    });
  }

  for (const failure of report.overlayFailures) {
    lines.push({
      level: 'warn',
      message:
        `Could not refresh the generated references for ${overlayUnitLabel(failure.unit)} ` +
        `(${failure.error}) — ${describeOverlayFailureState(failure.state)}`,
    });
  }

  return lines;
}

/**
 * The half of an overlay warning that describes what is actually on disk.
 *
 * One sentence per state, each true of that state and of no other. A single shared
 * sentence — "the previously installed files were left unchanged" — is true of the first
 * arm only, and would read loudest over the arms it fits worst: a set left
 * half-refreshed, and a unit whose only surviving copy is a backup path the user has to
 * be told about.
 *
 * Exported because `devflow tracker --set` renders the same states when it aborts
 * on an overlay failure (applies PF-013 — one sentence per state, in one place,
 * rather than a second wording that drifts).
 *
 * Exhaustive over {@link OverlayFailureState} — a new state added to the union without a
 * sentence here is a compile error, not a state that silently prints nothing.
 */
export function describeOverlayFailureState(state: OverlayFailureState): string {
  switch (state.kind) {
    case 'installed-unchanged':
      return 'the previously installed files were left unchanged';
    case 'not-installed':
      return (
        `nothing is installed in their place, so ${state.absent.length} reference(s) the ` +
        `agent is told to load are absent: ${state.absent.join(', ')}`
      );
    case 'partially-refreshed':
      return (
        `${state.refreshed.length} of ${state.refreshed.length + state.stale.length} ` +
        `document(s) had already been replaced, so the set is part new and part old — ` +
        `still on the previous install: ${state.stale.join(', ') || 'none'}`
      );
    case 'restore-failed':
      return (
        `the displaced copy could NOT be put back (${state.restoreError}), so nothing is ` +
        `installed there now — the only surviving copy is "${state.recoveryPath}", which ` +
        `this run's stale-reference prune was skipped to preserve`
      );
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return 'the state it was left in is unknown';
    }
  }
}

/**
 * The install summary's tracker rows.
 *
 * Two facts the previous summary never stated, and after the install became
 * selection-scoped both of them decide what the user actually has:
 *
 *   - WHICH provider is active. The install has no other visible trace of it —
 *     the sentinel is a zero-byte dotfile and the mechanics are a directory the
 *     user has no reason to list. `(default)` distinguishes "github because I
 *     chose it" from "github because nothing was chosen"; `(was jira)` is what
 *     makes a self-heal or a `--reset` collapse legible rather than silent.
 *   - WHAT the provider change moved. A provider swap installs one tree and
 *     prunes another, and the agent file appears or disappears with it.
 *
 * The delta line is emitted only when something moved: on a steady-state re-init
 * the counts are noise.
 *
 * Pure function — returns lines, logs nothing (applies ADR-013).
 *
 * @param previous - The provider recorded by the PRIOR manifest, or undefined on
 *   a first install. Rendered only when it differs from `provider`.
 * @param isDefault - Whether `provider` is the registry default.
 */
export function formatTrackerAssetSummary(input: {
  readonly provider: string;
  readonly previous: string | undefined;
  readonly isDefault: boolean;
  readonly installedRefs: number;
  readonly removedRefs: number;
  readonly agent: 'installed' | 'removed' | 'unchanged';
}): SummaryLine[] {
  const lines: SummaryLine[] = [];

  const changed = input.previous !== undefined && input.previous !== input.provider;
  const qualifier = changed
    ? ` ${color.dim(`(was ${input.previous})`)}`
    : input.isDefault ? ` ${color.dim('(default)')}` : '';
  lines.push({ level: 'info', message: `Tracker: ${input.provider}${qualifier}` });

  const agentNote = input.agent === 'unchanged' ? '' : `, tracker agent ${input.agent}`;
  if (input.installedRefs > 0 || input.removedRefs > 0 || agentNote !== '') {
    lines.push({
      level: 'info',
      message:
        `Tracker assets: +${input.installedRefs} reference(s), ` +
        `−${input.removedRefs} reference(s)${agentNote}`,
    });
  }

  return lines;
}

/**
 * Did this run's plugin selection match the one already on disk?
 *
 * The question {@link formatSkillScopeSummary}'s `pluginListUnchanged` asks, and
 * a separate function because the two halves fail differently and only one of
 * them had executed evidence (design review L2): the renderer's behaviour given
 * an answer, and the answer itself.
 *
 * Two clauses, and the first one is the one a set comparison alone would lose:
 *
 *   - **A prior manifest must EXIST.** `null` is a first install. Nothing was
 *     removed from a user who had nothing, so there is no upgrade to explain,
 *     and comparing "no previous selection" against this run's would otherwise
 *     read as a match whenever both are empty.
 *   - **The plugin SETS must be equal**, not the arrays: order is an artifact of
 *     how the selection was assembled, and a duplicate name in either list is a
 *     manifest detail rather than a different selection.
 *
 * Pure function (applies ADR-013).
 *
 * @param previousPlugins - `manifest.plugins` as it stands before this run, or
 *   `null` when there is no prior manifest.
 * @param effectivePluginNames - What this run installs.
 */
export function isPluginListUnchanged(
  previousPlugins: readonly string[] | null,
  effectivePluginNames: readonly string[],
): boolean {
  if (previousPlugins === null) return false;
  const previous = new Set(previousPlugins);
  const effective = new Set(effectivePluginNames);
  return previous.size === effective.size && [...effective].every(name => previous.has(name));
}

/**
 * Turn the skill-scoping half of an InstallReport into summary lines.
 *
 * Two facts the filesystem cannot tell the user apart from an install that never
 * happened:
 *
 *   - a REMOVED skill. Scoping the install means a re-init after deselecting a
 *     plugin silently deletes skills the previous install carried. The line is
 *     emitted only when the plugin list is UNCHANGED, because that is the case
 *     the user did not ask for: they re-ran init expecting nothing to move, and
 *     the scoping change is what moved it. When they deselected a plugin
 *     themselves, the removal is the thing they asked for and needs no notice.
 *   - a DORMANT shadow. `~/.devflow/skills/{name}/` is never deleted, so an
 *     inactive shadow and an applied one look identical from disk.
 *
 * `pluginListUnchanged` is the caller's answer to "did the selection move?", and
 * it is FALSE when there is no prior manifest: a first install removed nothing a
 * user had, so there is no upgrade to explain (design review L2).
 *
 * Pure function — returns lines, logs nothing (applies ADR-013).
 */
export function formatSkillScopeSummary(
  report: Pick<InstallReport, 'removedSkills' | 'dormantShadows'>,
  pluginListUnchanged: boolean,
): SummaryLine[] {
  const lines: SummaryLine[] = [];

  if (pluginListUnchanged && report.removedSkills.length > 0) {
    const names = [...report.removedSkills].sort().join(', ');
    lines.push({
      level: 'info',
      message:
        `Removed ${report.removedSkills.length} skill(s) no selected plugin requires: ${names}. ` +
        `Re-run devflow init and select the plugin that provides them to keep them.`,
    });
  }

  for (const name of report.dormantShadows) {
    lines.push({
      level: 'info',
      message:
        `Shadow for ${name} is inactive — the plugin that uses it is not selected ` +
        `(${color.dim('kept in ~/.devflow/skills/')})`,
    });
  }

  return lines;
}
