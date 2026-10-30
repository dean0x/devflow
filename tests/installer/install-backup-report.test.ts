/**
 * The record of the backup session as the commands print it: the lines the formatter makes, and
 * the promise that every entry point prints the record once, after its steps return or throw and
 * before it returns, rethrows or exits. Every test works in a temp home, with the clock and the
 * random bytes injected, and nothing here reads or writes the real home.
 *
 * The toggle of the curation and compliance converge is replaced by a stand-in that moves a file
 * through the real session and then throws or answers `skipped`. Everything else is the real code.
 */
import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({
  events: [] as string[],
  toggle: null as null | ((opts: { backups: import('../../src/targets/claude-code/install-backup.js').BackupSession }) => Promise<unknown>),
}));

vi.mock('@clack/prompts', async importOriginal => {
  const actual = await importOriginal<typeof import('@clack/prompts')>();
  const line = (level: string) => (message: string): void => {
    recorded.events.push(`${level}: ${message}`);
  };
  return {
    ...actual,
    log: { ...actual.log, success: line('success'), info: line('info'), warn: line('warn'), error: line('error') },
  };
});

vi.mock('../../src/targets/claude-code/curation-install.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/targets/claude-code/curation-install.js')>();
  return {
    ...actual,
    applyVariantToggle: ((...args: Parameters<typeof actual.applyVariantToggle>) =>
      recorded.toggle === null ? actual.applyVariantToggle(...args) : recorded.toggle(args[0])) as typeof actual.applyVariantToggle,
  };
});

import { openBackupSession, openBackupSessionOrFail, runWithBackupReport, runWithLateBackupReport } from '../../src/cli/commands/backup-session.js';
import { applyComplianceChange } from '../../src/cli/commands/compliance.js';
import { convergeInstalledVariants } from '../../src/cli/commands/curation.js';
import { formatSweepSummary } from '../../src/cli/commands/init.js';
import { formatBackupSummary, type SummaryLine } from '../../src/cli/commands/install-report.js';
import { runRulesEnable } from '../../src/cli/commands/rules.js';
import { readManifest } from '../../src/core/manifest.js';
import type { BackupSession, BackupSnapshot } from '../../src/targets/claude-code/install-backup.js';
import { ROOT, testBackups } from '../helpers.js';
import { assertTempHome, TEMP_HOME_PREFIX } from '../setup/home-isolation.js';

let home: string;
let claudeDir: string;
let devflowDir: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_HOME_PREFIX));
  assertTempHome(home);
  console.log(`install-backup-report test home: ${await fs.realpath(home)}`);
  claudeDir = path.join(home, 'claude');
  devflowDir = path.join(home, 'devflow');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(devflowDir, { recursive: true });
  recorded.events.length = 0;
  recorded.toggle = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

const at = (rel: string): string => path.join(claudeDir, ...rel.split('/'));

async function put(rel: string, text = rel): Promise<string> {
  const target = at(rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
  return target;
}

const open = (): Promise<BackupSession> => testBackups(home, { claudeDir, devflowDir });

/** A file devflow does not ship, moved aside by the session the way the install would move it. */
async function moveOneFile(session: BackupSession, name = 'mine.md'): Promise<void> {
  await put(`commands/devflow/${name}`);
  await session.prepass([at('commands/devflow')]);
}

const EMPTY: BackupSnapshot = {
  backupRoot: '/home/u/.devflow/install-backups',
  runFolder: null,
  moved: [],
  retiredRemoved: [],
  failures: [],
  capHits: [],
  rootRefusal: null,
};
const RUN = '/home/u/.devflow/install-backups/20261030T120000Z-01010101';
const unit = (name: string, kind: 'file' | 'directory' = 'file'): BackupSnapshot['moved'][number] => ({
  original: `/home/u/.claude/commands/devflow/${name}`,
  backup: `${RUN}/commands/devflow/${name}`,
  kind,
});
const messages = (lines: readonly SummaryLine[]): string[] => lines.map(l => l.message);
const movedLines = (events: readonly string[]): string[] => events.filter(e => e.includes('item(s) that devflow does not ship'));
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

describe('formatBackupSummary', () => {
  it('gives no lines for an empty snapshot', () => {
    expect(formatBackupSummary(EMPTY)).toEqual([]);
  });

  it('names five moved units and counts the rest, with the run folder on one line', () => {
    const moved = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => unit(`${name}.md`));
    const lines = formatBackupSummary({ ...EMPTY, runFolder: RUN, moved });

    expect(lines).toHaveLength(2);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message.startsWith('Moved 7 item(s) that devflow does not ship out of its folders: ')).toBe(true);
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      expect(lines[0].message).toContain(`/home/u/.claude/commands/devflow/${name}.md -> ${RUN}/commands/devflow/${name}.md`);
    }
    expect(lines[0].message).not.toContain('f.md');
    expect(lines[0].message.endsWith(', 2 more')).toBe(true);
    expect(lines[1]).toEqual({ level: 'info', message: `Backup folder: ${RUN}` });
    expect(lines.filter(l => l.message.startsWith('Backup folder:'))).toHaveLength(1);
  });

  it('names every unit and no "more" when there are five or fewer', () => {
    const lines = formatBackupSummary({ ...EMPTY, runFolder: RUN, moved: [unit('a.md'), unit('b.md')] });
    expect(lines[0].message).toContain('Moved 2 item(s)');
    expect(lines[0].message).not.toContain('more');
  });

  it('counts a moved folder once, whatever it holds, and shows it with a trailing slash', async () => {
    const session = await open();
    await put('skills/python/SKILL.md');
    await put('skills/python/references/one.md');
    await put('skills/python/references/two.md');
    await session.prepass([at('skills')]);

    const snapshot = session.snapshot();
    expect(snapshot.moved).toHaveLength(1);
    expect(snapshot.moved[0].kind).toBe('directory');
    const [moved] = formatBackupSummary(snapshot);
    expect(moved.message).toContain('Moved 1 item(s)');
    expect(moved.message).toContain(`${at('skills/python')}/ -> ${snapshot.moved[0].backup}/`);
    expect(moved.message).not.toContain('SKILL.md');
  });

  it('prints ESC and C1 characters escaped in every name and keeps raw controls out of the lines', () => {
    const lines = formatBackupSummary({
      ...EMPTY,
      runFolder: `${RUN}\u001b[2J`,
      moved: [unit('esc\u001b[31m.md'), unit('csi\u009b.md')],
      retiredRemoved: ['/home/u/.claude/commands/devflow/old\u001b.md'],
      failures: [{ path: '/home/u/.claude/rules/devflow/bad\u009d.md', action: 'move', reason: 'E\u001bX' }],
      capHits: [{ folder: '/home/u/.claude/skills/big\u001b', entries: 12, cap: 10 }],
      rootRefusal: { path: '/home/u/.devflow/install-backups\u009b', reason: 'not-a-directory' },
    });

    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const line of lines) expect(line.message).not.toMatch(CONTROL);
    const all = messages(lines).join('\n');
    expect(all).toContain('esc\\x1b[31m.md');
    expect(all).toContain('csi\\x9b.md');
    expect(all).toContain('old\\x1b.md');
    expect(all).toContain('bad\\x9d.md');
    expect(all).toContain('E\\x1bX');
    expect(all).toContain('big\\x1b');
    expect(all).toContain('install-backups\\x9b');
  });

  it('keeps the name on disk unchanged when the printed form is escaped', async () => {
    const session = await open();
    await moveOneFile(session, 'e\u001bsc.md');
    const [unitMoved] = session.snapshot().moved;
    expect(path.basename(unitMoved.original)).toBe('e\u001bsc.md');
    expect(await fs.readFile(unitMoved.backup, 'utf8')).toBe('commands/devflow/e\u001bsc.md');
    expect(messages(formatBackupSummary(session.snapshot())).join('\n')).toContain('e\\x1bsc.md');
  });

  it('lists the retired files on their own line, five then the count of the rest', () => {
    const retiredRemoved = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(name => `/home/u/.claude/commands/devflow/${name}.md`);
    const lines = formatBackupSummary({ ...EMPTY, retiredRemoved });

    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message.startsWith('Removed 8 retired devflow file(s): ')).toBe(true);
    expect(lines[0].message).toContain('e.md');
    expect(lines[0].message).not.toContain('f.md');
    expect(lines[0].message.endsWith(', 3 more')).toBe(true);
  });

  it('warns once per failure, per cap hit and for a refused root, each at warn level', () => {
    const lines = formatBackupSummary({
      ...EMPTY,
      failures: [
        { path: '/c/a.md', action: 'move', reason: 'EXDEV' },
        { path: '/c/dir', action: 'scan', reason: 'EACCES' },
        { path: '/c/old.md', action: 'remove', reason: 'EBUSY' },
      ],
      capHits: [{ folder: '/c/commands/devflow', entries: 10_001, cap: 10_000 }],
      rootRefusal: { path: '/d/install-backups', reason: 'not-a-directory' },
    });

    expect(lines.map(l => l.level)).toEqual(['warn', 'warn', 'warn', 'warn', 'warn']);
    expect(lines[0].message).toContain('Could not move /c/a.md');
    expect(lines[0].message).toContain('EXDEV');
    expect(lines[1].message).toContain('Could not scan /c/dir');
    expect(lines[2].message).toContain('Could not remove /c/old.md');
    expect(lines[3].message).toContain('/c/commands/devflow holds 10001 entries, more than the limit of 10000');
    expect(lines[4].message).toContain('Could not use the backup folder /d/install-backups (not-a-directory)');
  });

  it('keeps the moves out of the orphan count of the sweep summary', async () => {
    const session = await open();
    await moveOneFile(session, 'mine-1.md');
    await moveOneFile(session, 'mine-2.md');
    await moveOneFile(session, 'mine-3.md');
    const snapshot = session.snapshot();
    expect(snapshot.moved).toHaveLength(3);

    const sweep = formatSweepSummary({
      sweptOrphans: [{ kind: 'agent', name: 'resolver' }, { kind: 'command', name: 'audit-claude' }],
      sweepFailures: [],
    });
    expect(sweep).toHaveLength(1);
    expect(sweep[0].message).toContain('Removed 2 orphaned asset(s)');
    expect(sweep[0].message).not.toContain('mine-');
    expect(formatSweepSummary({ sweptOrphans: [], sweepFailures: [] })).toEqual([]);
    expect(formatBackupSummary(snapshot)[0].message).toContain('Moved 3 item(s)');
  });

  it('prints no removed name on both the retired line and the orphan line', async () => {
    const session = await open();
    await put('commands/devflow/audit-claude.md');
    await put('commands/devflow/ambient.md');
    await session.prepass([at('commands/devflow')]);
    await session.removeListed(at('commands/devflow'));
    const snapshot = session.snapshot();
    expect(snapshot.retiredRemoved.map(file => path.basename(file)).sort()).toEqual(['ambient.md', 'audit-claude.md']);

    const sweptNames = ['resolver', 'catch-up-old'];
    const retiredLine = formatBackupSummary(snapshot).find(l => l.message.startsWith('Removed 2 retired devflow file(s)'));
    const sweepLine = formatSweepSummary({
      sweptOrphans: sweptNames.map(name => ({ kind: 'command' as const, name })),
      sweepFailures: [],
    })[0];
    expect(retiredLine).toBeDefined();
    expect(sweepLine).toBeDefined();

    const printed = [retiredLine?.message ?? '', sweepLine.message];
    for (const name of ['audit-claude', 'ambient', ...sweptNames]) {
      expect(printed.filter(line => line.includes(name)), `${name} prints on one line only`).toHaveLength(1);
    }
    expect(snapshot.moved).toEqual([]);
  });
});

describe('the backup report wrappers', () => {
  it('prints the record once after the steps return, and prints nothing for a run that moved nothing', async () => {
    const lines: string[][] = [];
    const emit = (out: readonly SummaryLine[]): void => { lines.push(messages(out)); };
    const session = await open();

    const result = await runWithBackupReport(session, async () => 'done', emit);
    expect(result).toBe('done');
    expect(lines).toEqual([[]]);

    await runWithBackupReport(session, async () => { await moveOneFile(session); }, emit);
    expect(lines).toHaveLength(2);
    expect(lines[1][0]).toContain('Moved 1 item(s)');
    expect(lines[1][0]).toContain('mine.md');
  });

  it('prints the record, then rethrows the same error, when the steps throw after a move', async () => {
    const order: string[] = [];
    const emit = (out: readonly SummaryLine[]): void => { order.push(`print: ${out[0]?.message ?? ''}`); };
    const session = await open();
    const failure = new Error('the install failed');

    await expect(
      runWithBackupReport(session, async () => {
        await moveOneFile(session);
        throw failure;
      }, emit),
    ).rejects.toBe(failure);
    order.push('after');

    expect(order).toHaveLength(2);
    expect(order[0]).toContain('Moved 1 item(s)');
    expect(order[1]).toBe('after');
  });

  it('prints an install that fails after a move before the exit callback runs, once', async () => {
    const order: string[] = [];
    const emit = (out: readonly SummaryLine[]): void => { for (const l of out) order.push(`print: ${l.message}`); };
    const exit = (): void => { order.push('exit'); };
    const session = await open();

    await expect(
      runWithLateBackupReport(async report => {
        report.begin(session);
        try {
          await moveOneFile(session);
          throw new Error('install failed');
        } catch {
          report.print();
          exit();
          throw new Error('the exit stopped the run');
        }
      }, emit),
    ).rejects.toThrow('the exit stopped the run');

    expect(order.findIndex(entry => entry.includes('mine.md'))).toBe(0);
    expect(order.indexOf('exit')).toBeGreaterThan(0);
    expect(order.filter(entry => entry.startsWith('print: Moved'))).toHaveLength(1);
    expect(order.filter(entry => entry.startsWith('print: Backup folder'))).toHaveLength(1);
  });

  it('prints nothing for a run that never names a session', async () => {
    const emit = vi.fn();
    await runWithLateBackupReport(async () => 'no session', emit);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('init prints the record ahead of its exit and ahead of the sweep summary', () => {
  const init = readFileSync(path.join(ROOT, 'src', 'cli', 'commands', 'init.ts'), 'utf8');

  it('prints before process.exit in the install catch', () => {
    const catchAt = init.indexOf("s.stop('Installation failed');\n      p.log.error(`${error}`);");
    expect(catchAt).toBeGreaterThan(-1);
    const block = init.slice(catchAt, init.indexOf('process.exit(1);', catchAt));
    expect(block).toContain('backupReport.print();');
  });

  it('prints the record before the sweep summary and makes one session for the run', () => {
    const printed = init.indexOf('backupReport.print();\n\n    // The curation move');
    expect(printed).toBeGreaterThan(-1);
    expect(printed).toBeLessThan(init.indexOf('logSummaryLines(formatSweepSummary(installReport));'));
    expect(init.match(/openBackupSession\(/g)).toHaveLength(1);
  });
});

describe('the curation toggle', () => {
  it('names a file moved before a throw ahead of the warning, once, and answers not-converged', async () => {
    const session = await open();
    recorded.toggle = async opts => {
      await put('commands/devflow/mine.md');
      await opts.backups.prepass([at('commands/devflow')]);
      throw new Error('converge failed');
    };

    const outcome = await convergeInstalledVariants(true, session);

    expect(outcome).toBe('not-converged');
    const moved = movedLines(recorded.events);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain('mine.md');
    const warning = recorded.events.findIndex(e => e.startsWith('warn: Could not update the installed prompts'));
    expect(warning).toBeGreaterThan(recorded.events.indexOf(moved[0]));
  });

  it('prints nothing when the toggle moves nothing', async () => {
    const session = await open();
    recorded.toggle = async () => ({ kind: 'skipped', message: 'the installed version differs' });

    await convergeInstalledVariants(true, session);

    expect(movedLines(recorded.events)).toEqual([]);
    expect(recorded.events).toEqual(['warn: the installed version differs']);
  });
});

describe('the compliance toggle', () => {
  async function seedManifest(): Promise<NonNullable<Awaited<ReturnType<typeof readManifest>>>> {
    await fs.writeFile(
      path.join(devflowDir, 'manifest.json'),
      JSON.stringify({
        version: '0.0.0',
        plugins: ['devflow-core-skills'],
        scope: 'user',
        features: {
          ambient: false, memory: false, hud: false, knowledge: true, curation: true, learning: true, rules: false,
          compliance: { enabled: true, frameworks: ['gdpr'] },
        },
        installedAt: '2026-10-10T00:00:00.000Z',
        updatedAt: '2026-10-10T00:00:00.000Z',
      }),
    );
    const manifest = await readManifest(devflowDir);
    if (manifest === null) throw new Error('the seeded manifest did not read');
    return manifest;
  }

  it('names a file moved before an exit-1 result, once', async () => {
    const session = await open();
    const manifest = await seedManifest();
    recorded.toggle = async opts => {
      await put('commands/devflow/mine.md');
      await opts.backups.prepass([at('commands/devflow')]);
      return { kind: 'skipped', message: 'the installed version differs' };
    };

    const result = await applyComplianceChange({
      claudeDir,
      devflowDir,
      manifest,
      action: 'disable',
      runningVersion: '1.0.0',
      warn: () => undefined,
      backups: session,
    });

    expect(result.exitCode).toBe(1);
    const moved = movedLines(recorded.events);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain('mine.md');
    expect(recorded.events.filter(e => e.startsWith('info: Backup folder:'))).toHaveLength(1);
  });

  it('names a file moved before an exit-1 result of the switch record, once', async () => {
    const session = await open();
    const manifest = await seedManifest();
    await moveOneFile(session);
    await fs.rm(path.join(devflowDir, 'manifest.json'));

    const result = await applyComplianceChange({
      claudeDir,
      devflowDir,
      manifest,
      action: 'disable',
      runningVersion: '1.0.0',
      warn: () => undefined,
      backups: session,
    });

    expect(result.exitCode).toBe(1);
    expect(movedLines(recorded.events)).toHaveLength(1);
  });
});

describe('the rules enable', () => {
  it('names a file moved before the exit of a missing manifest, ahead of the exit', async () => {
    const session = await open();
    await moveOneFile(session);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      recorded.events.push(`exit ${String(code)}`);
      throw new Error('process.exit');
    }) as typeof process.exit);

    await expect(runRulesEnable(claudeDir, devflowDir, session)).rejects.toThrow('process.exit');

    const moved = movedLines(recorded.events);
    expect(moved).toHaveLength(1);
    expect(recorded.events.indexOf(moved[0])).toBeLessThan(recorded.events.indexOf('exit 1'));
    expect(recorded.events.some(e => e.startsWith('error: No manifest found'))).toBe(true);
  });
});

describe('opening the session', () => {
  it('makes a session that moves nothing at once and makes no folder before the first move', async () => {
    const opened = await openBackupSession({ claudeDir, devflowDir });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.session.snapshot().moved).toEqual([]);
      expect(opened.session.snapshot().runFolder).toBeNull();
    }
    await expect(fs.lstat(path.join(devflowDir, 'install-backups'))).rejects.toThrow();
  });

  it('answers one message and no session when the shipped set cannot be built', async () => {
    const emptyPackage = path.join(home, 'empty-package');
    await fs.mkdir(emptyPackage, { recursive: true });

    const opened = await openBackupSession({ claudeDir, devflowDir, packageRoot: emptyPackage });

    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.message.startsWith('Could not list the files devflow ships, so nothing was changed: ')).toBe(true);
  });

  it('prints one error line and sets exit code 1 when the shipped set cannot be built', async () => {
    const emptyPackage = path.join(home, 'empty-package');
    await fs.mkdir(emptyPackage, { recursive: true });
    const before = process.exitCode;
    try {
      const session = await openBackupSessionOrFail({ claudeDir, devflowDir, packageRoot: emptyPackage });
      expect(session).toBeNull();
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = before;
    }
    expect(recorded.events).toHaveLength(1);
    expect(recorded.events[0].startsWith('error: Could not list the files devflow ships')).toBe(true);
  });
});
