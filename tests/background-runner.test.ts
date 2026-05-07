import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  acquireBackgroundLock,
  releaseBackgroundLock,
  registerLockCleanup,
  checkDailyCap,
  incrementDailyCap,
  capEntries,
  encodeCwdForClaude,
  loadExistingObservations,
} from '../src/cli/utils/background-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bg-runner-test-'));
}

function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

/** Build a JSONL string with `n` lines (each containing a simple JSON object). */
function makeJsonl(n: number): string {
  return Array.from({ length: n }, (_, i) => JSON.stringify({ id: i })).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Lock acquisition
// ---------------------------------------------------------------------------

describe('acquireBackgroundLock', () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    lockDir = path.join(tmpDir, 'test.lock');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the lock directory on first acquisition', async () => {
    await acquireBackgroundLock(lockDir, 300, 5);
    expect(fs.existsSync(lockDir)).toBe(true);
    releaseBackgroundLock(lockDir);
  });

  it('times out when lock is held and not stale', async () => {
    // Create lock dir to simulate another process holding it.
    fs.mkdirSync(lockDir);
    // Very fresh mtime — not stale with a 300 s threshold.
    await expect(
      acquireBackgroundLock(lockDir, 300, 1 /* 1 s timeout */),
    ).rejects.toThrow('timeout');
    fs.rmdirSync(lockDir); // clean up held lock
  });

  it('breaks a stale lock and acquires', async () => {
    // Create a lock directory and backdate its mtime to be stale.
    fs.mkdirSync(lockDir);
    const staleTime = new Date(Date.now() - 400_000); // 400 s ago > 300 s threshold
    fs.utimesSync(lockDir, staleTime, staleTime);

    // Should succeed by breaking the stale lock.
    await acquireBackgroundLock(lockDir, 300, 5);
    expect(fs.existsSync(lockDir)).toBe(true);
    releaseBackgroundLock(lockDir);
  });

  it('does not break a lock within the stale threshold', async () => {
    // Create a lock directory with a very recent mtime.
    fs.mkdirSync(lockDir);

    // Should time out — the lock is fresh (not stale).
    await expect(
      acquireBackgroundLock(lockDir, 300, 1),
    ).rejects.toThrow('timeout');

    expect(fs.existsSync(lockDir)).toBe(true); // lock still held
    fs.rmdirSync(lockDir);
  });
});

// ---------------------------------------------------------------------------
// Lock release
// ---------------------------------------------------------------------------

describe('releaseBackgroundLock', () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    lockDir = path.join(tmpDir, 'test.lock');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the lock directory', async () => {
    await acquireBackgroundLock(lockDir, 300, 5);
    expect(fs.existsSync(lockDir)).toBe(true);
    releaseBackgroundLock(lockDir);
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('does not throw when lock directory does not exist (ENOENT)', () => {
    expect(() => releaseBackgroundLock(lockDir)).not.toThrow();
  });

  it('is safe to call twice (double-release)', async () => {
    await acquireBackgroundLock(lockDir, 300, 5);
    releaseBackgroundLock(lockDir);
    expect(() => releaseBackgroundLock(lockDir)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Signal handler registration / cleanup
// ---------------------------------------------------------------------------

describe('registerLockCleanup', () => {
  let tmpDir: string;
  let lockDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    lockDir = path.join(tmpDir, 'test.lock');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a cleanup function that removes handlers', () => {
    const listenerCountBefore = process.listenerCount('SIGTERM');
    const cleanup = registerLockCleanup(lockDir);
    expect(process.listenerCount('SIGTERM')).toBeGreaterThan(listenerCountBefore);
    cleanup();
    expect(process.listenerCount('SIGTERM')).toBe(listenerCountBefore);
  });

  it('registers SIGINT handler that is removed by cleanup', () => {
    const before = process.listenerCount('SIGINT');
    const cleanup = registerLockCleanup(lockDir);
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(before);
    cleanup();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('cleanup is idempotent — second call does not throw', () => {
    const cleanup = registerLockCleanup(lockDir);
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Daily cap check
// ---------------------------------------------------------------------------

describe('checkDailyCap', () => {
  let tmpDir: string;
  let capsFile: string;
  let today: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    capsFile = path.join(tmpDir, '.runs-today');
    today = new Date().toISOString().slice(0, 10);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true (under cap) when caps file does not exist', () => {
    expect(checkDailyCap(capsFile, 3)).toBe(true);
  });

  it('returns true when count is below the daily limit', () => {
    writeFile(capsFile, `${today}\t2\n`);
    expect(checkDailyCap(capsFile, 3)).toBe(true);
  });

  it('returns false when count equals the daily limit', () => {
    writeFile(capsFile, `${today}\t3\n`);
    expect(checkDailyCap(capsFile, 3)).toBe(false);
  });

  it('returns false when count exceeds the daily limit', () => {
    writeFile(capsFile, `${today}\t10\n`);
    expect(checkDailyCap(capsFile, 3)).toBe(false);
  });

  it('returns true when stored date is different from today (reset scenario)', () => {
    writeFile(capsFile, `1999-01-01\t99\n`);
    expect(checkDailyCap(capsFile, 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Daily cap increment
// ---------------------------------------------------------------------------

describe('incrementDailyCap', () => {
  let tmpDir: string;
  let capsFile: string;
  let today: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    capsFile = path.join(tmpDir, '.runs-today');
    today = new Date().toISOString().slice(0, 10);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the caps file with count 1 when it does not exist', () => {
    incrementDailyCap(capsFile);
    const content = fs.readFileSync(capsFile, 'utf-8').trim();
    const [date, count] = content.split('\t');
    expect(date).toBe(today);
    expect(count).toBe('1');
  });

  it('increments the count when date matches today', () => {
    writeFile(capsFile, `${today}\t2\n`);
    incrementDailyCap(capsFile);
    const content = fs.readFileSync(capsFile, 'utf-8').trim();
    const [date, count] = content.split('\t');
    expect(date).toBe(today);
    expect(count).toBe('3');
  });

  it('resets count to 1 when stored date is different from today', () => {
    writeFile(capsFile, `1999-01-01\t99\n`);
    incrementDailyCap(capsFile);
    const content = fs.readFileSync(capsFile, 'utf-8').trim();
    const [date, count] = content.split('\t');
    expect(date).toBe(today);
    expect(count).toBe('1');
  });

  it('writes atomically — tmp file is cleaned up', () => {
    incrementDailyCap(capsFile);
    expect(fs.existsSync(`${capsFile}.tmp`)).toBe(false);
    expect(fs.existsSync(capsFile)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CWD encoding
// ---------------------------------------------------------------------------

describe('encodeCwdForClaude', () => {
  it('encodes a simple absolute path', () => {
    expect(encodeCwdForClaude('/home/user/project')).toBe('-home-user-project');
  });

  it('handles paths with hyphens', () => {
    expect(encodeCwdForClaude('/home/user/my-project')).toBe('-home-user-my-project');
  });

  it('handles root path', () => {
    expect(encodeCwdForClaude('/')).toBe('-');
  });

  it('handles deeply nested paths', () => {
    expect(encodeCwdForClaude('/a/b/c/d')).toBe('-a-b-c-d');
  });
});

// ---------------------------------------------------------------------------
// capEntries / rotateLog
// ---------------------------------------------------------------------------

describe('capEntries', () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    logFile = path.join(tmpDir, 'test.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no-ops when file does not exist', () => {
    expect(() => capEntries(logFile, 100)).not.toThrow();
  });

  it('no-ops when line count is at the cap', () => {
    writeFile(logFile, makeJsonl(100));
    capEntries(logFile, 100);
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(100);
  });

  it('no-ops when line count is below the cap', () => {
    writeFile(logFile, makeJsonl(50));
    capEntries(logFile, 100);
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(50);
  });

  it('caps 150-line file to 100 lines (keeps last 100)', () => {
    writeFile(logFile, makeJsonl(150));
    capEntries(logFile, 100);
    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(100);
    // Last entry should be id: 149 (the most recent).
    const last = JSON.parse(lines[lines.length - 1]) as { id: number };
    expect(last.id).toBe(149);
    // First entry after cap should be id: 50 (150 - 100 = 50).
    const first = JSON.parse(lines[0]) as { id: number };
    expect(first.id).toBe(50);
  });

  it('writes atomically — tmp file is cleaned up', () => {
    writeFile(logFile, makeJsonl(150));
    capEntries(logFile, 100);
    expect(fs.existsSync(`${logFile}.tmp`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadExistingObservations
// ---------------------------------------------------------------------------

const NO_HELPER = '/nonexistent/json-helper.cjs';

describe('loadExistingObservations', () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    logFile = path.join(tmpDir, 'observations.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMockJsonHelper(tmpDir: string, output: string): string {
    const helperPath = path.join(tmpDir, 'mock-json-helper.cjs');
    fs.writeFileSync(
      helperPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'filter-observations') {
  process.stdout.write(${JSON.stringify(output)});
} else {
  process.exit(1);
}
`,
      { mode: 0o755 },
    );
    return helperPath;
  }

  it('uses primary json-helper path and filters by type', async () => {
    const entries = [
      { type: 'workflow', pattern: 'w1', status: 'observing' },
      { type: 'procedural', pattern: 'p1', status: 'observing' },
      { type: 'decision', pattern: 'd1', status: 'observing' },
    ];
    const helperPath = createMockJsonHelper(tmpDir, JSON.stringify(entries));

    const result = await loadExistingObservations(helperPath, logFile, ['workflow']);
    const parsed = JSON.parse(result) as Array<{ type: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('workflow');
  });

  it('falls back to direct JSONL parsing when json-helper path does not exist', async () => {
    const lines = [
      JSON.stringify({ type: 'workflow', pattern: 'w1', status: 'observing' }),
      JSON.stringify({ type: 'procedural', pattern: 'p1', status: 'observing' }),
    ].join('\n') + '\n';
    writeFile(logFile, lines);

    const result = await loadExistingObservations(NO_HELPER, logFile, ['workflow']);
    const parsed = JSON.parse(result) as Array<{ type: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('workflow');
  });

  it('fallback excludes entries with non-observing status', async () => {
    const lines = [
      JSON.stringify({ type: 'workflow', pattern: 'w1', status: 'observing' }),
      JSON.stringify({ type: 'workflow', pattern: 'w2', status: 'created' }),
      JSON.stringify({ type: 'workflow', pattern: 'w3', status: 'ready' }),
    ].join('\n') + '\n';
    writeFile(logFile, lines);

    const result = await loadExistingObservations(NO_HELPER, logFile, ['workflow']);
    const parsed = JSON.parse(result) as Array<{ pattern: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pattern).toBe('w1');
  });

  it('returns "[]" for empty log file', async () => {
    writeFile(logFile, '');

    const result = await loadExistingObservations(NO_HELPER, logFile, ['workflow']);
    expect(result).toBe('[]');
  });

  it('returns "[]" for missing log file', async () => {
    const result = await loadExistingObservations(NO_HELPER, path.join(tmpDir, 'missing.jsonl'), ['workflow']);
    expect(result).toBe('[]');
  });

  it('type filter correctly excludes non-matching types', async () => {
    const lines = [
      JSON.stringify({ type: 'workflow', pattern: 'w1', status: 'observing' }),
      JSON.stringify({ type: 'procedural', pattern: 'p1', status: 'observing' }),
      JSON.stringify({ type: 'decision', pattern: 'd1', status: 'observing' }),
    ].join('\n') + '\n';
    writeFile(logFile, lines);

    const result = await loadExistingObservations(NO_HELPER, logFile, ['decision']);
    const parsed = JSON.parse(result) as Array<{ type: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('decision');
  });

  it('silently skips malformed JSONL lines in fallback path', async () => {
    const lines = [
      JSON.stringify({ type: 'workflow', pattern: 'w1', status: 'observing' }),
      'this is not valid json {{{',
      JSON.stringify({ type: 'workflow', pattern: 'w2', status: 'observing' }),
    ].join('\n') + '\n';
    writeFile(logFile, lines);

    const result = await loadExistingObservations(NO_HELPER, logFile, ['workflow']);
    const parsed = JSON.parse(result) as Array<{ pattern: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].pattern).toBe('w1');
    expect(parsed[1].pattern).toBe('w2');
  });

  it('falls back when json-helper returns non-JSON output', async () => {
    const helperPath = createMockJsonHelper(tmpDir, 'this is garbage output');
    writeFile(logFile, JSON.stringify({ type: 'workflow', pattern: 'w1', status: 'observing' }) + '\n');

    const result = await loadExistingObservations(helperPath, logFile, ['workflow']);
    const parsed = JSON.parse(result) as Array<{ pattern: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].pattern).toBe('w1');
  });
});
