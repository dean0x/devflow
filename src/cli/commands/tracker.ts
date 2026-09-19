/**
 * devflow tracker — Show or set the issue tracker provider.
 *
 * D-TRACKER-PAIR [DR-25]: `src/core/tracker.ts` (domain) +
 *   `src/cli/commands/tracker.ts` (CLI) mirrors the `compliance.ts` pair
 *   exactly; ADR-013's pure-core / I/O-target split is the reason both names
 *   exist. A reviewer meeting several `tracker*` files in one commit otherwise
 *   has no signal that the duplication is deliberate.
 *
 * Applies ADR-013: CLI-layer module; the provider domain, the strict parser and
 *   the ~/.devflow file lifecycle all live in src/core/tracker.ts.
 * The manifest is the source of truth for the selected provider: tracker is a
 *   manifest-group feature like proxy and compliance, not
 *   .devflow/config.json-gated, so the selection is machine-wide, not per-repo.
 * Avoids PF-015: --set converges the sentinel in BOTH directions, so flipping
 *   back to github removes what flipping away wrote.
 * Avoids PF-009: a failed rename/rearm/sentinel step warns, it never aborts.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { FileHandle } from 'fs/promises';
import * as p from '@clack/prompts';
import color from 'picocolors';

import {
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_ATTEMPTS_MAX,
  TRACKER_PROVIDERS,
  applyTrackerSentinel,
  describeTrackerValue,
  parseTrackerId,
  rearmTrackerInference,
  renameStaleTrackerConventions,
  trackerConventionsPath,
  type TrackerFeatureState,
  type TrackerProvider,
  type TrackerResult,
  type TrackerTransition,
} from '../../core/tracker.js';
import { readManifest, syncManifestFeature } from '../../core/manifest.js';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { overlayInstalledReferences, overlayUnitLabel, type ReferenceOverlayResult } from '../../targets/claude-code/installer.js';
import { convergeTrackerArtifacts, type ConvergeTrackerArtifactsResult } from '../../targets/claude-code/tracker-install.js';
import { describeOverlayFailureState } from './install-report.js';
import { SKILL_REFS_SKILL_NAME, installedReferenceManifest } from '../../core/mds-variants.js';
import { prefixSkillName } from '../../core/plugins.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrackerCliActionMessage {
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

export interface TrackerCliActionResult {
  nextState: TrackerFeatureState;
  messages: TrackerCliActionMessage[];
}

// ── Pure resolver ──────────────────────────────────────────────────────────────

/**
 * Pure resolver for `--set`: maps (currentState × requested provider) →
 * (nextState, messages).
 *
 * D: Pure function — no I/O, fully testable without filesystem access. The I/O
 *   layer (rename transition, manifest write, re-arm, sentinel) is always the
 *   caller's responsibility. `setProvider` must already have passed
 *   `parseTrackerId` at the CLI boundary.
 *
 * Replace semantics: the parsed provider becomes the selection, github included —
 * `--set github` is the off switch; there is no --no-tracker (D-E). The
 * `--status` branch reads the manifest and reports it directly, so `--set` is
 * the only action that reaches this resolver.
 */
export function resolveTrackerCliAction(
  current: TrackerFeatureState,
  setProvider?: TrackerProvider,
): TrackerCliActionResult {
  // Never invent a provider: an absent setProvider keeps the current one.
  const provider = setProvider ?? current.provider;
  if (provider === current.provider) {
    return {
      nextState: { provider },
      messages: [{ level: 'info', text: `Tracker provider already ${provider}` }],
    };
  }
  return {
    nextState: { provider },
    messages: [{ level: 'success', text: `Tracker provider set to ${provider}` }],
  };
}

// ── Provenance (the --status surface) ──────────────────────────────────────────

/**
 * What `~/.devflow/tracker.md` reports about itself.
 *
 * `present` with both fields undefined is a real, distinct outcome: the file
 * exists but carries no readable frontmatter. Reported as such — never
 * back-filled with an invented provider.
 */
export type TrackerProvenance =
  | { kind: 'absent' }
  | { kind: 'present'; provider?: string; inferredFrom?: string };

/** How many leading lines of tracker.md are scanned for frontmatter. */
const PROVENANCE_SCAN_LINES = 40;

/**
 * How many leading BYTES of tracker.md are read.
 *
 * The line cap above bounds the SCAN, not the read: `String.prototype.split`'s
 * limit truncates the resulting array once the whole file is already in memory.
 * tracker.md is hand-editable and machine-wide, so its size is not devflow's to
 * assume — this is the same bound the Tracker agent writes to and the Git agent
 * loads, enforced at the one TypeScript reader (avoids PF-023: a bound is only
 * real at the sink, and a file round-trip launders the writer's promise).
 */
const PROVENANCE_READ_BYTES = 8000;

/**
 * Read at most `limit` bytes from the head of a file.
 *
 * `undefined` for an absent, unreadable or non-file path — the caller reports
 * that as `absent` (PF-014: never throws).
 */
async function readBoundedHead(filePath: string, limit: number): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Read the provenance header of `~/.devflow/tracker.md`.
 *
 * Never throws (PF-014): an absent, unreadable, or directory path is `absent`.
 * Only the bounded head of the file is read and only the leading frontmatter
 * block is scanned, and nothing read here is trusted — every value is rendered
 * through `describeTrackerValue`, because tracker.md is hand-editable and
 * machine-wide, so its content is third-party input at every sink.
 */
export async function readTrackerProvenance(devflowDir: string): Promise<TrackerProvenance> {
  const head = await readBoundedHead(trackerConventionsPath(devflowDir), PROVENANCE_READ_BYTES);
  if (head === undefined) return { kind: 'absent' };

  const lines = head.split('\n', PROVENANCE_SCAN_LINES);
  if (lines[0]?.trim() !== '---') return { kind: 'present' };

  let provider: string | undefined;
  let inferredFrom: string | undefined;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const match = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match === null) continue;
    if (match[1] === 'provider' && provider === undefined) provider = match[2].trim();
    if (match[1] === 'inferred-from' && inferredFrom === undefined) inferredFrom = match[2].trim();
  }

  return { kind: 'present', provider, inferredFrom };
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
 * Count the installed tracker mechanics for the resolved provider.
 *
 * Counts what is PRESENT against the manifest for that provider rather than
 * listing the directory: the question a user asks `--status` is "can the agent
 * load what it is told to load?", and a stray file in the tree is not an answer
 * to it. Never throws (PF-014).
 */
export async function readTrackerMechanics(
  claudeDir: string,
  provider: TrackerProvider,
): Promise<TrackerMechanicsState> {
  const root = path.join(claudeDir, 'skills', prefixSkillName(SKILL_REFS_SKILL_NAME), 'references');
  let present = 0;
  for (const rel of installedReferenceManifest({ provider })) {
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

// ── CLI action ─────────────────────────────────────────────────────────────────

// ── --set: the convergence sequence ───────────────────────────────────────────

/**
 * Injectable I/O seam for {@link runTrackerSet}.
 *
 * Mirrors `TrackerLifecycleIO` in init.ts: the real adapter is
 * {@link buildTrackerSetIO}, and tests substitute a recorder so the CALL ORDER
 * is assertable. The order is the invariant here, not an implementation detail.
 */
export interface TrackerSetIO {
  /** Is `devflow:git` installed? Its `references/` is where the mechanics land. */
  gitSkillInstalled(claudeDir: string): Promise<boolean>;
  overlayReferences(
    claudeDir: string,
    provider: TrackerProvider,
    warn: (msg: string) => void,
  ): Promise<ReferenceOverlayResult>;
  renameStaleConventions(
    devflowDir: string,
    previous: TrackerProvider,
    resolved: TrackerProvider,
  ): Promise<TrackerTransition>;
  syncManifest(devflowDir: string, state: TrackerFeatureState): Promise<void>;
  convergeArtifacts(
    claudeDir: string,
    provider: TrackerProvider,
    warn: (msg: string) => void,
  ): Promise<ConvergeTrackerArtifactsResult>;
  rearmInference(devflowDir: string): Promise<TrackerResult<void>>;
  applySentinel(devflowDir: string, provider: TrackerProvider): Promise<TrackerResult<void>>;
}

/** The real adapter — the ONE binding of each operation into the `--set` path. */
export function buildTrackerSetIO(): TrackerSetIO {
  return {
    gitSkillInstalled: async (claudeDir) => {
      try {
        await fs.access(path.join(claudeDir, 'skills', prefixSkillName(SKILL_REFS_SKILL_NAME), 'SKILL.md'));
        return true;
      } catch { return false; }
    },
    overlayReferences: (claudeDir, provider, warn) =>
      overlayInstalledReferences({ claudeDir, provider, warn }),
    renameStaleConventions: renameStaleTrackerConventions,
    syncManifest: (devflowDir, state) => syncManifestFeature(devflowDir, 'tracker', state),
    convergeArtifacts: (claudeDir, provider, warn) =>
      convergeTrackerArtifacts({ claudeDir, provider, warn }),
    rearmInference: rearmTrackerInference,
    applySentinel: applyTrackerSentinel,
  };
}

export interface TrackerSetOutcome {
  exitCode: 0 | 1;
  /** The provider in force when this returned — unchanged on an aborted run. */
  provider: TrackerProvider;
  messages: TrackerCliActionMessage[];
}

/**
 * Converge every tracker artifact onto a newly selected provider.
 *
 * D-TRACKER-CONVERGE-SET: the step order is the invariant, and it is NOT the
 * same as `devflow init`'s — the two are different call paths obeying one
 * principle, and forcing them through a shared signature would hide the
 * reordering rather than document it.
 *
 *   1. probe `devflow:git`  — the mechanics have nowhere to land without it
 *   2. OVERLAY the references  (abort on failure, exit 1)
 *   3. rename stale conventions
 *   4. persist the manifest
 *   5. converge the Tracker AGENT file
 *   6. re-arm the attempt counter
 *   7. converge the sentinel  (write gated on 5; removal unconditional)
 *
 * The overlay precedes the manifest write, and the agent file follows it. That
 * asymmetry is the point: the reference subtree is INERT — nothing loads it
 * until a Git spawn resolves a provider, and resolving a provider reads the
 * manifest — so installing it early costs nothing and lets a failure abort
 * cleanly with the previous provider still whole. The agent file and the
 * sentinel are ADVERTISING artifacts: they announce a provider, so they must
 * never get ahead of the manifest that records it.
 *
 * Both abort branches — an absent `devflow:git` and a failed overlay — leave the
 * SAME end state and exit 1 (design review C3): manifest, sentinel and
 * conventions unchanged. What the overlay branch cannot claim is that nothing
 * moved at all: the overlay is atomic PER UNIT, so units that succeeded are
 * converged and only the failed ones are reported (design review H1). Saying
 * "nothing else changed" would be the more comfortable sentence and the false
 * one.
 *
 * Never throws, except where its callee does: an absent generated tree is a
 * build artifact that was never produced, and the CLI turns that into exit 1
 * with the build command named — asymmetric against the warn-only rename,
 * re-arm and sentinel steps, because those degrade a working install while an
 * absent tree means there is nothing to install at all.
 */
export async function runTrackerSet(opts: {
  devflowDir: string;
  claudeDir: string;
  current: TrackerFeatureState;
  requested: TrackerProvider;
  io: TrackerSetIO;
}): Promise<TrackerSetOutcome> {
  const { devflowDir, claudeDir, current, requested, io } = opts;
  const messages: TrackerCliActionMessage[] = [];
  const abort = (text: string): TrackerSetOutcome => {
    messages.push({ level: 'error', text });
    return { exitCode: 1, provider: current.provider, messages };
  };

  // 1. Without devflow:git there is no references/ directory to converge into,
  //    and creating one would leave an invisible husk under a skill that does
  //    not exist — a directory no sweep looks inside because no skill claims it.
  if (!await io.gitSkillInstalled(claudeDir)) {
    return abort(
      `devflow:git is not installed — run devflow init --tracker ${requested}. ` +
      `The manifest, sentinel and conventions file are unchanged.`,
    );
  }

  // 2. The overlay. Runs even when the provider is unchanged, so a `--set` that
  //    repeats the current selection self-heals a damaged subtree instead of
  //    early-returning on an equality check that proves nothing about disk.
  const overlayWarnings: string[] = [];
  let overlay: ReferenceOverlayResult;
  try {
    overlay = await io.overlayReferences(claudeDir, requested, (msg) => overlayWarnings.push(msg));
  } catch (error) {
    return abort(
      `Tracker: not changed — ${requested} assets could not be installed. ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const text of overlayWarnings) messages.push({ level: 'warn', text });

  if (overlay.overlayFailures.length > 0) {
    for (const failure of overlay.overlayFailures) {
      messages.push({
        level: 'warn',
        text:
          `${overlayUnitLabel(failure.unit)}: ${failure.error} — ` +
          `${describeOverlayFailureState(failure.state)}`,
      });
    }
    return abort(
      `Tracker: not changed — ${requested} assets could not be installed. The manifest, ` +
      `sentinel and conventions file are unchanged; the overlay is atomic per unit, so the ` +
      `units that succeeded are converged and the ${overlay.overlayFailures.length} that failed ` +
      `are reported above.`,
    );
  }

  // 3. A conventions file inferred for the previous provider is stale the moment
  //    the provider changes — move it aside so it can never be silently
  //    authoritative, and so the reader-side mismatch guard has nothing to fight.
  const transition = await io.renameStaleConventions(devflowDir, current.provider, requested);
  if (transition.kind === 'renamed') {
    messages.push({
      level: 'info',
      text: `Moved the previous ${transition.previous} conventions aside: ${transition.to}`,
    });
  } else if (transition.kind === 'failed') {
    messages.push({ level: 'warn', text: transition.error });
  }

  // 4. Persist. Everything after this point advertises the persisted value.
  await io.syncManifest(devflowDir, { provider: requested });

  // 5. The Tracker agent file.
  const agentWarnings: string[] = [];
  const artifacts = await io.convergeArtifacts(claudeDir, requested, (msg) => agentWarnings.push(msg));
  for (const text of agentWarnings) messages.push({ level: 'warn', text });

  // 6 + 7. [DR-22] a selection change re-arms the attempt counter; [DR-10] the
  // sentinel converges in both directions. Only the WRITE is gated on the agent
  // (design review C2) — a removal must always be attempted, because a stale
  // sentinel costs every future session a fork for a provider the user has left.
  const rearm = await io.rearmInference(devflowDir);
  if (!rearm.ok) messages.push({ level: 'warn', text: rearm.error });

  if (requested === DEFAULT_TRACKER_PROVIDER || artifacts.converged) {
    const sentinel = await io.applySentinel(devflowDir, requested);
    if (!sentinel.ok) messages.push({ level: 'warn', text: sentinel.error });
  } else {
    messages.push({
      level: 'warn',
      text:
        `Tracker sentinel not written — the ${requested} agent could not be installed, so nothing ` +
        `advertises a provider whose agent is missing. Re-run devflow tracker --set ${requested}.`,
    });
  }

  const removed = overlay.pruned.removed.length;
  const agentNote = artifacts.agent === 'unchanged' ? '' : `, tracker agent ${artifacts.agent}`;
  const moved = overlay.overlaidRefs.length > 0 || removed > 0 || agentNote !== '';
  messages.push({
    level: requested === current.provider ? 'info' : 'success',
    text: moved
      ? `Tracker: ${requested} — ${overlay.overlaidRefs.length} installed, ${removed} removed${agentNote}`
      : `Tracker: ${requested} (unchanged)`,
  });

  return { exitCode: 0, provider: requested, messages };
}

interface TrackerOptions {
  status?: boolean;
  set?: string;
}

export const trackerCommand = new Command('tracker')
  .description('Show or set the issue tracker provider')
  .option(
    '--status',
    'Show the selected provider and the learned conventions file, and re-arm background inference',
  )
  .option('--set <id>', 'Set the issue tracker provider: github, jira, or linear')
  .action(async (options: TrackerOptions) => {
    const devflowDir = getDevFlowDirectory();

    const hasFlag = options.status || options.set !== undefined;
    if (!hasFlag) {
      p.intro(color.bgCyan(color.white(' Tracker ')));
      const validIds = TRACKER_PROVIDERS.map(t => `${t.id} — ${t.hint}`).join('\n  ');
      p.note(
        `${color.cyan('devflow tracker --status')}      Show the provider and learned conventions\n` +
        `${color.cyan('devflow tracker --set <id>')}    Select the issue tracker provider\n\n` +
        `Valid provider IDs:\n  ${validIds}`,
        'Usage',
      );
      p.outro(color.dim('github is the default — devflow tracker --set github turns the rest off'));
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
      const provenance = await readTrackerProvenance(devflowDir);
      const mechanics = await readTrackerMechanics(getClaudeDirectory(), current.provider);

      // [D-F] Inspecting the status re-arms the attempt counter. --status is
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

      const providerLabel = current.provider === DEFAULT_TRACKER_PROVIDER
        ? `${color.green(current.provider)} ${color.dim('(default)')}`
        : color.green(current.provider);
      p.note(
        [
          `Provider:    ${providerLabel}`,
          `Conventions: ${formatTrackerProvenance(provenance)}`,
          `File:        ${trackerConventionsPath(devflowDir)}`,
          `Mechanics:   ${formatTrackerMechanics(mechanics)}`,
          `Inference:   ${inference}`,
        ].join('\n'),
        'Tracker Status',
      );

      if (!statusRearm.ok) p.log.warn(statusRearm.error);

      return;
    }

    // ── Set ────────────────────────────────────────────────────────────────────
    const outcome = await runTrackerSet({
      devflowDir,
      claudeDir: getClaudeDirectory(),
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

    if (outcome.exitCode !== 0) process.exit(outcome.exitCode);

    if (outcome.provider !== DEFAULT_TRACKER_PROVIDER) {
      p.log.info(color.dim(
        'Your issue conventions are learned in the background at the next session start',
      ));
    }
  });
