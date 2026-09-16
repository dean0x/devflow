/**
 * Tracker prompt helpers for devflow init.
 *
 * CLI-layer module (ADR-013): prompt-rendering logic lives in src/cli/commands/,
 * core business logic stays in src/core/tracker.ts.
 *
 * Applies PF-029: the wizard gate keys on `modePromptShown` (was the Setup-mode
 * p.select prompt actually shown?), never on the mode name, so --recommended
 * (flag, no prompt) and the non-TTY fallback preserve their promptless contracts.
 * Applies PF-014: runTrackerStep never calls process.exit() or throws — callers
 * own the cancel idiom (p.cancel + process.exit(0)), keeping try/finally safe.
 * Applies ADR-019: the shared DI seam (PromptOutcome, WizardPromptIO, clackNote,
 * clackSelect) is imported from prompt-io.ts — never re-declared here.
 *
 * D-TRACKER-GATE: this step copies COMPLIANCE's gate, not ATTRIBUTION's.
 * Attribution is Advanced-only because it silently rewrites git metadata; a
 * wrong tracker provider is immediately visible and trivially reversible, while
 * a user who never sees the question silently gets `github` — invisible to
 * exactly the Jira/Linear user the question exists for. Compliance's signature
 * is also the only one already carrying `hasCliOverride`, which `--tracker`
 * needs.
 */

import { clackNote, clackSelect, type PromptOutcome, type WizardPromptIO } from './prompt-io.js';
import {
  DEFAULT_TRACKER_PROVIDER,
  TRACKER_PROVIDERS,
  type TrackerFeatureState,
  type TrackerProvider,
} from '../../core/tracker.js';

// ── Shared prompt content ──────────────────────────────────────────────────────

/** Message shown on the tracker provider select prompt. */
export const TRACKER_SELECT_MESSAGE = 'Issue tracker for this machine';

/** Build clack select options for the tracker provider list. */
export function providerChoices(): Array<{ value: TrackerProvider; label: string; hint: string }> {
  return TRACKER_PROVIDERS.map(provider => ({
    value: provider.id,
    label: provider.label,
    hint: provider.hint,
  }));
}

/**
 * Format a padded provider catalogue suitable for a clack note body.
 * Produces: `  github     — GitHub Issues through the gh CLI`
 */
export function formatProviderCatalogue(): string {
  return 'Valid provider IDs:\n' +
    TRACKER_PROVIDERS.map(p => `  ${p.id.padEnd(10)} — ${p.hint}`).join('\n');
}

/**
 * Format tracker state for the Recommended-mode summary line and note header.
 *
 * Pure function — no I/O, no side effects. `github` carries the `(default)`
 * marker so a user reading the summary can tell "I chose this" from "this is
 * what devflow does when nobody chooses".
 */
export function formatTrackerSummary(provider: TrackerProvider): string {
  return provider === DEFAULT_TRACKER_PROVIDER ? `${provider} (default)` : provider;
}

// ── Gate predicate ─────────────────────────────────────────────────────────────

/**
 * Determines whether the tracker wizard step should run for a given init invocation.
 *
 * Gate table (per PF-029: key on modePromptShown, never on the mode name):
 *
 *   --recommended flag / !isTTY fallback             → no (promptless contract preserved)
 *   Interactive mode-prompt → Recommended            → yes (modePromptShown=true)
 *   --advanced flag / re-init (banner path)          → yes (mode='advanced', isTTY=true)
 *   Interactive mode-prompt → Advanced               → yes (modePromptShown=true)
 *   Any path with --tracker <id>                     → no (hasCliOverride wins)
 *
 * BOTH wizard paths call this predicate, so the table above is the single
 * authority for both and they cannot drift. A Recommended-only wiring would be
 * dead on every re-init — re-init is Advanced-only by construction.
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunTrackerStep(input: {
  mode: 'recommended' | 'advanced';
  modePromptShown: boolean;
  isTTY: boolean;
  hasCliOverride: boolean;
}): boolean {
  if (input.hasCliOverride) return false;
  if (!input.isTTY) return false;
  // Advanced path: non-TTY has already exit-1'd, so isTTY=true here → always run.
  // Covers: --advanced flag, re-init banner path, interactive-prompt → advanced.
  if (input.mode === 'advanced') return true;
  // Recommended path: only run when the Setup-mode p.select actually ran
  // (user made an active choice). --recommended flag and !isTTY fallback never set
  // modePromptShown=true, preserving their promptless contracts.
  return input.modePromptShown;
}

// ── DI seam ────────────────────────────────────────────────────────────────────

/**
 * Injectable prompt interface for runTrackerStep.
 *
 * Extends WizardPromptIO (prompt-io.ts) with the tracker-specific three-value
 * provider select. `WizardPromptIO.select` is boolean-typed, so `selectProvider`
 * is declared as a SIBLING rather than widening the shared base — widening it
 * would change the seam for every other wizard step. `clackSelect<T>` is already
 * generic, so the shared adapter needs no change.
 *
 * The inherited boolean `select` is unused by `runTrackerStep` (the tracker
 * question is a 3-value choice, never a Yes/No confirm); it is inherited so this
 * seam stays substitutable for the shared one, and `buildClackTrackerPrompts`
 * wires it to the same shared adapter every other step uses.
 */
export interface TrackerPromptIO extends WizardPromptIO {
  selectProvider: (opts: {
    message: string;
    options: Array<{ value: TrackerProvider; label: string; hint: string }>;
    initialValue: TrackerProvider;
  }) => Promise<PromptOutcome<TrackerProvider>>;
}

/**
 * Build the real (clack) TrackerPromptIO adapter.
 * Delegates the shared note + select to the shared adapters (prompt-io.ts).
 * Translates clack's cancel symbol into the PromptOutcome discriminated union.
 */
export function buildClackTrackerPrompts(): TrackerPromptIO {
  return {
    note: clackNote,

    select: (opts) => clackSelect(opts),

    selectProvider: (opts) => clackSelect(opts),
  };
}

// ── Step runner ────────────────────────────────────────────────────────────────

/** Message emitted after the tracker step resolves. */
export interface TrackerStepMessage {
  level: 'success' | 'info';
  text: string;
}

/** The tracker step completed (user picked a provider). */
export interface TrackerStepResolved {
  kind: 'resolved';
  state: TrackerFeatureState;
  messages: TrackerStepMessage[];
}

/** The tracker step was cancelled (user pressed Escape). */
export interface TrackerStepCancelled {
  kind: 'cancelled';
}

export type TrackerStepOutcome = TrackerStepResolved | TrackerStepCancelled;

/**
 * Run the tracker wizard step.
 *
 * Flow:
 *   1. Note — "Current setting: …" header then the provider catalogue.
 *   2. Provider select — labelled GitHub / Jira / Linear with hints, seeded from
 *      the prior state. `p.select`, never `p.confirm`: Enter-through must be an
 *      INFORMED keep of a named provider, not a y/N reflex (PF-029).
 *
 * Returns:
 *   {kind:'resolved', state, messages} — step completed; `state` is the chosen
 *     TrackerFeatureState; `messages` are emitted by the caller.
 *   {kind:'cancelled'} — user pressed Escape; caller runs p.cancel + process.exit(0).
 *
 * Invariants (PF-014):
 *   - Never calls process.exit(), never throws.
 *   - The returned state is always a fresh object, never the seed.
 *   - All I/O is routed through the `prompts` parameter (injectable for tests).
 */
export async function runTrackerStep(opts: {
  seed: TrackerFeatureState;
  prompts: TrackerPromptIO;
}): Promise<TrackerStepOutcome> {
  const { seed, prompts } = opts;

  prompts.note(
    `Current setting: ${formatTrackerSummary(seed.provider)}\n\n` +
    'Selects which issue tracker devflow reads and writes when a workflow\n' +
    'needs an issue. GitHub is the default and needs no extra setup.\n' +
    'Jira and Linear learn your project\'s issue conventions in the\n' +
    'background at the next session start; pull requests stay on GitHub\n' +
    'either way.\n\n' +
    formatProviderCatalogue(),
    'Issue tracker',
  );

  const outcome = await prompts.selectProvider({
    message: TRACKER_SELECT_MESSAGE,
    options: providerChoices(),
    initialValue: seed.provider,
  });

  if (outcome.kind === 'cancel') return { kind: 'cancelled' };

  const provider = outcome.value;

  return {
    kind: 'resolved',
    // Fresh object — never alias the seed (PF-014).
    state: { provider },
    messages: [
      provider === DEFAULT_TRACKER_PROVIDER
        ? { level: 'info', text: `Tracker: ${provider} (default) — change later with devflow tracker --set <id>` }
        : { level: 'success', text: `Tracker: ${provider}` },
    ],
  };
}
