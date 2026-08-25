/**
 * devflow flags — Manage Claude Code feature flags.
 *
 * D-P3-1: Typed flags CLI rewrite (Phase 3).
 *   - createFlagsCommand() factory — fresh Commander instance per call;
 *     used by tests; src/cli.ts consumes the flagsCommand singleton export.
 *   - Persist pipeline: convergeFlagsIntoSettings (fold-before-strip) — the
 *     single pipeline entry point shared with init.ts (ARCH-H1, PF-015/017).
 *   - PF-014 (process.exit swallows async work): all error paths set
 *     process.exitCode = 1 and return; never call process.exit().
 *   - PF-015 (multi-artifact fan-out): compute record first; settings write
 *     and manifest write handled independently with their own error paths.
 *   - PF-022 (applies-on-restart): bare non-TTY invocation prints status table
 *     with a note that changes apply on restart.
 *   - PF-023 (validate at the sink): parseFlagValueInput → coerceFlagValue
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
  neutralValueOf,
  type ClaudeCodeFlag,
  type FlagsRecord,
  type FlagsRecordValue,
} from '../../core/flags.js';
import { readManifest, writeManifest } from '../../core/manifest.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { sanitizeCell } from '../tui/cells.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Look up a flag by id; null when unknown. Backed by O(1) findFlag. */
function lookupFlag(id: string): ClaudeCodeFlag | null {
  return findFlag(id) ?? null;
}

/**
 * Read and parse settings.json.
 * ENOENT → returns `{ content: '{}', ok: true }`.
 * Malformed JSON → returns `{ ok: false, reason: string }`.
 *
 * NEVER silently falls back to '{}' on malformed JSON — that would clobber the
 * user's settings. The caller must abort with exit code 1 on !ok (avoids PF-023).
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

  try {
    JSON.parse(raw); // validate only
  } catch {
    return { ok: false, reason: 'settings.json is malformed — fix it before changing flags' };
  }
  return { ok: true, content: raw };
}

/**
 * Discriminated result for persistFlagConfig.
 *
 * Makes the absent-manifest state unrepresentable as success (TS-H2 / ARCH-H2 /
 * REL-H2 / PF-015). Three distinct outcomes:
 *   - ok:true          — both settings.json and manifest.json were written.
 *   - ok:false + failed — one or both artifact writes failed; messages + exitCode
 *                         already set inside the function (per-artifact independence).
 *   - ok:false + reason:'no-manifest' — no manifest present; flag state not
 *                         recorded. An absent manifest is a failure, not a no-op.
 *
 * Callers print success ("Flags saved.", "X enabled", …) ONLY when ok === true.
 */
type PersistResult =
  | { ok: true }
  | { ok: false; failed: ReadonlyArray<'settings' | 'manifest'> }
  | { ok: false; reason: 'no-manifest' };

/**
 * Persist a FlagsRecord to settings.json and manifest.
 *
 * Uses `convergeFlagsIntoSettings` (ARCH-H1: fold-before-strip pipeline) so the
 * invariant lives in the pipeline, not at call sites. This ensures that:
 *   - An externally-set /focus survives unless viewModeExplicit is true (PF-015).
 *   - Valued flags not yet claimed by devflow (absent from the manifest record)
 *     have their existing settings values preserved rather than stripped (REG-H1,
 *     SEC-M3, ADR-014).
 *
 * PF-015: settings write and manifest write are evaluated independently.
 * Each failure is reported with its own message and exit code 1.
 * The second write is never skipped due to the first succeeding or failing.
 *
 * Returns a discriminated PersistResult (never a boolean — avoids the two-state
 * lie that cannot express the third "manifest absent" outcome). Success is tracked
 * in LOCALS, never read back off `process.exitCode` (avoids PF-014, PF-015).
 */
async function persistFlagConfig(
  claudeDir: string,
  devflowDir: string,
  settingsContent: string,
  newRecord: FlagsRecord,
  opts: { viewModeExplicit: boolean } = { viewModeExplicit: false },
): Promise<PersistResult> {
  // D15: convergeFlagsIntoSettings is the fold-before-strip pipeline entry point
  // (applies PF-015, PF-017, REG-H1, ARCH-H1). ownedRecord is omitted so the
  // `newRecord` (the manifest record) serves as the owned set — a key present in
  // the manifest means devflow previously claimed it; absent = never written by
  // devflow, so the existing settings value is adopted.
  const { settings: updatedSettings, record: foldedRecord } = convergeFlagsIntoSettings(
    settingsContent,
    newRecord,
    opts,
  );

  // PF-015: accumulate each artifact's failure independently; combine at the end.
  const failed: Array<'settings' | 'manifest'> = [];

  // Settings write — independent error path (avoids PF-015 fan-out).
  const settingsPath = path.join(claudeDir, 'settings.json');
  try {
    await writeFileAtomicExclusive(settingsPath, updatedSettings);
  } catch (err) {
    p.log.error(`Failed to write settings.json: ${err instanceof Error ? err.message : String(err)}`);
    failed.push('settings');
    process.exitCode = 1;
    // PF-015: still attempt the manifest write — evaluate each artifact independently.
  }

  // Manifest write — independent error path (avoids PF-015 fan-out).
  // Uses foldedRecord (not newRecord) so adopted values are persisted to the
  // manifest, keeping manifest ↔ settings.json in sync.
  //
  // An absent manifest is a FAILURE, not a no-op (TS-H2 / ARCH-H2 / REL-H2):
  // returning success here would tell the user "Flags saved." while the manifest
  // was never updated — reverted on the next `devflow init`.
  const manifest = await readManifest(devflowDir);
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

  // PF-015: OR the locals afterwards — never compose required side effects with ||/&&.
  return failed.length > 0 ? { ok: false, failed } : { ok: true };
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
 * reports the reason and sets process.exitCode = 1 on failure (avoids PF-014).
 * One shared load path means a fix lands once, not four times (applies PF-017 —
 * the four copies of the same preamble are exactly the "fix on one site, miss the
 * other three" shape).
 */
async function loadFlagContext(
  claudeDir: string,
  devflowDir: string,
): Promise<{ ok: true; value: FlagContext } | { ok: false; reason: string }> {
  const manifest = await readManifest(devflowDir);
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
    const rawDisplay = value !== undefined
      ? formatFlagValue(flag, value)
      : `not adopted — default ${String(flag.defaultValue ?? 'unset')} applies on next devflow init`;
    const displayValue = sanitizeCell(rawDisplay);
    return `${flag.id.padEnd(28)} ${displayValue}`;
  });
}

// ─── Branch handlers ──────────────────────────────────────────────────────────
//
// One named async handler per CLI branch — each is independently readable and
// carries one responsibility. The dispatcher (createFlagsCommand action) is ~15
// lines and routes without logic of its own (ARCH-M1, CPLX-H1).

/** Handle --list: read-only registry dump, no manifest required. */
async function handleList(): Promise<void> {
  p.intro(color.bgCyan(color.black(' Claude Code Flags ')));
  for (const flag of FLAG_REGISTRY) {
    const kindLabel = flag.kind === 'boolean'
      ? 'boolean'
      : flag.kind === 'enum'
        ? `enum [${(flag as import('../../core/flags.js').EnumFlagDef).values.join('|')}]`
        : flag.kind === 'number'
          ? (() => {
              const nf = flag as import('../../core/flags.js').NumberFlagDef;
              const parts: string[] = [];
              if (nf.min !== undefined) parts.push(`min=${nf.min}`);
              if (nf.max !== undefined) parts.push(`max=${nf.max}`);
              if (nf.integer) parts.push('integer');
              return `number${parts.length ? ' ' + parts.join(' ') : ''}`;
            })()
          : (() => {
              const sf = flag as import('../../core/flags.js').StringFlagDef;
              return `string${sf.maxLength !== undefined ? ` maxLen=${sf.maxLength}` : ''}`;
            })();
    const targetInfo = flag.target.type === 'env'
      ? `env ${flag.target.key}`
      : `setting ${flag.target.key}`;
    const defaultLabel = flag.defaultValue !== undefined && flag.defaultValue !== null
      ? String(flag.defaultValue)
      : 'unset';
    const recLabel = flag.recommended ? color.green('recommended') : color.dim('optional');
    p.log.info(
      `${color.bold(flag.id.padEnd(28))} ${recLabel.padEnd(20)} ${color.dim(kindLabel.padEnd(36))} ${color.dim(targetInfo)}`,
    );
    p.log.info(
      `  ${color.dim(flag.hint)} — default: ${color.cyan(defaultLabel)}`,
    );
  }
}

/** Handle --status: read-only status table, degrades gracefully without a manifest. */
async function handleStatus(devflowDir: string): Promise<void> {
  p.intro(color.bgCyan(color.black(' Claude Code Flags — Status ')));
  const manifest = await readManifest(devflowDir);
  if (!manifest) {
    p.log.warn('Devflow is not installed — run devflow init first');
    p.log.info('Showing registry defaults only:');
  }
  const record: FlagsRecord = manifest?.features.flags ?? {};
  for (const row of formatStatusRows(record)) {
    p.log.info(row);
  }
}

/**
 * Handle --enable/--disable: set boolean flags to the given value.
 *
 * Collapsed from two identical 50-line branches into one handler parameterized by
 * `value: boolean` — the only deltas were the record assignment (true vs false)
 * and one error-message string (--set vs --unset as the suggested alternative)
 * (CPLX-H2 — applies PF-017: one fix lands once, not twice).
 */
async function handleSetBooleans(
  claudeDir: string,
  devflowDir: string,
  ids: string[],
  value: boolean,
): Promise<void> {
  // Validate: must be known boolean flags only
  for (const id of ids) {
    const flag = lookupFlag(id);
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
  }

  // Manifest required for mutating ops (avoids settings/manifest desync)
  const ctx = await loadFlagContext(claudeDir, devflowDir);
  if (!ctx.ok) {
    p.log.error(ctx.reason);
    process.exitCode = 1;
    return;
  }

  // PF-015: compute new record before any write
  const newRecord: FlagsRecord = { ...ctx.value.manifest.features.flags };
  for (const id of ids) {
    newRecord[id] = value;
  }

  const result = await persistFlagConfig(claudeDir, devflowDir, ctx.value.settingsContent, newRecord);

  if (result.ok) {
    for (const id of ids) {
      if (value) {
        p.log.success(`${id} enabled`);
      } else {
        // Route through formatFlagValue (applies ADR-016 — one vocabulary,
        // shared with --status and TUI so the three surfaces cannot drift).
        const flag = lookupFlag(id)!;
        p.log.success(`${id} ${formatFlagValue(flag, false)}`);
      }
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

    // Prototype pollution guard (applies PF-023)
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') {
      p.log.error(`Unknown flag: ${color.bold(id)}`);
      process.exitCode = 1;
      return;
    }

    const flag = lookupFlag(id);
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
      p.log.info(`Expected: ${flag.kind === 'boolean' ? 'true|false|unset' : flag.kind === 'enum' ? ((flag as import('../../core/flags.js').EnumFlagDef).values.join('|') + '|unset') : `a valid ${flag.kind} value or unset`}`);
      process.exitCode = 1;
      return;
    }

    assignments.push({ id, flag, value });
  }

  // All assignments valid — load manifest + settings
  const ctx = await loadFlagContext(claudeDir, devflowDir);
  if (!ctx.ok) {
    p.log.error(ctx.reason);
    process.exitCode = 1;
    return;
  }

  // PF-015: compute final record before any write
  const newRecord: FlagsRecord = { ...ctx.value.manifest.features.flags };
  for (const { id, flag, value } of assignments) {
    // null from parseFlagValueInput for literal 'unset' → use neutral value
    newRecord[id] = value ?? neutralValueOf(flag);
  }

  // viewModeExplicit: true when the user explicitly assigned view-mode in --set.
  // This lets the chosen value override an externally-set /focus.
  const viewModeExplicit = assignments.some(a => a.id === 'view-mode');
  const result = await persistFlagConfig(
    claudeDir, devflowDir, ctx.value.settingsContent, newRecord,
    { viewModeExplicit },
  );

  if (result.ok) {
    for (const { id, flag, value } of assignments) {
      p.log.success(`${id} = ${formatFlagValue(flag, value)}`);
    }
  }
}

/** Handle --unset ids: reset flags to their neutral values. */
async function handleUnset(
  claudeDir: string,
  devflowDir: string,
  ids: string[],
): Promise<void> {
  // Validate: must be known flags (any kind)
  for (const id of ids) {
    const flag = lookupFlag(id);
    if (!flag) {
      p.log.error(`Unknown flag: ${color.bold(id)}`);
      p.log.info(`Available: ${FLAG_REGISTRY.map(f => f.id).join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }

  const ctx = await loadFlagContext(claudeDir, devflowDir);
  if (!ctx.ok) {
    p.log.error(ctx.reason);
    process.exitCode = 1;
    return;
  }

  // PF-015: compute new record before any write
  const newRecord: FlagsRecord = { ...ctx.value.manifest.features.flags };
  for (const id of ids) {
    const flag = lookupFlag(id)!;
    newRecord[id] = neutralValueOf(flag);
  }

  // viewModeExplicit: true when the user explicitly unset view-mode.
  const viewModeExplicit = ids.includes('view-mode');
  const result = await persistFlagConfig(
    claudeDir, devflowDir, ctx.value.settingsContent, newRecord,
    { viewModeExplicit },
  );

  if (result.ok) {
    for (const id of ids) {
      p.log.success(`${id} unset`);
    }
  }
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
  if (process.stdout.isTTY) {
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
    const { runFlagsTui, buildFlagRows, collectFlagRecord } =
      await import('../flags-view/index.js');
    const initialRows = buildFlagRows(FLAG_REGISTRY, record);

    // ── Launch TUI ────────────────────────────────────────────────────
    const result = await runFlagsTui(initialRows);

    if (result.action === 'save') {
      const newRecord = collectFlagRecord(result.rows);
      // viewModeExplicit: true if the user changed the view-mode row in the TUI
      const viewModeExplicit = newRecord['view-mode'] !== record['view-mode'];
      const persistResult = await persistFlagConfig(
        claudeDir, devflowDir, ctx.value.settingsContent, newRecord, { viewModeExplicit },
      );
      if (persistResult.ok) {
        process.stdout.write('Flags saved.\n');
      }
    } else {
      process.stdout.write('No changes made.\n');
    }
  } else {
    // non-TTY: status table — degrades gracefully without manifest (read-only).
    const manifest = await readManifest(devflowDir);
    const record: FlagsRecord = manifest?.features.flags ?? {};
    for (const row of formatStatusRows(record)) {
      process.stdout.write(`${row}\n`);
    }
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

      if (options.list) return handleList();
      if (options.status) return handleStatus(devflowDir);
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
