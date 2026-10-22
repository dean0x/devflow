// tests/decisions/tracked-area-parity.test.ts
//
// One question, four runners: does git track files in the data folders of an area at a
// root? The leaf (hooks/lib/tracked-areas.cjs), its TypeScript runner (probeTrackedArea),
// the shell twin in the capture gate file (queue_tracked_area, in git mode and in node
// mode) must give the same answer on every fixture, and the shell twin must make the call
// the leaf describes: the same pathspecs in the same order, the same arguments, the same
// scrubbed environment. Every fixture states the answer it expects, so a runner that
// agrees with the others by being wrong shows.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { git, initGitRepo, PROJECT_PATHS, trackInGit } from './curation-fixtures.js';
import { probeTrackedArea } from '../../src/core/tracked-areas.js';
import { partitionProjectData } from '../../src/cli/commands/uninstall.js';
import { useWarmFakeExecutables } from '../helpers/warm-fake-executable.js';

type Answer = 'tracked' | 'untracked' | 'unknown';
type Area = 'curation' | 'memory' | 'both';
type Env = Record<string, string>;

interface Leaf {
  AREA_PATHSPECS: Readonly<Record<Area, readonly string[]>>;
  GIT_REDIRECT_VARIABLES: readonly string[];
  inspectTrackedArea(root: unknown, area: unknown): { answer: Answer; cause: string | null };
  trackedAreaCall(root: unknown, area: unknown): { answer: Answer } | { cwd: string; argv: string[]; env: NodeJS.ProcessEnv };
}

const HOOKS_DIR = path.resolve(import.meta.dirname, '../../src/assets/scripts/hooks');
const QUEUE_APPEND = path.join(HOOKS_DIR, 'queue-append');
const JSON_HELPER = path.join(HOOKS_DIR, 'json-helper.cjs');
const LEAF_PATH = path.join(HOOKS_DIR, 'lib', 'tracked-areas.cjs');
const nodeRequire = createRequire(import.meta.url);
const leaf = nodeRequire(LEAF_PATH) as Leaf;
const { LEGACY_NAMES, CURATION_DIR_NAME, getMemoryDir } = nodeRequire(PROJECT_PATHS) as {
  LEGACY_NAMES: { folder: string; backupPrefix: string };
  CURATION_DIR_NAME: string;
  getMemoryDir(projectRoot: string): string;
};

const AREAS: readonly Area[] = ['curation', 'memory', 'both'];
const LIGATURE = '\u{FB02}';
const BACKUP_SUFFIX = '20261001T000001Z-00000001';
const BACKUP = `${LEGACY_NAMES.backupPrefix}${BACKUP_SUFFIX}`;
const SHELL = '/bin/bash';

/** The answers a fixture expects, per area. */
type Expected = Readonly<Record<Area, Answer>>;
const answers = (curation: Answer, memory: Answer): Expected => ({
  curation,
  memory,
  both: curation === 'tracked' || memory === 'tracked' ? 'tracked' : curation === 'unknown' || memory === 'unknown' ? 'unknown' : 'untracked',
});
const ALL_TRACKED = answers('tracked', 'tracked');
const ALL_UNTRACKED = answers('untracked', 'untracked');
const ALL_UNKNOWN = answers('unknown', 'unknown');
const CURATION_ONLY = answers('tracked', 'untracked');
const MEMORY_ONLY = answers('untracked', 'tracked');

interface Fixture {
  readonly name: string;
  readonly expected: Expected;
  /** Build the project; `root` is the project directory, `tmp` the scratch folder around it. */
  setup(root: string, tmp: string): void;
  /** The root to ask about, when it is not the project directory itself. */
  rootOf?(root: string, tmp: string): string;
  /** The environment the runners run under, on top of the process environment. */
  env?(tmp: string): Env;
}

describe('the shell twin, the leaf and the TypeScript runner agree', { timeout: 120_000 }, () => {
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-parity-')));
    root = path.join(tmp, 'project');
    fs.mkdirSync(root);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // --- fixtures ---

  const write = (rel: string, content = 'content of the repository\n'): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const commitFiles = (files: readonly string[]): void => {
    initGitRepo(root);
    for (const rel of files) write(rel);
    trackInGit(root, files);
    git(root, ['commit', '-q', '-m', 'files']);
  };
  const trackGitlink = (rel: string): void => {
    const sha = git(root, ['rev-parse', 'HEAD']);
    git(root, ['update-index', '--add', '--cacheinfo', `160000,${sha},${rel}`]);
  };
  /** Many tracked entries below `folder`: the listing is longer than the leaf's output cap. */
  const trackMany = (folder: string): void => {
    initGitRepo(root);
    const blob = git(root, ['hash-object', '-w', '--stdin']);
    const lines = Array.from({ length: 400 }, (_, i) => `100644 ${blob}\t${folder}/entry-with-a-long-name-${String(i).padStart(4, '0')}.txt`);
    execIndexInfo(lines);
  };
  const execIndexInfo = (lines: readonly string[]): void => {
    const run = spawnSync('git', ['update-index', '--add', '--index-info'], { cwd: root, input: lines.join('\n') + '\n', encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
  };
  const noGitBin = (): string => {
    const bin = path.join(tmp, 'node-only-bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    return bin;
  };
  const failingGitBin = (): string => {
    const bin = noGitBin();
    const failing = ['/usr/bin/false', '/bin/false'].find(candidate => fs.existsSync(candidate)) as string;
    fs.symlinkSync(failing, path.join(bin, 'git'));
    return bin;
  };

  const FIXTURES: readonly Fixture[] = [
    { name: 'no .git entry, folders on disk', expected: ALL_UNTRACKED, setup: () => { write(`.devflow/${CURATION_DIR_NAME}/a.txt`); write('.devflow/memory/a.txt'); } },
    { name: 'a repository that tracks nothing in the folders, which stand on disk', expected: ALL_UNTRACKED, setup: () => { initGitRepo(root, { 'README.md': 'x\n', '.devflow/project.json': '{}\n' }); write(`.devflow/${CURATION_DIR_NAME}/a.txt`); write('.devflow/memory/a.txt'); } },
    { name: 'a committed file below the curation folder', expected: CURATION_ONLY, setup: () => commitFiles([`.devflow/${CURATION_DIR_NAME}/note.txt`]) },
    { name: 'a committed file below the old ledger folder', expected: CURATION_ONLY, setup: () => commitFiles([`.devflow/${LEGACY_NAMES.folder}/note.txt`]) },
    { name: 'a committed file below a backup folder', expected: CURATION_ONLY, setup: () => commitFiles([`.devflow/${BACKUP}/note.txt`]) },
    { name: 'a committed file below the memory folder', expected: MEMORY_ONLY, setup: () => commitFiles(['.devflow/memory/note.txt']) },
    { name: 'a file staged and not committed (memory)', expected: MEMORY_ONLY, setup: () => { initGitRepo(root, { 'README.md': 'x\n' }); write('.devflow/memory/note.txt'); trackInGit(root, ['.devflow/memory/note.txt']); } },
    { name: 'a committed file deleted from the work tree (curation)', expected: CURATION_ONLY, setup: () => { commitFiles([`.devflow/${CURATION_DIR_NAME}/note.txt`]); fs.rmSync(path.join(root, '.devflow'), { recursive: true, force: true }); } },
    { name: 'a skip-worktree file (memory)', expected: MEMORY_ONLY, setup: () => { commitFiles(['.devflow/memory/note.txt']); git(root, ['update-index', '--skip-worktree', '--', '.devflow/memory/note.txt']); } },
    { name: 'a gitlink at the curation folder', expected: CURATION_ONLY, setup: () => { initGitRepo(root, { 'README.md': 'x\n' }); trackGitlink(`.devflow/${CURATION_DIR_NAME}`); } },
    { name: 'a gitlink at the memory folder', expected: MEMORY_ONLY, setup: () => { initGitRepo(root, { 'README.md': 'x\n' }); trackGitlink('.devflow/memory'); } },
    { name: 'a tracked link at the memory folder', expected: MEMORY_ONLY, setup: () => { initGitRepo(root, { 'README.md': 'x\n' }); fs.mkdirSync(path.join(root, '.devflow')); fs.symlinkSync('shared', path.join(root, '.devflow', 'memory')); git(root, ['add', '-f', '--', '.devflow/memory']); } },
    { name: 'the .devflow entry as a tracked link', expected: ALL_TRACKED, setup: () => { initGitRepo(root, { 'README.md': 'x\n' }); fs.symlinkSync('shared', path.join(root, '.devflow')); git(root, ['add', '-f', '--', '.devflow']); } },
    { name: 'the .devflow entry as a tracked plain file', expected: ALL_TRACKED, setup: () => commitFiles(['.devflow']) },
    { name: 'the .DEVFLOW entry as a tracked plain file', expected: ALL_TRACKED, setup: () => commitFiles(['.DEVFLOW']) },
    { name: 'the .dev(fl ligature)ow entry as a tracked plain file', expected: ALL_TRACKED, setup: () => commitFiles([`.dev${LIGATURE}ow`]) },
    { name: 'an upper-case spelling of a curation file', expected: CURATION_ONLY, setup: () => commitFiles([`.DEVFLOW/${CURATION_DIR_NAME.toUpperCase()}/NOTE.TXT`]) },
    { name: 'the ligature spelling of a memory file', expected: MEMORY_ONLY, setup: () => commitFiles([`.dev${LIGATURE}ow/memory/note.txt`]) },
    { name: 'an empty .git entry', expected: ALL_UNKNOWN, setup: () => { fs.mkdirSync(path.join(root, '.git')); } },
    { name: 'git is not on the PATH', expected: ALL_UNKNOWN, setup: () => commitFiles(['.devflow/memory/note.txt']), env: () => ({ PATH: noGitBin() }) },
    { name: 'git exits non-zero', expected: ALL_UNKNOWN, setup: () => commitFiles(['.devflow/memory/note.txt']), env: () => ({ PATH: failingGitBin() }) },
    {
      name: 'git variables that redirect git, set to nothing real, over a tracked memory folder',
      expected: MEMORY_ONLY,
      setup: () => commitFiles(['.devflow/memory/note.txt']),
      env: () => Object.fromEntries(leaf.GIT_REDIRECT_VARIABLES.map(name => [name, name === 'GIT_ICASE_PATHSPECS' ? '0' : '/nonexistent/redirect'])),
    },
    {
      name: 'an index named in the environment that tracks the memory folder, over a project that tracks nothing',
      expected: ALL_UNTRACKED,
      setup: (_root, scratch) => {
        initGitRepo(root, { 'README.md': 'x\n' });
        const other = path.join(scratch, 'other');
        fs.mkdirSync(other);
        initGitRepo(other);
        fs.mkdirSync(path.join(other, '.devflow', 'memory'), { recursive: true });
        fs.writeFileSync(path.join(other, '.devflow', 'memory', 'a.txt'), 'x\n');
        git(other, ['add', '-f', '.devflow/memory/a.txt']);
      },
      env: scratch => ({ GIT_INDEX_FILE: path.join(scratch, 'other', '.git', 'index') }),
    },
    {
      name: 'literal pathspecs forced in the environment, over a tracked memory folder in the upper-case spelling',
      expected: MEMORY_ONLY,
      setup: () => commitFiles(['.DEVFLOW/MEMORY/note.txt']),
      env: () => ({ GIT_LITERAL_PATHSPECS: '1' }),
    },
    { name: 'a listing longer than the output cap, in the memory folder', expected: MEMORY_ONLY, setup: () => trackMany('.devflow/memory') },
    { name: 'a listing longer than the output cap, in the curation folder', expected: CURATION_ONLY, setup: () => trackMany(`.devflow/${CURATION_DIR_NAME}`) },
    { name: 'a root that is not an absolute path', expected: ALL_UNKNOWN, setup: () => commitFiles(['.devflow/memory/note.txt']), rootOf: () => 'project' },
    {
      name: 'a folder above the root whose name holds a colon',
      expected: ALL_UNKNOWN,
      setup: (_root, scratch) => {
        const colon = path.join(scratch, 'a:b');
        fs.mkdirSync(colon);
        fs.renameSync(root, path.join(colon, 'project'));
        root = path.join(colon, 'project');
        commitFiles(['.devflow/memory/note.txt']);
      },
    },
    {
      name: 'a root reached through a link, over a tracked memory folder',
      expected: MEMORY_ONLY,
      setup: (_root, scratch) => {
        commitFiles(['.devflow/memory/note.txt']);
        fs.symlinkSync(root, path.join(scratch, 'link'));
      },
      rootOf: (_root, scratch) => path.join(scratch, 'link'),
    },
    {
      name: 'an empty .git entry at a root inside another repository',
      expected: ALL_UNKNOWN,
      setup: (_root, scratch) => {
        const outer = path.join(scratch, 'outer');
        fs.mkdirSync(outer);
        initGitRepo(outer, { 'README.md': 'x\n' });
        fs.mkdirSync(path.join(outer, 'inner', '.git'), { recursive: true });
        root = path.join(outer, 'inner');
      },
    },
    {
      name: 'a linked worktree whose checkout holds a tracked memory folder',
      expected: MEMORY_ONLY,
      setup: (_root, scratch) => {
        initGitRepo(root, { 'README.md': 'x\n' });
        write('.devflow/memory/note.txt');
        git(root, ['add', '-f', '--', '.devflow/memory/note.txt']);
        git(root, ['commit', '-q', '-m', 'memory']);
        git(root, ['worktree', 'add', '-q', '--detach', path.join(scratch, 'linked')]);
      },
      rootOf: (_root, scratch) => path.join(scratch, 'linked'),
    },
  ];

  // --- runners ---

  /** Run `fn` with `overrides` set in this process's environment, then put the environment back. */
  function withEnv<T>(overrides: Env, fn: () => T): T {
    const saved = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(overrides)) {
      saved.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      return fn();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  /**
   * The shell twin's answers for every area, from one bash 3.2 process with errexit set. The
   * process forgets its per-root answers between areas, so each area asks git again.
   */
  function shellAnswers(target: string, mode: 'git' | 'node', env: Env): Record<Area, Answer> {
    const script = [
      'set -e',
      'log() { :; }',
      'dbg() { :; }',
      '_HAS_NODE=true',
      `_JSON_HELPER="${JSON_HELPER}"`,
      `source "${QUEUE_APPEND}"`,
      'for area in curation memory both; do',
      '  _QTA_ASKED_CURATION=""; _QTA_ASKED_MEMORY=""; DF_TRACKED_AREA_CURATION=""; DF_TRACKED_AREA_MEMORY=""',
      '  queue_tracked_area "$1" "$area" "$2"',
      '  printf "%s %s %s\\n" "$area" "$DF_TRACKED_AREA_CURATION" "$DF_TRACKED_AREA_MEMORY"',
      'done',
      'echo END',
    ].join('\n');
    const run = spawnSync(SHELL, ['-c', script, '_', target, mode], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000 });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const lines = run.stdout.trim().split('\n');
    expect(lines.pop(), 'the caller was not ended before the last area').toBe('END');
    const byArea = new Map(lines.map(line => line.split(' ') as [Area, string, string]).map(([area, cur, mem]) => [area, { cur, mem }]));
    // The union asks one call; a listing in it is followed by one call per area, so the
    // two variables then name their own area. Otherwise both hold the union's answer.
    const asAnswer = (word: string | undefined): Answer => (word === 'tracked' || word === 'untracked' || word === 'unknown' ? word : 'unknown');
    const both = byArea.get('both');
    const union: Answer = both === undefined ? 'unknown'
      : both.cur === 'tracked' || both.mem === 'tracked' ? 'tracked'
        : both.cur === 'unknown' || both.mem === 'unknown' ? 'unknown' : 'untracked';
    return {
      curation: asAnswer(byArea.get('curation')?.cur),
      memory: asAnswer(byArea.get('memory')?.mem),
      both: union,
    };
  }

  describe.each(FIXTURES.map(fixture => [fixture.name, fixture] as const))('%s', (_name, fixture) => {
    it('gives the expected answer through the leaf, the TypeScript runner, the shell twin and its node mode', async () => {
      fixture.setup(root, tmp);
      const target = fixture.rootOf ? fixture.rootOf(root, tmp) : root;
      const env = fixture.env ? fixture.env(tmp) : {};

      const fromLeaf = Object.fromEntries(AREAS.map(area => [area, withEnv(env, () => leaf.inspectTrackedArea(target, area).answer)])) as Record<Area, Answer>;
      const fromRunner = {} as Record<Area, Answer>;
      for (const area of AREAS) fromRunner[area] = (await withEnvAsync(env, () => probeTrackedArea(target, area))).answer;
      const fromShell = shellAnswers(target, 'git', env);
      const fromNode = shellAnswers(target, 'node', env);

      expect(fromLeaf, 'the leaf').toEqual(fixture.expected);
      expect(fromRunner, 'the TypeScript runner').toEqual(fixture.expected);
      expect(fromShell, 'the shell twin').toEqual(fixture.expected);
      expect(fromNode, 'the shell twin in node mode').toEqual(fixture.expected);
    });
  });

  /** withEnv for an async probe: the environment is read when the probe starts, so it is set until the probe settles. */
  async function withEnvAsync<T>(overrides: Env, fn: () => Promise<T>): Promise<T> {
    const saved = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(overrides)) {
      saved.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      return await fn();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
});

describe('the shell twin makes the call the leaf describes', () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let tmp: string;
  let root: string;
  let shimBin: string;
  let argvLog: string;
  let envLog: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-call-')));
    root = path.join(tmp, 'project');
    fs.mkdirSync(root);
    initGitRepo(root, { 'README.md': 'x\n' });
    shimBin = path.join(tmp, 'shim');
    fs.mkdirSync(shimBin);
    argvLog = path.join(tmp, 'argv.log');
    envLog = path.join(tmp, 'env.log');
    const real = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFakeExecutable(
      path.join(shimBin, 'git'),
      `#!/bin/bash\nif [ "$1" = "--no-literal-pathspecs" ]; then\n  printf '%s\\0' "$@" > "${argvLog}"\n  { pwd -P; env; } > "${envLog}"\nfi\nexec "${real}" "$@"\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function shellCall(area: Area): void {
    const script = `set -e\nlog() { :; }\ndbg() { :; }\nsource "${QUEUE_APPEND}"\nqueue_tracked_area "$1" "$2" git\n`;
    const redirected = Object.fromEntries(leaf.GIT_REDIRECT_VARIABLES.map(name => [name, '/nonexistent/redirect']));
    const run = spawnSync(SHELL, ['-c', script, '_', root, area], {
      env: { ...process.env, ...redirected, PATH: `${shimBin}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'en_US.UTF-8', GIT_OPTIONAL_LOCKS: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
  }

  it.each(AREAS)('runs git with the leaf argv for the %s area, in the root, with the leaf environment', (area) => {
    const call = leaf.trackedAreaCall(root, area) as { cwd: string; argv: string[]; env: NodeJS.ProcessEnv };

    shellCall(area);

    const argv = fs.readFileSync(argvLog, 'utf8').split('\0').slice(0, -1);
    expect(argv).toEqual(call.argv);
    const [cwd, ...envLines] = fs.readFileSync(envLog, 'utf8').split('\n');
    expect(cwd).toBe(fs.realpathSync(call.cwd));
    const env = new Map(envLines.filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    for (const name of leaf.GIT_REDIRECT_VARIABLES) expect(env.has(name), `${name} is removed`).toBe(false);
    expect(env.get('LC_ALL')).toBe(call.env.LC_ALL);
    expect(env.get('GIT_OPTIONAL_LOCKS')).toBe(call.env.GIT_OPTIONAL_LOCKS);
    expect(env.get('GIT_CEILING_DIRECTORIES')).toBe(call.env.GIT_CEILING_DIRECTORIES);
  });

  it('holds its pathspecs equal to the leaf pathspecs of each area, element by element', () => {
    for (const area of AREAS) {
      const run = spawnSync(SHELL, ['-c', `source "${QUEUE_APPEND}"\n_qta_specs "$1"\nprintf '%s\\0' "\${_QTA_SPECS[@]}"`, '_', area], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.split('\0').slice(0, -1), area).toEqual([...leaf.AREA_PATHSPECS[area]]);
    }
  });

  it('refuses an area it does not know, and names no pathspec for it', () => {
    const run = spawnSync(SHELL, ['-c', `source "${QUEUE_APPEND}"\nif _qta_specs nonsense; then echo yes; else echo no; fi\necho "n=\${#_QTA_SPECS[@]}"`], { encoding: 'utf8' });
    expect(run.stdout.trim().split('\n')).toEqual(['no', 'n=0']);
  });

  it('removes exactly the variables the leaf removes: its unset list equals GIT_REDIRECT_VARIABLES', () => {
    const source = fs.readFileSync(QUEUE_APPEND, 'utf8');
    const lists = [...source.matchAll(/^\s+unset (GIT_[A-Z_]+(?: GIT_[A-Z_]+)*)$/gm)].map(match => match[1].split(' '));
    expect(lists).toEqual([[...leaf.GIT_REDIRECT_VARIABLES]]);
  });

  it('reads only the first byte of the listing and takes its status from PIPESTATUS in both arms', () => {
    const source = fs.readFileSync(QUEUE_APPEND, 'utf8');
    expect(source).toContain('| { IFS= read -r -n 1 _qp_c; }; then\n    _qp_st=("${PIPESTATUS[@]}")\n  else\n    _qp_st=("${PIPESTATUS[@]}")\n  fi');
    expect(source).not.toMatch(/\|\| true[^\n]*\n[^\n]*PIPESTATUS/);
  });
});

describe('the folder-to-area maps name the folders the leaf names', () => {
  type DataArea = 'curation' | 'memory';
  const DATA_AREAS: readonly DataArea[] = ['curation', 'memory'];
  const MEMORY_FOLDER = path.basename(getMemoryDir(path.sep));
  const REPO = '/repo';

  /**
   * The folder names the leaf's pathspecs of an area cover under the plain `.devflow`
   * spelling. A glob that ends in `*` is the backup folders: it stands for one backup name.
   */
  function leafFolders(area: DataArea): string[] {
    const names = leaf.AREA_PATHSPECS[area].flatMap(spec => {
      const match = /^:\(icase,(?:literal|glob)\)\.devflow\/(.+?)(?:\/\*\*)?$/.exec(spec);
      if (match === null) return [];
      return [match[1].endsWith('*') ? `${match[1].slice(0, -1)}${BACKUP_SUFFIX}` : match[1]];
    });
    return [...new Set(names)];
  }

  const FOLDERS: ReadonlyArray<readonly [DataArea, string]> = DATA_AREAS.flatMap(area => leafFolders(area).map(name => [area, name] as const));

  it('reads the leaf pathspecs as the curation folder, the old ledger folder, a backup folder and the memory folder', () => {
    expect(leafFolders('curation').sort()).toEqual([CURATION_DIR_NAME, LEGACY_NAMES.folder, BACKUP].sort());
    expect(leafFolders('memory')).toEqual([MEMORY_FOLDER]);
  });

  describe('the shell twin (_qar_area_of)', () => {
    const shellAreaOf = (queue: string): string => {
      const run = spawnSync(SHELL, ['-c', `source "${QUEUE_APPEND}"\n_qar_area_of "$1" "$2"\nprintf '%s' "$_QAR_AREA"`, '_', REPO, queue], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      return run.stdout;
    };

    it.each(FOLDERS.filter(([, name]) => name !== BACKUP))('puts a queue in %s/%s in the same area as the leaf', (area, name) => {
      expect(shellAreaOf(`${REPO}/.devflow/${name}/.pending-turns.jsonl`)).toBe(area);
    });

    it('puts a queue in a backup folder in neither area, so it reads as both: paused when either area is', () => {
      expect(shellAreaOf(`${REPO}/.devflow/${BACKUP}/.pending-turns.jsonl`)).toBe('both');
    });

    it.each([`${REPO}/elsewhere/.pending-turns.jsonl`, `${REPO}/.devflow/features/.pending-turns.jsonl`])('puts a queue at %s in both areas', (queue) => {
      expect(shellAreaOf(queue)).toBe('both');
    });
  });

  describe('the uninstall cleanup (projectDataAreaOf, through partitionProjectData)', () => {
    const entryOf = (name: string): { name: string; isDir: boolean } => ({ name, isDir: true });
    const OTHER: Readonly<Record<DataArea, DataArea>> = { curation: 'memory', memory: 'curation' };

    it.each(FOLDERS)('keeps %s/%s when its own area is paused and removes it when only the other area is', (area, name) => {
      for (const spelling of [name, name.toUpperCase()]) {
        const own = partitionProjectData([entryOf(spelling)], new Set([area]));
        expect(own.keepPaused, spelling).toEqual([entryOf(spelling)]);
        expect(own.remove, spelling).toEqual([]);

        const other = partitionProjectData([entryOf(spelling)], new Set([OTHER[area]]));
        expect(other.keepPaused, spelling).toEqual([]);
        expect(other.remove, spelling).toEqual([entryOf(spelling)]);
      }
    });

    it('removes a folder that belongs to no area even when both areas are paused', () => {
      const result = partitionProjectData([entryOf('scratch')], new Set<DataArea>(DATA_AREAS));
      expect(result.keepPaused).toEqual([]);
      expect(result.remove).toEqual([entryOf('scratch')]);
    });
  });
});
