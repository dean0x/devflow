/**
 * Attribution prompt helpers for devflow init.
 *
 * CLI-layer module (ADR-013): prompt-rendering logic lives in src/cli/commands/,
 * core business logic stays in src/core/.
 *
 * Applies PF-029: every wizard gate keys on `modePromptShown`, never on the mode
 * name, so --recommended (flag, no prompt) and the non-TTY fallback preserve their
 * promptless contracts.
 * Applies PF-014: runAttributionStep never calls process.exit() or throws — callers
 * own the cancel idiom (p.cancel + process.exit(0)), keeping try/finally cleanup safe.
 *
 * D27: suppress-attribution flag — gates Claude Code's AI-attribution injection.
 */

import * as p from '@clack/prompts';

// ── Gate predicate ─────────────────────────────────────────────────────────────

/**
 * Determines whether the attribution wizard step should run for a given init invocation.
 *
 * Gate table (per PF-029: key on modePromptShown, never on the mode name):
 *
 *   --recommended flag / !isTTY fallback             → no (promptless contract preserved)
 *   Interactive mode-prompt → Recommended             → yes (modePromptShown=true)
 *   --advanced flag / re-init (banner path)           → yes (mode='advanced', isTTY=true)
 *   Interactive mode-prompt → Advanced                → yes (modePromptShown=true)
 *   Any path with a hasCliOverride for this step      → no (CLI override wins)
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 * Mirrors shouldRunComplianceStep exactly (same gate table per PF-029).
 */
export function shouldRunAttributionStep(input: {
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

/** Discriminated union returned by every AttributionPromptIO method. */
export type PromptOutcome<T> = { kind: 'value'; value: T } | { kind: 'cancel' };

/**
 * Injectable prompt interface for runAttributionStep.
 * Mirrors CompliancePromptIO (src/cli/commands/compliance-prompts.ts).
 * Enables unit tests to drive all branches without a real TTY.
 */
export interface AttributionPromptIO {
  note: (message: string, title: string) => void;
  select: (opts: {
    message: string;
    options: Array<{ value: boolean; label: string; hint: string }>;
    initialValue: boolean;
  }) => Promise<PromptOutcome<boolean>>;
}

/**
 * Build the real (clack) AttributionPromptIO adapter.
 * Translates clack's cancel symbol into the PromptOutcome discriminated union.
 */
export function buildClackAttributionPrompts(): AttributionPromptIO {
  return {
    note: (message, title) => p.note(message, title),

    select: async (opts) => {
      const result = await p.select({
        message: opts.message,
        options: opts.options,
        initialValue: opts.initialValue,
      });
      if (p.isCancel(result)) return { kind: 'cancel' };
      return { kind: 'value', value: result as boolean };
    },
  };
}

// ── Step runner ────────────────────────────────────────────────────────────────

/** Message emitted after the attribution step resolves. */
export interface AttributionStepMessage {
  level: 'success' | 'info';
  text: string;
}

/** The attribution step completed (user answered Yes or No). */
export interface AttributionStepResolved {
  kind: 'resolved';
  suppress: boolean;
  messages: AttributionStepMessage[];
}

/** The attribution step was cancelled (user pressed Escape). */
export interface AttributionStepCancelled {
  kind: 'cancelled';
}

export type AttributionStepOutcome = AttributionStepResolved | AttributionStepCancelled;

/**
 * Run the attribution wizard step.
 *
 * Flow:
 *   1. Note — "Current setting: …" header with context about what the flag does.
 *   2. Enable select — labeled Yes / No with hints (seeded from prior state);
 *      p.select is immune to Enter-through muscle memory while still preserving
 *      the seeded value (ambient-prompt style — per PF-029).
 *
 * Returns:
 *   {kind:'resolved', suppress, messages} — step completed; `suppress` is the chosen
 *     boolean; `messages` are emitted by the caller.
 *   {kind:'cancelled'} — user pressed Escape; caller runs p.cancel + process.exit(0).
 *
 * Invariants (PF-014):
 *   - Never calls process.exit(), never throws.
 *   - All I/O is routed through the `prompts` parameter (injectable for tests).
 */
export async function runAttributionStep(opts: {
  seed: boolean;
  prompts: AttributionPromptIO;
}): Promise<AttributionStepOutcome> {
  const { seed, prompts } = opts;

  const currentStr = seed ? 'suppressed' : 'shown (default)';
  prompts.note(
    `Current setting: ${currentStr}\n\n` +
    'When enabled, writes {"commit":"","pr":""} to settings.json, which\n' +
    'suppresses AI-attribution labels in git commits and pull requests.\n' +
    'Toggle any time with: devflow flags --enable suppress-attribution\n\n' +
    'Note: Only removes the devflow-managed attribution block on disable;\n' +
    'custom attribution values you set manually are never deleted.',
    'AI Attribution',
  );

  const enableOutcome = await prompts.select({
    message: 'Suppress AI attribution in commits and PRs?',
    options: [
      { value: true, label: 'Yes', hint: 'hides Claude attribution labels in git history' },
      { value: false, label: 'No', hint: 'keeps Claude attribution labels (default)' },
    ],
    initialValue: seed,
  });

  if (enableOutcome.kind === 'cancel') return { kind: 'cancelled' };

  const suppress = enableOutcome.value;
  const text = suppress
    ? 'Attribution: suppressed — disable with devflow flags --disable suppress-attribution'
    : 'Attribution: shown (default)';

  return {
    kind: 'resolved',
    suppress,
    messages: [{ level: suppress ? 'success' : 'info', text }],
  };
}
