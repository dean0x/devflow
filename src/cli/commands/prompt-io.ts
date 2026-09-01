/**
 * Shared wizard prompt-IO seam for devflow init wizard steps.
 *
 * ADR-019 corollary (one-definition seam): PromptOutcome and WizardPromptIO
 * were byte-identical duplicates across attribution-prompts.ts and
 * compliance-prompts.ts (architecture-03 / consistency-06). They are defined
 * ONCE here and re-used via import.
 *
 * D-PROMPT-IO: WizardPromptIO is the base DI seam for all two-action wizard
 * steps (note + boolean select). Modules that add a third prompt extend this
 * interface with an intersection type (e.g. CompliancePromptIO).
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
