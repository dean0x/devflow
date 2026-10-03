// tests/decisions/learning-claim.test.ts
//
// The learning queue claim (D-OWNED-CLAIM). claim-queue moves the queue to
// .pending-turns.processing under the learning lock and the queue's own lock,
// stamps the claim's mtime and records a fresh token as its owner; a live claim
// is busy to every other claimant and a stale one is taken over with a new token;
// release-claim deletes the claim only for the token that owns it; and every
// learning op refreshes an existing claim's mtime, while no op but claim-queue
// ever creates one.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GIT_ENV,
  JSON_HELPER,
  requireLearningStore,
  runJsonHelper,
  seedLearningTree,
  snapshotTree,
  type HelperRun,
} from './learning-fixtures.js';

const store = requireLearningStore();

const TOKEN_A = 'aaaaaaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbbbbbbbbbb';
const STALE_MS = store.CLAIM_STALE_SECS * 1000;

interface ClaimPaths {
  learningDir: string;
  queue: string;
  claim: string;
  owner: string;
  queueLock: string;
}

function claimPaths(dir: string): ClaimPaths {
  const learningDir = path.join(dir, '.devflow', 'learning');
  const queue = path.join(learningDir, '.pending-turns.jsonl');
  return {
    learningDir,
    queue,
    claim: path.join(learningDir, '.pending-turns.processing'),
    owner: path.join(learningDir, '.pending-turns.owner'),
    queueLock: `${queue}.lock`,
  };
}

/** One captured turn as the capture hooks queue it. */
const turn = (n: number): string => JSON.stringify({ role: 'user', content: `turn ${n}`, ts: n });

/** The JSONL text of turns `from` .. `to - 1`. */
const turns = (from: number, to: number): string =>
  Array.from({ length: to - from }, (_, i) => `${turn(from + i)}\n`).join('');

/** Set a file's mtime (and atime) to `ms`. */
function setMtime(file: string, ms: number): void {
  const at = new Date(ms);
  fs.utimesSync(file, at, at);
}

/** The non-blank lines of a file, or none when it is absent. */
function linesOf(file: string): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

describe('claimQueue', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: ClaimPaths;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-claim-'));
    paths = claimPaths(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('claims a waiting queue: the claim holds its rows, the queue is gone and the token owns the claim', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 3));

    expect(store.claimQueue(dir, { token: TOKEN_A })).toEqual({
      ok: true,
      value: { state: 'claimed', token: TOKEN_A, takeover: false },
    });
    expect(fs.readFileSync(paths.claim, 'utf8')).toBe(turns(0, 3));
    expect(fs.existsSync(paths.queue)).toBe(false);
    expect(fs.readFileSync(paths.owner, 'utf8')).toBe(`${TOKEN_A}\n`);
  });

  it('stamps the claim with the time of the claim, not the queue\'s old mtime', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 1));
    const now = Date.now();
    setMtime(paths.queue, now - 2 * STALE_MS);

    store.claimQueue(dir, { now, token: TOKEN_A });

    expect(Math.abs(fs.statSync(paths.claim).mtimeMs - now)).toBeLessThan(1000);
  });

  it('answers busy while a fresh claim is held, and leaves the claim and the queue byte-identical', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.claim, turns(0, 2));
    fs.writeFileSync(paths.owner, `${TOKEN_A}\n`);
    fs.writeFileSync(paths.queue, turns(2, 3));
    const now = Date.now();
    setMtime(paths.claim, now - STALE_MS + 1000);
    const before = snapshotTree(dir);

    expect(store.claimQueue(dir, { now, token: TOKEN_B })).toEqual({ ok: true, value: { state: 'busy' } });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('takes over a claim with no heartbeat for the stale interval, with a new token, leaving its rows and the queue in place', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.claim, turns(0, 2));
    fs.writeFileSync(paths.owner, `${TOKEN_A}\n`);
    fs.writeFileSync(paths.queue, turns(2, 3));
    const now = Date.now();
    setMtime(paths.claim, now - STALE_MS - 1000);

    expect(store.claimQueue(dir, { now, token: TOKEN_B })).toEqual({
      ok: true,
      value: { state: 'claimed', token: TOKEN_B, takeover: true },
    });
    expect(fs.readFileSync(paths.claim, 'utf8')).toBe(turns(0, 2));
    expect(fs.readFileSync(paths.queue, 'utf8')).toBe(turns(2, 3));
    expect(fs.readFileSync(paths.owner, 'utf8')).toBe(`${TOKEN_B}\n`);
    expect(Math.abs(fs.statSync(paths.claim).mtimeMs - now)).toBeLessThan(1000);
  });

  it('leaves a claim with no owner file, as a run on the old protocol left it, byte-identical while it is fresh', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.claim, turns(0, 4));
    const before = snapshotTree(dir);

    expect(store.claimQueue(dir, { token: TOKEN_A })).toEqual({ ok: true, value: { state: 'busy' } });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('answers none, creating nothing, without a queue, with an empty queue and without a learning directory', () => {
    expect(store.claimQueue(dir, { token: TOKEN_A })).toEqual({ ok: true, value: { state: 'none' } });
    expect(fs.readdirSync(dir)).toEqual([]);

    seedLearningTree(dir);
    const bare = snapshotTree(dir);
    expect(store.claimQueue(dir, { token: TOKEN_A })).toEqual({ ok: true, value: { state: 'none' } });
    expect(snapshotTree(dir)).toEqual(bare);

    fs.writeFileSync(paths.queue, '');
    const empty = snapshotTree(dir);
    expect(store.claimQueue(dir, { token: TOKEN_A })).toEqual({ ok: true, value: { state: 'none' } });
    expect(snapshotTree(dir)).toEqual(empty);
  });

  it('answers busy and moves nothing while the queue\'s own lock is held', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 3));
    fs.mkdirSync(paths.queueLock);

    expect(store.claimQueue(dir, { token: TOKEN_A })).toEqual({ ok: true, value: { state: 'busy' } });
    expect(fs.readFileSync(paths.queue, 'utf8')).toBe(turns(0, 3));
    expect(fs.existsSync(paths.claim)).toBe(false);
    expect(fs.existsSync(paths.owner)).toBe(false);
    expect(fs.existsSync(paths.queueLock), 'the held lock stays its holder\'s').toBe(true);
  });

  it('refuses a claim path that is not a regular file', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 1));
    fs.mkdirSync(paths.claim);

    const result = store.claimQueue(dir, { token: TOKEN_A });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain('is not a regular file');
    expect(fs.readFileSync(paths.queue, 'utf8')).toBe(turns(0, 1));
  });

  it('mints a token of 16 lowercase hex characters and refuses any other', () => {
    expect(store.newClaimToken()).toMatch(/^[0-9a-f]{16}$/);
    expect(store.newClaimToken()).not.toBe(store.newClaimToken());
    expect(() => store.claimQueue(dir, { token: 'ABCDEF0123456789' })).toThrow(TypeError);
  });
});

describe('releaseClaim', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: ClaimPaths;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-release-'));
    paths = claimPaths(dir);
    seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('releases the claim for the token that owns it: the claim and the owner file are gone', () => {
    fs.writeFileSync(paths.queue, turns(0, 2));
    store.claimQueue(dir, { token: TOKEN_A });

    expect(store.releaseClaim(dir, TOKEN_A)).toEqual({ ok: true, value: { state: 'released' } });
    expect(fs.existsSync(paths.claim)).toBe(false);
    expect(fs.existsSync(paths.owner)).toBe(false);
  });

  it('refuses a token that does not own the claim and leaves everything in place', () => {
    fs.writeFileSync(paths.queue, turns(0, 2));
    store.claimQueue(dir, { token: TOKEN_A });
    const before = snapshotTree(dir);

    expect(store.releaseClaim(dir, TOKEN_B)).toEqual({ ok: true, value: { state: 'not-owner' } });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('reports gone when the claim has vanished, and removes the owner file only when it names the token', () => {
    fs.writeFileSync(paths.owner, `${TOKEN_A}\n`);

    expect(store.releaseClaim(dir, TOKEN_B)).toEqual({ ok: true, value: { state: 'gone' } });
    expect(fs.readFileSync(paths.owner, 'utf8')).toBe(`${TOKEN_A}\n`);

    expect(store.releaseClaim(dir, TOKEN_A)).toEqual({ ok: true, value: { state: 'gone' } });
    expect(fs.existsSync(paths.owner)).toBe(false);
  });

  it('refuses without a learning directory and creates nothing', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-release-bare-'));
    try {
      const result = store.releaseClaim(bare, TOKEN_A);
      expect(result.ok ? '' : result.error.kind).toBe('no-learning-dir');
      expect(fs.readdirSync(bare)).toEqual([]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('touchClaim', () => {
  let dir: string;
  let paths: ClaimPaths;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-touch-'));
    paths = claimPaths(dir);
    seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refreshes an existing claim\'s mtime and leaves its bytes as they were', () => {
    fs.writeFileSync(paths.claim, turns(0, 2));
    const now = Date.now();
    setMtime(paths.claim, now - STALE_MS + 60_000);

    expect(store.touchClaim(dir, { now })).toEqual({ ok: true, value: { touched: true } });
    expect(Math.abs(fs.statSync(paths.claim).mtimeMs - now)).toBeLessThan(1000);
    expect(fs.readFileSync(paths.claim, 'utf8')).toBe(turns(0, 2));
  });

  it('never creates a claim', () => {
    expect(store.touchClaim(dir)).toEqual({ ok: true, value: { touched: false } });
    expect(fs.existsSync(paths.claim)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The json-helper ops
// ---------------------------------------------------------------------------

/** Run json-helper without waiting, so several runs can contend. */
function spawnJsonHelper(cwd: string, args: readonly string[]): Promise<HelperRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [JSON_HELPER, ...args], { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** A capture hook's appends: one O_APPEND write per turn, `from` .. `to - 1`, a few ms apart. */
const APPENDER = [
  "const fs = require('fs');",
  'const [queue, from, to] = process.argv.slice(1);',
  'const pause = new Int32Array(new SharedArrayBuffer(4));',
  'for (let n = Number(from); n < Number(to); n++) {',
  "  fs.appendFileSync(queue, JSON.stringify({ role: 'user', content: 'turn ' + n, ts: n }) + '\\n');",
  '  Atomics.wait(pause, 0, 0, 3);',
  '}',
].join('\n');

function spawnAppender(queue: string, from: number, to: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', APPENDER, queue, String(from), String(to)], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
}

describe('claim-queue and release-claim ops', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: ClaimPaths;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-claim-ops-'));
    paths = claimPaths(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('claim-queue prints claimed and a token; release-claim with that token prints released', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 2));

    const claim = runJsonHelper(dir, ['claim-queue']);
    expect(claim.code).toBe(0);
    expect(claim.stderr).toBe('');
    const token = /^claimed ([0-9a-f]{16})\n$/.exec(claim.stdout)?.[1];
    expect(token, `claim-queue printed ${JSON.stringify(claim.stdout)}`).toBeDefined();

    expect(runJsonHelper(dir, ['release-claim', token!])).toEqual({ code: 0, stdout: 'released\n', stderr: '' });
    expect(fs.existsSync(paths.claim)).toBe(false);
  });

  it('claim-queue prints busy for a live claim and none for an empty queue or a missing learning tree', () => {
    expect(runJsonHelper(dir, ['claim-queue'])).toEqual({ code: 0, stdout: 'none\n', stderr: '' });
    expect(fs.readdirSync(dir)).toEqual([]);

    seedLearningTree(dir);
    expect(runJsonHelper(dir, ['claim-queue'])).toEqual({ code: 0, stdout: 'none\n', stderr: '' });

    fs.writeFileSync(paths.claim, turns(0, 1));
    expect(runJsonHelper(dir, ['claim-queue'])).toEqual({ code: 0, stdout: 'busy\n', stderr: '' });
  });

  it('a takeover prints a new token, and the token it replaced is refused at release', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 2));
    store.claimQueue(dir, { token: TOKEN_A });
    setMtime(paths.claim, Date.now() - STALE_MS - 1000);

    const takeover = runJsonHelper(dir, ['claim-queue']);
    const token = /^claimed ([0-9a-f]{16}) takeover\n$/.exec(takeover.stdout)?.[1];
    expect(token, `claim-queue printed ${JSON.stringify(takeover.stdout)}`).toBeDefined();
    expect(token).not.toBe(TOKEN_A);

    expect(runJsonHelper(dir, ['release-claim', TOKEN_A])).toEqual({ code: 0, stdout: 'not-owner\n', stderr: '' });
    expect(fs.readFileSync(paths.claim, 'utf8')).toBe(turns(0, 2));
    expect(runJsonHelper(dir, ['release-claim', token!])).toEqual({ code: 0, stdout: 'released\n', stderr: '' });
  });

  it('release-claim prints gone when the claim has vanished', () => {
    seedLearningTree(dir);
    expect(runJsonHelper(dir, ['release-claim', TOKEN_A])).toEqual({ code: 0, stdout: 'gone\n', stderr: '' });
  });

  it('claim-queue takes no argument and release-claim takes exactly one token, refusing anything else', () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 1));
    const before = snapshotTree(dir);

    for (const args of [['claim-queue', 'extra'], ['release-claim'], ['release-claim', 'not-a-token'], ['release-claim', TOKEN_A, TOKEN_B]]) {
      const run = runJsonHelper(dir, args);
      expect(run.code, `${args.join(' ')} exits 1`).toBe(1);
      expect(run.stderr).toContain(`${args[0]}: usage`);
    }
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('release-claim refuses without a learning directory and creates nothing', () => {
    const run = runJsonHelper(dir, ['release-claim', TOKEN_A]);
    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`release-claim: no .devflow/learning/ under ${fs.realpathSync(dir)} — run from the project root\n`);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('five concurrent claimants: exactly one claims, four answer busy, and no queued row is lost', async () => {
    seedLearningTree(dir);
    fs.writeFileSync(paths.queue, turns(0, 20));

    const [appended, ...claims] = await Promise.all([
      spawnAppender(paths.queue, 20, 50),
      ...Array.from({ length: 5 }, () => spawnJsonHelper(dir, ['claim-queue'])),
    ]);

    expect(appended).toBe(0);
    for (const run of claims) expect(run, 'a claimant exits 0 with nothing on stderr').toMatchObject({ code: 0, stderr: '' });
    const answers = claims.map(run => run.stdout.trim());
    expect(answers.filter(answer => /^claimed [0-9a-f]{16}$/.test(answer))).toHaveLength(1);
    expect(answers.filter(answer => answer === 'busy')).toHaveLength(4);
    // Each row sits exactly once in the claimed batch or in the queue formed after the claim.
    const placed = [...linesOf(paths.claim), ...linesOf(paths.queue)].sort();
    expect(placed).toEqual(turns(0, 50).split('\n').filter(Boolean).sort());
  });
});

describe('heartbeat: learning ops refresh the claim, other ops never touch it', { timeout: 30_000 }, () => {
  const LEARNING_OP_RUNS: ReadonlyArray<{ args: readonly string[]; input?: string }> = [
    { args: ['assign-anchor', 'decision', 'obs_heartbeat'] },
    { args: ['retire-anchor', 'ADR-001', 'Retired'], input: '{"reason":"test"}' },
    { args: ['refresh-anchor', 'ADR-001'] },
    { args: ['rotate-observations'] },
    { args: ['put-observation', '--reinforce'], input: '{"id":"obs_heartbeat"}' },
    { args: ['list'] },
    { args: ['show', 'ADR-001'] },
    { args: ['claim-due'] },
  ];
  let dir: string;
  let paths: ClaimPaths;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-heartbeat-'));
    paths = claimPaths(dir);
    seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const { args, input } of LEARNING_OP_RUNS) {
    it(`${args[0]} refreshes an existing claim's mtime and leaves its bytes as they were`, () => {
      fs.writeFileSync(paths.claim, turns(0, 2));
      const started = Date.now();
      setMtime(paths.claim, started - STALE_MS + 60_000);
      expect(fs.statSync(paths.claim).mtimeMs, 'the claim starts out minutes old').toBeLessThan(started - 60_000);

      runJsonHelper(dir, args, input);

      expect(fs.statSync(paths.claim).mtimeMs).toBeGreaterThanOrEqual(started - 1000);
      expect(fs.readFileSync(paths.claim, 'utf8')).toBe(turns(0, 2));
    });
  }

  it('get-field leaves the claim\'s mtime alone', () => {
    fs.writeFileSync(paths.claim, turns(0, 2));
    const backdated = Date.now() - STALE_MS + 60_000;
    setMtime(paths.claim, backdated);
    expect(fs.statSync(paths.claim).mtimeMs, 'the claim starts out minutes old').toBeLessThan(Date.now() - 60_000);

    expect(runJsonHelper(dir, ['get-field', 'a'], '{"a":"b"}')).toMatchObject({ code: 0, stdout: 'b\n' });
    // A heartbeat would have moved it by minutes; utimes keeps it within float rounding.
    expect(Math.abs(fs.statSync(paths.claim).mtimeMs - backdated)).toBeLessThan(1000);
  });

  it('no learning op and no generic op creates a claim', () => {
    for (const { args, input } of [...LEARNING_OP_RUNS, { args: ['get-field', 'a'], input: '{"a":"b"}' }]) {
      runJsonHelper(dir, args, input);
      expect(fs.existsSync(paths.claim), `${args[0]} created no claim`).toBe(false);
    }
  });
});
