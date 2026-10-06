// tests/decisions/json-helper-stdin.test.ts
//
// json-helper reads its stdin from file descriptor 0, to EOF, through the one
// reader every op shares: the generic ops a hook falls back to without jq, and the
// learning ops. A node parent's 'pipe' hands the child a socket, which Linux will
// not reopen as /dev/stdin. Input that is not there yet when the helper first
// reads is waited for, on a non-blocking descriptor too. A learning op keeps its
// 64 KiB cap however its input arrives, and a generic op is not held to it.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import type { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GIT_ENV, JSON_HELPER, makeV2LogRow, seedLearningTree, type HelperRun } from './learning-fixtures.js';

/** How long the writer waits, once the helper has started, before its first chunk. */
const FIRST_CHUNK_DELAY_MS = 200;

/** How long the writer waits between chunks. */
const CHUNK_GAP_MS = 50;

/**
 * A run still going by then is killed, so a reader that never returns fails its
 * test rather than hanging it. It leaves room for the reader's 10 s of waits,
 * each of which a loaded machine stretches.
 */
const RUN_KILL_MS = 45_000;

let preloadDir: string;
let readyPreload: string;
let nonBlockingPreload: string;

beforeAll(() => {
  preloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-helper-stdin-preload-'));
  readyPreload = path.join(preloadDir, 'ready.cjs');
  nonBlockingPreload = path.join(preloadDir, 'non-blocking.cjs');
  // Descriptor 3 tells the test the helper is about to run, so no chunk is there before it starts.
  fs.writeFileSync(readyPreload, "'use strict';\nrequire('fs').writeSync(3, 'ready\\n');\n");
  // Opening process.stdin hands descriptor 0 to libuv, which leaves it non-blocking.
  fs.writeFileSync(nonBlockingPreload, "'use strict';\nvoid process.stdin;\n");
});

afterAll(() => {
  fs.rmSync(preloadDir, { recursive: true, force: true });
});

/** `text` cut into `count` pieces of near-equal length. */
function chunksOf(text: string, count: number): string[] {
  const size = Math.ceil(text.length / count);
  return Array.from({ length: count }, (_, i) => text.slice(i * size, (i + 1) * size));
}

/**
 * Run json-helper with a socket on stdin, as a node parent's 'pipe' hands it over,
 * and write `chunks` only once the helper runs: the first FIRST_CHUNK_DELAY_MS
 * after it signals it started, the rest CHUNK_GAP_MS apart, then end stdin. The
 * helper so reads before any input is there, and again between chunks. With
 * `nonBlocking`, descriptor 0 is non-blocking, so each such read fails with EAGAIN.
 * With no chunks, stdin is held open and is never written or ended.
 */
function runWithLateStdin(
  cwd: string,
  args: readonly string[],
  chunks: readonly string[],
  { nonBlocking = false }: { nonBlocking?: boolean } = {},
): Promise<HelperRun> {
  const preloads = nonBlocking ? [nonBlockingPreload, readyPreload] : [readyPreload];
  const child = spawn(process.execPath, [...preloads.flatMap(file => ['--require', file]), JSON_HELPER, ...args], {
    cwd,
    env: GIT_ENV,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let exited = false;
  const timers: NodeJS.Timeout[] = [];
  child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
  child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text; });
  // An op that stops reading at its cap may exit while a chunk is in flight; that
  // write then fails with EPIPE, and the run's exit and output are what is asserted.
  child.stdin.on('error', () => {});
  (child.stdio[3] as Readable).once('data', () => {
    chunks.forEach((chunk, i) => {
      timers.push(setTimeout(() => {
        if (exited) return;
        child.stdin.write(chunk);
        if (i === chunks.length - 1) child.stdin.end();
      }, FIRST_CHUNK_DELAY_MS + i * CHUNK_GAP_MS));
    });
  });
  return new Promise((resolve, reject) => {
    const killer = setTimeout(() => child.kill('SIGKILL'), RUN_KILL_MS);
    child.on('error', reject);
    child.on('exit', () => { exited = true; });
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      for (const timer of timers) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr: signal === null ? stderr : `${stderr}killed by ${signal}\n` });
    });
  });
}

/** Run json-helper with the open descriptor `fd` as its stdin. */
function runWithStdinFd(cwd: string, args: readonly string[], fd: number): HelperRun {
  const run = spawnSync(process.execPath, [JSON_HELPER, ...args], {
    cwd,
    env: GIT_ENV,
    stdio: [fd, 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.error) throw run.error;
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** One reinforce input of exactly `bytes` bytes: the object, then spaces JSON allows after it. */
function reinforceInputOf(bytes: number): string {
  const body = JSON.stringify({ id: 'obs_store_one' });
  return body + ' '.repeat(bytes - body.length);
}

describe('json-helper reads stdin from descriptor 0, to EOF (D-STDIN-FD0)', { timeout: 60_000 }, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'json-helper-stdin-')));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const nonBlocking of [false, true]) {
    const socket = nonBlocking ? 'a non-blocking socket' : 'a socket';

    it(`a generic op reads JSON that arrives late, in chunks, on ${socket}`, async () => {
      expect(await runWithLateStdin(dir, ['get-field', 'a'], ['{"a":', '"b"}'], { nonBlocking })).toEqual({
        code: 0, stdout: 'b\n', stderr: '',
      });
    });

    it(`a learning op reads exactly 64 KiB that arrives late, in chunks, on ${socket}`, async () => {
      seedLearningTree(dir, { log: [makeV2LogRow()] });
      expect(await runWithLateStdin(dir, ['put-observation', '--reinforce'], chunksOf(reinforceInputOf(65_536), 4), { nonBlocking })).toEqual({
        code: 0, stdout: 'reinforced obs_store_one 2\n', stderr: '',
      });
    });

    it(`a learning op still refuses one byte over 64 KiB that arrives late, in chunks, on ${socket}`, async () => {
      const paths = seedLearningTree(dir, { log: [makeV2LogRow()] });
      const logBefore = fs.readFileSync(paths.log, 'utf8');
      expect(await runWithLateStdin(dir, ['put-observation', '--reinforce'], chunksOf(reinforceInputOf(65_537), 4), { nonBlocking })).toEqual({
        code: 1, stdout: '', stderr: 'put-observation: stdin holds more than 65536 bytes; it must hold one JSON object\n',
      });
      expect(fs.readFileSync(paths.log, 'utf8')).toBe(logBefore);
    });
  }

  it('a generic op is not held to the learning cap: it reads 256 KiB that arrives in chunks', async () => {
    // A hook's input — a Stop hook's last assistant message — can pass 64 KiB.
    const input = JSON.stringify({ cwd: '/tmp', last_assistant_message: 'm'.repeat(256 * 1024) });
    expect(await runWithLateStdin(dir, ['get-field', 'cwd'], chunksOf(input, 8))).toEqual({
      code: 0, stdout: '/tmp\n', stderr: '',
    });
  });

  it('a non-blocking stdin that never ends is refused once 10 s of waiting for input run out', async () => {
    const paths = seedLearningTree(dir, { log: [makeV2LogRow()] });
    const logBefore = fs.readFileSync(paths.log, 'utf8');
    expect(await runWithLateStdin(dir, ['put-observation', '--reinforce'], [], { nonBlocking: true })).toEqual({
      code: 1,
      stdout: '',
      stderr: 'put-observation: stdin could not be read: it had not ended after 10000 ms of waiting for input\n',
    });
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(logBefore);
  });

  it('a read that fails is refused, not thrown: a learning op names the error', () => {
    const paths = seedLearningTree(dir, { log: [makeV2LogRow()] });
    const logBefore = fs.readFileSync(paths.log, 'utf8');
    // A directory opens for reading, and every read of it fails with EISDIR.
    const fd = fs.openSync(dir, 'r');
    try {
      const run = runWithStdinFd(dir, ['put-observation', '--reinforce'], fd);
      expect(run.code, run.stderr).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/^put-observation: stdin could not be read: EISDIR\b.*\n$/);
    } finally {
      fs.closeSync(fd);
    }
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(logBefore);
  });
});
