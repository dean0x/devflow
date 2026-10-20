// tests/init-curation-move.test.ts
//
// The init step that moves each project's ledger folder to the curation name
// (src/cli/commands/curation-move-step.ts). The step takes its path probes, its
// store seam and its clock as parameters, so most tests here inject fakes. The one
// group that uses the real store (TP-37) works in a temp directory and sets HOME
// to it; no test touches the real HOME or a real project.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { promises as fs, accessSync, constants as fsConstants } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  moveProjectLedgers,
  moveLedgerRoot,
  moveGlobalTuningFile,
  runInitCurationMove,
  describeOutcome,
  describeMoveText,
  moveNotice,
  MOVE_POOL_LIMIT,
  type GlobalTuningMoveIO,
  type RenameIfAbsentResult,
  type TuningPathKind,
  type ProjectLedgerMoveIO,
  type ProjectLedgerMoveOptions,
  type ProjectLedgerMoveReport,
  type ProjectLedgerMoveResult,
  type ProjectMoveOutcome,
} from '../src/cli/commands/curation-move-step.js';
import { loadCurationMove } from '../src/core/curation-move.js';
import { MOVE_SKIP_NOTICE } from '../src/core/curation-move-skip.js';
import { LEDGER_ROOT_TIMEOUT_MS, type LedgerRootLookup } from '../src/core/ledger-root.js';
import { realGlobalTuningMoveIO, realProjectLedgerMoveIO } from '../src/cli/commands/curation-move-io.js';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';
import { PROJECT_PATHS } from './decisions/curation-fixtures.js';
import type { CurationStoreResult } from '../src/core/curation-store.js';
import type { LedgerMoveOptions, LedgerMoveOutcome, LedgerSweepOutcome } from '../src/core/curation-move.js';

/** The key of a root's move lock, from the machine-side path helpers the hooks and the move share. */
const { curationMoveLockKey } = createRequire(import.meta.url)(PROJECT_PATHS) as { curationMoveLockKey(realRoot: string): string };

const HOME = '/home/dean';
const MACHINE = '/home/dean/.devflow';
const OLD = 'learning';
const NEW = 'curation';
const NOW = 1_700_000_000_000;

const NONE: LedgerMoveOutcome = { state: 'none', notes: [] };
const BUSY: LedgerMoveOutcome = { state: 'busy', notes: [] };
const BUSY_CLAIM: LedgerMoveOutcome = { state: 'busy', reason: 'claim', notes: [] };
const SKIPPED_TRACKED: LedgerMoveOutcome = { state: 'skipped', reason: 'tracked', notes: [] };
const SKIPPED_UNKNOWN: LedgerMoveOutcome = { state: 'skipped', reason: 'unknown', notes: [] };
const MOVED: LedgerMoveOutcome = { state: 'moved', mode: 'whole-folder', backup: null, rendered: true, notes: [] };
const SWEPT: LedgerSweepOutcome = { state: 'swept', files: 1, merged: 2, overflowed: 0, notes: [] };

/** A name a repository can hold: an escape sequence, a C1 control, a bell and a newline. */
const HOSTILE = 'evil\u001b[31m\u009b2J\u0007\nname';

/** Any character a terminal acts on: C0 (the newline too), DEL and C1. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

const ok = <T>(value: T): CurationStoreResult<T> => ({ ok: true, value });
const fail = <T>(kind: string, message: string): CurationStoreResult<T> => ({ ok: false, error: { kind, message } });

function options(overrides: Partial<ProjectLedgerMoveOptions> = {}): ProjectLedgerMoveOptions {
  return {
    projectRoots: [],
    ownLedgerRoot: null,
    homeDir: HOME,
    machineDir: MACHINE,
    ...overrides,
  };
}

interface FakeConfig {
  /** Project root -> ledger root; a missing key is its own ledger root, null is "git root is null". */
  readonly ledgerRoots?: Readonly<Record<string, string | null>>;
  /** Project roots whose ledger-root lookup timed out. */
  readonly timedOut?: readonly string[];
  /** Path -> physical path; a missing key is its own physical path. */
  readonly physical?: Readonly<Record<string, string>>;
  /** Ledger root -> entries of its .devflow folder; a missing key lists nothing. */
  readonly devflowEntries?: Readonly<Record<string, readonly string[]>>;
  /** Ledger root -> the move answer, or a function that answers per call; a missing key answers `none`. */
  readonly moves?: Readonly<Record<string, CurationStoreResult<LedgerMoveOutcome> | (() => CurationStoreResult<LedgerMoveOutcome>)>>;
  readonly sweeps?: Readonly<Record<string, CurationStoreResult<LedgerSweepOutcome> | (() => CurationStoreResult<LedgerSweepOutcome>)>>;
}

interface Recorder {
  /** `move:<root>` and `sweep:<root>` in call order. */
  readonly order: string[];
  readonly moveArgs: Array<{ root: string; opts: LedgerMoveOptions }>;
  readonly sweepArgs: Array<{ root: string; opts: LedgerMoveOptions }>;
  readonly physicalAsked: string[];
}

function fakeIO(config: FakeConfig = {}): { io: ProjectLedgerMoveIO; rec: Recorder } {
  const rec: Recorder = { order: [], moveArgs: [], sweepArgs: [], physicalAsked: [] };
  const answer = <T>(table: Readonly<Record<string, CurationStoreResult<T> | (() => CurationStoreResult<T>)>> | undefined, root: string, fallback: T) => {
    const entry = table?.[root];
    if (entry === undefined) return ok(fallback);
    return typeof entry === 'function' ? entry() : entry;
  };
  const io: ProjectLedgerMoveIO = {
    ledgerRootOf: async (project): Promise<LedgerRootLookup> => {
      if (config.timedOut?.includes(project)) return { kind: 'timed-out' };
      const root = project in (config.ledgerRoots ?? {}) ? config.ledgerRoots![project] : project;
      return root === null ? { kind: 'no-root' } : { kind: 'root', root };
    },
    realpath: async (target) => {
      rec.physicalAsked.push(target);
      return config.physical?.[target] ?? target;
    },
    readdir: async (dir) => config.devflowEntries?.[path.dirname(dir)] ?? [],
    store: {
      moveLedger: (root, opts) => {
        rec.order.push(`move:${root}`);
        rec.moveArgs.push({ root, opts });
        return answer(config.moves, root, NONE);
      },
      sweepLedgerBackups: (root, opts) => {
        rec.order.push(`sweep:${root}`);
        rec.sweepArgs.push({ root, opts });
        return answer(config.sweeps, root, SWEPT);
      },
    },
    now: () => NOW,
  };
  return { io, rec };
}

function reportOf(result: ProjectLedgerMoveResult): ProjectLedgerMoveReport {
  if (!result.ok) throw new Error(`expected an ok result, got ${result.error.kind}: ${result.error.message}`);
  return result.value;
}

const movedRoots = (rec: Recorder) => rec.moveArgs.map(call => call.root);

describe('moveProjectLedgers: the targets', () => {
  it('moves each discovered project and the current repository, in that order of first sight', async () => {
    const { io, rec } = fakeIO();
    const result = await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/b'], ownLedgerRoot: '/w/own' }), io);
    expect(reportOf(result).outcomes.map(o => o.root)).toEqual(['/w/own', '/w/a', '/w/b']);
    expect(movedRoots(rec)).toEqual(['/w/own', '/w/a', '/w/b']);
  });

  it('lists a repository once when it is both discovered and the current one', async () => {
    const { io, rec } = fakeIO();
    await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/own'], ownLedgerRoot: '/w/own' }), io);
    expect(movedRoots(rec)).toEqual(['/w/own', '/w/a']);
  });

  it('maps a linked worktree to its ledger root, so two worktrees of one repository move once', async () => {
    const { io, rec } = fakeIO({ ledgerRoots: { '/w/repo-feature': '/w/repo', '/w/repo-fix': '/w/repo' } });
    await moveProjectLedgers(options({ projectRoots: ['/w/repo-feature', '/w/repo-fix', '/w/repo'] }), io);
    expect(movedRoots(rec)).toEqual(['/w/repo']);
  });

  it('lists two spellings of one physical path once', async () => {
    const { io, rec } = fakeIO({ physical: { '/tmp/proj': '/private/tmp/proj', '/private/tmp/proj': '/private/tmp/proj' } });
    await moveProjectLedgers(options({ projectRoots: ['/tmp/proj', '/private/tmp/proj'] }), io);
    expect(movedRoots(rec)).toEqual(['/tmp/proj']);
  });

  it('skips the home directory, also by its physical path', async () => {
    const { io, rec } = fakeIO({ physical: { '/link/home': HOME } });
    await moveProjectLedgers(options({ projectRoots: [HOME, '/link/home', '/w/a'], ownLedgerRoot: HOME }), io);
    expect(movedRoots(rec)).toEqual(['/w/a']);
  });

  it('skips the machine directory', async () => {
    const { io, rec } = fakeIO();
    await moveProjectLedgers(options({ projectRoots: [MACHINE, '/w/a'] }), io);
    expect(movedRoots(rec)).toEqual(['/w/a']);
  });

  it('skips a project whose git root is null', async () => {
    const { io, rec } = fakeIO({ ledgerRoots: { '/w/plain-folder': null } });
    const result = await moveProjectLedgers(options({ projectRoots: ['/w/plain-folder', '/w/a'] }), io);
    expect(movedRoots(rec)).toEqual(['/w/a']);
    expect(reportOf(result).outcomes).toHaveLength(1);
  });

  it('does nothing and reports nothing when there is no target', async () => {
    const { io, rec } = fakeIO();
    const report = reportOf(await moveProjectLedgers(options(), io));
    expect(report).toEqual({ outcomes: [], movedCount: 0, lines: [] });
    expect(rec.order).toEqual([]);
  });

  it('reports a project whose ledger-root lookup throws as skipped, and moves the rest', async () => {
    const { io, rec } = fakeIO();
    const throwing: ProjectLedgerMoveIO = {
      ...io,
      ledgerRootOf: async (project) => {
        if (project === '/w/bad') throw new Error('git is gone');
        return { kind: 'root', root: project };
      },
    };
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/bad', '/w/a'] }), throwing));
    expect(movedRoots(rec)).toEqual(['/w/a']);
    expect(report.outcomes).toHaveLength(1);
  });

  it('skips a project whose ledger-root lookup timed out, names it, and never counts it as moved', async () => {
    const { io, rec } = fakeIO({ timedOut: ['/w/stalled'], moves: { '/w/a': ok(MOVED), '/w/b': ok(MOVED) } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/stalled', '/w/b'] }), io));

    expect(movedRoots(rec)).toEqual(['/w/a', '/w/b']);
    expect(report.movedCount).toBe(2);
    expect(report.outcomes.map(o => `${o.kind}:${o.root}`)).toEqual(['moved:/w/a', 'moved:/w/b', 'skipped:/w/stalled']);
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('/w/stalled');
    expect(report.lines[0]).toMatch(/skipped/);
    expect(report.lines[0]).toMatch(/did not answer in time/);
    expect(report.lines[0]).toMatch(/next init tries again/);
  });

  it('prints a line for a timed-out project even when nothing else moves', async () => {
    const { io, rec } = fakeIO({ timedOut: ['/w/stalled'] });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/stalled'] }), io));

    expect(rec.order).toEqual([]);
    expect(report.movedCount).toBe(0);
    expect(report.lines).toHaveLength(1);
  });
});

describe('moveProjectLedgers: what each project asks of the store', () => {
  it('passes the machine directory, the home directory and the clock to the move, and no folder name', async () => {
    const { io, rec } = fakeIO();
    await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io);
    expect(rec.moveArgs).toEqual([
      { root: '/w/a', opts: { machineDir: MACHINE, homeDir: HOME, now: NOW } },
    ]);
  });

  it('runs the move before the backup sweep, and only when a backup folder exists', async () => {
    const { io, rec } = fakeIO({
      devflowEntries: {
        '/w/with-backup': ['memory', NEW, `${OLD}.backup-20261016T000000Z-ab12cd34`],
        '/w/no-backup': ['memory', NEW],
      },
    });
    await moveProjectLedgers(options({ projectRoots: ['/w/with-backup', '/w/no-backup'] }), io);
    expect(rec.order).toEqual(['move:/w/with-backup', 'move:/w/no-backup', 'sweep:/w/with-backup']);
    expect(rec.sweepArgs[0].opts).toEqual({ machineDir: MACHINE, homeDir: HOME, now: NOW });
  });

  it('sweeps a backup an earlier run left, even when this run has nothing to move', async () => {
    const { io, rec } = fakeIO({
      devflowEntries: { '/w/a': [NEW, `${OLD}.backup-20261001T000000Z-00000000`] },
      moves: { '/w/a': ok(NONE) },
    });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(rec.order).toEqual(['move:/w/a', 'sweep:/w/a']);
    expect(report.outcomes[0]).toMatchObject({ kind: 'unchanged', sweep: { state: 'swept', merged: 2 } });
  });

  it('does not sweep a project whose move was busy', async () => {
    const { io, rec } = fakeIO({
      devflowEntries: { '/w/a': [`${OLD}.backup-20261001T000000Z-00000000`] },
      moves: { '/w/a': ok(BUSY) },
    });
    await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io);
    expect(rec.order).toEqual(['move:/w/a']);
  });

  it('does not sweep a project whose move failed', async () => {
    const { io, rec } = fakeIO({
      devflowEntries: { '/w/a': [`${OLD}.backup-20261001T000000Z-00000000`] },
      moves: { '/w/a': fail('io-error', 'EXDEV') },
    });
    await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io);
    expect(rec.order).toEqual(['move:/w/a']);
  });

  it('ignores a folder that only looks like a backup', async () => {
    const { io, rec } = fakeIO({ devflowEntries: { '/w/a': [`${NEW}.backup-1`, `x${OLD}.backup-1`, OLD] } });
    await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io);
    expect(rec.order).toEqual(['move:/w/a']);
  });
});

describe('moveProjectLedgers: the outcome of each project', () => {
  it('reports a moved project with its mode, backup and notes, and no line', async () => {
    const moved: LedgerMoveOutcome = { state: 'moved', mode: 'kept-new', backup: `${OLD}.backup-x`, rendered: true, notes: ['kept an unknown entry'] };
    const { io } = fakeIO({ moves: { '/w/a': ok(moved) } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toMatchObject({
      kind: 'moved', root: '/w/a', mode: 'kept-new', backup: `${OLD}.backup-x`, rendered: true, notes: ['kept an unknown entry'],
    });
    expect(report.movedCount).toBe(1);
    expect(report.lines).toEqual([]);
  });

  it('keeps the move and prints one line when the index was not rebuilt', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok({ ...MOVED, rendered: false }) } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0].kind).toBe('moved');
    expect(report.movedCount).toBe(1);
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('/w/a');
  });

  it('prints no line for a project with no old folder', async () => {
    const { io } = fakeIO();
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toMatchObject({ kind: 'unchanged', root: '/w/a', sweep: null });
    expect(report.movedCount).toBe(0);
    expect(report.lines).toEqual([]);
  });

  it('a project held by a queue claim is busy with that reason, and its line says a claim holds the move', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(BUSY_CLAIM) } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toEqual({ kind: 'busy', root: '/w/a', reason: 'claim' });
    expect(report.lines).toEqual(['Ledger move skipped for /w/a: a queue claim holds the move. The project moves after Curate finishes.']);
  });

  it('prints one line for a busy project and moves it at its next event', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(BUSY) } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toEqual({ kind: 'busy', root: '/w/a' });
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('/w/a');
  });

  it.each([
    ['tracked', SKIPPED_TRACKED],
    ['unknown', SKIPPED_UNKNOWN],
  ] as const)('a project that the store skipped for the reason %s is skipped, is not swept, and its line is the fixed notice', async (reason, answer) => {
    const { io, rec } = fakeIO({ moves: { '/w/a': ok(answer) }, devflowEntries: { '/w/a': ['learning.backup-20260101'] } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toEqual({ kind: 'skipped', root: '/w/a', reason });
    expect(report.movedCount).toBe(0);
    expect(report.lines).toEqual([`Ledger move skipped for /w/a: ${MOVE_SKIP_NOTICE[reason]}`]);
    expect(rec.order, 'a skipped project is not swept').toEqual(['move:/w/a']);
  });

  it('runs the other projects when one is skipped, and tells the move notice only for those that moved', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(SKIPPED_TRACKED), '/w/b': ok(MOVED), '/w/c': ok(SKIPPED_UNKNOWN) } });
    const quiet: GlobalTuningMoveIO = { kindOf: async () => 'absent', renameIfAbsent: async () => ({ state: 'renamed' }) };
    const report = await runInitCurationMove(options({ projectRoots: ['/w/a', '/w/b', '/w/c'] }), { ledger: io, tuning: quiet });
    expect(report.movedCount).toBe(1);
    expect(report.notice).toBe(moveNotice(1));
    expect(report.lines).toEqual([
      `Ledger move skipped for /w/a: ${MOVE_SKIP_NOTICE.tracked}`,
      `Ledger move skipped for /w/c: ${MOVE_SKIP_NOTICE.unknown}`,
    ]);
  });

  it('moveLedgerRoot answers the skip, for the curation command', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(SKIPPED_TRACKED) } });
    expect(await moveLedgerRoot('/w/a', { homeDir: HOME, machineDir: MACHINE }, io)).toEqual({ kind: 'skipped', root: '/w/a', reason: 'tracked' });
  });

  it('prints one line for a refused project and names the reason', async () => {
    const { io } = fakeIO({ moves: { '/w/a': fail('refused', '/w/a/.devflow/learning is a symbolic link') } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toEqual({ kind: 'refused', root: '/w/a', message: '/w/a/.devflow/learning is a symbolic link' });
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('is a symbolic link');
  });

  it('prints one line for an I/O error, and says the next init tries again', async () => {
    const { io } = fakeIO({ moves: { '/w/a': fail('io-error', 'EXDEV: cross-device link') } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toEqual({ kind: 'error', root: '/w/a', message: 'EXDEV: cross-device link' });
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('next init');
  });

  it('counts an invalid-input answer as an error, not a refusal', async () => {
    const { io } = fakeIO({ moves: { '/w/a': fail('invalid-input', 'the names are not plain') } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0].kind).toBe('error');
  });

  it('reports a sweep that stopped as one line and keeps the move', async () => {
    const { io } = fakeIO({
      devflowEntries: { '/w/a': [`${OLD}.backup-x`] },
      moves: { '/w/a': ok(MOVED) },
      sweeps: { '/w/a': fail('io-error', 'EACCES') },
    });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toMatchObject({ kind: 'moved', sweep: { state: 'failed', message: 'EACCES' } });
    expect(report.movedCount).toBe(1);
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('EACCES');
  });

  it('reports a busy sweep as one line', async () => {
    const { io } = fakeIO({
      devflowEntries: { '/w/a': [`${OLD}.backup-x`] },
      sweeps: { '/w/a': ok({ state: 'busy', files: 0, merged: 0, overflowed: 0, notes: [] }) },
    });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toMatchObject({ kind: 'unchanged', sweep: { state: 'busy' } });
    expect(report.lines).toHaveLength(1);
  });

  it('treats a sweep that found nothing as no sweep', async () => {
    const { io } = fakeIO({
      devflowEntries: { '/w/a': [`${OLD}.backup-x`] },
      sweeps: { '/w/a': ok({ state: 'none', files: 0, merged: 0, overflowed: 0, notes: [] }) },
    });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toMatchObject({ kind: 'unchanged', sweep: null });
    expect(report.lines).toEqual([]);
  });
});

describe('moveProjectLedgers: one failing project does not stop the rest', () => {
  it('reports the failing project and moves the others', async () => {
    const { io, rec } = fakeIO({
      moves: {
        '/w/a': ok(MOVED),
        '/w/b': fail('io-error', 'EBUSY'),
        '/w/c': ok(MOVED),
      },
    });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/b', '/w/c'] }), io));
    expect(report.outcomes.map(o => o.kind)).toEqual(['moved', 'error', 'moved']);
    expect(report.movedCount).toBe(2);
    expect(report.lines).toHaveLength(1);
    expect(movedRoots(rec)).toEqual(['/w/a', '/w/b', '/w/c']);
  });

  it('turns a store call that throws into an error outcome and carries on', async () => {
    const { io } = fakeIO({
      moves: {
        '/w/a': () => { throw new Error('store crashed'); },
        '/w/b': ok(MOVED),
      },
    });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/b'] }), io));
    expect(report.outcomes[0]).toMatchObject({ kind: 'error', root: '/w/a' });
    expect(report.outcomes[0].kind === 'error' && report.outcomes[0].message).toContain('store crashed');
    expect(report.outcomes[1].kind).toBe('moved');
  });

  it('a rerun after a failure moves the project and loses nothing: the step keeps no run-once record', async () => {
    let attempts = 0;
    const { io } = fakeIO({
      moves: {
        '/w/a': ok(MOVED),
        '/w/b': () => (++attempts === 1 ? fail('io-error', 'crash between two renames') : ok(MOVED)),
      },
    });
    const first = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/b'] }), io));
    expect(first.outcomes.map(o => o.kind)).toEqual(['moved', 'error']);
    const second = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a', '/w/b'] }), io));
    expect(second.outcomes.map(o => o.kind)).toEqual(['moved', 'moved']);
    expect(attempts).toBe(2);
  });
});

describe('moveProjectLedgers: the bound and the arguments', () => {
  it('runs at most the pool limit of projects at once, and every project', async () => {
    expect(MOVE_POOL_LIMIT).toBe(16);
    let inFlight = 0;
    let peak = 0;
    const { io, rec } = fakeIO();
    const slow: ProjectLedgerMoveIO = {
      ...io,
      ledgerRootOf: async (project) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>(resolve => setTimeout(resolve, 1));
        inFlight -= 1;
        return { kind: 'root', root: project };
      },
    };
    const projects = Array.from({ length: 50 }, (_, i) => `/w/p${i}`);
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: projects }), slow));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MOVE_POOL_LIMIT);
    expect(movedRoots(rec)).toEqual(projects);
    expect(report.outcomes).toHaveLength(50);
  });

  it('refuses a relative home directory or machine directory', async () => {
    const { io, rec } = fakeIO();
    const relativeHome = await moveProjectLedgers(options({ homeDir: 'home/dean' }), io);
    const relativeMachine = await moveProjectLedgers(options({ machineDir: '.devflow' }), io);
    expect(relativeHome.ok).toBe(false);
    expect(relativeMachine.ok).toBe(false);
    expect(rec.order).toEqual([]);
  });

  it('does not change the options it was given', async () => {
    const { io } = fakeIO();
    const opts = options({ projectRoots: ['/w/a', '/w/b'], ownLedgerRoot: '/w/own' });
    const before = JSON.stringify(opts);
    await moveProjectLedgers(opts, io);
    expect(JSON.stringify(opts)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The shared single-root move (configure and the toggles)
// ---------------------------------------------------------------------------

describe('moveLedgerRoot: the move one root gets from configure and the toggles', () => {
  const names = { homeDir: HOME, machineDir: MACHINE };

  it('asks the store once for that root and reports the outcome', async () => {
    const { io, rec } = fakeIO({ moves: { '/w/a': ok(MOVED) } });
    const outcome = await moveLedgerRoot('/w/a', names, io);
    expect(outcome).toMatchObject({ kind: 'moved', root: '/w/a', mode: 'whole-folder' });
    expect(rec.order).toEqual(['move:/w/a']);
    expect(rec.moveArgs[0].opts).toEqual({ machineDir: MACHINE, homeDir: HOME, now: NOW });
  });

  it('reports a busy lock as busy, with no wait and no sweep', async () => {
    const { io, rec } = fakeIO({ moves: { '/w/a': ok(BUSY) }, devflowEntries: { '/w/a': ['learning.backup-x'] } });
    expect(await moveLedgerRoot('/w/a', names, io)).toEqual({ kind: 'busy', root: '/w/a' });
    expect(rec.order).toEqual(['move:/w/a']);
  });

  it('reports a link as refused and an I/O failure as an error', async () => {
    const { io } = fakeIO({
      moves: { '/w/l': fail('refused', 'a link'), '/w/e': fail('error', 'EACCES') },
    });
    expect(await moveLedgerRoot('/w/l', names, io)).toMatchObject({ kind: 'refused', message: 'a link' });
    expect(await moveLedgerRoot('/w/e', names, io)).toMatchObject({ kind: 'error', message: 'EACCES' });
  });

  it('turns a store call that throws into an error, never a throw', async () => {
    const { io } = fakeIO({ moves: { '/w/a': () => { throw new Error('boom'); } } });
    expect(await moveLedgerRoot('/w/a', names, io)).toEqual({ kind: 'error', root: '/w/a', message: 'boom' });
  });

  it('refuses a relative home directory or machine directory and calls nothing', async () => {
    const { io, rec } = fakeIO();
    expect(await moveLedgerRoot('/w/a', { ...names, homeDir: 'home/dean' }, io)).toMatchObject({ kind: 'error', root: '/w/a' });
    expect(await moveLedgerRoot('/w/a', { ...names, machineDir: '.devflow' }, io)).toMatchObject({ kind: 'error', root: '/w/a' });
    expect(rec.order).toEqual([]);
  });

  it('sweeps a backup after a move, as init does', async () => {
    const { io, rec } = fakeIO({ moves: { '/w/a': ok(MOVED) }, devflowEntries: { '/w/a': ['learning.backup-20260101'] } });
    await moveLedgerRoot('/w/a', names, io);
    expect(rec.order).toEqual(['move:/w/a', 'sweep:/w/a']);
  });

  it('describeOutcome gives a busy, refused or failed root one line and a clean move none', () => {
    expect(describeOutcome({ kind: 'busy', root: '/w/a' })).toEqual([
      'Ledger move skipped for /w/a: a lock is held. The project moves at its next session.',
    ]);
    expect(describeOutcome({ kind: 'busy', root: '/w/a', reason: 'claim' })).toEqual([
      'Ledger move skipped for /w/a: a queue claim holds the move. The project moves after Curate finishes.',
    ]);
    expect(describeOutcome({ kind: 'refused', root: '/w/a', message: 'a link' })).toEqual([expect.stringContaining('refused')]);
    expect(describeOutcome({ kind: 'skipped', root: '/w/a', reason: 'git-root-timed-out' })).toEqual([
      'Ledger move skipped for /w/a: git did not answer in time. Nothing was moved. The next init tries again.',
    ]);
    expect(describeOutcome({ kind: 'skipped', root: '/w/a', reason: 'tracked' })).toEqual([
      `Ledger move skipped for /w/a: ${MOVE_SKIP_NOTICE.tracked}`,
    ]);
    expect(describeOutcome({ kind: 'error', root: '/w/a', message: 'x' })).toHaveLength(1);
    expect(describeOutcome({ kind: 'unchanged', root: '/w/a', sweep: null })).toEqual([]);
  });

  it('describeOutcome prints a root and a message from the repository as one clean line', () => {
    const root = `/w/${HOSTILE}`;
    const message = `${root}/${HOSTILE}.txt is a symbolic link`;
    const outcomes: ProjectMoveOutcome[] = [
      { kind: 'busy', root },
      { kind: 'refused', root, message },
      { kind: 'error', root, message },
      { kind: 'skipped', root, reason: 'git-root-timed-out' },
      { kind: 'skipped', root, reason: 'tracked' },
      { kind: 'skipped', root, reason: 'unknown' },
      { kind: 'unchanged', root, sweep: { state: 'failed', message } },
      { kind: 'unchanged', root, sweep: { state: 'busy' } },
      { kind: 'moved', root, mode: 'moved-in', backup: null, rendered: false, notes: [], sweep: { state: 'failed', message } },
    ];
    for (const outcome of outcomes) {
      const lines = describeOutcome(outcome);
      expect(lines.length, outcome.kind).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, outcome.kind).not.toMatch(CONTROL_CHARACTER);
        expect(line, outcome.kind).toContain('evil');
      }
    }
  });

  it('describeMoveText strips C0, DEL and C1 and keeps a long message whole', () => {
    expect(describeMoveText(`a${HOSTILE}b`)).toBe('aevil?[31m?2J??nameb');
    const long = `/w/${'x'.repeat(300)}`;
    expect(describeMoveText(long)).toBe(long);
    expect(describeMoveText(null)).toBe('<null>');
  });
});

// ---------------------------------------------------------------------------
// The global tuning file (TP-14)
// ---------------------------------------------------------------------------

describe('moveGlobalTuningFile (TP-14)', () => {
  const OLD_FILE = path.join(MACHINE, 'learning.json');
  const NEW_FILE = path.join(MACHINE, 'curation.json');

  function fakeTuning(state: Record<string, TuningPathKind>, rename: RenameIfAbsentResult = { state: 'renamed' }) {
    const calls: string[] = [];
    const io: GlobalTuningMoveIO = {
      kindOf: async (target) => state[target] ?? 'absent',
      renameIfAbsent: async (from, to) => { calls.push(`${from} -> ${to}`); return rename; },
    };
    return { io, calls };
  }

  it('renames the old file when only the old name exists', async () => {
    const { io, calls } = fakeTuning({ [OLD_FILE]: 'file' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report.outcome).toEqual({ kind: 'renamed' });
    expect(report.lines).toEqual([]);
    expect(calls).toEqual([`${OLD_FILE} -> ${NEW_FILE}`]);
  });

  it('does nothing when there is no old file (the steady state), and probes nothing else', async () => {
    const { io, calls } = fakeTuning({ [NEW_FILE]: 'file' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report).toEqual({ outcome: { kind: 'none' }, lines: [] });
    expect(calls).toEqual([]);
  });

  it('keeps the new name with both present, leaves the old file, and logs one line', async () => {
    const { io, calls } = fakeTuning({ [OLD_FILE]: 'file', [NEW_FILE]: 'file' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report.outcome).toEqual({ kind: 'kept-new' });
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('learning.json');
    expect(report.lines[0]).toContain('curation.json');
    expect(calls).toEqual([]);
  });

  it('reads a rename that finds the new name taken (a race) as the both-present case', async () => {
    const { io } = fakeTuning({ [OLD_FILE]: 'file' }, { state: 'exists' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report.outcome).toEqual({ kind: 'kept-new' });
    expect(report.lines).toHaveLength(1);
  });

  it('leaves a link or a directory under the old name alone, with one line', async () => {
    const { io, calls } = fakeTuning({ [OLD_FILE]: 'other' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report.outcome).toEqual({ kind: 'left-alone' });
    expect(report.lines).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('says that the settings in a left-alone file no longer apply, and where to copy them', async () => {
    const { io } = fakeTuning({ [OLD_FILE]: 'other' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report.lines).toEqual([
      `The global tuning file ${OLD_FILE} is not a regular file. It was not renamed to curation.json, ` +
        'so its settings no longer apply. Copy them into curation.json.',
    ]);
  });

  describe('with a linked learning.json on the real file system', () => {
    let machine: string;

    afterEach(async () => {
      await fs.rm(machine, { recursive: true, force: true });
    });

    it('gives the settings line, follows no link and leaves the link and its target as they were', async () => {
      machine = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-move-tuning-link-')));
      const target = path.join(machine, 'elsewhere.json');
      const link = path.join(machine, 'learning.json');
      await fs.writeFile(target, '{"model":"opus"}\n');
      await fs.symlink(target, link);

      const report = await moveGlobalTuningFile(machine, realGlobalTuningMoveIO());

      expect(report.outcome).toEqual({ kind: 'left-alone' });
      expect(report.lines).toHaveLength(1);
      expect(report.lines[0]).toContain('its settings no longer apply');
      expect(report.lines[0]).toContain('Copy them into curation.json.');
      expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
      expect(await fs.readlink(link)).toBe(target);
      expect(await fs.readFile(target, 'utf-8')).toBe('{"model":"opus"}\n');
      await expect(fs.lstat(path.join(machine, 'curation.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('reports a failed rename as one line that says the next init tries again', async () => {
    const { io } = fakeTuning({ [OLD_FILE]: 'file' }, { state: 'failed', message: 'EACCES' });
    const report = await moveGlobalTuningFile(MACHINE, io);
    expect(report.outcome).toEqual({ kind: 'error', message: 'EACCES' });
    expect(report.lines[0]).toContain('EACCES');
    expect(report.lines[0]).toContain('next init');
  });

  it('turns a probe or a rename that throws into an error outcome, never a throw', async () => {
    const throwingProbe: GlobalTuningMoveIO = { kindOf: async () => { throw new Error('x'); }, renameIfAbsent: async () => ({ state: 'renamed' }) };
    expect((await moveGlobalTuningFile(MACHINE, throwingProbe)).outcome.kind).toBe('error');
    const throwingRename: GlobalTuningMoveIO = { kindOf: async (t) => (t === OLD_FILE ? 'file' : 'absent'), renameIfAbsent: async () => { throw new Error('y'); } };
    expect((await moveGlobalTuningFile(MACHINE, throwingRename)).outcome).toEqual({ kind: 'error', message: 'y' });
  });
});

// ---------------------------------------------------------------------------
// The whole init step (TP-8, caller)
// ---------------------------------------------------------------------------

describe('runInitCurationMove: the lines and the notice init prints', () => {
  const quietTuning: GlobalTuningMoveIO = { kindOf: async () => 'absent', renameIfAbsent: async () => ({ state: 'renamed' }) };

  it('prints nothing when nothing moved', async () => {
    const { io } = fakeIO();
    const report = await runInitCurationMove(options({ projectRoots: ['/w/a'] }), { ledger: io, tuning: quietTuning });
    expect(report).toEqual({ lines: [], notice: null, movedCount: 0 });
  });

  it('prints the move notice once, however many projects moved', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(MOVED), '/w/b': ok(MOVED), '/w/c': ok(MOVED) } });
    const report = await runInitCurationMove(options({ projectRoots: ['/w/a', '/w/b', '/w/c'] }), { ledger: io, tuning: quietTuning });
    expect(report.movedCount).toBe(3);
    expect(report.notice).toBe(moveNotice(3));
    expect(report.notice).toContain('3 projects');
    expect(report.notice).toContain('.devflow/learning/');
    expect(report.notice).toContain('.devflow/curation/');
    expect(report.lines).toEqual([]);
  });

  it('prints the line for a project whose lookup timed out, and no notice', async () => {
    const { io } = fakeIO({ timedOut: ['/w/stalled'] });
    const report = await runInitCurationMove(options({ projectRoots: ['/w/stalled'] }), { ledger: io, tuning: quietTuning });
    expect(report.movedCount).toBe(0);
    expect(report.notice).toBeNull();
    expect(report.lines).toEqual([expect.stringContaining('/w/stalled')]);
  });

  it('says "1 project" for one', () => {
    expect(moveNotice(1)).toContain('1 project ');
    expect(moveNotice(1)).not.toContain('projects');
  });

  it('puts the tuning-file line first, then one line per project that did not move, and keeps the exit code out of it', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(BUSY), '/w/b': fail('refused', 'a link'), '/w/c': ok(MOVED) } });
    const bothTuning: GlobalTuningMoveIO = { kindOf: async () => 'file', renameIfAbsent: async () => ({ state: 'renamed' }) };
    const report = await runInitCurationMove(options({ projectRoots: ['/w/a', '/w/b', '/w/c'] }), { ledger: io, tuning: bothTuning });
    expect(report.lines).toHaveLength(3);
    expect(report.lines[0]).toContain('curation.json');
    expect(report.lines[1]).toContain('/w/a');
    expect(report.lines[2]).toContain('/w/b');
    expect(report.movedCount).toBe(1);
    expect(report.notice).not.toBeNull();
  });

  it('turns bad options into one line and does not throw', async () => {
    const { io, rec } = fakeIO();
    const report = await runInitCurationMove(options({ homeDir: 'home/dean' }), { ledger: io, tuning: quietTuning });
    expect(report.lines).toHaveLength(1);
    expect(report.notice).toBeNull();
    expect(rec.order).toEqual([]);
  });

  it('renames the tuning file even when there is no project to move', async () => {
    const calls: string[] = [];
    const tuning: GlobalTuningMoveIO = {
      kindOf: async (t) => (t.endsWith('learning.json') ? 'file' : 'absent'),
      renameIfAbsent: async (from, to) => { calls.push(`${path.basename(from)}>${path.basename(to)}`); return { state: 'renamed' }; },
    };
    const { io } = fakeIO();
    await runInitCurationMove(options(), { ledger: io, tuning });
    expect(calls).toEqual(['learning.json>curation.json']);
  });
});

// ---------------------------------------------------------------------------
// Two movers on one root, under two spellings (TP-37), with the real store
// ---------------------------------------------------------------------------

describe('moveProjectLedgers with the real store: init and a session start meet at one lock (TP-37)', () => {
  let tmp: string | null = null;
  afterEach(async () => {
    if (tmp !== null) await fs.rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('skips a root whose move lock another mover holds, reached through a link spelling, with no wait', async () => {
    const loaded = loadCurationMove();
    if (!loaded.ok) throw new Error('the move module must load');
    const store = loaded.value;
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-move-tp37-')));
    const home = path.join(tmp, 'home');
    const machine = path.join(home, '.devflow');
    const parent = path.join(tmp, 'work');
    const repo = path.join(parent, 'repo');
    await fs.mkdir(path.join(repo, '.devflow', 'learning'), { recursive: true });
    await fs.writeFile(path.join(repo, '.devflow', 'learning', 'decisions-ledger.jsonl'), '{"anchor_id":"ADR-001"}\n');
    await fs.mkdir(machine, { recursive: true });
    // A second spelling of the same root: a link ABOVE it (a link AT the root is refused by design).
    const parentLink = path.join(tmp, 'work-link');
    await fs.symlink(parent, parentLink);
    const spelling = path.join(parentLink, 'repo');

    // The other mover (a session start) holds the lock under the physical spelling.
    const key = curationMoveLockKey(repo);
    const lockDir = path.join(machine, `.curation-move-${key}.lock`);
    await fs.mkdir(lockDir);

    const io: ProjectLedgerMoveIO = {
      ledgerRootOf: async (project) => ({ kind: 'root', root: project }),
      realpath: async (target) => fs.realpath(target).catch(() => null),
      readdir: async (dir) => fs.readdir(dir).catch(() => null),
      store,
      now: () => Date.now(),
    };
    const started = Date.now();
    const result = await moveProjectLedgers(
      { projectRoots: [spelling], ownLedgerRoot: null, homeDir: home, machineDir: machine },
      io,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(reportOf(result).outcomes).toEqual([{ kind: 'busy', root: spelling }]);
    // Nothing moved: the old folder is whole and no new folder exists.
    await expect(fs.stat(path.join(repo, '.devflow', 'learning', 'decisions-ledger.jsonl'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(repo, '.devflow', 'curation'))).rejects.toMatchObject({ code: 'ENOENT' });

    // With the lock released, the same init moves it, and a second pass is a no-op.
    await fs.rmdir(lockDir);
    const moved = await moveProjectLedgers(
      { projectRoots: [spelling, repo], ownLedgerRoot: null, homeDir: home, machineDir: machine },
      io,
    );
    expect(reportOf(moved).outcomes.map(o => o.kind)).toEqual(['moved']);
    expect(await fs.readFile(path.join(repo, '.devflow', 'curation', 'decisions-ledger.jsonl'), 'utf-8')).toBe('{"anchor_id":"ADR-001"}\n');
    await expect(fs.stat(path.join(repo, '.devflow', 'learning'))).rejects.toMatchObject({ code: 'ENOENT' });
    const again = await moveProjectLedgers(
      { projectRoots: [spelling, repo], ownLedgerRoot: null, homeDir: home, machineDir: machine },
      io,
    );
    expect(reportOf(again).outcomes.map(o => o.kind)).toEqual(['unchanged']);
  });
});

// ---------------------------------------------------------------------------
// A git that hangs (REL-2)
// ---------------------------------------------------------------------------

/** The first `git` on PATH, found before any fake is put in front of it. */
function findGitOnPath(): string {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'git');
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  throw new Error('git is not on PATH');
}

describe('moveProjectLedgers with the real I/O: a project whose git hangs (REL-2)', { timeout: 60_000 }, () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let tmp: string | null = null;
  let savedPath: string | undefined;

  afterEach(async () => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (tmp !== null) await fs.rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('skips the stalled project within the budget, names it, and moves the others', async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'df-move-hang-')));
    const stalled = path.join(tmp, 'stalled');
    const good = path.join(tmp, 'good');
    for (const repo of [stalled, good]) {
      await fs.mkdir(repo);
      execFileSync('git', ['init', '-q'], { cwd: repo });
    }
    // A git that sleeps in the stalled project and is the real git everywhere else. Only this
    // test puts it on PATH, and only for its length; HOME is not touched.
    const realGit = findGitOnPath();
    const bin = path.join(tmp, 'bin');
    await fs.mkdir(bin);
    writeFakeExecutable(path.join(bin, 'git'), `#!/bin/bash\ncase "$PWD" in\n  */stalled) exec sleep 30 ;;\nesac\nexec "${realGit}" "$@"\n`);
    savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`;

    const { io: fake, rec } = fakeIO({ moves: { [good]: ok(MOVED) } });
    const started = Date.now();
    const report = reportOf(await moveProjectLedgers(
      options({ projectRoots: [stalled, good] }),
      realProjectLedgerMoveIO(fake.store),
    ));

    expect(Date.now() - started, 'the stalled project costs one budget, not a hang').toBeLessThan(LEDGER_ROOT_TIMEOUT_MS + 5_000);
    expect(movedRoots(rec)).toEqual([good]);
    expect(report.movedCount).toBe(1);
    expect(report.outcomes.map(o => `${o.kind}:${path.basename(o.root)}`)).toEqual(['moved:good', 'skipped:stalled']);
    expect(report.lines).toEqual([expect.stringContaining(stalled)]);
  });
});
