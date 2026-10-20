// tests/decisions/tracked-areas.test.ts
//
// The tracked-areas check (hooks/lib/tracked-areas.cjs): does git track any entry under
// `.devflow/learning` or `.devflow/curation` at a root? One `git ls-files` call over a
// fixed set of pathspecs answers `tracked`, `untracked` or `unknown`. A root with no
// `.git` entry makes no git call. Every test builds its own project in a temp tree.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { git, initGitRepo } from './curation-fixtures.js';

type TrackedAnswer = 'tracked' | 'untracked' | 'unknown';

interface SpawnAnswer {
  error?: Error & { code?: string };
  status?: number | null;
  stdout?: Buffer | string | null;
}

interface TrackedAreas {
  TRACKED_AREA_PATHSPECS: readonly string[];
  classifyTrackedAreas(result: unknown): TrackedAnswer;
  checkTrackedAreas(root: string): TrackedAnswer;
}

const LEAF = path.resolve(import.meta.dirname, '../../src/assets/scripts/hooks/lib/tracked-areas.cjs');
const nodeRequire = createRequire(import.meta.url);
const leaf = nodeRequire(LEAF) as TrackedAreas;
/** The child_process module object the leaf calls git through: a spy on it reaches the leaf. */
const nodeChildProcess = nodeRequire('child_process') as typeof import('child_process');

const LIGATURE = '\u{FB02}';
const errorWith = (code: string): Error & { code: string } => Object.assign(new Error(code), { code });

describe('classifyTrackedAreas — the answer of one git ls-files call', () => {
  const answers: Array<[name: string, result: unknown, expected: TrackedAnswer]> = [
    ['exit 0 with nothing listed', { status: 0, stdout: Buffer.alloc(0) }, 'untracked'],
    ['exit 0 with an empty string', { status: 0, stdout: '' }, 'untracked'],
    ['exit 0 with an entry listed', { status: 0, stdout: Buffer.from('.devflow/learning/a\0') }, 'tracked'],
    ['an entry listed as a string', { status: 0, stdout: '.devflow/learning/a\0' }, 'tracked'],
    ['an entry listed with a non-zero exit', { status: 1, stdout: Buffer.from('.devflow/curation/a\0') }, 'tracked'],
    ['output past the buffer cap', { error: errorWith('ENOBUFS'), status: null, stdout: Buffer.alloc(0) }, 'tracked'],
    ['output past the buffer cap with partial output', { error: errorWith('ENOBUFS'), status: null, stdout: Buffer.from('.devflow/a') }, 'tracked'],
    ['a timeout after an entry was listed', { error: errorWith('ETIMEDOUT'), status: null, stdout: Buffer.from('.devflow/a\0') }, 'tracked'],
    ['a timeout with nothing listed', { error: errorWith('ETIMEDOUT'), status: null, stdout: Buffer.alloc(0) }, 'unknown'],
    ['git is not installed', { error: errorWith('ENOENT'), status: null, stdout: null }, 'unknown'],
    ['a spawn error of any other kind', { error: errorWith('EACCES'), status: null, stdout: null }, 'unknown'],
    ['a non-zero exit with nothing listed', { status: 128, stdout: Buffer.alloc(0) }, 'unknown'],
    ['exit 2 with nothing listed', { status: 2, stdout: Buffer.alloc(0) }, 'unknown'],
    ['a process ended by a signal', { status: null, signal: 'SIGKILL', stdout: Buffer.alloc(0) }, 'unknown'],
    ['no result at all', undefined, 'unknown'],
    ['a null result', null, 'unknown'],
    ['a result of the wrong shape', 'tracked', 'unknown'],
  ];

  it.each(answers)('%s', (_name, result, expected) => {
    expect(leaf.classifyTrackedAreas(result)).toBe(expected);
  });
});

describe('TRACKED_AREA_PATHSPECS', () => {
  it('names both folders under both spellings of .devflow, case-folded, and the .devflow entry itself', () => {
    expect([...leaf.TRACKED_AREA_PATHSPECS].sort()).toEqual([
      ':(icase,glob)[.]devflow',
      `:(icase,glob)[.]dev${LIGATURE}ow`,
      ':(icase,literal).devflow/curation',
      ':(icase,literal).devflow/learning',
      `:(icase,literal).dev${LIGATURE}ow/curation`,
      `:(icase,literal).dev${LIGATURE}ow/learning`,
    ].sort());
  });

  it('is frozen', () => {
    expect(Object.isFrozen(leaf.TRACKED_AREA_PATHSPECS)).toBe(true);
  });
});

describe('the leaf module', () => {
  it('requires neither the store nor the move module', () => {
    const source = fs.readFileSync(LEAF, 'utf8');
    expect(source).not.toMatch(/require\(\s*['"][^'"]*curation-(store|move)(\.cjs)?['"]\s*\)/);
  });
});

describe('checkTrackedAreas', () => {
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-areas-')));
    root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    vi.stubEnv('HOME', path.join(tmp, 'home'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A repository at the root with `files` (path to content) committed, force-added so ignore rules never hide them. */
  function commitRepo(files: Record<string, string>): void {
    initGitRepo(root);
    stage(files);
    git(root, ['commit', '-q', '-m', 'files']);
  }

  /** Write `files` and stage them. */
  function stage(files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    git(root, ['add', '-f', '--', ...Object.keys(files)]);
  }

  const gitCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter(([command]) => command === 'git');

  /**
   * A directory that is the whole of PATH. `git` in it, when given, is a link to a program
   * that always exits non-zero (a fresh script is slow to start on some machines).
   */
  function pathWith(options: { failingGit: boolean }): string {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    if (options.failingGit) {
      const failing = ['/usr/bin/false', '/bin/false'].find(candidate => fs.existsSync(candidate));
      if (failing === undefined) throw new Error('no false program on this machine');
      fs.symlinkSync(failing, path.join(bin, 'git'));
    }
    return bin;
  }

  it('makes no git call and answers untracked when the root has no .git entry', () => {
    fs.mkdirSync(path.join(root, '.devflow', 'learning'), { recursive: true });
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
    expect(gitCalls(calls)).toEqual([]);
  });

  it('decides by a .git entry of any kind: a file counts as much as a folder', () => {
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: ' + path.join(tmp, 'elsewhere') + '\n');
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    leaf.checkTrackedAreas(root);

    expect(gitCalls(calls)).toHaveLength(1);
  });

  it('answers untracked for a repository that tracks nothing under the two folders', () => {
    commitRepo({ 'README.md': 'readme\n', '.devflow/project.json': '{}\n' });
    fs.mkdirSync(path.join(root, '.devflow', 'learning'), { recursive: true });
    fs.writeFileSync(path.join(root, '.devflow', 'learning', 'decisions-log.jsonl'), 'row\n');

    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
  });

  it.each([
    ['a file in the old folder', '.devflow/learning/decisions.md'],
    ['a file in the new folder', '.devflow/curation/notes.txt'],
    ['a queue file in the old folder', '.devflow/learning/.pending-turns.jsonl'],
    ['a file in a folder below the old folder', '.devflow/learning/deep/er/file.txt'],
    ['a file under another case', '.devflow/Learning/decisions.md'],
    ['a file under an upper-case .DEVFLOW', '.DEVFLOW/CURATION/decisions.md'],
    ['a file under the ligature spelling of .devflow', `.dev${LIGATURE}ow/learning/decisions.md`],
  ])('answers tracked for %s', (_name, rel) => {
    commitRepo({ [rel]: 'content\n' });
    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('answers tracked for an entry that is staged and not committed', () => {
    commitRepo({ 'README.md': 'readme\n' });
    stage({ '.devflow/learning/decisions.md': 'staged\n' });
    expect(git(root, ['log', '--oneline', '--', '.devflow'])).toBe('');

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('answers tracked for a .devflow entry that is a link', () => {
    commitRepo({ 'README.md': 'readme\n' });
    fs.mkdirSync(path.join(root, 'shared'));
    fs.symlinkSync('shared', path.join(root, '.devflow'));
    git(root, ['add', '-f', '--', '.devflow']);

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('answers tracked for a .devflow entry that is a plain file', () => {
    commitRepo({ '.devflow': 'a file\n' });
    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('answers tracked when the listing is longer than the buffer', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i++) files[`.devflow/learning/${'n'.repeat(40)}-${i}.txt`] = 'x\n';
    commitRepo(files);

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('is not misled by a ledger folder that exists on disk and is not tracked', () => {
    commitRepo({ 'README.md': 'readme\n' });
    fs.mkdirSync(path.join(root, '.devflow', 'curation'), { recursive: true });
    fs.writeFileSync(path.join(root, '.devflow', 'curation', 'decisions-log.jsonl'), 'row\n');

    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
  });

  it('answers unknown when a .git entry stands and git exits non-zero', () => {
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    vi.stubEnv('PATH', pathWith({ failingGit: true }));

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
  });

  it('answers unknown when a .git entry stands and git is not on the PATH', () => {
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    vi.stubEnv('PATH', pathWith({ failingGit: false }));

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
  });

  it('answers unknown when a .git entry stands and is not a repository', () => {
    fs.mkdirSync(path.join(root, '.git'));
    // No repository above the temp tree can answer in its place.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tmp);
    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
  });

  it('answers unknown when git does not answer in time', () => {
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    const real = nodeChildProcess.spawnSync;
    vi.spyOn(nodeChildProcess, 'spawnSync').mockImplementation(((command: string, ...rest: unknown[]) => {
      if (command === 'git') return { pid: 0, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: 'SIGTERM', status: null, error: errorWith('ETIMEDOUT') };
      return (real as (...a: unknown[]) => unknown)(command, ...rest);
    }) as never);

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
  });

  it('never throws: a spawn that throws answers unknown', () => {
    commitRepo({ 'README.md': 'readme\n' });
    vi.spyOn(nodeChildProcess, 'spawnSync').mockImplementation((() => {
      throw new TypeError('bad argument');
    }) as never);

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
  });

  it('is not misled by an index or git directory named in the environment', () => {
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    vi.stubEnv('GIT_INDEX_FILE', path.join(tmp, 'nonexistent-index'));
    vi.stubEnv('GIT_DIR', path.join(tmp, 'nonexistent-dir'));
    vi.stubEnv('GIT_WORK_TREE', path.join(tmp, 'nonexistent-tree'));

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('is not misled by literal pathspecs forced in the environment', () => {
    commitRepo({ '.devflow/Learning/decisions.md': 'x\n' });
    vi.stubEnv('GIT_LITERAL_PATHSPECS', '1');
    vi.stubEnv('GIT_NOGLOB_PATHSPECS', '1');

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('asks git once, with an argv, a bound, no shell and a clean environment', () => {
    commitRepo({ 'README.md': 'readme\n' });
    vi.stubEnv('GIT_INDEX_FILE', '/nonexistent');
    vi.stubEnv('GIT_DIR', '/nonexistent');
    vi.stubEnv('GIT_COMMON_DIR', '/nonexistent');
    vi.stubEnv('GIT_OBJECT_DIRECTORY', '/nonexistent');
    vi.stubEnv('GIT_ALTERNATE_OBJECT_DIRECTORIES', '/nonexistent');
    vi.stubEnv('GIT_NAMESPACE', 'n');
    vi.stubEnv('GIT_GLOB_PATHSPECS', '1');
    vi.stubEnv('GIT_ICASE_PATHSPECS', '1');
    vi.stubEnv('GIT_OPTIONAL_LOCKS', '1');
    vi.stubEnv('LC_ALL', 'de_DE.UTF-8');
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    leaf.checkTrackedAreas(root);

    const made = gitCalls(calls);
    expect(made).toHaveLength(1);
    const [, args, options] = made[0] as [string, string[], {
      cwd: string; timeout: number; maxBuffer: number; shell?: boolean; env: NodeJS.ProcessEnv;
    }];
    expect(args).toEqual([
      '--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...leaf.TRACKED_AREA_PATHSPECS,
    ]);
    expect(options.cwd).toBe(root);
    expect(options.timeout).toBe(5000);
    expect(options.maxBuffer).toBeGreaterThan(0);
    expect(options.maxBuffer).toBeLessThanOrEqual(4096);
    expect(options.shell).toBeFalsy();
    for (const name of [
      'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS',
      'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS',
    ]) expect(options.env, name).not.toHaveProperty(name);
    expect(options.env.LC_ALL).toBe('C');
    expect(options.env.GIT_OPTIONAL_LOCKS).toBe('0');
    expect(options.env.PATH).toBe(process.env.PATH);
  });

  it('does not run the core.fsmonitor command of the repository', () => {
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    const marker = path.join(tmp, 'fsmonitor-ran');
    // git runs the command through a shell and appends its arguments; the `#` ends the command there.
    git(root, ['config', 'core.fsmonitor', `echo ran >> '${marker}' #`]);

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
    expect(fs.existsSync(marker), 'the check ran the fsmonitor command').toBe(false);

    // Known-bad probe: the same index read without the override runs the command.
    git(root, ['ls-files', '-z']);
    expect(fs.existsSync(marker)).toBe(true);
  });
});
