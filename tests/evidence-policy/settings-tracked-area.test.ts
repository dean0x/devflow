/**
 * tests/evidence-policy/settings-tracked-area.test.ts
 *
 * The settings line and the folders git tracks. `resolve-settings.cjs` prints
 * CURATION=off while git tracks (or does not answer for) the curation folders at the
 * ledger root, and MEMORY=off while git tracks (or does not answer for) the memory
 * folder at the checkout's toplevel. The area answers only narrow: a switch the machine
 * or the repository turned off stays off.
 *
 *   - the matrix of entry kinds and spellings, on real git;
 *   - machine switches and every other field unchanged;
 *   - linked worktrees: curation at the main checkout, memory at the checkout;
 *   - the ledger root against the hooks' df_resolve_roots, on real git and on a scripted
 *     git that echoes the unknown flag back (git before 2.31);
 *   - a failed repository lookup: a redirecting variable, a refusal for ownership, a
 *     directory with no `.git` entry (no call, no change);
 *   - an unreadable project settings file keeps the machine switches;
 *   - the personal config.json tracking check runs without redirecting variables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ARGV,
  SETTINGS_SCRIPT,
  realGit,
  runResolver,
  scopedEnv,
  scriptedExec,
  type ExecFn,
  type RecordedCall,
  type ScriptedCall,
} from './scripted-shim.js';

type SwitchSource = 'machine' | 'project' | 'personal';

interface Settings {
  readonly ok: boolean;
  readonly switches: Record<'memory' | 'curation' | 'knowledge', { readonly on: boolean; readonly source: SwitchSource }>;
  readonly unreadable: 'project' | 'personal' | null;
}

type LedgerRoot = { kind: 'root'; root: string } | { kind: 'unknown' };

interface SettingsModule {
  readonly SETTINGS_FAIL_CLOSED_LINE: string;
  resolveSettings(opts: { dir: string; manifest?: unknown }, deps?: { exec?: ExecFn }): Settings;
  formatSettingsLine(s: Settings): string;
  ledgerRootOf(toplevel: string, deps?: { exec?: ExecFn }): LedgerRoot;
}

interface Leaf {
  readonly AREA_PATHSPECS: Readonly<Record<'curation' | 'memory' | 'both', readonly string[]>>;
}

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const NODE_REQUIRE = createRequire(import.meta.url);
const SETTINGS = NODE_REQUIRE(SETTINGS_SCRIPT) as SettingsModule;
const LEAF = NODE_REQUIRE(path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'lib', 'tracked-areas.cjs')) as Leaf;
const PATHS = NODE_REQUIRE(path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'lib', 'project-paths.cjs')) as {
  readonly LEGACY_NAMES: { readonly folder: string; readonly backupPrefix: string };
};
const RESOLVE_HELPER = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'resolve-project-root');

const FL = '\u{FB02}';

const UNCHANGED =
  'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=none SITE=none KEY=none '
  + 'REVIEW_PUBLICATION=auto COMPLIANCE=off MEMORY=on CURATION=on KNOWLEDGE=on GATE_LEVEL=standard';

/** The line with only its two switches changed. */
const withSwitches = (memory: 'on' | 'off', curation: 'on' | 'off'): string =>
  UNCHANGED.replace('MEMORY=on CURATION=on', `MEMORY=${memory} CURATION=${curation}`);

/** The area call the leaf describes, written out: the argv a scripted git is asked to answer. */
const areaArgv = (area: 'curation' | 'memory' | 'both'): string[] =>
  ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...LEAF.AREA_PATHSPECS[area]];

const COMMON_DIR_ARGV = ['rev-parse', '--path-format=absolute', '--git-common-dir'];

let base: string;
let home: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-settings-area-')));
  home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

let seq = 0;
const freshDir = (name: string): string => {
  const dir = path.join(base, `${name}-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

interface RepoOptions {
  /** Commit the files (default), or leave them staged. */
  readonly commit?: boolean;
  /** Delete the files from the work tree after they are indexed. */
  readonly removeFromTree?: boolean;
}

function writeFiles(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** A git repository on `main` holding `files` (force-added, so ignore rules never hide a fixture). */
function makeRepo(files: Readonly<Record<string, string>>, opts: RepoOptions = {}): string {
  const dir = freshDir('repo');
  realGit(dir, home, ['init', '-q', '-b', 'main']);
  writeFiles(dir, { 'README.md': 'readme\n', ...files });
  realGit(dir, home, ['add', '-f', '--', '.']);
  if (opts.commit !== false) realGit(dir, home, ['commit', '-q', '-m', 'fixture']);
  if (opts.removeFromTree === true) {
    for (const rel of Object.keys(files)) fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
  }
  return dir;
}

function writeManifest(features: Record<string, unknown>): void {
  fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({ features }));
}

function clearManifest(): void {
  fs.rmSync(path.join(home, '.devflow', 'manifest.json'), { force: true });
}

beforeEach(() => {
  clearManifest();
});

interface Run {
  readonly line: string;
  readonly status: number | null;
  readonly stderr: string;
}

/** The real script over `dir` (real git, HOME = the fixture home, no inherited git variables). */
function resolve(dir: string, extraEnv: Readonly<Record<string, string>> = {}): Run {
  const r = runResolver({ home, args: [dir], cwd: dir, extraEnv, script: SETTINGS_SCRIPT });
  return { line: r.stdout.replace(/\n$/, ''), status: r.status, stderr: r.stderr };
}

// ---------------------------------------------------------------------------

describe('the settings line narrows by the tracked area (real git)', () => {
  const BACKUP = `${PATHS.LEGACY_NAMES.backupPrefix}20260101T000000Z-abc123`;

  const ROWS: ReadonlyArray<readonly [string, Record<string, string>, RepoOptions, 'on' | 'off', 'on' | 'off']> = [
    ['nothing tracked', {}, {}, 'on', 'on'],
    ['a tracked .devflow file that is no data folder (project.json)', { '.devflow/project.json': '{"version":1}\n' }, {}, 'on', 'on'],
    ['the curation folder tracked', { '.devflow/curation/decisions.md': 'x\n' }, {}, 'on', 'off'],
    ['the legacy learning folder tracked', { [`.devflow/${PATHS.LEGACY_NAMES.folder}/decisions.md`]: 'x\n' }, {}, 'on', 'off'],
    ['a backup folder tracked', { [`.devflow/${BACKUP}/queue.jsonl`]: 'x\n' }, {}, 'on', 'off'],
    ['the memory folder tracked', { '.devflow/memory/WORKING-MEMORY.md': 'x\n' }, {}, 'off', 'on'],
    ['both folders tracked', { '.devflow/memory/a': 'x\n', '.devflow/curation/b': 'x\n' }, {}, 'off', 'off'],
    ['an upper-case spelling of the curation folder', { '.DEVFLOW/CURATION/x': 'x\n' }, {}, 'on', 'off'],
    ['the fl-ligature spelling of the memory folder', { [`.dev${FL}ow/memory/a`]: 'x\n' }, {}, 'off', 'on'],
    ['a tracked file named .devflow', { '.devflow': 'file\n' }, {}, 'off', 'off'],
    ['a curation entry that is only staged', { '.devflow/curation/decisions.md': 'x\n' }, { commit: false }, 'on', 'off'],
    ['a memory entry deleted from the work tree', { '.devflow/memory/a': 'x\n' }, { removeFromTree: true }, 'off', 'on'],
  ];

  it.each(ROWS)('%s', (_name, files, opts, memory, curation) => {
    const run = resolve(makeRepo(files, opts));
    expect(run.status).toBe(0);
    expect(run.line).toBe(withSwitches(memory, curation));
  });

  it('a tracked .devflow symlink turns both off', () => {
    const dir = freshDir('repo');
    realGit(dir, home, ['init', '-q', '-b', 'main']);
    writeFiles(dir, { 'vendor/df/keep': 'x\n' });
    fs.symlinkSync(path.join('vendor', 'df'), path.join(dir, '.devflow'));
    realGit(dir, home, ['add', '-f', '--', '.']);
    expect(resolve(dir).line).toBe(withSwitches('off', 'off'));
  });

  it('every other field is unchanged when an area is tracked', () => {
    const tracked = resolve(makeRepo({ '.devflow/curation/decisions.md': 'x\n', '.devflow/memory/a': 'x\n' })).line;
    expect(tracked.replace('MEMORY=off CURATION=off', 'MEMORY=on CURATION=on')).toBe(UNCHANGED);
  });

  it('a redirecting variable does not change the answer (the call runs without it)', () => {
    const dir = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    expect(resolve(dir, { GIT_INDEX_FILE: path.join(base, 'no-such-index') }).line).toBe(withSwitches('on', 'off'));
  });

  it('a switch the machine turned off stays off whatever the areas say', () => {
    writeManifest({ curation: false });
    expect(resolve(makeRepo({})).line).toBe(withSwitches('on', 'off'));
    writeManifest({ memory: false });
    expect(resolve(makeRepo({})).line).toBe(withSwitches('off', 'on'));
    writeManifest({ memory: false, curation: false });
    expect(resolve(makeRepo({ '.devflow/curation/a': 'x\n' })).line).toBe(withSwitches('off', 'off'));
  });

  it('a switch the repository turned off stays off', () => {
    const dir = makeRepo({});
    writeFiles(dir, { '.devflow/project.json': '{"version":1,"features":{"memory":false}}\n' });
    expect(resolve(dir).line).toBe(withSwitches('off', 'on'));
  });
});

// ---------------------------------------------------------------------------

describe('which git calls the settings resolution makes for the areas (scripted)', () => {
  /** A repository directory the scripted git names as toplevel, with a `.git` folder. */
  function scriptedRepo(): string {
    const dir = fs.realpathSync(freshDir('scripted'));
    fs.mkdirSync(path.join(dir, '.git'));
    return dir;
  }
  const TOP = (dir: string): ScriptedCall => ({ tool: 'git', args: ARGV.toplevel, stdout: `${dir}\n` });
  const AREA = (area: 'curation' | 'memory' | 'both', listing = ''): ScriptedCall =>
    ({ tool: 'git', args: areaArgv(area), stdout: listing });
  const areaCalls = (recorded: readonly RecordedCall[]): string[] =>
    recorded.filter(c => c.args.includes('ls-files') && c.args.some(a => a.includes('devflow'))).map(c => c.args.join(' '));

  function resolveWith(dir: string, calls: readonly ScriptedCall[], manifest: unknown = { features: {} }) {
    const { exec, recorded } = scriptedExec(calls);
    const settings = SETTINGS.resolveSettings({ dir, manifest }, { exec });
    return { settings, line: SETTINGS.formatSettingsLine(settings), recorded };
  }

  it('equal roots and nothing listed: one union call, and no per-area call', () => {
    const dir = scriptedRepo();
    const { line, recorded } = resolveWith(dir, [TOP(dir), AREA('both')]);
    expect(line).toBe(UNCHANGED);
    expect(areaCalls(recorded)).toEqual([areaArgv('both').join(' ')]);
  });

  it('equal roots and a listing: one call per area tells them apart', () => {
    const dir = scriptedRepo();
    const { line, recorded } = resolveWith(dir, [TOP(dir), AREA('both', '.devflow/memory/a\0'), AREA('curation'), AREA('memory', '.devflow/memory/a\0')]);
    expect(line).toBe(withSwitches('off', 'on'));
    expect(areaCalls(recorded)).toEqual([areaArgv('both'), areaArgv('curation'), areaArgv('memory')].map(a => a.join(' ')));
  });

  it('a union call that git does not answer reads both areas as unknown, with no further call', () => {
    const dir = scriptedRepo();
    const { line, recorded } = resolveWith(dir, [TOP(dir)]);
    expect(line).toBe(withSwitches('off', 'off'));
    expect(areaCalls(recorded)).toEqual([areaArgv('both').join(' ')]);
  });

  it('an area switch already off is not asked about', () => {
    const dir = scriptedRepo();
    const only = resolveWith(dir, [TOP(dir), AREA('memory')], { features: { curation: false } });
    expect(only.line).toBe(withSwitches('on', 'off'));
    expect(areaCalls(only.recorded)).toEqual([areaArgv('memory').join(' ')]);
    const none = resolveWith(dir, [TOP(dir)], { features: { curation: false, memory: false } });
    expect(none.line).toBe(withSwitches('off', 'off'));
    expect(areaCalls(none.recorded)).toEqual([]);
  });

  it('a root with no .git entry gets no area call and no change', () => {
    const dir = fs.realpathSync(freshDir('plain'));
    const { line, recorded } = resolveWith(dir, [TOP(dir)]);
    expect(line).toBe(UNCHANGED);
    expect(areaCalls(recorded)).toEqual([]);
  });

  it('the area call runs in the root, without redirecting variables and with a ceiling', () => {
    const dir = scriptedRepo();
    vi.stubEnv('GIT_DIR', '/nonexistent');
    vi.stubEnv('GIT_WORK_TREE', '/nonexistent');
    const { recorded } = resolveWith(dir, [TOP(dir), AREA('both')]);
    const call = recorded.find(c => c.args.includes('ls-files') && c.args.some(a => a.includes('devflow')));
    expect(call?.opts.cwd).toBe(dir);
    const env = call?.opts.env as NodeJS.ProcessEnv;
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_CEILING_DIRECTORIES).toBe(path.dirname(dir));
  });
});

// ---------------------------------------------------------------------------

describe('the repository lookup fails (the none branch)', () => {
  const NOT_A_REPO: ScriptedCall = { tool: 'git', args: ARGV.toplevel, exit: 128, stderr: 'fatal: not a git repository\n' };
  const AREA = (area: 'curation' | 'memory' | 'both', listing = ''): ScriptedCall =>
    ({ tool: 'git', args: areaArgv(area), stdout: listing });

  it('GIT_DIR naming a missing directory: a tracked curation folder still reads CURATION=off', () => {
    const dir = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    const run = resolve(dir, { GIT_DIR: '/nonexistent' });
    expect(run.status).toBe(0);
    expect(run.line).toBe(withSwitches('on', 'off'));
  });

  it('GIT_DIR naming a missing directory, nothing tracked: no change', () => {
    expect(resolve(makeRepo({}), { GIT_DIR: '/nonexistent' }).line).toBe(UNCHANGED);
  });

  it('a refusal for ownership reads as unknown: both off, also when nothing is tracked', () => {
    const tracked = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    expect(resolve(tracked, { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }).line).toBe(withSwitches('off', 'off'));
    const clean = makeRepo({});
    expect(resolve(clean, { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }).line).toBe(withSwitches('off', 'off'));
  });

  it('a directory with no .git entry: no area call, no change', () => {
    const dir = fs.realpathSync(freshDir('no-entry'));
    const { exec, recorded } = scriptedExec([NOT_A_REPO]);
    const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
    expect(SETTINGS.formatSettingsLine(settings)).toBe(UNCHANGED);
    expect(recorded.map(c => c.args[0])).toEqual(['rev-parse']);
    expect(resolve(dir, { GIT_DIR: '/nonexistent' }).line).toBe(UNCHANGED);
    expect(resolve(dir).line).toBe(UNCHANGED);
  });

  it('a .git entry and a git that does not answer: unknown, both off', () => {
    const dir = fs.realpathSync(freshDir('entry'));
    fs.mkdirSync(path.join(dir, '.git'));
    const { exec } = scriptedExec([NOT_A_REPO]);
    const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
    expect(SETTINGS.formatSettingsLine(settings)).toBe(withSwitches('off', 'off'));
  });

  it('a .git entry and an empty listing: no change', () => {
    const dir = fs.realpathSync(freshDir('entry'));
    fs.mkdirSync(path.join(dir, '.git'));
    const { exec } = scriptedExec([NOT_A_REPO, AREA('both')]);
    const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
    expect(SETTINGS.formatSettingsLine(settings)).toBe(UNCHANGED);
  });

  it('a .git entry and a listing: the per-area calls say which area is tracked', () => {
    const dir = fs.realpathSync(freshDir('entry'));
    fs.mkdirSync(path.join(dir, '.git'));
    const { exec } = scriptedExec([NOT_A_REPO, AREA('both', 'x\0'), AREA('curation', 'x\0'), AREA('memory')]);
    const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
    expect(SETTINGS.formatSettingsLine(settings)).toBe(withSwitches('on', 'off'));
  });

  it('a git that cannot be run at all for the toplevel fails closed: both off', () => {
    const dir = fs.realpathSync(freshDir('spawn'));
    const { exec } = scriptedExec([{ tool: 'git', args: ARGV.toplevel, spawnError: 'ENOENT' }]);
    const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
    expect(settings.ok).toBe(false);
    expect(settings.switches.memory.on).toBe(false);
    expect(settings.switches.curation.on).toBe(false);
    expect(SETTINGS.SETTINGS_FAIL_CLOSED_LINE).toContain('MEMORY=off CURATION=off');
  });
});

// ---------------------------------------------------------------------------

describe('an unreadable project or personal settings file keeps the machine switches', () => {
  const closedFields = (line: string): string => line.replace(/ MEMORY=\w+ CURATION=\w+/, ' MEMORY=* CURATION=*');
  const FAIL_CLOSED_FIELDS = closedFields(
    'TRACKER=github TRACKER_SOURCE=default TRACKER_WARN=invalid SITE=none KEY=none '
    + 'REVIEW_PUBLICATION=off COMPLIANCE=generic MEMORY=on CURATION=on KNOWLEDGE=off GATE_LEVEL=full',
  );

  it('unreadable project.json, machine on: the two switches stay on, the other fields close', () => {
    const dir = makeRepo({});
    writeFiles(dir, { '.devflow/project.json': '{ this is not json' });
    const run = resolve(dir);
    expect(run.status).toBe(0);
    expect(run.line).toMatch(/ MEMORY=on CURATION=on /);
    expect(closedFields(run.line)).toBe(FAIL_CLOSED_FIELDS);
  });

  it('unreadable project.json, a machine switch off: it stays off', () => {
    const dir = makeRepo({});
    writeFiles(dir, { '.devflow/project.json': '{ this is not json' });
    writeManifest({ curation: false });
    expect(resolve(dir).line).toMatch(/ MEMORY=on CURATION=off /);
    writeManifest({ memory: false });
    expect(resolve(dir).line).toMatch(/ MEMORY=off CURATION=on /);
  });

  it('unreadable project.json and a tracked curation folder: CURATION=off, MEMORY=on', () => {
    const dir = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    writeFiles(dir, { '.devflow/project.json': '{ this is not json' });
    expect(resolve(dir).line).toMatch(/ MEMORY=on CURATION=off /);
  });

  it('unreadable personal config.json and a tracked memory folder: MEMORY=off, CURATION=on', () => {
    const dir = makeRepo({ '.devflow/memory/a': 'x\n' });
    writeFiles(dir, { '.devflow/config.json': '{ this is not json' });
    const run = resolve(dir);
    expect(run.status).toBe(0);
    expect(run.line).toMatch(/ MEMORY=off CURATION=on /);
  });

  it('the unreadable resolution reports the file and keeps the area narrowing as machine-sourced', () => {
    const dir = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    writeFiles(dir, { '.devflow/project.json': '{ this is not json' });
    const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } });
    expect(settings.ok).toBe(false);
    expect(settings.unreadable).toBe('project');
    expect(settings.switches.curation).toEqual({ on: false, source: 'machine' });
    expect(settings.switches.memory).toEqual({ on: true, source: 'machine' });
    expect(settings.switches.knowledge.on).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the personal config.json tracking check runs without redirecting variables', () => {
  it('a config.json that git tracks is ignored whatever GIT_INDEX_FILE names', () => {
    const dir = makeRepo({ '.devflow/config.json': '{"features":{"memory":false}}\n' });
    const run = resolve(dir, { GIT_INDEX_FILE: path.join(base, 'no-such-index') });
    expect(run.line).toBe(UNCHANGED);
    expect(run.stderr).toContain('Git tracks an entry at or under .devflow/config.json');
  });

  it('an untracked config.json narrows as before', () => {
    const dir = makeRepo({});
    writeFiles(dir, { '.devflow/config.json': '{"features":{"memory":false}}\n' });
    expect(resolve(dir).line).toBe(withSwitches('off', 'on'));
  });
});

// ---------------------------------------------------------------------------

describe('linked worktrees: curation at the main checkout, memory at the checkout', () => {
  /** A main checkout on `main` and a linked worktree on `side`, branched before `mainFiles` land on main. */
  function worktrees(mainFiles: Record<string, string>, sideFiles: Record<string, string> = {}): { main: string; wt: string } {
    const main = makeRepo({});
    const wt = path.join(freshDir('wt-parent'), 'wt');
    realGit(main, home, ['worktree', 'add', '-q', wt, '-b', 'side']);
    if (Object.keys(sideFiles).length > 0) {
      writeFiles(wt, sideFiles);
      realGit(wt, home, ['add', '-f', '--', '.']);
      realGit(wt, home, ['commit', '-q', '-m', 'side']);
    }
    if (Object.keys(mainFiles).length > 0) {
      writeFiles(main, mainFiles);
      realGit(main, home, ['add', '-f', '--', '.']);
      realGit(main, home, ['commit', '-q', '-m', 'main']);
    }
    return { main, wt };
  }

  it('curation tracked in the main checkout (which holds .devflow) pauses curation in the worktree only', () => {
    const { wt } = worktrees({ '.devflow/curation/decisions.md': 'x\n' });
    expect(resolve(wt).line).toBe(withSwitches('on', 'off'));
  });

  it('memory tracked in the main checkout does not pause memory in the worktree', () => {
    const { wt } = worktrees({ '.devflow/memory/a': 'x\n' });
    expect(resolve(wt).line).toBe(UNCHANGED);
  });

  it('memory tracked in the worktree pauses memory there, not curation', () => {
    const { wt } = worktrees({}, { '.devflow/memory/a': 'x\n' });
    expect(resolve(wt).line).toBe(withSwitches('off', 'on'));
  });

  it('a main checkout without .devflow: curation is decided at the worktree', () => {
    const { wt } = worktrees({}, { '.devflow/curation/decisions.md': 'x\n' });
    expect(resolve(wt).line).toBe(withSwitches('on', 'off'));
  });

  it('a main checkout at HOME is not the ledger root: curation is decided at the worktree', () => {
    const { main, wt } = worktrees({ '.devflow/curation/decisions.md': 'x\n' });
    const run = runResolver({ home: main, args: [wt], cwd: wt, script: SETTINGS_SCRIPT });
    expect(run.stdout.replace(/\n$/, '')).toBe(UNCHANGED);
  });

  it('the main checkout and a subdirectory of it are decided at the main checkout', () => {
    const main = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    fs.mkdirSync(path.join(main, 'packages', 'app'), { recursive: true });
    expect(resolve(path.join(main, 'packages', 'app')).line).toBe(withSwitches('on', 'off'));
  });
});

// ---------------------------------------------------------------------------

describe('the ledger root equals df_resolve_roots', () => {
  /** The hooks' DF_LEDGER_ROOT for `cwd` under `homeDir`, straight from the shell helper. */
  function hookLedgerRoot(cwd: string, homeDir: string, env: Readonly<Record<string, string>> = {}): string {
    const r = spawnSync('bash', ['-c', 'source "$1"; df_resolve_roots "$2"; printf %s "$DF_LEDGER_ROOT"', '_', RESOLVE_HELPER, cwd], {
      cwd,
      encoding: 'utf-8',
      env: scopedEnv(homeDir, env),
    });
    return r.stdout;
  }

  /** The resolver's ledger root for the toplevel git names for `cwd`. */
  function resolverLedgerRoot(cwd: string, homeDir: string, exec?: ExecFn): string | null {
    vi.stubEnv('HOME', homeDir);
    const top = realGit(cwd, home, ['rev-parse', '--show-toplevel']).replace(/\n$/, '');
    const answer = SETTINGS.ledgerRootOf(top, exec === undefined ? undefined : { exec });
    return answer.kind === 'root' ? answer.root : null;
  }

  let main: string;
  let wt: string;
  let bareMain: string;
  let bareWt: string;
  let symlinked: string;
  let symlinkedWt: string;
  let submodule: string;

  beforeAll(() => {
    main = makeRepo({ '.devflow/curation/decisions.md': 'x\n' });
    wt = path.join(freshDir('ledger-wt'), 'wt');
    realGit(main, home, ['worktree', 'add', '-q', wt, '-b', 'side']);
    bareMain = makeRepo({});
    bareWt = path.join(freshDir('ledger-bare-wt'), 'wt');
    realGit(bareMain, home, ['worktree', 'add', '-q', bareWt, '-b', 'side']);
    // A checkout whose .git is a link to a folder named .git elsewhere, and a worktree of it.
    const holder = freshDir('ledger-link');
    const elsewhere = path.join(holder, 'elsewhere');
    symlinked = path.join(holder, 'checkout');
    fs.mkdirSync(path.join(elsewhere, '.devflow'), { recursive: true });
    fs.mkdirSync(symlinked);
    realGit(symlinked, home, ['init', '-q', '-b', 'main']);
    writeFiles(symlinked, { README: 'x\n', '.devflow/curation/decisions.md': 'x\n' });
    realGit(symlinked, home, ['add', '-f', '--', '.']);
    realGit(symlinked, home, ['commit', '-q', '-m', 'fixture']);
    fs.renameSync(path.join(symlinked, '.git'), path.join(elsewhere, '.git'));
    fs.symlinkSync(path.join('..', 'elsewhere', '.git'), path.join(symlinked, '.git'));
    symlinkedWt = path.join(holder, 'linked');
    realGit(symlinked, home, ['worktree', 'add', '-q', symlinkedWt, '-b', 'side']);
    // A submodule: .git is a file naming the superproject's modules folder.
    const lib = makeRepo({});
    const parent = makeRepo({});
    realGit(parent, home, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'vendor/lib']);
    submodule = path.join(parent, 'vendor', 'lib');
  });

  it('agrees on the main checkout, a subdirectory, linked worktrees, a .git link and a submodule', () => {
    fs.mkdirSync(path.join(main, 'packages', 'app'), { recursive: true });
    for (const [cwd, homeDir] of [
      [main, home],
      [path.join(main, 'packages', 'app'), home],
      [wt, home],
      [bareMain, home],
      [bareWt, home],
      [wt, main],
      [symlinked, home],
      [symlinkedWt, home],
      [submodule, home],
    ] as const) {
      expect(resolverLedgerRoot(cwd, homeDir), `${cwd} (HOME ${homeDir})`).toBe(hookLedgerRoot(cwd, homeDir));
    }
  });

  it('names the main checkout from a linked worktree whose main holds .devflow, else the worktree', () => {
    expect(resolverLedgerRoot(wt, home)).toBe(main);
    expect(resolverLedgerRoot(bareWt, home)).toBe(bareWt);
    expect(resolverLedgerRoot(wt, main)).toBe(wt);
  });

  it('a .git folder needs no git call: the toplevel is the ledger root', () => {
    const { exec, recorded } = scriptedExec([]);
    expect(SETTINGS.ledgerRootOf(main, { exec })).toEqual({ kind: 'root', root: main });
    expect(recorded).toEqual([]);
  });

  it('no .git entry at the toplevel needs no git call either', () => {
    const dir = fs.realpathSync(freshDir('no-git'));
    const { exec, recorded } = scriptedExec([]);
    expect(SETTINGS.ledgerRootOf(dir, { exec })).toEqual({ kind: 'root', root: dir });
    expect(recorded).toEqual([]);
  });

  describe('on a scripted git (the .git entry is a file)', () => {
    /** A checkout directory whose `.git` is a file, as a linked worktree has. */
    function linked(): string {
      const dir = fs.realpathSync(freshDir('linked'));
      fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere\n');
      return dir;
    }
    const COMMON = (stdout: string, exit = 0): ScriptedCall => ({ tool: 'git', args: COMMON_DIR_ARGV, stdout, exit });

    it('a common dir named <main>/.git with a .devflow folder and not HOME: the main checkout', () => {
      const dir = linked();
      const mainDir = fs.realpathSync(freshDir('main'));
      fs.mkdirSync(path.join(mainDir, '.git'));
      fs.mkdirSync(path.join(mainDir, '.devflow'));
      vi.stubEnv('HOME', home);
      expect(SETTINGS.ledgerRootOf(dir, { exec: scriptedExec([COMMON(`${mainDir}/.git\n`)]).exec })).toEqual({ kind: 'root', root: mainDir });
    });

    it('the same without a .devflow folder: the toplevel', () => {
      const dir = linked();
      const mainDir = fs.realpathSync(freshDir('main'));
      fs.mkdirSync(path.join(mainDir, '.git'));
      vi.stubEnv('HOME', home);
      expect(SETTINGS.ledgerRootOf(dir, { exec: scriptedExec([COMMON(`${mainDir}/.git\n`)]).exec })).toEqual({ kind: 'root', root: dir });
    });

    it('a common dir that is not named .git: the toplevel', () => {
      const dir = linked();
      expect(SETTINGS.ledgerRootOf(dir, { exec: scriptedExec([COMMON('/somewhere/modules/lib\n')]).exec })).toEqual({ kind: 'root', root: dir });
    });

    it('git before 2.31 echoes the flag back: the toplevel, as the hooks do', () => {
      const dir = linked();
      for (const out of ['--path-format=absolute\n.git\n', '--path-format=absolute\n/some/main/.git\n']) {
        expect(SETTINGS.ledgerRootOf(dir, { exec: scriptedExec([COMMON(out)]).exec }), out).toEqual({ kind: 'root', root: dir });
      }
    });

    it('any other failure is unknown', () => {
      const dir = linked();
      const unknownFor = (calls: readonly ScriptedCall[]): LedgerRoot => SETTINGS.ledgerRootOf(dir, { exec: scriptedExec(calls).exec });
      expect(unknownFor([COMMON('', 128)])).toEqual({ kind: 'unknown' });
      expect(unknownFor([COMMON('/a/.git\n', 128)])).toEqual({ kind: 'unknown' });
      expect(unknownFor([{ tool: 'git', args: COMMON_DIR_ARGV, spawnError: 'ETIMEDOUT' }])).toEqual({ kind: 'unknown' });
      expect(unknownFor([])).toEqual({ kind: 'unknown' });
      for (const out of ['', '\n', 'relative/.git\n', '/a/.git\n/b/.git\n', '/a/.git\n\n']) {
        expect(unknownFor([COMMON(out)]), JSON.stringify(out)).toEqual({ kind: 'unknown' });
      }
    });

    it('an unknown ledger root pauses curation and still asks about memory at the toplevel', () => {
      const dir = linked();
      const calls: ScriptedCall[] = [
        { tool: 'git', args: ARGV.toplevel, stdout: `${dir}\n` },
        COMMON('', 128),
        { tool: 'git', args: areaArgv('memory'), stdout: '' },
      ];
      const { exec } = scriptedExec(calls);
      const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
      expect(SETTINGS.formatSettingsLine(settings)).toBe(withSwitches('on', 'off'));
    });

    it('different roots: one call per root', () => {
      const dir = linked();
      const mainDir = fs.realpathSync(freshDir('main'));
      fs.mkdirSync(path.join(mainDir, '.git'));
      fs.mkdirSync(path.join(mainDir, '.devflow'));
      vi.stubEnv('HOME', home);
      const calls: ScriptedCall[] = [
        { tool: 'git', args: ARGV.toplevel, stdout: `${dir}\n` },
        COMMON(`${mainDir}/.git\n`),
        { tool: 'git', args: areaArgv('curation'), stdout: '.devflow/curation/a\0' },
        { tool: 'git', args: areaArgv('memory'), stdout: '' },
      ];
      const { exec, recorded } = scriptedExec(calls);
      const settings = SETTINGS.resolveSettings({ dir, manifest: { features: {} } }, { exec });
      expect(SETTINGS.formatSettingsLine(settings)).toBe(withSwitches('on', 'off'));
      const cwds = recorded.filter(c => c.args.includes('ls-files')).map(c => c.opts.cwd);
      expect(cwds).toEqual([mainDir, dir]);
    });
  });
});
