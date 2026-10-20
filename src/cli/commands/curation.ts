import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  CURATION_TUNING_FILE_NAME,
  LEGACY_NAMES,
  getCurationDir,
  getGlobalCurateTuningConfigPath,
} from '../../core/project-paths.js';
import { loadShippedAgentDefaults } from '../../core/agent-models.js';
import { readMachineFeature, writeMachineFeature } from '../../core/feature-switch.js';
import { loadSettingsModule, narrowedSwitchLabel, personalConfigTrackedWarning } from '../../core/evidence-policy.js';
import { getClaudeDirectory, getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import {
  applyCurationToggle,
  describeCurationConverge,
  installedScriptsSkew,
  readRunningVersion,
} from '../../targets/claude-code/curation-install.js';
import { getLedgerRoot } from '../../core/ledger-root.js';
import { drainCurationQueue, drainDisabledCurationQueue } from '../../core/curation-queue-cleanup.js';
import { firstSymbolicLink } from '../../core/linked-path.js';
import { formatRefusedDrain } from '../../core/queue-drain.js';
import { describeMoveText, describeOutcome } from './curation-move-step.js';
import { formatMoveNotice, gatherMoveNotice } from '../../core/curation-move-notice.js';
import { runSharedMove, type SharedMoveResult } from './curation-move-io.js';
import {
  formatCurationStoreUnavailable,
  loadCurationStore,
  type CurationListing,
  type CurationStoreError,
  type CurationStoreModule,
} from '../../core/curation-store.js';
import { loadCurationMove } from '../../core/curation-move.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** What the read and restore commands say about a project with no `.devflow/curation/`. */
const NO_CURATION_DATA = 'No curation data in this project yet.';

/**
 * How long a writer here (--restore, --clear, --reset) waits for the curation lock
 * before it refuses as busy. An op holds the lock for milliseconds, so a longer
 * wait means a stuck holder, and the store's own 30 s wait would leave the command
 * looking hung.
 */
const LOCK_WAIT_MS = 5000;

/**
 * Code point ranges JSON.stringify leaves raw that a terminal may act on, or may
 * display reordered: DEL and the C1 controls, the directional marks, the line and
 * paragraph separators, and the bidirectional embeddings, overrides and isolates.
 */
const TERMINAL_UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x7f, 0x9f],
  [0x200e, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/**
 * `value` as pretty JSON a terminal shows as written: every character in
 * TERMINAL_UNSAFE_RANGES becomes its `\uXXXX` escape. Such characters can occur
 * only inside JSON strings, where the escape means the same character, so the
 * text still parses back to `value`.
 */
function terminalSafeJson(value: unknown): string {
  let text = '';
  for (const ch of JSON.stringify(value, null, 2)) {
    const code = ch.codePointAt(0) ?? 0;
    const unsafe = TERMINAL_UNSAFE_RANGES.some(([low, high]) => code >= low && code <= high);
    text += unsafe ? `\\u${code.toString(16).padStart(4, '0')}` : ch;
  }
  return text;
}

/** `1 decision`, `2 decisions`. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The curation store (D-LEARNING-STORE-SEAM), or null after reporting why it
 * cannot be used and setting exit code 1.
 */
function requireStore(): CurationStoreModule | null {
  const loaded = loadCurationStore();
  if (loaded.ok) return loaded.value;
  p.log.error(`Curation: ${formatCurationStoreUnavailable(loaded.error)}`);
  process.exitCode = 1;
  return null;
}

/** What a writer says when the store refused; `undone` completes "Nothing was …". */
function storeRefusal(error: CurationStoreError, undone: string): string {
  switch (error.kind) {
    case 'no-curation-dir': return NO_CURATION_DATA;
    case 'busy': return `The curation store is busy: another run holds its lock. Nothing was ${undone}; try again in a moment.`;
    default: return error.message;
  }
}

/**
 * Ask `message` on a terminal and say whether to go on, logging `cancelled` when the
 * answer is no. With no terminal there is no one to ask: a script that passed the
 * flag has decided.
 */
async function confirmOnTerminal(message: string, cancelled: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const confirmed = await p.confirm({ message, initialValue: false });
  if (p.isCancel(confirmed) || !confirmed) {
    p.log.info(cancelled);
    return false;
  }
  return true;
}

/** True when `dir` is a directory; false when nothing, or something else, is there. */
async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw err;
  }
}

/**
 * Whether the old ledger folder name is present under `root`'s `.devflow`: a folder, a
 * file or a link, dangling or not. The cheap state check that keeps the store unloaded
 * where there is nothing to move. A probe that fails for another reason reads as
 * present, so the move itself reports the problem.
 */
async function oldLedgerFolderPresent(root: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(root, '.devflow', LEGACY_NAMES.folder));
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

/** The lines a move that did not complete says: its own, or the store's reason when it could not load. */
function moveProblemLines(outcome: SharedMoveResult): string[] {
  return outcome.kind === 'unavailable'
    ? [`The curation data was not moved: ${describeMoveText(outcome.message)}.`]
    : describeOutcome(outcome);
}

/**
 * The line a read-only command prints instead of reading, for a project whose ledger
 * still sits in the old folder: the pointer, or the refused line when the hook's move
 * left a marker for this root. The HUD makes the same two existence tests and prints the
 * same words (`gatherMoveNotice`). Null when the new folder is there, or the old one is
 * not. The old ledger is never opened.
 */
async function pendingMoveLine(ledgerRoot: string): Promise<string | null> {
  const newFolderPresent = await isDirectory(getCurationDir(ledgerRoot)).catch(() => false);
  if (newFolderPresent) return null;
  const notice = gatherMoveNotice(ledgerRoot, os.homedir());
  return notice === null ? null : formatMoveNotice(notice);
}

/**
 * The gate every writing subcommand passes first (--restore, --clear, --reset and the
 * project scope of --configure). Installed scripts of another version read and create
 * another ledger folder, so they refuse with the skew line. Then, where the old folder
 * is present, the shared move runs with no wait: a busy lock prints a retry message,
 * and a refused or failed move prints its reason; either way nothing is written.
 * `undone` completes "Nothing was …". Answers true when the caller may write.
 */
async function prepareToWrite(ledgerRoot: string, undone: string): Promise<boolean> {
  const skew = await installedScriptsSkew(getDevFlowDirectory());
  if (skew !== null) {
    p.log.error(skew);
    process.exitCode = 1;
    return false;
  }
  if (!(await oldLedgerFolderPresent(ledgerRoot))) return true;
  const moved = await runSharedMove(ledgerRoot);
  if (moved.kind === 'moved' || moved.kind === 'unchanged') return true;
  p.log.error(moved.kind === 'busy'
    ? movingLine(undone)
    : describeMoveText(`${moveProblemLines(moved).join(' ')} Nothing was ${undone}.`));
  process.exitCode = 1;
  return false;
}

/** The line a writer prints when the move of the old folder is not done. `undone` completes "Nothing was …". */
function movingLine(undone: string): string {
  return `Another run is moving this project's curation data. Nothing was ${undone}; try again in a moment.`;
}

// ---------------------------------------------------------------------------
// Sub-command handlers
// ---------------------------------------------------------------------------

function printUsage(): void {
  p.intro(color.bgCyan(color.black(' Curation ')));
  p.note(
    `${color.cyan('devflow curation --enable')}        Enable curation in every project (a repository can opt out)\n` +
    `${color.cyan('devflow curation --disable')}       Disable curation in every project (drains this project's queue)\n` +
    `${color.cyan('devflow curation --status')}        Show curation status and entry counts\n` +
    `${color.cyan('devflow curation --list')}          List entries, inactive entries and observations\n` +
    `${color.cyan('devflow curation --show <id>')}     Print one entry or observation as JSON\n` +
    `${color.cyan('devflow curation --restore <id>')}  Make an inactive entry active again\n` +
    `${color.cyan('devflow curation --configure')}     Configuration wizard\n` +
    `${color.cyan('devflow curation --clear')}         Drop the observations no entry uses, and drain the queue\n` +
    `${color.cyan('devflow curation --reset')}         Remove all curation state files`,
    'Usage',
  );
  p.outro(color.dim('Detects architectural decisions and known pitfalls from your sessions'));
}

/**
 * Resolve the ledger root for a state-mutating subcommand, warning and
 * returning null if the caller isn't inside a git project. `actionSuffix`
 * completes "Could not resolve git root — {actionSuffix}".
 *
 * D-LEDGER-MAIN-WORKTREE: every subcommand here resolves the ledger with
 * getLedgerRoot — the hooks' DF_LEDGER_ROOT rule — so in a linked worktree it
 * reads, clears and drains the main checkout's ledger the hooks write.
 */
async function requireLedgerRoot(actionSuffix: string): Promise<string | null> {
  const ledgerRoot = await getLedgerRoot();
  if (!ledgerRoot) {
    p.log.warn(`Could not resolve git root — ${actionSuffix}`);
  }
  return ledgerRoot;
}

/**
 * The --status entry lines: active entries by type, inactive ones by status (in
 * the store's order, each status present), the active entries still in the v1
 * format — the migration still to do — and the observations.
 */
function entryCountLines(listing: CurationListing, logRowCount: number, inactiveStatuses: readonly string[]): string[] {
  const active = listing.active;
  const decisions = active.filter(entry => entry.type === 'decision').length;
  const pitfalls = active.filter(entry => entry.type === 'pitfall').length;
  const byStatus = inactiveStatuses
    .map(status => ({ status, count: listing.inactive.filter(entry => entry.status === status).length }))
    .filter(({ count }) => count > 0)
    .map(({ status, count }) => `${status} ${count}`);
  const legacy = active.filter(entry => entry.schema === 1).length;
  return [
    `Entries: ${active.length} active (${counted(decisions, 'decision')}, ${counted(pitfalls, 'pitfall')}), `
      + `${listing.inactive.length} inactive${byStatus.length > 0 ? ` (${byStatus.join(', ')})` : ''}`,
    `Legacy v1 entries: ${legacy} of ${active.length} active`,
    `Observations: ${logRowCount} in the log, ${listing.observations.length} not yet promoted`,
  ];
}

/**
 * The `--status` backup lines: one per backup folder a move left under `.devflow`, with
 * the rows its unswept queue files still hold, one more line for the folders past
 * the listing limit (up to the 500th, which are read), and one for those past the 500th
 * (not read, so their rows are not counted). A backup is inert, so the count tells the
 * user when deleting it loses nothing. A count that fails is a warning, not an error.
 */
function backupLines(ledgerRoot: string): { lines: string[]; warning: string | null } {
  const mover = loadCurationMove();
  if (!mover.ok) return { lines: [], warning: `Backup rows were not counted: ${formatCurationStoreUnavailable(mover.error)}` };
  const rows = mover.value.backupPendingRows(ledgerRoot);
  if (!rows.ok) return { lines: [], warning: `Backup rows were not counted: ${describeMoveText(rows.error.message)}` };
  const lines = rows.value.backups.map(({ name, pendingRows }) =>
    `Backup: ${describeMoveText(path.join(ledgerRoot, '.devflow', name))}: ${counted(pendingRows, 'pending row')} in the backup`);
  const beyond = rows.value.beyondLimit;
  if (beyond.backups > 0) {
    const one = beyond.backups === 1;
    lines.push(`Backup: ${counted(beyond.backups, 'more backup folder')} ${one ? 'is' : 'are'} not listed above: `
      + `${counted(beyond.pendingRows, 'pending row')} in ${one ? 'it' : 'them'}`);
  }
  if (beyond.unread > 0) {
    const one = beyond.unread === 1;
    lines.push(`Backup: ${counted(beyond.unread, 'more backup folder')} past the first 500 ${one ? 'is' : 'are'} not read: `
      + `${one ? 'its' : 'their'} pending rows are not counted`);
  }
  return { lines, warning: null };
}

/**
 * `--status`: the machine switch, then the counts the store reads. Reads only:
 * malformed lines are counted, never quarantined, and no scope is checked. A project
 * whose ledger still sits in the old folder gets the HUD's pointer (or refused line)
 * in place of the counts; a project with backup folders gets one line for each.
 */
async function handleStatus(): Promise<void> {
  // D-FEATURES-NARROW-ONLY: the machine switch is the manifest's and reads the
  // same from every directory; a repository layer can only narrow it, and adds a
  // line only when it does. The entry counts are per-project.
  const enabled = await readMachineFeature(getDevFlowDirectory(), 'curation');
  const settingsModule = loadSettingsModule();
  const narrowed = enabled ? narrowedSwitchLabel(settingsModule, { dir: process.cwd() }, 'curation') : null;
  const stateLine = `Curation: ${enabled ? 'enabled' : 'disabled'}`
    + (narrowed === null ? '' : `\nEffective here: ${narrowed}`);
  const trackedWarning = personalConfigTrackedWarning(settingsModule, { dir: process.cwd() });
  if (trackedWarning !== null) p.log.warn(trackedWarning);
  const ledgerRoot = await getLedgerRoot();
  if (!ledgerRoot) {
    p.log.info(`${stateLine}\nEntries: not in a git project`);
    return;
  }
  const pending = await pendingMoveLine(ledgerRoot);
  if (pending !== null) {
    p.log.info(`${stateLine}\n${pending}`);
    return;
  }
  const loaded = loadCurationStore();
  if (!loaded.ok) {
    p.log.info(`${stateLine}\nEntries: unavailable (${formatCurationStoreUnavailable(loaded.error)})`);
    return;
  }
  const store = loaded.value;
  const { ledgerRows, logRows, rejected } = store.readCurationState(ledgerRoot);
  const listing = store.buildListing(ledgerRows, logRows, { rejected });
  const backups = backupLines(ledgerRoot);
  p.log.info([stateLine, ...entryCountLines(listing, logRows.length, store.INACTIVE_STATUSES), ...backups.lines].join('\n'));
  if (backups.warning !== null) p.log.warn(backups.warning);
  const { ledger, log } = listing.malformed;
  if (ledger + log > 0) {
    p.log.warn(
      `Malformed lines skipped: ${ledger} in the ledger, ${log} in the log. ` +
      'The next op that rewrites a file moves its malformed lines to a .rejected.jsonl file beside it.',
    );
  }
}

/**
 * `--list`: the store's listing — the same text json-helper's `list` op prints —
 * on stdout. Read-only. Outside a git project it reads the current directory. Where
 * the ledger still sits in the old folder it prints the pointer or the refused line.
 */
async function handleList(): Promise<void> {
  const root = (await getLedgerRoot()) ?? process.cwd();
  const pending = await pendingMoveLine(root);
  if (pending !== null) {
    p.log.info(pending);
    return;
  }
  const store = requireStore();
  if (!store) return;
  const listed = store.readListing(root);
  if (!listed.ok) {
    if (listed.error.kind === 'no-curation-dir') {
      p.log.info(NO_CURATION_DATA);
      return;
    }
    p.log.error(listed.error.message);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${store.formatListing(listed.value)}\n`);
}

/**
 * `--show <id>`: one entry, by its anchor or its observation id, as the JSON
 * json-helper's `show` op prints, made terminal-safe. Read-only. Outside a git
 * project it reads the current directory. Where the ledger still sits in the old
 * folder it prints the pointer or the refused line as the refusal.
 */
async function handleShow(key: string): Promise<void> {
  const root = (await getLedgerRoot()) ?? process.cwd();
  const pending = await pendingMoveLine(root);
  if (pending !== null) {
    p.log.error(pending);
    process.exitCode = 1;
    return;
  }
  const store = requireStore();
  if (!store) return;
  const shown = store.showByKey(root, key);
  if (!shown.ok) {
    p.log.error(shown.error.kind === 'no-curation-dir' ? NO_CURATION_DATA : shown.error.message);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${terminalSafeJson(shown.value)}\n`);
}

/**
 * `--restore <id>`: make an inactive entry active again through the store's
 * restoreAnchor, which clears its notes and its verification so maintenance
 * reviews it again, and re-renders the files. It writes through the store lock, so
 * it moves the old folder first (prepareToWrite). A refusal writes nothing.
 */
async function handleRestore(anchor: string): Promise<void> {
  const ledgerRoot = await requireLedgerRoot('restore not performed');
  if (!ledgerRoot) {
    process.exitCode = 1;
    return;
  }
  const store = requireStore();
  if (!store) return;
  if (!store.ANCHOR_ID_RE.test(anchor)) {
    p.log.error(`--restore takes an entry id (ADR-NNN or PF-NNN), not ${JSON.stringify(anchor)}`);
    process.exitCode = 1;
    return;
  }
  if (!(await prepareToWrite(ledgerRoot, 'restored'))) return;
  const restored = store.restoreAnchor(ledgerRoot, anchor, { timeoutMs: LOCK_WAIT_MS });
  if (!restored.ok) {
    p.log.error(storeRefusal(restored.error, 'restored'));
    process.exitCode = 1;
    return;
  }
  p.log.success(`Restored ${restored.value.anchor_id} (${restored.value.status}); it is due for review again.`);
}

/**
 * The scope choices of `devflow curation --configure`.
 *
 * D-LEARNING-MODEL-PRECEDENCE: the session-start hook takes the first layer that
 * supplies a model — the project file, then a `devflow agents` Curate mapping,
 * then the global file. A global file therefore has no effect for a user who has
 * such a mapping, and its hint says so.
 */
export const CONFIGURE_SCOPE_OPTIONS = [
  { value: 'project', label: 'Project', hint: 'This project only (.devflow/curation/curation.json)' },
  {
    value: 'global',
    label: 'Global',
    hint: 'All projects (~/.devflow/curation.json); a devflow agents Curate mapping takes precedence over it',
  },
] as const;

/** The models `devflow curation --configure` offers, each with what it is good for. */
const CURATE_MODEL_CHOICES = [
  { value: 'opus', label: 'Opus', note: 'highest quality for detection + curation judgment' },
  { value: 'sonnet', label: 'Sonnet', note: 'good balance of quality and speed' },
  { value: 'haiku', label: 'Haiku', note: 'fastest, lowest cost' },
] as const;

/**
 * D-LEARNING-SHIPPED-ROW: the model offered as "Recommended" is the one the Curate
 * agent ships with, the `model:` line of its frontmatter. It is read from there and
 * written nowhere else, so a change of the shipped tier moves the recommendation with
 * it and this list never has to be edited. A shipped model outside the three offered
 * (or none) recommends nothing.
 */
export function curateModelOptions(
  shippedModel: string | undefined,
): Array<{ value: string; label: string; hint: string }> {
  return CURATE_MODEL_CHOICES.map(choice => ({
    value: choice.value,
    label: choice.label,
    hint: choice.value === shippedModel
      ? `Recommended — ${choice.note}`
      : choice.note.charAt(0).toUpperCase() + choice.note.slice(1),
  }));
}

async function handleConfigure(): Promise<void> {
  p.intro(color.bgCyan(color.black(' Curation Configuration ')));

  const shippedModel = (await loadShippedAgentDefaults()).curate?.model;
  const model = await p.select({
    message: 'Model for decision detection',
    options: curateModelOptions(shippedModel),
  });
  if (p.isCancel(model)) {
    p.cancel('Configuration cancelled.');
    return;
  }

  const debugMode = await p.confirm({
    message: 'Enable debug logging? (logs session content excerpts to ~/.devflow/logs/)',
    initialValue: false,
  });
  if (p.isCancel(debugMode)) {
    p.cancel('Configuration cancelled.');
    return;
  }

  const scope = await p.select({
    message: 'Configuration scope',
    options: [...CONFIGURE_SCOPE_OPTIONS],
  });
  if (p.isCancel(scope)) {
    p.cancel('Configuration cancelled.');
    return;
  }

  const config = {
    model,
    debug: debugMode,
  };

  const configJson = JSON.stringify(config, null, 2) + '\n';

  if (scope === 'global') {
    const globalDir = getDevFlowDirectory();
    await fs.mkdir(globalDir, { recursive: true });
    const globalConfigPath = getGlobalCurateTuningConfigPath(globalDir);
    await fs.writeFile(globalConfigPath, configJson, 'utf-8');
    p.log.success(`Global config written to ${color.dim(globalConfigPath)}`);
  } else {
    // D-LEDGER-MAIN-WORKTREE: session-start-context reads the project tuning config
    // from the ledger ($LEDGER_ROOT/.devflow/curation/), so write it there — the
    // main checkout in a linked worktree; the current directory outside git.
    const projectRoot = (await getLedgerRoot()) ?? process.cwd();
    // Skew or a move that cannot run (busy, refused, failed) writes nothing, so the
    // config never lands in a folder the readers do not use.
    if (!(await prepareToWrite(projectRoot, 'written'))) return;
    // The creator rule: this writer makes the new folder only when the old name is
    // absent, so it looks once more. A folder of the old name can stand again after the
    // move, and the new folder made beside it would hide its ledger from every reader.
    if (await oldLedgerFolderPresent(projectRoot)) {
      p.log.error(movingLine('written'));
      process.exitCode = 1;
      return;
    }
    // The folder that is checked is the folder that is written.
    const curationDir = getCurationDir(projectRoot);
    const projectConfigPath = path.join(curationDir, CURATION_TUNING_FILE_NAME);
    // D-CLI-NO-SYMLINK (core/linked-path.ts): nothing is written through a .devflow,
    // a curation folder or a curation.json that is a symbolic link.
    const linked = await firstSymbolicLink([path.dirname(curationDir), curationDir, projectConfigPath]);
    if (linked !== null) {
      p.log.error(`Project config not written: ${linked} is a symbolic link, and devflow writes nothing through one`);
      process.exitCode = 1;
      return;
    }
    await fs.mkdir(curationDir, { recursive: true });
    await fs.writeFile(projectConfigPath, configJson, 'utf-8');
    p.log.success(`Project config written to ${color.dim(projectConfigPath)}`);
  }

  p.outro(color.green('Configuration saved.'));
}

/**
 * `--reset`: remove all curation state — entries, observations, rendered files,
 * the tuning config, and the queue with its claim — through the store's
 * resetCuration, under the curation lock every curation writer takes
 * (D-ONE-LEARNING-LOCK, D-RESET-UNDER-LOCK). The old folder moves first
 * (prepareToWrite), so the reset reaches the data the hooks use; a backup folder a
 * move left stays in place. A project with no curation directory has nothing to
 * reset, and nothing is created there (D-NO-STRAY-TREE).
 */
async function handleReset(): Promise<void> {
  const ledgerRoot = await requireLedgerRoot('reset not performed');
  if (!ledgerRoot) return;
  const store = requireStore();
  if (!store) return;
  if (!(await prepareToWrite(ledgerRoot, 'reset'))) return;
  if (!(await isDirectory(getCurationDir(ledgerRoot)))) {
    p.log.info('No curation data to reset.');
    return;
  }

  const proceed = await confirmOnTerminal('Remove all curation state files? This cannot be undone.', 'Reset cancelled.');
  if (!proceed) return;

  const reset = store.resetCuration(ledgerRoot, { timeoutMs: LOCK_WAIT_MS });
  if (!reset.ok) {
    if (reset.error.kind === 'no-curation-dir') {
      p.log.info('No curation data to reset.');
      return;
    }
    p.log.error(storeRefusal(reset.error, 'reset'));
    process.exitCode = 1;
    return;
  }
  p.log.success('Reset complete — removed .devflow/curation/ state.');
}

/**
 * `--clear`: drop the observations no entry uses (D-CLEAR-UNREFERENCED), then
 * drain the curation queue. The queue is drained only once the clear succeeded:
 * a busy lock or a refusal leaves both the log and the queue as they were, so a
 * failed clear changes nothing. The old folder moves first (prepareToWrite), so the
 * clear and the drain reach the data the hooks use; a backup folder a move left
 * stays in place.
 */
async function handleClear(): Promise<void> {
  const ledgerRoot = await requireLedgerRoot('clear not performed');
  if (!ledgerRoot) return;
  const store = requireStore();
  if (!store) return;
  if (!(await prepareToWrite(ledgerRoot, 'cleared'))) return;
  if (!(await isDirectory(getCurationDir(ledgerRoot)))) {
    p.log.info('No curation data to clear.');
    return;
  }

  const proceed = await confirmOnTerminal(
    'Drop every observation no entry uses? Entries and the observations they use are kept. This cannot be undone.',
    'Clear cancelled.',
  );
  if (!proceed) return;

  const cleared = store.clearUnreferenced(ledgerRoot, { timeoutMs: LOCK_WAIT_MS });
  if (!cleared.ok) {
    if (cleared.error.kind === 'no-curation-dir') {
      p.log.info('No curation data to clear.');
      return;
    }
    p.log.error(storeRefusal(cleared.error, 'cleared'));
    process.exitCode = 1;
    return;
  }

  // A mid-run Curate agent whose claimed batch vanishes stops without further
  // writes — the desired outcome of clearing.
  const drain = await drainCurationQueue(ledgerRoot);

  p.log.success(
    `Cleared ${counted(cleared.value.cleared, 'observation')} no entry uses and kept ${cleared.value.kept} ` +
    `that entries use${drain.drained ? '; drained the curation queue.' : '.'}`,
  );
  if (!drain.drained) p.log.warn(formatRefusedDrain('curation', drain.linkedFolder));
}

/**
 * Make the installed prompts match the switch just written
 * (D-LEARNING-VARIANT-INSTALL): the curation-on or curation-off commands and
 * agents, and the apply-decisions skill. The same convergence `devflow init` runs,
 * followed by reapplying the saved agent model mapping so `devflow agents`
 * overrides survive.
 *
 * Warn-not-fail: the switch itself is already recorded, and either mismatch is
 * safe (an on variant is still gated at run time, an off variant loads no
 * decisions), so a problem here never changes the exit code.
 *
 * Answers whether the converge ran, which means the installed files are the ones
 * this CLI writes. The toggle moves the ledger folder only then: under version skew
 * (or when that could not be told) it moves nothing.
 */
async function convergeInstalledVariants(enabled: boolean): Promise<'converged' | 'not-converged'> {
  try {
    const outcome = await applyCurationToggle({
      claudeDir: getClaudeDirectory(),
      devflowDir: getDevFlowDirectory(),
      curation: enabled,
      runningVersion: await readRunningVersion(),
      warn: (msg) => p.log.warn(msg),
    });
    if (outcome.kind === 'skipped') {
      p.log.warn(outcome.message);
      return 'not-converged';
    }
    const changed = describeCurationConverge(outcome.result, enabled);
    if (changed !== null) p.log.info(color.dim(`Installed prompts: ${changed}`));
    return 'converged';
  } catch (err) {
    p.log.warn(`Could not update the installed prompts for the new curation setting — run ${color.cyan('devflow init')}: ${String(err)}`);
    return 'not-converged';
  }
}

/**
 * The toggle's move of the current project's ledger folder: tried once with no wait,
 * and only where the old folder is present. A busy move is not an error — the project
 * moves at its next event — and a refusal or a failure is a warning: the switch is
 * already recorded, so neither changes the exit code.
 */
async function tryMoveForToggle(ledgerRoot: string): Promise<void> {
  if (!(await oldLedgerFolderPresent(ledgerRoot))) return;
  const outcome = await runSharedMove(ledgerRoot);
  if (outcome.kind === 'moved' || outcome.kind === 'unchanged') return;
  for (const line of moveProblemLines(outcome)) {
    if (outcome.kind === 'busy') p.log.info(color.dim(describeMoveText(line)));
    else p.log.warn(describeMoveText(line));
  }
}

/**
 * `--enable` / `--disable`: the machine-wide switch (D-FEATURES-NARROW-ONLY),
 * converged exactly as `devflow init --curation / --no-curation` converges it —
 * the manifest value (both machine keys, written first), the installed prompt
 * variants and skill (D-LEARNING-VARIANT-INSTALL), the current project's ledger
 * folder move, and on disable a drained queue in every ledger folder that exists and
 * in the backups a move left.
 * Never requires a git root: the switch is not a per-project setting.
 *
 * Under version skew the toggle records the switch and moves nothing; otherwise it
 * tries the shared move with no wait. Only `--disable` drains, skew included.
 */
async function handleToggle(enabled: boolean): Promise<void> {
  const recorded = await writeMachineFeature(getDevFlowDirectory(), 'curation', enabled);
  if (!recorded.ok) {
    p.log.error(`Devflow is not installed on this machine — run ${color.cyan('devflow init')} first`);
    process.exitCode = 1;
    return;
  }

  const converged = await convergeInstalledVariants(enabled);
  const ledgerRoot = await getLedgerRoot();
  if (converged === 'converged' && ledgerRoot) await tryMoveForToggle(ledgerRoot);

  if (enabled) {
    p.log.success('Curation enabled in every project (a repository can opt out)');
    p.log.info(color.dim('Architectural decisions and pitfalls will be detected from your sessions'));
    return;
  }

  // Drain the current project's curation (decisions-detection) queue, in each ledger
  // folder that exists and in the backups a move left, so stale turns don't process on
  // re-enable. A mid-run Curate agent whose claimed batch vanishes aborts without
  // changes — the desired outcome of disabling.
  if (ledgerRoot) {
    const drain = await drainDisabledCurationQueue(ledgerRoot);
    if (!drain.drained) p.log.warn(formatRefusedDrain('curation', drain.linkedFolder));
    else if (drain.warning !== undefined) p.log.warn(drain.warning);
  }
  p.log.success('Curation disabled in every project');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

interface CurationOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
  show?: string;
  restore?: string;
  configure?: boolean;
  clear?: boolean;
  reset?: boolean;
}

export const curationCommand = new Command('curation')
  .description('Enable or disable curation (decision/pitfall detection) in every project')
  .option('--enable', 'Enable curation in every project (a repository can opt out)')
  .option('--disable', 'Disable curation in every project')
  .option('--status', 'Show curation status and entry counts')
  .option('--list', 'List entries, inactive entries with their notes, and observations')
  .option('--show <id>', 'Print one entry (ADR-NNN or PF-NNN) or observation (obs_...) as JSON')
  .option('--restore <id>', 'Make an inactive entry active again')
  .option('--configure', 'Interactive configuration wizard for curation.json')
  .option('--clear', 'Drop the observations no entry uses, and drain the curation queue')
  .option('--reset', 'Remove all curation state files and artifacts')
  .action(async (options: CurationOptions) => {
    const knownFlags: (keyof CurationOptions)[] = [
      'enable', 'disable', 'status', 'list', 'show', 'restore', 'configure',
      'clear', 'reset',
    ];
    const hasFlag = knownFlags.some((f) => options[f] !== undefined);
    if (!hasFlag) {
      printUsage();
      return;
    }

    // Thin router — the read-only commands first (status, list, show), then
    // configure, reset, clear, restore, enable, disable. Each handler owns its own
    // path resolution and I/O.
    if (options.status) {
      await handleStatus();
      return;
    }
    if (options.list) {
      await handleList();
      return;
    }
    if (options.show !== undefined) {
      await handleShow(options.show);
      return;
    }
    if (options.configure) {
      await handleConfigure();
      return;
    }
    if (options.reset) {
      await handleReset();
      return;
    }
    if (options.clear) {
      await handleClear();
      return;
    }
    if (options.restore !== undefined) {
      await handleRestore(options.restore);
      return;
    }
    if (options.enable) {
      await handleToggle(true);
      return;
    }
    if (options.disable) {
      await handleToggle(false);
      return;
    }
  });
