/**
 * tests/evidence-policy/plan-files.test.ts
 *
 * Suite for src/assets/scripts/plan-files.cjs: the three checks a plan run makes before
 * agents pass report files by path (`claim`, `check <path>`, `hash <file>`). The git half
 * of the answer is resolve-settings.cjs's own (gitToplevel), so this suite holds the script
 * to what it adds:
 *
 *   - `claim` makes a stamp-only run folder, one folder at a time, and refuses a linked or
 *     tracked plan folder, a root with a character the paths refuse, and any argument;
 *   - `check` accepts one new file name in a claimed folder and refuses every other path:
 *     relative, dotted, outside the plan folder, badly named, existing, tracked (in any
 *     spelling a case-folding file system opens), linked, in a run folder no claim made,
 *     under a root that is not its own git toplevel;
 *   - `check` fails closed with exit 4 when git does not answer, or its listing overflows;
 *   - `hash` prints the sha256 of a regular file (one of exactly the size bound included) and
 *     refuses a link, a folder, a FIFO and a huge file, and a link put in place after its lstat;
 *   - every failure is closed: nothing on stdout, one reason line on stderr, a non-zero exit;
 *   - the boundary: main() never throws, runs git by argv with no shell and no time limit,
 *     and the boundary prints only a line that passes the grammar.
 *
 * Real git in temp folders for the path rules; an injected clock and exec for the rest.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { makeFifo, realGit, runResolver, scriptedExec, type ExecFn, type ScriptedCall } from './scripted-shim.js';

const PLAN_SCRIPT = path.resolve(import.meta.dirname, '../../src/assets/scripts/plan-files.cjs');

interface Outcome {
  readonly code: number;
  readonly line: string;
}

interface Deps {
  readonly exec?: ExecFn;
  readonly now?: () => Date;
  readonly cwd?: string;
}

interface PlanScript {
  readonly EXIT_CODES: Readonly<Record<'OK' | 'USAGE' | 'REFUSED' | 'INTERNAL_ERROR', number>>;
  readonly OUTPUT_RE: RegExp;
  readonly main: (argv: readonly string[], deps?: Deps) => Outcome;
  readonly settleOutcome: (outcome: unknown) => Outcome;
}

const planScript = createRequire(import.meta.url)(PLAN_SCRIPT) as PlanScript;

const STAMP_RE = /^\d{4}-\d{2}-\d{2}_\d{4}(?:\d{2})?$/;
const TOPLEVEL_ARGV = ['rev-parse', '--show-toplevel'];
/**
 * The plan folder in every spelling a case-folding file system opens as `.devflow/docs/plan`:
 * git's `icase` folds ASCII letters, and APFS also folds U+FB02 to "fl" and U+017F to "s".
 */
const PLAN_LISTING_PATHSPECS = [
  ':(icase,literal).devflow/docs/plan',
  ':(icase,literal).devflow/doc\u{17F}/plan',
  ':(icase,literal).dev\u{FB02}ow/docs/plan',
  ':(icase,literal).dev\u{FB02}ow/doc\u{17F}/plan',
];
const LS_FILES_ARGV = ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...PLAN_LISTING_PATHSPECS];

describe('plan-files.cjs on real git', { timeout: 60_000 }, () => {
  let base: string;
  let home: string;
  let outside: string;
  let emptyBin: string;
  let counter = 0;

  /** Run the script as a subprocess from `cwd`. */
  const run = (args: readonly string[], cwd: string) =>
    runResolver({ home, args, cwd, script: PLAN_SCRIPT });

  const initRepo = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true });
    realGit(dir, home, ['init', '-q']);
    realGit(dir, home, ['commit', '-q', '--allow-empty', '-m', 'init']);
  };

  /** A new repository, so no test sees another's folders. */
  const freshRepo = (name = 'repo'): string => {
    const dir = path.join(base, `${name}-${counter++}`);
    initRepo(dir);
    return dir;
  };

  const claimIn = (repo: string): string => {
    const r = run(['claim'], repo);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const runDir = /^RUN_DIR=(.+)\n$/.exec(r.stdout)?.[1] ?? '';
    expect(runDir).not.toBe('');
    return runDir;
  };

  const expectClosed = (r: { stdout: string; stderr: string; status: number | null }, status: number): void => {
    expect(r.stdout).toBe('');
    expect(r.status).toBe(status);
    expect(r.stderr.trimEnd().split('\n'), r.stderr).toHaveLength(1);
    expect(r.stderr).toMatch(/^plan-files: /);
  };

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-files-')));
    home = path.join(base, 'home');
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
    outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    emptyBin = path.join(base, 'empty-bin');
    fs.mkdirSync(emptyBin);
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** A new empty folder that no other test writes in, for an assertion that nothing was made there. */
  const emptyFolder = (): string => fs.mkdtempSync(path.join(base, 'empty-'));

  describe('claim', () => {
    it('makes the stamp folder under the plan folder from a subdirectory and prints its path', () => {
      const repo = freshRepo();
      const sub = path.join(repo, 'packages', 'app');
      fs.mkdirSync(sub, { recursive: true });
      const r = run(['claim'], sub);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const runDir = /^RUN_DIR=(.+)\n$/.exec(r.stdout)?.[1] ?? '';
      expect(path.dirname(runDir)).toBe(path.join(repo, '.devflow', 'docs', 'plan'));
      expect(path.basename(runDir)).toMatch(STAMP_RE);
      for (const dir of [path.join(repo, '.devflow'), path.join(repo, '.devflow', 'docs'), path.dirname(runDir), runDir]) {
        expect(fs.lstatSync(dir).isDirectory(), dir).toBe(true);
      }
    });

    it('keeps folders that already exist and adds the stamp folder beside the others', () => {
      const repo = freshRepo();
      const first = claimIn(repo);
      fs.writeFileSync(path.join(first, 'explore-1.md'), 'kept\n');
      const second = path.join(path.dirname(first), '2000-01-01_0000');
      fs.mkdirSync(second);
      const third = claimIn(repo);
      expect(fs.readFileSync(path.join(first, 'explore-1.md'), 'utf8')).toBe('kept\n');
      expect(fs.existsSync(second)).toBe(true);
      expect(path.dirname(third)).toBe(path.dirname(first));
    });

    it('refuses any argument', () => {
      const repo = freshRepo();
      const r = run(['claim', 'my title'], repo);
      expectClosed(r, 1);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });

    it('refuses outside a git repository and makes nothing', () => {
      const bare = emptyFolder();
      expectClosed(run(['claim'], bare), 2);
      expect(fs.readdirSync(bare)).toEqual([]);
    });

    it.each([
      ['.devflow', (repo: string, target: string) => fs.symlinkSync(target, path.join(repo, '.devflow'))],
      ['docs', (repo: string, target: string) => {
        fs.mkdirSync(path.join(repo, '.devflow'));
        fs.symlinkSync(target, path.join(repo, '.devflow', 'docs'));
      }],
      ['plan', (repo: string, target: string) => {
        fs.mkdirSync(path.join(repo, '.devflow', 'docs'), { recursive: true });
        fs.symlinkSync(target, path.join(repo, '.devflow', 'docs', 'plan'));
      }],
    ])('refuses a linked %s folder and writes nothing through the link', (_label, link) => {
      const repo = freshRepo();
      const linked = emptyFolder();
      link(repo, linked);
      expectClosed(run(['claim'], repo), 2);
      expect(fs.readdirSync(linked)).toEqual([]);
    });

    it('refuses a plan folder that git tracks', () => {
      const repo = freshRepo();
      const tracked = path.join(repo, '.devflow', 'docs', 'plan', '2000-01-01_0000');
      fs.mkdirSync(tracked, { recursive: true });
      fs.writeFileSync(path.join(tracked, 'explore-1.md'), 'x\n');
      realGit(repo, home, ['add', '-f', '.devflow/docs/plan']);
      realGit(repo, home, ['commit', '-q', '-m', 'track']);
      const r = run(['claim'], repo);
      expectClosed(r, 2);
      expect(fs.readdirSync(path.dirname(tracked))).toEqual(['2000-01-01_0000']);
    });

    it.each([
      ['a single quote', "it's a repo"],
      ['a tab', 'tab\there'],
      ['a dollar sign', 'cost$repo'],
    ])('refuses a checkout root with %s in its path', (_label, name) => {
      const repo = path.join(base, `${name}-${counter++}`);
      initRepo(repo);
      expectClosed(run(['claim'], repo), 2);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });
  });

  describe('claim with an injected clock', () => {
    let errors: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      errors.mockRestore();
    });

    const quiet = (): string[] => {
      const lines: string[] = [];
      errors = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
      });
      return lines;
    };

    it('names the minute, then the second on a clash, and fails closed on a second clash', () => {
      const lines = quiet();
      const repo = freshRepo();
      const now = (): Date => new Date(2026, 10, 8, 14, 5, 30);
      const planDir = path.join(repo, '.devflow', 'docs', 'plan');
      const argv = ['node', 'plan-files.cjs', 'claim'];

      expect(planScript.main(argv, { now, cwd: repo })).toEqual({ code: 0, line: `RUN_DIR=${planDir}/2026-11-08_1405` });
      expect(planScript.main(argv, { now, cwd: repo })).toEqual({ code: 0, line: `RUN_DIR=${planDir}/2026-11-08_140530` });
      expect(lines).toEqual([]);

      expect(planScript.main(argv, { now, cwd: repo })).toEqual({ code: 4, line: '' });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^plan-files: /);
      expect(fs.readdirSync(planDir).sort()).toEqual(['2026-11-08_1405', '2026-11-08_140530']);
    });

    it('pads every part of the stamp', () => {
      quiet();
      const repo = freshRepo();
      const now = (): Date => new Date(2026, 0, 2, 3, 4, 5);
      const out = planScript.main(['node', 'plan-files.cjs', 'claim'], { now, cwd: repo });
      expect(out.line.endsWith('/2026-01-02_0304')).toBe(true);
    });

    it('fails closed, and makes nothing, when the clock gives no usable date', () => {
      const lines = quiet();
      const repo = freshRepo();
      const now = (): Date => new Date(Number.NaN);
      expect(planScript.main(['node', 'plan-files.cjs', 'claim'], { now, cwd: repo })).toEqual({ code: 4, line: '' });
      expect(lines).toHaveLength(1);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });
  });

  describe('claim of a reviews, bug-analysis or research run folder', () => {
    /** Claim `family`/`slug` in `repo` and return the printed run folder. */
    const claimFamily = (repo: string, family: string, slug: string): string => {
      const r = run(['claim', family, slug], repo);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const runDir = /^RUN_DIR=(.+)\n$/.exec(r.stdout)?.[1] ?? '';
      expect(runDir).not.toBe('');
      return runDir;
    };

    it.each([
      ['reviews', 'feat-12-login.v2_x'],
      ['bug-analysis', 'Feature-X'],
      ['research', 'jwt-auth-2'],
    ])('makes a %s stamp folder under the slug folder and prints its path', (family, slug) => {
      const repo = freshRepo();
      const sub = path.join(repo, 'packages');
      fs.mkdirSync(sub);
      const runDir = claimFamily(sub, family, slug);
      expect(path.dirname(runDir)).toBe(path.join(repo, '.devflow', 'docs', family, slug));
      expect(path.basename(runDir)).toMatch(STAMP_RE);
      expect(fs.lstatSync(runDir).isDirectory()).toBe(true);
    });

    it.each(['reviews', 'bug-analysis', 'research'])('outside a git checkout, claims a %s folder under the working folder', family => {
      const bare = emptyFolder();
      const r = run(['claim', family, 'jwt'], bare);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const runDir = /^RUN_DIR=(.+)\n$/.exec(r.stdout)?.[1] ?? '';
      expect(path.dirname(runDir)).toBe(path.join(bare, '.devflow', 'docs', family, 'jwt'));
      expect(path.basename(runDir)).toMatch(STAMP_RE);
      expect(fs.lstatSync(runDir).isDirectory()).toBe(true);
    });

    it('outside a git checkout, still refuses a linked folder and writes nothing through the link', () => {
      const bare = emptyFolder();
      const linked = emptyFolder();
      fs.symlinkSync(linked, path.join(bare, '.devflow'));
      expectClosed(run(['claim', 'research', 'jwt'], bare), 2);
      expect(fs.readdirSync(linked)).toEqual([]);
    });

    it('outside a git checkout, the plan and design claims still refuse and make nothing', () => {
      const bare = emptyFolder();
      expectClosed(run(['claim'], bare), 2);
      expectClosed(run(['claim', 'design'], bare), 2);
      expect(fs.readdirSync(bare)).toEqual([]);
    });

    it('accepts a folder that git tracks, unlike the plan folder', () => {
      const repo = freshRepo();
      const tracked = path.join(repo, '.devflow', 'docs', 'research', 'jwt', '2000-01-01_0000');
      fs.mkdirSync(tracked, { recursive: true });
      fs.writeFileSync(path.join(tracked, 'codebase.md'), 'x\n');
      realGit(repo, home, ['add', '-f', '.devflow/docs/research']);
      realGit(repo, home, ['commit', '-q', '-m', 'track']);
      const runDir = claimFamily(repo, 'research', 'jwt');
      expect(path.dirname(runDir)).toBe(path.dirname(tracked));
    });

    it.each([
      ['.devflow', ['.devflow']],
      ['docs', ['.devflow', 'docs']],
      ['family', ['.devflow', 'docs', 'reviews']],
      ['slug', ['.devflow', 'docs', 'reviews', 'main']],
    ])('refuses a linked %s folder and writes nothing through the link', (_label, parts) => {
      const repo = freshRepo();
      const linked = emptyFolder();
      const at = path.join(repo, ...parts);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.symlinkSync(linked, at);
      expectClosed(run(['claim', 'reviews', 'main'], repo), 2);
      expect(fs.readdirSync(linked)).toEqual([]);
    });

    it.each([
      ['reviews', '..'],
      ['reviews', '.'],
      ['reviews', 'a/b'],
      ['reviews', "it's"],
      ['bug-analysis', 'cost$x'],
      ['bug-analysis', ''],
      ['bug-analysis', 'x'.repeat(201)],
      ['research', 'Upper-case'],
      ['research', 'my title'],
      ['research', 'jwt.auth'],
      ['research', 'x'.repeat(51)],
    ])('refuses the %s slug %j and makes nothing', (family, slug) => {
      const repo = freshRepo();
      expectClosed(run(['claim', family, slug], repo), 2);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });

    it.each([
      [['claim', 'plan', 'x']],
      [['claim', 'reviews']],
      [['claim', 'unknown', 'x']],
      [['claim', 'research', 'a', 'b']],
      [['claim', 'design', 'x']],
    ])('refuses the argument list %j as a usage error', args => {
      const repo = freshRepo();
      expectClosed(run(args, repo), 1);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });

    it('names the minute, then the second on a clash, with an injected clock', () => {
      const errors = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const repo = freshRepo();
        const now = (): Date => new Date(2026, 10, 8, 14, 5, 30);
        const argv = ['node', 'plan-files.cjs', 'claim', 'bug-analysis', 'main'];
        const dir = path.join(repo, '.devflow', 'docs', 'bug-analysis', 'main');
        expect(planScript.main(argv, { now, cwd: repo })).toEqual({ code: 0, line: `RUN_DIR=${dir}/2026-11-08_1405` });
        expect(planScript.main(argv, { now, cwd: repo })).toEqual({ code: 0, line: `RUN_DIR=${dir}/2026-11-08_140530` });
        expect(planScript.main(argv, { now, cwd: repo })).toEqual({ code: 4, line: '' });
      } finally {
        errors.mockRestore();
      }
    });
  });

  describe('claim design and check of a design file', () => {
    const DESIGN_NAMES = ['42-jwt-auth.2026-04-07_1430.md', 'multi-jwt-auth.2026-04-07_1430.md', 'PROJ-7-x.2026-04-07_143005.md', 'untitled.2026-04-07_1430.md'];

    const claimDesign = (repo: string): string => {
      const r = run(['claim', 'design'], repo);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const dir = /^DIR=(.+)\n$/.exec(r.stdout)?.[1] ?? '';
      expect(dir).toBe(path.join(repo, '.devflow', 'docs', 'design'));
      return dir;
    };

    it('makes the design folder, keeps it on a second claim, and prints its path', () => {
      const repo = freshRepo();
      const dir = claimDesign(repo);
      fs.writeFileSync(path.join(dir, 'kept.2000-01-01_0000.md'), 'kept\n');
      expect(claimDesign(repo)).toBe(dir);
      expect(fs.readdirSync(dir)).toEqual(['kept.2000-01-01_0000.md']);
    });

    it.each(DESIGN_NAMES)('accepts the new design file %s', name => {
      const repo = freshRepo();
      const target = path.join(claimDesign(repo), name);
      const r = run(['check', target], outside);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`OK=${target}\n`);
    });

    it('accepts a design folder that git tracks', () => {
      const repo = freshRepo();
      const dir = claimDesign(repo);
      fs.writeFileSync(path.join(dir, 'old.2000-01-01_0000.md'), 'x\n');
      realGit(repo, home, ['add', '-f', '.devflow/docs/design']);
      realGit(repo, home, ['commit', '-q', '-m', 'track']);
      expect(run(['check', path.join(dir, DESIGN_NAMES[0])], repo).status).toBe(0);
    });

    it.each([
      ['.devflow', ['.devflow']],
      ['docs', ['.devflow', 'docs']],
      ['design', ['.devflow', 'docs', 'design']],
    ])('claim refuses a linked %s folder and writes nothing through the link', (_label, parts) => {
      const repo = freshRepo();
      const linked = emptyFolder();
      const at = path.join(repo, ...parts);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.symlinkSync(linked, at);
      expectClosed(run(['claim', 'design'], repo), 2);
      expect(fs.readdirSync(linked)).toEqual([]);
    });

    it('check refuses a design file under a linked design folder', () => {
      const repo = freshRepo();
      const linked = emptyFolder();
      fs.mkdirSync(path.join(repo, '.devflow', 'docs'), { recursive: true });
      fs.symlinkSync(linked, path.join(repo, '.devflow', 'docs', 'design'));
      expectClosed(run(['check', path.join(repo, '.devflow', 'docs', 'design', DESIGN_NAMES[0])], repo), 2);
    });

    it('check refuses an existing file, a link and a dangling link at the path', () => {
      const repo = freshRepo();
      const dir = claimDesign(repo);
      const target = emptyFolder();
      fs.writeFileSync(path.join(dir, DESIGN_NAMES[0]), 'x\n');
      fs.symlinkSync(path.join(target, 'f.md'), path.join(dir, DESIGN_NAMES[1]));
      fs.writeFileSync(path.join(target, 'g.md'), 'x\n');
      fs.symlinkSync(path.join(target, 'g.md'), path.join(dir, DESIGN_NAMES[2]));
      for (const name of DESIGN_NAMES.slice(0, 3)) {
        expectClosed(run(['check', path.join(dir, name)], repo), 2);
      }
      expect(fs.readdirSync(target)).toEqual(['g.md']);
    });

    it.each([
      'jwt-auth.md',
      'jwt-auth.2026-04-07.md',
      '-jwt.2026-04-07_1430.md',
      '.jwt.2026-04-07_1430.md',
      'jwt auth.2026-04-07_1430.md',
      'jwt-auth.2026-04-07_1430.txt',
    ])('check refuses the design name %j', name => {
      const repo = freshRepo();
      expectClosed(run(['check', path.join(claimDesign(repo), name)], repo), 2);
    });

    it('check refuses a design file when no claim made the folder', () => {
      const repo = freshRepo();
      expectClosed(run(['check', path.join(repo, '.devflow', 'docs', 'design', DESIGN_NAMES[0])], repo), 2);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });
  });

  describe('check', () => {
    it('accepts a new report file in a claimed folder', () => {
      const repo = freshRepo();
      const target = path.join(claimIn(repo), 'explore-1.md');
      const r = run(['check', target], repo);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`OK=${target}\n`);
    });

    it('does not depend on the working directory', () => {
      const repo = freshRepo();
      const target = path.join(claimIn(repo), 'skim-12.md');
      const r = run(['check', target], outside);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe(`OK=${target}\n`);
    });

    it('refuses a relative path, a dotted path and a path outside the plan folder', () => {
      const repo = freshRepo();
      const runDir = claimIn(repo);
      const stamp = path.basename(runDir);
      const cases = [
        path.join('.devflow', 'docs', 'plan', stamp, 'explore-1.md'),
        `${runDir}/../${stamp}/explore-1.md`,
        `${runDir}/./explore-1.md`,
        `${runDir}//explore-1.md`,
        `${runDir}/explore-1.md/`,
        path.join(repo, 'explore-1.md'),
        path.join(repo, '.devflow', 'docs', stamp, 'explore-1.md'),
        path.join(outside, 'explore-1.md'),
        path.join(repo, '.devflow', 'docs', 'plan', 'explore-1.md'),
      ];
      for (const target of cases) {
        expectClosed(run(['check', target], repo), 2);
      }
    });

    it.each([
      ['an upper-case letter', 'Explore-1.md'],
      ['a missing number', 'explore.md'],
      ['a four-digit number', 'explore-1000.md'],
      ['a digit in the word', 'explore2-1.md'],
      ['another extension', 'explore-1.txt'],
      ['a hidden name', '.explore-1.md'],
      ['a nested name', 'sub/explore-1.md'],
    ])('refuses a name with %s', (_label, name) => {
      const repo = freshRepo();
      expectClosed(run(['check', path.join(claimIn(repo), name)], repo), 2);
    });

    it('refuses a stamp folder that is not a stamp', () => {
      const repo = freshRepo();
      const planDir = path.join(repo, '.devflow', 'docs', 'plan');
      claimIn(repo);
      for (const stamp of ['my-title', '2026-11-08', '2026-11-08_14', '2026-11-08_1405123']) {
        expectClosed(run(['check', path.join(planDir, stamp, 'explore-1.md')], repo), 2);
      }
    });

    it.each([
      ['a single quote', "'"],
      ['a double quote', '"'],
      ['a dollar sign', '$'],
      ['a backtick', '`'],
      ['a backslash', '\\'],
      ['a star', '*'],
      ['a question mark', '?'],
      ['a square bracket', '['],
      ['a closing square bracket', ']'],
      ['a curly brace', '{'],
      ['a closing curly brace', '}'],
      ['a tab', '\t'],
      ['a newline', '\n'],
    ])('refuses a path with %s in it', (_label, ch) => {
      const repo = freshRepo();
      const runDir = claimIn(repo);
      expectClosed(run(['check', `${runDir}/explore-1${ch}.md`], repo), 2);
      expectClosed(run(['check', `${path.dirname(runDir)}/${path.basename(runDir)}${ch}/explore-1.md`], repo), 2);
    });

    it('refuses a file that exists, whatever it holds', () => {
      const repo = freshRepo();
      const target = path.join(claimIn(repo), 'explore-1.md');
      fs.writeFileSync(target, '');
      expectClosed(run(['check', target], repo), 2);
    });

    it('refuses a link at the file name, to a file or to nothing', () => {
      const repo = freshRepo();
      const runDir = claimIn(repo);
      const real = path.join(outside, 'secret.md');
      fs.writeFileSync(real, 'secret\n');
      fs.symlinkSync(real, path.join(runDir, 'explore-1.md'));
      fs.symlinkSync(path.join(outside, 'missing.md'), path.join(runDir, 'explore-2.md'));
      expectClosed(run(['check', path.join(runDir, 'explore-1.md')], repo), 2);
      expectClosed(run(['check', path.join(runDir, 'explore-2.md')], repo), 2);
      fs.rmSync(real);
    });

    it('refuses a file name that git tracks even when the file is gone', () => {
      const repo = freshRepo();
      const runDir = claimIn(repo);
      const target = path.join(runDir, 'explore-1.md');
      fs.writeFileSync(target, 'x\n');
      realGit(repo, home, ['add', '-f', '.devflow/docs/plan']);
      realGit(repo, home, ['commit', '-q', '-m', 'track']);
      fs.rmSync(target);
      expectClosed(run(['check', target], repo), 2);
    });

    it.each(['.devflow', 'docs', 'plan', 'the stamp'])('refuses a path through a linked %s folder', (label) => {
      const repo = freshRepo();
      const stamp = '2026-11-08_1405';
      const real = path.join(outside, `real-${counter++}`);
      fs.mkdirSync(path.join(real, 'docs', 'plan', stamp), { recursive: true });
      const devflow = path.join(repo, '.devflow');
      if (label === '.devflow') {
        fs.symlinkSync(real, devflow);
      } else if (label === 'docs') {
        fs.mkdirSync(devflow);
        fs.symlinkSync(path.join(real, 'docs'), path.join(devflow, 'docs'));
      } else if (label === 'plan') {
        fs.mkdirSync(path.join(devflow, 'docs'), { recursive: true });
        fs.symlinkSync(path.join(real, 'docs', 'plan'), path.join(devflow, 'docs', 'plan'));
      } else {
        fs.mkdirSync(path.join(devflow, 'docs', 'plan'), { recursive: true });
        fs.symlinkSync(path.join(real, 'docs', 'plan', stamp), path.join(devflow, 'docs', 'plan', stamp));
      }
      expectClosed(run(['check', path.join(devflow, 'docs', 'plan', stamp, 'explore-1.md')], repo), 2);
    });

    it('refuses a root that is not the git toplevel of its own folder', () => {
      const repo = freshRepo();
      const nested = path.join(repo, 'packages', 'app');
      fs.mkdirSync(path.join(nested, '.devflow', 'docs', 'plan', '2026-11-08_1405'), { recursive: true });
      expectClosed(run(['check', path.join(nested, '.devflow', 'docs', 'plan', '2026-11-08_1405', 'explore-1.md')], repo), 2);
    });

    it('refuses a root reached through a link, because the toplevel names the real folder', () => {
      const repo = freshRepo();
      const runDir = claimIn(repo);
      const alias = path.join(base, `alias-${counter++}`);
      fs.symlinkSync(repo, alias);
      const viaAlias = path.join(alias, '.devflow', 'docs', 'plan', path.basename(runDir), 'explore-1.md');
      expectClosed(run(['check', viaAlias], repo), 2);
    });

    it('refuses a root outside any git repository, and one that does not exist', () => {
      const bare = path.join(base, `bare-${counter++}`);
      fs.mkdirSync(path.join(bare, '.devflow', 'docs', 'plan', '2026-11-08_1405'), { recursive: true });
      expectClosed(run(['check', path.join(bare, '.devflow', 'docs', 'plan', '2026-11-08_1405', 'explore-1.md')], bare), 2);
      const missing = path.join(base, `missing-${counter++}`);
      expectClosed(run(['check', path.join(missing, '.devflow', 'docs', 'plan', '2026-11-08_1405', 'explore-1.md')], outside), 2);
    });

    it.each(['.devflow', 'docs', 'plan', 'stamp'])('refuses a path when the %s folder is absent, because no claim made it', (label) => {
      const repo = freshRepo();
      const parts = ['.devflow', 'docs', 'plan', '2026-11-08_1405'];
      const present = ['.devflow', 'docs', 'plan', 'stamp'].indexOf(label);
      if (present > 0) fs.mkdirSync(path.join(repo, ...parts.slice(0, present)), { recursive: true });
      const r = run(['check', path.join(repo, ...parts, 'explore-1.md')], repo);
      expectClosed(r, 2);
      expect(r.stderr).toMatch(/^plan-files: no run folder was claimed/);
      expect(fs.existsSync(path.join(repo, ...parts.slice(0, present + 1)))).toBe(false);
    });

    it('refuses a path directly below the file system root, whatever its other parts hold', () => {
      const r = run(['check', '/.devflow/docs/plan/2026-11-08_1405/explore-1.md'], outside);
      expectClosed(r, 2);
      expect(r.stderr).toMatch(/^plan-files: the path is not below a checkout root/);
    });

    it('refuses a root that is a file, not a folder', () => {
      const file = path.join(base, `root-file-${counter++}`);
      fs.writeFileSync(file, 'x\n');
      const r = run(['check', path.join(file, '.devflow', 'docs', 'plan', '2026-11-08_1405', 'explore-1.md')], outside);
      expectClosed(r, 2);
      expect(r.stderr).toMatch(/^plan-files: the root is not a folder/);
    });

    it('fails closed with exit 4 when git is not installed on the path', () => {
      const repo = freshRepo();
      const target = path.join(claimIn(repo), 'explore-1.md');
      const r = runResolver({
        home, args: ['check', target], cwd: repo, script: PLAN_SCRIPT, extraEnv: { PATH: emptyBin },
      });
      expectClosed(r, 4);
      expect(r.stderr).toMatch(/^plan-files: git did not answer/);
    });

    it('refuses no argument and two arguments, as a usage error', () => {
      const repo = freshRepo();
      expectClosed(run(['check'], repo), 1);
      expectClosed(run(['check', '/a', '/b'], repo), 1);
    });
  });

  describe('a plan folder that git tracks under another spelling', () => {
    const spellings: ReadonlyArray<readonly [string, string]> = [
      ['upper-case letters', '.DEVFLOW/docs/plan/2000-01-01_0000/a-1.md'],
      ['a mixed-case docs and plan folder', '.devflow/Docs/PLAN/2000-01-01_0000/a-1.md'],
      ['the fl ligature in .devflow', '.dev\u{FB02}ow/docs/plan/2000-01-01_0000/a-1.md'],
      ['the long s in docs', '.devflow/doc\u{17F}/plan/2000-01-01_0000/a-1.md'],
    ];

    /**
     * Put `entry` in the index with no file on disk and `core.ignorecase` off, so the answer
     * does not depend on the file system the test runs on.
     */
    const trackEntry = (repo: string, entry: string): void => {
      realGit(repo, home, ['config', 'core.ignorecase', 'false']);
      const seed = path.join(base, `seed-${counter++}.txt`);
      fs.writeFileSync(seed, 'x\n');
      const blob = realGit(repo, home, ['hash-object', '-w', seed]).trim();
      realGit(repo, home, ['update-index', '--add', '--cacheinfo', `100644,${blob},${entry}`]);
    };

    it.each(spellings)('claim refuses an entry spelled with %s, and makes nothing', (_label, entry) => {
      const repo = freshRepo();
      trackEntry(repo, entry);
      const r = run(['claim'], repo);
      expectClosed(r, 2);
      expect(r.stderr).toMatch(/^plan-files: git tracks files under the plan folder/);
      expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
    });

    it.each(spellings)('check refuses a report in a claimed folder when an entry is spelled with %s', (_label, entry) => {
      const repo = freshRepo();
      const target = path.join(claimIn(repo), 'explore-1.md');
      trackEntry(repo, entry);
      const r = run(['check', target], repo);
      expectClosed(r, 2);
      expect(r.stderr).toMatch(/^plan-files: git tracks files under the plan folder/);
    });
  });

  describe('hash', () => {
    it('prints the sha256 of the file bytes', () => {
      const file = path.join(base, 'report.md');
      const bytes = Buffer.from('# report\nbody é\n', 'utf8');
      fs.writeFileSync(file, bytes);
      const r = run(['hash', file], outside);
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(`SHA256=${createHash('sha256').update(bytes).digest('hex')}\n`);
    });

    it('hashes an empty file', () => {
      const file = path.join(base, 'empty.md');
      fs.writeFileSync(file, '');
      expect(run(['hash', file], outside).stdout).toBe(
        'SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n',
      );
    });

    it('refuses a link, a folder, a missing file and a relative path', () => {
      const real = path.join(base, 'real.md');
      fs.writeFileSync(real, 'x\n');
      const link = path.join(base, 'link.md');
      fs.symlinkSync(real, link);
      expectClosed(run(['hash', link], outside), 2);
      expectClosed(run(['hash', outside], outside), 2);
      expectClosed(run(['hash', path.join(base, 'missing.md')], outside), 2);
      expectClosed(run(['hash', 'real.md'], base), 2);
      expectClosed(run(['hash', `${base}/../${path.basename(base)}/real.md`], outside), 2);
    });

    it('refuses a dangling link and a FIFO, and never waits on the FIFO', () => {
      const dangling = path.join(base, 'dangling.md');
      fs.symlinkSync(path.join(base, 'gone.md'), dangling);
      expectClosed(run(['hash', dangling], outside), 2);
      const fifo = path.join(base, 'fifo.md');
      expect(makeFifo(fifo, home), 'mkfifo must make the FIFO').toBe(true);
      expectClosed(run(['hash', fifo], outside), 2);
    });

    it.each(['$', "'", '`', '*'])('refuses a path with %s in it', (ch) => {
      const file = path.join(base, `odd${ch}.md`);
      fs.writeFileSync(file, 'x\n');
      expectClosed(run(['hash', file], outside), 2);
    });

    it('refuses a file over the size bound without reading it', () => {
      const file = path.join(base, 'huge.md');
      fs.writeFileSync(file, '');
      fs.truncateSync(file, 16 * 1024 * 1024 + 1);
      expectClosed(run(['hash', file], outside), 2);
    });

    it('refuses no argument and two arguments, as a usage error', () => {
      expectClosed(run(['hash'], outside), 1);
      expectClosed(run(['hash', '/a', '/b'], outside), 1);
    });
  });

  describe('usage', () => {
    it.each([[[]], [['unknown']], [['--help']], [['claim', '--x']]])('refuses %j as a usage error', (args) => {
      expectClosed(run(args, outside), 1);
    });
  });

  it('fails when git is not installed on the path', () => {
    const repo = freshRepo();
    const r = runResolver({
      home, args: ['claim'], cwd: repo, script: PLAN_SCRIPT, extraEnv: { PATH: emptyBin },
    });
    expectClosed(r, 4);
    expect(fs.existsSync(path.join(repo, '.devflow'))).toBe(false);
  });
});

describe('plan-files.cjs main() with an injected exec', () => {
  let base: string;
  let root: string;
  let errors: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-files-unit-')));
    root = path.join(base, 'root');
    fs.mkdirSync(root);
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  afterEach(() => {
    errors.mockRestore();
    vi.unstubAllEnvs();
  });

  const quiet = (): string[] => {
    const lines: string[] = [];
    errors = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    return lines;
  };

  const toplevel = (stdout: string, exit = 0): ScriptedCall => ({ tool: 'git', args: TOPLEVEL_ARGV, stdout, exit });
  const lsFiles = (stdout: string, exit = 0): ScriptedCall => ({ tool: 'git', args: LS_FILES_ARGV, stdout, exit });
  const claimArgv = ['node', 'plan-files.cjs', 'claim'];
  const checkArgv = (target: string): string[] => ['node', 'plan-files.cjs', 'check', target];
  const stamp = (): Date => new Date(2026, 10, 8, 14, 5, 30);

  /** A claimed run folder in a root of its own, so no test sees another's folders. */
  const claimedRoot = (): { readonly dir: string; readonly target: string } => {
    const dir = fs.mkdtempSync(path.join(base, 'claimed-'));
    const runDir = path.join(dir, '.devflow', 'docs', 'plan', '2026-11-08_1405');
    fs.mkdirSync(runDir, { recursive: true });
    return { dir, target: path.join(runDir, 'explore-1.md') };
  };

  it('runs every git call by argv, with no shell and no time limit of its own', () => {
    quiet();
    const { exec, recorded } = scriptedExec([toplevel(`${root}\n`), lsFiles('')]);
    const out = planScript.main(claimArgv, { exec, now: stamp, cwd: root });
    expect(out.code).toBe(0);
    expect(recorded.map(c => c.file)).toEqual(['git', 'git']);
    expect(recorded.map(c => c.args)).toEqual([TOPLEVEL_ARGV, LS_FILES_ARGV]);
    for (const call of recorded) {
      expect(call.opts.shell, call.args.join(' ')).toBe(false);
      expect(call.opts.timeout, call.args.join(' ')).toBeUndefined();
      expect(typeof call.opts.maxBuffer, call.args.join(' ')).toBe('number');
    }
  });

  it.each([
    ['cannot be started', 'ENOENT'],
    ['times out', 'ETIMEDOUT'],
  ])('fails closed with exit 4 when git %s for the toplevel', (_label, spawnError) => {
    const lines = quiet();
    const { exec } = scriptedExec([{ tool: 'git', args: TOPLEVEL_ARGV, spawnError }]);
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: root })).toEqual({ code: 4, line: '' });
    expect(lines).toEqual(['plan-files: git did not answer — failing closed\n']);
  });

  it('fails closed with exit 4, and makes no folder, when the tracked-file listing fails', () => {
    const lines = quiet();
    const fresh = path.join(base, 'fresh');
    fs.mkdirSync(fresh);
    const { exec } = scriptedExec([toplevel(`${fresh}\n`), lsFiles('', 128)]);
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: fresh })).toEqual({ code: 4, line: '' });
    expect(lines).toHaveLength(1);
    expect(fs.readdirSync(fresh)).toEqual([]);
  });

  it('runs the tracked-file listing without the variables that redirect git, and keeps the others', () => {
    quiet();
    const fresh = fs.mkdtempSync(path.join(base, 'env-'));
    vi.stubEnv('GIT_INDEX_FILE', path.join(fresh, 'empty-index'));
    vi.stubEnv('GIT_DIR', path.join(fresh, 'other.git'));
    vi.stubEnv('GIT_LITERAL_PATHSPECS', '1');
    vi.stubEnv('PLAN_FILES_KEPT', 'kept');
    const { exec, recorded } = scriptedExec([toplevel(`${fresh}\n`), lsFiles('')]);
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: fresh }).code).toBe(0);
    const listing = recorded.find(call => call.args.includes('ls-files'));
    expect(listing, 'the listing call must be made').toBeDefined();
    const env = (listing?.opts.env ?? {}) as Record<string, string | undefined>;
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_LITERAL_PATHSPECS).toBeUndefined();
    expect(env.PLAN_FILES_KEPT).toBe('kept');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('fails closed with exit 4, and prints nothing, when check gets no answer to the tracked-file listing', () => {
    const lines = quiet();
    const { dir, target } = claimedRoot();
    const { exec } = scriptedExec([toplevel(`${dir}\n`), lsFiles('', 128)]);
    expect(planScript.main(checkArgv(target), { exec })).toEqual({ code: 4, line: '' });
    expect(lines).toEqual(['plan-files: git did not answer for the plan folder — failing closed\n']);
  });

  it('fails closed with exit 4, not as a tracked folder, when check gets a listing that overflows', () => {
    const lines = quiet();
    const { dir, target } = claimedRoot();
    const { exec } = scriptedExec([toplevel(`${dir}\n`), lsFiles(`${'x'.repeat(4097)}\0`)]);
    expect(planScript.main(checkArgv(target), { exec })).toEqual({ code: 4, line: '' });
    expect(lines).toEqual(['plan-files: git did not answer for the plan folder — failing closed\n']);
  });

  it('fails closed with exit 2 when the listing names a tracked entry, whatever the exit status', () => {
    const lines = quiet();
    const fresh = path.join(base, 'tracked');
    fs.mkdirSync(fresh);
    const { exec } = scriptedExec([toplevel(`${fresh}\n`), lsFiles('.devflow/docs/plan/x/a-1.md\0', 1)]);
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: fresh })).toEqual({ code: 2, line: '' });
    expect(lines).toHaveLength(1);
    expect(fs.readdirSync(fresh)).toEqual([]);
  });

  it('fails closed with exit 2 when git names a toplevel that holds a control character', () => {
    const lines = quiet();
    const { exec } = scriptedExec([toplevel(`${root}\tx\n`)]);
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: root })).toEqual({ code: 2, line: '' });
    expect(lines).toHaveLength(1);
  });

  it('fails closed with exit 4 when git answers with a path that is not absolute', () => {
    const lines = quiet();
    const { exec } = scriptedExec([toplevel('relative/path\n')]);
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: root })).toEqual({ code: 4, line: '' });
    expect(lines).toHaveLength(1);
  });

  it('never throws: an exec that throws fails closed with exit 4', () => {
    const lines = quiet();
    const exec: ExecFn = () => {
      throw new Error('boom');
    };
    expect(planScript.main(claimArgv, { exec, now: stamp, cwd: root })).toEqual({ code: 4, line: '' });
    expect(lines).toEqual(['plan-files: internal error — failing closed\n']);
  });

  it('never throws on a bad argv', () => {
    quiet();
    expect(planScript.main(null as unknown as string[]).code).toBe(1);
    expect(planScript.main(['node', 'plan-files.cjs', 'check', 7 as unknown as string]).code).toBe(1);
  });
});

describe('plan-files.cjs hash reads the file it checked', () => {
  /** The fs module object the script and its bounded reader share, so a spy reaches both. */
  const nodeFs = createRequire(import.meta.url)('fs') as typeof fs;
  const hashArgv = (file: string): string[] => ['node', 'plan-files.cjs', 'hash', file];
  let base: string;
  let lines: string[];

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-files-hash-')));
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const quiet = (): void => {
    lines = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  };

  it('hashes a regular file, and one of exactly the size bound', () => {
    quiet();
    const small = path.join(base, 'small.md');
    fs.writeFileSync(small, 'plan\n');
    expect(planScript.main(hashArgv(small))).toEqual({
      code: 0,
      line: `SHA256=${createHash('sha256').update('plan\n').digest('hex')}`,
    });
    const bound = 16 * 1024 * 1024;
    const full = path.join(base, 'full.md');
    fs.writeFileSync(full, '');
    fs.truncateSync(full, bound);
    expect(planScript.main(hashArgv(full))).toEqual({
      code: 0,
      line: `SHA256=${createHash('sha256').update(Buffer.alloc(bound)).digest('hex')}`,
    });
    expect(lines).toEqual([]);
  });

  it('refuses a link put in place of the file after the lstat: the read never follows it', () => {
    quiet();
    const real = path.join(base, 'real.md');
    fs.writeFileSync(real, 'secret\n');
    const link = path.join(base, 'swapped.md');
    fs.symlinkSync(real, link);
    // The lstat sees the regular file that stood at the path; the link stands there by the read.
    const lstat = nodeFs.lstatSync;
    const spy = vi.spyOn(nodeFs, 'lstatSync').mockImplementation(
      ((p: fs.PathLike) => lstat(p === link ? real : p)) as typeof nodeFs.lstatSync,
    );
    expect(planScript.main(hashArgv(link))).toEqual({ code: 2, line: '' });
    expect(spy.mock.calls.some(([p]) => p === link), 'the seed must land').toBe(true);
    expect(lines).toEqual(['plan-files: the file cannot be read — failing closed\n']);
  });
});

describe('plan-files.cjs boundary', () => {
  const { EXIT_CODES, OUTPUT_RE, settleOutcome } = planScript;
  const sha = 'a'.repeat(64);

  it.each([
    ['a claim', 'RUN_DIR=/a/b/2026-11-08_1405'],
    ['a check', 'OK=/a/b/explore-1.md'],
    ['a hash', `SHA256=${sha}`],
  ])('passes %s only when its line passes the grammar', (_label, line) => {
    expect(OUTPUT_RE.test(line)).toBe(true);
    expect(settleOutcome({ code: EXIT_CODES.OK, line })).toEqual({ code: 0, line });
  });

  it.each([
    ['an empty line', ''],
    ['a relative path', 'RUN_DIR=a/b'],
    ['a relative checked path', 'OK=a/b'],
    ['a short digest', 'SHA256=abc'],
    ['a digest in capitals', `SHA256=${sha.toUpperCase()}`],
    ['a second line', 'OK=/a\nOK=/b'],
    ['a control character', 'OK=/a\tb'],
    ['another key', 'WORKTREE=/a'],
  ])('turns a success with %s into exit 4 and no output', (_label, line) => {
    expect(settleOutcome({ code: EXIT_CODES.OK, line })).toEqual({ code: 4, line: '' });
  });

  it('keeps a usage or refusal code, prints nothing for a failure, and maps every other shape to exit 4', () => {
    expect(settleOutcome({ code: 1, line: 'OK=/a' })).toEqual({ code: 1, line: '' });
    expect(settleOutcome({ code: 2, line: '' })).toEqual({ code: 2, line: '' });
    expect(settleOutcome({ code: 4, line: '' })).toEqual({ code: 4, line: '' });
    expect(settleOutcome({ code: 7, line: '' })).toEqual({ code: 4, line: '' });
    expect(settleOutcome(null)).toEqual({ code: 4, line: '' });
    expect(settleOutcome({ code: 0 })).toEqual({ code: 4, line: '' });
  });
});
