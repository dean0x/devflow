// tests/core/tracked-areas-seam.test.ts
//
// The CLI's view of the tracked-areas check: src/core/tracked-areas.ts loads the
// package's own src/assets/scripts/hooks/lib/tracked-areas.cjs (the module the move and
// the backup sweep run) through the evidence-policy seam's loadScript, shape-checks its
// surface, and answers a Result for a missing or unusable module, never a throw.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import {
  TRACKED_AREAS_SCRIPT_NAME,
  TRACKED_AREAS_SURFACE,
  TRACKED_AREA_PROBE_MAX_BUFFER,
  TRACKED_AREA_PROBE_TIMEOUT_MS,
  loadTrackedAreas,
  probeTrackedArea,
  type TrackedArea,
} from '../../src/core/tracked-areas.js';
import { ROOT, git, initGitRepo, pathWithoutGit, trackInGit } from '../decisions/curation-fixtures.js';
import { useWarmFakeExecutables } from '../helpers/warm-fake-executable.js';

const NODE_REQUIRE = createRequire(import.meta.url);
const LEAF = path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'lib', 'tracked-areas.cjs');
const AREAS: ReadonlyArray<Exclude<TrackedArea, 'both'>> = ['curation', 'memory'];
/** The two data areas and their union: every area the probe answers for. */
const ALL_AREAS: readonly TrackedArea[] = [...AREAS, 'both'];

let tmp: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-areas-seam-')));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadTrackedAreas: the package copy, shape-checked, never a throw', () => {
  it('loads join(scriptsDir(), hooks/lib/tracked-areas.cjs): the module the move and the sweep run', () => {
    expect(path.join(scriptsDir(), TRACKED_AREAS_SCRIPT_NAME)).toBe(LEAF);
    const loaded = loadTrackedAreas();
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.value).toBe(NODE_REQUIRE(LEAF));
  });

  it('names the three functions the CLI, the HUD and the settings resolver call, and the module exports each as a function', () => {
    expect(Object.keys(TRACKED_AREAS_SURFACE).sort()).toEqual([
      'checkTrackedAreas', 'judgeTrackedAreas', 'trackedAreaCall',
    ]);
    expect(Object.values(TRACKED_AREAS_SURFACE).every(kind => kind === 'function')).toBe(true);
    const leaf = NODE_REQUIRE(LEAF) as Record<string, unknown>;
    for (const key of Object.keys(TRACKED_AREAS_SURFACE)) expect(typeof leaf[key], key).toBe('function');
  });

  it('a scripts directory without the module is a not-found error naming the path', () => {
    const empty = path.join(tmp, 'no-leaf');
    fs.mkdirSync(empty);
    const loaded = loadTrackedAreas(empty);
    expect(!loaded.ok && loaded.error.kind).toBe('not-found');
    expect(!loaded.ok && loaded.error.path).toBe(path.join(empty, TRACKED_AREAS_SCRIPT_NAME));
  });

  it('a module without the function is an unusable error naming it', () => {
    const dir = path.join(tmp, 'partial-leaf');
    const file = path.join(dir, TRACKED_AREAS_SCRIPT_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "'use strict';\nmodule.exports = {};\n", 'utf8');
    const loaded = loadTrackedAreas(dir);
    expect(!loaded.ok && loaded.error.kind).toBe('unusable');
    expect(!loaded.ok && loaded.error.kind === 'unusable' && loaded.error.detail).toMatch(/checkTrackedAreas/);
  });

  it.each(['checkTrackedAreas', 'trackedAreaCall', 'judgeTrackedAreas'])('a module that lacks %s is an unusable error naming it', (missing) => {
    const dir = path.join(tmp, `lacks-${missing}`);
    const file = path.join(dir, TRACKED_AREAS_SCRIPT_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const keys = Object.keys(TRACKED_AREAS_SURFACE).filter(key => key !== missing);
    fs.writeFileSync(file, `'use strict';\nmodule.exports = { ${keys.map(key => `${key}() {}`).join(', ')} };\n`, 'utf8');

    const loaded = loadTrackedAreas(dir);

    expect(!loaded.ok && loaded.error.kind).toBe('unusable');
    expect(!loaded.ok && loaded.error.kind === 'unusable' && loaded.error.detail).toContain(missing);
  });
});

describe('the probe bounds mirror the leaf\'s', () => {
  it('holds the leaf\'s time bound and output bound', () => {
    const leaf = NODE_REQUIRE(LEAF) as { TRACKED_AREAS_GIT_TIMEOUT_MS: number; TRACKED_AREAS_GIT_MAX_BUFFER: number };
    expect(TRACKED_AREA_PROBE_TIMEOUT_MS).toBe(leaf.TRACKED_AREAS_GIT_TIMEOUT_MS);
    expect(TRACKED_AREA_PROBE_MAX_BUFFER).toBe(leaf.TRACKED_AREAS_GIT_MAX_BUFFER);
  });
});

interface Leaf {
  inspectTrackedArea(root: string, area: string): { answer: string; cause: string | null };
  trackedAreaCall(root: string, area: string): { cwd: string; argv: string[]; env: NodeJS.ProcessEnv };
}

describe('probeTrackedArea: the leaf\'s call, run asynchronously, answered by the leaf\'s judge', { timeout: 30_000 }, () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  /** Budget handed to the probes that wait on a hung git: short, so the tests stay fast. */
  const BUDGET_MS = 300;
  /** What a probe may take beyond its budget: the kill grace plus a loaded machine. */
  const MARGIN_MS = 3_000;
  const FOLDER: Record<'curation' | 'memory', string> = { curation: '.devflow/curation', memory: '.devflow/memory' };
  const leaf = NODE_REQUIRE(LEAF) as Leaf;
  let base: string;
  let root: string;
  let bin: string;
  let savedPath: string | undefined;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-probe-')));
    root = path.join(base, 'project');
    bin = path.join(base, 'bin');
    fs.mkdirSync(root);
    fs.mkdirSync(bin);
    savedPath = process.env.PATH;
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** Put a `git` that runs `body` first on PATH, for the rest of this test. */
  function fakeGit(body: string): void {
    writeFakeExecutable(path.join(bin, 'git'), `#!/bin/bash\n${body}\n`);
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`;
  }

  /** A repository at the root: the entry exists, and git (the fake or the real one) is asked. */
  function dotGit(): void {
    fs.mkdirSync(path.join(root, '.git'));
  }

  async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
    const started = Date.now();
    const value = await run();
    return { value, ms: Date.now() - started };
  }

  describe('on real git', () => {
    it.each(AREAS)('answers tracked when git tracks the %s folder, and untracked for the other area', async (area) => {
      initGitRepo(root);
      trackInGit(root, [`${FOLDER[area]}/note.txt`], { commit: true });
      const other: 'curation' | 'memory' = area === 'curation' ? 'memory' : 'curation';

      expect(await probeTrackedArea(root, area)).toEqual({ answer: 'tracked', cause: null });
      expect(await probeTrackedArea(root, other)).toEqual({ answer: 'untracked', cause: null });
    });

    it('answers tracked for the union when git tracks either folder, and untracked when it tracks neither', async () => {
      initGitRepo(root, { 'README.md': 'readme\n' });
      expect(await probeTrackedArea(root, 'both')).toEqual({ answer: 'untracked', cause: null });
      trackInGit(root, ['.devflow/memory/note.txt'], { commit: true });
      expect(await probeTrackedArea(root, 'both')).toEqual({ answer: 'tracked', cause: null });
      expect(await probeTrackedArea(root, 'curation')).toEqual({ answer: 'untracked', cause: null });
    });

    it('answers untracked for both areas when git tracks nothing in the data folders', async () => {
      initGitRepo(root, { 'README.md': 'readme\n', '.devflow/project.json': '{}\n' });
      fs.mkdirSync(path.join(root, '.devflow', 'memory'), { recursive: true });
      fs.writeFileSync(path.join(root, '.devflow', 'memory', 'WORKING-MEMORY.md'), 'untracked\n');

      for (const area of AREAS) expect(await probeTrackedArea(root, area), area).toEqual({ answer: 'untracked', cause: null });
    });

    it('answers what the leaf answers on a matrix of projects, for every area', async () => {
      const projects: Array<[name: string, build: (dir: string) => void]> = [
        ['nothing tracked', dir => { initGitRepo(dir, { 'README.md': 'readme\n' }); }],
        ['curation tracked', dir => { initGitRepo(dir, { '.devflow/curation/decisions.md': 'x\n' }); }],
        ['legacy folder tracked', dir => { initGitRepo(dir, { '.devflow/learning/decisions.md': 'x\n' }); }],
        ['memory tracked', dir => { initGitRepo(dir, { '.devflow/memory/WORKING-MEMORY.md': 'x\n' }); }],
        ['both tracked', dir => { initGitRepo(dir, { '.devflow/memory/a': 'x\n', '.devflow/curation/b': 'x\n' }); }],
        ['upper-case memory tracked', dir => { initGitRepo(dir, { '.DEVFLOW/MEMORY/a': 'x\n' }); }],
        ['ligature memory tracked', dir => { initGitRepo(dir, { [`.dev\u{FB02}ow/memory/a`]: 'x\n' }); }],
        ['the devflow entry tracked as a file', dir => { initGitRepo(dir, { '.devflow': 'file\n' }); }],
        ['no repository', () => undefined],
        ['an empty .git entry', dir => { fs.mkdirSync(path.join(dir, '.git')); }],
      ];
      for (const [name, build] of projects) {
        const dir = path.join(base, `matrix-${projects.findIndex(entry => entry[0] === name)}`);
        fs.mkdirSync(dir);
        build(dir);
        for (const area of ALL_AREAS) {
          expect(await probeTrackedArea(dir, area), `${name} / ${area}`).toEqual(leaf.inspectTrackedArea(dir, area));
        }
      }
    });

    it('sees through git variables that name another repository or index', async () => {
      initGitRepo(root);
      trackInGit(root, ['.devflow/memory/note.txt'], { commit: true });
      process.env.GIT_DIR = path.join(base, 'nonexistent-dir');
      process.env.GIT_INDEX_FILE = path.join(base, 'nonexistent-index');
      process.env.GIT_WORK_TREE = path.join(base, 'nonexistent-tree');
      process.env.GIT_LITERAL_PATHSPECS = '1';

      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'tracked', cause: null });
    });

    it('does not run the core.fsmonitor command of the repository', async () => {
      initGitRepo(root);
      trackInGit(root, ['.devflow/memory/note.txt'], { commit: true });
      const marker = path.join(base, 'fsmonitor-ran');
      git(root, ['config', 'core.fsmonitor', `echo ran >> '${marker}' #`]);

      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'tracked', cause: null });
      expect(fs.existsSync(marker), 'the probe ran the fsmonitor command').toBe(false);
    });
  });

  describe('where the leaf prescribes no call', () => {
    it.each(ALL_AREAS)('answers untracked for the %s area, and starts no git, when the root has no .git entry', async (area) => {
      const marker = path.join(base, 'git-ran');
      process.env.PROBE_MARKER = marker;
      fakeGit('echo ran >> "$PROBE_MARKER"\nexit 0');

      expect(await probeTrackedArea(root, area)).toEqual({ answer: 'untracked', cause: null });
      expect(fs.existsSync(marker)).toBe(false);
    });

    it('answers unknown with the cause root-not-absolute for a root that is not an absolute path', async () => {
      expect(await probeTrackedArea('project', 'memory')).toEqual({ answer: 'unknown', cause: 'root-not-absolute' });
      expect(await probeTrackedArea('', 'curation')).toEqual({ answer: 'unknown', cause: 'root-not-absolute' });
    });

    it('answers unknown with the cause check-failed for an area the leaf does not know, and starts no git', async () => {
      dotGit();
      const marker = path.join(base, 'git-ran');
      process.env.PROBE_MARKER = marker;
      fakeGit('echo ran >> "$PROBE_MARKER"\nexit 0');

      expect(await probeTrackedArea(root, 'Both' as TrackedArea)).toEqual({ answer: 'unknown', cause: 'check-failed' });
      expect(await probeTrackedArea(root, 'constructor' as TrackedArea)).toEqual({ answer: 'unknown', cause: 'check-failed' });
      expect(fs.existsSync(marker)).toBe(false);
    });

    it('answers unknown with the cause check-failed, and never rejects, when the leaf can not be loaded', async () => {
      dotGit();
      const empty = path.join(base, 'no-leaf');
      fs.mkdirSync(empty);

      expect(await probeTrackedArea(root, 'memory', { dir: empty })).toEqual({ answer: 'unknown', cause: 'check-failed' });
    });
  });

  describe('the call it makes', () => {
    it.each(ALL_AREAS)('runs the leaf\'s argv and scrubbed environment in the root, for the %s area', async (area) => {
      dotGit();
      const record = path.join(base, 'record');
      fs.mkdirSync(record);
      process.env.PROBE_RECORD = record;
      process.env.GIT_DIR = '/nonexistent';
      process.env.GIT_INDEX_FILE = '/nonexistent';
      process.env.GIT_LITERAL_PATHSPECS = '1';
      process.env.LC_ALL = 'de_DE.UTF-8';
      fakeGit('printf "%s\\n" "$@" > "$PROBE_RECORD/argv"\nenv > "$PROBE_RECORD/env"\npwd -P > "$PROBE_RECORD/cwd"\nexit 0');

      expect(await probeTrackedArea(root, area)).toEqual({ answer: 'untracked', cause: null });

      const call = leaf.trackedAreaCall(root, area);
      expect(fs.readFileSync(path.join(record, 'argv'), 'utf8').split('\n').slice(0, -1)).toEqual(call.argv);
      expect(fs.readFileSync(path.join(record, 'cwd'), 'utf8').trim()).toBe(fs.realpathSync(root));
      const env = fs.readFileSync(path.join(record, 'env'), 'utf8').split('\n');
      for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_LITERAL_PATHSPECS']) {
        expect(env.some(line => line.startsWith(`${name}=`)), name).toBe(false);
      }
      expect(env).toContain('LC_ALL=C');
      expect(env).toContain('GIT_OPTIONAL_LOCKS=0');
      expect(env).toContain(`GIT_CEILING_DIRECTORIES=${base}`);
    });
  });

  describe('what git does', () => {
    beforeEach(dotGit);

    it('answers untracked when git exits 0 and lists nothing', async () => {
      fakeGit('exit 0');
      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'untracked', cause: null });
    });

    it('answers tracked when git lists an entry, whatever its exit status', async () => {
      fakeGit('printf ".devflow/memory/a\\0"\nexit 0');
      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'tracked', cause: null });
      fakeGit('printf ".devflow/memory/a\\0"\nexit 1');
      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'tracked', cause: null });
    });

    it('answers tracked when the listing is longer than the buffer', async () => {
      fakeGit('head -c 20000 /dev/zero | tr "\\0" "a"\nexit 0');
      expect(await probeTrackedArea(root, 'curation')).toEqual({ answer: 'tracked', cause: null });
    });

    it('answers unknown with the cause git-exit-status when git exits non-zero with nothing listed', async () => {
      fakeGit('echo "fatal: not a git repository" >&2\nexit 128');
      expect(await probeTrackedArea(root, 'curation')).toEqual({ answer: 'unknown', cause: 'git-exit-status' });
    });

    it('answers unknown with the cause git-stopped when a signal ends git', async () => {
      fakeGit('kill -KILL $$');
      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'unknown', cause: 'git-stopped' });
    });

    it('answers unknown with the cause git-not-found when git is not on the PATH', async () => {
      process.env.PATH = pathWithoutGit(base);
      expect(await probeTrackedArea(root, 'memory')).toEqual({ answer: 'unknown', cause: 'git-not-found' });
    });

    it('answers unknown with the cause git-timed-out within the budget when git sleeps', async () => {
      fakeGit('exec sleep 30');

      const run = await timed(() => probeTrackedArea(root, 'memory', { timeoutMs: BUDGET_MS }));

      expect(run.value).toEqual({ answer: 'unknown', cause: 'git-timed-out' });
      expect(run.ms).toBeLessThan(BUDGET_MS + MARGIN_MS);
    });

    it('answers within the budget even when git ignores the polite kill', async () => {
      // The ignored signal stays ignored through `exec`, so only the probe's own SIGKILL ends this git.
      fakeGit("trap '' TERM\nexec sleep 8");

      const run = await timed(() => probeTrackedArea(root, 'curation', { timeoutMs: BUDGET_MS }));

      expect(run.value).toEqual({ answer: 'unknown', cause: 'git-timed-out' });
      expect(run.ms).toBeLessThan(BUDGET_MS + MARGIN_MS);
    });

    it.each([
      ['zero', 0],
      ['not a number', Number.NaN],
      ['negative', -1],
    ])('keeps the default bound, not a zero wait, when timeoutMs is %s', async (_name, timeoutMs) => {
      fakeGit('sleep 0.7\nexit 0');

      expect(await probeTrackedArea(root, 'memory', { timeoutMs })).toEqual({ answer: 'untracked', cause: null });
    });
  });
});
