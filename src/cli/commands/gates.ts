/**
 * devflow gates — Show or set the machine's default gate level.
 *
 * The gate level is one of `full`, `standard` or `lean`. `--set` writes the MACHINE
 * default, `features.gateLevel` in `~/.devflow/manifest.json`, and nothing else: not
 * the repository's `project.json`, not the personal `.devflow/config.json` (no
 * command writes that key), and no sentinel, re-arm or install step. `--status` shows
 * the level that applies in the current directory, which layer decided it and what
 * the machine records; it writes nothing.
 *
 * Three parts, so no business logic throws or prints:
 *   gatherGateStatus   resolves the settings ONCE and reads the manifest raw, and
 *                      returns a {@link GateStatus} that is a discriminated union
 *   renderGateStatus   pure: one {@link GateStatus} to lines and warnings
 *   gatesCommand       the thin shell: parse, call, print, set the exit code
 *
 * No code here chooses a level from a task or a diff: the level comes from the
 * resolver (personal key, machine key, default) or from the word typed after `--set`.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

import {
  DEFAULT_GATE_LEVEL,
  GATE_LEVELS,
  MALFORMED_GATE_LEVEL_READS_AS,
  machineGateLevel,
  parseGateLevel,
  readGateManifest,
  writeMachineGateLevel,
  type GateLevel,
  type GateManifestRead,
  type GateWriteResult,
} from '../../core/gate-level.js';
import { describeEchoedValue } from '../../core/echo-value.js';
import {
  loadSettingsModule,
  settingsSourceFile,
  trackedConfigWarning,
  type RepoSettings,
  type SettingsGateLevelSource,
  type SettingsLoad,
  type SettingsModule,
} from '../../core/evidence-policy.js';
import { getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';

// ── Wording ────────────────────────────────────────────────────────────────────

/**
 * What each level means, in one line. Each line says what the word stands for and
 * not what a command does with it. The line for MALFORMED_GATE_LEVEL_READS_AS says
 * that a value that is not a level reads as it.
 */
export const GATE_LEVEL_MEANINGS: Readonly<Record<GateLevel, string>> = Object.freeze({
  full: 'the most checking; any value that is not a level also reads as full',
  standard: 'the default when no level is set',
  lean: 'the least checking',
});

/**
 * Which commands read the level today; each later command that reads it updates this text.
 *
 * The init prompt gives each level one short line in GATE_LEVEL_HINTS (gate-level-prompts.ts);
 * this text and the docs hold the full effects. Change the hints too when a level changes
 * how much it checks. A command that reads the level and has no rule that changes a phase
 * leaves the hints true, so it changes this text alone.
 * One test pins the exact text of both tables, so a change to either fails it until you
 * check the other table and update the pin; further rows check the clauses the two tables
 * share (the lint pack level, the levels that run fewer review focuses and the levels that
 * skip Polish). The clauses that lean skips Harden on a docs-only diff, that standard
 * and lean run one Evaluate pass and that standard and lean apply severity tiers in /resolve
 * have no facet row in `tests/gate-level-prompts.test.ts`: the docs guard checks each at
 * every doc site, against its row in the /implement or /resolve level reference.
 */
export const GATE_LEVEL_EFFECT =
  '/code-review and /plan read the level: standard and lean run fewer review focuses and fewer planning agents. At lean, /implement has Validate run the project\'s lint pack. /implement and /resolve also read the level and name it in their report; at standard and lean they skip Polish, and full keeps it. At lean, /implement skips Harden on a docs-only diff. At standard and lean, /implement runs one Evaluate pass and at most one Fix round. At standard and lean, /resolve applies severity tiers: it fixes or escalates every security finding, fixes CRITICAL, HIGH and severe MEDIUM findings in the branch\'s own code, fixes prose-only MEDIUM findings with text edits alone, and sends lower findings and pre-existing non-security findings to one backlog issue.';

const MACHINE_MANIFEST_NAME = 'manifest.json';
const MACHINE_INVALID_LINE = `invalid (${MACHINE_MANIFEST_NAME}; reads as ${MALFORMED_GATE_LEVEL_READS_AS})`;
const VALID_LEVELS = GATE_LEVELS.join(', ');
const VALID_LEVELS_OR = `${GATE_LEVELS.slice(0, -1).join(', ')}, or ${GATE_LEVELS[GATE_LEVELS.length - 1]}`;

// ── Status: gather ─────────────────────────────────────────────────────────────

/**
 * What `~/.devflow/manifest.json` is, for a warning:
 *   absent       no file (no warning: a machine without devflow is not a fault)
 *   readable     an object the manifest reader accepts
 *   rejected     valid JSON with a `features` object that the manifest reader
 *                rejects (a required field is missing or mistyped, or a byte-order
 *                mark leads); `devflow init` replaces the file and keeps the gate
 *                level stored in it, unless the run sets another level or resets
 *   unreadable   corrupt or over the size bound: `devflow gates` cannot read it.
 *                `devflow init` replaces the file and keeps its level only if init
 *                can read it; the manifest reader has no size bound, so a valid
 *                file over the bound is one init can read
 */
export type GateManifestState = 'absent' | 'readable' | 'rejected' | 'unreadable';

interface GateStatusBase {
  readonly manifest: GateManifestState;
  readonly manifestPath: string;
}

/** The machine's own reading: a level, `invalid` for a present malformed value, or null for none recorded. */
type MachineValue = GateLevel | 'invalid' | null;

/**
 * One status outcome. `kind` says which fields exist, so a renderer cannot print a
 * source for a result that has none.
 *
 *   resolved     the resolver decided: the level, the layer that decided it, whether
 *                that layer holds a malformed value, and the machine's own reading
 *   fail-closed  the resolver failed closed: `full`, with a reason or none, and
 *                no deciding layer; the machine value is the resolver's when it
 *                named an unreadable file, else the TypeScript reader's
 *   unloadable   the resolver could not be loaded, so the level that applies is
 *                unknown; the machine value is the TypeScript reader's
 */
export type GateStatus =
  | (GateStatusBase & {
      readonly kind: 'resolved';
      readonly level: GateLevel;
      readonly source: SettingsGateLevelSource;
      readonly invalid: boolean;
      readonly machine: MachineValue;
      readonly trackedWarning: string | null;
    })
  | (GateStatusBase & {
      readonly kind: 'fail-closed';
      readonly reason: string | null;
      readonly machine: MachineValue;
      readonly trackedWarning: string | null;
    })
  | (GateStatusBase & {
      readonly kind: 'unloadable';
      readonly machine: MachineValue;
    });

/** What {@link gatherGateStatus} needs, injected so a test stubs the resolver and the manifest read. */
export interface GateStatusDeps {
  readonly devflowDir: string;
  /** The directory whose repository the settings resolve for. */
  readonly dir: string;
  readonly loadSettings: () => SettingsLoad;
  readonly readManifest: (devflowDir: string) => Promise<GateManifestRead>;
}

/** The resolved settings, or null when the resolver is unusable or throws despite its contract. */
function resolveOnce(module: SettingsModule, dir: string): RepoSettings | null {
  try {
    return module.resolveSettings({ dir });
  } catch {
    return null;
  }
}

function manifestState(read: GateManifestRead): GateManifestState {
  switch (read.kind) {
    case 'absent': return 'absent';
    case 'object': return 'readable';
    case 'rejected': return 'rejected';
    case 'corrupt': return 'unreadable';
    default: {
      const exhaustive: never = read;
      return exhaustive;
    }
  }
}

/** Why a fail-closed result failed, or null when the resolver names no reason. */
function failClosedReason(settings: RepoSettings): string | null {
  return settings.unreadable === null ? null : `${settingsSourceFile(settings.unreadable)} is unreadable`;
}

/**
 * Gather one {@link GateStatus}. Never throws, never writes.
 *
 * The settings resolve ONCE, and that one result feeds the level, the machine value
 * and the tracked-config warning. The manifest is read with the gate reader, never
 * with `readManifest()`, which heal-writes and returns null for a manifest it
 * rejects: a read-only status must do neither. The manifest is read twice, once by
 * the gate reader here and once by the resolver; a write between the two reads can
 * mix two versions, which is acceptable because the result is display only and no
 * action follows it.
 */
export async function gatherGateStatus(deps: GateStatusDeps): Promise<GateStatus> {
  const manifestPath = path.join(deps.devflowDir, MACHINE_MANIFEST_NAME);
  const read = await deps.readManifest(deps.devflowDir);
  const base: GateStatusBase = { manifest: manifestState(read), manifestPath };

  // The TypeScript reader's machine value, for a result that carries none of its own.
  const stored = read.kind === 'object' || read.kind === 'rejected' ? machineGateLevel(read.raw) : null;
  const loaded = deps.loadSettings();
  const settings = loaded.ok ? resolveOnce(loaded.value, deps.dir) : null;
  if (settings === null) {
    return { ...base, kind: 'unloadable', machine: stored };
  }

  const trackedWarning = trackedConfigWarning(settings);
  if (!settings.ok || settings.gateLevelSource === null) {
    // Only a result that names an unreadable file carries the manifest's value; a
    // fail-closed result without one (git did not answer) never read the manifest.
    const machine = settings.unreadable !== null ? settings.gateLevelMachine : stored;
    return { ...base, kind: 'fail-closed', reason: failClosedReason(settings), machine, trackedWarning };
  }
  return {
    ...base,
    kind: 'resolved',
    level: settings.gateLevel,
    source: settings.gateLevelSource,
    invalid: settings.gateLevelInvalid,
    machine: settings.gateLevelMachine,
    trackedWarning,
  };
}

// ── Status: render ─────────────────────────────────────────────────────────────

export interface GateStatusRender {
  /** The facts, one per line. */
  readonly lines: readonly string[];
  /** Things the user should act on, each its own message. */
  readonly warnings: readonly string[];
}

/** The machine line: `none` when the manifest records no level or cannot be read (its own warning says which). */
function machineLine(machine: MachineValue): string {
  if (machine === 'invalid') return `Machine:   ${MACHINE_INVALID_LINE}`;
  if (machine === null) return 'Machine:   none';
  return `Machine:   ${machine}`;
}

function manifestWarning(status: GateStatus): string | null {
  switch (status.manifest) {
    case 'absent':
    case 'readable':
      return null;
    case 'rejected':
      return `Manifest at ${status.manifestPath} is a manifest that devflow rejects; devflow init will replace this file and keep a gate level stored in it unless you choose another level or use --reset.`;
    case 'unreadable':
      return `Manifest at ${status.manifestPath} cannot be read by devflow gates; devflow init will replace this file. Init keeps a gate level stored in it only if init can read the file. If init reports that it could not read the level, set it again with devflow gates --set <level>.`;
    default: {
      const exhaustive: never = status.manifest;
      return exhaustive;
    }
  }
}

/**
 * Render a {@link GateStatus}. Pure and total over every `kind`.
 *
 * A malformed level is reported by the layer that holds it and its state, never by
 * its value: a raw config value never reaches a terminal.
 */
export function renderGateStatus(status: GateStatus): GateStatusRender {
  const warnings: string[] = [];
  const lines: string[] = [];
  switch (status.kind) {
    case 'resolved': {
      lines.push(`Effective: ${status.level} (${status.source}${status.invalid ? ', invalid' : ''})`);
      lines.push(machineLine(status.machine));
      if (status.invalid && status.source === 'personal') {
        warnings.push(
          `gateLevel in ${settingsSourceFile('personal')} is not one of ${VALID_LEVELS}, so ${status.level} is in effect. ` +
          'The value is not shown.',
        );
      }
      if (status.trackedWarning !== null) warnings.push(status.trackedWarning);
      break;
    }
    case 'fail-closed': {
      lines.push(`Effective: full (fail-closed: ${status.reason ?? 'reason unknown'})`);
      lines.push(machineLine(status.machine));
      if (status.trackedWarning !== null) warnings.push(status.trackedWarning);
      break;
    }
    case 'unloadable': {
      lines.push('Effective: level unknown');
      lines.push(machineLine(status.machine));
      warnings.push('The settings resolver could not be loaded, so the level that applies is unknown.');
      break;
    }
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
  const fromManifest = manifestWarning(status);
  if (fromManifest !== null) warnings.push(fromManifest);
  return { lines, warnings };
}

// ── Set ────────────────────────────────────────────────────────────────────────

/** What a `--set` run says and how it exits. */
export interface GateSetOutcome {
  readonly kind: 'success' | 'info' | 'error';
  readonly message: string;
  readonly exitCode: 0 | 1;
}

/**
 * Map the writer's result to a message and an exit code. Pure and total. Every
 * refusal exits 1 and says nothing was written, except a failed write, which names
 * the path and the error code.
 */
export function describeGateWrite(result: GateWriteResult, level: GateLevel, manifestPath: string): GateSetOutcome {
  switch (result.kind) {
    case 'written':
      return { kind: 'success', message: `Gate level: ${level}`, exitCode: 0 };
    case 'unchanged':
      return { kind: 'info', message: `Gate level: ${level} (unchanged)`, exitCode: 0 };
    case 'not-installed':
      return { kind: 'error', message: `No manifest found at ${manifestPath}. Run devflow init first.`, exitCode: 1 };
    case 'unreadable':
      return {
        kind: 'error',
        message: `Manifest at ${result.path} exists but cannot be read; nothing changed. Move it aside, then run devflow init.`,
        exitCode: 1,
      };
    case 'write-failed':
      return {
        kind: 'error',
        message: `Could not write the manifest at ${result.path} (${result.reason}); nothing changed.`,
        exitCode: 1,
      };
    case 'invalid-level':
      return {
        kind: 'error',
        message: `Unknown gate level: "${describeEchoedValue(level)}"; nothing changed. Valid levels: ${VALID_LEVELS}`,
        exitCode: 1,
      };
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

/**
 * Write the machine default and describe the result. Never throws. `now` is injected
 * so a test fixes the `updatedAt` stamp.
 */
export async function runGatesSet(
  devflowDir: string,
  level: GateLevel,
  now: () => string = () => new Date().toISOString(),
): Promise<GateSetOutcome> {
  const result = await writeMachineGateLevel(devflowDir, level, now);
  return describeGateWrite(result, level, path.join(devflowDir, MACHINE_MANIFEST_NAME));
}

// ── Command ────────────────────────────────────────────────────────────────────

interface GatesOptions {
  status?: boolean;
  set?: string;
}

function printOutcome(outcome: GateSetOutcome): void {
  switch (outcome.kind) {
    case 'success': p.log.success(outcome.message); break;
    case 'info': p.log.info(outcome.message); break;
    case 'error': p.log.error(outcome.message); break;
    default: {
      const exhaustive: never = outcome.kind;
      return exhaustive;
    }
  }
}

function levelsHelp(): string {
  const width = Math.max(...GATE_LEVELS.map(level => level.length));
  return GATE_LEVELS.map(level => `  ${level.padEnd(width)}  ${GATE_LEVEL_MEANINGS[level]}`).join('\n');
}

export const gatesCommand = new Command('gates')
  .description('Show or set the machine\'s default gate level')
  .option('--status', 'Show the gate level in effect here, which layer decided it, and the machine default')
  .option(`--set <${GATE_LEVELS.join('|')}>`, `Set the machine's default gate level: ${VALID_LEVELS_OR}`)
  .addHelpText(
    'after',
    `\nGate levels:\n${levelsHelp()}\n\n` +
    `The default is ${DEFAULT_GATE_LEVEL}. --set writes only the machine default. A personal .devflow/config.json ` +
    '"gateLevel" overrides it in one repository; no command writes that key.\n' +
    GATE_LEVEL_EFFECT,
  )
  .action(async (options: GatesOptions) => {
    const devflowDir = getDevFlowDirectory();

    if (!options.status && options.set === undefined) {
      p.intro(color.bgCyan(color.white(' Gates ')));
      p.note(
        `${color.cyan('devflow gates --status')}       Show the gate level in effect here and the machine default\n` +
        `${color.cyan('devflow gates --set <level>')}  Set the machine default\n\n` +
        `Valid levels:\n${levelsHelp()}`,
        'Usage',
      );
      p.outro(color.dim(GATE_LEVEL_EFFECT));
      return;
    }

    // Validate --set before any I/O, even beside --status: a bad word is rejected,
    // never repaired, and exits 1 as it does in `devflow tracker` and `devflow compliance`.
    const parsed = options.set === undefined ? undefined : parseGateLevel(options.set);
    if (parsed !== undefined && !parsed.ok) {
      p.log.error(parsed.error);
      process.exitCode = 1;
      return;
    }

    // --status wins over a valid --set and writes nothing, mirroring `devflow tracker`.
    // With neither flag the usage printed above, so no --set here means --status alone.
    if (options.status || parsed === undefined) {
      const status = await gatherGateStatus({
        devflowDir,
        dir: process.cwd(),
        loadSettings: loadSettingsModule,
        readManifest: readGateManifest,
      });
      const rendered = renderGateStatus(status);
      p.note(rendered.lines.join('\n'), 'Gate Level Status');
      for (const warning of rendered.warnings) p.log.warn(warning);
      return;
    }

    const outcome = await runGatesSet(devflowDir, parsed.value);
    printOutcome(outcome);
    process.exitCode = outcome.exitCode;
  });
