import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  getLearningDir,
  getLearningTuningConfigPath,
} from '../../core/project-paths.js';
import { loadShippedAgentDefaults } from '../../core/agent-models.js';
import { readMachineFeature, writeMachineFeature } from '../../core/feature-switch.js';
import { loadSettingsModule, narrowedSwitchLabel, personalConfigTrackedWarning } from '../../core/evidence-policy.js';
import { getDevFlowDirectory } from '../../targets/claude-code/claude-paths.js';
import { getLedgerRoot } from '../../core/ledger-root.js';
import { drainLearningQueue } from '../../core/learning-queue-cleanup.js';
import { firstSymbolicLink } from '../../core/linked-path.js';
import { formatRefusedDrain } from '../../core/queue-drain.js';
import {
  formatLearningStoreUnavailable,
  loadLearningStore,
  type LearningListing,
  type LearningStoreError,
  type LearningStoreModule,
} from '../../core/learning-store.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** What the read and restore commands say about a project with no `.devflow/learning/`. */
const NO_LEARNING_DATA = 'No learning data in this project yet.';

/**
 * How long a writer here (--restore, --clear, --reset) waits for the learning lock
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
 * The learning store (D-LEARNING-STORE-SEAM), or null after reporting why it
 * cannot be used and setting exit code 1.
 */
function requireStore(): LearningStoreModule | null {
  const loaded = loadLearningStore();
  if (loaded.ok) return loaded.value;
  p.log.error(`Learning: ${formatLearningStoreUnavailable(loaded.error)}`);
  process.exitCode = 1;
  return null;
}

/** What a writer says when the store refused; `undone` completes "Nothing was …". */
function storeRefusal(error: LearningStoreError, undone: string): string {
  switch (error.kind) {
    case 'no-learning-dir': return NO_LEARNING_DATA;
    case 'busy': return `The learning store is busy: another run holds its lock. Nothing was ${undone}; try again in a moment.`;
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

// ---------------------------------------------------------------------------
// Sub-command handlers
// ---------------------------------------------------------------------------

function printUsage(): void {
  p.intro(color.bgCyan(color.black(' Learning ')));
  p.note(
    `${color.cyan('devflow learning --enable')}        Enable learning in every project (a repository can opt out)\n` +
    `${color.cyan('devflow learning --disable')}       Disable learning in every project (drains this project's queue)\n` +
    `${color.cyan('devflow learning --status')}        Show learning status and entry counts\n` +
    `${color.cyan('devflow learning --list')}          List entries, inactive entries and observations\n` +
    `${color.cyan('devflow learning --show <id>')}     Print one entry or observation as JSON\n` +
    `${color.cyan('devflow learning --restore <id>')}  Make an inactive entry active again\n` +
    `${color.cyan('devflow learning --configure')}     Configuration wizard\n` +
    `${color.cyan('devflow learning --clear')}         Drop the observations no entry uses, and drain the queue\n` +
    `${color.cyan('devflow learning --reset')}         Remove all learning state files`,
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
function entryCountLines(listing: LearningListing, logRowCount: number, inactiveStatuses: readonly string[]): string[] {
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
 * `--status`: the machine switch, then the counts the store reads. Reads only:
 * malformed lines are counted, never quarantined, and no scope is checked.
 */
async function handleStatus(): Promise<void> {
  // D-FEATURES-NARROW-ONLY: the machine switch is the manifest's and reads the
  // same from every directory; a repository layer can only narrow it, and adds a
  // line only when it does. The entry counts are per-project.
  const enabled = await readMachineFeature(getDevFlowDirectory(), 'learning');
  const settingsModule = loadSettingsModule();
  const narrowed = enabled ? narrowedSwitchLabel(settingsModule, { dir: process.cwd() }, 'learning') : null;
  const stateLine = `Learning: ${enabled ? 'enabled' : 'disabled'}`
    + (narrowed === null ? '' : `\nEffective here: ${narrowed}`);
  const trackedWarning = personalConfigTrackedWarning(settingsModule, { dir: process.cwd() });
  if (trackedWarning !== null) p.log.warn(trackedWarning);
  const ledgerRoot = await getLedgerRoot();
  if (!ledgerRoot) {
    p.log.info(`${stateLine}\nEntries: not in a git project`);
    return;
  }
  const loaded = loadLearningStore();
  if (!loaded.ok) {
    p.log.info(`${stateLine}\nEntries: unavailable (${formatLearningStoreUnavailable(loaded.error)})`);
    return;
  }
  const store = loaded.value;
  const { ledgerRows, logRows, rejected } = store.readLearningState(ledgerRoot);
  const listing = store.buildListing(ledgerRows, logRows, { rejected });
  p.log.info([stateLine, ...entryCountLines(listing, logRows.length, store.INACTIVE_STATUSES)].join('\n'));
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
 * on stdout. Read-only. Outside a git project it reads the current directory.
 */
async function handleList(): Promise<void> {
  const root = (await getLedgerRoot()) ?? process.cwd();
  const store = requireStore();
  if (!store) return;
  const listed = store.readListing(root);
  if (!listed.ok) {
    if (listed.error.kind === 'no-learning-dir') {
      p.log.info(NO_LEARNING_DATA);
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
 * project it reads the current directory.
 */
async function handleShow(key: string): Promise<void> {
  const root = (await getLedgerRoot()) ?? process.cwd();
  const store = requireStore();
  if (!store) return;
  const shown = store.showByKey(root, key);
  if (!shown.ok) {
    p.log.error(shown.error.kind === 'no-learning-dir' ? NO_LEARNING_DATA : shown.error.message);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${terminalSafeJson(shown.value)}\n`);
}

/**
 * `--restore <id>`: make an inactive entry active again through the store's
 * restoreAnchor, which clears its notes and its verification so maintenance
 * reviews it again, and re-renders the files. A refusal writes nothing.
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
  const restored = store.restoreAnchor(ledgerRoot, anchor, { timeoutMs: LOCK_WAIT_MS });
  if (!restored.ok) {
    p.log.error(storeRefusal(restored.error, 'restored'));
    process.exitCode = 1;
    return;
  }
  p.log.success(`Restored ${restored.value.anchor_id} (${restored.value.status}); it is due for review again.`);
}

/**
 * The scope choices of `devflow learning --configure`.
 *
 * D-LEARNING-MODEL-PRECEDENCE: the session-start hook takes the first layer that
 * supplies a model — the project file, then a `devflow agents` Learning mapping,
 * then the global file. A global file therefore has no effect for a user who has
 * such a mapping, and its hint says so.
 */
export const CONFIGURE_SCOPE_OPTIONS = [
  { value: 'project', label: 'Project', hint: 'This project only (.devflow/learning/learning.json)' },
  {
    value: 'global',
    label: 'Global',
    hint: 'All projects (~/.devflow/learning.json); a devflow agents Learning mapping takes precedence over it',
  },
] as const;

/** The models `devflow learning --configure` offers, each with what it is good for. */
const LEARNING_MODEL_CHOICES = [
  { value: 'opus', label: 'Opus', note: 'highest quality for detection + curation judgment' },
  { value: 'sonnet', label: 'Sonnet', note: 'good balance of quality and speed' },
  { value: 'haiku', label: 'Haiku', note: 'fastest, lowest cost' },
] as const;

/**
 * D-LEARNING-SHIPPED-ROW: the model offered as "Recommended" is the one the Learning
 * agent ships with, the `model:` line of its frontmatter. It is read from there and
 * written nowhere else, so a change of the shipped tier moves the recommendation with
 * it and this list never has to be edited. A shipped model outside the three offered
 * (or none) recommends nothing.
 */
export function learningModelOptions(
  shippedModel: string | undefined,
): Array<{ value: string; label: string; hint: string }> {
  return LEARNING_MODEL_CHOICES.map(choice => ({
    value: choice.value,
    label: choice.label,
    hint: choice.value === shippedModel
      ? `Recommended — ${choice.note}`
      : choice.note.charAt(0).toUpperCase() + choice.note.slice(1),
  }));
}

async function handleConfigure(): Promise<void> {
  p.intro(color.bgCyan(color.black(' Learning Configuration ')));

  const shippedModel = (await loadShippedAgentDefaults()).learning?.model;
  const model = await p.select({
    message: 'Model for decision detection',
    options: learningModelOptions(shippedModel),
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
    await fs.writeFile(path.join(globalDir, 'learning.json'), configJson, 'utf-8');
    p.log.success(`Global config written to ${color.dim(path.join(globalDir, 'learning.json'))}`);
  } else {
    // D-LEDGER-MAIN-WORKTREE: session-start-context reads the project tuning config
    // from the ledger ($LEDGER_ROOT/.devflow/learning/), so write it there — the
    // main checkout in a linked worktree; the current directory outside git.
    const projectRoot = (await getLedgerRoot()) ?? process.cwd();
    const learningDir = getLearningDir(projectRoot);
    const projectConfigPath = getLearningTuningConfigPath(projectRoot);
    // D-CLI-NO-SYMLINK (core/linked-path.ts): nothing is written through a .devflow,
    // a learning folder or a learning.json that is a symbolic link.
    const linked = await firstSymbolicLink([path.dirname(learningDir), learningDir, projectConfigPath]);
    if (linked !== null) {
      p.log.error(`Project config not written: ${linked} is a symbolic link, and devflow writes nothing through one`);
      process.exitCode = 1;
      return;
    }
    await fs.mkdir(learningDir, { recursive: true });
    await fs.writeFile(projectConfigPath, configJson, 'utf-8');
    p.log.success(`Project config written to ${color.dim(projectConfigPath)}`);
  }

  p.outro(color.green('Configuration saved.'));
}

/**
 * `--reset`: remove all learning state — entries, observations, rendered files,
 * the tuning config, and the queue with its claim — through the store's
 * resetLearning, under the learning lock every learning writer takes
 * (D-ONE-LEARNING-LOCK, D-RESET-UNDER-LOCK). A project with no learning directory
 * has nothing to reset, and nothing is created there (D-NO-STRAY-TREE).
 */
async function handleReset(): Promise<void> {
  const ledgerRoot = await requireLedgerRoot('reset not performed');
  if (!ledgerRoot) return;
  const store = requireStore();
  if (!store) return;
  if (!(await isDirectory(getLearningDir(ledgerRoot)))) {
    p.log.info('No learning data to reset.');
    return;
  }

  const proceed = await confirmOnTerminal('Remove all learning state files? This cannot be undone.', 'Reset cancelled.');
  if (!proceed) return;

  const reset = store.resetLearning(ledgerRoot, { timeoutMs: LOCK_WAIT_MS });
  if (!reset.ok) {
    if (reset.error.kind === 'no-learning-dir') {
      p.log.info('No learning data to reset.');
      return;
    }
    p.log.error(storeRefusal(reset.error, 'reset'));
    process.exitCode = 1;
    return;
  }
  p.log.success('Reset complete — removed .devflow/learning/ state.');
}

/**
 * `--clear`: drop the observations no entry uses (D-CLEAR-UNREFERENCED), then
 * drain the learning queue. The queue is drained only once the clear succeeded:
 * a busy lock or a refusal leaves both the log and the queue as they were, so a
 * failed clear changes nothing.
 */
async function handleClear(): Promise<void> {
  const ledgerRoot = await requireLedgerRoot('clear not performed');
  if (!ledgerRoot) return;
  const store = requireStore();
  if (!store) return;
  if (!(await isDirectory(getLearningDir(ledgerRoot)))) {
    p.log.info('No learning data to clear.');
    return;
  }

  const proceed = await confirmOnTerminal(
    'Drop every observation no entry uses? Entries and the observations they use are kept. This cannot be undone.',
    'Clear cancelled.',
  );
  if (!proceed) return;

  const cleared = store.clearUnreferenced(ledgerRoot, { timeoutMs: LOCK_WAIT_MS });
  if (!cleared.ok) {
    if (cleared.error.kind === 'no-learning-dir') {
      p.log.info('No learning data to clear.');
      return;
    }
    p.log.error(storeRefusal(cleared.error, 'cleared'));
    process.exitCode = 1;
    return;
  }

  // A mid-run Learning agent whose claimed batch vanishes stops without further
  // writes — the desired outcome of clearing.
  const drain = await drainLearningQueue(ledgerRoot);

  p.log.success(
    `Cleared ${counted(cleared.value.cleared, 'observation')} no entry uses and kept ${cleared.value.kept} ` +
    `that entries use${drain.drained ? '; drained the learning queue.' : '.'}`,
  );
  if (!drain.drained) p.log.warn(formatRefusedDrain('learning', drain.linkedFolder));
}

/**
 * `--enable` / `--disable`: the machine-wide switch (D-FEATURES-NARROW-ONLY),
 * converged exactly as `devflow init --learning / --no-learning` converges it —
 * the manifest value, and on disable a drained queue in the current project.
 * Never requires a git root: the switch is not a per-project setting.
 */
async function handleToggle(enabled: boolean): Promise<void> {
  const recorded = await writeMachineFeature(getDevFlowDirectory(), 'learning', enabled);
  if (!recorded.ok) {
    p.log.error(`Devflow is not installed on this machine — run ${color.cyan('devflow init')} first`);
    process.exitCode = 1;
    return;
  }

  if (enabled) {
    p.log.success('Learning enabled in every project (a repository can opt out)');
    p.log.info(color.dim('Architectural decisions and pitfalls will be detected from your sessions'));
    return;
  }

  // Drain the current project's learning (decisions-detection) queue so stale
  // turns don't process on re-enable. A mid-run Learning agent whose claimed
  // batch vanishes aborts without changes — the desired outcome of disabling.
  const ledgerRoot = await getLedgerRoot();
  if (ledgerRoot) {
    const drain = await drainLearningQueue(ledgerRoot);
    if (!drain.drained) p.log.warn(formatRefusedDrain('learning', drain.linkedFolder));
  }
  p.log.success('Learning disabled in every project');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

interface LearningOptions {
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

export const learningCommand = new Command('learning')
  .description('Enable or disable learning (decision/pitfall detection) in every project')
  .option('--enable', 'Enable learning in every project (a repository can opt out)')
  .option('--disable', 'Disable learning in every project')
  .option('--status', 'Show learning status and entry counts')
  .option('--list', 'List entries, inactive entries with their notes, and observations')
  .option('--show <id>', 'Print one entry (ADR-NNN or PF-NNN) or observation (obs_...) as JSON')
  .option('--restore <id>', 'Make an inactive entry active again')
  .option('--configure', 'Interactive configuration wizard for learning.json')
  .option('--clear', 'Drop the observations no entry uses, and drain the learning queue')
  .option('--reset', 'Remove all learning state files and artifacts')
  .action(async (options: LearningOptions) => {
    const knownFlags: (keyof LearningOptions)[] = [
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
