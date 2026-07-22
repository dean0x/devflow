/**
 * tests/queue-append.test.ts
 *
 * Tests for src/assets/scripts/hooks/queue-append — the shared dual-queue-append helper
 * used by capture-prompt, capture-turn, and capture-question.
 *
 * Harness note: queue_append_row/queue_append_both/queue_read_gates are bash
 * functions (sourced, not standalone executables), so each test sources
 * json-parse -> get-mtime -> learning-lock -> queue-append and then calls the
 * function(s) under test via a small inline bash script executed with `bash -c`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');
const QUEUE_APPEND = path.join(HOOKS_DIR, 'queue-append');

/** Source the full dependency chain queue-append needs, then run `script`. */
function runWithQueueAppend(script: string): { stdout: string; stderr: string; exitCode: number } {
  const full = `
set -e
log() { :; }
dbg() { :; }
source "${path.join(HOOKS_DIR, 'json-parse')}"
source "${path.join(HOOKS_DIR, 'get-mtime')}"
source "${path.join(HOOKS_DIR, 'learning-lock')}"
source "${QUEUE_APPEND}"
${script}
`;
  try {
    const result = execSync(`bash -c '${full.replace(/'/g, "'\\''")}'`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout: result.toString(), stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return { stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? '', exitCode: err.status ?? 1 };
  }
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('shell hook syntax: queue-append passes bash -n', () => {
  it('bash -n succeeds', () => {
    expect(() => {
      execSync(`bash -n "${QUEUE_APPEND}"`, { stdio: 'pipe' });
    }).not.toThrow();
  });
});

describe('queue_append_row', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-row-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the queue file with mode 0600 on first write', () => {
    const q = path.join(tmpDir, 'q.jsonl');
    runWithQueueAppend(`queue_append_row "${q}" "user" "hello" "1000000000"`);
    expect(fs.existsSync(q)).toBe(true);
    const mode = fs.statSync(q).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('appends a valid {role, content, ts} JSON row', () => {
    const q = path.join(tmpDir, 'q.jsonl');
    runWithQueueAppend(`queue_append_row "${q}" "assistant" "hi there" "1234"`);
    const rows = readJsonl(q);
    expect(rows).toEqual([{ role: 'assistant', content: 'hi there', ts: 1234 }]);
  });

  it('appends multiple rows without truncating existing content', () => {
    const q = path.join(tmpDir, 'q.jsonl');
    runWithQueueAppend(`
      queue_append_row "${q}" "user" "one" "1"
      queue_append_row "${q}" "assistant" "two" "2"
    `);
    const rows = readJsonl(q);
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe('one');
    expect(rows[1].content).toBe('two');
  });

  describe('escaping fuzz (quotes, newlines, command substitution, unicode)', () => {
    const cases: Array<{ name: string; content: string }> = [
      { name: 'double quotes', content: 'she said "hello" to me' },
      { name: 'single quotes', content: "it's a test" },
      { name: 'newlines', content: 'line one\nline two\nline three' },
      { name: 'command substitution syntax', content: 'run $(rm -rf /) or `echo pwned`' },
      { name: 'unicode', content: 'café 日本語 \u{1f600}' },
      { name: 'backslashes', content: 'C:\\Users\\test\\path' },
      { name: 'mixed', content: '"$(nested \'quotes\')" \n with \\backslash and émoji \u{1f600}' },
    ];

    for (const { name, content } of cases) {
      it(`round-trips ${name} exactly`, () => {
        const q = path.join(tmpDir, 'q.jsonl');
        const tmpContentFile = path.join(tmpDir, 'content.txt');
        fs.writeFileSync(tmpContentFile, content);
        // Pass content via a file + command substitution to avoid the TEST
        // harness's own shell-escaping concerns; queue_append_row itself
        // receives it as a plain positional argument, exactly like a real
        // hook would pass $PROMPT/$ASSISTANT_MSG.
        const { exitCode } = runWithQueueAppend(`
          CONTENT="$(cat "${tmpContentFile}")"
          queue_append_row "${q}" "user" "$CONTENT" "1"
        `);
        expect(exitCode).toBe(0);
        const rows = readJsonl(q);
        expect(rows).toHaveLength(1);
        expect(rows[0].content).toBe(content);
      });
    }
  });

  describe('overflow: 200 -> 100 truncation under lock', () => {
    it('truncates to newest 100 lines once the file exceeds 200', () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const lines: string[] = [];
      for (let i = 0; i < 205; i++) {
        lines.push(JSON.stringify({ role: 'user', content: `line-${i}`, ts: i }));
      }
      fs.writeFileSync(q, lines.join('\n') + '\n');

      runWithQueueAppend(`queue_append_row "${q}" "user" "final-row" "9999"`);

      // 205 pre-seeded + 1 appended = 206 transiently, then truncated to the
      // newest 100 (which includes the just-appended row, since it's newest).
      const rows = readJsonl(q);
      expect(rows).toHaveLength(100);
      expect(rows[rows.length - 1].content).toBe('final-row');
      // Oldest surviving row should be from near the tail of the original 205
      expect((rows[0].content as string).startsWith('line-')).toBe(true);
    });

    it('does not truncate when the file is at or below 200 lines', () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const lines: string[] = [];
      for (let i = 0; i < 150; i++) {
        lines.push(JSON.stringify({ role: 'user', content: `line-${i}`, ts: i }));
      }
      fs.writeFileSync(q, lines.join('\n') + '\n');

      runWithQueueAppend(`queue_append_row "${q}" "user" "extra" "9999"`);

      const rows = readJsonl(q);
      expect(rows).toHaveLength(151);
    });

    it('no lock directory left behind after truncation', () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const lines: string[] = [];
      for (let i = 0; i < 205; i++) lines.push(JSON.stringify({ role: 'user', content: `l${i}`, ts: i }));
      fs.writeFileSync(q, lines.join('\n') + '\n');

      runWithQueueAppend(`queue_append_row "${q}" "user" "x" "1"`);

      expect(fs.existsSync(`${q}.lock`)).toBe(false);
    });
  });

  describe('degraded no-jq path (node fallback)', () => {
    it('still produces valid JSONL when _HAS_JQ is forced false', () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const { exitCode } = runWithQueueAppend(`
        _HAS_JQ=false
        queue_append_row "${q}" "user" "no jq here: \\"quoted\\"" "42"
      `);
      expect(exitCode).toBe(0);
      const rows = readJsonl(q);
      expect(rows).toEqual([{ role: 'user', content: 'no jq here: "quoted"', ts: 42 }]);
    });
  });

  describe('20-parallel-append interleave (no corruption)', () => {
    it('20 concurrent appends to the SAME queue file all survive as valid JSON lines', async () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const N = 20;
      const scriptPath = path.join(tmpDir, 'append-one.sh');
      fs.writeFileSync(
        scriptPath,
        `#!/bin/bash
set -e
log() { :; }
dbg() { :; }
source "${path.join(HOOKS_DIR, 'json-parse')}"
source "${path.join(HOOKS_DIR, 'get-mtime')}"
source "${path.join(HOOKS_DIR, 'learning-lock')}"
source "${QUEUE_APPEND}"
queue_append_row "$1" "user" "row-$2" "$2"
`,
      );
      fs.chmodSync(scriptPath, 0o755);

      const { spawn } = await import('child_process');
      const runs = Array.from({ length: N }, (_, i) => {
        return new Promise<number | null>((resolve) => {
          const proc = spawn('bash', [scriptPath, q, String(i)], { stdio: 'ignore' });
          proc.on('close', (code) => resolve(code));
        });
      });
      const codes = await Promise.all(runs);
      for (const c of codes) expect(c).toBe(0);

      const rows = readJsonl(q);
      // Every line must be valid, parseable JSON (readJsonl would throw otherwise)
      // and all N distinct row identifiers must be present exactly once.
      expect(rows).toHaveLength(N);
      const contents = new Set(rows.map((r) => r.content));
      expect(contents.size).toBe(N);
      for (let i = 0; i < N; i++) {
        expect(contents.has(`row-${i}`)).toBe(true);
      }
    }, 15000);
  });

  describe('truncate-vs-append race', () => {
    // ACCEPTED RISK (documented in the design): the truncate path is
    // read-then-replace (`tail -100 file > tmp && mv tmp file`), not an
    // in-place lock-held write. A concurrent lock-free append landing on the
    // original file AFTER the `tail` snapshot but BEFORE the `mv` replaces it
    // can be silently dropped by the replace — the same class of race the
    // pre-existing dream-capture/dream-dispatch queue-overflow logic already
    // has (this helper extracts, not changes, that behavior). The guarantee
    // this test actually pins is NO CORRUPTION (every surviving line remains
    // valid, parseable JSON) — not zero data loss under a genuine race.
    it('races a truncation without ever corrupting the file (parseable JSONL, sane length)', async () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const lines: string[] = [];
      for (let i = 0; i < 205; i++) lines.push(JSON.stringify({ role: 'user', content: `seed-${i}`, ts: i }));
      fs.writeFileSync(q, lines.join('\n') + '\n');

      const scriptPath = path.join(tmpDir, 'append-race.sh');
      fs.writeFileSync(
        scriptPath,
        `#!/bin/bash
set -e
log() { :; }
dbg() { :; }
source "${path.join(HOOKS_DIR, 'json-parse')}"
source "${path.join(HOOKS_DIR, 'get-mtime')}"
source "${path.join(HOOKS_DIR, 'learning-lock')}"
source "${QUEUE_APPEND}"
queue_append_row "$1" "user" "race-$2" "$2"
`,
      );
      fs.chmodSync(scriptPath, 0o755);

      const { spawn } = await import('child_process');
      const runs = [0, 1, 2].map((i) => {
        return new Promise<number | null>((resolve) => {
          const proc = spawn('bash', [scriptPath, q, String(i)], { stdio: 'ignore' });
          proc.on('close', (code) => resolve(code));
        });
      });
      const codes = await Promise.all(runs);
      for (const c of codes) expect(c).toBe(0);

      // No corruption: readJsonl throws on any malformed line, so reaching
      // this point at all already proves every surviving line is valid JSON.
      const rows = readJsonl(q);
      // Sane length: truncation keeps the newest 100 plus whatever raced in
      // after the last truncate pass — never near-zero, never wildly over.
      expect(rows.length).toBeGreaterThanOrEqual(100);
      expect(rows.length).toBeLessThanOrEqual(103);

      // Best-effort (not guaranteed under the accepted race): most or all of
      // the 3 racing rows typically survive — assert at least one did, so a
      // total-loss regression (e.g. a bug that drops ALL concurrent appends)
      // would still be caught.
      const contents = new Set(rows.map((r) => r.content));
      const survived = ['race-0', 'race-1', 'race-2'].filter((r) => contents.has(r));
      expect(survived.length).toBeGreaterThanOrEqual(1);
    }, 15000);
  });
});

describe('queue_append_both', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-both-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes to both queues when both flags are true', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${mem}" "${learning}" "true" "true" "user" "hi" "1"`);
    expect(readJsonl(mem)).toHaveLength(1);
    expect(readJsonl(learning)).toHaveLength(1);
  });

  it('writes only to the memory queue when learning_enabled is false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${mem}" "${learning}" "true" "false" "user" "hi" "1"`);
    expect(readJsonl(mem)).toHaveLength(1);
    expect(fs.existsSync(learning)).toBe(false);
  });

  it('writes only to the learning queue when memory_enabled is false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${mem}" "${learning}" "false" "true" "user" "hi" "1"`);
    expect(fs.existsSync(mem)).toBe(false);
    expect(readJsonl(learning)).toHaveLength(1);
  });

  it('writes to neither queue when both flags are false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${mem}" "${learning}" "false" "false" "user" "hi" "1"`);
    expect(fs.existsSync(mem)).toBe(false);
    expect(fs.existsSync(learning)).toBe(false);
  });
});

describe('queue_read_gates', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-read-gates-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readGates(config: Record<string, unknown> | null): { memory: string; learning: string; exitCode: number } {
    const configPath = path.join(tmpDir, 'config.json');
    if (config !== null) fs.writeFileSync(configPath, JSON.stringify(config));

    const { stdout, exitCode } = runWithQueueAppend(`
      queue_read_gates "${configPath}"
      echo "MEMORY=$_QG_MEMORY"
      echo "LEARNING=$_QG_LEARNING"
    `);
    const memMatch = stdout.match(/MEMORY=(\S*)/);
    const learnMatch = stdout.match(/LEARNING=(\S*)/);
    return { memory: memMatch?.[1] ?? '', learning: learnMatch?.[1] ?? '', exitCode };
  }

  it('both default to true when config is missing', () => {
    const r = readGates(null);
    expect(r).toMatchObject({ memory: 'true', learning: 'true', exitCode: 0 });
  });

  it('reads both explicit fields in one pass', () => {
    const r = readGates({ memory: true, learning: false });
    expect(r).toMatchObject({ memory: 'true', learning: 'false' });
  });

  it('memory:false, learning field absent -> memory false, learning defaults true', () => {
    const r = readGates({ memory: false });
    expect(r).toMatchObject({ memory: 'false', learning: 'true' });
  });

  it('never exits non-zero (set -e safety)', () => {
    // Regression guard: queue_read_gates's exit status must never leak the
    // truthiness of its last internal test into a `set -e` caller that
    // invokes it as a plain statement.
    const r = readGates({});
    expect(r.exitCode).toBe(0);
  });
});
