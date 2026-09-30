/**
 * devflow tracker — Show or set the machine's issue tracker provider.
 *
 * D-TRACKER-PAIR [DR-25]: `src/core/tracker.ts` (domain) +
 *   `src/cli/commands/tracker.ts` (CLI) mirrors the `compliance.ts` pair
 *   exactly; ADR-013's pure-core / I/O-target split is the reason both names
 *   exist. A reviewer meeting several `tracker*` files in one commit otherwise
 *   has no signal that the duplication is deliberate.
 *
 * Applies ADR-013: CLI-layer module; the provider domain, the strict parser and
 *   the ~/.devflow file lifecycle all live in src/core/tracker.ts.
 * The manifest holds the MACHINE default. A repository may select its own
 *   provider in its committed `.devflow/project.json` (resolved by
 *   resolve-settings.cjs); `--status` names it on an `Effective:` line when one
 *   does, and `--set` never touches it.
 * Avoids PF-015: --set converges the sentinel in BOTH directions, so flipping
 *   back to github removes what flipping away wrote.
 * Avoids PF-009: a failed re-arm or sentinel step warns, it never aborts.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

import {
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_ATTEMPTS_MAX,
  TRACKER_CONVENTIONS_READ_BYTES,
  TRACKER_PROVIDERS,
  applyTrackerSentinel,
  describeTrackerValue,
  parseTrackerFrontmatter,
  parseTrackerId,
  readBoundedHead,
  rearmTrackerInference,
  trackerConventionsPath,
  type TrackerFeatureState,
  type TrackerProvider,
  type TrackerResult,
} from '../../core/tracker.js';
import { readManifest, syncManifestFeature } from '../../core/manifest.js';
import { loadSettingsModule, personalConfigTrackedWarning, repoTrackerSelection, type RepoTrackerSelection } from '../../core/evidence-policy.js';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { SKILL_REFS_SKILL_NAME, installedReferenceManifest } from '../../core/mds-variants.js';
import { prefixSkillName } from '../../core/plugins.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrackerCliActionMessage {
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

// ── Provenance (the --status surface) ──────────────────────────────────────────

/**
 * What one provider's conventions file reports about itself.
 *
 * `present` with both fields undefined is a real, distinct outcome: the file
 * exists but carries no readable frontmatter. Reported as such — never
 * back-filled with an invented provider.
 */
export type TrackerProvenance =
  | { kind: 'absent' }
  | { kind: 'present'; provider?: string; inferredFrom?: string };

/**
 * Read the provenance header of `~/.devflow/tracker/{provider}.md`.
 *
 * Never throws (PF-014): an absent, unreadable, or non-regular path is `absent`.
 * Only the bounded head of the file is read and only the leading frontmatter
 * block is scanned — through the one frontmatter parser the migration also uses —
 * and nothing read here is trusted: every value is rendered through
 * `describeTrackerValue`, because the file is hand-editable and machine-wide, so
 * its content is third-party input at every sink.
 */
export async function readTrackerProvenance(
  devflowDir: string,
  provider: TrackerProvider,
): Promise<TrackerProvenance> {
  const head = await readBoundedHead(trackerConventionsPath(devflowDir, provider), TRACKER_CONVENTIONS_READ_BYTES);
  if (head === undefined) return { kind: 'absent' };
  const { provider: named, inferredFrom } = parseTrackerFrontmatter(head);
  return { kind: 'present', provider: named, inferredFrom };
}

/**
 * What `--status` found where the tracker mechanics are installed.
 *
 * Three outcomes, not two: "no files" and "could not look" are different facts
 * with different remedies, and collapsing them would tell a user to re-run
 * `devflow init` over a permissions problem init cannot fix.
 */
export type TrackerMechanicsState =
  | { kind: 'installed'; count: number }
  | { kind: 'missing' }
  | { kind: 'unreadable'; errno: string };

/**
 * Count the installed tracker mechanics.
 *
 * Counts what is PRESENT against the install manifest — every provider's, since
 * every install carries them all (D-INSTALL-ALL-PROVIDERS) — rather than listing
 * the directory: the question a user asks `--status` is "can the agent load what
 * it is told to load?", and a stray file in the tree is not an answer to it.
 * Never throws (PF-014).
 */
export async function readTrackerMechanics(claudeDir: string): Promise<TrackerMechanicsState> {
  const root = path.join(claudeDir, 'skills', prefixSkillName(SKILL_REFS_SKILL_NAME), 'references');
  let present = 0;
  for (const rel of installedReferenceManifest()) {
    try {
      await fs.access(path.join(root, ...rel.split('/')));
      present++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT is the file simply not being there — that is a count of zero for
      // this entry, not a failure to look. Anything else IS a failure to look.
      if (code !== undefined && code !== 'ENOENT') return { kind: 'unreadable', errno: code };
    }
  }
  return present === 0 ? { kind: 'missing' } : { kind: 'installed', count: present };
}

/** Render the mechanics state for the `--status` note. Pure. */
export function formatTrackerMechanics(state: TrackerMechanicsState): string {
  switch (state.kind) {
    case 'installed':
      return `installed (${state.count} file(s))`;
    case 'missing':
      return 'MISSING — run devflow init';
    case 'unreadable':
      return `unreadable (${state.errno})`;
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return 'unknown';
    }
  }
}

/** Render a provenance value for the `--status` note. Pure; bounded; sanitised. */
export function formatTrackerProvenance(provenance: TrackerProvenance): string {
  if (provenance.kind === 'absent') {
    return 'not present (learned in the background at a session start)';
  }
  const parts: string[] = ['present'];
  if (provenance.provider !== undefined) {
    parts.push(`provider: ${describeTrackerValue(provenance.provider)}`);
  }
  if (provenance.inferredFrom !== undefined) {
    parts.push(`inferred from: ${describeTrackerValue(provenance.inferredFrom)}`);
  }
  return parts.join(' — ');
}

/**
 * The conventions of the provider in effect, for the `--status` note.
 *
 * GitHub learns none (D-TRACKER-NO-ENABLED: no inference, no background agent,
 * no conventions file), so it is `none` and names no path — a `tracker/github.md`
 * would be a file nothing ever writes or reads.
 */
export type TrackerStatusConventions =
  | { readonly kind: 'none' }
  | { readonly kind: 'learned'; readonly file: string; readonly provenance: TrackerProvenance };

/** Read the conventions `--status` reports for `provider`. Never throws: see readTrackerProvenance. */
export async function readTrackerStatusConventions(
  devflowDir: string,
  provider: TrackerProvider,
): Promise<TrackerStatusConventions> {
  if (provider === DEFAULT_TRACKER_PROVIDER) return { kind: 'none' };
  return {
    kind: 'learned',
    file: trackerConventionsPath(devflowDir, provider),
    provenance: await readTrackerProvenance(devflowDir, provider),
  };
}

/**
 * The `--status` note's lines. Pure.
 *
 * The `Effective:` line appears ONLY when a repository layer selects the tracker
 * (`selection` non-null) — `Effective:   jira (project)` — so a machine whose own
 * provider decides prints the same five labels it always has. The conventions
 * lines describe the provider in effect HERE, which is the one whose file a
 * session in this repository learns and a Git spawn in it reads.
 */
export function formatTrackerStatus(input: {
  readonly machine: TrackerProvider;
  readonly selection: RepoTrackerSelection | null;
  readonly conventions: TrackerStatusConventions;
  readonly mechanics: TrackerMechanicsState;
  readonly inference: string;
}): string {
  const providerLabel = input.machine === DEFAULT_TRACKER_PROVIDER
    ? `${color.green(input.machine)} ${color.dim('(default)')}`
    : color.green(input.machine);
  const lines = [`Provider:    ${providerLabel}`];
  if (input.selection !== null) {
    lines.push(`Effective:   ${color.green(input.selection.provider)} (${input.selection.source})`);
  }
  lines.push(
    ...(input.conventions.kind === 'none'
      ? ['Conventions: none (GitHub needs no learned conventions)', 'File:        none']
      : [`Conventions: ${formatTrackerProvenance(input.conventions.provenance)}`, `File:        ${input.conventions.file}`]),
    `Mechanics:   ${formatTrackerMechanics(input.mechanics)}`,
    `Inference:   ${input.inference}`,
  );
  return lines.join('\n');
}

// ── --set: the convergence sequence ───────────────────────────────────────────

/**
 * Injectable I/O seam for {@link runTrackerSet}.
 *
 * Mirrors `TrackerLifecycleIO` in init.ts: the real adapter is
 * {@link buildTrackerSetIO}, and tests substitute a recorder so the CALL ORDER
 * is assertable. The order is the invariant here, not an implementation detail.
 */
export interface TrackerSetIO {
  syncManifest(devflowDir: string, state: TrackerFeatureState): Promise<void>;
  rearmInference(devflowDir: string): Promise<TrackerResult<void>>;
  applySentinel(devflowDir: string, provider: TrackerProvider): Promise<TrackerResult<void>>;
}

/** The real adapter — the ONE binding of each operation into the `--set` path. */
export function buildTrackerSetIO(): TrackerSetIO {
  return {
    syncManifest: (devflowDir, state) => syncManifestFeature(devflowDir, 'tracker', state),
    rearmInference: rearmTrackerInference,
    applySentinel: applyTrackerSentinel,
  };
}

export interface TrackerSetOutcome {
  /** The provider in force when this returned. */
  provider: TrackerProvider;
  messages: TrackerCliActionMessage[];
}

/**
 * Select the machine's default tracker provider.
 *
 * D-TRACKER-CONVERGE-SET: `--set` writes exactly three things, in this order —
 *
 *   1. the manifest            (the machine default; what every other step names)
 *   2. the attempt counters    (re-armed, so the new provider gets its five tries)
 *   3. the sentinel            (the provider's name, or removed for github)
 *
 * and nothing else. Every provider's mechanics and the Tracker agent are already
 * installed (D-INSTALL-ALL-PROVIDERS), so a selection change has no reference tree
 * to swap and no agent to add or remove; and each provider keeps its own
 * conventions file (D-TRACKER-PER-PROVIDER-CONVENTIONS), so there is nothing to
 * move aside. The sentinel follows the manifest because it ADVERTISES the value
 * the manifest records, and must never get ahead of it.
 *
 * Never throws, except where the manifest writer does. The re-arm and sentinel
 * steps warn rather than abort: each degrades a working install, never breaks it.
 */
export async function runTrackerSet(opts: {
  devflowDir: string;
  current: TrackerFeatureState;
  requested: TrackerProvider;
  io: TrackerSetIO;
}): Promise<TrackerSetOutcome> {
  const { devflowDir, current, requested, io } = opts;
  const messages: TrackerCliActionMessage[] = [];

  await io.syncManifest(devflowDir, { provider: requested });

  // [DR-22] a selection change re-arms the attempt counters; [DR-10] the
  // sentinel converges in both directions.
  const rearm = await io.rearmInference(devflowDir);
  if (!rearm.ok) messages.push({ level: 'warn', text: rearm.error });

  const sentinel = await io.applySentinel(devflowDir, requested);
  if (!sentinel.ok) messages.push({ level: 'warn', text: sentinel.error });

  const unchanged = requested === current.provider;
  messages.push({
    level: unchanged ? 'info' : 'success',
    text: unchanged ? `Tracker: ${requested} (unchanged)` : `Tracker: ${requested}`,
  });

  return { provider: requested, messages };
}

interface TrackerOptions {
  status?: boolean;
  set?: string;
}

export const trackerCommand = new Command('tracker')
  .description('Show or set the machine\'s issue tracker provider')
  .option(
    '--status',
    'Show the provider in effect and its learned conventions file, and re-arm background inference',
  )
  .option('--set <id>', 'Set the machine\'s default issue tracker provider: github, jira, or linear')
  .action(async (options: TrackerOptions) => {
    const devflowDir = getDevFlowDirectory();

    const hasFlag = options.status || options.set !== undefined;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' Tracker ')));
      const validIds = TRACKER_PROVIDERS.map(t => `${t.id} — ${t.hint}`).join('\n  ');
      p.note(
        `${color.cyan('devflow tracker --status')}      Show the provider and learned conventions\n` +
        `${color.cyan('devflow tracker --set <id>')}    Set the machine's default provider\n\n` +
        `Valid provider IDs:\n  ${validIds}`,
        'Usage',
      );
      p.outro(color.dim('github is the default — devflow tracker --set github returns to it'));
      return;
    }

    // Validate --set input before any I/O (parse-don't-validate at the boundary).
    let setProvider: TrackerProvider | undefined;
    if (options.set !== undefined) {
      const parsed = parseTrackerId(options.set);
      if (!parsed.ok) {
        p.log.error(parsed.error);
        process.exit(1);
      }
      setProvider = parsed.value;
    }

    const manifest = await readManifest(devflowDir);
    if (!manifest) {
      p.log.error('No manifest found. Run devflow init first.');
      process.exit(1);
    }

    const current = manifest.features.tracker;

    // ── Status ─────────────────────────────────────────────────────────────────
    // --status wins when both flags are passed, mirroring `devflow compliance`.
    if (options.status) {
      const settingsModule = loadSettingsModule();
      const selection = repoTrackerSelection(settingsModule, { dir: process.cwd() });
      const effective = selection?.provider ?? current.provider;
      const conventions = await readTrackerStatusConventions(devflowDir, effective);
      const mechanics = await readTrackerMechanics(getClaudeDirectory());

      // [D-F] Inspecting the status re-arms the attempt counters. --status is
      // the command a capped user reaches for to find out why nothing is being
      // learned, so it is the command that has to hand back another five
      // tries; the alternative leaves the only escape a hand deletion of an
      // undocumented dotfile. Every other --status in this CLI is a pure read,
      // so this one reports the write it makes as a line of the note below — a
      // machine-state change the output does not mention is a change the user
      // cannot audit. Non-fatal exactly as on the --set path (avoids PF-009): a
      // failed re-arm warns, it never aborts the report the user asked for.
      const statusRearm = await rearmTrackerInference(devflowDir);
      const inference = statusRearm.ok
        ? `re-armed (${TRACKER_ATTEMPTS_MAX} attempts available)`
        : 're-arm failed — see the warning below';

      p.note(
        formatTrackerStatus({
          machine: current.provider,
          selection,
          conventions,
          mechanics,
          inference,
        }),
        'Tracker Status',
      );

      if (!statusRearm.ok) p.log.warn(statusRearm.error);
      const trackedWarning = personalConfigTrackedWarning(settingsModule, { dir: process.cwd() });
      if (trackedWarning !== null) p.log.warn(trackedWarning);

      return;
    }

    // ── Set ────────────────────────────────────────────────────────────────────
    const outcome = await runTrackerSet({
      devflowDir,
      current,
      requested: setProvider ?? current.provider,
      io: buildTrackerSetIO(),
    });

    for (const msg of outcome.messages) {
      switch (msg.level) {
        case 'success': p.log.success(msg.text); break;
        case 'warn': p.log.warn(msg.text); break;
        case 'error': p.log.error(msg.text); break;
        default: p.log.info(msg.text); break;
      }
    }

    if (outcome.provider !== DEFAULT_TRACKER_PROVIDER) {
      p.log.info(color.dim(
        'Your issue conventions are learned in the background at the next session start',
      ));
    }
  });
