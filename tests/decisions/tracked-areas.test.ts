// tests/decisions/tracked-areas.test.ts
//
// The tracked-areas check (hooks/lib/tracked-areas.cjs): does git track any entry under
// the old data folder, the new data folder or a backup folder the move leaves, at a root?
// One `git ls-files` call over a fixed set of pathspecs answers `tracked`, `untracked` or
// `unknown`. A root with no `.git` entry makes no git call. Every test builds its own
// project in a temp tree.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { git, initGitRepo, pathWithFailingGit, pathWithoutGit, PROJECT_PATHS, trackInGit } from './curation-fixtures.js';

type TrackedAnswer = 'tracked' | 'untracked' | 'unknown';

interface SpawnAnswer {
  error?: Error & { code?: string };
  status?: number | null;
  stdout?: Buffer | string | null;
}

interface Inspection {
  answer: TrackedAnswer;
  cause: string | null;
}

interface TrackedAreas {
  TRACKED_AREA_PATHSPECS: readonly string[];
  UNKNOWN_CAUSES: Readonly<Record<string, string>>;
  judgeTrackedAreas(result: unknown): Inspection;
  classifyTrackedAreas(result: unknown): TrackedAnswer;
  inspectTrackedAreas(root: unknown): Inspection;
  checkTrackedAreas(root: unknown): TrackedAnswer;
}

const LEAF = path.resolve(import.meta.dirname, '../../src/assets/scripts/hooks/lib/tracked-areas.cjs');
const nodeRequire = createRequire(import.meta.url);
const leaf = nodeRequire(LEAF) as TrackedAreas;
/** The child_process module object the leaf calls git through: a spy on it reaches the leaf. */
const nodeChildProcess = nodeRequire('child_process') as typeof import('child_process');
const { LEGACY_NAMES, CURATION_DIR_NAME } = nodeRequire(PROJECT_PATHS) as {
  LEGACY_NAMES: { folder: string; backupPrefix: string };
  CURATION_DIR_NAME: string;
};

/** The folder names the check covers, read from the path helpers that own them. */
const OLD_FOLDER = LEGACY_NAMES.folder;
const NEW_FOLDER = CURATION_DIR_NAME;
const BACKUP_PREFIX = LEGACY_NAMES.backupPrefix;
/** A backup folder name as the move writes it: the prefix, a UTC stamp, a random tail. */
const BACKUP = `${BACKUP_PREFIX}20261001T000001Z-00000001`;

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

describe('judgeTrackedAreas — the answer of one git ls-files call, with its cause', () => {
  const judged: Array<[name: string, result: unknown, expected: Inspection]> = [
    ['exit 0 with nothing listed', { status: 0, stdout: Buffer.alloc(0) }, { answer: 'untracked', cause: null }],
    ['an entry listed', { status: 0, stdout: Buffer.from('.devflow/learning/a\0') }, { answer: 'tracked', cause: null }],
    ['an entry listed with a non-zero exit', { status: 1, stdout: Buffer.from('.devflow/curation/a\0') }, { answer: 'tracked', cause: null }],
    ['output past the buffer cap', { error: errorWith('ENOBUFS'), status: null, stdout: Buffer.alloc(0) }, { answer: 'tracked', cause: null }],
    ['git is not installed', { error: errorWith('ENOENT'), status: null, stdout: null }, { answer: 'unknown', cause: 'git-not-found' }],
    ['a timeout with nothing listed', { error: errorWith('ETIMEDOUT'), status: null, signal: 'SIGTERM', stdout: Buffer.alloc(0) }, { answer: 'unknown', cause: 'git-timed-out' }],
    ['a spawn error of any other kind', { error: errorWith('EACCES'), status: null, stdout: null }, { answer: 'unknown', cause: 'git-not-run' }],
    ['a non-zero exit with nothing listed', { status: 128, stdout: Buffer.alloc(0) }, { answer: 'unknown', cause: 'git-exit-status' }],
    ['a process ended by a signal', { status: null, signal: 'SIGKILL', stdout: Buffer.alloc(0) }, { answer: 'unknown', cause: 'git-stopped' }],
    ['no exit status and no signal', { status: null, stdout: Buffer.alloc(0) }, { answer: 'unknown', cause: 'git-not-run' }],
    ['no result at all', undefined, { answer: 'unknown', cause: 'git-not-run' }],
    ['a result of the wrong shape', 'tracked', { answer: 'unknown', cause: 'git-not-run' }],
  ];

  it.each(judged)('%s', (_name, result, expected) => {
    expect(leaf.judgeTrackedAreas(result)).toEqual(expected);
    expect(leaf.classifyTrackedAreas(result)).toBe(expected.answer);
  });
});

describe('UNKNOWN_CAUSES', () => {
  it('is a frozen closed set of fixed words that the shell can log: lowercase letters and hyphens, at most 32 bytes', () => {
    const words = Object.values(leaf.UNKNOWN_CAUSES);
    expect(Object.isFrozen(leaf.UNKNOWN_CAUSES)).toBe(true);
    expect(new Set(words).size).toBe(words.length);
    for (const word of words) expect(word).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    for (const word of words) expect(Buffer.byteLength(word)).toBeLessThanOrEqual(32);
  });

  it('names the nine causes', () => {
    expect(Object.values(leaf.UNKNOWN_CAUSES).sort()).toEqual([
      'ceiling-unusable', 'check-failed', 'git-entry-unreadable', 'git-exit-status', 'git-not-found',
      'git-not-run', 'git-stopped', 'git-timed-out', 'root-not-absolute',
    ]);
  });
});

describe('TRACKED_AREA_PATHSPECS', () => {
  it('names both folders, the backup folders and the .devflow entry, under both spellings of .devflow, case-folded', () => {
    const spellings = ['.devflow', `.dev${LIGATURE}ow`];
    const expected = [
      ...spellings.flatMap(dir => [
        `:(icase,literal)${dir}/${OLD_FOLDER}`,
        `:(icase,literal)${dir}/${NEW_FOLDER}`,
        `:(icase,glob)${dir}/${BACKUP_PREFIX}*`,
        `:(icase,glob)${dir}/${BACKUP_PREFIX}*/**`,
      ]),
      ...spellings.map(dir => `:(icase,glob)[.]${dir.slice(1)}`),
    ];
    expect([...leaf.TRACKED_AREA_PATHSPECS].sort()).toEqual(expected.sort());
  });

  it('is frozen', () => {
    expect(Object.isFrozen(leaf.TRACKED_AREA_PATHSPECS)).toBe(true);
  });
});

describe('the leaf module', () => {
  it('requires the node built-ins it calls and the path helpers, and neither the store nor the move module', () => {
    const source = fs.readFileSync(LEAF, 'utf8');
    const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
    expect(required.sort()).toEqual(['./project-paths.cjs', 'child_process', 'fs', 'path']);
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
    trackInGit(root, Object.keys(files));
  }

  const gitCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter(([command]) => command === 'git');

  it('makes no git call and answers untracked when the root has no .git entry', () => {
    fs.mkdirSync(path.join(root, '.devflow', 'learning'), { recursive: true });
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
    expect(gitCalls(calls)).toEqual([]);
  });

  it('decides by a .git entry of any kind: a file counts as much as a folder', () => {
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: ' + path.join(tmp, 'elsewhere') + '\n');
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
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

  it.each([
    ['a file in a backup folder', `.devflow/${BACKUP}/.pending-turns.jsonl`],
    ['a file deep in a backup folder', `.devflow/${BACKUP}/a/b/c.txt`],
    ['a backup entry that is a plain file', `.devflow/${BACKUP}`],
    ['a file under another case of the backup name', `.devflow/${BACKUP.replace('learning', 'Learning').replace('backup', 'BACKUP')}/q.jsonl`],
    ['a backup file under an upper-case .DEVFLOW', `.DEVFLOW/${BACKUP}/q.jsonl`],
    ['a backup file under the ligature spelling of .devflow', `.dev${LIGATURE}ow/${BACKUP}/q.jsonl`],
  ])('answers tracked for %s', (_name, rel) => {
    commitRepo({ [rel]: 'content\n' });
    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('answers tracked for a backup entry that is a link', () => {
    commitRepo({ 'README.md': 'readme\n' });
    fs.mkdirSync(path.join(root, '.devflow'));
    fs.symlinkSync('shared', path.join(root, '.devflow', BACKUP));
    git(root, ['add', '-f', '--', `.devflow/${BACKUP}`]);

    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it.each([
    ['a name that only resembles a backup', `.devflow/${OLD_FOLDER}.backupx/a.txt`],
    ['a backup-like name with another stem', `.devflow/other.backup-20261001T000001Z-00000001/a.txt`],
    ['a name that joins the stem with another mark', `.devflow/${OLD_FOLDER}-backup-x/a.txt`],
    ['another file of .devflow', '.devflow/project.json'],
  ])('answers untracked for %s', (_name, rel) => {
    commitRepo({ [rel]: 'content\n' });
    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
  });

  it('is not misled by a backup folder that exists on disk and is not tracked', () => {
    commitRepo({ 'README.md': 'readme\n' });
    fs.mkdirSync(path.join(root, '.devflow', BACKUP), { recursive: true });
    fs.writeFileSync(path.join(root, '.devflow', BACKUP, '.pending-turns.jsonl'), 'row\n');

    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
  });

  describe('a gitlink entry (mode 160000)', () => {
    /** Record a gitlink at `rel` in the index, with no checkout behind it. */
    function trackGitlink(rel: string): void {
      const sha = git(root, ['rev-parse', 'HEAD']);
      git(root, ['update-index', '--add', '--cacheinfo', `160000,${sha},${rel}`]);
      expect(git(root, ['ls-files', '-s', '--', rel])).toMatch(/^160000 /);
    }

    it.each([
      ['.devflow itself', '.devflow'],
      ['the old folder', `.devflow/${OLD_FOLDER}`],
      ['the new folder', `.devflow/${NEW_FOLDER}`],
      ['a path below the old folder', `.devflow/${OLD_FOLDER}/vendor`],
      ['a backup folder', `.devflow/${BACKUP}`],
      ['a path below a backup folder', `.devflow/${BACKUP}/vendor`],
    ])('answers tracked for a gitlink at %s', (_name, rel) => {
      commitRepo({ 'README.md': 'readme\n' });
      trackGitlink(rel);

      expect(leaf.checkTrackedAreas(root)).toBe('tracked');
    });

    it('answers untracked for a gitlink at another path of .devflow', () => {
      commitRepo({ 'README.md': 'readme\n' });
      trackGitlink('.devflow/vendor');

      expect(leaf.checkTrackedAreas(root)).toBe('untracked');
    });
  });

  it.each([
    ['no root', undefined, 'root-not-absolute'],
    ['a null root', null, 'root-not-absolute'],
    ['a number', 42, 'root-not-absolute'],
    ['an object', {}, 'root-not-absolute'],
    ['an empty string', '', 'root-not-absolute'],
    ['a relative path', 'project', 'root-not-absolute'],
    ['a dot', '.', 'root-not-absolute'],
    ['a path with a NUL byte', '/tmp/a\u0000b', 'git-entry-unreadable'],
  ])('answers unknown, with no git call and no throw, for %s', (_name, badRoot, cause) => {
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.checkTrackedAreas(badRoot)).toBe('unknown');
    expect(leaf.inspectTrackedAreas(badRoot)).toEqual({ answer: 'unknown', cause });
    expect(gitCalls(calls)).toEqual([]);
  });

  it('answers unknown, with no git call, when the folder above the root holds the list separator', () => {
    const colonRoot = path.join(tmp, `a${path.delimiter}b`, 'project');
    fs.mkdirSync(colonRoot, { recursive: true });
    initGitRepo(colonRoot);
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.checkTrackedAreas(colonRoot)).toBe('unknown');
    expect(leaf.inspectTrackedAreas(colonRoot)).toEqual({ answer: 'unknown', cause: 'ceiling-unusable' });
    expect(gitCalls(calls)).toEqual([]);
  });

  it('answers unknown for an empty .git at a root inside another repository', () => {
    initGitRepo(tmp);
    fs.mkdirSync(path.join(root, '.git'));

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
  });

  it('answers unknown for an empty .git at a root reached through a link, inside another repository', () => {
    initGitRepo(tmp);
    const real = path.join(tmp, 'work', 'project');
    fs.mkdirSync(path.join(real, '.git'), { recursive: true });
    const linkDir = path.join(tmp, 'elsewhere');
    fs.mkdirSync(linkDir);
    const linked = path.join(linkDir, 'project');
    fs.symlinkSync(real, linked);

    expect(leaf.checkTrackedAreas(linked)).toBe('unknown');
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
    vi.stubEnv('PATH', pathWithFailingGit(tmp));

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
  });

  it('answers unknown when a .git entry stands and git is not on the PATH', () => {
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    vi.stubEnv('PATH', pathWithoutGit(tmp));

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'unknown', cause: 'git-not-found' });
  });

  it('answers unknown when a .git entry stands and is not a repository', () => {
    fs.mkdirSync(path.join(root, '.git'));
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
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'unknown', cause: 'git-timed-out' });
  });

  it('never throws: a spawn that throws answers unknown, with the cause check-failed', () => {
    commitRepo({ 'README.md': 'readme\n' });
    vi.spyOn(nodeChildProcess, 'spawnSync').mockImplementation((() => {
      throw new TypeError('bad argument');
    }) as never);

    expect(leaf.checkTrackedAreas(root)).toBe('unknown');
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'unknown', cause: 'check-failed' });
  });

  it.skipIf(process.getuid?.() === 0)('answers unknown, with the cause git-entry-unreadable, when the .git entry can not be probed', () => {
    fs.chmodSync(root, 0o000);
    try {
      expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'unknown', cause: 'git-entry-unreadable' });
    } finally {
      fs.chmodSync(root, 0o700);
    }
  });

  it('gives no cause for an answer of tracked or untracked, and the same answer through checkTrackedAreas', () => {
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'untracked', cause: null });
    commitRepo({ '.devflow/learning/decisions.md': 'x\n' });
    expect(leaf.inspectTrackedAreas(root)).toEqual({ answer: 'tracked', cause: null });
    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
  });

  it('only ever names a cause from UNKNOWN_CAUSES', () => {
    fs.mkdirSync(path.join(root, '.git'));
    const { cause } = leaf.inspectTrackedAreas(root);
    expect(Object.values(leaf.UNKNOWN_CAUSES)).toContain(cause);
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
    vi.stubEnv('GIT_CEILING_DIRECTORIES', '/nonexistent');
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
    expect(options.env.GIT_CEILING_DIRECTORIES).toBe(path.dirname(root));
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
