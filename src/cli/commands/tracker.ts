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
 * Applies ADR-001: tracker is manifest-group (like proxy and compliance), not
 *   .devflow/config.json-gated — the selection is machine-wide, not per-repo.
 * Avoids PF-015: --set converges the sentinel in BOTH directions, so flipping
 *   back to github removes what flipping away wrote.
 * Avoids PF-009: a failed rename/rearm/sentinel step warns, it never aborts.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

import {
  DEFAULT_TRACKER_PROVIDER,
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

export type TrackerCliAction = 'set' | 'status';

export interface TrackerCliActionMessage {
  level: 'info' | 'success' | 'warn';
  text: string;
}

export interface TrackerCliActionResult {
  nextState: TrackerFeatureState;
  messages: TrackerCliActionMessage[];
}

// ── Pure resolver ──────────────────────────────────────────────────────────────

/**
 * Pure resolver: maps (currentState × action) → (nextState, messages).
 *
 * D: Pure function — no I/O, fully testable without filesystem access. The I/O
 *   layer (rename transition, manifest write, re-arm, sentinel) is always the
 *   caller's responsibility. `setProvider` must already have passed
 *   `parseTrackerId` at the CLI boundary.
 *
 * Semantics:
 *   set    — replace: the parsed provider becomes the selection (github included —
 *            `--set github` is the off switch; there is no --no-tracker, D-E)
 *   status — no-op:   returns the current selection unchanged, no messages
 */
export function resolveTrackerCliAction(
  current: TrackerFeatureState,
  action: TrackerCliAction,
  setProvider?: TrackerProvider,
): TrackerCliActionResult {
  switch (action) {
    case 'set': {
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

    case 'status': {
      return { nextState: { provider: current.provider }, messages: [] };
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return { nextState: { provider: current.provider }, messages: [] };
    }
  }
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
 * Read the provenance header of `~/.devflow/tracker.md`.
 *
 * Never throws (PF-014): an absent, unreadable, or directory path is `absent`.
 * Only the leading frontmatter block is scanned, and nothing read here is
 * trusted — every value is rendered through `describeTrackerValue`, because
 * tracker.md is hand-editable and machine-wide, so its content is third-party
 * input at every sink.
 */
export async function readTrackerProvenance(devflowDir: string): Promise<TrackerProvenance> {
  let content: string;
  try {
    content = await fs.readFile(trackerConventionsPath(devflowDir), 'utf-8');
  } catch {
    return { kind: 'absent' };
  }

  const lines = content.split('\n', PROVENANCE_SCAN_LINES);
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
  .option('--status', 'Show the selected provider and the learned conventions file')
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
      const providerLabel = current.provider === DEFAULT_TRACKER_PROVIDER
        ? `${color.green(current.provider)} ${color.dim('(default)')}`
        : color.green(current.provider);
      p.note(
        [
          `Provider:    ${providerLabel}`,
          `Conventions: ${formatTrackerProvenance(provenance)}`,
          `File:        ${path.join(devflowDir, 'tracker.md')}`,
        ].join('\n'),
        'Tracker Status',
      );
      return;
    }

    // ── Set ────────────────────────────────────────────────────────────────────
    const resolved = resolveTrackerCliAction(current, 'set', setProvider);

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

    // [DR-22] The documented re-arm path: a selection change resets the attempt
    // counter so a previously-capped inference gets another five tries.
    const rearm = await rearmTrackerInference(devflowDir);
    if (!rearm.ok) p.log.warn(rearm.error);

    // [DR-10] Converge the presence sentinel in both directions.
    const sentinel = await applyTrackerSentinel(devflowDir, resolved.nextState.provider);
    if (!sentinel.ok) p.log.warn(sentinel.error);

    for (const msg of resolved.messages) {
      switch (msg.level) {
        case 'success': p.log.success(msg.text); break;
        case 'warn': p.log.warn(msg.text); break;
        default: p.log.info(msg.text); break;
      }
    }

    if (resolved.nextState.provider !== DEFAULT_TRACKER_PROVIDER) {
      p.log.info(color.dim(
        'Your issue conventions are learned in the background at the next session start',
      ));
    }
  });
