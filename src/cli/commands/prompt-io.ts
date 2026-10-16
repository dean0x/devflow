/**
 * Shared wizard prompt-IO seam for devflow init wizard steps.
 *
 * One-definition seam: PromptOutcome and WizardPromptIO were byte-identical
 * duplicates across attribution-prompts.ts and compliance-prompts.ts
 * (architecture-03 / consistency-06). They are defined ONCE here and re-used
 * via import.
 *
 * D-PROMPT-IO: WizardPromptIO is the base DI seam for all two-action wizard
 * steps (note + boolean select). Modules that add a third prompt extend this
 * interface with an intersection type (e.g. CompliancePromptIO).
 *
 * The shared wizard gate predicate (shouldRunPromptedWizardStep) lives here too,
 * beside the seam every prompted step already imports.
 */

import * as p from '@clack/prompts';
import type { SelectOptions } from '@clack/prompts';

// ── Shared types ─────────────────────────────────────────────────────────────

/** Discriminated union returned by every WizardPromptIO method. */
export type PromptOutcome<T> = { kind: 'value'; value: T } | { kind: 'cancel' };

/**
 * Base injectable prompt interface for two-action wizard steps.
 *
 * Carries the shared note + boolean-select seam. Steps that add a third
 * prompt (e.g. compliance multiselect) extend this interface:
 *   export interface CompliancePromptIO extends WizardPromptIO { multiselect: … }
 *
 * Enables unit tests to drive all branches without a real TTY (mirrors the
 * ProxyPreflightDeps pattern in src/cli/commands/proxy.ts).
 */
export interface WizardPromptIO {
  note: (message: string, title: string) => void;
  select: (opts: {
    message: string;
    options: Array<{ value: boolean; label: string; hint: string }>;
    initialValue: boolean;
  }) => Promise<PromptOutcome<boolean>>;
}

// ── Shared gate predicate ─────────────────────────────────────────────────────

/**
 * Determines whether a wizard step that runs on both wizard paths should run for a
 * given init invocation.
 *
 * Gate table (key on modePromptShown, never on the mode name):
 *
 *   --recommended flag / !isTTY fallback             → no (promptless contract preserved)
 *   Interactive mode-prompt → Recommended            → yes (modePromptShown=true)
 *   --advanced flag / re-init (banner path)          → yes (mode='advanced', isTTY=true)
 *   Interactive mode-prompt → Advanced               → yes (modePromptShown=true)
 *   Any path with the step's CLI flag                → no (hasCliOverride wins)
 *
 * A step that wires only the Recommended path is dead on every re-init, because re-init
 * is Advanced-only by construction, so each step calls this predicate from both paths.
 * The gate-level step delegates here. The attribution step is Advanced-only by design
 * and does not use this table.
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunPromptedWizardStep(input: {
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

// ── Shared clack adapters ─────────────────────────────────────────────────────

/** Real clack adapter for the note prompt. */
export function clackNote(message: string, title: string): void {
  p.note(message, title);
}

/**
 * Real clack adapter for a select prompt, generic over the option value type T.
 *
 * typescript-05: no `as T` cast on the result path. `p.select<T>` returns
 * `Promise<symbol | T>`; `p.isCancel` is a `(value: unknown) => value is symbol`
 * guard that narrows away the cancel branch, leaving `result: T` without a cast.
 * An `as T` here would mask a future widening of the library's return type.
 *
 * The `as unknown as SelectOptions<T>` on the input is a safe bridge for the
 * unresolved conditional type `Option<T>` — our shape satisfies both branches
 * (Primitive: label optional; non-Primitive: label required) and is strictly
 * narrower, so no value-type information is lost.
 */
export async function clackSelect<T>(opts: {
  message: string;
  options: Array<{ value: T; label: string; hint: string }>;
  initialValue: T;
}): Promise<PromptOutcome<T>> {
  const result = await p.select<T>(opts as unknown as SelectOptions<T>);
  if (p.isCancel(result)) return { kind: 'cancel' };
  return { kind: 'value', value: result };
}
