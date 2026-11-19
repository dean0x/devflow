/**
 * devflow flags — Manage Claude Code feature flags.
 *
 * D-P3-1: Typed flags CLI rewrite (Phase 3).
 *   - createFlagsCommand() factory — fresh Commander instance per call;
 *     used by tests; src/cli.ts consumes the flagsCommand singleton export.
 *   - Persist pipeline: convergeFlagsIntoSettings (fold-before-strip) — the
 *     single pipeline entry point shared with init.ts (ARCH-H1).
 *   - process.exit swallows async work: all error paths set
 *     process.exitCode = 1 and return; never call process.exit().
 *   - Multi-artifact fan-out: compute record first; settings write
 *     and manifest write handled independently with their own error paths.
 *   - Applies-on-restart: bare non-TTY invocation prints status table
 *     with a note that changes apply on restart.
 *   - Validate at the sink: parseFlagValueInput → coerceFlagValue
 *     runs inside the core helpers before any write.
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  getClaudeDirectory,
  getDevFlowDirectory,
} from '../../targets/claude-code/claude-paths.js';
import {
  FLAG_REGISTRY,
  findFlag,
  convergeFlagsIntoSettings,
  parseFlagValueInput,
  formatFlagValue,
  effectiveDisplay,
  neutralValueOf,
  describeFlagKind,
  expectedInputFor,
  respectUserOwnedSettings,
  type ClaudeCodeFlag,
  type FlagsRecord,
  type FlagsRecordValue,
} from '../../core/flags.js';
import {
  CODE_MODE_NEW_SESSIONS_SUFFIX,
  CODE_MODE_READ_FAILURE,
  codeModeBlockers,
  codeModeRefusal,
  codeModeStatusNotes,
  isCodeModeOn,
  isTrafficOn,
  readCodeModeSignals,
  turnsOnCodeMode,
  writeTimeWarnings,
} from '../../core/code-mode.js';
import type { CodeModeBlockerState, CodeModeSignals } from '../../core/code-mode.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { writeSettingsFileAtomic } from '../../core/fs-atomic.js';
import { sanitizeCell } from '../tui/cells.js';
// Static imports for pure view-state helpers — no TTY machinery.
// runFlagsTui stays lazily imported in handleBare to keep TTY module out of
// --list/--status code paths; buildFlagRows and collectFlagRecord are pure.
import { buildFlagRows, collectFlagRecord } from '../flags-view/state.js';
import type { FlagsTuiResult } from '../flags-view/terminal.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

function blockerState({ record, env, proxyOn }: CodeModeSignals): CodeModeBlockerState {
  return { codeModeOn: isCodeModeOn(record, env), trafficOn: isTrafficOn(record, env), proxyOn };
}

interface CodeModeWrite {
  readonly before: CodeModeBlockerState | undefined;
  readonly explicitOn?: readonly string[];
}

/** Preflight must finish before any path that can write. */
async function checkCodeModeWrite(
  claudeDir: string,
  devflowDir: string,
  requestedOn: boolean,
): Promise<{ ok: true; value: CodeModeWrite } | { ok: false }> {
  const signals = await readCodeModeSignals(claudeDir, devflowDir);
  const before = signals.ok ? blockerState(signals.value) : undefined;
  const turnsOn = before !== undefined && turnsOnCodeMode(before.codeModeOn, requestedOn);
  const refusal = requestedOn && (!signals.ok || signals.value.env === undefined)
    ? CODE_MODE_READ_FAILURE
    : before && codeModeRefusal(before, turnsOn);
  if (refusal) {
    p.log.error(refusal);
    process.exitCode = 1;
    return { ok: false };
  }
  return { ok: true, value: { before, explicitOn: turnsOn ? ['code-mode'] : undefined } };
}

function logFlagSuccess(id: string, line: string): void {
  p.log.success(id === 'code-mode' ? `${line}. ${CODE_MODE_NEW_SESSIONS_SUFFIX}` : line);
}

/**
 * Read and parse settings.json.
 * ENOENT → returns `{ content: '{}', ok: true }`.
 * Malformed JSON → returns `{ ok: false, reason: string }`.
 *
 * NEVER silently falls back to '{}' on malformed JSON — that would clobber the
 * user's settings. The caller must abort with exit code 1 on !ok.
 */
async function readSettingsSafe(
  settingsPath: string,
): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, content: '{}' };
    }
    return { ok: false, reason: `Cannot read settings.json: ${(err as Error).message}` };
  }

  // REL-M2 + PERF-L4: single parse — validate root shape and return raw string.
  // The plain-object guard catches null/array roots before they reach applyFlags/stripFlags
  // (validate at the sink; early rejection gives actionable error messages).
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'settings.json is malformed — fix it before changing flags' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'settings.json must be a JSON object — fix it before changing flags' };
  }
  return { ok: true, content: raw };
}

/**
 * Discriminated result for persistFlagConfig.
 *
 * Makes the absent-manifest state unrepresentable as success (TS-H2 / ARCH-H2 /
 * REL-H2). Three distinct outcomes:
 *   - ok:true          — both settings.json and manifest.json were written.
 *   - ok:false + failed — one or both artifact writes failed; messages + exitCode
 *                         already set inside the function (per-artifact independence).
 *   - ok:false + reason:'no-manifest' — no manifest present; flag state not
 *                         recorded. An absent manifest is a failure, not a no-op.
 *
 * Callers print success ("Flags saved.", "X enabled", …) ONLY when ok === true.
 * Exported so applyTuiResult can reference it in its return type.
 */
export type PersistResult =
  | { ok: true }
  | { ok: false; failed: ReadonlyArray<'settings' | 'manifest'> }
  | { ok: false; reason: 'no-manifest' };

/**
 * Persist a FlagsRecord to settings.json and manifest.
 *
 * Uses `convergeFlagsIntoSettings` (ARCH-H1: fold-before-strip pipeline) so the
 * invariant lives in the pipeline, not at call sites. This ensures that:
 *   - An externally-set /focus survives unless viewModeExplicit is true.
 *   - Valued flags not yet claimed by devflow (absent from the manifest record)
 *     have their existing settings values preserved rather than stripped (REG-H1,
 *     SEC-M3).
 *
 * Settings write and manifest write are evaluated independently.
 * Each failure is reported with its own message and exit code 1.
 * The second write is never skipped due to the first succeeding or failing.
 *
 * Returns a discriminated PersistResult (never a boolean — avoids the two-state
 * lie that cannot express the third "manifest absent" outcome). Success is tracked
 * in LOCALS, never read back off `process.exitCode`, which is process-wide and
 * may already have been set by an earlier, unrelated failure.
 */
async function persistFlagConfig(
  claudeDir: string,
  devflowDir: string,
  settingsContent: string,
  newRecord: FlagsRecord,
  // ARCH-M2 + PERF-L1: caller passes the already-read manifest so this function
  // does not re-read it (two snapshots, one write; readManifest also self-heals
  // = extra write). null → {ok:false,reason:'no-manifest'} (C2 discriminant intact).
  manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>> | null,
  opts: CodeModeWrite & { readonly viewModeExplicit?: boolean },
): Promise<PersistResult> {
  // D15: convergeFlagsIntoSettings is the fold-before-strip pipeline entry point
  // (REG-H1, ARCH-H1). ownedRecord is omitted so the
  // `newRecord` (the manifest record) serves as the owned set — a key present in
  // the manifest means devflow previously claimed it; absent = never written by
  // devflow, so the existing settings value is adopted.
  const { settings: updatedSettings, record: foldedRecord } = convergeFlagsIntoSettings(
    settingsContent,
    newRecord,
    { viewModeExplicit: opts.viewModeExplicit ?? false, explicitOn: opts.explicitOn },
  );

  // Accumulate each artifact's failure independently; combine at the end.
  const failed: Array<'settings' | 'manifest'> = [];

  // Settings write — independent error path.
  const settingsPath = path.join(claudeDir, 'settings.json');
  try {
    await writeSettingsFileAtomic(settingsPath, updatedSettings);
  } catch (err) {
    p.log.error(`Failed to write settings.json: ${err instanceof Error ? err.message : String(err)}`);
    failed.push('settings');
    process.exitCode = 1;
    // Still attempt the manifest write — evaluate each artifact independently.
  }

  // Manifest write — independent error path.
  // Uses foldedRecord (not newRecord) so adopted values are persisted to the
  // manifest, keeping manifest ↔ settings.json in sync.
  //
  // An absent manifest is a FAILURE, not a no-op (TS-H2 / ARCH-H2 / REL-H2):
  // returning success here would tell the user "Flags saved." while the manifest
  // was never updated — reverted on the next `devflow init`.
  if (!manifest) {
    p.log.error('No devflow manifest found — flag selections were not recorded. Run devflow init first.');
    process.exitCode = 1;
    // Return the dedicated discriminant so callers cannot accidentally suppress it.
    return { ok: false, reason: 'no-manifest' };
  }

  manifest.features.flags = foldedRecord;
  manifest.updatedAt = new Date().toISOString();
  try {
    await writeManifest(devflowDir, manifest);
  } catch (err) {
    p.log.error(`Failed to write manifest.json: ${err instanceof Error ? err.message : String(err)}`);
    failed.push('manifest');
    process.exitCode = 1;
  }

  if (failed.length > 0) return { ok: false, failed };

  const after = await readCodeModeSignals(claudeDir, devflowDir);
  if (after.ok) {
    for (const line of writeTimeWarnings(opts.before, blockerState(after.value))) p.log.warn(line);
  }
  return { ok: true };
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

/** Loaded manifest + settings.json content for the mutating CLI branches. */
interface FlagContext {
  manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>>;
  settingsContent: string;
}

/**
 * Load manifest and settings.json for the mutating CLI branches.
 *
 * Returns a discriminated result — never exits itself. The dispatcher or handler
 * reports the reason and sets process.exitCode = 1 on failure.
 * One shared load path means a fix lands once, not four times (the four copies
 * of the same preamble are exactly the "fix on one site, miss the other three"
 * shape).
 */
async function loadFlagContext(
  claudeDir: string,
  devflowDir: string,
): Promise<{ ok: true; value: FlagContext } | { ok: false; reason: string }> {
  // Defer manifest writes until persist, so a refused or canceled TUI save leaves no changes.
  const manifest = await readManifest(devflowDir, { heal: false });
  if (!manifest) {
    return { ok: false, reason: 'No devflow installation found — run devflow init first' };
  }
  const settingsResult = await readSettingsSafe(path.join(claudeDir, 'settings.json'));
  if (!settingsResult.ok) {
    return { ok: false, reason: settingsResult.reason };
  }
  return { ok: true, value: { manifest, settingsContent: settingsResult.content } };
}

/**
 * Format the current FlagsRecord as a status table — one row per registry flag.
 *
 * Shared between --status (p.log.info sink) and bare non-TTY (process.stdout.write
 * sink). Both call sites choose their own sink; this function produces the row
 * strings only (CPLX-SF5, CONS-M3: the longer "not adopted — default X applies
 * on next devflow init" wording is kept in both surfaces; the short form dropped
 * the actionable second half).
 *
 * Returns plain strings — sanitizeCell strips control characters to prevent a
 * persisted LF/TAB from reshaping the line-oriented table (applies SEC-M1).
 */
function formatStatusRows(record: FlagsRecord): string[] {
  return FLAG_REGISTRY.map(flag => {
    const value = Object.prototype.hasOwnProperty.call(record, flag.id)
      ? record[flag.id]
      : undefined;
    // sanitizeCell: defence in depth — a persisted LF/TAB must not inject extra
    // rows into the line-oriented table (applies SEC-M1).
    // D-EFFDV: effectiveDisplay supplies the default label so 'unset' never appears.
    const rawDisplay = value !== undefined
      ? formatFlagValue(flag, value)
      : `not adopted — default: ${effectiveDisplay(flag, neutralValueOf(flag)).text} applies on next devflow init`;
    const displayValue = sanitizeCell(rawDisplay);
    return `${flag.id.padEnd(28)} ${displayValue}`;
  });
}

// ─── Branch handlers ──────────────────────────────────────────────────────────
//
// One named async handler per CLI branch — each is independently readable and
// carries one responsibility. The dispatcher (createFlagsCommand action) is ~15
// lines and routes without logic of its own (ARCH-M1, CPLX-H1).

/** Handle --list: read only the registry and user settings env. */
async function handleList(claudeDir: string): Promise<void> {
  p.intro(color.bgCyan(color.black(' Claude Code Flags ')));
  for (const flag of FLAG_REGISTRY) {
    const kindLabel = describeFlagKind(flag);
    const targetInfo = flag.target.type === 'env'
      ? `env ${flag.target.key}`
      : `setting ${flag.target.key}`;
    // D-EFFDV: number flags show the upstream default when present so the
    // registry dump is meaningful even for flags with no devflow defaultValue.
    const defaultLabel = flag.kind === 'number' && flag.upstreamDefault !== undefined
      ? `upstream default: ${flag.upstreamDefault}`
      : flag.defaultValue !== undefined && flag.defaultValue !== null
        ? String(flag.defaultValue)
        : 'none';
    const recLabel = flag.recommended ? color.green('recommended') : color.dim('optional');
    p.log.info(
      `${color.bold(flag.id.padEnd(28))} ${recLabel.padEnd(20)} ${color.dim(kindLabel.padEnd(36))} ${color.dim(targetInfo)}`,
    );
    p.log.info(
      `  ${color.dim(flag.hint)} — default: ${color.cyan(defaultLabel)}`,
    );
  }
  const signals = await readCodeModeSignals(claudeDir, null);
  if (signals.ok && signals.value.env !== undefined) {
    for (const line of codeModeBlockers(blockerState(signals.value))) p.log.warn(line);
  }
  p.outro(color.dim('Use --enable / --disable / --set / --unset to manage flags'));
}

async function statusCodeModeLines(claudeDir: string, devflowDir: string): Promise<string[]> {
  const signals = await readCodeModeSignals(claudeDir, devflowDir);
  return signals.ok ? [
    ...codeModeBlockers(blockerState(signals.value)),
    ...codeModeStatusNotes(signals.value),
  ] : [];
}

/** Handle --status: read-only status table, degrades gracefully without a manifest. */
async function handleStatus(claudeDir: string, devflowDir: string): Promise<void> {
  p.intro(color.bgCyan(color.black(' Claude Code Flags — Status ')));
  const manifest = await readManifest(devflowDir, { heal: false });
  if (!manifest) {
    p.log.warn('Devflow is not installed — run devflow init first');
    p.log.info('Showing registry defaults only:');
  }
  const record: FlagsRecord = manifest?.features.flags ?? {};
  for (const row of formatStatusRows(record)) {
    p.log.info(row);
  }
  for (const line of await statusCodeModeLines(claudeDir, devflowDir)) p.log.warn(line);
  p.outro(color.dim('Use --enable / --disable / --set / --unset to change flags'));
}

/**
 * Handle --enable/--disable: set boolean flags to the given value.
 *
 * Collapsed from two identical 50-line branches into one handler parameterized by
 * `value: boolean` — the only deltas were the record assignment (true vs false)
 * and one error-message string (--set vs --unset as the suggested alternative)
 * (CPLX-H2: one fix lands once, not twice).
 */
async function handleSetBooleans(
  claudeDir: string,
  devflowDir: string,
  ids: string[],
  value: boolean,
): Promise<void> {
  // Validate: must be known boolean flags only.
  // Collect the validated flag definitions so the success loop can use them
  // directly — avoids findFlag(id) re-lookups after the guard (TS-S1).
  const flagDefs: ClaudeCodeFlag[] = [];
  for (const id of ids) {
    const flag = findFlag(id);
    if (!flag) {
      p.log.error(`Unknown flag: ${color.bold(id)}`);
      p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    if (flag.kind !== 'boolean') {
      const alt = value ? `--set ${id}=value` : `--unset ${id}`;
      p.log.error(`${color.bold(id)} is a ${flag.kind} flag — use ${color.bold(alt)} to ${value ? 'set' : 'clear'} it`);
      process.exitCode = 1;
      return;
    }
    flagDefs.push(flag);
  }

  const check = await checkCodeModeWrite(claudeDir, devflowDir, value && ids.includes('code-mode'));
  if (!check.ok) return;

  // Manifest required for mutating ops (avoids settings/manifest desync)
  const ctx = await loadFlagContext(claudeDir, devflowDir);
  if (!ctx.ok) {
    p.log.error(ctx.reason);
    process.exitCode = 1;
    return;
  }

  // Compute new record before any write
  const newRecord: FlagsRecord = { ...ctx.value.manifest.features.flags };
  for (const flag of flagDefs) {
    newRecord[flag.id] = value;
  }

  const result = await persistFlagConfig(claudeDir, devflowDir, ctx.value.settingsContent, newRecord, ctx.value.manifest, check.value);

  if (result.ok) {
    for (const flag of flagDefs) {
      // D-EFFDV: formatFlagValue routes through effectiveDisplay — one vocabulary
      // shared with --status and TUI so the three surfaces cannot drift.
      logFlagSuccess(flag.id, `${flag.id} ${formatFlagValue(flag, value)}`);
    }
  }
}

/** Handle --set id=value (repeatable): validate all assignments then persist. */
async function handleSet(
  claudeDir: string,
  devflowDir: string,
  setValues: string[],
): Promise<void> {
  // Phase: parse and validate ALL assignments before any mutation.
  const assignments: Array<{ id: string; flag: ClaudeCodeFlag; value: FlagsRecordValue }> = [];
  let requestedOn = false;

  for (const assignment of setValues) {
    // Split on first = only — rest is the value (e.g. spellcheck=a=b → id='spellcheck', value='a=b')
    const eqIdx = assignment.indexOf('=');
    if (eqIdx === -1) {
      p.log.error(`Invalid --set format: ${color.bold(assignment)} — expected id=value`);
      process.exitCode = 1;
      return;
    }
    const id = assignment.slice(0, eqIdx);
    const text = assignment.slice(eqIdx + 1);

    // Prototype pollution guard
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') {
      p.log.error(`Unknown flag: ${color.bold(id)}`);
      process.exitCode = 1;
      return;
    }

    const flag = findFlag(id);
    if (!flag) {
      p.log.error(`Unknown flag: ${color.bold(id)}`);
      p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const value = parseFlagValueInput(flag, text);
    if (value === null && text !== 'unset') {
      // parseFlagValueInput returns null both for 'unset' and for invalid values.
      // If the input isn't literally 'unset', the null means invalid.
      p.log.error(`Invalid value for ${color.bold(id)}: ${color.bold(text)}`);
      p.log.info(`Expected: ${expectedInputFor(flag)}`);
      process.exitCode = 1;
      return;
    }

    assignments.push({ id, flag, value });
    // The last assignment wins in both preflight and the record.
    if (id === 'code-mode') requestedOn = value === true;
  }

  const check = await checkCodeModeWrite(claudeDir, devflowDir, requestedOn);
  if (!check.ok) return;

  // All assignments valid — load manifest + settings
  const ctx = await loadFlagContext(claudeDir, devflowDir);
  if (!ctx.ok) {
    p.log.error(ctx.reason);
    process.exitCode = 1;
    return;
  }

  // Compute final record before any write
  const newRecord: FlagsRecord = { ...ctx.value.manifest.features.flags };
  for (const { id, flag, value } of assignments) {
    // null from parseFlagValueInput for literal 'unset' → use neutral value
    newRecord[id] = value ?? neutralValueOf(flag);
  }

  // viewModeExplicit: true when the user explicitly assigned view-mode in --set.
  // This lets the chosen value override an externally-set /focus.
  const viewModeExplicit = assignments.some(a => a.id === 'view-mode');
  const result = await persistFlagConfig(
    claudeDir, devflowDir, ctx.value.settingsContent, newRecord, ctx.value.manifest,
    { ...check.value, viewModeExplicit },
  );

  if (result.ok) {
    for (const { id, flag, value } of assignments) {
      // null means the user typed 'unset' explicitly — echo their word back.
      // For active values, route through formatFlagValue (D-EFFDV vocabulary).
      const displayText = value === null ? 'unset' : formatFlagValue(flag, value);
      logFlagSuccess(id, `${id} = ${displayText}`);
    }
  }
}

/** Handle --unset ids: reset flags to their neutral values. */
async function handleUnset(
  claudeDir: string,
  devflowDir: string,
  ids: string[],
): Promise<void> {
  // Validate: must be known flags (any kind).
  // Collect the validated flag definitions so the mutation loop can use them
  // directly — avoids findFlag(id) re-lookups after the guard (TS-S1).
  const flagDefs: ClaudeCodeFlag[] = [];
  for (const id of ids) {
    const flag = findFlag(id);
    if (!flag) {
      p.log.error(`Unknown flag: ${color.bold(id)}`);
      p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    flagDefs.push(flag);
  }

  const ctx = await loadFlagContext(claudeDir, devflowDir);
  if (!ctx.ok) {
    p.log.error(ctx.reason);
    process.exitCode = 1;
    return;
  }

  // Compute new record before any write
  const newRecord: FlagsRecord = { ...ctx.value.manifest.features.flags };
  for (const flag of flagDefs) {
    newRecord[flag.id] = neutralValueOf(flag);
  }

  // viewModeExplicit: true when the user explicitly unset view-mode.
  const viewModeExplicit = ids.includes('view-mode');
  const check = await checkCodeModeWrite(claudeDir, devflowDir, false);
  if (!check.ok) return;
  const result = await persistFlagConfig(
    claudeDir, devflowDir, ctx.value.settingsContent, newRecord, ctx.value.manifest,
    { ...check.value, viewModeExplicit },
  );

  if (result.ok) {
    for (const id of ids) {
      logFlagSuccess(id, `${id} unset`);
    }
  }
}

/**
 * Apply a TUI result to disk — the save/persist seam extracted from handleBare.
 *
 * Enables seam testing of the TUI→persist wiring without a real TTY (closes
 * the interactive-surface coverage gap). The test drives
 * runFlagsTui with PassThrough streams, feeds its result here, and asserts
 * the whole post-state of both artifacts (manifest + settings.json).
 *
 * @param result       TUI result from runFlagsTui — action 'save', 'cancel', or 'abort'.
 * @param freshSettingsContent Settings.json content re-read AFTER the TUI closed
 *                     (see REL-M3 in handleBare — caller owns the re-read).
 * @param manifest     Loaded manifest threaded from loadFlagContext before TUI launch.
 * @param claudeDir    Path to ~/.claude directory (for settings.json write).
 * @param devflowDir   Path to ~/.devflow directory (for manifest write).
 * @returns 'saved' on success, 'unchanged' for cancel/abort, 'refused' on preflight failure,
 *          or the PersistResult error discriminant when persist fails. Errors are already logged.
 */
export async function applyTuiResult(
  result: FlagsTuiResult,
  freshSettingsContent: string,
  manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>>,
  claudeDir: string,
  devflowDir: string,
): Promise<'saved' | 'unchanged' | 'refused' | Extract<PersistResult, { ok: false }>> {
  if (result.action !== 'save') {
    return 'unchanged';
  }

  const existingRecord: FlagsRecord = manifest.features.flags;
  const newRecord = collectFlagRecord(result.rows);
  // viewModeExplicit: true if the user changed the view-mode row in the TUI
  const viewModeExplicit = newRecord['view-mode'] !== existingRecord['view-mode'];

  const codeModeRow = result.rows.find(row => row.id === 'code-mode');
  const codeModeEdited = codeModeRow !== undefined && codeModeRow.configuredValue !== codeModeRow.originalValue;
  if (!codeModeEdited) {
    // A save of other rows must respect a settings edit made while the editor was open.
    const seed = respectUserOwnedSettings(existingRecord, existingRecord, freshSettingsContent);
    newRecord['code-mode'] = seed['code-mode'] === true;
  }
  const check = await checkCodeModeWrite(claudeDir, devflowDir, codeModeEdited && codeModeRow.configuredValue === true);
  if (!check.ok) return 'refused';

  const persistResult = await persistFlagConfig(
    claudeDir, devflowDir, freshSettingsContent, newRecord, manifest,
    { ...check.value, viewModeExplicit },
  );
  if (persistResult.ok) {
    if (codeModeEdited) {
      logFlagSuccess(codeModeRow.id, `${codeModeRow.id} ${formatFlagValue(codeModeRow.def, codeModeRow.configuredValue)}`);
    }
    return 'saved';
  }
  return persistResult;
}

/**
 * Handle bare invocation (no subcommand flags).
 *
 * D-P5-1: TTY path launches the interactive flags TUI via lazy import;
 * non-TTY path prints a status table + note to stderr + exitCode 1.
 * CONS-M3: formatStatusRows() is the shared row formatter — non-TTY now uses
 * the longer "not adopted — default X applies on next devflow init" wording,
 * matching --status (convergence of the two divergent status surfaces).
 *
 * TS-H2 / ARCH-H2 / REL-H2: TTY path reuses loadFlagContext (the same guard
 * that mutating handlers use) before importing or launching the TUI. An absent or
 * unreadable manifest is a hard-refuse: the TUI must not launch, and settings.json
 * must not be touched. This prevents the silent-factory-reset path (TUI seeded
 * from {} writes settings.json; next devflow init re-adopts registry defaults and
 * silently reverts everything the user confirmed). The non-TTY path degrades
 * gracefully (status table only, no writes, no manifest required).
 */
async function handleBare(
  claudeDir: string,
  devflowDir: string,
): Promise<void> {
  // REL-H1: require both stdin AND stdout to be TTYs.
  // Gating on process.stdout.isTTY alone lets `devflow flags < /dev/null` enter
  // alt-screen while stdin ends immediately, leaving the terminal stranded with
  // hidden cursor on exit. Precedent: agents.ts uses the same two-flag predicate.
  if (process.stdin.isTTY && process.stdout.isTTY) {
    // ── Manifest + settings required before the TUI may launch ──────────
    // Reuses loadFlagContext — the same guard as --enable/--disable/--set/--unset.
    // If the manifest is absent or unreadable, we refuse here and settings.json
    // is never touched (avoids TS-H2 / ARCH-H2 / REL-H2 silent half-write).
    const ctx = await loadFlagContext(claudeDir, devflowDir);
    if (!ctx.ok) {
      p.log.error(ctx.reason);
      process.exitCode = 1;
      return;
    }
    const record: FlagsRecord = ctx.value.manifest.features.flags;

    // ── Build initial rows from registry + current record ──────────────
    // buildFlagRows is a static import (pure — no TTY); only runFlagsTui is lazy.
    // Use the same settings fold as init. It preserves user-owned values and
    // adopts an unclaimed exact payload before the editor builds its rows.
    const initialRows = buildFlagRows(
      respectUserOwnedSettings(record, record, ctx.value.settingsContent),
    );

    // ── Launch TUI ────────────────────────────────────────────────────
    const { runFlagsTui } = await import('../flags-view/index.js');
    // Wrap: runTui rejects on initial-render failure or handler throw.
    // On rejection: log and bail — no settings write; set process.exitCode
    // rather than calling process.exit(), which would skip pending cleanup.
    let result;
    try {
      result = await runFlagsTui(initialRows);
    } catch (err) {
      p.log.error(`Flags editor failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    if (result.action === 'save') {
      // REL-M3: re-read settings.json AFTER the human-paced TUI session closes.
      // The read captured before runFlagsTui is a stale snapshot by the time the
      // user saves — any concurrent writer (proxy enable, devflow agents, Claude
      // Code /config) that ran during the session would be silently overwritten by
      // the atomic rename in writeSettingsFileAtomic. Re-reading rebases the flag
      // write onto current content and ensures convergeFlagsIntoSettings sees the
      // fresh viewMode (file state, not config state, is reality).
      const freshSettings = await readSettingsSafe(path.join(claudeDir, 'settings.json'));
      if (!freshSettings.ok) {
        p.log.error(freshSettings.reason);
        process.exitCode = 1;
        return;
      }
      const outcome = await applyTuiResult(result, freshSettings.content, ctx.value.manifest, claudeDir, devflowDir);
      if (outcome === 'saved') {
        p.outro(color.green('Flags saved.'));
      }
      // A refusal or persist error is already logged with exitCode set.
    } else {
      p.outro(color.dim('No changes made.'));
    }
  } else {
    // non-TTY: status table — degrades gracefully without manifest (read-only).
    const manifest = await readManifest(devflowDir, { heal: false });
    const record: FlagsRecord = manifest?.features.flags ?? {};
    for (const row of formatStatusRows(record)) {
      process.stdout.write(`${row}\n`);
    }
    for (const line of await statusCodeModeLines(claudeDir, devflowDir)) process.stdout.write(`${line}\n`);
    process.stderr.write('Note: interactive TUI requires a TTY. Use --enable/--disable/--set/--unset for mutations.\n');
    process.exitCode = 1;
  }
}

// ─── Command factory ──────────────────────────────────────────────────────────

/** Accumulator for repeatable --set options. */
function collectSet(val: string, prev: string[]): string[] {
  return prev.concat(val);
}

/**
 * Create a fresh flags Command instance.
 *
 * Call this in tests to get a clean Commander instance per test case — avoids
 * Commander's internal option-value state leaking across tests.
 *
 * Bare invocation (no subcommand):
 *   - TTY: launches the interactive flags TUI (lazy import keeps TTY machinery
 *     out of --list/--status code paths).
 *   - non-TTY: prints status table to stdout + note to stderr + exitCode 1.
 */
export function createFlagsCommand(): Command {
  return new Command('flags')
    .description('Manage Claude Code feature flags')
    .option('--list', 'List all available flags with metadata')
    .option('--status', 'Show current flag states')
    .option('--enable <ids>', 'Enable boolean flag(s), comma-separated')
    .option('--disable <ids>', 'Disable boolean flag(s), comma-separated')
    .option(
      '--set <assignment>',
      'Set flag value (repeatable): id=value. Use "unset" as value to clear.',
      collectSet,
      [] as string[],
    )
    .option('--unset <ids>', 'Reset flag(s) to neutral (comma-separated)')
    .action(async (options: {
      list?: boolean;
      status?: boolean;
      enable?: string;
      disable?: string;
      set?: string[];
      unset?: string;
    }) => {
      const claudeDir = getClaudeDirectory();
      const devflowDir = getDevFlowDirectory();
      const splitIds = (s: string): string[] => s.split(',').map(t => t.trim()).filter(Boolean);

      if (options.list) return handleList(claudeDir);
      if (options.status) return handleStatus(claudeDir, devflowDir);
      if (options.enable !== undefined) return handleSetBooleans(claudeDir, devflowDir, splitIds(options.enable), true);
      if (options.disable !== undefined) return handleSetBooleans(claudeDir, devflowDir, splitIds(options.disable), false);
      if (options.set && options.set.length > 0) return handleSet(claudeDir, devflowDir, options.set);
      if (options.unset !== undefined) return handleUnset(claudeDir, devflowDir, splitIds(options.unset));
      return handleBare(claudeDir, devflowDir);
    });
}

// ─── Singleton export ─────────────────────────────────────────────────────────
//
// src/cli.ts imports this; end-to-end tests should use createFlagsCommand()
// instead to get a fresh instance per test.
export const flagsCommand = createFlagsCommand();
