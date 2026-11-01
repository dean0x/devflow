/**
 * tests/evidence-policy/resolve-root.test.ts
 *
 * Suite for src/assets/scripts/resolve-root.cjs — the one call a prompt makes to learn
 * the checkout root (`WORKTREE`) and the ledger root (`LEDGER`). The git half of the
 * answer is resolve-settings.cjs's own (gitToplevel, ledgerRootOf), so this suite
 * holds the script to what it adds:
 *
 *   - the answer from a root, a subdirectory, a linked worktree and outside a
 *     repository, run as a real subprocess on real git;
 *   - the ledger rule matches the one the hooks apply (df_resolve_roots);
 *   - every failure is closed: nothing on stdout, one reason line on stderr, an exit
 *     code that is not 0;
 *   - the boundary: main() never throws, runs git by argv with no shell, and the
 *     boundary prints only a line that passes the grammar.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ARGV, realGit, runResolver, scopedEnv, scriptedExec, type ExecFn, type ScriptedCall } from './scripted-shim.js';

const ROOT_SCRIPT = path.resolve(import.meta.dirname, '../../src/assets/scripts/resolve-root.cjs');
const PROJECT_ROOT_HELPER = path.resolve(import.meta.dirname, '../../src/assets/scripts/hooks/resolve-project-root');

interface Outcome {
  readonly code: number;
  readonly line: string;
}

interface RootScript {
  readonly EXIT_CODES: Readonly<Record<'RESOLVED' | 'USAGE' | 'INPUT_UNUSABLE' | 'INTERNAL_ERROR', number>>;
  readonly OUTPUT_RE: RegExp;
  readonly main: (argv: readonly string[], deps?: { exec?: ExecFn }) => Outcome;
  readonly settleOutcome: (outcome: unknown) => Outcome;
}

const rootScript = createRequire(import.meta.url)(ROOT_SCRIPT) as RootScript;

const SETTINGS_SCRIPT = path.resolve(import.meta.dirname, '../../src/assets/scripts/resolve-settings.cjs');
const settingsScript = createRequire(import.meta.url)(SETTINGS_SCRIPT) as {
  readonly gitToplevel: (exec: ExecFn, dir: string) => unknown;
};

const COMMON_DIR_ARGV = ['rev-parse', '--path-format=absolute', '--git-common-dir'];

describe('resolve-root.cjs on real git', { timeout: 60_000 }, () => {
  let base: string;
  let home: string;
  let main: string;
  let sub: string;
  let wt: string;
  let plain: string;
  let plainWt: string;
  let outside: string;

  /** The answer the script prints for a checkout whose root is `worktree` and ledger is `ledger`. */
  const answer = (worktree: string, ledger: string): string => `WORKTREE=${worktree}\nLEDGER=${ledger}\n`;

  /** Run the script as a subprocess: `dir` is its argument (none when undefined), `cwd` its working directory. */
  const run = (dir: string | undefined, cwd: string = home, runHome: string = home) =>
    runResolver({ home: runHome, args: dir === undefined ? [] : [dir], cwd, script: ROOT_SCRIPT });

  const initRepo = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true });
    realGit(dir, home, ['init', '-q']);
    realGit(dir, home, ['commit', '-q', '--allow-empty', '-m', 'init']);
  };

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-root-')));
    home = path.join(base, 'home');
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });

    // A main checkout that holds the ledger, a subdirectory of it and a linked worktree.
    main = path.join(base, 'main');
    initRepo(main);
    fs.mkdirSync(path.join(main, '.devflow', 'curation'), { recursive: true });
    sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    wt = path.join(base, 'wt');
    realGit(main, home, ['worktree', 'add', '-q', wt, '-b', 'feat']);

    // A main checkout with no `.devflow/` folder, and a linked worktree of it.
    plain = path.join(base, 'plain');
    initRepo(plain);
    plainWt = path.join(base, 'plain-wt');
    realGit(plain, home, ['worktree', 'add', '-q', plainWt, '-b', 'feat']);

    outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('names the checkout as both roots from a main checkout root', () => {
    const r = run(main);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(answer(main, main));
  });

  it('names the toplevel from a subdirectory, and takes cwd when given no argument', () => {
    expect(run(sub).stdout).toBe(answer(main, main));
    const fromCwd = run(undefined, sub);
    expect(fromCwd.status).toBe(0);
    expect(fromCwd.stdout).toBe(answer(main, main));
  });

  it('names the worktree as WORKTREE and the main worktree as LEDGER from a linked worktree that has a ledger', () => {
    const r = run(wt);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(answer(wt, main));
  });

  it('names the worktree for both roots when the main worktree holds no `.devflow/` folder', () => {
    const r = run(plainWt);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(answer(plainWt, plainWt));
  });

  it('keeps the ledger in the linked worktree when the main worktree is HOME (a dotfiles repository)', () => {
    // HOME's `.devflow/` is the machine root and always exists, so the folder test alone would name it.
    fs.mkdirSync(path.join(main, '.devflow'), { recursive: true });
    const r = run(wt, home, main);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(answer(wt, wt));
  });

  it('names the absolute form of the directory for both roots outside a repository', () => {
    const r = run(outside);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(answer(outside, outside));
    const relative = run('outside', base);
    expect(relative.status).toBe(0);
    expect(relative.stdout).toBe(answer(outside, outside));
  });

  it('prints a checkout path that holds spaces as it is', () => {
    const spaced = path.join(base, 'my repo');
    initRepo(spaced);
    const r = run(spaced);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(answer(spaced, spaced));
  });

  it('agrees with the ledger root the hooks apply, from a root, a subdirectory and a linked worktree', () => {
    const hookLedger = (cwd: string): string => spawnSync(
      'bash',
      ['-c', 'source "$1"; df_resolve_roots "$2"; printf %s "$DF_LEDGER_ROOT"', '_', PROJECT_ROOT_HELPER, cwd],
      { encoding: 'utf-8', env: scopedEnv(home) },
    ).stdout;
    for (const start of [main, sub, wt, plainWt]) {
      const ledger = /^LEDGER=(.*)$/m.exec(run(start).stdout)?.[1];
      expect(ledger, start).toBe(hookLedger(start));
    }
  });

  describe('fails closed: nothing on stdout, one reason line on stderr, a non-zero exit', () => {
    const expectClosed = (r: { stdout: string; stderr: string; status: number | null }, status: number): void => {
      expect(r.stdout).toBe('');
      expect(r.status).toBe(status);
      expect(r.stderr.trimEnd().split('\n'), r.stderr).toHaveLength(1);
      expect(r.stderr).toMatch(/^resolve-root: /);
    };

    it('refuses a directory that does not exist, and one that is a file', () => {
      expectClosed(run(path.join(base, 'missing')), 2);
      const file = path.join(base, 'a-file');
      fs.writeFileSync(file, 'x\n');
      expectClosed(run(file), 2);
    });

    it.each([
      ['a newline', '\n'],
      ['a carriage return', '\r'],
      ['a tab', '\t'],
      ['an escape character', '\x1b'],
    ])('refuses a directory path with %s in it', (_label, control) => {
      const dir = path.join(base, `bad${control}name`);
      fs.mkdirSync(dir);
      expectClosed(run(dir), 2);
    });

    it('refuses a directory path with a control character inside a repository', () => {
      const dir = path.join(main, `bad\nname`);
      fs.mkdirSync(dir);
      expectClosed(run(dir), 2);
    });

    it('refuses two arguments and a flag, as a usage error', () => {
      for (const args of [[main, sub], ['--help']]) {
        const r = runResolver({ home, args, script: ROOT_SCRIPT });
        expect(r.stdout, args.join(' ')).toBe('');
        expect(r.status, args.join(' ')).toBe(1);
        expect(r.stderr, args.join(' ')).toContain('Usage: node resolve-root.cjs [<dir>]');
      }
    });

    it('fails when git is not installed on the path', () => {
      const emptyBin = path.join(base, 'empty-bin');
      fs.mkdirSync(emptyBin, { recursive: true });
      const r = spawnSync(process.execPath, [ROOT_SCRIPT, main], {
        cwd: home,
        env: { ...scopedEnv(home), PATH: emptyBin },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
      expectClosed({ stdout: r.stdout, stderr: r.stderr, status: r.status }, 4);
    });
  });
});

describe('resolve-root.cjs main() with an injected exec', () => {
  let base: string;
  let linked: string;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-root-unit-')));
    // A `.git` entry that is a file, as a linked worktree has: it makes the ledger rule ask git.
    linked = path.join(base, 'linked');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, '.git'), 'gitdir: /nowhere\n');
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  const quiet = (): string[] => {
    const lines: string[] = [];
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    return lines;
  };

  const argv = (dir: string): string[] => ['node', 'resolve-root.cjs', dir];

  const toplevel = (stdout: string, exit = 0): ScriptedCall => ({ tool: 'git', args: ARGV.toplevel, stdout, exit });

  it('reads the toplevel when git cannot name the ledger root', () => {
    const errors = quiet();
    const { exec, recorded } = scriptedExec([
      toplevel(`${linked}\n`),
      { tool: 'git', args: COMMON_DIR_ARGV, exit: 128, stderr: 'fatal: not a git repository\n' },
    ]);
    expect(rootScript.main(argv(linked), { exec })).toEqual({
      code: 0,
      line: `WORKTREE=${linked}\nLEDGER=${linked}`,
    });
    expect(errors).toEqual([]);
    // Local git reads by argv: no shell, and nothing but git.
    expect(recorded.map(c => c.file)).toEqual(['git', 'git']);
    expect(recorded.every(c => c.opts.shell === false)).toBe(true);
  });

  it('runs every git call with no time limit of its own, while resolve-settings keeps its limit', () => {
    quiet();
    const calls: ScriptedCall[] = [
      toplevel(`${linked}\n`),
      { tool: 'git', args: COMMON_DIR_ARGV, exit: 128, stderr: 'fatal: not a git repository\n' },
    ];
    const resolved = scriptedExec(calls);
    expect(rootScript.main(argv(linked), { exec: resolved.exec }).code).toBe(0);
    // Both reads ran (the toplevel and the ledger root), so the loop below is not empty.
    expect(resolved.recorded).toHaveLength(2);
    for (const call of resolved.recorded) {
      expect(call.opts.timeout, call.args.join(' ')).toBeUndefined();
      expect(typeof call.opts.maxBuffer, call.args.join(' ')).toBe('number');
    }
    // The limit the script removes is the one resolve-settings.cjs puts on the same call.
    const direct = scriptedExec(calls);
    settingsScript.gitToplevel(direct.exec, linked);
    expect(direct.recorded).toHaveLength(1);
    expect(direct.recorded[0].opts.timeout).toBe(5000);
  });

  it('names the directory for both roots when git answers that it is not a repository', () => {
    quiet();
    const { exec } = scriptedExec([toplevel('', 128)]);
    expect(rootScript.main(argv(base), { exec })).toEqual({ code: 0, line: `WORKTREE=${base}\nLEDGER=${base}` });
  });

  it.each([
    ['cannot be started', 'ENOENT'],
    ['times out', 'ETIMEDOUT'],
  ])('fails closed with exit 4 when git %s', (_label, spawnError) => {
    const errors = quiet();
    const { exec } = scriptedExec([{ tool: 'git', args: ARGV.toplevel, spawnError }]);
    expect(rootScript.main(argv(base), { exec })).toEqual({ code: 4, line: '' });
    expect(errors).toEqual(['resolve-root: git did not answer — failing closed\n']);
  });

  it('fails closed with exit 4 when git answers with a path that is not absolute', () => {
    const errors = quiet();
    const { exec } = scriptedExec([toplevel('relative/path\n')]);
    expect(rootScript.main(argv(base), { exec })).toEqual({ code: 4, line: '' });
    expect(errors).toHaveLength(1);
  });

  it('fails closed with exit 2 when git names a toplevel that holds a control character', () => {
    const errors = quiet();
    const { exec } = scriptedExec([toplevel(`${linked}\tx\n`)]);
    expect(rootScript.main(argv(linked), { exec })).toEqual({ code: 2, line: '' });
    expect(errors).toEqual(['resolve-root: a root path holds a control character — failing closed\n']);
  });

  it('never throws: an exec that throws fails closed with exit 4', () => {
    const errors = quiet();
    const exec: ExecFn = () => {
      throw new Error('boom');
    };
    expect(rootScript.main(argv(base), { exec })).toEqual({ code: 4, line: '' });
    expect(errors).toEqual(['resolve-root: internal error — failing closed\n']);
  });
});

describe('resolve-root.cjs boundary', () => {
  const { EXIT_CODES, OUTPUT_RE, settleOutcome } = rootScript;

  it('passes a success only when its line passes the grammar', () => {
    const line = 'WORKTREE=/a/b\nLEDGER=/a';
    expect(OUTPUT_RE.test(line)).toBe(true);
    expect(settleOutcome({ code: EXIT_CODES.RESOLVED, line })).toEqual({ code: 0, line });
  });

  it.each([
    ['an empty line', ''],
    ['a relative path', 'WORKTREE=a/b\nLEDGER=/a'],
    ['a third line', 'WORKTREE=/a\nLEDGER=/a\nexit=0'],
    ['a control character', 'WORKTREE=/a\tb\nLEDGER=/a'],
    ['the lines swapped', 'LEDGER=/a\nWORKTREE=/a'],
  ])('turns a success with %s into exit 4 and no output', (_label, line) => {
    expect(settleOutcome({ code: EXIT_CODES.RESOLVED, line })).toEqual({ code: 4, line: '' });
  });

  it('keeps a usage or unusable-input code, prints nothing for a failure, and maps every other shape to exit 4', () => {
    expect(settleOutcome({ code: 1, line: 'WORKTREE=/a\nLEDGER=/a' })).toEqual({ code: 1, line: '' });
    expect(settleOutcome({ code: 2, line: '' })).toEqual({ code: 2, line: '' });
    expect(settleOutcome({ code: 4, line: '' })).toEqual({ code: 4, line: '' });
    expect(settleOutcome({ code: 7, line: '' })).toEqual({ code: 4, line: '' });
    expect(settleOutcome(null)).toEqual({ code: 4, line: '' });
    expect(settleOutcome({ code: 0 })).toEqual({ code: 4, line: '' });
  });
});
