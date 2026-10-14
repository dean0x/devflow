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
  machineGateLevel,
  parseGateLevel,
  readGateManifest,
  writeMachineGateLevel,
  type GateLevel,
  type GateManifestRead,
  type GateWriteResult,
} from '../../core/gate-level.js';
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
 * What each level means, in one line. No command reads the level yet, so each line
 * says what the word stands for and not what a command does with it.
 */
export const GATE_LEVEL_MEANINGS: Readonly<Record<GateLevel, string>> = Object.freeze({
  full: 'the most checking; any value that is not a level also reads as full',
  standard: 'the default when no level is set',
  lean: 'the least checking',
});

/** Why the level changes no behavior yet; the issues that read it remove this text. */
export const GATE_LEVEL_NO_EFFECT =
  'No command reads the level yet, so it has no effect until issues #473, #474 and #480 read it.';

const MACHINE_MANIFEST_NAME = 'manifest.json';
const MACHINE_INVALID_LINE = `invalid (${MACHINE_MANIFEST_NAME}; reads as full)`;
const VALID_LEVELS = GATE_LEVELS.join(', ');

// ── Status: gather ─────────────────────────────────────────────────────────────

/**
 * What `~/.devflow/manifest.json` is, for a warning:
 *   absent       no file (no warning: a machine without devflow is not a fault)
 *   readable     an object the manifest reader accepts
 *   unreadable   corrupt, over the size bound, or valid JSON the manifest reader
 *                rejects; `devflow init` will replace the file
 */
export type GateManifestState = 'absent' | 'readable' | 'unreadable';

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
 *                no deciding layer; a null machine value means it was not read
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
    case 'corrupt':
    case 'rejected': return 'unreadable';
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
 * rejects: a read-only status must do neither.
 */
export async function gatherGateStatus(deps: GateStatusDeps): Promise<GateStatus> {
  const manifestPath = path.join(deps.devflowDir, MACHINE_MANIFEST_NAME);
  const read = await deps.readManifest(deps.devflowDir);
  const base: GateStatusBase = { manifest: manifestState(read), manifestPath };

  const loaded = deps.loadSettings();
  const settings = loaded.ok ? resolveOnce(loaded.value, deps.dir) : null;
  if (settings === null) {
    const stored = read.kind === 'object' || read.kind === 'rejected' ? machineGateLevel(read.raw) : null;
    return { ...base, kind: 'unloadable', machine: stored };
  }

  const trackedWarning = trackedConfigWarning(settings);
  if (!settings.ok || settings.gateLevelSource === null) {
    return { ...base, kind: 'fail-closed', reason: failClosedReason(settings), machine: settings.gateLevelMachine, trackedWarning };
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

/** The machine line: `none` when the TypeScript or the resolver read it and found nothing, `unknown` when it was not read. */
function machineLine(machine: MachineValue, notRead: boolean): string {
  if (machine === 'invalid') return `Machine ${MACHINE_INVALID_LINE}`;
  if (machine === null) return `Machine ${notRead ? 'unknown' : 'none'}`;
  return `Machine ${machine}`;
}

function manifestWarning(status: GateStatus): string | null {
  if (status.manifest !== 'unreadable') return null;
  return `Manifest at ${status.manifestPath} cannot be read as a manifest; devflow init will replace this file.`;
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
      lines.push(`Effective ${status.level} (${status.source}${status.invalid ? ', invalid' : ''})`);
      lines.push(machineLine(status.machine, false));
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
      lines.push(`Effective full (fail-closed: ${status.reason ?? 'reason unknown'})`);
      lines.push(machineLine(status.machine, true));
      if (status.trackedWarning !== null) warnings.push(status.trackedWarning);
      break;
    }
    case 'unloadable': {
      lines.push('Effective level unknown');
      lines.push(machineLine(status.machine, false));
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
  .option('--set <level>', `Set the machine default gate level: ${VALID_LEVELS}`)
  .showHelpAfterError()
  .addHelpText(
    'after',
    `\nGate levels:\n${levelsHelp()}\n\n` +
    `The default is ${DEFAULT_GATE_LEVEL}. --set writes only the machine default. A personal .devflow/config.json ` +
    '"gateLevel" overrides it in one repository; no command writes that key.\n' +
    GATE_LEVEL_NO_EFFECT,
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
      p.outro(color.dim(GATE_LEVEL_NO_EFFECT));
      return;
    }

    // --status wins when both flags are passed, mirroring `devflow tracker`.
    if (options.status) {
      const status = await gatherGateStatus({
        devflowDir,
        dir: process.cwd(),
        loadSettings: loadSettingsModule,
        readManifest: readGateManifest,
      });
      const rendered = renderGateStatus(status);
      p.note(rendered.lines.join('\n'), 'Gate Level');
      for (const warning of rendered.warnings) p.log.warn(warning);
      return;
    }

    // Validate the typed level before any I/O: a bad word is rejected, never repaired.
    const parsed = parseGateLevel(options.set);
    if (!parsed.ok) {
      p.log.error(parsed.message);
      process.exitCode = 1;
      return;
    }
    const outcome = await runGatesSet(devflowDir, parsed.level);
    printOutcome(outcome);
    process.exitCode = outcome.exitCode;
  });
