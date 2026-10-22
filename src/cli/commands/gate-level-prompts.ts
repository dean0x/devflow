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
  MALFORMED_GATE_LEVEL_READS_AS,
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
 * One short line for each level, as the select hint and the catalogue show it.
 * clack never wraps a note or a hint, so a hint stays within 60 characters and holds no line
 * break (a guard in `tests/gate-level-prompts.test.ts` holds both). The full effects of each
 * level live in GATE_LEVEL_EFFECT in gates.ts, in `devflow gates` and in the docs.
 * Change a hint when the level it names changes how much it checks. A command that reads the
 * level and has no rule that changes a phase leaves the hints true, so it changes
 * GATE_LEVEL_EFFECT alone. One test pins the exact text of both tables, so a change to
 * either fails it until you check the other table and update the pin; further rows check
 * the clauses the two tables share (the lint pack level, the levels that run fewer review
 * focuses and the levels that skip Polish).
 */
export const GATE_LEVEL_HINTS: Readonly<Record<GateLevel, string>> = Object.freeze({
  full: 'the most checking: every review focus, and Polish',
  standard: 'fewer review focuses, no Polish (the default)',
  lean: 'the least checking: no Polish, Validate runs the lint pack',
});

/** Build clack select options for the gate level list, most to least checking. */
export function gateLevelChoices(): Array<{ value: GateLevel; label: string; hint: string }> {
  return GATE_LEVELS.map(level => ({ value: level, label: level, hint: GATE_LEVEL_HINTS[level] }));
}

/**
 * Format a padded level catalogue suitable for a clack note body.
 * Produces: `  standard  fewer review focuses, no Polish (the default)`
 */
export function formatGateLevelCatalogue(): string {
  const width = Math.max(...GATE_LEVELS.map(level => level.length));
  return 'Levels:\n' + GATE_LEVELS.map(level => `  ${level.padEnd(width)}  ${GATE_LEVEL_HINTS[level]}`).join('\n');
}

// ── Where the stored level was found ───────────────────────────────────────────

/**
 * Where init found the stored machine gate level:
 *
 *   manifest    in the manifest init reads (or nowhere, on a first install or after
 *               --reset): the seed holds it
 *   rejected    in a manifest that readManifest() refuses, read raw: init keeps the
 *               level as stored while it replaces that manifest
 *   unreadable  nowhere: the manifest cannot be read at all, or stores a level that cannot be
 *               written back as JSON, so what it stored is unknown
 */
export const STORED_GATE_LEVEL_ORIGINS = ['manifest', 'rejected', 'unreadable'] as const;
export type StoredGateLevelOrigin = (typeof STORED_GATE_LEVEL_ORIGINS)[number];

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

const UNREADABLE_GATE_LEVEL: StoredGateLevel = Object.freeze({ origin: 'unreadable', value: undefined });

/**
 * Whether a raw value can be written back as JSON. The file parses a value that nests
 * deeper than the serializer's stack, and writing that value back fails, which would stop
 * init from ever replacing the manifest that stores it.
 */
function serializes(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
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
 *   a value that does not serialize
 *                          unreadable, whatever the file: the level cannot be kept
 */
export function storedGateLevelFromRaw(read: GateManifestRead): StoredGateLevel {
  switch (read.kind) {
    case 'absent':
      return { origin: 'manifest', value: undefined };
    case 'corrupt':
      return UNREADABLE_GATE_LEVEL;
    case 'object':
    case 'rejected': {
      const value = rawGateLevelOf(read.raw);
      if (value !== undefined && !serializes(value)) return UNREADABLE_GATE_LEVEL;
      return { origin: read.kind === 'rejected' && value !== undefined ? 'rejected' : 'manifest', value };
    }
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}

/**
 * Where init finds the stored level when it reads the machine manifest: the manifest
 * readManifest() returned, else the raw file. Never throws — readGateManifest() reports
 * every failure as a result.
 *
 * This is the level the run replaces, which the summary names. Every writer that
 * replaces the manifest reads it through this one function, so `devflow init` and
 * `devflow init --hud-only` report the same stored level. `--reset` forgets a level in
 * what it writes (see {@link carriedGateLevel}), not in what it reports, except for a
 * manifest it cannot read: there is no level to name, and the reset forgets it anyway.
 */
export async function readStoredGateLevel(
  devflowDir: string,
  manifest: ManifestData | null,
  reset: boolean,
): Promise<StoredGateLevel> {
  if (manifest !== null) return { origin: 'manifest', value: manifest.features.gateLevel };
  const stored = storedGateLevelFromRaw(await readGateManifest(devflowDir));
  return reset && stored.origin === 'unreadable' ? { origin: 'manifest', value: undefined } : stored;
}

/**
 * The level a full init starts from, and where it was found: what the manifest it writes
 * holds unless --gate-level or the wizard answer sets another. Pure.
 *
 * The seed holds the level of the manifest readManifest() returned, and none after
 * --reset. When readManifest() returned none, the raw reading is the level to keep: init
 * never writes a level the user did not choose, and `init --hud-only` keeps the same one.
 * That holds for a refused manifest and for a file that changed between the two reads.
 * --reset forgets it.
 */
export function carriedGateLevel(input: {
  manifest: ManifestData | null;
  reset: boolean;
  stored: StoredGateLevel;
  seedLevel: unknown;
}): StoredGateLevel {
  const { manifest, reset, stored, seedLevel } = input;
  if (manifest !== null || reset) return { origin: 'manifest', value: seedLevel };
  return stored;
}

// ── Reading a stored level ─────────────────────────────────────────────────────

/**
 * What a stored value stands for. Every text, seed and comparison about a stored
 * level starts from this one classification:
 *
 *   default      nothing is recorded: the machine default applies
 *   level        one of the three words
 *   malformed    a value that is not a level, `null` and the empty string included;
 *                every reader reads it as MALFORMED_GATE_LEVEL_READS_AS
 *   unreadable   the manifest cannot be read, so what it stored is unknown
 */
export type GateLevelReading =
  | { readonly kind: 'default' }
  | { readonly kind: 'level'; readonly level: GateLevel }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'unreadable' };

/**
 * Classify a raw stored value, and where it was found (default: the manifest init
 * reads). Pure and total — the one place that tells absent, valid and malformed
 * apart.
 *
 * `unreadable` is an absent value from a manifest that could not be read: no value
 * was read, so none is shown as the default. A value that is present is classified
 * as itself whatever the origin.
 */
export function classifyGateLevel(stored: unknown, origin: StoredGateLevelOrigin = 'manifest'): GateLevelReading {
  if (stored === undefined) return origin === 'unreadable' ? { kind: 'unreadable' } : { kind: 'default' };
  const parsed = parseGateLevel(stored);
  return parsed.ok ? { kind: 'level', level: parsed.value } : { kind: 'malformed' };
}

/**
 * The level that applies for a reading, as every reader gives it: the level itself,
 * the default for an absent or unknown one, and the fold for a malformed one.
 */
function appliedLevel(reading: GateLevelReading): GateLevel {
  switch (reading.kind) {
    case 'level':
      return reading.level;
    case 'malformed':
      return MALFORMED_GATE_LEVEL_READS_AS;
    case 'default':
    case 'unreadable':
      return DEFAULT_GATE_LEVEL;
    default: {
      const exhaustive: never = reading;
      return exhaustive;
    }
  }
}

/**
 * A malformed value, in the words of the `Machine:` line of `devflow gates`
 * (MACHINE_INVALID_LINE in gates.ts): a parity test holds the two to the same text.
 * The raw value is never shown.
 */
const MALFORMED_TEXT = `invalid (manifest.json; reads as ${MALFORMED_GATE_LEVEL_READS_AS})`;

/** A reading as the note header and the summary line name it. */
function describeReading(reading: GateLevelReading): string {
  switch (reading.kind) {
    case 'default':
      return `${DEFAULT_GATE_LEVEL} (default)`;
    case 'level':
      return reading.level;
    case 'malformed':
      return MALFORMED_TEXT;
    case 'unreadable':
      return 'unknown (the stored gate level cannot be read)';
    default: {
      const exhaustive: never = reading;
      return exhaustive;
    }
  }
}

/**
 * Name the level a stored manifest value stands for, for the note header and the
 * summary line. Pure function — no I/O, no side effects.
 *
 *   undefined   no level is recorded: `standard (default)`
 *   a level     that level
 *   otherwise   malformed: `invalid`, and the level it reads as, as `devflow gates` words it
 *
 * `standard` carries the `(default)` marker only when nothing is recorded, so a
 * reader can tell "I chose this" from "this is what devflow does when nobody chooses".
 */
export function describeGateLevel(stored: unknown): string {
  return describeReading(classifyGateLevel(stored));
}

/**
 * The level the select starts on: the stored level on a re-init, the default on a
 * first install, after --reset or when the stored level cannot be read, and the level
 * a malformed value reads as. Pure and total.
 */
export function gateLevelPromptSeed(stored: unknown, origin: StoredGateLevelOrigin = 'manifest'): GateLevel {
  return appliedLevel(classifyGateLevel(stored, origin));
}

/** The "Current setting" lines of the prompt note, from the stored value and where it was found. Each line fits the 72 columns the note allows. */
function currentSettingLines(stored: unknown, origin: StoredGateLevelOrigin): string {
  switch (origin) {
    case 'manifest':
      return `Current setting: ${describeGateLevel(stored)}`;
    case 'rejected':
      return [
        `Current setting: ${describeGateLevel(stored)}`,
        'It comes from a manifest that devflow rejects.',
        'Init replaces that manifest and keeps this level',
        'unless you choose another.',
      ].join('\n');
    case 'unreadable':
      return [
        'Current setting: unknown',
        `The stored gate level cannot be read, so ${DEFAULT_GATE_LEVEL} applies`,
        'until you choose a level.',
      ].join('\n');
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
    'Sets how much checking /code-review, /plan, /implement and /resolve\n' +
    'apply on this machine. A personal "gateLevel" in a repository\'s\n' +
    '.devflow/config.json overrides it in that repository. Change it later\n' +
    'with devflow gates --set <level>.\n\n' +
    formatGateLevelCatalogue(),
    'Gate level',
  );

  const outcome = await prompts.selectLevel({
    message: GATE_LEVEL_SELECT_MESSAGE,
    options: gateLevelChoices(),
    initialValue: gateLevelPromptSeed(stored, storedOrigin),
  });

  if (outcome.kind === 'cancel') return { kind: 'cancelled' };

  return { kind: 'resolved', level: outcome.value };
}

// ── Init orchestration ─────────────────────────────────────────────────────────

/**
 * What init records after the gate-level decision. `level` is the value for
 * `features.gateLevel`: the chosen level, or — when no prompt ran and no flag was
 * passed — the stored value exactly as it was (absent, malformed and `null`
 * included), so a plain init never lowers or heals a level. `carried` says which: it is
 * true only for the stored value, and false for a level the user chose with
 * --gate-level or at the prompt.
 */
export interface GateLevelDecision {
  readonly level: unknown;
  readonly carried: boolean;
}

export type GateLevelInitOutcome =
  | ({ kind: 'resolved' } & GateLevelDecision)
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
  storedOrigin: StoredGateLevelOrigin;
  mode: 'recommended' | 'advanced';
  modePromptShown: boolean;
  isTTY: boolean;
  prompts: GateLevelPromptIO;
}): Promise<GateLevelInitOutcome> {
  const { cliLevel, stored, storedOrigin, mode, modePromptShown, isTTY, prompts } = opts;
  if (shouldRunGateLevelStep({ mode, modePromptShown, isTTY, hasCliOverride: cliLevel !== undefined })) {
    const step = await runGateLevelStep({ stored, storedOrigin, prompts });
    return step.kind === 'cancelled' ? { kind: 'cancelled' } : { kind: 'resolved', level: step.level, carried: false };
  }
  return cliLevel === undefined
    ? { kind: 'resolved', level: stored, carried: true }
    : { kind: 'resolved', level: cliLevel, carried: false };
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
  const reading = classifyGateLevel(level, origin);
  return reading.kind === 'unreadable'
    ? 'unknown (cannot be read, so init records none)'
    : describeReading(reading);
}

/**
 * ` (was X)` when a run changed the level that applies, else empty. It compares the
 * levels the two readings stand for, so a malformed value written back as it was
 * stored, or accepted at the prompt as the level it reads as, is no change. An
 * unreadable prior has no level to name, so none is invented.
 */
function replacedLevelNote(prior: GateLevelReading, recorded: GateLevelReading): string {
  if (prior.kind === 'unreadable') return '';
  const was = appliedLevel(prior);
  return was === appliedLevel(recorded) ? '' : ` (was ${was})`;
}

/**
 * The gate-level lines of init's post-install summary, from the state the run acted
 * on (D-INIT-REAL-OUTCOME): the level this run recorded when the manifest reached
 * disk, else the level the manifest on disk still holds, with a warning that the gate
 * level did not change. Pure — the caller renders.
 *
 * A run that changes the level that applies names the one it replaced: `(was lean)`.
 *
 * `priorOrigin` says where the prior level was found (default: the manifest):
 *
 *   rejected     the level came from a manifest that was replaced; when `kept` is
 *                true, a warning says init kept it
 *   unreadable   no level could be read; a run that recorded none warns that standard
 *                now applies and how to set the level again
 *
 * `kept` is true only when the manifest was written with the stored level carried
 * over: no --reset, no --gate-level and no prompt answer chose the level. A level the
 * user chose is a choice, even when it equals the stored one.
 */
export function formatGateLevelSummary(input: {
  level: unknown;
  priorLevel: unknown;
  priorOrigin?: StoredGateLevelOrigin;
  kept: boolean;
  manifestWritten: boolean;
}): SummaryLine[] {
  const origin = input.priorOrigin ?? 'manifest';
  const prior = classifyGateLevel(input.priorLevel, origin);
  if (!input.manifestWritten) {
    return [{
      level: 'warn',
      message: `Gate level: ${describeReading(prior)} — this run could not save the manifest, so the gate level did not change`,
    }];
  }
  const recorded = classifyGateLevel(input.level, origin);
  if (recorded.kind === 'unreadable') {
    return [{
      level: 'warn',
      message: `Gate level: the stored gate level could not be read, so init recorded none and ${DEFAULT_GATE_LEVEL} applies (the machine default); set it again with devflow gates --set <level>`,
    }];
  }
  const lines: SummaryLine[] = [{
    level: 'info',
    message: `Gate level: ${describeReading(recorded)}${replacedLevelNote(prior, recorded)} — the machine default; change it with devflow gates --set <level>`,
  }];
  if (origin === 'rejected' && input.kept) {
    lines.push({
      level: 'warn',
      message: 'Init kept the stored gate level while it replaced a manifest that devflow rejects',
    });
  }
  return lines;
}
