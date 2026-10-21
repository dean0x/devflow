// tests/decisions/tracked-area-store.test.ts
//
// A curation store operation where git tracks files in the curation data folders, or does
// not say whether it does, is refused: kind `tracked`, exit 1, an empty stdout, one fixed
// stderr line that states the fact and names no command. The check comes first. The
// operation reads no ledger file, takes no lock and changes nothing, whether the curation
// folder is on disk or not. A project that tracks nothing there is served as before, and the
// answer costs one git call per process. The generic json-helper op `tracked-area` gives
// the answer for either data area.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GIT_ENV,
  JSON_HELPER,
  ROOT,
  initGitRepo,
  makeV2LedgerRow,
  makeV2LogRow,
  pathWithFailingGit,
  requireCurationStore,
  seedCurationTree,
  snapshotTree,
  trackInGit,
  type CurationTreePaths,
} from './curation-fixtures.js';

const RENDERER = path.join(ROOT, 'src/assets/scripts/hooks/lib/render-decisions.cjs');
const store = requireCurationStore();

const TOKEN = 'aaaaaaaaaaaaaaaa';
const CURATION_FILES = ['.devflow/curation/decisions-log.jsonl', '.devflow/curation/decisions-ledger.jsonl'] as const;

/** A claimed batch, as a Curate run holds it. */
const CLAIM_TEXT = `${JSON.stringify({ role: 'user', content: 'a turn', ts: 1 })}\n`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

interface OpRun {
  readonly name: string;
  readonly args: readonly string[];
  readonly input?: string;
}

/** Every json-helper curation op, with arguments that would work on an untracked tree. */
const OPS: readonly OpRun[] = [
  { name: 'claim-queue', args: ['claim-queue'] },
  { name: 'release-claim', args: ['release-claim', TOKEN] },
  { name: 'claim-due', args: ['claim-due'] },
  { name: 'put-observation', args: ['put-observation', '--reinforce'], input: '{"id":"obs_store_one"}' },
  { name: 'assign-anchor', args: ['assign-anchor', 'decision', 'obs_store_one'] },
  { name: 'retire-anchor', args: ['retire-anchor', 'ADR-001', 'Retired'], input: '{"reason":"test"}' },
  { name: 'restore-anchor', args: ['restore-anchor', 'ADR-001'] },
  { name: 'refresh-anchor', args: ['refresh-anchor', 'ADR-001'] },
  { name: 'rotate-observations', args: ['rotate-observations'] },
  { name: 'list', args: ['list'] },
  { name: 'show', args: ['show', 'ADR-001'] },
];

/** The refusal line for an operation, where git tracks files. */
const trackedLine = (op: string, root: string): string =>
  `${op}: git tracks files in the curation data folders under ${root}; nothing was written`;

/** The refusal line for an operation, where git did not answer. */
const unknownLine = (op: string, root: string): string =>
  `${op}: git did not answer whether it tracks files in the curation data folders under ${root}; nothing was written`;

/** A preload that records every path under WATCH_DIR that the process opens, reads or lists, to READ_LOG. */
const READ_SPY = [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  'const log = process.env.READ_LOG;',
  'const watched = process.env.WATCH_DIR;',
  'const append = fs.appendFileSync;',
  'const note = target => {',
  "  if (typeof target === 'string' && (target === watched || target.startsWith(watched + path.sep))) append(log, target + '\\n');",
  '};',
  "for (const name of ['openSync', 'readFileSync', 'readdirSync', 'opendirSync', 'readlinkSync']) {",
  '  const original = fs[name];',
  '  fs[name] = function (target, ...rest) { note(target); return original.call(this, target, ...rest); };',
  '}',
  '',
].join('\n');

describe('a store operation where git tracks the curation data folders', { timeout: 60_000 }, () => {
  let base: string;
  let root: string;
  let paths: CurationTreePaths;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-store-')));
    root = path.join(base, 'project');
    fs.mkdirSync(root);
    paths = seedCurationTree(root, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    fs.writeFileSync(path.join(paths.curationDir, '.pending-turns.jsonl'), CLAIM_TEXT);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** Make the project a repository whose index holds nothing under `.devflow`: the folder is ignored. */
  function initUntracked(): void {
    initGitRepo(root, { 'README.md': 'readme\n', '.gitignore': '.devflow/\n' });
  }

  /** Make the project a repository whose index holds the curation files. */
  function trackCuration(): void {
    initUntracked();
    trackInGit(root, CURATION_FILES, { commit: true });
  }

  /** Run json-helper in the project root, with a preload that records reads of the curation folder when asked. */
  function helper(args: readonly string[], input = '', { env = {}, watch = false }: { env?: NodeJS.ProcessEnv; watch?: boolean } = {}): Run & { reads: string[] } {
    const readLog = path.join(base, 'reads.log');
    const preload = path.join(base, 'read-spy.cjs');
    const preloadArgs: string[] = [];
    if (watch) {
      fs.writeFileSync(preload, READ_SPY);
      fs.rmSync(readLog, { force: true });
      preloadArgs.push('--require', preload);
    }
    const run = spawnSync(process.execPath, [...preloadArgs, JSON_HELPER, ...args], {
      cwd: root,
      env: { ...GIT_ENV, READ_LOG: readLog, WATCH_DIR: paths.curationDir, ...env },
      input,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (run.error) throw run.error;
    const reads = fs.existsSync(readLog) ? fs.readFileSync(readLog, 'utf8').split('\n').filter(Boolean) : [];
    return { code: run.status ?? 1, stdout: run.stdout, stderr: run.stderr, reads };
  }

  /** The `.devflow` tree with every entry's bytes, mode and mtime. */
  const snapshot = (): Map<string, string> => snapshotTree(path.join(root, '.devflow'), { stat: true });

  describe.each(OPS)('$name', ({ name, args, input }) => {
    it('refuses with kind tracked: exit 1, an empty stdout, one fixed line, no change, no lock and no ledger read', () => {
      trackCuration();
      const before = snapshot();

      const run = helper(args, input, { watch: true });

      expect(run.code).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toBe(`${trackedLine(name, root)}\n`);
      expect(snapshot()).toEqual(before);
      expect(fs.existsSync(paths.lockDir)).toBe(false);
      expect(run.reads, 'the refused op read nothing under the curation folder').toEqual([]);
    });

    it('refuses the same way when git does not answer', () => {
      fs.mkdirSync(path.join(root, '.git'));
      const before = snapshot();

      const run = helper(args, input, { watch: true });

      expect(run).toMatchObject({ code: 1, stdout: '', stderr: `${unknownLine(name, root)}\n` });
      expect(snapshot()).toEqual(before);
      expect(fs.existsSync(paths.lockDir)).toBe(false);
      expect(run.reads).toEqual([]);
    });

    it('refuses where the curation folder is not on disk but git tracks its files', () => {
      trackCuration();
      fs.rmSync(path.join(root, '.devflow'), { recursive: true, force: true });

      const run = helper(args, input);

      expect(run).toMatchObject({ code: 1, stdout: '', stderr: `${trackedLine(name, root)}\n` });
      expect(fs.existsSync(path.join(root, '.devflow')), 'the refusal made no folder').toBe(false);
    });
  });

  it('serves a project that tracks nothing there as before, reading the ledger', () => {
    initUntracked();

    const run = helper(['list'], '', { watch: true });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('ACTIVE 1');
    expect(run.reads.some(read => read.endsWith('decisions-ledger.jsonl')), 'the control read the ledger').toBe(true);
  });

  it('serves a project with no .git entry as before, with no git call', () => {
    const calls = recordGitCalls();

    const run = helper(['list'], '', { env: calls.env });

    expect(run.code).toBe(0);
    expect(calls.areaChecks()).toBe(0);
  });

  it('pauses on the curation folder only: a tracked memory folder does not refuse', () => {
    initUntracked();
    trackInGit(root, ['.devflow/memory/WORKING-MEMORY.md'], { commit: true });

    expect(helper(['list']).code).toBe(0);
  });

  it('pauses on the old ledger folder and on a backup folder', () => {
    initUntracked();
    trackInGit(root, ['.devflow/learning/decisions-log.jsonl', '.devflow/learning.backup-20261001T000001Z-00000001/queue'], { commit: true });

    expect(helper(['list'])).toMatchObject({ code: 1, stdout: '', stderr: `${trackedLine('list', root)}\n` });
  });

  describe('the heartbeat', () => {
    it('leaves the mtime of a claim in a tracked tree as it was', () => {
      trackCuration();
      const claim = path.join(paths.curationDir, '.pending-turns.processing');
      fs.writeFileSync(claim, CLAIM_TEXT);
      const old = new Date(Date.now() - 5 * 60 * 1000);
      fs.utimesSync(claim, old, old);
      const before = fs.statSync(claim).mtimeMs;

      const run = helper(['list']);

      expect(run.code).toBe(1);
      expect(run.stderr, 'the heartbeat added nothing to the one refusal line').toBe(`${trackedLine('list', root)}\n`);
      expect(fs.statSync(claim).mtimeMs).toBe(before);
    });

    it('answers {touched: false} from the store, without an error', () => {
      trackCuration();
      const claim = path.join(paths.curationDir, '.pending-turns.processing');
      fs.writeFileSync(claim, CLAIM_TEXT);

      expect(store.touchClaim(root)).toEqual({ ok: true, value: { touched: false } });
    });

    it('still refreshes the claim of a project that tracks nothing there', () => {
      initUntracked();
      const claim = path.join(paths.curationDir, '.pending-turns.processing');
      fs.writeFileSync(claim, CLAIM_TEXT);
      const old = new Date(Date.now() - 5 * 60 * 1000);
      fs.utimesSync(claim, old, old);

      helper(['list']);

      expect(Date.now() - fs.statSync(claim).mtimeMs).toBeLessThan(60 * 1000);
    });
  });

  describe('the store functions', () => {
    it.each([
      ['clearUnreferenced', 'clear', () => store.clearUnreferenced(root)],
      ['resetCuration', 'reset', () => store.resetCuration(root)],
      ['refreshAnchors', 'refresh-anchor', () => store.refreshAnchors(root, ['ADR-001'])],
      ['restoreAnchor', 'restore-anchor', () => store.restoreAnchor(root, 'ADR-001')],
      ['rotateObservations', 'rotate-observations', () => store.rotateObservations(root)],
      ['readListing', 'list', () => store.readListing(root)],
      ['showByKey', 'show', () => store.showByKey(root, 'ADR-001')],
      ['claimQueue', 'claim-queue', () => store.claimQueue(root)],
      ['releaseClaim', 'release-claim', () => store.releaseClaim(root, TOKEN)],
      ['claimDue', 'claim-due', () => store.claimDue(root)],
      ['putObservation', 'put-observation', () => store.putObservation(root, 'reinforce', { id: 'obs_store_one' })],
      ['assignAnchor', 'assign-anchor', () => store.assignAnchor(root, 'decision', 'obs_store_one')],
      ['retireAnchor', 'retire-anchor', () => store.retireAnchor(root, 'ADR-001', 'Retired', { reason: 'test' })],
      ['quoteAtRef', 'retire-anchor', () => store.quoteAtRef(root, 'README.md', 'some quote of the file')],
    ])('%s answers a Result of kind tracked and changes nothing', (_function, op, call) => {
      trackCuration();
      const before = snapshot();

      expect(call()).toEqual({ ok: false, error: { kind: 'tracked', message: trackedLine(op, root) } });
      expect(snapshot()).toEqual(before);
      expect(fs.existsSync(paths.lockDir)).toBe(false);
    });

    it('answers kind tracked, with the did-not-answer line, where git did not answer', () => {
      fs.mkdirSync(path.join(root, '.git'));

      expect(store.readListing(root)).toEqual({ ok: false, error: { kind: 'tracked', message: unknownLine('list', root) } });
    });

    it('lets withDecisionsLock refuse before it runs its body or looks for the journal', () => {
      trackCuration();
      let ran = false;

      const result = store.withDecisionsLock('put-observation', root, () => {
        ran = true;
        return { ok: true, value: null };
      });

      expect(result).toMatchObject({ ok: false, error: { kind: 'tracked' } });
      expect(ran).toBe(false);
    });

    it('keeps the refusal of a linked tree first: not-a-directory, before the tracked check', () => {
      initUntracked();
      const elsewhere = path.join(base, 'elsewhere');
      fs.mkdirSync(elsewhere);
      fs.rmSync(path.join(root, '.devflow'), { recursive: true, force: true });
      fs.symlinkSync(elsewhere, path.join(root, '.devflow'));
      git(root, ['add', '-f', '--', '.devflow']);

      expect(store.withDecisionsLock('put-observation', root, () => ({ ok: true, value: null }))).toMatchObject({
        ok: false,
        error: { kind: 'not-a-directory' },
      });
    });
  });

  describe('the render check', () => {
    const renderCheck = (watch = false): Run & { reads: string[] } => {
      const readLog = path.join(base, 'render-reads.log');
      const preload = path.join(base, 'read-spy.cjs');
      const preloadArgs: string[] = [];
      if (watch) {
        fs.writeFileSync(preload, READ_SPY);
        fs.rmSync(readLog, { force: true });
        preloadArgs.push('--require', preload);
      }
      const run = spawnSync(process.execPath, [...preloadArgs, RENDERER, '--check', root], {
        cwd: root,
        env: { ...GIT_ENV, READ_LOG: readLog, WATCH_DIR: paths.curationDir },
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (run.error) throw run.error;
      const reads = fs.existsSync(readLog) ? fs.readFileSync(readLog, 'utf8').split('\n').filter(Boolean) : [];
      return { code: run.status ?? 1, stdout: run.stdout, stderr: run.stderr, reads };
    };

    it('refuses first with exit 1 and one fixed line, reading nothing under the curation folder', () => {
      trackCuration();
      const before = snapshot();

      const run = renderCheck(true);

      expect(run).toMatchObject({ code: 1, stdout: '', stderr: `${trackedLine('render-decisions', root)}\n`, reads: [] });
      expect(snapshot()).toEqual(before);
      expect(fs.existsSync(paths.lockDir)).toBe(false);
    });

    it('refuses the same way where git did not answer', () => {
      fs.mkdirSync(path.join(root, '.git'));

      expect(renderCheck(true)).toMatchObject({ code: 1, stderr: `${unknownLine('render-decisions', root)}\n`, reads: [] });
    });

    it('checks a project that tracks nothing there as before, reading the ledger', () => {
      initUntracked();

      const run = renderCheck(true);

      expect(run.stderr).toContain('DRIFT');
      expect(run.reads.some(read => read.endsWith('decisions-ledger.jsonl'))).toBe(true);
    });
  });

  describe('the cost of the answer', () => {
    it('asks git once per process: the heartbeat, the operation and its lock share one answer', () => {
      initUntracked();
      const calls = recordGitCalls();

      const run = helper(['claim-due'], '', { env: calls.env });

      expect(run.code).toBe(0);
      expect(calls.areaChecks()).toBe(1);
    });

    it('asks git once for a refused operation too', () => {
      trackCuration();
      const calls = recordGitCalls();

      const run = helper(['list'], '', { env: calls.env });

      expect(run.code).toBe(1);
      expect(calls.areaChecks()).toBe(1);
    });
  });

  /**
   * A `git` on the PATH that records its arguments and runs the real one, and the number of
   * calls that asked about the curation data folders (a `ls-files` over their pathspecs).
   */
  function recordGitCalls(): { env: NodeJS.ProcessEnv; areaChecks(): number } {
    const bin = path.join(base, 'recording-bin');
    const log = path.join(base, 'git-calls.log');
    fs.mkdirSync(bin, { recursive: true });
    const realGit = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, 'git')).find(candidate => fs.existsSync(candidate));
    if (realGit === undefined) throw new Error('no git on the PATH');
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
    return {
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
      areaChecks: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n') : [])
        .filter(line => line.includes('ls-files -z -- :(icase,literal).devflow/')).length,
    };
  }

  function git(dir: string, args: readonly string[]): void {
    const run = spawnSync('git', [...args], { cwd: dir, env: GIT_ENV, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr);
  }

  describe('a git that is missing', () => {
    it('refuses with the did-not-answer line', () => {
      fs.mkdirSync(path.join(root, '.git'));
      const failing = pathWithFailingGit(base, { node: true });

      const run = helper(['list'], '', { env: { PATH: failing } });

      expect(run).toMatchObject({ code: 1, stdout: '', stderr: `${unknownLine('list', root)}\n` });
    });
  });
});

describe('the tracked-area op of json-helper', { timeout: 60_000 }, () => {
  let base: string;
  let root: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tracked-area-op-')));
    root = path.join(base, 'project');
    fs.mkdirSync(root);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const op = (args: readonly string[], cwd: string = base, env: NodeJS.ProcessEnv = {}): Run => {
    const run = spawnSync(process.execPath, [JSON_HELPER, 'tracked-area', ...args], {
      cwd,
      env: { ...GIT_ENV, ...env },
      input: '',
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (run.error) throw run.error;
    return { code: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
  };

  it.each(['curation', 'memory', 'both'])('prints untracked for the %s area of a project with no .git entry', area => {
    expect(op([area, root])).toEqual({ code: 0, stdout: 'untracked\n', stderr: '' });
  });

  it('prints tracked for the area whose folder git tracks, and untracked for the other', () => {
    initGitRepo(root);
    trackInGit(root, ['.devflow/memory/WORKING-MEMORY.md'], { commit: true });

    expect(op(['memory', root])).toEqual({ code: 0, stdout: 'tracked\n', stderr: '' });
    expect(op(['curation', root])).toEqual({ code: 0, stdout: 'untracked\n', stderr: '' });
    expect(op(['both', root])).toEqual({ code: 0, stdout: 'tracked\n', stderr: '' });
  });

  it('prints unknown and a cause word where git did not answer', () => {
    fs.mkdirSync(path.join(root, '.git'));

    expect(op(['curation', root])).toEqual({ code: 0, stdout: 'unknown\ncause git-exit-status\n', stderr: '' });
  });

  it('prints unknown and the cause git-not-found where git is missing', () => {
    fs.mkdirSync(path.join(root, '.git'));
    const empty = path.join(base, 'empty-bin');
    fs.mkdirSync(empty);

    expect(op(['both', root], base, { PATH: empty })).toEqual({ code: 0, stdout: 'unknown\ncause git-not-found\n', stderr: '' });
  });

  it('prints unknown and the cause root-not-absolute for a root that is not an absolute path', () => {
    expect(op(['curation', 'project'])).toEqual({ code: 0, stdout: 'unknown\ncause root-not-absolute\n', stderr: '' });
  });

  it('answers for the root it is given, whatever the working directory', () => {
    initGitRepo(root);
    trackInGit(root, ['.devflow/curation/decisions-log.jsonl'], { commit: true });

    expect(op(['curation', root], os.tmpdir()).stdout).toBe('tracked\n');
  });

  it.each([
    ['no arguments', []],
    ['an area and no root', ['curation']],
    ['an area it does not know', ['learning', '/tmp']],
    ['an area in another case', ['Curation', '/tmp']],
    ['an empty area', ['', '/tmp']],
    ['a third argument', ['curation', '/tmp', 'extra']],
  ])('refuses %s with the usage line, exit 1 and an empty stdout', (_name, args) => {
    const run = op(args);

    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('tracked-area: usage: tracked-area <curation|memory|both> <root> (the root is an absolute path)\n');
  });

  it('sends no heartbeat: an existing claim keeps its mtime', () => {
    const paths = seedCurationTree(root);
    const claim = path.join(paths.curationDir, '.pending-turns.processing');
    fs.writeFileSync(claim, CLAIM_TEXT);
    const old = new Date(Date.now() - 5 * 60 * 1000);
    fs.utimesSync(claim, old, old);
    const before = fs.statSync(claim).mtimeMs;

    expect(op(['curation', root], root).code).toBe(0);
    expect(fs.statSync(claim).mtimeMs).toBe(before);
  });

  it('asks git once for the root and area', () => {
    initGitRepo(root, { 'README.md': 'readme\n' });
    const bin = path.join(base, 'recording-bin');
    const log = path.join(base, 'git-calls.log');
    fs.mkdirSync(bin);
    const realGit = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, 'git')).find(candidate => fs.existsSync(candidate));
    if (realGit === undefined) throw new Error('no git on the PATH');
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });

    expect(op(['both', root], base, { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }).stdout).toBe('untracked\n');
    expect(fs.readFileSync(log, 'utf8').split('\n').filter(line => line.includes('ls-files -z --'))).toHaveLength(1);
  });
});
