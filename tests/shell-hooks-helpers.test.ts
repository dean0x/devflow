/**
 * The stdin-EPIPE race in the hook harness, pinned deterministically.
 *
 * A hook guard (DEVFLOW_BG_UPDATER=1, for one) may exit 0 before it reads stdin.
 * When that exit beats Node's write of `input`, the write fails with EPIPE and
 * `execSync` throws — although the child did exactly what the test asserts. On
 * a JSON event of a few hundred bytes that is a timing race (release CI run
 * 36301721937). Here the input is 8 MiB: far past any pipe buffer, so a child
 * that never reads stdin ALWAYS leaves the parent's write to fail with EPIPE,
 * and every case below is decided by the rule, never by scheduling.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classifyStdinRun, execHook, runHook, spawnWithStdin } from './shell-hooks-helpers.js';

/** Several MiB: larger than any pipe buffer, so an unread write cannot complete. */
const BIG = 'x'.repeat(8 * 1024 * 1024);

let dir: string;
/** Exits 0 without reading stdin, after writing to both streams. */
let exitsCleanEarly: string;
/** Exits 3 without reading stdin: a genuinely failing child. */
let failsEarly: string;
/** Reads all of stdin, then reports how many bytes arrived. */
let readsAll: string;

function script(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-stdin-epipe-'));
  exitsCleanEarly = script('exits-clean-early', 'echo early-out\necho early-err >&2\nexit 0');
  failsEarly = script('fails-early', 'echo fail-out\necho fail-err >&2\nexit 3');
  readsAll = script('reads-all', 'wc -c | tr -d " "');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the race the helper exists for', () => {
  it('execSync throws EPIPE although the child exited 0 (the old pattern)', () => {
    let thrown: unknown;
    try {
      execSync(`bash "${exitsCleanEarly}"`, { input: BIG, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      thrown = e;
    }
    const err = thrown as { code?: string; status?: number | null; signal?: string | null };
    expect(err, 'execSync must throw on the unread 8 MiB write').toBeDefined();
    expect(err.code).toBe('EPIPE');
    // The child itself succeeded: the throw is about the stdin write alone.
    expect(err.status).toBe(0);
    expect(err.signal).toBeNull();
  });
});

describe('spawnWithStdin', () => {
  it('reports a clean exit, with both streams, when the child exits 0 before reading stdin', () => {
    const run = spawnWithStdin('bash', [exitsCleanEarly], { input: BIG });
    expect(run).toEqual({
      kind: 'clean',
      stdout: 'early-out\n',
      stderr: 'early-err\n',
      status: 0,
      signal: null,
      stdinEpipe: true,
    });
  });

  it('reports a non-zero exit as a failure, even when that child also left stdin unread', () => {
    const run = spawnWithStdin('bash', [failsEarly], { input: BIG });
    expect(run).toEqual({
      kind: 'failed',
      stdout: 'fail-out\n',
      stderr: 'fail-err\n',
      status: 3,
      signal: null,
      stdinEpipe: true,
    });
  });

  it('delivers the whole input to a child that reads it (no EPIPE on the normal path)', () => {
    const run = spawnWithStdin('bash', [readsAll], { input: BIG });
    expect(run.kind).toBe('clean');
    expect(run.stdinEpipe).toBe(false);
    expect(run.stdout.trim()).toBe(String(BIG.length));
  });

  it('throws a harness failure that is not the child exiting: a missing executable', () => {
    expect(() => spawnWithStdin(path.join(dir, 'no-such-binary'), [], { input: 'x' })).toThrow(/ENOENT/);
  });

  it('throws a harness failure that is not the child exiting: a timeout', () => {
    expect(() => spawnWithStdin('bash', ['-c', 'sleep 5'], { input: 'x', timeout: 100 })).toThrow(/ETIMEDOUT/);
  });
});

describe('execHook — execSync semantics minus the race', () => {
  it('returns stdout when the hook exits 0 before reading stdin', () => {
    expect(execHook(exitsCleanEarly, BIG)).toBe('early-out\n');
  });

  it('throws, naming the exit status and stderr, when the hook exits non-zero', () => {
    expect(() => execHook(failsEarly, BIG)).toThrow(/status 3[\s\S]*fail-err/);
  });
});

describe('runHook — exit code as a value, unchanged by the race', () => {
  const bigEvent = { payload: BIG };

  it('reports exit 0 and stdout when the hook exits 0 before reading stdin', () => {
    expect(runHook(exitsCleanEarly, bigEvent, dir)).toEqual({ stdout: 'early-out\n', stderr: '', exitCode: 0 });
  });

  it('reports the real non-zero exit, with stdout and stderr, when the hook fails before reading stdin', () => {
    expect(runHook(failsEarly, bigEvent, dir)).toEqual({ stdout: 'fail-out\n', stderr: 'fail-err\n', exitCode: 3 });
  });
});

describe('classifyStdinRun — the rule, on every shape', () => {
  const epipe = Object.assign(new Error('spawnSync bash EPIPE'), { code: 'EPIPE' });
  const base = { stdout: 'o', stderr: 'e' };

  it('EPIPE with status 0 and no signal is benign: clean', () => {
    expect(classifyStdinRun({ ...base, error: epipe, status: 0, signal: null }).kind).toBe('clean');
  });

  it('EPIPE with a non-zero status is a failure', () => {
    expect(classifyStdinRun({ ...base, error: epipe, status: 1, signal: null }).kind).toBe('failed');
  });

  it('EPIPE with a signal is a failure, even though no status was recorded', () => {
    expect(classifyStdinRun({ ...base, error: epipe, status: null, signal: 'SIGTERM' }).kind).toBe('failed');
  });

  it('a signal without any spawn error is a failure', () => {
    expect(classifyStdinRun({ ...base, status: null, signal: 'SIGKILL' }).kind).toBe('failed');
  });

  it('any other spawn error is a harness error, whatever the status', () => {
    const enoent = Object.assign(new Error('spawnSync x ENOENT'), { code: 'ENOENT' });
    const verdict = classifyStdinRun({ ...base, error: enoent, status: 0, signal: null });
    expect(verdict).toEqual({ kind: 'harness-error', error: enoent });
  });

  it('no error, status 0, no signal: clean, and no EPIPE recorded', () => {
    expect(classifyStdinRun({ ...base, status: 0, signal: null })).toEqual({
      kind: 'clean', stdout: 'o', stderr: 'e', status: 0, signal: null, stdinEpipe: false,
    });
  });
});
