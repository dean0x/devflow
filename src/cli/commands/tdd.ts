/**
 * devflow tdd — the machine switch for the test-first text of the installed Code agent.
 *
 * `features.tdd` in ~/.devflow/manifest.json (absent = on) picks which installed files carry the
 * TDD text: with it on, the Code agent preloads the test-driven-development skill and its test
 * step says "write one failing test first"; with it off, the skill folder is not installed and the
 * Code agent keeps its test rules (one test per behaviour, trust boundaries, data loss, security,
 * fail-closed paths) without the test-first wording. Nothing reads the switch at run time: it only
 * decides which files this machine installs.
 *
 * `--enable` and `--disable` write the switch under the manifest lock, then run the one converge
 * for every variant axis (applyVariantToggle) and report. A converge that is skipped (no readable
 * manifest, a version skew) or that does not finish clean exits non-zero; the switch write is not
 * rolled back, so `devflow init` finishes the job. `--status` prints the switch, the gated skill
 * and what the install record says the installed prompts hold.
 *
 * The core (applyTddChange, readTddStatus) returns a Result and prints nothing; the command action
 * renders it. That keeps the business logic free of throws and of terminal output.
 */
import { Command } from 'commander';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { promises as fs } from 'fs';
import * as path from 'path';
import { writeMachineFeature } from '../../core/feature-switch.js';
import { readInstalledVariants, variantRecordStatus, type VariantRecordStatus } from '../../core/installed-variants.js';
import { readManifest } from '../../core/manifest.js';
import { TDD_GATED_SKILLS, prefixSkillName } from '../../core/plugins.js';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import {
  applyVariantToggle,
  describePostingLeft,
  describeVariantConverge,
  readRunningVersion,
} from '../../targets/claude-code/curation-install.js';
import type { BackupSession } from '../../targets/claude-code/install-backup.js';
import { openBackupSessionOrFail, runWithBackupReport } from './backup-session.js';

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type TddAction = 'enable' | 'disable' | 'status';

export interface TddOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

/**
 * The one action the flags ask for: null when none is given (the command prints its usage), an
 * error when more than one is, because `--enable --disable` has no meaning.
 */
export function resolveTddAction(options: TddOptions): Result<TddAction | null, string> {
  const asked: TddAction[] = [];
  if (options.enable === true) asked.push('enable');
  if (options.disable === true) asked.push('disable');
  if (options.status === true) asked.push('status');
  if (asked.length > 1) {
    return { ok: false, error: 'Use only one of --enable, --disable and --status.' };
  }
  return { ok: true, value: asked[0] ?? null };
}

export interface TddMessage {
  level: 'success' | 'info' | 'warn' | 'error';
  text: string;
}

export interface ApplyTddChangeOptions {
  claudeDir: string;
  devflowDir: string;
  /** The value to set the switch to. */
  enabled: boolean;
  /** The running package's version; null when it cannot be read. */
  runningVersion: string | null;
  /** Package root the variants are read from. Injectable for a temp tree; defaults to this package. */
  packageRoot?: string;
  /** Receives each per-item warning of the converge as it happens. */
  warn: (msg: string) => void;
  /** The backup session of the command, made before any change and shared with every step of it. */
  backups: BackupSession;
}

export interface ApplyTddChangeResult {
  messages: TddMessage[];
  /** 1 when the switch could not be recorded or the installed files were not all converged onto it. */
  exitCode: 0 | 1;
}

const stateWord = (enabled: boolean): string => (enabled ? 'on' : 'off');

/**
 * Apply one change of the tdd switch: write the switch, then run the one converge for every axis,
 * which records the installed variants after a clean run (applyVariantToggle does that last step).
 *
 * The switch comes first, so whatever the converge does next the machine's choice is on disk. A
 * converge that is skipped, or that leaves a file or the skill unconverged, exits 1 and says that
 * the switch stays recorded. Returns a result and never throws; the record of the backup session
 * prints once, as the change returns, ahead of the messages.
 */
export function applyTddChange(opts: ApplyTddChangeOptions): Promise<ApplyTddChangeResult> {
  return runWithBackupReport(opts.backups, () => applyChange(opts));
}

async function applyChange(opts: ApplyTddChangeOptions): Promise<ApplyTddChangeResult> {
  const { claudeDir, devflowDir, enabled, runningVersion, packageRoot, warn, backups } = opts;

  const recorded = await writeMachineFeature(devflowDir, 'tdd', enabled);
  if (!recorded.ok) {
    return {
      messages: [{ level: 'error', text: 'Devflow is not installed on this machine. Run `devflow init` first.' }],
      exitCode: 1,
    };
  }
  const recordedLine: TddMessage = { level: 'info', text: `The tdd switch is recorded as ${stateWord(enabled)}.` };

  const outcome = await applyVariantToggle({
    claudeDir,
    devflowDir,
    axis: 'tdd',
    enabled,
    runningVersion,
    warn,
    packageRoot,
    backups,
  });

  switch (outcome.kind) {
    case 'skipped':
      return { messages: [recordedLine, { level: 'error', text: outcome.message }], exitCode: 1 };
    case 'converged': {
      if (!outcome.result.converged) {
        return {
          messages: [
            recordedLine,
            { level: 'error', text: 'The installed files were not all converged onto the tdd switch (see the warnings above). Run `devflow init` to finish.' },
            ...describePostingLeft(outcome.result.posting).map((text): TddMessage => ({ level: 'warn', text })),
          ],
          exitCode: 1,
        };
      }
      const messages: TddMessage[] = [{
        level: 'success',
        text: enabled
          ? 'TDD enabled: the Code agent and the test-driven-development skill carry the test-first rules.'
          : 'TDD disabled: the test-first rules and the test-driven-development skill are not installed. ' +
            'The test rules for trust boundaries, data loss, security and fail-closed paths stay.',
      }];
      const changed = describeVariantConverge(outcome.result, 'tdd', enabled);
      if (changed !== null) messages.push({ level: 'info', text: `Installed prompts: ${changed}` });
      return { messages, exitCode: 0 };
    }
    default: {
      const unhandled: never = outcome;
      return { messages: [{ level: 'error', text: `Unhandled toggle outcome ${JSON.stringify(unhandled)}` }], exitCode: 1 };
    }
  }
}

export interface TddStatus {
  /** The machine switch, `features.tdd`. */
  enabled: boolean;
  /** Whether the gated test-driven-development skill folder is installed. */
  skillInstalled: boolean;
  /** What the install record says the installed prompts hold, read against the switch. */
  record: VariantRecordStatus;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Read the switch, the gated skill and the install record. Writes nothing. Never throws. */
export async function readTddStatus(opts: {
  claudeDir: string;
  devflowDir: string;
}): Promise<Result<TddStatus, 'not-installed'>> {
  const manifest = await readManifest(opts.devflowDir);
  if (manifest === null) return { ok: false, error: 'not-installed' };
  const enabled = manifest.features.tdd;
  return {
    ok: true,
    value: {
      enabled,
      skillInstalled: await pathExists(path.join(opts.claudeDir, 'skills', prefixSkillName(TDD_GATED_SKILLS[0]))),
      record: variantRecordStatus(readInstalledVariants(manifest.installedVariants), 'tdd', enabled),
    },
  };
}

function recordLine(record: VariantRecordStatus): string {
  switch (record) {
    case 'on':
      return color.green('on');
    case 'off':
      return color.dim('off');
    case 'mismatch':
      return color.yellow('mismatch (run devflow init)');
    case 'unknown':
      return color.yellow('unknown (run devflow init)');
    default: {
      const unhandled: never = record;
      return unhandled;
    }
  }
}

function logMessage(message: TddMessage): void {
  switch (message.level) {
    case 'success':
      p.log.success(message.text);
      break;
    case 'info':
      p.log.info(message.text);
      break;
    case 'warn':
      p.log.warn(message.text);
      break;
    case 'error':
      p.log.error(message.text);
      break;
    default: {
      const unhandled: never = message.level;
      void unhandled;
      break;
    }
  }
}

function renderStatus(result: Result<TddStatus, 'not-installed'>): void {
  if (!result.ok) {
    p.log.error(`Devflow is not installed on this machine. Run ${color.cyan('devflow init')} first.`);
    process.exitCode = 1;
    return;
  }
  const { enabled, skillInstalled, record } = result.value;
  p.log.info(`State:    ${enabled ? color.green('enabled') : color.yellow('disabled')}`);
  p.log.info(`Skill:    ${skillInstalled ? color.green('installed') : color.dim('not installed')}`);
  p.log.info(`Prompts:  ${recordLine(record)}`);
}

export const tddCommand = new Command('tdd')
  .description('Manage the test-first (TDD) text of the installed Code agent')
  .option('--enable', 'Install the Code agent with the test-first rules and the test-driven-development skill')
  .option('--disable', 'Install the Code agent without the test-first rules, and remove the test-driven-development skill')
  .option('--status', 'Show whether the test-first text is on and what is installed')
  .action(async (options: TddOptions) => {
    const resolved = resolveTddAction(options);
    if (!resolved.ok) {
      p.log.error(resolved.error);
      process.exitCode = 1;
      return;
    }
    const action = resolved.value;
    if (action === null) {
      p.log.info('Usage: devflow tdd --enable | --disable | --status');
      return;
    }

    const claudeDir = getClaudeDirectory();
    const devflowDir = getDevFlowDirectory();
    p.intro(color.cyan(action === 'status' ? 'TDD Status' : `${action === 'enable' ? 'Enable' : 'Disable'} TDD`));

    if (action === 'status') {
      renderStatus(await readTddStatus({ claudeDir, devflowDir }));
      p.outro('');
      return;
    }

    // The session comes before the first change. Without a shipped set the command changes nothing.
    const backups = await openBackupSessionOrFail({ claudeDir, devflowDir });
    if (backups === null) return;

    const applied = await applyTddChange({
      claudeDir,
      devflowDir,
      enabled: action === 'enable',
      runningVersion: await readRunningVersion(),
      warn: (msg: string) => p.log.warn(msg),
      backups,
    });
    for (const message of applied.messages) logMessage(message);
    if (applied.exitCode !== 0) process.exitCode = applied.exitCode;
    p.outro('');
  });
