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

type Area = 'curation' | 'memory';
/** The areas the leaf checks: the two data areas and their union. */
type CheckedArea = Area | 'both';

/** What `trackedAreaCall` answers when no git call is due, or the call to make. */
interface GitCall {
  cwd: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
}

interface TrackedAreas {
  TRACKED_AREA_PATHSPECS: readonly string[];
  MEMORY_AREA_PATHSPECS: readonly string[];
  AREA_PATHSPECS: Readonly<Record<CheckedArea, readonly string[]>>;
  DEVFLOW_SPELLINGS: readonly string[];
  GIT_REDIRECT_VARIABLES: readonly string[];
  TRACKED_AREAS_GIT_TIMEOUT_MS: number;
  TRACKED_AREAS_GIT_MAX_BUFFER: number;
  UNKNOWN_CAUSES: Readonly<Record<string, string>>;
  gitEnvWithoutRedirects(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  judgeTrackedAreas(result: unknown): Inspection;
  classifyTrackedAreas(result: unknown): TrackedAnswer;
  trackedAreaCall(root: unknown, area: unknown, baseEnv?: NodeJS.ProcessEnv): Inspection | GitCall;
  inspectTrackedArea(root: unknown, area: unknown, options?: unknown): Inspection;
  inspectTrackedAreaOnce(root: unknown, area: unknown): Inspection;
  ANSWER_MEMO_MAX_ENTRIES: number;
  checkTrackedArea(root: unknown, area: unknown): TrackedAnswer;
  inspectTrackedAreas(root: unknown): Inspection;
  checkTrackedAreas(root: unknown): TrackedAnswer;
}

const LEAF = path.resolve(import.meta.dirname, '../../src/assets/scripts/hooks/lib/tracked-areas.cjs');
const nodeRequire = createRequire(import.meta.url);
const leaf = nodeRequire(LEAF) as TrackedAreas;
/** The child_process module object the leaf calls git through: a spy on it reaches the leaf. */
const nodeChildProcess = nodeRequire('child_process') as typeof import('child_process');
const { LEGACY_NAMES, CURATION_DIR_NAME, getMemoryDir } = nodeRequire(PROJECT_PATHS) as {
  LEGACY_NAMES: { folder: string; backupPrefix: string };
  CURATION_DIR_NAME: string;
  getMemoryDir(projectRoot: string): string;
};

/** The folder names the check covers, read from the path helpers that own them. */
const OLD_FOLDER = LEGACY_NAMES.folder;
const NEW_FOLDER = CURATION_DIR_NAME;
const MEMORY_FOLDER = path.basename(getMemoryDir(path.sep));
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

  it('keeps the curation set and its order exactly as the move and the sweep ask for it', () => {
    const spellings = ['.devflow', `.dev${LIGATURE}ow`];
    expect([...leaf.TRACKED_AREA_PATHSPECS]).toEqual([
      ...spellings.flatMap(dir => [
        `:(icase,literal)${dir}/${OLD_FOLDER}`,
        `:(icase,literal)${dir}/${NEW_FOLDER}`,
        `:(icase,glob)${dir}/${BACKUP_PREFIX}*`,
        `:(icase,glob)${dir}/${BACKUP_PREFIX}*/**`,
      ]),
      ...spellings.map(dir => `:(icase,glob)[.]${dir.slice(1)}`),
    ]);
  });
});

describe('DEVFLOW_SPELLINGS', () => {
  it('lists .devflow and its fl-ligature spelling (U+FB02), frozen', () => {
    expect([...leaf.DEVFLOW_SPELLINGS]).toEqual(['.devflow', `.dev${LIGATURE}ow`]);
    expect(Object.isFrozen(leaf.DEVFLOW_SPELLINGS)).toBe(true);
  });
});

describe('MEMORY_AREA_PATHSPECS and AREA_PATHSPECS', () => {
  it('names the memory folder and the .devflow entry, under both spellings of .devflow, case-folded', () => {
    expect([...leaf.MEMORY_AREA_PATHSPECS]).toEqual([
      `:(icase,literal).devflow/${MEMORY_FOLDER}`,
      `:(icase,literal).dev${LIGATURE}ow/${MEMORY_FOLDER}`,
      ':(icase,glob)[.]devflow',
      `:(icase,glob)[.]dev${LIGATURE}ow`,
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(leaf.MEMORY_AREA_PATHSPECS)).toBe(true);
  });

  it('maps the two areas and their union, and only them, to their sets (the curation set is the one the move asks for)', () => {
    expect(Object.keys(leaf.AREA_PATHSPECS).sort()).toEqual(['both', 'curation', 'memory']);
    expect(leaf.AREA_PATHSPECS.curation).toBe(leaf.TRACKED_AREA_PATHSPECS);
    expect(leaf.AREA_PATHSPECS.memory).toBe(leaf.MEMORY_AREA_PATHSPECS);
    expect(Object.isFrozen(leaf.AREA_PATHSPECS)).toBe(true);
  });

  it('lists the union as the curation set, then the memory set, with each entry once', () => {
    const entryGlobs = leaf.DEVFLOW_SPELLINGS.map(dir => ':(icase,glob)[.]' + dir.slice(1));
    const memoryOnly = leaf.MEMORY_AREA_PATHSPECS.filter(spec => !entryGlobs.includes(spec));
    expect(memoryOnly).toEqual([
      `:(icase,literal).devflow/${MEMORY_FOLDER}`,
      `:(icase,literal).dev${LIGATURE}ow/${MEMORY_FOLDER}`,
    ]);
    expect([...leaf.AREA_PATHSPECS.both]).toEqual([...leaf.TRACKED_AREA_PATHSPECS, ...memoryOnly]);
    expect(new Set(leaf.AREA_PATHSPECS.both).size).toBe(leaf.AREA_PATHSPECS.both.length);
    for (const spec of [...leaf.TRACKED_AREA_PATHSPECS, ...leaf.MEMORY_AREA_PATHSPECS]) expect(leaf.AREA_PATHSPECS.both).toContain(spec);
    expect(Object.isFrozen(leaf.AREA_PATHSPECS.both)).toBe(true);
  });

  it('leaves the curation set and the memory set as they were, each frozen and apart from the union', () => {
    expect(leaf.AREA_PATHSPECS.both).not.toBe(leaf.TRACKED_AREA_PATHSPECS);
    expect(leaf.AREA_PATHSPECS.both).not.toBe(leaf.MEMORY_AREA_PATHSPECS);
    expect(Object.isFrozen(leaf.TRACKED_AREA_PATHSPECS)).toBe(true);
    expect(Object.isFrozen(leaf.MEMORY_AREA_PATHSPECS)).toBe(true);
  });

  it('has no glob character in the folder name it matches as a literal', () => {
    expect(MEMORY_FOLDER).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('GIT_REDIRECT_VARIABLES and the git call bounds', () => {
  it('lists the variables that make git read another repository, index or pathspec rule, frozen', () => {
    expect([...leaf.GIT_REDIRECT_VARIABLES].sort()).toEqual([
      'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_DIR', 'GIT_GLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS',
      'GIT_INDEX_FILE', 'GIT_LITERAL_PATHSPECS', 'GIT_NAMESPACE', 'GIT_NOGLOB_PATHSPECS', 'GIT_OBJECT_DIRECTORY',
      'GIT_WORK_TREE',
    ]);
    expect(Object.isFrozen(leaf.GIT_REDIRECT_VARIABLES)).toBe(true);
  });

  it('bounds the git call at five seconds and 4 KiB of output', () => {
    expect(leaf.TRACKED_AREAS_GIT_TIMEOUT_MS).toBe(5000);
    expect(leaf.TRACKED_AREAS_GIT_MAX_BUFFER).toBe(4096);
  });
});

describe('gitEnvWithoutRedirects', () => {
  it('answers a new object without the redirecting variables, and changes nothing else', () => {
    const base: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      LC_ALL: 'de_DE.UTF-8',
      GIT_OPTIONAL_LOCKS: '1',
      GIT_CEILING_DIRECTORIES: '/somewhere',
      GIT_AUTHOR_NAME: 'a',
      ...Object.fromEntries(leaf.GIT_REDIRECT_VARIABLES.map(name => [name, '/nonexistent'])),
    };
    const copy = { ...base };

    const scrubbed = leaf.gitEnvWithoutRedirects(base);

    expect(scrubbed).not.toBe(base);
    expect(base).toEqual(copy);
    for (const name of leaf.GIT_REDIRECT_VARIABLES) expect(scrubbed, name).not.toHaveProperty(name);
    expect(scrubbed).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/x',
      LC_ALL: 'de_DE.UTF-8',
      GIT_OPTIONAL_LOCKS: '1',
      GIT_CEILING_DIRECTORIES: '/somewhere',
      GIT_AUTHOR_NAME: 'a',
    });
  });

  it('answers an empty object for an environment with nothing in it', () => {
    expect(leaf.gitEnvWithoutRedirects({})).toEqual({});
  });
});

describe('inspectTrackedAreaOnce', () => {
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-once-')));
    root = path.join(tmp, 'project');
    fs.mkdirSync(root);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const gitCallsOf = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter(([command]) => command === 'git');

  it('answers what inspectTrackedArea answers, for each area', () => {
    initGitRepo(root, { [`.devflow/${MEMORY_FOLDER}/WORKING-MEMORY.md`]: 'wm\n' });

    expect(leaf.inspectTrackedAreaOnce(root, 'memory')).toEqual({ answer: 'tracked', cause: null });
    expect(leaf.inspectTrackedAreaOnce(root, 'curation')).toEqual({ answer: 'untracked', cause: null });
    expect(leaf.inspectTrackedAreaOnce(root, 'both')).toEqual({ answer: 'tracked', cause: null });
  });

  it('asks git once per root and area for the life of the process, whatever the project does meanwhile', () => {
    initGitRepo(root, { 'README.md': 'readme\n' });
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    const first = leaf.inspectTrackedAreaOnce(root, 'curation');
    trackInGit(root, [`.devflow/${NEW_FOLDER}/decisions.md`], { commit: true });
    const second = leaf.inspectTrackedAreaOnce(root, 'curation');

    expect(first).toEqual({ answer: 'untracked', cause: null });
    expect(second).toEqual(first);
    expect(gitCallsOf(calls)).toHaveLength(1);
    expect(leaf.inspectTrackedArea(root, 'curation').answer, 'a direct ask still reads the index').toBe('tracked');
  });

  it('keeps one answer per area and per root', () => {
    initGitRepo(root, { 'README.md': 'readme\n' });
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    initGitRepo(other, { [`.devflow/${NEW_FOLDER}/decisions.md`]: 'd\n' });
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.inspectTrackedAreaOnce(root, 'curation').answer).toBe('untracked');
    expect(leaf.inspectTrackedAreaOnce(root, 'memory').answer).toBe('untracked');
    expect(leaf.inspectTrackedAreaOnce(other, 'curation').answer).toBe('tracked');
    expect(leaf.inspectTrackedAreaOnce(other, 'memory').answer).toBe('untracked');
    expect(gitCallsOf(calls)).toHaveLength(4);
    leaf.inspectTrackedAreaOnce(root, 'curation');
    leaf.inspectTrackedAreaOnce(other, 'memory');
    expect(gitCallsOf(calls)).toHaveLength(4);
  });

  it('keeps an unknown answer and its cause as well', () => {
    fs.mkdirSync(path.join(root, '.git'));
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.inspectTrackedAreaOnce(root, 'curation')).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
    expect(leaf.inspectTrackedAreaOnce(root, 'curation')).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
    expect(gitCallsOf(calls)).toHaveLength(1);
  });

  it('makes no git call for a root with no .git entry', () => {
    const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

    expect(leaf.inspectTrackedAreaOnce(root, 'both')).toEqual({ answer: 'untracked', cause: null });
    expect(gitCallsOf(calls)).toEqual([]);
  });

  it('answers unknown for an area it does not know, and for a root that is not an absolute path', () => {
    expect(leaf.inspectTrackedAreaOnce(root, 'nonsense')).toEqual({ answer: 'unknown', cause: 'check-failed' });
    expect(leaf.inspectTrackedAreaOnce('project', 'curation')).toEqual({ answer: 'unknown', cause: 'root-not-absolute' });
    expect(leaf.inspectTrackedAreaOnce(undefined, 'curation')).toEqual({ answer: 'unknown', cause: 'root-not-absolute' });
    expect(leaf.inspectTrackedAreaOnce(root, undefined)).toEqual({ answer: 'unknown', cause: 'check-failed' });
  });

  it('answers a new object each time, so a caller can not change the next answer', () => {
    const first = leaf.inspectTrackedAreaOnce(root, 'curation') as { answer: string; cause: string | null };
    first.answer = 'tracked';

    expect(leaf.inspectTrackedAreaOnce(root, 'curation')).toEqual({ answer: 'untracked', cause: null });
  });

  it('keeps at most ANSWER_MEMO_MAX_ENTRIES answers: the oldest goes first', () => {
    expect(leaf.ANSWER_MEMO_MAX_ENTRIES).toBe(64);
    expect(leaf.inspectTrackedAreaOnce(root, 'curation').answer).toBe('untracked');
    for (let i = 0; i < leaf.ANSWER_MEMO_MAX_ENTRIES; i++) leaf.inspectTrackedAreaOnce(path.join(tmp, `filler-${i}`), 'curation');
    initGitRepo(root, { [`.devflow/${NEW_FOLDER}/decisions.md`]: 'd\n' });

    expect(leaf.inspectTrackedAreaOnce(root, 'curation').answer, 'the first answer was dropped, so git is asked again').toBe('tracked');
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

// ---------------------------------------------------------------------------
// One answer per data folder: the curation area and the memory area
// ---------------------------------------------------------------------------

const AREAS: readonly Area[] = ['curation', 'memory'];
/** Every area the leaf answers for: the two data areas and their union. */
const CHECKED_AREAS: readonly CheckedArea[] = [...AREAS, 'both'];
const otherOf = (area: Area): Area => (area === 'curation' ? 'memory' : 'curation');

/** The folders each area covers: git tracking an entry at or below one pauses that area only. */
const FOLDERS: Readonly<Record<Area, readonly string[]>> = {
  curation: [`.devflow/${NEW_FOLDER}`, `.devflow/${OLD_FOLDER}`, `.devflow/${BACKUP}`],
  memory: [`.devflow/${MEMORY_FOLDER}`],
};

describe('the answer per data folder', () => {
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-')));
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

  /** Record a gitlink (mode 160000) at `rel` in the index, with no checkout behind it. */
  function trackGitlink(rel: string): void {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-index', '--add', '--cacheinfo', `160000,${sha},${rel}`]);
    expect(git(root, ['ls-files', '-s', '--', rel])).toMatch(/^160000 /);
  }

  /** Track a link at `rel` that points to a sibling name. */
  function trackLink(rel: string): void {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.symlinkSync('shared', path.join(root, rel));
    git(root, ['add', '-f', '--', rel]);
  }

  const gitCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] => spy.mock.calls.filter(([command]) => command === 'git');

  /** How git can come to track an entry at or below a data folder. */
  interface EntryCase {
    readonly name: string;
    /** Whether the short matrix (the legacy and backup folders) runs it. */
    readonly short: boolean;
    setup(folder: string): void;
  }

  const folderCases: readonly EntryCase[] = [
    { name: 'a committed file below it', short: true, setup: folder => commitRepo({ [`${folder}/note.txt`]: 'x\n' }) },
    {
      name: 'a staged file below it',
      short: false,
      setup: folder => {
        commitRepo({ 'README.md': 'readme\n' });
        stage({ [`${folder}/note.txt`]: 'staged\n' });
        expect(git(root, ['log', '--oneline', '--', '.devflow'])).toBe('');
      },
    },
    {
      name: 'a file deleted from the work tree',
      short: true,
      setup: folder => {
        commitRepo({ [`${folder}/note.txt`]: 'x\n' });
        fs.rmSync(path.join(root, '.devflow'), { recursive: true, force: true });
        expect(fs.existsSync(path.join(root, folder))).toBe(false);
      },
    },
    {
      name: 'a skip-worktree file',
      short: false,
      setup: folder => {
        commitRepo({ [`${folder}/note.txt`]: 'x\n' });
        git(root, ['update-index', '--skip-worktree', '--', `${folder}/note.txt`]);
        expect(git(root, ['ls-files', '-v', '--', `${folder}/note.txt`])).toMatch(/^S /);
      },
    },
    { name: 'a file under an upper-case spelling', short: false, setup: folder => commitRepo({ [`${folder.toUpperCase()}/NOTE.TXT`]: 'x\n' }) },
    {
      name: 'a file under the ligature spelling of .devflow',
      short: false,
      setup: folder => commitRepo({ [`${folder.replace('.devflow', `.dev${LIGATURE}ow`)}/note.txt`]: 'x\n' }),
    },
    {
      name: 'a gitlink at the folder',
      short: true,
      setup: folder => {
        commitRepo({ 'README.md': 'readme\n' });
        trackGitlink(folder);
      },
    },
    {
      name: 'a gitlink below the folder',
      short: false,
      setup: folder => {
        commitRepo({ 'README.md': 'readme\n' });
        trackGitlink(`${folder}/vendor`);
      },
    },
    {
      name: 'the folder as a link',
      short: false,
      setup: folder => {
        commitRepo({ 'README.md': 'readme\n' });
        trackLink(folder);
      },
    },
    { name: 'the folder as a plain file', short: false, setup: folder => commitRepo({ [folder]: 'a file\n' }) },
  ];

  /** How git can come to track the `.devflow` entry itself, which stands over both areas. */
  const devflowEntryCases: ReadonlyArray<{ readonly name: string; setup(): void }> = [
    {
      name: '.devflow as a link',
      setup: () => {
        commitRepo({ 'README.md': 'readme\n' });
        trackLink('.devflow');
      },
    },
    { name: '.devflow as a plain file', setup: () => commitRepo({ '.devflow': 'a file\n' }) },
    { name: '.DEVFLOW as a plain file', setup: () => commitRepo({ '.DEVFLOW': 'a file\n' }) },
    { name: `.dev${LIGATURE}ow as a plain file`, setup: () => commitRepo({ [`.dev${LIGATURE}ow`]: 'a file\n' }) },
    {
      name: '.devflow as a gitlink',
      setup: () => {
        commitRepo({ 'README.md': 'readme\n' });
        trackGitlink('.devflow');
      },
    },
  ];

  describe.each(AREAS)('the %s area answers tracked for any entry kind and spelling, and leaves the other area alone', (area) => {
    for (const folder of FOLDERS[area]) {
      const primary = folder === FOLDERS[area][0];
      const cases = folderCases.filter(entry => primary || entry.short);
      it.each(cases)(`at ${folder.replace(BACKUP, '<backup>')}: $name`, ({ setup }) => {
        setup(folder);

        expect(leaf.checkTrackedArea(root, area)).toBe('tracked');
        expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'tracked', cause: null });
        expect(leaf.checkTrackedArea(root, otherOf(area))).toBe('untracked');
      });
    }

    it('answers untracked for a repository that tracks only other files of .devflow, with the folder on disk', () => {
      commitRepo({
        'README.md': 'readme\n',
        '.devflow/project.json': '{}\n',
        '.devflow/features/x/KNOWLEDGE.md': 'kb\n',
        '.devflow/docs/a.md': 'doc\n',
      });
      for (const folder of FOLDERS[area]) {
        fs.mkdirSync(path.join(root, folder), { recursive: true });
        fs.writeFileSync(path.join(root, folder, 'note.txt'), 'untracked\n');
      }

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'untracked', cause: null });
    });
  });

  it.each(devflowEntryCases)('answers tracked for both areas when git tracks $name, which stands over them', ({ setup }) => {
    setup();

    for (const area of AREAS) expect(leaf.checkTrackedArea(root, area), area).toBe('tracked');
  });

  it.each([
    ['a folder named like the memory folder with a suffix', `.devflow/${MEMORY_FOLDER}-notes/a.txt`],
    ['a file named like the memory folder with an extension', `.devflow/${MEMORY_FOLDER}.md`],
    ['a name that continues the memory folder name', `.devflow/${MEMORY_FOLDER}x`],
    ['a memory folder that is not directly below .devflow', `.devflow/other/${MEMORY_FOLDER}/a.txt`],
    ['a memory folder at the project root', `${MEMORY_FOLDER}/a.txt`],
  ])('answers untracked for both areas for %s', (_name, rel) => {
    commitRepo({ [rel]: 'content\n' });

    expect(leaf.checkTrackedArea(root, 'memory')).toBe('untracked');
    expect(leaf.checkTrackedArea(root, 'curation')).toBe('untracked');
  });

  it('keeps the answer of checkTrackedAreas equal to the curation area, on a tracked and an untracked project', () => {
    expect(leaf.inspectTrackedAreas(root)).toEqual(leaf.inspectTrackedArea(root, 'curation'));
    commitRepo({ [`.devflow/${MEMORY_FOLDER}/WORKING-MEMORY.md`]: 'wm\n' });
    expect(leaf.checkTrackedAreas(root)).toBe('untracked');
    expect(leaf.checkTrackedArea(root, 'curation')).toBe('untracked');
    stage({ [`.devflow/${NEW_FOLDER}/decisions.md`]: 'd\n' });
    expect(leaf.checkTrackedAreas(root)).toBe('tracked');
    expect(leaf.checkTrackedArea(root, 'curation')).toBe('tracked');
    expect(leaf.checkTrackedArea(root, 'memory')).toBe('tracked');
  });

  describe('the both area', () => {
    it.each([
      ['the curation folder', FOLDERS.curation[0]],
      ['the legacy learning folder', FOLDERS.curation[1]],
      ['a backup folder', FOLDERS.curation[2]],
      ['the memory folder', FOLDERS.memory[0]],
    ])('answers tracked when git tracks a file below %s', (_name, folder) => {
      commitRepo({ [`${folder}/note.txt`]: 'x\n' });

      expect(leaf.inspectTrackedArea(root, 'both')).toEqual({ answer: 'tracked', cause: null });
      expect(leaf.checkTrackedArea(root, 'both')).toBe('tracked');
    });

    it.each(devflowEntryCases)('answers tracked when git tracks $name', ({ setup }) => {
      setup();

      expect(leaf.checkTrackedArea(root, 'both')).toBe('tracked');
    });

    it('answers tracked when git tracks a file below the memory folder in the upper-case spelling', () => {
      commitRepo({ [`.DEVFLOW/${MEMORY_FOLDER.toUpperCase()}/NOTE.TXT`]: 'x\n' });
      expect(leaf.checkTrackedArea(root, 'both')).toBe('tracked');
    });

    it('answers tracked when git tracks a folder of each area', () => {
      commitRepo({ [`${FOLDERS.curation[0]}/decisions.md`]: 'd\n', [`${FOLDERS.memory[0]}/WORKING-MEMORY.md`]: 'wm\n' });

      expect(leaf.checkTrackedArea(root, 'both')).toBe('tracked');
    });

    it('answers untracked for a repository that tracks only other files of .devflow, with every folder on disk', () => {
      commitRepo({
        'README.md': 'readme\n',
        '.devflow/project.json': '{}\n',
        '.devflow/features/x/KNOWLEDGE.md': 'kb\n',
      });
      for (const folder of [...FOLDERS.curation, ...FOLDERS.memory]) {
        fs.mkdirSync(path.join(root, folder), { recursive: true });
        fs.writeFileSync(path.join(root, folder, 'note.txt'), 'untracked\n');
      }

      expect(leaf.inspectTrackedArea(root, 'both')).toEqual({ answer: 'untracked', cause: null });
    });

    it('answers unknown for a git that exits non-zero with nothing listed, with the cause of the single areas', () => {
      fs.mkdirSync(path.join(root, '.git'));

      for (const area of CHECKED_AREAS) {
        expect(leaf.inspectTrackedArea(root, area), area).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
      }
    });

    it('asks git once, over the curation set and then the memory entries, so one call covers both folders', () => {
      commitRepo({ 'README.md': 'readme\n' });
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      leaf.checkTrackedArea(root, 'both');

      const made = gitCalls(calls) as Array<[string, string[]]>;
      expect(made).toHaveLength(1);
      expect(made[0][1].slice(0, 6)).toEqual(['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--']);
      expect(made[0][1].slice(6)).toEqual([...leaf.AREA_PATHSPECS.both]);
      expect(made[0][1].slice(6, 6 + leaf.TRACKED_AREA_PATHSPECS.length)).toEqual([...leaf.TRACKED_AREA_PATHSPECS]);
    });

    it('answers tracked when the listing is longer than the buffer', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 200; i++) files[`.devflow/${MEMORY_FOLDER}/${'n'.repeat(40)}-${i}.txt`] = 'x\n';
      commitRepo(files);

      expect(leaf.checkTrackedArea(root, 'both')).toBe('tracked');
    });

    it('does not turn a tracked memory folder untracked under redirecting git variables', () => {
      commitRepo({ [`${FOLDERS.memory[0]}/note.txt`]: 'x\n' });
      vi.stubEnv('GIT_INDEX_FILE', path.join(tmp, 'nonexistent-index'));
      vi.stubEnv('GIT_DIR', path.join(tmp, 'nonexistent-dir'));
      vi.stubEnv('GIT_LITERAL_PATHSPECS', '1');

      expect(leaf.checkTrackedArea(root, 'both')).toBe('tracked');
    });

    it('runs to the same answer as inspectTrackedArea when a runner executes the call and judges the result', () => {
      commitRepo({ [`${FOLDERS.memory[0]}/note.txt`]: 'x\n' });
      const call = leaf.trackedAreaCall(root, 'both') as GitCall;
      const result = nodeChildProcess.spawnSync('git', call.argv, { cwd: call.cwd, env: call.env, stdio: ['ignore', 'pipe', 'ignore'] });

      expect(leaf.judgeTrackedAreas(result)).toEqual({ answer: 'tracked', cause: null });
      expect(leaf.judgeTrackedAreas(result)).toEqual(leaf.inspectTrackedArea(root, 'both'));
    });

    it('is the union: tracked exactly when the curation area or the memory area is tracked', () => {
      commitRepo({ 'README.md': 'readme\n' });
      expect([leaf.checkTrackedArea(root, 'curation'), leaf.checkTrackedArea(root, 'memory'), leaf.checkTrackedArea(root, 'both')]).toEqual(['untracked', 'untracked', 'untracked']);
      stage({ [`${FOLDERS.memory[0]}/a.txt`]: 'a\n' });
      expect([leaf.checkTrackedArea(root, 'curation'), leaf.checkTrackedArea(root, 'memory'), leaf.checkTrackedArea(root, 'both')]).toEqual(['untracked', 'tracked', 'tracked']);
      git(root, ['rm', '-q', '--cached', '-r', '--', FOLDERS.memory[0]]);
      stage({ [`${FOLDERS.curation[0]}/a.txt`]: 'a\n' });
      expect([leaf.checkTrackedArea(root, 'curation'), leaf.checkTrackedArea(root, 'memory'), leaf.checkTrackedArea(root, 'both')]).toEqual(['tracked', 'untracked', 'tracked']);
    });
  });

  describe('a root with no .git entry', () => {
    it.each(CHECKED_AREAS)('makes no git call and answers untracked for the %s area', (area) => {
      fs.mkdirSync(path.join(root, '.devflow', MEMORY_FOLDER), { recursive: true });
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'untracked', cause: null });
      expect(leaf.checkTrackedArea(root, area)).toBe('untracked');
      expect(gitCalls(calls)).toEqual([]);
    });
  });

  describe('an area the leaf does not know', () => {
    it.each([
      ['an empty string', ''],
      ['another case', 'Memory'],
      ['both in another case', 'Both'],
      ['a list of both areas', ['curation', 'memory']],
      ['undefined', undefined],
      ['null', null],
      ['a number', 7],
      ['an object', {}],
      ['an array holding an area', ['memory']],
      ['a name from the object prototype', 'constructor'],
      ['__proto__', '__proto__'],
      ['toString', 'toString'],
    ])('answers unknown with the cause check-failed and no git call for %s', (_name, area) => {
      fs.mkdirSync(path.join(root, '.git'));
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'unknown', cause: 'check-failed' });
      expect(leaf.checkTrackedArea(root, area)).toBe('unknown');
      expect(gitCalls(calls)).toEqual([]);
    });

    it('answers unknown, not untracked, even where the root has no .git entry', () => {
      expect(leaf.inspectTrackedArea(root, 'nonsense')).toEqual({ answer: 'unknown', cause: 'check-failed' });
    });
  });

  describe('a root that is not an absolute path', () => {
    it.each(CHECKED_AREAS)('answers unknown with the cause root-not-absolute, with no git call, for the %s area', (area) => {
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      for (const bad of [undefined, null, 42, {}, '', 'project', '.']) {
        expect(leaf.inspectTrackedArea(bad, area), String(bad)).toEqual({ answer: 'unknown', cause: 'root-not-absolute' });
      }
      expect(gitCalls(calls)).toEqual([]);
    });
  });

  describe('the git call of an area', () => {
    it('is the call checkTrackedAreas makes for the curation area, and the same call over the memory set, or over the union, for the other two', () => {
      commitRepo({ 'README.md': 'readme\n' });
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      leaf.checkTrackedAreas(root);
      leaf.checkTrackedArea(root, 'curation');
      leaf.checkTrackedArea(root, 'memory');
      leaf.checkTrackedArea(root, 'both');

      const made = gitCalls(calls) as Array<[string, string[], { cwd: string; timeout: number; maxBuffer: number; shell?: boolean }]>;
      expect(made).toHaveLength(4);
      const lead = ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--'];
      expect(made[0][1]).toEqual([...lead, ...leaf.TRACKED_AREA_PATHSPECS]);
      expect(made[1][1]).toEqual(made[0][1]);
      expect(made[2][1]).toEqual([...lead, ...leaf.MEMORY_AREA_PATHSPECS]);
      expect(made[3][1]).toEqual([...lead, ...leaf.AREA_PATHSPECS.both]);
      for (const [, , options] of made) {
        expect(options.cwd).toBe(root);
        expect(options.timeout).toBe(5000);
        expect(options.maxBuffer).toBe(4096);
        expect(options.shell).toBeFalsy();
      }
    });

    it('takes the time bound from the options: a positive number of milliseconds', () => {
      commitRepo({ 'README.md': 'readme\n' });
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      leaf.inspectTrackedArea(root, 'memory', { timeoutMs: 1000 });

      const [, , options] = gitCalls(calls)[0] as [string, string[], { timeout: number }];
      expect(options.timeout).toBe(1000);
    });

    it.each([
      ['zero', 0],
      ['a negative number', -5],
      ['not a number', Number.NaN],
      ['infinite', Number.POSITIVE_INFINITY],
      ['a string', '1000'],
      ['null', null],
      ['an object', {}],
    ])('keeps the five-second bound when timeoutMs is %s', (_name, timeoutMs) => {
      commitRepo({ 'README.md': 'readme\n' });
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      leaf.inspectTrackedArea(root, 'curation', { timeoutMs });

      const [, , options] = gitCalls(calls)[0] as [string, string[], { timeout: number }];
      expect(options.timeout).toBe(5000);
    });

    it.each([undefined, null, 'x', 7, []])('keeps the five-second bound when the options are %j', (options) => {
      commitRepo({ 'README.md': 'readme\n' });
      const calls = vi.spyOn(nodeChildProcess, 'spawnSync');

      leaf.inspectTrackedArea(root, 'memory', options);

      const [, , used] = gitCalls(calls)[0] as [string, string[], { timeout: number }];
      expect(used.timeout).toBe(5000);
    });

    it('does not run the core.fsmonitor command of the repository, for the memory area too', () => {
      commitRepo({ [`.devflow/${MEMORY_FOLDER}/WORKING-MEMORY.md`]: 'x\n' });
      const marker = path.join(tmp, 'fsmonitor-ran');
      git(root, ['config', 'core.fsmonitor', `echo ran >> '${marker}' #`]);

      expect(leaf.checkTrackedArea(root, 'memory')).toBe('tracked');
      expect(fs.existsSync(marker), 'the check ran the fsmonitor command').toBe(false);
    });
  });

  describe('a git that does not answer', () => {
    it.each(AREAS)('answers unknown, with the cause git-exit-status, when git exits non-zero (%s)', (area) => {
      commitRepo({ [`${FOLDERS[area][0]}/note.txt`]: 'x\n' });
      vi.stubEnv('PATH', pathWithFailingGit(tmp));

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
    });

    it.each(AREAS)('answers unknown, with the cause git-not-found, when git is not on the PATH (%s)', (area) => {
      commitRepo({ [`${FOLDERS[area][0]}/note.txt`]: 'x\n' });
      vi.stubEnv('PATH', pathWithoutGit(tmp));

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'unknown', cause: 'git-not-found' });
    });

    it.each(CHECKED_AREAS)('answers unknown, with the cause git-timed-out, when git does not answer in time (%s)', (area) => {
      commitRepo({ 'README.md': 'readme\n' });
      const real = nodeChildProcess.spawnSync;
      vi.spyOn(nodeChildProcess, 'spawnSync').mockImplementation(((command: string, ...rest: unknown[]) => {
        if (command === 'git') return { pid: 0, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), signal: 'SIGTERM', status: null, error: errorWith('ETIMEDOUT') };
        return (real as (...a: unknown[]) => unknown)(command, ...rest);
      }) as never);

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'unknown', cause: 'git-timed-out' });
    });

    it.each(CHECKED_AREAS)('never throws: a spawn that throws answers unknown with the cause check-failed (%s)', (area) => {
      commitRepo({ 'README.md': 'readme\n' });
      vi.spyOn(nodeChildProcess, 'spawnSync').mockImplementation((() => {
        throw new TypeError('bad argument');
      }) as never);

      expect(leaf.inspectTrackedArea(root, area)).toEqual({ answer: 'unknown', cause: 'check-failed' });
    });

    it('answers tracked when the listing is longer than the buffer, for the memory area', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 200; i++) files[`.devflow/${MEMORY_FOLDER}/${'n'.repeat(40)}-${i}.txt`] = 'x\n';
      commitRepo(files);

      expect(leaf.checkTrackedArea(root, 'memory')).toBe('tracked');
    });
  });

  describe('git variables in the environment', () => {
    it.each(AREAS)('do not turn a tracked %s area untracked: an index, git directory and work tree that do not exist', (area) => {
      commitRepo({ [`${FOLDERS[area][0]}/note.txt`]: 'x\n' });
      vi.stubEnv('GIT_INDEX_FILE', path.join(tmp, 'nonexistent-index'));
      vi.stubEnv('GIT_DIR', path.join(tmp, 'nonexistent-dir'));
      vi.stubEnv('GIT_WORK_TREE', path.join(tmp, 'nonexistent-tree'));

      expect(leaf.checkTrackedArea(root, area)).toBe('tracked');
    });

    it.each(AREAS)('do not turn a tracked %s area untracked: literal and no-glob pathspecs', (area) => {
      commitRepo({ [`${FOLDERS[area][0].toUpperCase()}/NOTE.TXT`]: 'x\n' });
      vi.stubEnv('GIT_LITERAL_PATHSPECS', '1');
      vi.stubEnv('GIT_NOGLOB_PATHSPECS', '1');

      expect(leaf.checkTrackedArea(root, area)).toBe('tracked');
    });
  });

  describe('trackedAreaCall', () => {
    const NO_CALL = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork'] as const;

    it.each(CHECKED_AREAS)('answers untracked, and prescribes no call, when the root has no .git entry (%s)', (area) => {
      expect(leaf.trackedAreaCall(root, area)).toEqual({ answer: 'untracked', cause: null });
    });

    it('answers unknown with the cause root-not-absolute for a root that is not an absolute path', () => {
      for (const bad of [undefined, null, 42, {}, '', 'project', '.']) {
        expect(leaf.trackedAreaCall(bad, 'memory'), String(bad)).toEqual({ answer: 'unknown', cause: 'root-not-absolute' });
      }
    });

    it('answers unknown with the cause git-entry-unreadable when the .git entry can not be probed', () => {
      expect(leaf.trackedAreaCall('/tmp/a\u0000b', 'curation')).toEqual({ answer: 'unknown', cause: 'git-entry-unreadable' });
    });

    it('answers unknown with the cause check-failed for an area the leaf does not know', () => {
      fs.mkdirSync(path.join(root, '.git'));
      for (const bad of ['', 'Both', undefined, 'constructor', '__proto__']) {
        expect(leaf.trackedAreaCall(root, bad), String(bad)).toEqual({ answer: 'unknown', cause: 'check-failed' });
      }
    });

    it('answers unknown with the cause ceiling-unusable when the folder above the root holds the list separator', () => {
      const colonRoot = path.join(tmp, `a${path.delimiter}b`, 'project');
      fs.mkdirSync(path.join(colonRoot, '.git'), { recursive: true });

      expect(leaf.trackedAreaCall(colonRoot, 'memory')).toEqual({ answer: 'unknown', cause: 'ceiling-unusable' });
    });

    it.each(CHECKED_AREAS)('prescribes the call for the %s area: the root, the argv, a scrubbed environment', (area) => {
      fs.mkdirSync(path.join(root, '.git'));
      vi.stubEnv('GIT_INDEX_FILE', '/nonexistent');
      vi.stubEnv('GIT_DIR', '/nonexistent');
      vi.stubEnv('GIT_LITERAL_PATHSPECS', '1');
      vi.stubEnv('GIT_OPTIONAL_LOCKS', '1');
      vi.stubEnv('GIT_CEILING_DIRECTORIES', '/nonexistent');
      vi.stubEnv('LC_ALL', 'de_DE.UTF-8');

      const call = leaf.trackedAreaCall(root, area) as GitCall;

      expect(call.cwd).toBe(root);
      expect(call.argv).toEqual([
        '--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...leaf.AREA_PATHSPECS[area],
      ]);
      for (const name of leaf.GIT_REDIRECT_VARIABLES) expect(call.env, name).not.toHaveProperty(name);
      expect(call.env.LC_ALL).toBe('C');
      expect(call.env.GIT_OPTIONAL_LOCKS).toBe('0');
      expect(call.env.GIT_CEILING_DIRECTORIES).toBe(path.dirname(root));
      expect(call.env.PATH).toBe(process.env.PATH);
    });

    it('names the folder above the root\'s real path as the ceiling, and keeps the root as given for the working directory', () => {
      const real = path.join(tmp, 'work', 'project');
      fs.mkdirSync(path.join(real, '.git'), { recursive: true });
      const linkDir = path.join(tmp, 'elsewhere');
      fs.mkdirSync(linkDir);
      const linked = path.join(linkDir, 'project');
      fs.symlinkSync(real, linked);

      const call = leaf.trackedAreaCall(linked, 'curation') as GitCall;

      expect(call.cwd).toBe(linked);
      expect(call.env.GIT_CEILING_DIRECTORIES).toBe(path.join(tmp, 'work'));
    });

    it('scrubs the environment it is given instead of the process environment', () => {
      fs.mkdirSync(path.join(root, '.git'));
      vi.stubEnv('FROM_PROCESS', 'yes');
      const given: NodeJS.ProcessEnv = { PATH: '/given/bin', GIT_DIR: '/nonexistent', GIT_WORK_TREE: '/nonexistent' };

      const call = leaf.trackedAreaCall(root, 'memory', given) as GitCall;

      expect(call.env.PATH).toBe('/given/bin');
      expect(call.env).not.toHaveProperty('FROM_PROCESS');
      expect(call.env).not.toHaveProperty('GIT_DIR');
      expect(call.env).not.toHaveProperty('GIT_WORK_TREE');
      expect(given).toEqual({ PATH: '/given/bin', GIT_DIR: '/nonexistent', GIT_WORK_TREE: '/nonexistent' });
    });

    it('makes no call itself: it only describes one', () => {
      fs.mkdirSync(path.join(root, '.git'));
      const spies = NO_CALL.map(name => vi.spyOn(nodeChildProcess, name as 'spawnSync'));

      leaf.trackedAreaCall(root, 'curation');
      leaf.trackedAreaCall(root, 'memory');

      for (const spy of spies) expect(spy.mock.calls).toEqual([]);
    });

    it('answers a new object each time, so a caller can not change the next answer', () => {
      fs.mkdirSync(path.join(root, '.git'));
      const first = leaf.trackedAreaCall(root, 'memory') as GitCall;
      first.argv.push('--extra');
      first.env.INJECTED = '1';

      const second = leaf.trackedAreaCall(root, 'memory') as GitCall;

      expect(second.argv).not.toContain('--extra');
      expect(second.env).not.toHaveProperty('INJECTED');
      expect(Object.isFrozen(leaf.AREA_PATHSPECS.memory)).toBe(true);
    });

    it.each(AREAS)('runs to the same answer as inspectTrackedArea when a runner executes the call and judges the result (%s)', (area) => {
      commitRepo({ [`${FOLDERS[area][0]}/note.txt`]: 'x\n' });
      for (const other of AREAS) {
        const call = leaf.trackedAreaCall(root, other) as GitCall;
        const result = nodeChildProcess.spawnSync('git', call.argv, { cwd: call.cwd, env: call.env, stdio: ['ignore', 'pipe', 'ignore'] });

        expect(leaf.judgeTrackedAreas(result), other).toEqual(leaf.inspectTrackedArea(root, other));
      }
    });
  });
});
