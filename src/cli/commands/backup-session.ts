/**
 * The backup session of one command run: made once, before the command changes anything, and its
 * record printed once when the command ends.
 *
 * `devflow init`, `devflow curation`, `devflow compliance` and `devflow rules` each make one
 * session with {@link openBackupSession} and wrap the steps that may move or remove files in
 * {@link runWithBackupReport}. The wrapper prints the record after the steps return or throw, so a
 * run that moved a file and then failed still names where the file went.
 */
import { randomBytes } from 'crypto';
import * as p from '@clack/prompts';

import { WORKFLOW_FOLDERS } from '../../core/mds-variants.js';
import { getPackageRoot } from '../../core/paths.js';
import { retiredPathSet } from '../../core/retired-shipped-names.js';
import { createBackupSession, type BackupSession } from '../../targets/claude-code/install-backup.js';
import { loadShippedSet } from '../../targets/claude-code/shipped-set.js';
import { formatBackupSummary, type SummaryLine } from './install-report.js';

/**
 * Log each summary line at the severity it carries — the one dispatch every
 * `SummaryLine[]` renderer shares.
 *
 * Exhaustive over `SummaryLine['level']` rather than an `if/else`: a level added
 * to the interface has to be routed here, at compile time, instead of silently
 * degrading to `info` at every call site.
 */
export function logSummaryLines(lines: readonly SummaryLine[]): void {
  for (const line of lines) {
    switch (line.level) {
      case 'success':
        p.log.success(line.message);
        break;
      case 'info':
        p.log.info(line.message);
        break;
      case 'warn':
        p.log.warn(line.message);
        break;
      default: {
        const _exhaustive: never = line.level;
        void _exhaustive;
        break;
      }
    }
  }
}

export interface OpenBackupSessionOptions {
  /** Claude Code's config directory (e.g. ~/.claude). */
  readonly claudeDir: string;
  /** The machine root (~/.devflow): the skill shadows are read from it and the backups are made under it. */
  readonly devflowDir: string;
  /** Package root the shipped set is read from. Defaults to the running package. */
  readonly packageRoot?: string;
}

export type OpenBackupSessionResult =
  | { readonly ok: true; readonly session: BackupSession }
  | { readonly ok: false; readonly message: string };

/**
 * Make the backup session of a command run, before the command changes anything.
 *
 * The shipped set comes from the full registries and the package source, never from what an
 * earlier install left on disk. When it cannot be built the answer is a message and no session:
 * a session with a smaller set would move devflow's own files aside. The caller prints the
 * message, exits non-zero and changes nothing.
 */
export async function openBackupSession(options: OpenBackupSessionOptions): Promise<OpenBackupSessionResult> {
  const loaded = await loadShippedSet({
    devflowDir: options.devflowDir,
    packageRoot: options.packageRoot ?? getPackageRoot(),
    workflowFolders: WORKFLOW_FOLDERS,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      message: `Could not list the files devflow ships, so nothing was changed: ${loaded.reason}`,
    };
  }
  const session = createBackupSession({
    shipped: loaded.shipped,
    retired: retiredPathSet(),
    claudeDir: options.claudeDir,
    devflowDir: options.devflowDir,
    now: () => new Date(),
    bytes: size => randomBytes(size),
  });
  return { ok: true, session };
}

/**
 * The session of a command that reports its failures through the exit code: the session, or null
 * after one error line and exit code 1. The caller then returns without a change.
 */
export async function openBackupSessionOrFail(options: OpenBackupSessionOptions): Promise<BackupSession | null> {
  const opened = await openBackupSession(options);
  if (opened.ok) return opened.session;
  p.log.error(opened.message);
  process.exitCode = 1;
  return null;
}

/** The record of a session that is printed once, for a command that makes its session part-way through. */
export interface LateBackupReport {
  /** Name the session whose record is printed. Call it once, before the first change. */
  begin(session: BackupSession): void;
  /** Print the record at once. It does nothing before `begin` and after the first print. */
  print(): void;
}

/**
 * Run `fn`, which makes its session part-way through (it calls `begin`), and print the record of
 * that session once: at its own `print` call, or else after `fn` returns or throws and before the
 * caller returns or rethrows. A step that ends the process (`process.exit`) calls `print` first,
 * since nothing after an exit runs. A throw from `fn` passes on unchanged, and a run that never
 * calls `begin` prints nothing.
 *
 * @param emit - Where the lines go. Defaults to the clack log.
 */
export async function runWithLateBackupReport<T>(
  fn: (report: LateBackupReport) => Promise<T>,
  emit: (lines: readonly SummaryLine[]) => void = logSummaryLines,
): Promise<T> {
  let session: BackupSession | null = null;
  let printed = false;
  const report: LateBackupReport = {
    begin: (opened) => { session = opened; },
    print: () => {
      if (printed || session === null) return;
      printed = true;
      emit(formatBackupSummary(session.snapshot()));
    },
  };
  try {
    return await fn(report);
  } finally {
    report.print();
  }
}

/**
 * Run `fn` and print the record of `session` once, after `fn` returns or throws and before the
 * caller returns, rethrows or exits. A throw from `fn` passes on unchanged.
 *
 * `fn` receives `printBackups`, which prints the record at once and is a no-op afterwards: a step
 * that ends the process (`process.exit`) calls it first, since nothing after an exit runs.
 *
 * @param emit - Where the lines go. Defaults to the clack log.
 */
export function runWithBackupReport<T>(
  session: BackupSession,
  fn: (printBackups: () => void) => Promise<T>,
  emit: (lines: readonly SummaryLine[]) => void = logSummaryLines,
): Promise<T> {
  return runWithLateBackupReport(async (report) => {
    report.begin(session);
    return fn(report.print);
  }, emit);
}
