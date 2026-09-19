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
} from '../../core/tracker.js';
import { readManifest, syncManifestFeature } from '../../core/manifest.js';
import { getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrackerCliActionMessage {
  level: 'info' | 'success';
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
          `Inference:   ${inference}`,
        ].join('\n'),
        'Tracker Status',
      );

      if (!statusRearm.ok) p.log.warn(statusRearm.error);

      return;
    }

    // ── Set ────────────────────────────────────────────────────────────────────
    const resolved = resolveTrackerCliAction(current, setProvider);

    // P3a-S15: a conventions file inferred for the previous provider is stale the
    // moment the provider changes — move it aside so it can never be silently
    // authoritative, and so the reader-side mismatch guard has nothing to fight.
    const transition = await renameStaleTrackerConventions(
      devflowDir, current.provider, resolved.nextState.provider,
    );
    if (transition.kind === 'renamed') {
      p.log.info(`Moved the previous ${transition.previous} conventions aside: ${transition.to}`);
    } else if (transition.kind === 'failed') {
      p.log.warn(transition.error);
    }

    // syncManifestFeature is already generic over ManifestData['features'] keys —
    // no manifest change was needed to persist this one.
    await syncManifestFeature(devflowDir, 'tracker', resolved.nextState);

    // [DR-22] The second documented re-arm path (D-F): a selection change
    // resets the attempt counter so a capped inference gets another five tries.
    const rearm = await rearmTrackerInference(devflowDir);
    if (!rearm.ok) p.log.warn(rearm.error);

    // [DR-10] Converge the presence sentinel in both directions.
    const sentinel = await applyTrackerSentinel(devflowDir, resolved.nextState.provider);
    if (!sentinel.ok) p.log.warn(sentinel.error);

    for (const msg of resolved.messages) {
      switch (msg.level) {
        case 'success': p.log.success(msg.text); break;
        default: p.log.info(msg.text); break;
      }
    }

    if (resolved.nextState.provider !== DEFAULT_TRACKER_PROVIDER) {
      p.log.info(color.dim(
        'Your issue conventions are learned in the background at the next session start',
      ));
    }
  });
