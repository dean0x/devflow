// tests/tracked-area-cli.test.ts
//
// `devflow curation` and `devflow memory` where git tracks files in the area's folder, or a
// `.git` entry stands and git does not answer. The area is paused: `--status` prints the
// fixed notice and exits 0; every other curation command that reads or writes the folder
// prints the fixed notice, exits 1 and changes nothing, and a clear or a reset refuses
// before its confirm prompt. The memory queue drains (`memory --clear`, `memory --disable`
// and `init --no-memory`) delete no queue file and print the notice. A project that tracks
// nothing in the folder is served as before, and a root with no `.git` entry makes no git
// call.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Command } from 'commander';

vi.mock('../src/targets/claude-code/claude-paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/targets/claude-code/claude-paths.js')>()),
  getClaudeDirectory: vi.fn(() => '/home/user/.claude'),
  getDevFlowDirectory: vi.fn(() => '/home/user/.devflow'),
}));

vi.mock('../src/core/ledger-root.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/ledger-root.js')>()),
  getLedgerRoot: vi.fn(),
}));

vi.mock('../src/core/git.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/git.js')>()),
  getGitRoot: vi.fn(),
}));

vi.mock('../src/core/tracked-areas.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/tracked-areas.js')>();
  return { ...actual, probeTrackedArea: vi.fn(actual.probeTrackedArea) };
});

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

import * as p from '@clack/prompts';
import { getClaudeDirectory, getDevFlowDirectory } from '../src/targets/claude-code/claude-paths.js';
import { getLedgerRoot } from '../src/core/ledger-root.js';
import { getGitRoot } from '../src/core/git.js';
import { probeTrackedArea } from '../src/core/tracked-areas.js';
import { AREA_PAUSE_NOTICE, type PauseReason } from '../src/core/area-pause-notice.js';
import { curationCommand } from '../src/cli/commands/curation.js';
import { cleanQueueFiles, memoryCommand } from '../src/cli/commands/memory.js';
import { drainDisabledFeatureQueues } from '../src/cli/commands/init.js';
import {
  getCurationClaimOwnerPath,
  getCurationPendingTurnsPath,
  getCurationPendingTurnsProcessingPath,
  getPendingTurnsPath,
  getPendingTurnsProcessingPath,
} from '../src/core/project-paths.js';
import {
  initGitRepo,
  makeV2LedgerRow,
  makeV2LogRow,
  pathWithFailingGit,
  requireCurationStore,
  seedCurationTree,
  snapshotTree,
  trackInGit,
} from './decisions/curation-fixtures.js';

const store = requireCurationStore();

/** The version of the package under test: a manifest that records it is not skewed against this CLI. */
const RUNNING_VERSION = (JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf-8'),
) as { version: string }).version;

const BACKUP_NAME = 'learning.backup-20261017T020304Z-ab12cd34';

interface Run {
  stdout: string;
  info: string;
  success: string;
  warn: string;
  error: string;
  exitCode: number | string | null | undefined;
}

let tmp: string;
let root: string;
let devflowDir: string;
let claudeDir: string;

/** The messages a mocked clack log function received, one per line. */
function logged(fn: (message: string) => void): string {
  return vi.mocked(fn).mock.calls.map(call => String(call[0])).join('\n');
}

/**
 * Run one command once, as a fresh process would: Commander keeps option values across
 * parseAsync() calls on one instance, so they are cleared first. stdout is captured; the
 * clack log calls are read from their mocks.
 */
async function runCommand(command: Command, args: readonly string[]): Promise<Run> {
  (command as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
  for (const fn of [p.log.info, p.log.success, p.log.warn, p.log.error]) vi.mocked(fn).mockClear();
  vi.mocked(p.confirm).mockClear();
  process.exitCode = 0;
  let stdout = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  });
  try {
    await command.parseAsync([...args], { from: 'user' });
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

const runCuration = (args: readonly string[]): Promise<Run> => runCommand(curationCommand, args);
const runMemory = (args: readonly string[]): Promise<Run> => runCommand(memoryCommand, args);

/** Every entry under the project (git's own folder aside) and the machine and Claude folders, with mode and mtime. */
function everything(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [label, dir] of [['project', root], ['machine', devflowDir], ['claude', claudeDir]] as const) {
    for (const [rel, body] of snapshotTree(dir, { stat: true })) {
      if (label === 'project' && (rel === '.git' || rel.startsWith(`.git${path.sep}`))) continue;
      entries.set(`${label}:${rel}`, body);
    }
  }
  return entries;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-cli-')));
  root = path.join(tmp, 'project');
  devflowDir = path.join(tmp, 'machine');
  claudeDir = path.join(tmp, 'claude');
  for (const dir of [root, devflowDir, claudeDir]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify({
    version: RUNNING_VERSION, plugins: [], scope: 'user', features: { ambient: true, memory: true, curation: true, learning: true },
    installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  vi.mocked(getDevFlowDirectory).mockReturnValue(devflowDir);
  vi.mocked(getClaudeDirectory).mockReturnValue(claudeDir);
  vi.mocked(getLedgerRoot).mockResolvedValue(root);
  vi.mocked(getGitRoot).mockResolvedValue(root);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
  vi.unstubAllEnvs();
  vi.mocked(getDevFlowDirectory).mockReturnValue('/home/user/.devflow');
  vi.mocked(getClaudeDirectory).mockReturnValue('/home/user/.claude');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The curation area
// ---------------------------------------------------------------------------

/** A curation tree with one active decision, a queue and a backup folder. */
function seedCuration(): void {
  seedCurationTree(root, {
    log: [makeV2LogRow({ id: 'obs_cli_decision' })],
    ledger: [makeV2LedgerRow({ id: 'obs_cli_decision', anchor_id: 'ADR-001' })],
  });
  fs.writeFileSync(getCurationPendingTurnsPath(root), '{"role":"user"}\n');
  fs.writeFileSync(getCurationPendingTurnsProcessingPath(root), '{"role":"user"}\n');
  fs.writeFileSync(getCurationClaimOwnerPath(root), '0123456789abcdef\n');
  const backup = path.join(root, '.devflow', BACKUP_NAME);
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, '.pending-turns.jsonl'), '{"role":"user"}\n');
}

/** The ways a curation area is paused: what git tracks, or that git did not answer. */
const CURATION_PAUSES: ReadonlyArray<{ name: string; reason: PauseReason; arrange: () => void }> = [
  { name: 'git tracks a file of the curation folder', reason: 'tracked', arrange: () => trackInGit(root, '.devflow/curation/decisions-ledger.jsonl') },
  { name: 'git tracks a file of the old ledger folder', reason: 'tracked', arrange: () => trackInGit(root, '.devflow/learning/decisions-ledger.jsonl') },
  { name: 'git tracks a file of a backup folder', reason: 'tracked', arrange: () => trackInGit(root, `.devflow/${BACKUP_NAME}/.pending-turns.jsonl`) },
  {
    name: 'a .git entry stands and git does not answer',
    reason: 'unknown',
    arrange: () => {
      initGitRepo(root);
      vi.stubEnv('PATH', pathWithFailingGit(tmp));
    },
  },
];

describe.each(CURATION_PAUSES)('curation commands where $name', ({ reason, arrange }) => {
  const notice = AREA_PAUSE_NOTICE.curation[reason];

  beforeEach(() => {
    arrange();
    seedCuration();
  });

  it.each([
    ['--list', ['--list']],
    ['--show', ['--show', 'ADR-001']],
    ['--restore', ['--restore', 'ADR-001']],
    ['--clear', ['--clear']],
    ['--reset', ['--reset']],
  ] as const)('%s prints the fixed notice, exits 1 and changes nothing', async (_flag, args) => {
    const before = everything();

    const run = await runCuration(args);

    expect(run.error).toBe(notice);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.success).toBe('');
    expect(everything()).toEqual(before);
  });

  it('project-scope --configure prints the fixed notice, exits 1 and writes no curation.json', async () => {
    vi.mocked(p.select).mockResolvedValueOnce('sonnet').mockResolvedValueOnce('project');
    vi.mocked(p.confirm).mockResolvedValueOnce(false);
    const before = everything();

    const run = await runCuration(['--configure']);

    expect(run.error).toBe(notice);
    expect(run.exitCode).toBe(1);
    expect(everything()).toEqual(before);
    expect(fs.existsSync(path.join(root, '.devflow', 'curation', 'curation.json'))).toBe(false);
  });

  it('--status prints the fixed notice after the machine switch, exits 0 and changes nothing', async () => {
    const before = everything();

    const run = await runCuration(['--status']);

    expect(run.info).toContain(notice);
    expect(run.info.startsWith('Curation: enabled')).toBe(true);
    expect(run.info).not.toContain('Entries:');
    expect(run.exitCode).toBe(0);
    expect(run.error).toBe('');
    expect(everything()).toEqual(before);
  });

  describe('on a terminal', () => {
    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      if (originalIsTTY === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
      else Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    });

    it.each([['--clear'], ['--reset']] as const)('%s refuses before it shows the confirm prompt', async (flag) => {
      const run = await runCuration([flag]);

      expect(p.confirm).not.toHaveBeenCalled();
      expect(run.error).toBe(notice);
      expect(run.info).not.toContain('cancelled');
      expect(run.exitCode).toBe(1);
    });
  });
});

describe('curation commands where the store, not the CLI check, finds the area paused', () => {
  it('a store refusal that says git tracks files reads as the tracked notice', async () => {
    seedCuration();
    trackInGit(root, '.devflow/curation/decisions-ledger.jsonl');
    vi.mocked(probeTrackedArea).mockResolvedValueOnce({ answer: 'untracked', cause: null });
    const before = everything();

    const run = await runCuration(['--restore', 'ADR-001']);

    expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.tracked);
    expect(run.exitCode).toBe(1);
    expect(everything()).toEqual(before);
  });

  it('a store refusal that says git did not answer reads as the unknown notice', async () => {
    initGitRepo(root);
    seedCuration();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));
    vi.mocked(probeTrackedArea).mockResolvedValueOnce({ answer: 'untracked', cause: null });
    const before = everything();

    const run = await runCuration(['--restore', 'ADR-001']);

    expect(run.error).toBe(AREA_PAUSE_NOTICE.curation.unknown);
    expect(run.exitCode).toBe(1);
    expect(everything()).toEqual(before);
  });

  it('the store words the CLI reads the reason from stay fixed', () => {
    seedCuration();
    trackInGit(root, '.devflow/curation/decisions-ledger.jsonl');
    const tracked = store.readListing(root);
    expect(tracked.ok).toBe(false);
    expect(!tracked.ok && tracked.error.kind).toBe('tracked');
    expect(!tracked.ok && tracked.error.message).not.toContain('did not answer');

    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    seedCurationTree(other, { log: [], ledger: [] });
    initGitRepo(other);
    vi.stubEnv('PATH', pathWithFailingGit(tmp));
    const unknown = store.readListing(other);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error.kind).toBe('tracked');
    expect(!unknown.ok && unknown.error.message).toContain('did not answer');
  });
});

describe('curation commands where the area is not paused', () => {
  it('a repository that tracks nothing in the curation folders is served as before', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n' });
    seedCuration();

    const list = await runCuration(['--list']);
    const status = await runCuration(['--status']);

    expect(list.exitCode).toBe(0);
    expect(list.error).toBe('');
    expect(list.stdout).toContain('ADR-001');
    expect(status.info).toContain('Entries: 1 active');
    expect(status.info).not.toContain('paused');
  });

  it('a project with no .git entry makes no git call', async () => {
    seedCuration();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    const list = await runCuration(['--list']);

    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain('ADR-001');
  });

  it('the clear and the reset still ask their confirm question', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n' });
    seedCuration();
    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const clear = await runCuration(['--clear']);
      expect(p.confirm).toHaveBeenCalledTimes(1);
      expect(clear.info).toContain('Clear cancelled.');
    } finally {
      if (originalIsTTY === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
      else Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    }
  });
});

// ---------------------------------------------------------------------------
// The memory area
// ---------------------------------------------------------------------------

const MEMORY_FILES = ['.pending-turns.jsonl', '.pending-turns.processing'] as const;

/** A memory folder with working memory and a queue. */
function seedMemory(dir: string = root): void {
  const memory = path.join(dir, '.devflow', 'memory');
  fs.mkdirSync(memory, { recursive: true });
  fs.writeFileSync(path.join(memory, 'WORKING-MEMORY.md'), '## Now\nsome notes\n');
  fs.writeFileSync(getPendingTurnsPath(dir), '{"role":"user"}\n');
  fs.writeFileSync(getPendingTurnsProcessingPath(dir), '{"role":"user"}\n');
}

function memoryQueuePresent(dir: string = root): boolean[] {
  return MEMORY_FILES.map(file => fs.existsSync(path.join(dir, '.devflow', 'memory', file)));
}

/** The ways a memory area is paused. */
const MEMORY_PAUSES: ReadonlyArray<{ name: string; reason: PauseReason; arrange: () => void }> = [
  { name: 'git tracks a file of the memory folder', reason: 'tracked', arrange: () => trackInGit(root, '.devflow/memory/WORKING-MEMORY.md') },
  { name: 'git tracks a queue file of the memory folder', reason: 'tracked', arrange: () => trackInGit(root, '.devflow/memory/.pending-turns.jsonl') },
  {
    name: 'a .git entry stands and git does not answer',
    reason: 'unknown',
    arrange: () => {
      initGitRepo(root);
      vi.stubEnv('PATH', pathWithFailingGit(tmp));
    },
  },
];

describe.each(MEMORY_PAUSES)('memory commands where $name', ({ reason, arrange }) => {
  const notice = AREA_PAUSE_NOTICE.memory[reason];

  beforeEach(() => {
    arrange();
    seedMemory();
  });

  it('--status prints the fixed notice, exits 0 and changes nothing', async () => {
    const before = everything();

    const run = await runMemory(['--status']);

    expect(run.info).toContain(notice);
    expect(run.exitCode).toBe(0);
    expect(run.error).toBe('');
    expect(everything()).toEqual(before);
  });

  it('--clear deletes no queue file and prints the notice', async () => {
    const before = everything();

    const run = await runMemory(['--clear']);

    expect(run.warn).toContain(notice);
    expect(run.warn).toContain(root);
    expect(run.success).toBe('No queue files found to clean');
    expect(memoryQueuePresent()).toEqual([true, true]);
    expect(everything()).toEqual(before);
  });

  it('--disable records the switch, deletes no queue file and prints the notice', async () => {
    const run = await runMemory(['--disable']);

    expect(run.warn).toContain(`The memory queue was not drained. ${notice}`);
    expect(run.success).toBe('Working memory disabled in every project');
    expect(run.exitCode).toBe(0);
    expect(memoryQueuePresent()).toEqual([true, true]);
    expect((JSON.parse(fs.readFileSync(path.join(devflowDir, 'manifest.json'), 'utf-8')) as { features: { memory: boolean } }).features.memory).toBe(false);
    expect(fs.readFileSync(path.join(root, '.devflow', 'memory', 'WORKING-MEMORY.md'), 'utf-8')).toBe('## Now\nsome notes\n');
  });

  it('the drain init runs for --no-memory deletes no queue file and returns the notice', async () => {
    const warnings = await drainDisabledFeatureQueues({
      gitRoot: root, ledgerRoot: null, memoryEnabled: false, curationEnabled: true, manifestWritten: true,
    });

    expect(warnings).toEqual([`The memory queue was not drained. ${notice}`]);
    expect(memoryQueuePresent()).toEqual([true, true]);
  });

  it('cleanQueueFiles leaves the project alone and names it with the reason', async () => {
    expect(await cleanQueueFiles([root])).toEqual({
      cleaned: 0, projects: [], refused: [], paused: [{ project: root, reason }],
    });
    expect(memoryQueuePresent()).toEqual([true, true]);
  });
});

describe('memory commands where the area is not paused', () => {
  it('a repository that tracks nothing in the memory folder is served as before', async () => {
    initGitRepo(root, { 'README.md': 'content of the repository\n' });
    seedMemory();

    const status = await runMemory(['--status']);
    expect(status.info).not.toContain('paused');

    const clear = await runMemory(['--clear']);
    expect(clear.success).toBe('Cleaned queue files from 1 project');
    expect(memoryQueuePresent()).toEqual([false, false]);
  });

  it('a project with no .git entry makes no git call and drains as usual', async () => {
    seedMemory();
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    const run = await runMemory(['--disable']);

    expect(run.warn).toBe('');
    expect(memoryQueuePresent()).toEqual([false, false]);
  });

  it('cleanQueueFiles cleans the projects that git does not pause and names the ones it does', async () => {
    const paused = path.join(tmp, 'paused');
    fs.mkdirSync(paused);
    seedMemory(paused);
    trackInGit(paused, '.devflow/memory/WORKING-MEMORY.md');
    seedMemory();

    const result = await cleanQueueFiles([paused, root]);

    expect(result).toEqual({ cleaned: 1, projects: [root], refused: [], paused: [{ project: paused, reason: 'tracked' }] });
    expect(memoryQueuePresent(paused)).toEqual([true, true]);
    expect(memoryQueuePresent(root)).toEqual([false, false]);
  });
});
