/**
 * Attribution prompt helpers for devflow init.
 *
 * CLI-layer module (ADR-013): prompt-rendering logic lives in src/cli/commands/,
 * core business logic stays in src/core/.
 *
 * Applies PF-029: the gate is an exported pure predicate with an explicit isTTY guard,
 * so --recommended (flag, no prompt) and the non-TTY fallback keep their promptless
 * contracts and the reachability rule is unit-testable without a terminal.
 * Applies PF-014: runAttributionStep never calls process.exit() or throws — callers
 * own the cancel idiom (p.cancel + process.exit(0)), keeping try/finally cleanup safe.
 *
 * D27: suppress-attribution flag — gates Claude Code's AI-attribution injection.
 * The question is ADVANCED-ONLY; Recommended never asks. See shouldRunAttributionStep.
 *
 * Shared DI seam (PromptOutcome, WizardPromptIO, clackNote, clackSelect) lives in
 * prompt-io.ts — one definition, both wizard modules import from there (ADR-019).
 */

import { clackNote, clackSelect, type PromptOutcome, type WizardPromptIO } from './prompt-io.js';

// ── Gate predicate ─────────────────────────────────────────────────────────────

/**
 * Determines whether the attribution wizard step should run for a given init invocation.
 *
 * D27 — ADVANCED-ONLY. The attribution question is reachable from the Advanced path
 * and nowhere else. This DIVERGES DELIBERATELY from shouldRunComplianceStep, which also
 * runs on interactive Recommended: attribution rewrites the user's git history metadata,
 * so Recommended stays a zero-question path and silently applies the seeded value
 * (fresh install: off). Do not "restore symmetry" with the compliance gate.
 *
 * Gate table:
 *
 *   --advanced flag / re-init (banner path) / prompt → Advanced   → yes
 *   Interactive mode-prompt → Recommended                         → NO (D27 divergence)
 *   --recommended flag                                            → no
 *   !isTTY (any mode)                                             → no
 *
 * Gating on the mode name is sound here because 'advanced' is only ever resolved on an
 * interactive path (the Advanced branch exit-1s on non-TTY), and the explicit isTTY guard
 * keeps the promptless contracts of --recommended and the non-TTY fallback pinned
 * regardless (PF-029).
 *
 * There is no CLI override for attribution — it is toggled post-install via
 * `devflow flags --enable/--disable suppress-attribution`.
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunAttributionStep(input: {
  mode: 'recommended' | 'advanced';
  isTTY: boolean;
}): boolean {
  if (!input.isTTY) return false;
  return input.mode === 'advanced';
}

// ── DI seam ────────────────────────────────────────────────────────────────────

// Re-export so tests and init.ts continue to compile against these names.
export type { PromptOutcome };

/**
 * Injectable prompt interface for runAttributionStep.
 * Alias of WizardPromptIO — attribution uses only note + boolean select.
 * Kept as a named export for backward compatibility with tests and callers
 * that import `AttributionPromptIO` by name.
 */
export type AttributionPromptIO = WizardPromptIO;

/**
 * Build the real (clack) AttributionPromptIO adapter.
 * Delegates to the shared clackNote / clackSelect adapters (prompt-io.ts).
 */
export function buildClackAttributionPrompts(): AttributionPromptIO {
  return {
    note: clackNote,
    select: (opts) => clackSelect(opts),
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
  // security-02: name the destructive branch (Yes) BEFORE the user consents.
  // ADR-024 corollary (b): turning the flag ON replaces any existing attribution
  // value, including a custom one — this is deliberate. Only the exact
  // devflow-managed shape {"commit":"","pr":""} is removed on disable.
  // security-04: surface the org AI-disclosure-policy dimension as a note (not a gate).
  prompts.note(
    `Current setting: ${currentStr}\n\n` +
    'Choosing Yes REPLACES any existing \`attribution\` value in settings.json,\n' +
    'including a custom one, with {"commit":"","pr":""}.\n' +
    'Choosing No leaves a custom value untouched — only the exact\n' +
    'devflow-managed block is ever removed on disable.\n' +
    'Some organisations require machine-readable AI-authorship disclosure\n' +
    '— check your policy before enabling.\n\n' +
    'Toggle any time with: devflow flags --enable suppress-attribution',
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
