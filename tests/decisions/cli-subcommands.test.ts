/**
 * `devflow curation` on the v2 curation store (D-LEARNING-STORE-SEAM).
 *
 * --status, --list and --show read the ledger and the log through the store and
 * write nothing. --restore makes an inactive entry active again through the
 * store's restoreAnchor. --clear drops only the observations no entry uses, under
 * the curation lock, and drains the queue only once that clear succeeded
 * (D-CLEAR-UNREFERENCED). --reset removes the whole curation directory through
 * the store's resetCuration, under the same lock and wait (D-RESET-UNDER-LOCK),
 * and creates nothing where there is none. --disable keeps its drain.
 *
 * Each case seeds a real curation tree under a temp root that getLedgerRoot is
 * mocked to resolve; only the prompts, the tuning config and the machine devflow
 * directory are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

// ---------------------------------------------------------------------------
// Mocks — all set up before any imports from the module under test.
// ---------------------------------------------------------------------------

vi.mock('../../src/core/curate-tuning-config.js', () => ({
  loadCurateTuningConfig: vi.fn(() => ({
    model: 'opus',
    debug: false,
  })),
}));

vi.mock('../../src/targets/claude-code/claude-paths.js', () => ({
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

vi.mock('../../src/core/ledger-root.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/ledger-root.js')>()),
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
import { curationCommand } from '../../src/cli/commands/curation.js';
import * as p from '@clack/prompts';
import { getCurationMoveMarkerPath } from '../../src/core/curation-move-notice.js';
import { MOVE_SKIP_NOTICE } from '../../src/core/curation-move-skip.js';
import { AREA_PAUSE_NOTICE } from '../../src/core/area-pause-notice.js';
import {
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
  getCurationClaimOwnerPath,
  getPendingTurnsPath,
} from '../../src/core/project-paths.js';
import {
  curationPaths,
  git,
  initGitRepo,
  makeV1LedgerRow,
  makeV1LogRow,
  makeV2LedgerRow,
  makeV2LogRow,
  PROJECT_PATHS,
  pathWithFailingGit,
  requireCurationStore,
  seedCurationTree,
  snapshotTree,
  toJsonl,
  trackInGit,
  type CurationTreePaths,
  type Row,
} from './curation-fixtures.js';

const store = requireCurationStore();
const { curationMoveLockKey } = createRequire(import.meta.url)(PROJECT_PATHS) as { curationMoveLockKey(realRoot: string): string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'curation-cli-test-')));
}

/** What one `devflow curation …` run printed, by channel, and the exit code it set. */
interface CurationRun {
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
 * Run `devflow curation <args…>` once, as a fresh process would: Commander keeps
 * option values across parseAsync() calls on one instance, so they are cleared
 * first. stdout is captured; the clack log calls are read from their mocks.
 */
async function runCuration(args: readonly string[]): Promise<CurationRun> {
  (curationCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  for (const fn of [p.log.info, p.log.success, p.log.warn, p.log.error]) vi.mocked(fn).mockClear();
  let stdout = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  });
  try {
    await curationCommand.parseAsync([...args], { from: 'user' });
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
 * A curation tree with every kind of row the listing tells apart:
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

function seedCorpus(root: string): CurationTreePaths {
  return seedCurationTree(root, { log: LOG, ledger: LEDGER });
}

function seedQueue(root: string): void {
  fs.writeFileSync(getCurationPendingTurnsPath(root), '{"role":"user"}\n');
  fs.writeFileSync(getCurationPendingTurnsProcessingPath(root), '{"role":"user"}\n');
  fs.writeFileSync(getCurationClaimOwnerPath(root), '0123456789abcdef\n');
}

function queueFilesPresent(root: string): boolean[] {
  return [getCurationPendingTurnsPath(root), getCurationPendingTurnsProcessingPath(root), getCurationClaimOwnerPath(root)]
    .map(file => fs.existsSync(file));
}

const BACKUP_NAME = 'learning.backup-20261017T020304Z-ab12cd34';
const BACKUP_PENDING = [
  '.pending-turns.jsonl',
  '.pending-turns.processing',
  '.pending-turns.jsonl.merging-20261017T020304Z-00000001',
  '.pending-turns.jsonl.overflow-20261017T020304Z-00000002',
] as const;

/** A backup folder a move left, with its pending-row files and a ledger file. */
function seedBackup(dir: string): string {
  const backup = path.join(dir, '.devflow', BACKUP_NAME);
  fs.mkdirSync(backup, { recursive: true });
  for (const file of BACKUP_PENDING) fs.writeFileSync(path.join(backup, file), '{"role":"user"}\n');
  fs.writeFileSync(path.join(backup, 'decisions-ledger.jsonl'), toJsonl(LEDGER));
  return backup;
}

function backupPendingPresent(backup: string): boolean[] {
  return BACKUP_PENDING.map(file => fs.existsSync(path.join(backup, file)));
}

/** The version of the package under test: a manifest that records it is not skewed against this CLI. */
const RUNNING_VERSION = (JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf-8'),
) as { version: string }).version;

/**
 * A scratch devflow root with an installed manifest — never the real one. The version
 * defaults to one that differs from the running package (a skewed install); a test that
 * needs matching installed scripts passes RUNNING_VERSION.
 */
function makeMachineDevflowDir(version = '2.0.0'): string {
  const devflowDir = makeTmpDir();
  fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify({
    version, plugins: [], scope: 'user', features: { ambient: true, memory: true, curation: true, learning: true },
    installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  return devflowDir;
}

/** The two keys the curation switch is stored under, as the command left them. */
function readSwitchKeys(dir: string): { curation: unknown; learning: unknown } {
  const features = (JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as {
    features: Record<string, unknown>;
  }).features;
  return { curation: features.curation, learning: features.learning };
}

/**
 * Seed a pre-rename ledger folder (`.devflow/learning/`): a ledger, a log and the pending
 * queue. With `claimed` it also holds a Curate run's claim (the processing batch and its
 * owner file); a fresh claim makes the move busy, so a test that moves leaves it out.
 */
function seedOldFolder(dir: string, claimed = false): string {
  const old = path.join(dir, '.devflow', 'learning');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'decisions-ledger.jsonl'), toJsonl(LEDGER));
  fs.writeFileSync(path.join(old, 'decisions-log.jsonl'), toJsonl(LOG));
  fs.writeFileSync(path.join(old, '.pending-turns.jsonl'), '{"role":"user"}\n');
  if (claimed) {
    fs.writeFileSync(path.join(old, '.pending-turns.processing'), '{"role":"user"}\n');
    fs.writeFileSync(path.join(old, '.pending-turns.owner'), '0123456789abcdef\n');
  }
  return old;
}

/** Hold the move lock of `dir` as another mover would, under the machine directory. */
function holdMoveLock(machineDir: string, dir: string): string {
  const lock = path.join(machineDir, `.curation-move-${curationMoveLockKey(fs.realpathSync(dir))}.lock`);
  fs.mkdirSync(lock);
  return lock;
}

let root: string;
let devflowDir: string;

/** Re-install the scratch machine directory with a manifest that records the running version: matching scripts, no skew. */
function useMatchingInstall(): void {
  fs.rmSync(devflowDir, { recursive: true, force: true });
  devflowDir = makeMachineDevflowDir(RUNNING_VERSION);
  vi.mocked(getDevFlowDirectory).mockReturnValue(devflowDir);
}

beforeEach(() => {
  root = makeTmpDir();
  devflowDir = makeMachineDevflowDir();
  vi.mocked(getDevFlowDirectory).mockReturnValue(devflowDir);
  vi.mocked(getLedgerRoot).mockResolvedValue(root);
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
  vi.unstubAllEnvs();
  vi.mocked(getDevFlowDirectory).mockReturnValue('/home/user/.devflow');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(devflowDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Usage and dispatch
// ---------------------------------------------------------------------------

describe('curation: usage and dispatch', () => {
  it('prints the usage, naming every flag, when no flag is given', async () => {
    vi.mocked(p.note).mockClear();
    await runCuration([]);
    const usage = vi.mocked(p.note).mock.calls.map(call => String(call[0])).join('\n');
    for (const flag of ['--enable', '--disable', '--status', '--list', '--show <id>', '--restore <id>', '--configure', '--clear', '--reset']) {
      expect(usage, flag).toContain(`devflow curation ${flag}`);
    }
  });

  it('a flag that takes a value dispatches on the value alone', async () => {
    seedCorpus(root);
    vi.mocked(p.note).mockClear();
    const run = await runCuration(['--show', 'ADR-001']);
    expect(p.note).not.toHaveBeenCalled();
    expect(JSON.parse(run.stdout).key).toBe('ADR-001');
  });
});

// ---------------------------------------------------------------------------
// --status
// ---------------------------------------------------------------------------

describe('curation --status', { timeout: 30_000 }, () => {
  // The settings layer reads the repository files of the current directory; a
  // directory that is no repository narrows nothing, so the lines are the store's.
  beforeEach(() => { vi.spyOn(process, 'cwd').mockReturnValue(root); });

  it('counts active entries by type, inactive ones by status, legacy v1 entries and observations, and writes nothing', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runCuration(['--status']);

    expect(run.info).toBe([
      'Curation: enabled',
      'Entries: 3 active (1 decision, 2 pitfalls), 1 inactive (Retired 1)',
      'Legacy v1 entries: 2 of 3 active',
      'Observations: 4 in the log, 1 not yet promoted',
    ].join('\n'));
    expect(run.warn).toBe('');
    expect(snapshotTree(root)).toEqual(before);
  });

  it('lists each inactive status it finds, in the store\'s order', async () => {
    seedCurationTree(root, {
      ledger: [
        makeV2LedgerRow({ id: 'obs_a', anchor_id: 'ADR-001', decisions_status: 'Superseded', superseded_by: 'ADR-002' }),
        makeV2LedgerRow({ id: 'obs_b', anchor_id: 'ADR-002' }),
        makeV1LedgerRow({ id: 'obs_c', anchor_id: 'PF-001', decisions_status: 'Deprecated' }),
        makeV1LedgerRow({ id: 'obs_d', anchor_id: 'PF-002', decisions_status: 'Encoded' }),
      ],
    });
    const run = await runCuration(['--status']);
    expect(run.info).toContain('Entries: 1 active (1 decision, 0 pitfalls), 3 inactive (Encoded 1, Superseded 1, Deprecated 1)');
  });

  it('warns how many malformed lines it skipped, per file', async () => {
    const paths = seedCorpus(root);
    fs.appendFileSync(paths.ledger, '{torn ledger line\n');
    fs.appendFileSync(paths.log, 'not json\n');
    fs.appendFileSync(paths.log, '[]\n');
    const before = snapshotTree(root);

    const run = await runCuration(['--status']);

    expect(run.warn).toBe(
      'Malformed lines skipped: 1 in the ledger, 2 in the log. The next op that rewrites a file moves its malformed lines to a .rejected.jsonl file beside it.',
    );
    expect(snapshotTree(root)).toEqual(before);
  });

  it('reports zero counts for a project with no curation data, and creates nothing', async () => {
    const run = await runCuration(['--status']);
    expect(run.info).toBe([
      'Curation: enabled',
      'Entries: 0 active (0 decisions, 0 pitfalls), 0 inactive',
      'Legacy v1 entries: 0 of 0 active',
      'Observations: 0 in the log, 0 not yet promoted',
    ].join('\n'));
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('says so outside a git project', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    const run = await runCuration(['--status']);
    expect(run.info).toBe('Curation: enabled\nEntries: not in a git project');
  });
});

// ---------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------

describe('curation --list', { timeout: 30_000 }, () => {
  it('prints the entries, the inactive entries with their notes, the observations and the integrity flags, and writes nothing', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runCuration(['--list']);

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

  it('says there is no curation data when the project has no curation directory, and creates nothing', async () => {
    const run = await runCuration(['--list']);
    expect(run.info).toBe('No curation data in this project yet.');
    expect(run.stdout).toBe('');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('reads the ledger root getLedgerRoot resolves, not process.cwd() (a subdirectory or a linked worktree)', async () => {
    seedCorpus(root);
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');
    const run = await runCuration(['--list']);
    expect(run.stdout).toContain('ACTIVE 3');
  });

  it('falls back to process.cwd() outside a git project', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    seedCorpus(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const run = await runCuration(['--list']);
    expect(run.stdout).toContain('OBSERVATIONS 1');
  });
});

// ---------------------------------------------------------------------------
// --show
// ---------------------------------------------------------------------------

describe('curation --show', { timeout: 30_000 }, () => {
  it('prints the entry as JSON — every ledger row carrying its observation, the log row, history and flags — and writes nothing', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runCuration(['--show', 'PF-002']);

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
    const run = await runCuration(['--show', 'obs_cli_waiting']);
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
    seedCurationTree(root, { log: [LOG[1]], ledger: [hostile] });

    const run = await runCuration(['--show', 'PF-001']);

    for (const ch of unsafe) expect(run.stdout.includes(ch), `U+${ch.charCodeAt(0).toString(16)}`).toBe(false);
    expect((JSON.parse(run.stdout) as { ledger: Row[] }).ledger[0]).toEqual(hostile);
  });

  it('refuses an entry the ledger and the log do not hold: exit 1, nothing printed or written', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);
    const run = await runCuration(['--show', 'PF-099']);
    expect(run.error).toBe('show: no entry \'PF-099\' in the ledger or the log');
    expect(run.stdout).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses a value that is neither an entry id nor an observation id', async () => {
    seedCorpus(root);
    const run = await runCuration(['--show', 'not an id']);
    expect(run.error).toBe('show: "not an id" is neither an anchor id nor an observation id');
    expect(run.exitCode).toBe(1);
  });

  it('refuses in a project with no curation directory, and creates nothing', async () => {
    const run = await runCuration(['--show', 'ADR-001']);
    expect(run.error).toBe('No curation data in this project yet.');
    expect(run.exitCode).toBe(1);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// --restore
// ---------------------------------------------------------------------------

describe('curation --restore', { timeout: 30_000 }, () => {
  beforeEach(useMatchingInstall);

  it('makes an inactive entry active again, its notes cleared, and renders it', async () => {
    const paths = seedCorpus(root);

    const run = await runCuration(['--restore', 'PF-003']);

    expect(run.success).toBe('Restored PF-003 (Active); it is due for review again.');
    expect(run.exitCode).toBe(0);
    const restored = store.readJsonl(paths.ledger).rows.find(row => row.anchor_id === 'PF-003');
    expect(restored?.decisions_status).toBe('Active');
    expect(restored).not.toHaveProperty('status_note');
    expect(restored).not.toHaveProperty('retired_on');
    expect(fs.readFileSync(path.join(paths.curationDir, 'pitfalls.md'), 'utf8')).toContain('## PF-003: A pitfall seen once');
  });

  it('refuses an entry that is already active: exit 1, nothing written', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);
    const run = await runCuration(['--restore', 'ADR-001']);
    expect(run.error).toBe('restore-anchor: ADR-001 is already active; nothing was written');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses a value that is not an entry id: exit 1, nothing written', async () => {
    seedCorpus(root);
    const before = snapshotTree(root);
    const run = await runCuration(['--restore', 'obs_cli_retired']);
    expect(run.error).toBe('--restore takes an entry id (ADR-NNN or PF-NNN), not "obs_cli_retired"');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses in a project with no curation directory, and creates nothing', async () => {
    const run = await runCuration(['--restore', 'PF-003']);
    expect(run.error).toBe('No curation data in this project yet.');
    expect(run.exitCode).toBe(1);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('refuses outside a git project', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    const run = await runCuration(['--restore', 'PF-003']);
    expect(run.warn).toBe('Could not resolve git root — restore not performed');
    expect(run.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// --clear (D-CLEAR-UNREFERENCED)
// ---------------------------------------------------------------------------

describe('curation --clear', { timeout: 30_000 }, () => {
  beforeEach(useMatchingInstall);

  it('drops only the observations no entry uses, keeps every entry\'s log row, then drains the queue', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    const run = await runCuration(['--clear']);

    expect(run.success).toBe('Cleared 1 observation no entry uses and kept 3 that entries use; drained the curation queue.');
    expect(run.exitCode).toBe(0);
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(toJsonl(LOG.slice(0, 3)));
    expect(fs.readFileSync(paths.ledger, 'utf8')).toBe(ledgerBefore);
    expect(queueFilesPresent(root)).toEqual([false, false, false]);
  });

  it('leaves the backups a move left as they are: a clear never deletes backup rows', async () => {
    seedCorpus(root);
    seedQueue(root);
    const backup = seedBackup(root);

    await runCuration(['--clear']);

    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(backupPendingPresent(backup)).toEqual([true, true, true, true]);
  });

  it('refuses and changes nothing, queue and backups included, when git tracks a file of the data folder', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    const backup = seedBackup(root);
    trackInGit(root, '.devflow/curation/.pending-turns.jsonl');
    const before = { log: fs.readFileSync(paths.log, 'utf8'), ledger: fs.readFileSync(paths.ledger, 'utf8') };

    const run = await runCuration(['--clear']);

    expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.tracked);
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(before.log);
    expect(fs.readFileSync(paths.ledger, 'utf8')).toBe(before.ledger);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
    expect(backupPendingPresent(backup)).toEqual([true, true, true, true]);
  });

  it('refuses and keeps the queue when git tracks a file of a backup folder', async () => {
    seedCorpus(root);
    seedQueue(root);
    const backup = seedBackup(root);
    trackInGit(root, `.devflow/${BACKUP_NAME}/.pending-turns.jsonl`);
    const before = snapshotTree(path.join(root, '.devflow'));

    const run = await runCuration(['--clear']);

    expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.tracked);
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(path.join(root, '.devflow')), 'the log, the ledger, the queue and the backups keep their bytes').toEqual(before);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
    expect(backupPendingPresent(backup)).toEqual([true, true, true, true]);
  });

  it('refuses and keeps the queue when a .git entry stands and git does not answer', async () => {
    seedCorpus(root);
    seedQueue(root);
    initGitRepo(root);
    vi.stubEnv('PATH', pathWithFailingGit(devflowDir));
    const before = snapshotTree(path.join(root, '.devflow'));

    const run = await runCuration(['--clear']);

    expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.unknown);
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(path.join(root, '.devflow')), 'the log, the ledger and the queue keep their bytes').toEqual(before);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
  });

  it('drains the queue as before in a repository that tracks nothing in the data folders', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n' });
    seedCorpus(root);
    seedQueue(root);

    const run = await runCuration(['--clear']);

    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(run.success).toContain('drained the curation queue.');
    expect(run.warn).toBe('');
  });

  it('while the curation lock is held: exit 1 within the CLI\'s wait, nothing written, the queue left in place', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    fs.mkdirSync(paths.lockDir);
    const before = snapshotTree(root);

    const started = Date.now();
    const run = await runCuration(['--clear']);

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(run.error).toBe('The curation store is busy: another run holds its lock. Nothing was cleared; try again in a moment.');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
  });

  it('refuses while the ledger holds a malformed line: exit 1, nothing written, the queue left in place', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    fs.appendFileSync(paths.ledger, '{torn ledger line\n');
    const before = snapshotTree(root);

    const run = await runCuration(['--clear']);

    expect(run.error).toBe('clear: the ledger has 1 malformed line, which may carry an observation this would drop; nothing was cleared');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('says there is nothing to clear in a project with no curation directory, and creates nothing', async () => {
    const run = await runCuration(['--clear']);
    expect(run.info).toBe('No curation data to clear.');
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('acts on the resolved ledger root, never process.cwd()', async () => {
    const paths = seedCorpus(root);
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');
    await runCuration(['--clear']);
    expect(store.readJsonl(paths.log).rows.map(row => row.id)).toEqual(['obs_cli_decision', 'obs_cli_pitfall', 'obs_cli_retired']);
  });
});

// ---------------------------------------------------------------------------
// --reset: the whole curation directory, under the curation lock
// (D-ONE-LEARNING-LOCK, D-NO-STRAY-TREE, D-RESET-UNDER-LOCK)
// ---------------------------------------------------------------------------

describe('curation --reset', { timeout: 30_000 }, () => {
  beforeEach(useMatchingInstall);

  it('removes .devflow/curation/ — entries, observations, the queue and its claim — and leaves the rest of .devflow/ alone', async () => {
    seedCorpus(root);
    seedQueue(root);
    fs.writeFileSync(path.join(root, '.devflow', 'config.json'), '{"features":{}}\n');
    fs.mkdirSync(path.join(root, '.devflow', 'memory'));
    fs.writeFileSync(getPendingTurnsPath(root), '{"role":"user"}\n');

    const run = await runCuration(['--reset']);

    expect(run.success).toBe('Reset complete — removed .devflow/curation/ state.');
    expect(run.exitCode).toBe(0);
    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(fs.existsSync(curationPaths(root).curationDir)).toBe(false);
    expect(fs.readFileSync(path.join(root, '.devflow', 'config.json'), 'utf8')).toBe('{"features":{}}\n');
    expect(fs.existsSync(getPendingTurnsPath(root))).toBe(true);
  });

  it('breaks a curation lock a crashed run left behind, then resets', async () => {
    const paths = seedCorpus(root);
    fs.mkdirSync(paths.lockDir);
    const abandoned = new Date(Date.now() - store.LOCK_STALE_MS - 60_000);
    fs.utimesSync(paths.lockDir, abandoned, abandoned);

    const run = await runCuration(['--reset']);

    expect(run.error).toBe('');
    expect(run.success).toBe('Reset complete — removed .devflow/curation/ state.');
    expect(run.exitCode).toBe(0);
    expect(fs.existsSync(paths.curationDir)).toBe(false);
  });

  it('while another run holds the curation lock: exit 1 within the CLI\'s wait, nothing written', async () => {
    const paths = seedCorpus(root);
    seedQueue(root);
    fs.mkdirSync(paths.lockDir);
    const before = snapshotTree(root);

    const started = Date.now();
    const run = await runCuration(['--reset']);

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(run.error).toBe('The curation store is busy: another run holds its lock. Nothing was reset; try again in a moment.');
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('when .devflow/curation is a symbolic link: exit 1, and nothing the link leads to is removed', async () => {
    const { curationDir } = curationPaths(root);
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'notes.txt'), 'kept\n');
    fs.writeFileSync(path.join(elsewhere, 'sub', 'deep.txt'), 'kept\n');
    fs.mkdirSync(path.join(root, '.devflow'));
    fs.symlinkSync(elsewhere, curationDir);
    const before = snapshotTree(elsewhere);

    const run = await runCuration(['--reset']);

    expect(run.error).toBe(`reset: ${curationDir} is a symbolic link, not a directory; nothing was changed`);
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(elsewhere)).toEqual(before);
  });

  it('when .devflow is a symbolic link: exit 1, and nothing in the curation folder the link leads to is removed', async () => {
    const linkedDevflow = path.join(root, '.devflow');
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, 'curation'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'curation', 'decisions-log.jsonl'), 'kept\n');
    fs.writeFileSync(path.join(elsewhere, 'curation', 'notes.txt'), 'kept\n');
    fs.symlinkSync(elsewhere, linkedDevflow);
    const before = snapshotTree(elsewhere);

    const run = await runCuration(['--reset']);

    expect(run.error).toBe(`reset: ${linkedDevflow} is a symbolic link, not a directory; nothing was changed`);
    expect(run.success).toBe('');
    expect(run.exitCode).toBe(1);
    expect(snapshotTree(elsewhere)).toEqual(before);
  });

  it('in a project that never had curation data: says so, exits 0 and creates nothing, neither .devflow/ nor .devflow/curation/', async () => {
    const run = await runCuration(['--reset']);

    expect(run.info).toBe('No curation data to reset.');
    expect(run.success).toBe('');
    expect(run.error).toBe('');
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('a second reset finds nothing to reset: no contention error, and nothing created under .devflow/', async () => {
    seedCorpus(root);
    await runCuration(['--reset']);

    const run = await runCuration(['--reset']);

    expect(run.error).toBe('');
    expect(run.info).toBe('No curation data to reset.');
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(path.join(root, '.devflow'))).toEqual([]);
  });

  it('outside a git project: warns, exits 0 and touches nothing', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    seedCorpus(root);
    const before = snapshotTree(root);

    const run = await runCuration(['--reset']);

    expect(run.warn).toBe('Could not resolve git root — reset not performed');
    expect(run.exitCode).toBe(0);
    expect(snapshotTree(root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// --disable switches curation off machine-wide (D-FEATURES-NARROW-ONLY) and
// drains the current project's curation queue — a mid-run Curate agent whose
// claimed batch vanishes stops, which is the desired outcome of disabling.
// ---------------------------------------------------------------------------

describe('curation --disable drains the curation pending-turns queue', () => {
  /** The machine-wide switch, as the command left it. */
  function readCurationSwitch(): unknown {
    // Both keys always agree after a toggle (the manifest mirror): one answer for both.
    const keys = readSwitchKeys(devflowDir);
    expect(keys.learning, 'the pre-rename copy equals the curation key').toBe(keys.curation);
    return keys.curation;
  }

  beforeEach(() => {
    fs.mkdirSync(path.join(root, '.devflow', 'curation'), { recursive: true });
    seedQueue(root);
  });

  it('deletes the queue, the claim and its owner file, and switches curation off machine-wide (memory queue untouched)', async () => {
    fs.mkdirSync(path.join(root, '.devflow', 'memory'), { recursive: true });
    fs.writeFileSync(getPendingTurnsPath(root), '{"role":"user"}\n');

    await runCuration(['--disable']);

    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(readCurationSwitch()).toBe(false);
    // The retired per-repo key is never written.
    expect(fs.existsSync(path.join(root, '.devflow', 'config.json'))).toBe(false);
    expect(fs.existsSync(getPendingTurnsPath(root))).toBe(true);
  });

  it('removes the pending rows of the backups a move left, and keeps their ledger files', async () => {
    const backup = seedBackup(root);

    const run = await runCuration(['--disable']);

    expect(backupPendingPresent(backup)).toEqual([false, false, false, false]);
    expect(fs.existsSync(path.join(backup, 'decisions-ledger.jsonl'))).toBe(true);
    expect(queueFilesPresent(root)).toEqual([false, false, false]);
    expect(run.success).toBe('Curation disabled in every project');
    expect(readCurationSwitch()).toBe(false);
  });

  it('a backup queue file that is a link: nothing is deleted, the drain says so, and the switch is still off', async () => {
    const backup = seedBackup(root);
    const outside = makeTmpDir();
    fs.writeFileSync(path.join(outside, 'queue'), 'a file outside the project\n');
    fs.rmSync(path.join(backup, '.pending-turns.jsonl'));
    fs.symlinkSync(path.join(outside, 'queue'), path.join(backup, '.pending-turns.jsonl'));

    const run = await runCuration(['--disable']);

    expect(run.warn).toContain(`${path.join(backup, '.pending-turns.jsonl')} is a symbolic link`);
    expect(fs.readFileSync(path.join(outside, 'queue'), 'utf-8')).toBe('a file outside the project\n');
    expect(BACKUP_PENDING.slice(1).map(file => fs.existsSync(path.join(backup, file)))).toEqual([true, true, true]);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
    expect(readCurationSwitch()).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('a backup folder that cannot be read: the live queue is still drained, the command warns and finishes, and the switch is off', async () => {
    const backup = seedBackup(root);
    fs.chmodSync(backup, 0o000);
    try {
      const run = await runCuration(['--disable']);

      expect(run.warn).toMatch(/backup folders were not drained/);
      expect(queueFilesPresent(root)).toEqual([false, false, false]);
      expect(run.success).toBe('Curation disabled in every project');
      expect(run.exitCode).toBe(0);
      expect(readCurationSwitch()).toBe(false);
    } finally {
      fs.chmodSync(backup, 0o755);
    }
  });

  it('does not create a .disabled sentinel (the gate is the manifest)', async () => {
    await runCuration(['--disable']);
    expect(fs.existsSync(path.join(root, '.devflow', 'curation', '.disabled'))).toBe(false);
  });

  it('drains unconditionally — a leftover .worker.lock dir from an old install does not block it', async () => {
    fs.mkdirSync(path.join(root, '.devflow', 'dream', '.worker.lock'), { recursive: true });
    await runCuration(['--disable']);
    expect(queueFilesPresent(root).slice(0, 2)).toEqual([false, false]);
    expect(readCurationSwitch()).toBe(false);
  });

  it('does not delete anything on --enable', async () => {
    await runCuration(['--enable']);
    expect(queueFilesPresent(root)).toEqual([true, true, true]);
    expect(readCurationSwitch()).toBe(true);
  });

  it('switches curation off outside a git project too (the switch is not per-project)', async () => {
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    await runCuration(['--disable']);
    expect(readCurationSwitch()).toBe(false);
  });

  it('drains the resolved git-root paths, not process.cwd()', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd-decoy-path');
    await runCuration(['--disable']);
    expect(queueFilesPresent(root).slice(0, 2)).toEqual([false, false]);
  });

  // D-CLI-NO-SYMLINK: a repository can commit .devflow or .devflow/curation as a link
  // to a folder elsewhere; the drain then deletes nothing, says so, and the switch is
  // still turned off.
  for (const linked of ['.devflow', path.join('.devflow', 'curation')]) {
    it(`a linked ${linked}: deletes nothing where it points, says so, and still switches curation off (D-CLI-NO-SYMLINK)`, async () => {
      const outside = makeTmpDir();
      try {
        const queueDir = linked === '.devflow' ? path.join(outside, 'curation') : outside;
        fs.mkdirSync(queueDir, { recursive: true });
        const files = ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'].map(f => path.join(queueDir, f));
        for (const file of files) fs.writeFileSync(file, 'a file outside the project\n');
        fs.rmSync(path.join(root, linked), { recursive: true, force: true });
        fs.symlinkSync(outside, path.join(root, linked));

        const run = await runCuration(['--disable']);

        expect(files.map(file => fs.existsSync(file)), 'nothing is deleted through the link').toEqual([true, true, true]);
        expect(run.warn).toContain(`${path.join(root, linked)} is a symbolic link`);
        expect(readCurationSwitch()).toBe(false);
        expect(run.success).toBe('Curation disabled in every project');
        expect(run.exitCode).toBe(0);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// --configure writes the project tuning config, curation.json, under the ledger's
// .devflow/curation. A repository can commit .devflow, the curation folder or
// curation.json itself as a link; the command then writes nothing, says why and
// exits 1 (D-CLI-NO-SYMLINK).
// ---------------------------------------------------------------------------

describe('curation --configure never writes the project config through a symbolic link (D-CLI-NO-SYMLINK)', () => {
  const KEEP = 'a file outside the project\n';
  let outside: string;

  beforeEach(() => {
    outside = makeTmpDir();
    useMatchingInstall();
  });

  afterEach(() => {
    fs.rmSync(outside, { recursive: true, force: true });
  });

  /** Answer the wizard: Sonnet, no debug logging, Project scope. */
  async function configureProject(): Promise<CurationRun> {
    vi.mocked(p.select).mockResolvedValueOnce('sonnet').mockResolvedValueOnce('project');
    vi.mocked(p.confirm).mockResolvedValueOnce(false);
    return runCuration(['--configure']);
  }

  const LAYOUTS: ReadonlyArray<readonly [string, () => string]> = [
    ['.devflow', () => {
      fs.mkdirSync(path.join(outside, 'curation'));
      fs.writeFileSync(path.join(outside, 'curation', 'curation.json'), KEEP);
      fs.symlinkSync(outside, path.join(root, '.devflow'));
      return path.join(outside, 'curation', 'curation.json');
    }],
    [path.join('.devflow', 'curation'), () => {
      fs.writeFileSync(path.join(outside, 'curation.json'), KEEP);
      fs.mkdirSync(path.join(root, '.devflow'));
      fs.symlinkSync(outside, path.join(root, '.devflow', 'curation'));
      return path.join(outside, 'curation.json');
    }],
    [path.join('.devflow', 'curation', 'curation.json'), () => {
      fs.writeFileSync(path.join(outside, 'target'), KEEP);
      fs.mkdirSync(path.join(root, '.devflow', 'curation'), { recursive: true });
      fs.symlinkSync(path.join(outside, 'target'), path.join(root, '.devflow', 'curation', 'curation.json'));
      return path.join(outside, 'target');
    }],
  ];

  for (const [linked, layout] of LAYOUTS) {
    it(`a linked ${linked}: nothing is written where it points, and the command says why and exits 1`, async () => {
      const kept = layout();

      const run = await configureProject();

      expect(fs.readFileSync(kept, 'utf-8'), 'nothing is written through the link').toBe(KEEP);
      expect(run.error).toContain(`${path.join(root, linked)} is a symbolic link`);
      expect(run.exitCode).toBe(1);
    });
  }

  it('non-vacuity: a plain project gets its config', async () => {
    const run = await configureProject();

    expect(JSON.parse(fs.readFileSync(path.join(root, '.devflow', 'curation', 'curation.json'), 'utf-8'))).toEqual({ model: 'sonnet', debug: false });
    expect(run.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The toggles (TP-17, toggle half): both machine keys first; under version skew the
// toggle moves nothing; otherwise it tries the shared move with no wait, and a busy
// move is not an error; only --disable drains, each ledger folder that exists.
// ---------------------------------------------------------------------------

describe('curation --enable/--disable: the curation switch and the folder move (#529)', () => {
  const OLD = (): string => path.join(root, '.devflow', 'learning');
  const NEW = (): string => path.join(root, '.devflow', 'curation');
  const queueIn = (dir: string): boolean[] =>
    ['.pending-turns.jsonl', '.pending-turns.processing', '.pending-turns.owner'].map(f => fs.existsSync(path.join(dir, f)));

  describe('the two machine keys', () => {
    it.each([['--disable', false], ['--enable', true]] as const)('%s writes curation and the legacy learning key to %s', async (flag, value) => {
      const before = flag === '--enable' ? { curation: false, learning: false } : { curation: true, learning: true };
      const manifest = JSON.parse(fs.readFileSync(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
      manifest.features = { ...manifest.features, ...before };
      fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify(manifest));

      await runCuration([flag]);

      expect(readSwitchKeys(devflowDir)).toEqual({ curation: value, learning: value });
    });

    it('repairs a disagreeing pair: --enable puts both keys on, --disable both off', async () => {
      for (const [flag, value] of [['--enable', true], ['--disable', false]] as const) {
        const manifest = JSON.parse(fs.readFileSync(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: Record<string, unknown> };
        manifest.features = { ...manifest.features, curation: !value, learning: value };
        fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify(manifest));
        await runCuration([flag]);
        expect(readSwitchKeys(devflowDir)).toEqual({ curation: value, learning: value });
      }
    });

    it('a toggle to the value both keys already hold leaves manifest.json byte-identical (D-NOOP-TOGGLE)', async () => {
      const file = path.join(devflowDir, 'manifest.json');
      const before = fs.readFileSync(file, 'utf-8');
      await runCuration(['--enable']);
      expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    });

    it('writes the keys with no git root (the switch is not per-project)', async () => {
      vi.mocked(getLedgerRoot).mockResolvedValue(null);
      await runCuration(['--disable']);
      expect(readSwitchKeys(devflowDir)).toEqual({ curation: false, learning: false });
    });
  });

  describe('under version skew the toggle records the switch and moves nothing', () => {
    it('--enable leaves the old folder where it was and prints the run-init hint', async () => {
      const old = seedOldFolder(root);
      const run = await runCuration(['--enable']);
      expect(readSwitchKeys(devflowDir)).toEqual({ curation: true, learning: true });
      expect(fs.existsSync(old)).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(run.warn).toContain('devflow init');
      expect(run.exitCode).toBe(0);
    });

    it('--disable drains the old folder\'s queue, keeps its ledger, and moves nothing', async () => {
      const old = seedOldFolder(root, true);
      const run = await runCuration(['--disable']);
      expect(readSwitchKeys(devflowDir)).toEqual({ curation: false, learning: false });
      expect(queueIn(old)).toEqual([false, false, false]);
      expect(fs.existsSync(path.join(old, 'decisions-ledger.jsonl'))).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(run.success).toBe('Curation disabled in every project');
    });

    it('--disable drains the queue of both folders when both exist', async () => {
      const old = seedOldFolder(root, true);
      fs.mkdirSync(NEW(), { recursive: true });
      seedQueue(root);
      await runCuration(['--disable']);
      expect(queueIn(old)).toEqual([false, false, false]);
      expect(queueFilesPresent(root)).toEqual([false, false, false]);
    });

    it('--disable with a queue file of the old folder tracked leaves every file as it is, though no move was tried', async () => {
      const old = seedOldFolder(root, true);
      trackInGit(root, '.devflow/learning/.pending-turns.jsonl');
      const before = snapshotTree(path.join(root, '.devflow'), { stat: true });

      const run = await runCuration(['--disable']);

      expect(readSwitchKeys(devflowDir)).toEqual({ curation: false, learning: false });
      expect(snapshotTree(path.join(root, '.devflow'), { stat: true })).toEqual(before);
      expect(queueIn(old)).toEqual([true, true, true]);
      expect(run.warn.split('\n').at(-1), 'no move ran, so the drain prints the whole notice').toBe(`The curation queue was not drained. ${MOVE_SKIP_NOTICE.tracked}`);
      expect(run.exitCode).toBe(0);
    });
  });

  describe('with matching installed scripts the toggle moves the folder, with no wait', () => {
    beforeEach(useMatchingInstall);

    it('--enable moves the old folder; the pending file stays unchanged (enable never drains)', async () => {
      const old = seedOldFolder(root);
      const queueBody = fs.readFileSync(path.join(old, '.pending-turns.jsonl'), 'utf-8');

      const run = await runCuration(['--enable']);

      expect(fs.existsSync(old)).toBe(false);
      expect(fs.readFileSync(path.join(NEW(), '.pending-turns.jsonl'), 'utf-8')).toBe(queueBody);
      expect(fs.existsSync(path.join(NEW(), 'decisions-ledger.jsonl'))).toBe(true);
      expect(run.exitCode).toBe(0);
      expect(run.success).toContain('Curation enabled');
    });

    it('--disable moves the folder, then drains the queue in the folder it moved to', async () => {
      // The seeded folder holds only the pending queue (no claim), so the move is not deferred.
      const old = seedOldFolder(root);
      await runCuration(['--disable']);
      expect(fs.existsSync(old)).toBe(false);
      expect(queueIn(NEW())).toEqual([false, false, false]);
      expect(fs.existsSync(path.join(NEW(), 'decisions-ledger.jsonl'))).toBe(true);
      expect(readSwitchKeys(devflowDir)).toEqual({ curation: false, learning: false });
    });

    it('a busy move is not an error: the switch is recorded, the old folder stays, the exit code is 0', async () => {
      const old = seedOldFolder(root);
      const lock = holdMoveLock(devflowDir, root);
      const started = Date.now();

      const run = await runCuration(['--enable']);

      expect(Date.now() - started, 'the toggle takes the lock with no wait').toBeLessThan(5000);
      expect(fs.existsSync(lock)).toBe(true);
      expect(readSwitchKeys(devflowDir)).toEqual({ curation: true, learning: true });
      expect(fs.existsSync(old)).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(run.exitCode).toBe(0);
      expect(run.error).toBe('');
    });

    it('--disable with a busy move still drains the old folder\'s queue', async () => {
      const old = seedOldFolder(root, true);
      holdMoveLock(devflowDir, root);
      await runCuration(['--disable']);
      expect(queueIn(old)).toEqual([false, false, false]);
      expect(fs.existsSync(path.join(old, 'decisions-ledger.jsonl'))).toBe(true);
    });

    it('with no old folder nothing is moved and no store is needed', async () => {
      const run = await runCuration(['--enable']);
      expect(fs.existsSync(OLD())).toBe(false);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(run.exitCode).toBe(0);
    });

    it.each(['tracked', 'unknown'] as const)('a move skipped for the reason %s is reported as a warning with the fixed notice, never a failure', async (reason) => {
      const old = seedOldFolder(root);
      if (reason === 'tracked') trackInGit(root, '.devflow/learning/decisions-ledger.jsonl');
      else {
        initGitRepo(root);
        vi.stubEnv('PATH', pathWithFailingGit(devflowDir));
      }
      const before = snapshotTree(path.join(root, '.devflow'), { stat: true });

      const run = await runCuration(['--enable']);

      expect(readSwitchKeys(devflowDir)).toEqual({ curation: true, learning: true });
      expect(run.warn).toContain(MOVE_SKIP_NOTICE[reason]);
      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(old)).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(snapshotTree(path.join(root, '.devflow'), { stat: true })).toEqual(before);
    });

    it.each(['tracked', 'unknown'] as const)('--disable after a move skipped for the reason %s leaves every file as it is, warns with the fixed notice, and still records the switch', async (reason) => {
      const old = seedOldFolder(root);
      fs.mkdirSync(NEW(), { recursive: true });
      seedQueue(root);
      if (reason === 'tracked') trackInGit(root, '.devflow/learning/.pending-turns.jsonl');
      else {
        initGitRepo(root);
        vi.stubEnv('PATH', pathWithFailingGit(devflowDir));
      }
      const before = snapshotTree(path.join(root, '.devflow'), { stat: true });

      const run = await runCuration(['--disable']);

      expect(readSwitchKeys(devflowDir)).toEqual({ curation: false, learning: false });
      expect(snapshotTree(path.join(root, '.devflow'), { stat: true })).toEqual(before);
      expect(fs.existsSync(path.join(old, '.pending-turns.jsonl'))).toBe(true);
      expect(queueFilesPresent(root)).toEqual([true, true, true]);
      expect(run.warn.split(MOVE_SKIP_NOTICE[reason]), 'the fixed notice is printed once').toHaveLength(2);
      expect(run.warn.split('\n')).toEqual([expect.stringContaining(MOVE_SKIP_NOTICE[reason]), 'The curation queue was not drained.']);
      expect(run.exitCode).toBe(0);
      expect(run.success).toBe('Curation disabled in every project');
    });

    it('--disable with a queue file of the new folder tracked, and no old folder, leaves both folders and the backups as they are', async () => {
      fs.mkdirSync(NEW(), { recursive: true });
      seedQueue(root);
      const backup = seedBackup(root);
      trackInGit(root, '.devflow/curation/.pending-turns.jsonl');
      const before = snapshotTree(path.join(root, '.devflow'), { stat: true });

      const run = await runCuration(['--disable']);

      expect(readSwitchKeys(devflowDir)).toEqual({ curation: false, learning: false });
      expect(snapshotTree(path.join(root, '.devflow'), { stat: true })).toEqual(before);
      expect(backupPendingPresent(backup)).toEqual([true, true, true, true]);
      expect(run.warn, 'no move ran, so the drain prints the whole notice').toBe(`The curation queue was not drained. ${MOVE_SKIP_NOTICE.tracked}`);
      expect(run.exitCode).toBe(0);
    });

    it('--disable with a queue file of a backup folder tracked leaves the live queue and the backups as they are', async () => {
      fs.mkdirSync(NEW(), { recursive: true });
      seedQueue(root);
      const backup = seedBackup(root);
      trackInGit(root, `.devflow/${BACKUP_NAME}/.pending-turns.jsonl`);
      const before = snapshotTree(path.join(root, '.devflow'));

      const run = await runCuration(['--disable']);

      expect(snapshotTree(path.join(root, '.devflow'))).toEqual(before);
      expect(queueFilesPresent(root)).toEqual([true, true, true]);
      expect(backupPendingPresent(backup)).toEqual([true, true, true, true]);
      expect(run.warn).toContain(MOVE_SKIP_NOTICE.tracked);
    });

    it('--disable in a repository that tracks nothing in the data folders moves the folder and drains the queue', async () => {
      initGitRepo(root, { 'README.md': 'content of the repository\n' });
      const old = seedOldFolder(root);

      const run = await runCuration(['--disable']);

      expect(fs.existsSync(old)).toBe(false);
      expect(queueIn(NEW())).toEqual([false, false, false]);
      expect(fs.existsSync(path.join(NEW(), 'decisions-ledger.jsonl'))).toBe(true);
      expect(run.warn).toBe('');
      expect(run.success).toBe('Curation disabled in every project');
    });

    it('a refused move (the old folder is a link) is reported as a warning, never a failure', async () => {
      const outside = makeTmpDir();
      try {
        fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
        fs.symlinkSync(outside, OLD());
        const run = await runCuration(['--enable']);
        expect(readSwitchKeys(devflowDir)).toEqual({ curation: true, learning: true });
        expect(run.warn).toContain('refused');
        expect(run.exitCode).toBe(0);
        expect(fs.readdirSync(outside)).toEqual([]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// --configure moves the folder first (TP-17, configure half): a busy move refuses with
// a retry message and writes nothing; version skew refuses with the skew line; the new
// folder is created only when the old name is absent.
// ---------------------------------------------------------------------------

describe('curation --configure with the old folder present (#529)', () => {
  const OLD = (): string => path.join(root, '.devflow', 'learning');
  const NEW = (): string => path.join(root, '.devflow', 'curation');

  async function configure(scope: 'project' | 'global' = 'project'): Promise<CurationRun> {
    vi.mocked(p.select).mockResolvedValueOnce('sonnet').mockResolvedValueOnce(scope);
    vi.mocked(p.confirm).mockResolvedValueOnce(false);
    return runCuration(['--configure']);
  }

  describe('with matching installed scripts', () => {
    beforeEach(useMatchingInstall);

    it('moves the old folder first, then writes curation.json into the new folder', async () => {
      const old = seedOldFolder(root);
      const ledgerBody = fs.readFileSync(path.join(old, 'decisions-ledger.jsonl'), 'utf-8');

      const run = await configure();

      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(old)).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(NEW(), 'curation.json'), 'utf-8'))).toEqual({ model: 'sonnet', debug: false });
      expect(fs.readFileSync(path.join(NEW(), 'decisions-ledger.jsonl'), 'utf-8')).toBe(ledgerBody);
    });

    it('a busy move refuses with a retry message, writes nothing, and exits 1', async () => {
      const old = seedOldFolder(root);
      holdMoveLock(devflowDir, root);
      const before = snapshotTree(root);

      const run = await configure();

      expect(run.exitCode).toBe(1);
      expect(run.error).toMatch(/try again/i);
      expect(snapshotTree(root)).toEqual(before);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(fs.existsSync(path.join(old, 'curation.json'))).toBe(false);
      expect(fs.existsSync(path.join(old, 'learning.json'))).toBe(false);
    });

    it('a refused move (the old folder is a link) writes nothing and exits 1', async () => {
      const outside = makeTmpDir();
      try {
        fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
        fs.symlinkSync(outside, OLD());
        const run = await configure();
        expect(run.exitCode).toBe(1);
        expect(run.error).toContain('refused');
        expect(fs.readdirSync(outside)).toEqual([]);
        expect(fs.existsSync(NEW())).toBe(false);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('with no old folder it creates the new folder, as before', async () => {
      const run = await configure();
      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(path.join(NEW(), 'curation.json'))).toBe(true);
      expect(fs.existsSync(OLD())).toBe(false);
    });

    it('global scope writes curation.json in the machine directory and moves nothing', async () => {
      const old = seedOldFolder(root);
      const run = await configure('global');
      expect(run.exitCode).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(devflowDir, 'curation.json'), 'utf-8'))).toEqual({ model: 'sonnet', debug: false });
      expect(fs.existsSync(old)).toBe(true);
    });
  });

  describe('under version skew', () => {
    it('refuses with the skew line, writes nothing, and exits 1', async () => {
      seedOldFolder(root);
      const before = snapshotTree(root);

      const run = await configure();

      expect(run.exitCode).toBe(1);
      expect(run.error).toContain('devflow init');
      expect(run.error).toContain('2.0.0');
      expect(snapshotTree(root)).toEqual(before);
      expect(fs.existsSync(NEW())).toBe(false);
    });

    it('refuses with no old folder too, because the installed hooks would not read the new folder', async () => {
      const run = await configure();
      expect(run.exitCode).toBe(1);
      expect(fs.existsSync(NEW())).toBe(false);
    });

    it('global scope is not refused: it writes the machine file', async () => {
      const run = await configure('global');
      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(path.join(devflowDir, 'curation.json'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// The read-only commands before the move (TP-17, CLI half): when only the old folder
// exists they print the HUD's pointer, or its refused line when the move left a marker
// for this root. They never open the old ledger and never move it.
// ---------------------------------------------------------------------------

const POINTER = 'Curation: run devflow init, or open Claude Code in this project after it';
const REFUSED = 'Curation: move refused, see the hook log';

/** The refusal marker the shell writes for `dir` under the (test) home. */
function markerFor(dir: string): string {
  return getCurationMoveMarkerPath(os.homedir(), dir);
}

describe('curation --status/--list/--show with only the old folder (#529)', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    fs.mkdirSync(path.dirname(markerFor(root)), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(markerFor(root), { force: true });
  });

  describe('--status', () => {
    it('prints the machine switch, then the pointer, and moves and writes nothing', async () => {
      seedOldFolder(root);
      const before = snapshotTree(root);

      const run = await runCuration(['--status']);

      expect(run.info).toBe(`Curation: enabled\n${POINTER}`);
      expect(run.exitCode).toBe(0);
      expect(snapshotTree(root)).toEqual(before);
    });

    it('prints the refused line instead when a marker exists for this root', async () => {
      seedOldFolder(root);
      fs.writeFileSync(markerFor(root), '');
      const before = snapshotTree(root);

      const run = await runCuration(['--status']);

      expect(run.info).toBe(`Curation: enabled\n${REFUSED}`);
      expect(snapshotTree(root)).toEqual(before);
    });

    it.each(['tracked', 'unknown'] as const)('prints the whole fixed notice when the %s marker exists for this root', async (reason) => {
      seedOldFolder(root);
      fs.writeFileSync(getCurationMoveMarkerPath(os.homedir(), root, reason), '');
      const before = snapshotTree(root);

      try {
        const run = await runCuration(['--status']);

        expect(run.info).toBe(`Curation: enabled\nCuration: ${MOVE_SKIP_NOTICE[reason]}`);
        expect(snapshotTree(root)).toEqual(before);
      } finally {
        fs.rmSync(getCurationMoveMarkerPath(os.homedir(), root, reason), { force: true });
      }
    });

    it('a marker for another root does not make this root refused', async () => {
      seedOldFolder(root);
      const other = path.join(root, 'elsewhere');
      fs.writeFileSync(markerFor(other), '');
      try {
        expect((await runCuration(['--status'])).info).toBe(`Curation: enabled\n${POINTER}`);
      } finally {
        fs.rmSync(markerFor(other), { force: true });
      }
    });

    it('prints neither line when the old folder is absent, whatever the marker says', async () => {
      fs.writeFileSync(markerFor(root), '');
      const run = await runCuration(['--status']);
      expect(run.info).toContain('Entries: 0 active');
      expect(run.info).not.toContain('move refused');
      expect(run.info).not.toContain('open Claude Code');
    });

    it('reads the new folder and prints no pointer when both folders exist', async () => {
      seedCorpus(root);
      seedOldFolder(root);
      const run = await runCuration(['--status']);
      expect(run.info).toContain('Entries: 3 active');
      expect(run.info).not.toContain('open Claude Code');
    });

    it('prints no refused line when both folders exist, whatever the marker says', async () => {
      seedCorpus(root);
      seedOldFolder(root);
      fs.writeFileSync(markerFor(root), '');
      const run = await runCuration(['--status']);
      expect(run.info).toContain('Entries: 3 active');
      expect(run.info).not.toContain('move refused');
    });

    it.each(['tracked', 'unknown'] as const)('prints the whole fixed notice with the counts when both folders exist and the %s marker stands', async (reason) => {
      seedCorpus(root);
      seedOldFolder(root);
      fs.writeFileSync(getCurationMoveMarkerPath(os.homedir(), root, reason), '');
      try {
        const run = await runCuration(['--status']);

        expect(run.info.startsWith(`Curation: enabled\nCuration: ${MOVE_SKIP_NOTICE[reason]}\nEntries: 3 active`)).toBe(true);
        expect(run.exitCode).toBe(0);
      } finally {
        fs.rmSync(getCurationMoveMarkerPath(os.homedir(), root, reason), { force: true });
      }
    });
  });

  describe('--list', () => {
    it('prints the pointer and no listing, and exits 0', async () => {
      seedOldFolder(root);
      const before = snapshotTree(root);

      const run = await runCuration(['--list']);

      expect(run.info).toBe(POINTER);
      expect(run.stdout).toBe('');
      expect(run.exitCode).toBe(0);
      expect(snapshotTree(root)).toEqual(before);
    });

    it('prints the refused line when a marker exists for this root', async () => {
      seedOldFolder(root);
      fs.writeFileSync(markerFor(root), '');
      expect((await runCuration(['--list'])).info).toBe(REFUSED);
    });

    it.each(['tracked', 'unknown'] as const)('prints the whole fixed notice, then the listing, when both folders exist and the %s marker stands', async (reason) => {
      seedCorpus(root);
      seedOldFolder(root);
      fs.writeFileSync(getCurationMoveMarkerPath(os.homedir(), root, reason), '');
      try {
        const run = await runCuration(['--list']);

        expect(run.info).toBe(`Curation: ${MOVE_SKIP_NOTICE[reason]}`);
        expect(run.stdout).toContain('ADR-001');
        expect(run.exitCode).toBe(0);
      } finally {
        fs.rmSync(getCurationMoveMarkerPath(os.homedir(), root, reason), { force: true });
      }
    });
  });

  describe('--show', () => {
    it('prints the pointer as the refusal and exits 1', async () => {
      seedOldFolder(root);
      const before = snapshotTree(root);

      const run = await runCuration(['--show', 'ADR-001']);

      expect(run.error).toBe(POINTER);
      expect(run.stdout).toBe('');
      expect(run.exitCode).toBe(1);
      expect(snapshotTree(root)).toEqual(before);
    });

    it('prints the refused line when a marker exists for this root', async () => {
      seedOldFolder(root);
      fs.writeFileSync(markerFor(root), '');
      expect((await runCuration(['--show', 'ADR-001'])).error).toBe(REFUSED);
    });

    it.each(['tracked', 'unknown'] as const)('prints the entry on stdout and the whole fixed notice on stderr when both folders exist and the %s marker stands', async (reason) => {
      seedCorpus(root);
      seedOldFolder(root);
      fs.writeFileSync(getCurationMoveMarkerPath(os.homedir(), root, reason), '');
      const stderr: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
      try {
        const run = await runCuration(['--show', 'ADR-001']);

        expect(stderr.join('')).toBe(`Curation: ${MOVE_SKIP_NOTICE[reason]}\n`);
        expect(JSON.parse(run.stdout)).toMatchObject({ key: 'ADR-001' });
        expect(run.error).toBe('');
        expect(run.exitCode).toBe(0);
      } finally {
        fs.rmSync(getCurationMoveMarkerPath(os.homedir(), root, reason), { force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// --status shows each backup folder and its pending rows (TP-17, TP-19 support): the
// rows of the pending, processing, private and overflow files that are not swept.
// ---------------------------------------------------------------------------

describe('curation --status shows the backup a move left (#529)', { timeout: 30_000 }, () => {
  const STAMP = '20261017T020304Z-ab12cd34';
  const backupPath = (suffix = STAMP): string => path.join(root, '.devflow', `learning.backup-${suffix}`);
  const rows = (count: number): string => '{"role":"user"}\n'.repeat(count);

  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    seedCorpus(root);
  });

  function seedBackup(files: Record<string, string>, suffix = STAMP): string {
    const dir = backupPath(suffix);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
  }

  it('prints nothing about a backup when there is none', async () => {
    expect((await runCuration(['--status'])).info).not.toContain('Backup');
  });

  it('counts the unswept rows of the pending, processing, private and overflow files, and writes nothing', async () => {
    const dir = seedBackup({
      '.pending-turns.jsonl': rows(2),
      '.pending-turns.processing': rows(1),
      '.pending-turns.jsonl.merging-20261017T020304Z-00000001': rows(1),
      '.pending-turns.processing.merging-20261017T020304Z-00000002': rows(1),
      '.pending-turns.jsonl.overflow-20261017T020304Z-00000003': rows(3),
      '.pending-turns.jsonl.swept-20261017T020304Z-00000004': rows(5),
      '.pending-turns.processing.swept-20261017T020304Z-00000005': rows(4),
      '.pending-turns.owner': '0123456789abcdef\n',
      'decisions-ledger.jsonl': rows(9),
    });
    const before = snapshotTree(root);

    const run = await runCuration(['--status']);

    expect(run.info.split('\n').pop()).toBe(`Backup: ${dir}: 8 pending rows in the backup`);
    expect(run.warn).toBe('');
    expect(snapshotTree(root)).toEqual(before);
  });

  it('says 0 pending rows when every file in the backup is swept, so the delete step is allowed', async () => {
    const dir = seedBackup({ '.pending-turns.jsonl.swept-20261017T020304Z-00000004': rows(5), 'decisions-ledger.jsonl': rows(2) });
    expect((await runCuration(['--status'])).info.split('\n').pop()).toBe(`Backup: ${dir}: 0 pending rows in the backup`);
  });

  it('counts a trailing unfinished line as a pending row and skips blank lines', async () => {
    const dir = seedBackup({ '.pending-turns.jsonl': `${rows(1)}\n   \n{"role":"us` });
    expect((await runCuration(['--status'])).info.split('\n').pop()).toBe(`Backup: ${dir}: 2 pending rows in the backup`);
  });

  it('says "1 pending row" for one row', async () => {
    const dir = seedBackup({ '.pending-turns.jsonl': rows(1) });
    expect((await runCuration(['--status'])).info.split('\n').pop()).toBe(`Backup: ${dir}: 1 pending row in the backup`);
  });

  it('lists each backup folder in name order', async () => {
    const second = seedBackup({ '.pending-turns.jsonl': rows(2) }, '20261018T000000Z-00000002');
    const first = seedBackup({ '.pending-turns.jsonl': rows(1) }, '20261017T000000Z-00000001');
    const lines = (await runCuration(['--status'])).info.split('\n');
    expect(lines.slice(-2)).toEqual([
      `Backup: ${first}: 1 pending row in the backup`,
      `Backup: ${second}: 2 pending rows in the backup`,
    ]);
  });

  it('adds one line for the backups past the listing limit, with the rows they still hold', async () => {
    const suffix = (i: number): string => `20261017T0203${String(i).padStart(2, '0')}Z-${String(i).padStart(8, '0')}`;
    for (let i = 0; i < 52; i++) seedBackup(i >= 50 ? { '.pending-turns.jsonl': rows(i - 48) } : {}, suffix(i));

    const lines = (await runCuration(['--status'])).info.split('\n');

    expect(lines.filter(line => line.startsWith('Backup: ')).length).toBe(51);
    expect(lines.pop()).toBe('Backup: 2 more backup folders are not listed above: 5 pending rows in them');
  });

  it('past 500 backups, adds a line for the folders that are not read, so the rows line counts only folders it read', async () => {
    const suffix = (i: number): string => `20261017T020304Z-${String(i).padStart(8, '0')}`;
    for (let i = 0; i < 502; i++) seedBackup(i === 60 ? { '.pending-turns.jsonl': rows(3) } : {}, suffix(i));

    const lines = (await runCuration(['--status'])).info.split('\n').filter(line => line.startsWith('Backup: '));

    expect(lines.length).toBe(52);
    expect(lines[50]).toBe('Backup: 450 more backup folders are not listed above: 3 pending rows in them');
    expect(lines[51]).toBe('Backup: 2 more backup folders past the first 500 are not read: their pending rows are not counted');
  });

  it('says "1 more backup folder" for one backup past the limit', async () => {
    const suffix = (i: number): string => `20261017T0203${String(i).padStart(2, '0')}Z-${String(i).padStart(8, '0')}`;
    for (let i = 0; i < 51; i++) seedBackup(i === 50 ? { '.pending-turns.jsonl': rows(1) } : {}, suffix(i));
    expect((await runCuration(['--status'])).info.split('\n').pop()).toBe('Backup: 1 more backup folder is not listed above: 1 pending row in it');
  });

  it('does not follow a backup that is a symbolic link, and does not list it', async () => {
    const outside = makeTmpDir();
    try {
      fs.writeFileSync(path.join(outside, '.pending-turns.jsonl'), rows(4));
      fs.symlinkSync(outside, backupPath());
      const run = await runCuration(['--status']);
      expect(run.info).not.toContain('Backup');
      expect(fs.readFileSync(path.join(outside, '.pending-turns.jsonl'), 'utf8')).toBe(rows(4));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not read a queue file that is a symbolic link', async () => {
    const outside = makeTmpDir();
    try {
      fs.writeFileSync(path.join(outside, 'queue'), rows(4));
      const dir = seedBackup({});
      fs.symlinkSync(path.join(outside, 'queue'), path.join(dir, '.pending-turns.jsonl'));
      expect((await runCuration(['--status'])).info.split('\n').pop()).toBe(`Backup: ${dir}: 0 pending rows in the backup`);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('shows no backup line outside a git project', async () => {
    seedBackup({ '.pending-turns.jsonl': rows(1) });
    vi.mocked(getLedgerRoot).mockResolvedValue(null);
    expect((await runCuration(['--status'])).info).toBe('Curation: enabled\nEntries: not in a git project');
  });
});

// ---------------------------------------------------------------------------
// The mutating commands move first (TP-17, CLI half): --restore, --clear, --reset and
// --configure run the shared move before they write. A busy move prints a retry message
// and writes nothing; installed scripts of another version refuse with the skew line.
// --clear and --reset leave a backup in place.
// ---------------------------------------------------------------------------

describe('curation --restore/--clear/--reset move the old folder first (#529)', { timeout: 30_000 }, () => {
  const OLD = (): string => path.join(root, '.devflow', 'learning');
  const NEW = (): string => path.join(root, '.devflow', 'curation');

  const WRITERS = [
    ['--restore', ['--restore', 'PF-003'], 'restored'],
    ['--clear', ['--clear'], 'cleared'],
    ['--reset', ['--reset'], 'reset'],
  ] as const;

  describe('with matching installed scripts', () => {
    beforeEach(useMatchingInstall);

    it('--restore moves the folder, then restores the entry in the new folder', async () => {
      seedOldFolder(root);

      const run = await runCuration(['--restore', 'PF-003']);

      expect(run.success).toBe('Restored PF-003 (Active); it is due for review again.');
      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(OLD())).toBe(false);
      const rowsNow = store.readJsonl(path.join(NEW(), 'decisions-ledger.jsonl')).rows;
      expect(rowsNow.find(row => row.anchor_id === 'PF-003')?.decisions_status).toBe('Active');
    });

    it('--clear moves the folder, then clears the new folder and drains its queue', async () => {
      seedOldFolder(root);

      const run = await runCuration(['--clear']);

      expect(run.success).toBe('Cleared 1 observation no entry uses and kept 3 that entries use; drained the curation queue.');
      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(OLD())).toBe(false);
      expect(fs.readFileSync(path.join(NEW(), 'decisions-log.jsonl'), 'utf8')).toBe(toJsonl(LOG.slice(0, 3)));
      expect(fs.existsSync(path.join(NEW(), '.pending-turns.jsonl'))).toBe(false);
    });

    it('--reset moves the folder, then removes the new folder', async () => {
      seedOldFolder(root);

      const run = await runCuration(['--reset']);

      expect(run.success).toBe('Reset complete — removed .devflow/curation/ state.');
      expect(run.exitCode).toBe(0);
      expect(fs.existsSync(OLD())).toBe(false);
      expect(fs.existsSync(NEW())).toBe(false);
    });

    it.each(WRITERS)('%s with a busy move prints a retry message, writes nothing and exits 1', async (_flag, args, undone) => {
      const old = seedOldFolder(root);
      const lock = holdMoveLock(devflowDir, root);
      const before = snapshotTree(root);

      const started = Date.now();
      const run = await runCuration(args);

      expect(Date.now() - started, 'the move takes its lock with no wait').toBeLessThan(5000);
      expect(run.error).toBe(`Another run is moving this project's curation data. Nothing was ${undone}; try again in a moment.`);
      expect(run.success).toBe('');
      expect(run.exitCode).toBe(1);
      expect(fs.existsSync(lock)).toBe(true);
      expect(fs.existsSync(old)).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(snapshotTree(root)).toEqual(before);
    });

    it.each(WRITERS)('%s with a queue claim that holds the move says a Curate run holds it, writes nothing and exits 1', async (_flag, args, undone) => {
      const old = seedOldFolder(root, true);
      const before = snapshotTree(root);

      const run = await runCuration(args);

      expect(run.error).toBe(`A Curate run holds this project's curation queue, and the move waits for it. Nothing was ${undone}; try again after the run finishes (up to 15 minutes).`);
      expect(run.error, 'no other run moves anything').not.toContain('Another run');
      expect(run.success).toBe('');
      expect(run.exitCode).toBe(1);
      expect(fs.existsSync(old)).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(snapshotTree(root)).toEqual(before);
    });

    it.each(WRITERS)('%s with a refused move (the old folder is a link) writes nothing and exits 1', async (_flag, args) => {
      const outside = makeTmpDir();
      try {
        fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
        fs.symlinkSync(outside, OLD());

        const run = await runCuration(args);

        expect(run.error).toContain('refused');
        expect(run.error).toContain('Nothing was');
        expect(run.exitCode).toBe(1);
        expect(fs.readdirSync(outside)).toEqual([]);
        expect(fs.existsSync(NEW())).toBe(false);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it.each(WRITERS)('%s with a project whose old folder git tracks writes nothing, prints the fixed notice and exits 1', async (_flag, args) => {
      const old = seedOldFolder(root);
      trackInGit(root, '.devflow/learning/decisions-ledger.jsonl');
      const before = snapshotTree(path.join(root, '.devflow'));

      const run = await runCuration(args);

      expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.tracked);
      expect(run.success).toBe('');
      expect(run.exitCode).toBe(1);
      expect(fs.existsSync(old)).toBe(true);
      expect(fs.existsSync(NEW())).toBe(false);
      expect(snapshotTree(path.join(root, '.devflow'))).toEqual(before);
    });

    it.each(WRITERS)('%s with a project where git does not answer writes nothing, prints the fixed notice and exits 1', async (_flag, args) => {
      seedOldFolder(root);
      initGitRepo(root);
      vi.stubEnv('PATH', pathWithFailingGit(devflowDir));
      const before = snapshotTree(path.join(root, '.devflow'));

      const run = await runCuration(args);

      expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.unknown);
      expect(run.exitCode).toBe(1);
      expect(snapshotTree(path.join(root, '.devflow'))).toEqual(before);
    });

    it.each(WRITERS)('%s with no old folder runs no move', async (_flag, args) => {
      seedCorpus(root);
      const lock = holdMoveLock(devflowDir, root);

      const run = await runCuration(args);

      expect(run.error, 'a held move lock is no obstacle where there is nothing to move').toBe('');
      expect(fs.existsSync(lock)).toBe(true);
    });

    it.each([['--clear', ['--clear']], ['--reset', ['--reset']]] as const)('%s leaves a backup folder in place, untouched', async (_flag, args) => {
      seedCorpus(root);
      const backup = path.join(root, '.devflow', 'learning.backup-20261017T020304Z-ab12cd34');
      fs.mkdirSync(backup, { recursive: true });
      fs.writeFileSync(path.join(backup, '.pending-turns.jsonl'), '{"role":"user"}\n');
      fs.writeFileSync(path.join(backup, 'decisions-ledger.jsonl'), toJsonl(LEDGER));
      const before = snapshotTree(backup);

      const run = await runCuration(args);

      expect(run.exitCode).toBe(0);
      expect(snapshotTree(backup)).toEqual(before);
    });
  });

  describe('under version skew', () => {
    it.each(WRITERS)('%s refuses with the skew line, writes nothing and exits 1', async (_flag, args) => {
      seedOldFolder(root);
      const before = snapshotTree(root);

      const run = await runCuration(args);

      expect(run.error).toContain('devflow init');
      expect(run.error).toContain('2.0.0');
      expect(run.success).toBe('');
      expect(run.exitCode).toBe(1);
      expect(snapshotTree(root)).toEqual(before);
      expect(fs.existsSync(NEW())).toBe(false);
    });

    it.each(WRITERS)('%s refuses with no old folder too: the installed hooks would not read the new folder', async (_flag, args) => {
      seedCorpus(root);
      const before = snapshotTree(root);

      const run = await runCuration(args);

      expect(run.exitCode).toBe(1);
      expect(snapshotTree(root)).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------
// The store's refusal for a project with no curation directory has one kind, on both
// sides of the seam: the store answers it and the CLI branches on it.
// ---------------------------------------------------------------------------

describe('the no-curation-dir error kind', () => {
  it('is what the store answers for a root with no .devflow/curation/, and what the CLI says in words', async () => {
    const refused = store.clearUnreferenced(root, { timeoutMs: 100 });
    expect(refused).toEqual({
      ok: false,
      error: { kind: 'no-curation-dir', message: `clear: no .devflow/curation/ under ${root} — run from the project root` },
    });
    useMatchingInstall();
    expect((await runCuration(['--list'])).info).toBe('No curation data in this project yet.');
  });
});

// ---------------------------------------------------------------------------
// `devflow decisions` and `devflow learning` are not registered commands: the surface is `curation`.
// ---------------------------------------------------------------------------

describe('devflow decisions and devflow learning are not registered subcommands', () => {
  it('curationCommand is registered under the "curation" name, not "decisions" or "learning"', () => {
    expect(curationCommand.name()).toBe('curation');
  });

  it('curationCommand carries no alias: neither "decisions" nor "learning"', () => {
    expect(curationCommand.aliases()).toEqual([]);
  });
});
