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
 *
 * Init never writes a level the user did not choose. readManifest() reads a manifest
 * it refuses as no manifest at all, yet `devflow gates` and the settings resolver
 * still read that file's level, so init reads the raw file in that case
 * (storedGateLevelFromRaw): a level found there is kept as stored, and a file that
 * cannot be read at all is named as unreadable, never shown as the default.
 */

import {
  clackNote,
  clackSelect,
  shouldRunPromptedWizardStep,
  type PromptOutcome,
  type WizardPromptIO,
} from './prompt-io.js';
import type { SummaryLine } from './install-report.js';
import {
  DEFAULT_GATE_LEVEL,
  GATE_LEVELS,
  parseGateLevel,
  readGateManifest,
  type GateLevel,
  type GateManifestRead,
} from '../../core/gate-level.js';
import type { ManifestData } from '../../core/manifest.js';

// ── Shared prompt content ──────────────────────────────────────────────────────

/** Message shown on the gate level select prompt. */
export const GATE_LEVEL_SELECT_MESSAGE = 'Gate level for this machine';

/**
 * What a malformed stored value reads as. `src/core/gate-level.ts` documents that
 * every reader folds a value that is not one of the three words to the strictest
 * level, so the prompt shows that level rather than a word the machine does not use.
 */
const MALFORMED_READS_AS: GateLevel = 'full';

/**
 * The one-line effect of each level, as the select hint and the catalogue show it.
 * It restates GATE_LEVEL_EFFECT in gates.ts per level: when a later command starts
 * to read the level, update both.
 */
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

// ── Where the stored level was found ───────────────────────────────────────────

/**
 * Where init found the stored machine gate level:
 *
 *   manifest    in the manifest init reads (or nowhere, on a first install or after
 *               --reset): the seed holds it
 *   rejected    in a manifest that readManifest() refuses, read raw: init keeps the
 *               level as stored while it replaces that manifest
 *   unreadable  nowhere: the manifest cannot be read at all, so what it stored is unknown
 */
export type StoredGateLevelOrigin = 'manifest' | 'rejected' | 'unreadable';

/** The raw stored level and where it was found. `value` is `undefined` when none is recorded. */
export interface StoredGateLevel {
  readonly origin: StoredGateLevelOrigin;
  readonly value: unknown;
}

/** `features.gateLevel` of a raw manifest, exactly as stored; `undefined` for an absent key. */
function rawGateLevelOf(raw: Record<string, unknown>): unknown {
  const features = raw.features;
  if (typeof features !== 'object' || features === null) return undefined;
  return Object.getOwnPropertyDescriptor(features, 'gateLevel')?.value;
}

/**
 * Classify the stored level from the raw read of a manifest that readManifest()
 * returned null for. Pure — the caller reads the file.
 *
 *   absent                 a first install: nothing stored
 *   rejected, with a key   the key's value, raw: a malformed value or `null` passes
 *                          through untouched, never defaulted, narrowed or healed
 *   rejected, no key       nothing stored
 *   corrupt                unreadable: no level can be known
 *   object                 readManifest() would accept it, so its level is an ordinary
 *                          stored level (a file that changed between the two reads)
 */
export function storedGateLevelFromRaw(read: GateManifestRead): StoredGateLevel {
  switch (read.kind) {
    case 'absent':
      return { origin: 'manifest', value: undefined };
    case 'corrupt':
      return { origin: 'unreadable', value: undefined };
    case 'object':
      return { origin: 'manifest', value: rawGateLevelOf(read.raw) };
    case 'rejected': {
      const value = rawGateLevelOf(read.raw);
      return { origin: value === undefined ? 'manifest' : 'rejected', value };
    }
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}

/**
 * Where init finds the stored level when it reads the machine manifest: the manifest
 * readManifest() returned, else (unless --reset asked to forget it) the raw file.
 * Never throws — readGateManifest() reports every failure as a result.
 *
 * Every writer that replaces the manifest reads the level through this one function, so
 * `devflow init` and `devflow init --hud-only` keep and report the same stored level.
 */
export async function readStoredGateLevel(
  devflowDir: string,
  manifest: ManifestData | null,
  reset: boolean,
): Promise<StoredGateLevel> {
  if (manifest !== null || reset) return { origin: 'manifest', value: manifest?.features.gateLevel };
  return storedGateLevelFromRaw(await readGateManifest(devflowDir));
}

/** The "Current setting" lines of the prompt note, from the stored value and where it was found. */
function currentSettingLines(stored: unknown, origin: StoredGateLevelOrigin): string {
  switch (origin) {
    case 'manifest':
      return `Current setting: ${describeGateLevel(stored)}`;
    case 'rejected':
      return `Current setting: ${describeGateLevel(stored)}\n` +
        'It comes from a manifest that devflow cannot use. Init replaces that manifest and keeps this level unless you choose another.';
    case 'unreadable':
      return 'Current setting: unknown\n' +
        `The stored gate level cannot be read, so ${DEFAULT_GATE_LEVEL} applies until you choose a level.`;
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
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
export function resolveGateLevelInitState(
  option: string | undefined,
  hudOnly: boolean,
): { ok: true; value: GateLevel } | { ok: false; error: string } | undefined {
  if (typeof option !== 'string') return undefined;
  const parsed = parseGateLevel(option);
  if (!parsed.ok) return { ok: false, error: parsed.error };
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
 * The gate table, keyed on modePromptShown and never on the mode name, is
 * `shouldRunPromptedWizardStep` in prompt-io.ts: the one authority for both wizard
 * paths, which reach it through resolveGateLevelForInit. `--gate-level <level>` is
 * the CLI override that suppresses the step on every path.
 *
 * Pure predicate — no side effects, fully testable without a TTY.
 */
export function shouldRunGateLevelStep(input: {
  mode: 'recommended' | 'advanced';
  modePromptShown: boolean;
  isTTY: boolean;
  hasCliOverride: boolean;
}): boolean {
  return shouldRunPromptedWizardStep(input);
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
 * and starts from it, and never narrows it. `storedOrigin` says where it was found
 * (default: the manifest); an unreadable level is shown as unknown, not as the default,
 * and the select then starts on the level that applies.
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
  storedOrigin?: StoredGateLevelOrigin;
  prompts: GateLevelPromptIO;
}): Promise<GateLevelStepOutcome> {
  const { stored, storedOrigin = 'manifest', prompts } = opts;

  prompts.note(
    `${currentSettingLines(stored, storedOrigin)}\n\n` +
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
  storedOrigin?: StoredGateLevelOrigin;
  mode: 'recommended' | 'advanced';
  modePromptShown: boolean;
  isTTY: boolean;
  prompts: GateLevelPromptIO;
}): Promise<GateLevelInitOutcome> {
  const { cliLevel, stored, storedOrigin, mode, modePromptShown, isTTY, prompts } = opts;
  if (shouldRunGateLevelStep({ mode, modePromptShown, isTTY, hasCliOverride: cliLevel !== undefined })) {
    const step = await runGateLevelStep({ stored, storedOrigin, prompts });
    return step.kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'resolved', level: step.level };
  }
  return { kind: 'resolved', level: cliLevel ?? stored };
}

// ── Summary ────────────────────────────────────────────────────────────────────

/**
 * The gate-level row of the Recommended settings note, from the level the run will
 * record (or the stored value it keeps) and where the stored value was found. Pure.
 *
 * It names the level the way the post-install summary does. A level that could not be
 * read, when this run records none, is shown as unknown, never as the default.
 */
export function formatGateLevelRow(level: unknown, origin: StoredGateLevelOrigin): string {
  if (origin === 'unreadable' && level === undefined) {
    return 'unknown (cannot be read, so init records none)';
  }
  return describeGateLevel(level);
}

/**
 * The gate-level lines of init's post-install summary, from the state the run acted
 * on (D-INIT-REAL-OUTCOME): the level this run recorded when the manifest reached
 * disk, else the level the manifest on disk still holds, with a warning that this
 * run saved nothing. Pure — the caller renders.
 *
 * `priorOrigin` says where the prior level was found (default: the manifest):
 *
 *   rejected     the level came from a manifest that was replaced; when the run
 *                recorded that same value, a warning says init kept it
 *   unreadable   no level could be read; a run that recorded none warns that standard
 *                now applies and how to set the level again
 */
export function formatGateLevelSummary(input: {
  level: unknown;
  priorLevel: unknown;
  priorOrigin?: StoredGateLevelOrigin;
  manifestWritten: boolean;
}): SummaryLine[] {
  const origin = input.priorOrigin ?? 'manifest';
  if (!input.manifestWritten) {
    const prior = origin === 'unreadable'
      ? 'unknown (the stored gate level cannot be read)'
      : describeGateLevel(input.priorLevel);
    return [{
      level: 'warn',
      message: `Gate level: ${prior} — this run could not save the manifest, so it changed nothing`,
    }];
  }
  if (origin === 'unreadable' && input.level === undefined) {
    return [{
      level: 'warn',
      message: `Gate level: the stored gate level could not be read, so init recorded none and ${DEFAULT_GATE_LEVEL} applies (the machine default); set it again with devflow gates --set <level>`,
    }];
  }
  const lines: SummaryLine[] = [{
    level: 'info',
    message: `Gate level: ${describeGateLevel(input.level)} — the machine default; change it with devflow gates --set <level>`,
  }];
  if (origin === 'rejected' && input.level === input.priorLevel) {
    lines.push({
      level: 'warn',
      message: 'Init kept the stored gate level while it replaced the manifest, which devflow could not use as a manifest',
    });
  }
  return lines;
}
