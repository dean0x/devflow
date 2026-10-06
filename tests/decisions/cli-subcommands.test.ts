/**
 * `devflow learning` on the v2 learning store (D-LEARNING-STORE-SEAM).
 *
 * --status, --list and --show read the ledger and the log through the store and
 * write nothing. --restore makes an inactive entry active again through the
 * store's restoreAnchor. --clear drops only the observations no entry uses, under
 * the learning lock, and drains the queue only once that clear succeeded
 * (D-CLEAR-UNREFERENCED). --reset removes the whole learning directory through
 * the store's resetLearning, under the same lock and wait (D-RESET-UNDER-LOCK),
 * and creates nothing where there is none. --disable keeps its drain.
 *
 * Each case seeds a real learning tree under a temp root that getLedgerRoot is
 * mocked to resolve; only the prompts, the tuning config and the machine devflow
 * directory are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mocks — all set up before any imports from the module under test.
// ---------------------------------------------------------------------------

vi.mock('../../src/core/learning-tuning-config.js', () => ({
  loadLearningTuningConfig: vi.fn(() => ({
    model: 'opus',
    debug: false,
  })),
}));

vi.mock('../../src/targets/claude-code/claude-paths.js', () => ({
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

vi.mock('../../src/core/ledger-root.js', () => ({
  getLedgerRoot: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
  note: vi.fn(),
  confirm: vi.fn(async () => false),
  select: vi.fn(async () => 'cancel'),
  multiselect: vi.fn(async () => []),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  text: vi.fn(async () => '3'),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------
import { getLedgerRoot } from '../../src/core/ledger-root.js';
import { getDevFlowDirectory } from '../../src/targets/claude-code/claude-paths.js';
import { learningCommand } from '../../src/cli/commands/learning.js';
import * as p from '@clack/prompts';
import {
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
  getLearningClaimOwnerPath,
  getPendingTurnsPath,
} from '../../src/core/project-paths.js';
import {
  learningPaths,
  makeV1LedgerRow,
  makeV1LogRow,
  makeV2LedgerRow,
  makeV2LogRow,
  requireLearningStore,
  seedLearningTree,
  snapshotTree,
  toJsonl,
  type LearningTreePaths,
  type Row,
} from './learning-fixtures.js';

const store = requireLearningStore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'learning-cli-test-')));
}

/** What one `devflow learning …` run printed, by channel, and the exit code it set. */
interface LearningRun {
  stdout: string;
  info: string;
  success: string;
  warn: string;
  error: string;
  exitCode: number | string | null | undefined;
}

/** The messages a mocked clack log function received, one per line. */
function logged(fn: (message: string) => void): string {
  return vi.mocked(fn).mock.calls.map(call => String(call[0])).join('\n');
}

/**
 * Run `devflow learning <args…>` once, as a fresh process would: Commander keeps
 * option values across parseAsync() calls on one instance, so they are cleared
 * first. stdout is captured; the clack log calls are read from their mocks.
 */
async function runLearning(args: readonly string[]): Promise<LearningRun> {
  (learningCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  for (const fn of [p.log.info, p.log.success, p.log.warn, p.log.error]) vi.mocked(fn).mockClear();
  let stdout = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  });
  try {
    await learningCommand.parseAsync([...args], { from: 'user' });
  } finally {
    spy.mockRestore();
  }
  return {
    stdout,
    info: logged(p.log.info),
    success: logged(p.log.success),
    warn: logged(p.log.warn),
    error: logged(p.log.error),
    exitCode: process.exitCode,
  };
}

/**
 * A learning tree with every kind of row the listing tells apart:
 *   ADR-001  an active v2 decision
 *   PF-001   an active v1 pitfall, and PF-002 its twin carrying the same
 *            observation with details its log row lacks
 *   PF-003   a v1 pitfall retired with a note
 * plus one v2 observation no entry carries yet.
 */
const LOG: readonly Row[] = [
  makeV2LogRow({ id: 'obs_cli_decision' }),
  makeV1LogRow({ id: 'obs_cli_pitfall' }),
  makeV1LogRow({ id: 'obs_cli_retired', pattern: 'A pitfall seen once' }),
  makeV2LogRow({ id: 'obs_cli_waiting', title: 'An observation waiting for promotion' }),
];
const LEDGER: readonly Row[] = [
  makeV2LedgerRow({ id: 'obs_cli_decision', anchor_id: 'ADR-001' }),
  makeV1LedgerRow({ id: 'obs_cli_pitfall', anchor_id: 'PF-001' }),
  makeV1LedgerRow({ id: 'obs_cli_pitfall', anchor_id: 'PF-002', details: 'area: hooks; issue: a detail only this ledger row holds' }),
  makeV1LedgerRow({
    id: 'obs_cli_retired', anchor_id: 'PF-003', pattern: 'A pitfall seen once',
    decisions_status: 'Retired', status_note: 'a one-off', retired_on: '2026-09-20',
  }),
];

function seedCorpus(root: string): LearningTreePaths {
  return seedLearningTree(root, { log: LOG, ledger: LEDGER });
}

function seedQueue(root: string): void {
  fs.writeFileSync(getLearningPendingTurnsPath(root), '{"role":"user"}\n');
  fs.writeFileSync(getLearningPendingTurnsProcessingPath(root), '{"role":"user"}\n');
  fs.writeFileSync(getLearningClaimOwnerPath(root), '0123456789abcdef\n');
}

function queueFilesPresent(root: string): boolean[] {
  return [getLearningPendingTurnsPath(root), getLearningPendingTurnsProcessingPath(root), getLearningClaimOwnerPath(root)]
    .map(file => fs.existsSync(file));
}

/** A scratch devflow root with an installed manifest — never the real one. */
function makeMachineDevflowDir(): string {
  const devflowDir = makeTmpDir();
  fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify({
    version: '2.0.0', plugins: [], scope: 'user', features: { ambient: true, memory: true, learning: true },
    installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  return devflowDir;
}

let root: string;
let devflowDir: string;

beforeEach(() => {
  root = makeTmpDir();
  devflowDir = makeMachineDevflowDir();
  vi.mocked(getDevFlowDirectory).mockReturnValue(devflowDir);
  vi.mocked(getLedgerRoot).mockResolvedValue(root);
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
  vi.mocked(getDevFlowDirectory).mockReturnValue('/home/user/.devflow');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(devflowDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Usage and dispatch
// ---------------------------------------------------------------------------

describe('learning: usage and dispatch', () => {
  it('prints the usage, naming every flag, when no flag is given', async () => {
    vi.mocked(p.note).mockClear();
    await runLearning([]);
    const usage = vi.mocked(p.note).mock.calls.map(call => String(call[0])).join('\n');
    for (const flag of ['--enable', '--disable', '--status', '--list', '--show <id>', '--restore <id>', '--configure', '--clear', '--reset']) {
      expect(usage, flag).toContain(`devflow learning ${flag}`);
    }
  });

  it('a flag that takes a value dispatches on the value alone', async () => {
    seedCorpus(root);
    vi.mocked(p.note).mockClear();
    const run = await runLearning(['--show', 'ADR-001']);
    expect(p.note).not.toHaveBeenCalled();
    expect(JSON.parse(run.stdout).key).toBe('ADR-001');
  });
});

// ---------------------------------------------------------------------------
// --status
// ---------------------------------------------------------------------------

describe('learning --status', { timeout: 30_000 }, () => {
  // The settings layer reads the repository files of the current directory; a
  // directory that is no repository narrows nothing, so the lines are the store's.
  beforeEach(() => { vi.spyOn(process, 'cwd').mockReturnValue(root); });

  it('counts active entries by type, inactive ones by status, legacy v1 entries and observations, and writes nothing', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runLearning(['--status']);

    expect(run.info).toBe([
      'Learning: enabled',
      'Entries: 3 active (1 decision, 2 pitfalls), 1 inactive (Retired 1)',
      'Legacy v1 entries: 2 of 3 active',
      'Observations: 4 in the log, 1 not yet promoted',
    ].join('\n'));
    expect(run.warn).toBe('');
    expect(snapshotTree(root)).toEqual(before);
  });

  it('lists each inactive status it finds, in the store\'s order', async () => {
    seedLearningTree(root, {
      ledger: [
        makeV2LedgerRow({ id: 'obs_a', anchor_id: 'ADR-001', decisions_status: 'Superseded', superseded_by: 'ADR-002' }),
        makeV2LedgerRow({ id: 'obs_b', anchor_id: 'ADR-002' }),
        makeV1LedgerRow({ id: 'obs_c', anchor_id: 'PF-001', decisions_status: 'Deprecated' }),
        makeV1LedgerRow({ id: 'obs_d', anchor_id: 'PF-002', decisions_status: 'Encoded' }),
      ],
    });
    const run = await runLearning(['--status']);
    expect(run.info).toContain('Entries: 1 active (1 decision, 0 pitfalls), 3 inactive (Encoded 1, Superseded 1, Deprecated 1)');
  });

  it('warns how many malformed lines it skipped, per file', async () => {
    const paths = seedCorpus(root);
    fs.appendFileSync(paths.ledger, '{torn ledger line\n');
    fs.appendFileSync(paths.log, 'not json\n');
    fs.appendFileSync(paths.log, '[]\n');
    const before = snapshotTree(root);

    const run = await runLearning(['--status']);

    expect(run.warn).toBe(
      'Malformed lines skipped: 1 in the ledger, 2 in the log. The next op that rewrites a file moves its malformed lines to a .rejected.jsonl file beside it.',
    );
    expect(snapshotTree(root)).toEqual(before);
  });

  it('reports zero counts for a project with no learning data, and creates nothing', async () => {
    const run = await runLearning(['--status']);
    expect(run.info).toBe([
      'Learning: enabled',
      'Entries: 0 active (0 decisions, 0 pitfalls), 0 inactive',
      'Legacy v1 entries: 0 of 0 active',
      'Observations: 0 in the log, 0 not yet promoted',
    ].join('\n'));
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('says so outside a git project', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    const run = await runLearning(['--status']);
    expect(run.info).toBe('Learning: enabled\nEntries: not in a git project');
  });
});

// ---------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------

describe('learning --list', { timeout: 30_000 }, () => {
  it('prints the entries, the inactive entries with their notes, the observations and the integrity flags, and writes nothing', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runLearning(['--list']);

    expect(run.stdout).toBe([
      'ACTIVE 3',
      '  ADR-001 obs_cli_decision v2 verified 2026-09-01 observed 1 last-seen 2026-09-01T00:00:00.000Z scope area:learning Store functions return a Result',
      '  PF-001 obs_cli_pitfall v1 verified never observed 2 last-seen 2026-07-01T00:00:00.000Z scope - Editing installed hook scripts instead of their source',
      '  PF-002 obs_cli_pitfall v1 verified never observed 2 last-seen 2026-07-01T00:00:00.000Z scope - Editing installed hook scripts instead of their source',
      'INACTIVE 1',
      '  PF-003 obs_cli_retired v1 Retired A pitfall seen once',
      '    note: a one-off',
      'OBSERVATIONS 1',
      '  obs_cli_waiting decision v2 observed 1 An observation waiting for promotion',
      'INTEGRITY 2',
      '  PF-001 obs_cli_pitfall duplicate-obs-id',
      '  PF-002 obs_cli_pitfall duplicate-obs-id',
      '',
    ].join('\n'));
    expect(run.exitCode).toBe(0);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('says there is no learning data when the project has no learning directory, and creates nothing', async () => {
    const run = await runLearning(['--list']);
    expect(run.info).toBe('No learning data in this project yet.');
    expect(run.stdout).toBe('');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('reads the ledger root getLedgerRoot resolves, not process.cwd() (a subdirectory or a linked worktree)', async () => {
    seedCorpus(root);
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');
    const run = await runLearning(['--list']);
    expect(run.stdout).toContain('ACTIVE 3');
  });

  it('falls back to process.cwd() outside a git project', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    seedCorpus(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const run = await runLearning(['--list']);
    expect(run.stdout).toContain('OBSERVATIONS 1');
  });
});

// ---------------------------------------------------------------------------
// --show
// ---------------------------------------------------------------------------

describe('learning --show', { timeout: 30_000 }, () => {
  it('prints the entry as JSON — every ledger row carrying its observation, the log row, history and flags — and writes nothing', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runLearning(['--show', 'PF-002']);

    const shown = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(shown)).toEqual(['key', 'ledger', 'log', 'history_versions', 'flags']);
    expect(shown.key).toBe('PF-002');
    expect((shown.ledger as Row[]).map(row => row.anchor_id)).toEqual(['PF-001', 'PF-002']);
    expect(shown.log).toEqual(LOG[1]);
    expect(shown.history_versions).toEqual([]);
    expect(shown.flags).toEqual([{ anchor_id: 'PF-002', flag: 'ledger-only-content', fields: ['details'] }]);
    expect(run.exitCode).toBe(0);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('shows an observation no entry carries by its id', async () => {
    seedCorpus(root);
    const run = await runLearning(['--show', 'obs_cli_waiting']);
    const shown = JSON.parse(run.stdout) as { ledger: Row[]; log: Row };
    expect(shown.ledger).toEqual([]);
    expect(shown.log).toEqual(LOG[3]);
  });

  it('escapes the control and bidirectional characters a hand-edited row holds, and the JSON still reads back the same', async () => {
    // Built from code points so this source holds none of them: a C1 CSI, a
    // right-to-left override and its pop, and a line separator.
    const unsafe = [0x9b, 0x202e, 0x202c, 0x2028].map(code => String.fromCharCode(code));
    const [csi, rlo, pop, lineSeparator] = unsafe;
    const hostile = makeV1LedgerRow({
      id: 'obs_cli_pitfall', anchor_id: 'PF-001',
      details: `area: x; issue: csi${csi}2J and ${rlo}reversed${pop} text; resolution:${lineSeparator}next`,
    });
    seedLearningTree(root, { log: [LOG[1]], ledger: [hostile] });

    const run = await runLearning(['--show', 'PF-001']);

    for (const ch of unsafe) expect(run.stdout.includes(ch), `U+${ch.charCodeAt(0).toString(16)}`).toBe(false);
    expect((JSON.parse(run.stdout) as { ledger: Row[] }).ledger[0]).toEqual(hostile);
  });

  it('refuses an entry the ledger and the log do not hold: exit 1, nothing printed or written', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);
    const run = await runLearning(['--show', 'PF-099']);
    expect(run.error).toBe('show: no entry \'PF-099\' in the ledger or the log');
    expect(run.stdout).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses a value that is neither an entry id nor an observation id', async () => {
    seedCorpus(root);
    const run = await runLearning(['--show', 'not an id']);
    expect(run.error).toBe('show: "not an id" is neither an anchor id nor an observation id');
    expect(run.exitCode).toBe(1);
  });

  it('refuses in a project with no learning directory, and creates nothing', async () => {
    const run = await runLearning(['--show', 'ADR-001']);
    expect(run.error).toBe('No learning data in this project yet.');
    expect(run.exitCode).toBe(1);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// --restore
// ---------------------------------------------------------------------------

describe('learning --restore', { timeout: 30_000 }, () => {
  it('makes an inactive entry active again, its notes cleared, and renders it', async () => {
    const paths = seedCorpus(root);

    const run = await runLearning(['--restore', 'PF-003']);

    expect(run.success).toBe('Restored PF-003 (Active); it is due for review again.');
    expect(run.exitCode).toBe(0);
    const restored = store.readJsonl(paths.ledger).rows.find(row => row.anchor_id === 'PF-003');
    expect(restored?.decisions_status).toBe('Active');
    expect(restored).not.toHaveProperty('status_note');
    expect(restored).not.toHaveProperty('retired_on');
    expect(fs.readFileSync(path.join(paths.learningDir, 'pitfalls.md'), 'utf8')).toContain('## PF-003: A pitfall seen once');
  });

  it('refuses an entry that is already active: exit 1, nothing written', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);
    const run = await runLearning(['--restore', 'ADR-001']);
    expect(run.error).toBe('restore-anchor: ADR-001 is already active; nothing was written');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses a value that is not an entry id: exit 1, nothing written', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);
    const run = await runLearning(['--restore', 'obs_cli_retired']);
    expect(run.error).toBe('--restore takes an entry id (ADR-NNN or PF-NNN), not "obs_cli_retired"');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses in a project with no learning directory, and creates nothing', async () => {
    const run = await runLearning(['--restore', 'PF-003']);
    expect(run.error).toBe('No learning data in this project yet.');
    expect(run.exitCode).toBe(1);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('refuses outside a git project', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    const run = await runLearning(['--restore', 'PF-003']);
    expect(run.warn).toBe('Could not resolve git root — restore not performed');
    expect(run.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// --clear (D-CLEAR-UNREFERENCED)
// ---------------------------------------------------------------------------

describe('learning --clear', { timeout: 30_000 }, () => {
  it('drops only the observations no entry uses, keeps every entry\'s log row, then drains the queue', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    const run = await runLearning(['--clear']);

    expect(run.success).toBe('Cleared 1 observation no entry uses and kept 3 that entries use; drained the learning queue.');
    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(toJsonl(LOG.slice(0, 3)));
    expect(fs.readFileSync(paths.ledger, 'utf8')).toBe(ledgerBefore);
    expect(queueFilesPresent(root)).toEqual([false, false, false]);
  });

  it('while the learning lock is held: exit 1 within the CLI\'s wait, nothing written, the queue left in place', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    fs.mkdirSync(paths.lockDir);
    const before = snapshotTree(root);

    const started = Date.now();
    const run = await runLearning(['--clear']);

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(run.error).toBe('The learning store is busy: another run holds its lock. Nothing was cleared; try again in a moment.');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
  });

  it('refuses while the ledger holds a malformed line: exit 1, nothing written, the queue left in place', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    fs.appendFileSync(paths.ledger, '{torn ledger line\n');
    const before = snapshotTree(root);

    const run = await runLearning(['--clear']);

    expect(run.error).toBe('clear: the ledger has 1 malformed line, which may carry an observation this would drop; nothing was cleared');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('says there is nothing to clear in a project with no learning directory, and creates nothing', async () => {
    const run = await runLearning(['--clear']);
    expect(run.info).toBe('No learning data to clear.');
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('acts on the resolved ledger root, never process.cwd()', async () => {
    const paths = seedCorpus(root);
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');
    await runLearning(['--clear']);
    expect(store.readJsonl(paths.log).rows.map(row => row.id)).toEqual(['obs_cli_decision', 'obs_cli_pitfall', 'obs_cli_retired']);
  });
});

// ---------------------------------------------------------------------------
// --reset: the whole learning directory, under the learning lock
// (D-ONE-LEARNING-LOCK, D-NO-STRAY-TREE, D-RESET-UNDER-LOCK)
// ---------------------------------------------------------------------------

describe('learning --reset', { timeout: 30_000 }, () => {
  it('removes .devflow/learning/ — entries, observations, the queue and its claim — and leaves the rest of .devflow/ alone', async () => {
    seedCorpus(root);
    seedQueue(root);
    fs.writeFileSync(path.join(root, '.devflow', 'config.json'), '{"features":{}}\n');
    fs.mkdirSync(path.join(root, '.devflow', 'memory'));
    fs.writeFileSync(getPendingTurnsPath(root), '{"role":"user"}\n');

    const run = await runLearning(['--reset']);

    expect(run.success).toBe('Reset complete — removed .devflow/learning/ state.');
    expect(run.exitCode).toBe(0);
    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(fs.existsSync(learningPaths(root).learningDir)).toBe(false);
    expect(fs.readFileSync(path.join(root, '.devflow', 'config.json'), 'utf8')).toBe('{"features":{}}\n');
    expect(fs.existsSync(getPendingTurnsPath(root))).toBe(true);
  });

  it('breaks a learning lock a crashed run left behind, then resets', async () => {
    const paths = seedCorpus(root);
    fs.mkdirSync(paths.lockDir);
    const abandoned = new Date(Date.now() - store.LOCK_STALE_MS - 60_000);
    fs.utimesSync(paths.lockDir, abandoned, abandoned);

    const run = await runLearning(['--reset']);

    expect(run.error).toBe('');
    expect(run.success).toBe('Reset complete — removed .devflow/learning/ state.');
    expect(run.exitCode).toBe(0);
    expect(fs.existsSync(paths.learningDir)).toBe(false);
  });

  it('while another run holds the learning lock: exit 1 within the CLI\'s wait, nothing written', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    fs.mkdirSync(paths.lockDir);
    const before = snapshotTree(root);

    const started = Date.now();
    const run = await runLearning(['--reset']);

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(run.error).toBe('The learning store is busy: another run holds its lock. Nothing was reset; try again in a moment.');
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('when .devflow/learning is a symbolic link: exit 1, and nothing the link leads to is removed', async () => {
    const { learningDir } = learningPaths(root);
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'notes.txt'), 'kept\n');
    fs.writeFileSync(path.join(elsewhere, 'sub', 'deep.txt'), 'kept\n');
    fs.mkdirSync(path.join(root, '.devflow'));
    fs.symlinkSync(elsewhere, learningDir);
    const before = snapshotTree(elsewhere);

    const run = await runLearning(['--reset']);

    expect(run.error).toBe(`reset: ${learningDir} is a symbolic link, not a directory; nothing was removed`);
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(elsewhere)).toEqual(before);
  });

  it('in a project that never had learning data: says so, exits 0 and creates nothing, neither .devflow/ nor .devflow/learning/', async () => {
    const run = await runLearning(['--reset']);

    expect(run.info).toBe('No learning data to reset.');
    expect(run.success).toBe('');
    expect(run.error).toBe('');
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('a second reset finds nothing to reset: no contention error, and nothing created under .devflow/', async () => {
    seedCorpus(root);
    await runLearning(['--reset']);

    const run = await runLearning(['--reset']);

    expect(run.error).toBe('');
    expect(run.info).toBe('No learning data to reset.');
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(path.join(root, '.devflow'))).toEqual([]);
  });

  it('outside a git project: warns, exits 0 and touches nothing', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runLearning(['--reset']);

    expect(run.warn).toBe('Could not resolve git root — reset not performed');
    expect(run.exitCode).toBe(0);
    expect(snapshotTree(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// --disable switches learning off machine-wide (D-FEATURES-NARROW-ONLY) and
// drains the current project's learning queue — a mid-run Learning agent whose
// claimed batch vanishes stops, which is the desired outcome of disabling.
// ---------------------------------------------------------------------------

describe('learning --disable drains the learning pending-turns queue', () => {
  /** The machine-wide switch, as the command left it. */
  function readLearningSwitch(): unknown {
    return (JSON.parse(fs.readFileSync(path.join(devflowDir, 'manifest.json'), 'utf-8')) as {
      features: Record<string, unknown>;
    }).features.learning;
  }

  beforeEach(() => {
    fs.mkdirSync(path.join(root, '.devflow', 'learning'), { recursive: true });
    seedQueue(root);
  });

  it('deletes the queue, the claim and its owner file, and switches learning off machine-wide (memory queue untouched)', async () => {
    fs.mkdirSync(path.join(root, '.devflow', 'memory'), { recursive: true });
    fs.writeFileSync(getPendingTurnsPath(root), '{"role":"user"}\n');

    await runLearning(['--disable']);

    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(readLearningSwitch()).toBe(false);
    // The retired per-repo key is never written.
    expect(fs.existsSync(path.join(root, '.devflow', 'config.json'))).toBe(false);
    expect(fs.existsSync(getPendingTurnsPath(root))).toBe(true);
  });

  it('does not create a .disabled sentinel (the gate is the manifest)', async () => {
    await runLearning(['--disable']);
    expect(fs.existsSync(path.join(root, '.devflow', 'learning', '.disabled'))).toBe(false);
  });

  it('drains unconditionally — a leftover .worker.lock dir from an old install does not block it', async () => {
    fs.mkdirSync(path.join(root, '.devflow', 'dream', '.worker.lock'), { recursive: true });
    await runLearning(['--disable']);
    expect(queueFilesPresent(root).slice(0, 2)).toEqual([false, false]);
    expect(readLearningSwitch()).toBe(false);
  });

  it('does not delete anything on --enable', async () => {
    await runLearning(['--enable']);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
    expect(readLearningSwitch()).toBe(true);
  });

  it('switches learning off outside a git project too (the switch is not per-project)', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    await runLearning(['--disable']);
    expect(readLearningSwitch()).toBe(false);
  });

  it('drains the resolved git-root paths, not process.cwd()', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');
    await runLearning(['--disable']);
    expect(queueFilesPresent(root).slice(0, 2)).toEqual([false, false]);
  });
});

// ---------------------------------------------------------------------------
// `devflow decisions` is not a registered command: the surface is `learning`.
// ---------------------------------------------------------------------------

describe('devflow decisions is no longer a registered subcommand', () => {
  it('learningCommand is registered under the "learning" name, not "decisions"', () => {
    expect(learningCommand.name()).toBe('learning');
  });

  it('learningCommand does not carry "decisions" as an alias', () => {
    expect(learningCommand.aliases()).not.toContain('decisions');
  });
});
