/**
 * Behavior wizard step for devflow init.
 *
 * D-BEHAVIOR-OPT-IN: the behavior rule is opt-in and default off, so the wizard asks
 * one two-action question (No is the default on a fresh machine) and nothing else. The
 * step lives in the Advanced path only, like external model routing: the Recommended
 * path and every non-TTY path carry the seeded value unchanged (off on a fresh machine,
 * the recorded value on re-init) and take `--behavior` / `--no-behavior` as overrides.
 *
 * CLI-layer module over the shared prompt-IO seam (prompt-io.ts): the gate is a pure
 * predicate, all I/O goes through the injected `WizardPromptIO`, and runBehaviorStep
 * never calls process.exit() or throws — the caller owns the cancel idiom.
 */
import { clackNote, clackSelect, type WizardPromptIO } from './prompt-io.js';

// ── Gate predicate ─────────────────────────────────────────────────────────────

/**
 * Whether the behavior wizard step should run. Called from the Advanced path only.
 *
 * Gate table:
 *
 *   --behavior / --no-behavior passed   → no (the flag wins)
 *   no interactive terminal             → no (promptless contract preserved)
 *   rules off                           → no (the rule cannot install; the seed is kept)
 *   otherwise                           → yes
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunBehaviorStep(input: {
  isTTY: boolean;
  hasCliOverride: boolean;
  rulesEnabled: boolean;
}): boolean {
  if (input.hasCliOverride) return false;
  if (!input.isTTY) return false;
  return input.rulesEnabled;
}

// ── DI seam ────────────────────────────────────────────────────────────────────

/** Build the real (clack) prompt adapter: the shared note and select, nothing more. */
export function buildClackBehaviorPrompts(): WizardPromptIO {
  return { note: clackNote, select: clackSelect };
}

// ── Step runner ────────────────────────────────────────────────────────────────

/** Message emitted after the behavior step resolves. */
export interface BehaviorStepMessage {
  level: 'success' | 'info';
  text: string;
}

export type BehaviorStepOutcome =
  | { kind: 'resolved'; enabled: boolean; messages: BehaviorStepMessage[] }
  | { kind: 'cancelled' };

/**
 * Run the behavior wizard step.
 *
 * Flow: one note that says what the rule does, then a labeled Yes / No select seeded from
 * the prior state (`false` on a fresh machine).
 *
 * Returns `{kind:'resolved', enabled, messages}` once the user answers, or
 * `{kind:'cancelled'}` on Escape; the caller runs p.cancel + process.exit(0).
 */
export async function runBehaviorStep(opts: {
  seed: boolean;
  prompts: WizardPromptIO;
}): Promise<BehaviorStepOutcome> {
  const { seed, prompts } = opts;

  prompts.note(
    'Installs one extra rule that asks agents to write replies in ASD-STE100\n' +
    'Simplified Technical English: short sentences, one idea each, common words,\n' +
    'active voice, simple tenses. Code, commands and quoted text keep their own form.\n' +
    'The rule is small and loads in every session. Off by default; applies to every project.',
    'Behavior',
  );

  const choice = await prompts.select({
    message: 'Enable the behavior rule?',
    options: [
      { value: true, label: 'Yes', hint: 'agents reply in Simplified Technical English' },
      { value: false, label: 'No', hint: 'enable later with devflow behavior --enable' },
    ],
    initialValue: seed,
  });

  if (choice.kind === 'cancel') return { kind: 'cancelled' };

  return choice.value
    ? {
        kind: 'resolved',
        enabled: true,
        messages: [{ level: 'success', text: 'Behavior rule: enabled' }],
      }
    : {
        kind: 'resolved',
        enabled: false,
        messages: [{ level: 'info', text: 'Behavior rule: disabled — enable later with devflow behavior --enable' }],
      };
}
