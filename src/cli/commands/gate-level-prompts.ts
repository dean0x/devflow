/**
 * Gate-level prompt helpers for devflow init.
 *
 * CLI-layer module: prompt-rendering logic lives in src/cli/commands/, the closed
 * set of levels and its parser stay in src/core/gate-level.ts.
 *
 * `devflow init` asks for the MACHINE gate level, `features.gateLevel` in
 * `~/.devflow/manifest.json`, the same field `devflow gates --set` writes. It never
 * writes the personal `gateLevel` in a repository's `.devflow/config.json`, which
 * still overrides the machine level there.
 *
 * The wizard gate keys on `modePromptShown` (was the Setup-mode p.select prompt
 * actually shown?), never on the mode name, so --recommended (flag, no prompt) and
 * the non-TTY fallback keep their promptless contracts: they carry the stored value
 * through untouched. `--gate-level <level>` sets the level on every path with no
 * prompt. runGateLevelStep and resolveGateLevelForInit never call process.exit() or
 * throw: callers own the cancel idiom (p.cancel + process.exit(0)).
 *
 * The shared DI seam (PromptOutcome, WizardPromptIO, clackNote, clackSelect) is
 * defined once in prompt-io.ts and imported here, never re-declared.
 */

import { clackNote, clackSelect, type PromptOutcome, type WizardPromptIO } from './prompt-io.js';
import type { SummaryLine } from './install-report.js';
import { DEFAULT_GATE_LEVEL, GATE_LEVELS, parseGateLevel, type GateLevel } from '../../core/gate-level.js';

// ── Shared prompt content ──────────────────────────────────────────────────────

/** Message shown on the gate level select prompt. */
export const GATE_LEVEL_SELECT_MESSAGE = 'Gate level for this machine';

/**
 * What a malformed stored value reads as. `src/core/gate-level.ts` documents that
 * every reader folds a value that is not one of the three words to the strictest
 * level, so the prompt shows that level rather than a word the machine does not use.
 */
const MALFORMED_READS_AS: GateLevel = 'full';

/** The one-line effect of each level, as the select hint and the catalogue show it. */
export const GATE_LEVEL_HINTS: Readonly<Record<GateLevel, string>> = Object.freeze({
  full: 'the most checking: every review focus and the full planning shape',
  standard: 'fewer review focuses and planning agents (the default)',
  lean: 'the least checking; /implement also has Validate run the project lint pack',
});

/** Build clack select options for the gate level list, most to least checking. */
export function gateLevelChoices(): Array<{ value: GateLevel; label: string; hint: string }> {
  return GATE_LEVELS.map(level => ({ value: level, label: level, hint: GATE_LEVEL_HINTS[level] }));
}

/**
 * Format a padded level catalogue suitable for a clack note body.
 * Produces: `  standard  fewer review focuses and planning agents (the default)`
 */
export function formatGateLevelCatalogue(): string {
  const width = Math.max(...GATE_LEVELS.map(level => level.length));
  return 'Levels:\n' + GATE_LEVELS.map(level => `  ${level.padEnd(width)}  ${GATE_LEVEL_HINTS[level]}`).join('\n');
}

/**
 * Name the level a stored manifest value stands for, for the note header and the
 * summary line. Pure function — no I/O, no side effects.
 *
 *   undefined   no level is recorded: `standard (default)`
 *   a level     that level
 *   otherwise   malformed: the level it reads as, and why
 *
 * `standard` carries the `(default)` marker only when nothing is recorded, so a
 * reader can tell "I chose this" from "this is what devflow does when nobody chooses".
 */
export function describeGateLevel(stored: unknown): string {
  if (stored === undefined) return `${DEFAULT_GATE_LEVEL} (default)`;
  const parsed = parseGateLevel(stored);
  if (parsed.ok) return parsed.value;
  return `${MALFORMED_READS_AS} (the stored value is not a gate level, so it reads as ${MALFORMED_READS_AS})`;
}

/**
 * The level the select starts on: the stored level on a re-init, the default on a
 * first install or after --reset, and the level a malformed value reads as.
 * Pure and total.
 */
export function gateLevelPromptSeed(stored: unknown): GateLevel {
  if (stored === undefined) return DEFAULT_GATE_LEVEL;
  const parsed = parseGateLevel(stored);
  return parsed.ok ? parsed.value : MALFORMED_READS_AS;
}

// ── The --gate-level boundary ──────────────────────────────────────────────────

/**
 * Parse the --gate-level option at the boundary, before any prompt or write.
 *
 * Strict — reject, never repair — so `Lean` or an empty value exits instead of
 * silently resolving. `--hud-only` installs only the HUD and writes no level, so
 * the pair is refused rather than the flag silently ignored.
 *
 * Returns undefined when the option was not passed.
 */
export function resolveGateLevelInitOption(
  option: string | undefined,
  hudOnly: boolean,
): { ok: true; value: GateLevel } | { ok: false; error: string } | undefined {
  if (typeof option !== 'string') return undefined;
  const parsed = parseGateLevel(option);
  if (!parsed.ok) return { ok: false, error: `--gate-level: ${parsed.error}` };
  if (hudOnly) {
    return {
      ok: false,
      error: '--gate-level cannot be used with --hud-only, which installs only the HUD. Use devflow gates --set, or run init without --hud-only.',
    };
  }
  return { ok: true, value: parsed.value };
}

// ── Gate predicate ─────────────────────────────────────────────────────────────

/**
 * Determines whether the gate-level wizard step should run for a given init invocation.
 *
 * Gate table (key on modePromptShown, never on the mode name):
 *
 *   --recommended flag / !isTTY fallback             → no (promptless contract preserved)
 *   Interactive mode-prompt → Recommended            → yes (modePromptShown=true)
 *   --advanced flag / re-init (banner path)          → yes (mode='advanced', isTTY=true)
 *   Interactive mode-prompt → Advanced               → yes (modePromptShown=true)
 *   Any path with --gate-level <level>               → no (hasCliOverride wins)
 *
 * Both wizard paths call this predicate through resolveGateLevelForInit, so the
 * table above is the single authority for both. Re-init is Advanced-only by
 * construction, so a Recommended-only wiring would be dead on every re-init.
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunGateLevelStep(input: {
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
 * Injectable prompt interface for runGateLevelStep.
 *
 * Extends WizardPromptIO (prompt-io.ts) with the three-value level select.
 * `WizardPromptIO.select` is boolean-typed, so `selectLevel` is a SIBLING rather
 * than a widening of the shared base, which would change the seam for every other
 * wizard step. The inherited boolean `select` is unused here; it stays so this
 * seam is substitutable for the shared one.
 */
export interface GateLevelPromptIO extends WizardPromptIO {
  selectLevel: (opts: {
    message: string;
    options: Array<{ value: GateLevel; label: string; hint: string }>;
    initialValue: GateLevel;
  }) => Promise<PromptOutcome<GateLevel>>;
}

/**
 * Build the real (clack) GateLevelPromptIO adapter.
 * Delegates the shared note + select to the shared adapters (prompt-io.ts).
 * Translates clack's cancel symbol into the PromptOutcome discriminated union.
 */
export function buildClackGateLevelPrompts(): GateLevelPromptIO {
  return {
    note: clackNote,

    select: (opts) => clackSelect(opts),

    selectLevel: (opts) => clackSelect(opts),
  };
}

// ── Step runner ────────────────────────────────────────────────────────────────

/** The gate-level step completed (the user picked a level). */
export interface GateLevelStepResolved {
  kind: 'resolved';
  level: GateLevel;
}

/** The gate-level step was cancelled (user pressed Escape). */
export interface GateLevelStepCancelled {
  kind: 'cancelled';
}

export type GateLevelStepOutcome = GateLevelStepResolved | GateLevelStepCancelled;

/**
 * Run the gate-level wizard step.
 *
 * Flow:
 *   1. Note — "Current setting: …" header, what the level is, and the catalogue.
 *   2. Level select — full / standard / lean with a one-line effect each, starting
 *      on the stored level (re-init) or the default (first install). `p.select`,
 *      never `p.confirm`: Enter-through must be an INFORMED keep of a named level.
 *
 * `stored` is the raw manifest value (see FeatureSeed.gateLevel): the step shows
 * and starts from it, and never narrows it.
 *
 * Returns:
 *   {kind:'resolved', level} — the chosen level.
 *   {kind:'cancelled'} — user pressed Escape; caller runs p.cancel + process.exit(0).
 *
 * Invariants:
 *   - Never calls process.exit(), never throws.
 *   - All I/O is routed through the `prompts` parameter (injectable for tests).
 */
export async function runGateLevelStep(opts: {
  stored: unknown;
  prompts: GateLevelPromptIO;
}): Promise<GateLevelStepOutcome> {
  const { stored, prompts } = opts;

  prompts.note(
    `Current setting: ${describeGateLevel(stored)}\n\n` +
    'Sets how much checking /code-review, /plan and /implement apply on this\n' +
    'machine. A personal "gateLevel" in a repository\'s .devflow/config.json\n' +
    'overrides it in that repository. Change it later with\n' +
    'devflow gates --set <level>.\n\n' +
    formatGateLevelCatalogue(),
    'Gate level',
  );

  const outcome = await prompts.selectLevel({
    message: GATE_LEVEL_SELECT_MESSAGE,
    options: gateLevelChoices(),
    initialValue: gateLevelPromptSeed(stored),
  });

  if (outcome.kind === 'cancel') return { kind: 'cancelled' };

  return { kind: 'resolved', level: outcome.value };
}

// ── Init orchestration ─────────────────────────────────────────────────────────

/**
 * What init records after the gate-level decision. `level` is the value for
 * `features.gateLevel`: the chosen level, or — when no prompt ran and no flag was
 * passed — the stored value exactly as it was (absent, malformed and `null`
 * included), so a plain init never lowers or heals a level.
 */
export type GateLevelInitOutcome =
  | { kind: 'resolved'; level: unknown }
  | { kind: 'cancelled' };

/**
 * Decide the machine gate level for one init wizard path.
 *
 * Precedence: --gate-level > wizard answer > the stored value (a first install
 * stores none, and the default then applies at read time). Both wizard paths call
 * this with their own `mode`; they share one gate, one cancel idiom and one prompt
 * adapter, so the paths cannot drift.
 */
export async function resolveGateLevelForInit(opts: {
  cliLevel: GateLevel | undefined;
  stored: unknown;
  mode: 'recommended' | 'advanced';
  modePromptShown: boolean;
  isTTY: boolean;
  prompts: GateLevelPromptIO;
}): Promise<GateLevelInitOutcome> {
  const { cliLevel, stored, mode, modePromptShown, isTTY, prompts } = opts;
  if (shouldRunGateLevelStep({ mode, modePromptShown, isTTY, hasCliOverride: cliLevel !== undefined })) {
    const step = await runGateLevelStep({ stored, prompts });
    return step.kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'resolved', level: step.level };
  }
  return { kind: 'resolved', level: cliLevel !== undefined ? cliLevel : stored };
}

// ── Summary ────────────────────────────────────────────────────────────────────

/**
 * The gate-level line of init's post-install summary, from the state the run acted
 * on (D-INIT-REAL-OUTCOME): the level this run recorded when the manifest reached
 * disk, else the level the manifest on disk still holds, with a warning that this
 * run saved nothing. Pure — the caller renders.
 */
export function formatGateLevelSummary(input: {
  level: unknown;
  priorLevel: unknown;
  manifestWritten: boolean;
}): SummaryLine[] {
  if (!input.manifestWritten) {
    return [{
      level: 'warn',
      message: `Gate level: ${describeGateLevel(input.priorLevel)} — this run could not save the manifest, so it changed nothing`,
    }];
  }
  return [{
    level: 'info',
    message: `Gate level: ${describeGateLevel(input.level)} — the machine default; change it with devflow gates --set <level>`,
  }];
}
