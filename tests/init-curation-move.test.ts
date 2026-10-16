// tests/init-curation-move.test.ts
//
// The init step that moves each project's ledger folder to the curation name
// (src/cli/commands/init-curation-move.ts). The step takes its path probes, its
// store seam and its clock as parameters, so every test here injects fakes: no
// test touches a real folder, the real HOME or the real store. Nothing in
// init.ts calls the step yet; these tests are its only caller.

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  moveProjectLedgers,
  MOVE_POOL_LIMIT,
  type ProjectLedgerMoveIO,
  type ProjectLedgerMoveOptions,
  type ProjectLedgerMoveReport,
  type ProjectLedgerMoveResult,
} from '../src/cli/commands/init-curation-move.js';
import type {
  LearningStoreResult,
  LedgerMoveOptions,
  LedgerMoveOutcome,
  LedgerSweepOutcome,
} from '../src/core/learning-store.js';

const HOME = '/home/dean';
const MACHINE = '/home/dean/.devflow';
const OLD = 'learning';
const NEW = 'curation';
const NOW = 1_700_000_000_000;

const NONE: LedgerMoveOutcome = { state: 'none', notes: [] };
const BUSY: LedgerMoveOutcome = { state: 'busy', notes: [] };
const MOVED: LedgerMoveOutcome = { state: 'moved', mode: 'whole-folder', backup: null, rendered: true, notes: [] };
const SWEPT: LedgerSweepOutcome = { state: 'swept', files: 1, merged: 2, overflowed: 0, notes: [] };

const ok = <T>(value: T): LearningStoreResult<T> => ({ ok: true, value });
const fail = <T>(kind: string, message: string): LearningStoreResult<T> => ({ ok: false, error: { kind, message } });

function options(overrides: Partial<ProjectLedgerMoveOptions> = {}): ProjectLedgerMoveOptions {
  return {
    projectRoots: [],
    ownLedgerRoot: null,
    homeDir: HOME,
    machineDir: MACHINE,
    oldName: OLD,
    newName: NEW,
    ...overrides,
  };
}

interface FakeConfig {
  /** Project root -> ledger root; a missing key is its own ledger root, null is "git root is null". */
  readonly ledgerRoots?: Readonly<Record<string, string | null>>;
  /** Path -> physical path; a missing key is its own physical path. */
  readonly physical?: Readonly<Record<string, string>>;
  /** Ledger root -> entries of its .devflow folder; a missing key lists nothing. */
  readonly devflowEntries?: Readonly<Record<string, readonly string[]>>;
  /** Ledger root -> the move answer, or a function that answers per call; a missing key answers `none`. */
  readonly moves?: Readonly<Record<string, LearningStoreResult<LedgerMoveOutcome> | (() => LearningStoreResult<LedgerMoveOutcome>)>>;
  readonly sweeps?: Readonly<Record<string, LearningStoreResult<LedgerSweepOutcome> | (() => LearningStoreResult<LedgerSweepOutcome>)>>;
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
  const answer = <T>(table: Readonly<Record<string, LearningStoreResult<T> | (() => LearningStoreResult<T>)>> | undefined, root: string, fallback: T) => {
    const entry = table?.[root];
    if (entry === undefined) return ok(fallback);
    return typeof entry === 'function' ? entry() : entry;
  };
  const io: ProjectLedgerMoveIO = {
    ledgerRootOf: async (project) => (project in (config.ledgerRoots ?? {}) ? config.ledgerRoots![project] : project),
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
        return project;
      },
    };
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/bad', '/w/a'] }), throwing));
    expect(movedRoots(rec)).toEqual(['/w/a']);
    expect(report.outcomes).toHaveLength(1);
  });
});

describe('moveProjectLedgers: what each project asks of the store', () => {
  it('passes the two names, the machine directory, the home directory and the clock to the move', async () => {
    const { io, rec } = fakeIO();
    await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io);
    expect(rec.moveArgs).toEqual([
      { root: '/w/a', opts: { oldName: OLD, newName: NEW, machineDir: MACHINE, homeDir: HOME, now: NOW } },
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
    expect(rec.sweepArgs[0].opts).toEqual({ oldName: OLD, newName: NEW, machineDir: MACHINE, homeDir: HOME, now: NOW });
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

  it('prints one line for a busy project and moves it at its next event', async () => {
    const { io } = fakeIO({ moves: { '/w/a': ok(BUSY) } });
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: ['/w/a'] }), io));
    expect(report.outcomes[0]).toEqual({ kind: 'busy', root: '/w/a' });
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toContain('/w/a');
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
        return project;
      },
    };
    const projects = Array.from({ length: 50 }, (_, i) => `/w/p${i}`);
    const report = reportOf(await moveProjectLedgers(options({ projectRoots: projects }), slow));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MOVE_POOL_LIMIT);
    expect(movedRoots(rec)).toEqual(projects);
    expect(report.outcomes).toHaveLength(50);
  });

  it.each([
    ['equal names', { oldName: 'curation', newName: 'curation' }],
    ['an empty old name', { oldName: '', newName: 'curation' }],
    ['an empty new name', { oldName: 'learning', newName: '' }],
    ['a name with a path separator', { oldName: 'learning', newName: 'a/b' }],
    ['a dot name', { oldName: '.', newName: 'curation' }],
    ['a dot-dot name', { oldName: 'learning', newName: '..' }],
  ])('refuses %s and calls nothing', async (_label, names) => {
    const { io, rec } = fakeIO();
    const result = await moveProjectLedgers(options({ projectRoots: ['/w/a'], ...names }), io);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-input');
    expect(rec.order).toEqual([]);
    expect(rec.physicalAsked).toEqual([]);
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
