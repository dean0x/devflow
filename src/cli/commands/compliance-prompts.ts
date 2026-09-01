/**
 * Compliance prompt helpers for devflow init.
 *
 * CLI-layer module (ADR-013): prompt-rendering logic lives in src/cli/commands/,
 * core business logic stays in src/core/compliance.ts.
 *
 * Applies PF-029: every wizard gate keys on `modePromptShown` (was the Setup-mode
 * p.select prompt actually shown?), never on the mode name, so --recommended (flag,
 * no prompt) and the non-TTY fallback preserve their promptless contracts.
 * Applies PF-014: runComplianceStep never calls process.exit() or throws — callers
 * own the cancel idiom (p.cancel + process.exit(0)), keeping try/finally cleanup safe.
 *
 * Shared DI seam (PromptOutcome, WizardPromptIO, clackNote, clackSelect) lives in
 * prompt-io.ts — one definition, both wizard modules import from there (ADR-019).
 */

import * as p from '@clack/prompts';
import { COMPLIANCE_FRAMEWORKS, type ComplianceFeatureState } from '../../core/compliance.js';
import { clackNote, clackSelect, type WizardPromptIO } from './prompt-io.js';

// Re-export PromptOutcome so callers that import it from this module continue
// to compile (e.g. tests/compliance-prompts.test.ts).
export type { PromptOutcome } from './prompt-io.js';

// ── Shared prompt content ──────────────────────────────────────────────────────

/** Message shown on the compliance framework multiselect prompt. */
export const FRAMEWORK_SELECT_MESSAGE =
  'Select compliance frameworks (Enter to skip — generic controls only)';

/** Build clack multiselect/select options for the compliance framework list. */
export function frameworkChoices(): Array<{ value: string; label: string; hint: string }> {
  return COMPLIANCE_FRAMEWORKS.map(fw => ({
    value: fw.id,
    label: fw.label,
    hint: fw.hint,
  }));
}

/**
 * Format a padded framework catalogue suitable for a clack note body.
 * Produces: `  gdpr       — General Data Protection Regulation`
 */
export function formatFrameworkCatalogue(): string {
  return 'Valid framework IDs:\n' +
    COMPLIANCE_FRAMEWORKS.map(fw => `  ${fw.id.padEnd(10)} — ${fw.hint}`).join('\n');
}

/**
 * Format compliance state for the Recommended-mode summary line and note header.
 *
 * Pure function — no I/O, no side effects.
 * Canonical source lives here; init.ts re-exports it for backward compatibility
 * (tests/init-logic.test.ts imports from init.ts).
 */
export function formatComplianceSummary(enabled: boolean, frameworks: string[]): string {
  if (!enabled) return 'disabled';
  if (frameworks.length > 0) return `enabled (${frameworks.join(', ')})`;
  return 'enabled (generic controls only)';
}

// ── Gate predicate ─────────────────────────────────────────────────────────────

/**
 * Determines whether the compliance wizard step should run for a given init invocation.
 *
 * Gate table (per PF-029: key on modePromptShown, never on the mode name):
 *
 *   --recommended flag / !isTTY fallback             → no (promptless contract preserved)
 *   Interactive mode-prompt → Recommended             → yes (modePromptShown=true)
 *   --advanced flag / re-init (banner path)           → yes (mode='advanced', isTTY=true)
 *   Interactive mode-prompt → Advanced                → yes (modePromptShown=true)
 *   Any path with --compliance / --no-compliance      → no (hasCliOverride wins)
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunComplianceStep(input: {
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
 * Injectable prompt interface for runComplianceStep.
 * Extends WizardPromptIO (from prompt-io.ts) with the compliance-specific
 * multiselect prompt. The shared note + select seam is inherited.
 * Mirrors the ProxyPreflightDeps seam (src/cli/commands/proxy.ts:346).
 * Enables unit tests to drive all branches without a real TTY.
 */
export interface CompliancePromptIO extends WizardPromptIO {
  multiselect: (opts: {
    message: string;
    options: Array<{ value: string; label: string; hint: string }>;
    initialValues: string[];
    required: boolean;
  }) => Promise<import('./prompt-io.js').PromptOutcome<string[]>>;
}

/**
 * Build the real (clack) CompliancePromptIO adapter.
 * Delegates the shared note + select to the shared adapters (prompt-io.ts).
 * Translates clack's cancel symbol into the PromptOutcome discriminated union.
 */
export function buildClackCompliancePrompts(): CompliancePromptIO {
  return {
    note: clackNote,

    select: (opts) => clackSelect(opts),

    multiselect: async (opts) => {
      const result = await p.multiselect({
        message: opts.message,
        options: opts.options,
        initialValues: opts.initialValues,
        required: opts.required,
      });
      if (p.isCancel(result)) return { kind: 'cancel' };
      return { kind: 'value', value: result };
    },
  };
}

// ── Step runner ────────────────────────────────────────────────────────────────

/** Message emitted after the compliance step resolves. */
export interface ComplianceStepMessage {
  level: 'success' | 'info';
  text: string;
}

/** The compliance step completed (user answered Yes or No). */
export interface ComplianceStepResolved {
  kind: 'resolved';
  state: ComplianceFeatureState;
  messages: ComplianceStepMessage[];
}

/** The compliance step was cancelled (user pressed Escape). */
export interface ComplianceStepCancelled {
  kind: 'cancelled';
}

export type ComplianceStepOutcome = ComplianceStepResolved | ComplianceStepCancelled;

/**
 * Run the compliance wizard step.
 *
 * Flow:
 *   1. Note — "Current setting: …" header then the framework catalogue.
 *   2. Enable select — labeled Yes / No with hints (seeded from prior state);
 *      p.select is immune to Enter-through muscle memory while still preserving
 *      the seeded value (ambient-prompt style — per PF-029).
 *   3. If Yes — framework multiselect (seeded, required:false).
 *
 * Returns:
 *   {kind:'resolved', state, messages} — step completed; `state` is the chosen
 *     ComplianceFeatureState; `messages` are emitted by the caller.
 *   {kind:'cancelled'} — user pressed Escape; caller runs p.cancel + process.exit(0).
 *
 * Invariants (PF-014):
 *   - Never calls process.exit(), never throws.
 *   - Returned arrays never alias seed arrays (defensive copies throughout).
 *   - All I/O is routed through the `prompts` parameter (injectable for tests).
 */
export async function runComplianceStep(opts: {
  seed: ComplianceFeatureState;
  prompts: CompliancePromptIO;
}): Promise<ComplianceStepOutcome> {
  const { seed, prompts } = opts;

  const currentStr = formatComplianceSummary(seed.enabled, seed.frameworks);
  prompts.note(
    `Current setting: ${currentStr}\n\n` +
    'Stamps the compliance rule with active framework labels and installs\n' +
    'framework reference files into the compliance skill. Only the\n' +
    'frameworks you select are included — zero selection = generic controls.\n\n' +
    formatFrameworkCatalogue(),
    'Compliance',
  );

  const enableOutcome = await prompts.select({
    message: 'Enable compliance?',
    options: [
      { value: true, label: 'Yes', hint: 'stamps frameworks into the compliance rule and skill' },
      { value: false, label: 'No', hint: 'enable later with devflow compliance --enable' },
    ],
    initialValue: seed.enabled,
  });

  if (enableOutcome.kind === 'cancel') return { kind: 'cancelled' };

  const enabled = enableOutcome.value;

  if (!enabled) {
    return {
      kind: 'resolved',
      // Never alias seed.frameworks — defensive copy (PF-014).
      state: { enabled: false, frameworks: [...seed.frameworks] },
      messages: [{
        level: 'info',
        text: 'Compliance: disabled — enable later with devflow compliance --enable',
      }],
    };
  }

  // enabled=true: show framework multiselect
  const multiselectOutcome = await prompts.multiselect({
    message: FRAMEWORK_SELECT_MESSAGE,
    options: frameworkChoices(),
    // Defensive copy: never alias seed.frameworks (PF-014).
    initialValues: [...seed.frameworks],
    required: false,
  });

  if (multiselectOutcome.kind === 'cancel') return { kind: 'cancelled' };

  const frameworks = multiselectOutcome.value;
  const fwLabel = frameworks.length > 0 ? frameworks.join(', ') : 'generic controls only';

  return {
    kind: 'resolved',
    state: { enabled: true, frameworks },
    messages: [{ level: 'success', text: `Compliance: enabled (${fwLabel})` }],
  };
}
