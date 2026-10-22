/**
 * tests/queue-append.test.ts
 *
 * Tests for src/assets/scripts/hooks/queue-append — the shared dual-queue-append helper
 * used by capture-prompt, capture-turn, and capture-question.
 *
 * Harness note: queue_append_row/queue_append_both/queue_read_gates are bash
 * functions (sourced, not standalone executables), so each test sources
 * json-parse -> get-mtime -> curation-lock -> queue-append and then calls the
 * function(s) under test via a small inline bash script executed with `bash -c`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SETTINGS_SWITCH_TABLE, type SwitchRow } from './fixtures/settings-switch-table.js';
import { useWarmFakeExecutables } from './helpers/warm-fake-executable.js';
import {
  FIFO_RUN_BOUND_MS,
  FIFO_TEST_TIMEOUT_MS,
  HOOK_RUN_ALLOWANCE_MS,
  NODE_EXEC_STALL_MS,
  makeFifo,
  releaseFifo,
  resolveOnPath,
  spawnWithStdin,
} from './shell-hooks-helpers.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');
const QUEUE_APPEND = path.join(HOOKS_DIR, 'queue-append');

/** A bash script that sources the full dependency chain queue-append needs, then runs `script`. */
function withQueueAppend(script: string): string {
  return `
set -e
log() { :; }
dbg() { :; }
source "${path.join(HOOKS_DIR, 'json-parse')}"
source "${path.join(HOOKS_DIR, 'get-mtime')}"
source "${path.join(HOOKS_DIR, 'curation-lock')}"
source "${QUEUE_APPEND}"
${script}
`;
}

/** Source the full dependency chain queue-append needs, then run `script`. */
function runWithQueueAppend(script: string, env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; exitCode: number } {
  const full = withQueueAppend(script);
  try {
    const result = execSync(`bash -c '${full.replace(/'/g, "'\\''")}'`, { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env });
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
    runWithQueueAppend(`queue_append_row "${tmpDir}" "${q}" "user" "hello" "1000000000"`);
    expect(fs.existsSync(q)).toBe(true);
    const mode = fs.statSync(q).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('appends a valid {role, content, ts} JSON row', () => {
    const q = path.join(tmpDir, 'q.jsonl');
    runWithQueueAppend(`queue_append_row "${tmpDir}" "${q}" "assistant" "hi there" "1234"`);
    const rows = readJsonl(q);
    expect(rows).toEqual([{ role: 'assistant', content: 'hi there', ts: 1234 }]);
  });

  it('appends multiple rows without truncating existing content', () => {
    const q = path.join(tmpDir, 'q.jsonl');
    runWithQueueAppend(`
      queue_append_row "${tmpDir}" "${q}" "user" "one" "1"
      queue_append_row "${tmpDir}" "${q}" "assistant" "two" "2"
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
          queue_append_row "${tmpDir}" "${q}" "user" "$CONTENT" "1"
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

      runWithQueueAppend(`queue_append_row "${tmpDir}" "${q}" "user" "final-row" "9999"`);

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

      runWithQueueAppend(`queue_append_row "${tmpDir}" "${q}" "user" "extra" "9999"`);

      const rows = readJsonl(q);
      expect(rows).toHaveLength(151);
    });

    it('no lock directory left behind after truncation', () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const lines: string[] = [];
      for (let i = 0; i < 205; i++) lines.push(JSON.stringify({ role: 'user', content: `l${i}`, ts: i }));
      fs.writeFileSync(q, lines.join('\n') + '\n');

      runWithQueueAppend(`queue_append_row "${tmpDir}" "${q}" "user" "x" "1"`);

      expect(fs.existsSync(`${q}.lock`)).toBe(false);
    });

    it('keeps the memory and the curation queue at mode 0600 through the trim, whatever the caller umask', () => {
      // A queue holds captured conversation text, so it is created 0600. The trim
      // replaces it with a renamed copy, and from then on the file has the copy's
      // mode. Both queues take this path (queue_append_both -> queue_append_row),
      // and a hook runs under its parent's umask, typically 022.
      const mem = path.join(tmpDir, 'mem.jsonl');
      const curation = path.join(tmpDir, 'curation.jsonl');
      const modeOf = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8);
      const rowsOf = (file: string): number => readJsonl(file).length;
      const append = (content: string, ts: number): void => {
        const { exitCode, stderr } = runWithQueueAppend(`
          umask 022
          queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${curation}" "true" "true" "user" "${content}" "${ts}"
        `);
        expect(exitCode, stderr).toBe(0);
      };

      // The helper creates both files; rows 2..200 are appended directly, which
      // keeps the mode, so the precondition is a helper-made 0600 file at the cap.
      append('row-1', 1);
      const rest = Array.from({ length: 199 }, (_, i) =>
        JSON.stringify({ role: 'user', content: `row-${i + 2}`, ts: i + 2 }) + '\n').join('');
      for (const q of [mem, curation]) {
        fs.appendFileSync(q, rest);
        expect(rowsOf(q), `${path.basename(q)} must sit at the cap before the trim`).toBe(200);
        expect(modeOf(q), `${path.basename(q)} must start at 0600`).toBe('600');
      }

      append('row-201', 201);

      for (const q of [mem, curation]) {
        const rows = readJsonl(q);
        expect(rows, `${path.basename(q)} must have been trimmed`).toHaveLength(100);
        expect(rows[rows.length - 1].content).toBe('row-201');
        expect(modeOf(q), `${path.basename(q)} must keep 0600 after the trim`).toBe('600');
      }
      expect(fs.readdirSync(tmpDir).sort(), 'no temporary copy or lock is left behind').toEqual(['curation.jsonl', 'mem.jsonl']);
    });
  });

  describe('degraded no-jq path (node fallback)', () => {
    it('still produces valid JSONL when _HAS_JQ is forced false', () => {
      const q = path.join(tmpDir, 'q.jsonl');
      const { exitCode } = runWithQueueAppend(`
        _HAS_JQ=false
        queue_append_row "${tmpDir}" "${q}" "user" "no jq here: \\"quoted\\"" "42"
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
source "${path.join(HOOKS_DIR, 'curation-lock')}"
source "${QUEUE_APPEND}"
queue_append_row "$1" "$2" "user" "row-$3" "$3"
`,
      );
      fs.chmodSync(scriptPath, 0o755);

      const { spawn } = await import('child_process');
      const runs = Array.from({ length: N }, (_, i) => {
        return new Promise<number | null>((resolve) => {
          const proc = spawn('bash', [scriptPath, tmpDir, q, String(i)], { stdio: 'ignore' });
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
source "${path.join(HOOKS_DIR, 'curation-lock')}"
source "${QUEUE_APPEND}"
queue_append_row "$1" "$2" "user" "race-$3" "$3"
`,
      );
      fs.chmodSync(scriptPath, 0o755);

      const { spawn } = await import('child_process');
      const runs = [0, 1, 2].map((i) => {
        return new Promise<number | null>((resolve) => {
          const proc = spawn('bash', [scriptPath, tmpDir, q, String(i)], { stdio: 'ignore' });
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
    const curation = path.join(tmpDir, 'curation.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${curation}" "true" "true" "user" "hi" "1"`);
    expect(readJsonl(mem)).toHaveLength(1);
    expect(readJsonl(curation)).toHaveLength(1);
  });

  it('writes only to the memory queue when curation_enabled is false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const curation = path.join(tmpDir, 'curation.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${curation}" "true" "false" "user" "hi" "1"`);
    expect(readJsonl(mem)).toHaveLength(1);
    expect(fs.existsSync(curation)).toBe(false);
  });

  it('writes only to the curation queue when memory_enabled is false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const curation = path.join(tmpDir, 'curation.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${curation}" "false" "true" "user" "hi" "1"`);
    expect(fs.existsSync(mem)).toBe(false);
    expect(readJsonl(curation)).toHaveLength(1);
  });

  it('writes to neither queue when both flags are false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const curation = path.join(tmpDir, 'curation.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${curation}" "false" "false" "user" "hi" "1"`);
    expect(fs.existsSync(mem)).toBe(false);
    expect(fs.existsSync(curation)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// One capture hook makes both appends in one process. The queue files are 0600
// whatever the caller umask, and that umask is not changed for the rest of the
// hook, so a folder the second append makes has the mode the caller's umask gives.
// The row is built once, however many queues take it.
// ---------------------------------------------------------------------------

describe('queue_append_both: one row build, and the caller umask kept', () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let tmpDir: string;
  let root: string;
  let memory: string;
  let curation: string;
  let forkLog: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-umask-'));
    root = path.join(tmpDir, 'repo');
    memory = path.join(root, '.devflow', 'memory', '.pending-turns.jsonl');
    curation = path.join(root, '.devflow', 'curation', '.pending-turns.jsonl');
    forkLog = path.join(tmpDir, 'forks.log');
    const shimDir = path.join(tmpDir, 'shim');
    fs.mkdirSync(root);
    fs.mkdirSync(shimDir);
    for (const name of ['node', 'jq']) {
      const real = resolveOnPath(name, process.env.PATH ?? '/usr/bin:/bin');
      if (real === undefined) continue;
      writeFakeExecutable(path.join(shimDir, name), `#!/bin/bash\necho ${name} >> "${forkLog}"\nexec "${real}" "$@"\n`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const shimEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${path.join(tmpDir, 'shim')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  });
  const forks = (): string[] => (fs.existsSync(forkLog) ? fs.readFileSync(forkLog, 'utf-8').trim().split('\n').filter(Boolean) : []);
  const modeOf = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8);
  /** Both appends in one process, then the umask the process ends with. */
  const both = (setup: string, flags = '"true" "true"', env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; exitCode: number } =>
    runWithQueueAppend(
      `${setup}\nqueue_append_both "${root}" "${memory}" "${root}" "${curation}" ${flags} "user" "we chose X over Y" "5"\numask`,
      env,
    );

  it('memory then curation in one process: the curation folder gets the mode of a mkdir under the caller umask, and both queues are 0600', () => {
    const { exitCode, stderr } = both('umask 022');

    expect(exitCode, stderr).toBe(0);
    expect(modeOf(path.join(root, '.devflow', 'curation')), 'the curation folder').toBe('755');
    expect(modeOf(path.join(root, '.devflow', 'memory')), 'the memory folder').toBe('755');
    expect(modeOf(memory)).toBe('600');
    expect(modeOf(curation)).toBe('600');
  });

  it('a stricter caller umask is the one the folders take, and the queues stay 0600', () => {
    const { exitCode, stderr } = both('umask 027');

    expect(exitCode, stderr).toBe(0);
    expect(modeOf(path.join(root, '.devflow', 'curation'))).toBe('750');
    expect(modeOf(memory)).toBe('600');
    expect(modeOf(curation)).toBe('600');
  });

  it('the caller umask is back when the call returns', () => {
    for (const mask of ['022', '027']) {
      const { exitCode, stderr, stdout } = both(`umask ${mask}`);

      expect(exitCode, stderr).toBe(0);
      expect(stdout.trim(), `umask ${mask}`).toBe(`0${mask}`);
      fs.rmSync(path.join(root, '.devflow'), { recursive: true, force: true });
    }
  });

  it('two single appends keep the caller umask too: the second folder is made under it', () => {
    const { exitCode, stderr, stdout } = runWithQueueAppend(`
      umask 022
      queue_append_row "${root}" "${memory}" "user" "one" "1"
      queue_append_row "${root}" "${curation}" "user" "two" "2"
      umask
    `);

    expect(exitCode, stderr).toBe(0);
    expect(stdout.trim()).toBe('0022');
    expect(modeOf(path.join(root, '.devflow', 'curation'))).toBe('755');
    expect(modeOf(curation)).toBe('600');
  });

  for (const backend of [{ name: 'jq', noJq: false, tool: 'jq' }, { name: 'node fallback', noJq: true, tool: 'node' }]) {
    describe(`${backend.name} backend`, () => {
      const setup = backend.noJq ? '_HAS_JQ=false' : '';

      it('both queues on: both get the identical line, and the row is built by one process', () => {
        const { exitCode, stderr } = both(setup, '"true" "true"', shimEnv());

        expect(exitCode, stderr).toBe(0);
        const memoryText = fs.readFileSync(memory, 'utf-8');
        expect(memoryText).toBe(fs.readFileSync(curation, 'utf-8'));
        expect(memoryText.split('\n')).toHaveLength(2);
        expect(JSON.parse(memoryText)).toEqual({ role: 'user', content: 'we chose X over Y', ts: 5 });
        expect(forks()).toEqual([backend.tool]);
      });

      it('one queue on: one build; neither on: no build and no file', () => {
        expect(both(setup, '"false" "true"', shimEnv()).exitCode).toBe(0);
        expect(forks()).toEqual([backend.tool]);
        expect(fs.existsSync(memory)).toBe(false);

        fs.rmSync(forkLog, { force: true });
        expect(both(setup, '"false" "false"', shimEnv()).exitCode).toBe(0);
        expect(forks()).toEqual([]);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// D-HOOKS-NO-SYMLINK (git-marker): a queue under a project's .devflow/ is
// appended only when neither it nor a folder between its root and it is a link.
// ---------------------------------------------------------------------------

describe('queue_append_row never writes through a symbolic link (D-HOOKS-NO-SYMLINK)', () => {
  const UNTOUCHED = 'a file outside the project, which no append may write\n';
  let tmpDir: string;
  let root: string;
  let queue: string;
  let outsideFile: string;
  let outsideDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-nolink-'));
    root = path.join(tmpDir, 'repo');
    queue = path.join(root, '.devflow', 'memory', '.pending-turns.jsonl');
    outsideFile = path.join(tmpDir, 'outside.txt');
    outsideDir = path.join(tmpDir, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(outsideFile, UNTOUCHED);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** One append of a fixed row to `queue`, checked from `root`, after `setup`. */
  const append = (setup = ''): { exitCode: number; stderr: string } =>
    runWithQueueAppend(`${setup}\nqueue_append_row "${root}" "${queue}" "user" "we chose X over Y" "1"`);

  it('a link at the queue path: the link target stays byte-identical and the call still succeeds', () => {
    fs.mkdirSync(path.dirname(queue), { recursive: true });
    fs.symlinkSync(outsideFile, queue);

    expect(append().exitCode).toBe(0);

    expect(fs.readFileSync(outsideFile, 'utf-8')).toBe(UNTOUCHED);
    expect(fs.lstatSync(queue).isSymbolicLink()).toBe(true);
  });

  it('a dangling link at the queue path creates nothing where it points', () => {
    const created = path.join(tmpDir, 'created-through-the-link');
    fs.mkdirSync(path.dirname(queue), { recursive: true });
    fs.symlinkSync(created, queue);

    expect(append().exitCode).toBe(0);

    expect(fs.existsSync(created)).toBe(false);
  });

  it('a linked folder between the root and the queue: nothing is created in the folder it names', () => {
    fs.mkdirSync(path.join(root, '.devflow'));
    fs.symlinkSync(outsideDir, path.join(root, '.devflow', 'memory'));

    expect(append().exitCode).toBe(0);

    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });

  it('a linked .devflow above the queue folder: nothing is created in the folder it names', () => {
    fs.symlinkSync(outsideDir, path.join(root, '.devflow'));

    expect(append().exitCode).toBe(0);

    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });

  it('a normal path: creates the queue folder and the queue, at 0600 whatever the caller umask', () => {
    expect(append('umask 022').exitCode).toBe(0);

    expect(readJsonl(queue)).toEqual([{ role: 'user', content: 'we chose X over Y', ts: 1 }]);
    expect((fs.statSync(queue).mode & 0o777).toString(8)).toBe('600');
  });

  it('a root that sits under a linked parent still appends', () => {
    const linkedParent = path.join(tmpDir, 'linked-parent');
    fs.symlinkSync(tmpDir, linkedParent);
    const linkedRoot = path.join(linkedParent, 'repo');
    const viaLink = path.join(linkedRoot, '.devflow', 'memory', '.pending-turns.jsonl');

    const { exitCode, stderr } = runWithQueueAppend(`queue_append_row "${linkedRoot}" "${viaLink}" "user" "x" "1"`);

    expect(exitCode, stderr).toBe(0);
    expect(readJsonl(queue)).toHaveLength(1);
  });

  it('a queue path that is not below its root is refused, and the call still succeeds', () => {
    const elsewhere = path.join(outsideDir, 'q.jsonl');

    const { exitCode, stderr } = runWithQueueAppend(`queue_append_row "${root}" "${elsewhere}" "user" "x" "1"`);

    expect(exitCode, stderr).toBe(0);
    expect(fs.existsSync(elsewhere)).toBe(false);
  });

  it('the trim never writes through a link planted at its copy\'s name, and removes the link', () => {
    // The copy's name ends in the shell's PID, which the script reads as $$: it
    // plants the link at exactly that name, checks it is there, then appends past
    // the 200-line cap.
    fs.mkdirSync(path.dirname(queue), { recursive: true });
    const rows = Array.from({ length: 200 }, (_, i) => JSON.stringify({ role: 'user', content: `row-${i}`, ts: i }) + '\n').join('');
    fs.writeFileSync(queue, rows, { mode: 0o600 });

    const { exitCode, stderr } = runWithQueueAppend(`
      ln -s "${outsideFile}" "${queue}.tmp.$$"
      [ -L "${queue}.tmp.$$" ]
      queue_append_row "${root}" "${queue}" "user" "row-200" "200"
    `);

    expect(exitCode, stderr).toBe(0);
    expect(fs.readFileSync(outsideFile, 'utf-8'), 'nothing is written through the planted link').toBe(UNTOUCHED);
    expect(fs.lstatSync(queue).isSymbolicLink(), 'the link is never renamed over the queue').toBe(false);
    expect(readJsonl(queue), 'the row is appended; the trim waits for a later append').toHaveLength(201);
    expect(fs.readdirSync(path.dirname(queue)).filter((name) => name.includes('.tmp.')), 'the planted link is removed').toEqual([]);
  });

  it('the trim never opens a FIFO that a link at its copy\'s name leads to: the append returns, and the link is removed', () => {
    // noclobber alone opens such a link: its target is no regular file, so the
    // create is not made exclusive, and an open for writing waits for a reader
    // that never comes. The run is bounded, so that wait fails the test rather
    // than hanging the suite.
    fs.mkdirSync(path.dirname(queue), { recursive: true });
    const rows = Array.from({ length: 200 }, (_, i) => JSON.stringify({ role: 'user', content: `row-${i}`, ts: i }) + '\n').join('');
    fs.writeFileSync(queue, rows, { mode: 0o600 });
    const fifo = path.join(tmpDir, 'fifo');
    makeFifo(fifo);

    try {
      const run = spawnWithStdin('bash', ['-c', withQueueAppend(`
        ln -s "${fifo}" "${queue}.tmp.$$"
        [ -L "${queue}.tmp.$$" ]
        queue_append_row "${root}" "${queue}" "user" "row-200" "200"
      `)], { input: '', timeout: FIFO_RUN_BOUND_MS });

      expect(run.kind, run.stderr).toBe('clean');
    } finally {
      releaseFifo(fifo);
    }
    expect(readJsonl(queue), 'the row is appended; the trim waits for a later append').toHaveLength(201);
    expect(fs.readdirSync(path.dirname(queue)).filter((name) => name.includes('.tmp.')), 'the planted link is removed').toEqual([]);
  }, FIFO_TEST_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// TP-41: the write rule. The row is built first, and one builtin append writes it,
// so a builder that fails halfway leaves no partial line in the queue.
// ---------------------------------------------------------------------------

describe('queue_append_row: the write rule (TP-41)', () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let tmpDir: string;
  let shimDir: string;
  let callLog: string;
  let queue: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-write-'));
    shimDir = path.join(tmpDir, 'shim');
    callLog = path.join(tmpDir, 'calls.log');
    queue = path.join(tmpDir, 'q.jsonl');
    fs.mkdirSync(shimDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const shimEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}` });
  const calls = (): string[] => (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf-8').trim().split('\n').filter(Boolean) : []);
  const append = (setup = '', env?: NodeJS.ProcessEnv) =>
    runWithQueueAppend(`${setup}\nqueue_append_row "${tmpDir}" "${queue}" "user" "we chose X over Y" "7"`, env);

  for (const backend of [{ name: 'jq', noJq: false, tool: 'jq' }, { name: 'node fallback', noJq: true, tool: 'node' }]) {
    describe(`${backend.name} backend`, () => {
      // A builder that prints half a row and fails. Before the write rule its output went
      // straight into the queue, so this left a line that no reader could parse.
      beforeEach(() => {
        writeFakeExecutable(path.join(shimDir, backend.tool), `#!/bin/bash\nprintf '%s' '{"role":"us'\nexit 1\n`);
      });

      it('a row that fails to build writes nothing: no partial line, and no queue file is created', () => {
        const { exitCode, stderr } = append(backend.noJq ? '_HAS_JQ=false' : '', shimEnv());

        expect(exitCode, stderr).toBe(0);
        expect(fs.existsSync(queue)).toBe(false);
      });

      it('a row that fails to build leaves the queued rows byte-identical', () => {
        const queued = `${JSON.stringify({ role: 'user', content: 'earlier', ts: 1 })}\n`;
        fs.writeFileSync(queue, queued, { mode: 0o600 });

        const { exitCode, stderr } = append(backend.noJq ? '_HAS_JQ=false' : '', shimEnv());

        expect(exitCode, stderr).toBe(0);
        expect(fs.readFileSync(queue, 'utf-8')).toBe(queued);
      });
    });
  }

  it('a row that builds is written as exactly one newline-terminated line per call', () => {
    expect(append().exitCode).toBe(0);
    expect(append().exitCode).toBe(0);

    const text = fs.readFileSync(queue, 'utf-8');
    expect(text.split('\n')).toHaveLength(3);
    expect(text.endsWith('\n')).toBe(true);
    expect(readJsonl(queue)).toEqual([
      { role: 'user', content: 'we chose X over Y', ts: 7 },
      { role: 'user', content: 'we chose X over Y', ts: 7 },
    ]);
  });

  it('the append creates the queue itself, at 0600 whatever the caller umask, and runs no touch', () => {
    writeFakeExecutable(path.join(shimDir, 'touch'), `#!/bin/bash\necho touch >> "${callLog}"\nexit 0\n`);

    const { exitCode, stderr } = append('umask 022', shimEnv());

    expect(exitCode, stderr).toBe(0);
    expect((fs.statSync(queue).mode & 0o777).toString(8)).toBe('600');
    expect(calls(), 'creating the file is part of the append, not a separate command').toEqual([]);
  });

  it('a queue that already exists keeps its mode: the append only adds a line', () => {
    fs.writeFileSync(queue, '', { mode: 0o640 });
    fs.chmodSync(queue, 0o640);

    expect(append('umask 022').exitCode).toBe(0);

    expect((fs.statSync(queue).mode & 0o777).toString(8)).toBe('640');
    expect(readJsonl(queue)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The creator rule (#529): a ledger queue is appended to in the old folder while it
// exists, and the new folder is made only when the old name is absent. An append
// that finds the old folder gone (the move ran meanwhile) looks again and goes on
// in the new folder: the row is not dropped and the old folder is not made again.
// ---------------------------------------------------------------------------

describe('queue_append_row: the ledger folder follows the creator rule', () => {
  let tmpDir: string;
  let root: string;
  let devflow: string;
  let oldQueue: string;
  let newQueue: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-creator-'));
    root = path.join(tmpDir, 'repo');
    devflow = path.join(root, '.devflow');
    oldQueue = path.join(devflow, 'learning', '.pending-turns.jsonl');
    newQueue = path.join(devflow, 'curation', '.pending-turns.jsonl');
    fs.mkdirSync(root);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** One append of a fixed row for the curation queue, after `setup`. */
  const append = (setup = ''): { exitCode: number; stderr: string } =>
    runWithQueueAppend(`${setup}\nqueue_append_row "${root}" "${newQueue}" "user" "we chose X over Y" "1"`);
  const row = { role: 'user', content: 'we chose X over Y', ts: 1 };

  it('appends to the old folder while it exists, and makes no new folder', () => {
    fs.mkdirSync(path.dirname(oldQueue), { recursive: true });
    fs.writeFileSync(oldQueue, `${JSON.stringify({ role: 'user', content: 'earlier', ts: 0 })}\n`, { mode: 0o600 });

    const { exitCode, stderr } = append();

    expect(exitCode, stderr).toBe(0);
    expect(readJsonl(oldQueue)).toEqual([{ role: 'user', content: 'earlier', ts: 0 }, row]);
    expect(fs.existsSync(path.join(devflow, 'curation')), 'no new folder beside the old one').toBe(false);
  });

  it('an old folder without a queue file gets the file, and still no new folder is made', () => {
    fs.mkdirSync(path.dirname(oldQueue), { recursive: true });

    expect(append().exitCode).toBe(0);

    expect(readJsonl(oldQueue)).toEqual([row]);
    expect(fs.existsSync(path.join(devflow, 'curation'))).toBe(false);
  });

  it('makes the new folder, and no old one, when the old name is absent', () => {
    fs.mkdirSync(devflow);

    expect(append().exitCode).toBe(0);

    expect(readJsonl(newQueue)).toEqual([row]);
    expect(fs.existsSync(path.join(devflow, 'learning'))).toBe(false);
  });

  it('appends to the new folder when it exists and the old name is absent', () => {
    fs.mkdirSync(path.dirname(newQueue), { recursive: true });
    fs.writeFileSync(newQueue, `${JSON.stringify({ role: 'user', content: 'earlier', ts: 0 })}\n`, { mode: 0o600 });

    expect(append().exitCode).toBe(0);

    expect(readJsonl(newQueue)).toEqual([{ role: 'user', content: 'earlier', ts: 0 }, row]);
    expect(fs.existsSync(path.join(devflow, 'learning'))).toBe(false);
  });

  it('a dangling link at the old name counts as present: nothing is made where it points, and no new folder is made', () => {
    const created = path.join(tmpDir, 'created-through-the-link');
    fs.mkdirSync(devflow);
    fs.symlinkSync(created, path.join(devflow, 'learning'));

    const { exitCode, stderr } = append();

    expect(exitCode, stderr).toBe(0);
    expect(fs.existsSync(created)).toBe(false);
    expect(fs.existsSync(path.join(devflow, 'curation'))).toBe(false);
  });

  it('the old folder moved away between the probe and the append: the row lands once in the new folder, and the old folder is not made again', () => {
    fs.mkdirSync(path.dirname(oldQueue), { recursive: true });
    fs.writeFileSync(oldQueue, '', { mode: 0o600 });

    // The probe answers with the old folder, then the move takes it away, as it would
    // between the hook's probe and its append.
    const { exitCode, stderr } = append(`
      eval "_probed_$(declare -f df_ledger_queue)"
      df_ledger_queue() { _probed_df_ledger_queue "$@"; rm -rf "${path.join(devflow, 'learning')}"; }
    `);

    expect(exitCode, stderr).toBe(0);
    expect(readJsonl(newQueue)).toEqual([row]);
    expect(fs.existsSync(path.join(devflow, 'learning')), 'the old folder stays gone').toBe(false);
  });

  it('the new folder made after the old one moved is created under the caller umask, which is back when the call returns', () => {
    fs.mkdirSync(path.dirname(oldQueue), { recursive: true });
    fs.writeFileSync(oldQueue, '', { mode: 0o600 });

    const { exitCode, stderr, stdout } = runWithQueueAppend(`
      umask 022
      eval "_probed_$(declare -f df_ledger_queue)"
      df_ledger_queue() { _probed_df_ledger_queue "$@"; rm -rf "${path.join(devflow, 'learning')}"; }
      queue_append_row "${root}" "${newQueue}" "user" "we chose X over Y" "1"
      umask
    `);

    expect(exitCode, stderr).toBe(0);
    expect(stdout.trim()).toBe('0022');
    expect(readJsonl(newQueue)).toEqual([row]);
    expect((fs.statSync(path.dirname(newQueue)).mode & 0o777).toString(8)).toBe('755');
    expect((fs.statSync(newQueue).mode & 0o777).toString(8)).toBe('600');
  });

  it('the memory queue is not redirected, whichever ledger folder exists', () => {
    const memoryQueue = path.join(devflow, 'memory', '.pending-turns.jsonl');
    fs.mkdirSync(path.join(devflow, 'learning'), { recursive: true });

    const { exitCode, stderr } = runWithQueueAppend(`queue_append_row "${root}" "${memoryQueue}" "user" "we chose X over Y" "1"`);

    expect(exitCode, stderr).toBe(0);
    expect(readJsonl(memoryQueue)).toEqual([row]);
    expect(fs.existsSync(oldQueue)).toBe(false);
  });
});

/**
 * The budget of every test in the two gate-read groups: one sourced queue-append
 * run plus one node exec that may meet the syspolicyd wait. A repository-layer
 * gate read execs node at most once — the resolver's fold when a repository file
 * can narrow, else the node-backend manifest parse (TP-34 pins it) — and the
 * manifest parse that follows only a failed fold would meet a drained queue. A
 * machine-layer test on the node backend reads several manifests; every exec
 * after the first meets a drained queue too.
 */
const GATE_READ_TEST_BUDGET_MS = HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS;

describe('queue_read_gates', { timeout: GATE_READ_TEST_BUDGET_MS }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-read-gates-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // The machine layer: ~/.devflow/manifest.json, read with no <root> argument
  // (D-FEATURES-NARROW-ONLY; the repository layer is covered below). Raw file
  // contents (not objects) so malformed JSON is expressible.
  type Raw = string | null;

  function readGates(manifest: Raw, opts: { noJq?: boolean } = {}): { memory: string; curation: string; exitCode: number } {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (manifest !== null) fs.writeFileSync(manifestPath, manifest);
    const { stdout, exitCode } = runWithQueueAppend(`
      ${opts.noJq ? '_HAS_JQ=false' : ''}
      queue_read_gates "${manifestPath}"
      echo "MEMORY=$_QG_MEMORY"
      echo "CURATION=$_QG_CURATION"
    `);
    return {
      memory: stdout.match(/MEMORY=(\S*)/)?.[1] ?? '',
      curation: stdout.match(/CURATION=(\S*)/)?.[1] ?? '',
      exitCode,
    };
  }

  const manifestWith = (features: Record<string, unknown>): string =>
    JSON.stringify({ version: '2.0.0', features });

  for (const backend of [{ name: 'jq', noJq: false }, { name: 'node fallback', noJq: true }]) {
    describe(`${backend.name} backend`, () => {
      const gates = (manifest: Raw) => readGates(manifest, { noJq: backend.noJq });

      it('reads both switches in one pass', () => {
        expect(gates(manifestWith({ memory: true, learning: false }))).toMatchObject({
          memory: 'true', curation: 'false', exitCode: 0,
        });
        expect(gates(manifestWith({ memory: false, learning: true }))).toMatchObject({
          memory: 'false', curation: 'true', exitCode: 0,
        });
      });

      it('each switch clears only its own gate', () => {
        expect(gates(manifestWith({ memory: false, learning: false }))).toMatchObject({ memory: 'false', curation: 'false' });
        expect(gates(manifestWith({ learning: false }))).toMatchObject({ memory: 'true', curation: 'false' });
        expect(gates(manifestWith({ memory: false }))).toMatchObject({ memory: 'false', curation: 'true' });
      });

      it('no manifest file → both on (fail-open)', () => {
        expect(gates(null)).toMatchObject({ memory: 'true', curation: 'true', exitCode: 0 });
      });

      it('a manifest without the keys → both on (fail-open)', () => {
        expect(gates(manifestWith({ ambient: true }))).toMatchObject({ memory: 'true', curation: 'true' });
      });

      it('a malformed manifest fails open', () => {
        for (const raw of ['{ not json', '[1, 2]', JSON.stringify({ features: 'nope' }), JSON.stringify({ features: [false] })]) {
          expect(gates(raw), raw).toMatchObject({ memory: 'true', curation: 'true', exitCode: 0 });
        }
      });

      it('only an explicit boolean false is the switch (a string "false" is not)', () => {
        expect(gates(manifestWith({ memory: 'false', learning: 0 }))).toMatchObject({ memory: 'true', curation: 'true' });
      });

      it('the curation gate falls back to the legacy decisions key, mirroring readManifest (D-LEARNING-LEGACY-DECISIONS)', () => {
        expect(gates(manifestWith({ memory: true, decisions: false }))).toMatchObject({ memory: 'true', curation: 'false', exitCode: 0 });
        expect(gates(manifestWith({ decisions: true }))).toMatchObject({ memory: 'true', curation: 'true' });
        // An explicit boolean `learning` key wins over the legacy `decisions` key, either way.
        expect(gates(manifestWith({ decisions: false, learning: true }))).toMatchObject({ curation: 'true' });
        expect(gates(manifestWith({ decisions: true, learning: false }))).toMatchObject({ curation: 'false' });
        // A non-boolean `learning` key is not a value, so the legacy `decisions` key decides; a
        // non-boolean decisions decides nothing.
        expect(gates(manifestWith({ decisions: false, learning: 'yes' }))).toMatchObject({ curation: 'false' });
        expect(gates(manifestWith({ decisions: 'false' }))).toMatchObject({ curation: 'true' });
      }, 15000);

      it('the curation gate is read under `curation` and the legacy learning key: a false in either is off, a disagreeing pair resolves off (TP-10)', () => {
        expect(gates(manifestWith({ memory: true, curation: false }))).toMatchObject({ memory: 'true', curation: 'false', exitCode: 0 });
        expect(gates(manifestWith({ curation: true, learning: false }))).toMatchObject({ curation: 'false' });
        expect(gates(manifestWith({ curation: false, learning: true }))).toMatchObject({ curation: 'false' });
        expect(gates(manifestWith({ curation: true, learning: true }))).toMatchObject({ curation: 'true' });
        expect(gates(manifestWith({ curation: true }))).toMatchObject({ curation: 'true' });
        // The pre-rename key is read only when neither current key is a boolean.
        expect(gates(manifestWith({ curation: true, decisions: false }))).toMatchObject({ curation: 'true' });
        expect(gates(manifestWith({ curation: 'x', learning: 0, decisions: false }))).toMatchObject({ curation: 'false' });
        // A non-boolean value is ignored for that key only.
        expect(gates(manifestWith({ curation: 'false' }))).toMatchObject({ curation: 'true' });
        expect(gates(manifestWith({ curation: 'true', learning: false }))).toMatchObject({ curation: 'false' });
        // The curation key belongs to the curation gate alone.
        expect(gates(manifestWith({ curation: false }))).toMatchObject({ memory: 'true' });
      }, 30000);

      it('an escaped curation key still switches curation off', () => {
        expect(gates('{"features":{"cur\\u0061tion":false}}')).toMatchObject({ memory: 'true', curation: 'false', exitCode: 0 });
        expect(gates('{"features":{"curation":true,"le\\u0061rning":false}}')).toMatchObject({ curation: 'false' });
      });

      it('an escaped key still switches off (a \\u escape always takes the full parse)', () => {
        // JSON.parse and jq decode "memory" to "memory"; the builtin fast
        // path cannot see through an escape, so it must never decide such a file.
        const raw = '{"features":{"m\\u0065mory":false,"le\\u0061rning":false}}';
        expect(gates(raw)).toMatchObject({ memory: 'false', curation: 'false', exitCode: 0 });
        expect(gates('{"features":{"d\\u0065cisions":false}}')).toMatchObject({ memory: 'true', curation: 'false' });
      });

      it('forks no parser when no switch can be off, and exactly one when one can (D-GATES-FAST-PATH)', () => {
        // Every capture hook and session start pays this read. A manifest whose
        // text holds no `"memory"|"curation"|"learning"|"decisions": false` cannot switch
        // anything off, so it is answered by shell builtins alone. The parser is
        // shadowed by a function that logs each call before running the real one.
        const forkLog = path.join(tmpDir, 'forks.log');
        const manifestPath = path.join(tmpDir, 'manifest.json');
        const parser = backend.noJq ? 'node' : 'jq';
        const probe = (manifest: string) => {
          fs.writeFileSync(manifestPath, manifest);
          fs.rmSync(forkLog, { force: true });
          const { stdout, exitCode } = runWithQueueAppend(`
            ${backend.noJq ? '_HAS_JQ=false' : ''}
            ${parser}() { echo fork >> "${forkLog}"; command ${parser} "$@"; }
            queue_read_gates "${manifestPath}"
            echo "MEMORY=$_QG_MEMORY CURATION=$_QG_CURATION"
          `);
          const forks = fs.existsSync(forkLog) ? fs.readFileSync(forkLog, 'utf-8').trim().split('\n').length : 0;
          return { stdout, exitCode, forks };
        };

        // A real manifest carries other `false` values (proxy, compliance.enabled);
        // they are not switches and must not cost a fork.
        const on = probe(JSON.stringify({
          version: '2.0.0',
          features: { ambient: true, memory: true, curation: true, learning: true, proxy: false, compliance: { enabled: false } },
        }, null, 2));
        expect(on).toMatchObject({ exitCode: 0, forks: 0 });
        expect(on.stdout).toContain('MEMORY=true CURATION=true');

        const off = probe(JSON.stringify({ features: { memory: false } }, null, 2));
        expect(off).toMatchObject({ exitCode: 0, forks: 1 });
        expect(off.stdout).toContain('MEMORY=false CURATION=true');

        // The curation key is a switch too: one fork, and curation reads off.
        const curationOff = probe(JSON.stringify({ features: { memory: true, curation: false } }, null, 2));
        expect(curationOff).toMatchObject({ exitCode: 0, forks: 1 });
        expect(curationOff.stdout).toContain('MEMORY=true CURATION=false');
      });
    });
  }

  it('without a <root>, no repository file is read: a stale false beside the manifest decides nothing', () => {
    // The pre-#378 signature took the repo config first. A stale
    // `.devflow/config.json` saying false must not switch anything off — and
    // passing its path where the manifest belongs must not either.
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ memory: false, learning: false }));
    const { stdout } = runWithQueueAppend(`
      queue_read_gates "${path.join(tmpDir, 'manifest.json')}"
      echo "MEMORY=$_QG_MEMORY CURATION=$_QG_CURATION"
    `);
    expect(stdout).toContain('MEMORY=true CURATION=true');
  });

  it('never exits non-zero (set -e safety)', () => {
    // Regression guard: queue_read_gates's exit status must never leak the
    // truthiness of its last internal test into a `set -e` caller that
    // invokes it as a plain statement.
    expect(readGates(manifestWith({})).exitCode).toBe(0);
    expect(readGates(manifestWith({ memory: false, learning: false })).exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The repository layer: queue_read_gates <manifest> <root> (D-FEATURES-NARROW-ONLY)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The gate read with no jq folds the manifest in node. That fold is the resolver's
// own machineSwitchOn, required from resolve-settings.cjs (a sibling of hooks/), so
// the machine rule is held in one place and cannot drift from the resolver's.
// ---------------------------------------------------------------------------

describe('queue_read_gates without jq: the manifest read is the resolver machine rule', { timeout: GATE_READ_TEST_BUDGET_MS }, () => {
  interface Resolver {
    machineSwitchOn(manifest: unknown, feature: 'memory' | 'curation' | 'knowledge'): boolean;
  }
  const resolver = createRequire(import.meta.url)(path.join(HOOKS_DIR, '..', 'resolve-settings.cjs')) as Resolver;
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-read-gates-node-'));
    manifestPath = path.join(tmpDir, 'manifest.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** `queue_read_gates <manifest>` with jq hidden and no root, from the copy of the hooks folder at `hooksDir`. */
  function gatesFrom(hooksDir: string): { memory: string; curation: string } {
    const script = [
      'set -e', 'log() { :; }', 'dbg() { :; }', '_HAS_JQ=false',
      `source "${path.join(hooksDir, 'queue-append')}"`,
      `queue_read_gates "${manifestPath}"`,
      'echo "MEMORY=$_QG_MEMORY CURATION=$_QG_CURATION"',
    ].join('\n');
    const run = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
    expect(run.status, run.stderr).toBe(0);
    return {
      memory: run.stdout.match(/MEMORY=(\S*)/)?.[1] ?? '',
      curation: run.stdout.match(/CURATION=(\S*)/)?.[1] ?? '',
    };
  }

  it.each(SETTINGS_SWITCH_TABLE.map((r) => [r.name, r] as const))('the node branch and the resolver agree on the machine layer of: %s', (_name, row) => {
    if (row.manifest !== undefined) fs.writeFileSync(manifestPath, JSON.stringify(row.manifest));

    expect(gatesFrom(HOOKS_DIR)).toEqual({
      memory: String(resolver.machineSwitchOn(row.manifest, 'memory')),
      curation: String(resolver.machineSwitchOn(row.manifest, 'curation')),
    });
  });

  it('the answer comes from the resolver the hook finds beside it, not from a copy of the rule', () => {
    // A hooks folder and a resolver of its own: the resolver answers memory on and
    // curation off whatever the manifest says. The hook must report exactly that.
    const scripts = path.join(tmpDir, 'scripts');
    const hooks = path.join(scripts, 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    for (const name of ['queue-append', 'git-marker', 'curation-move']) fs.copyFileSync(path.join(HOOKS_DIR, name), path.join(hooks, name));
    fs.writeFileSync(
      path.join(scripts, 'resolve-settings.cjs'),
      "module.exports = { machineSwitchOn: (manifest, feature) => feature === 'memory' };\n",
    );
    fs.writeFileSync(manifestPath, JSON.stringify({ features: { memory: false, curation: true } }));

    expect(gatesFrom(hooks)).toEqual({ memory: 'true', curation: 'false' });
  });
});

describe('queue_read_gates <manifest> <root>: the repository narrows, never widens', { timeout: GATE_READ_TEST_BUDGET_MS }, () => {
  let tmpDir: string;
  let root: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-read-gates-repo-'));
    root = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(root, '.devflow'), { recursive: true });
    manifestPath = path.join(tmpDir, 'manifest.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeLayers(row: Pick<SwitchRow, 'manifest' | 'project' | 'personal'>): void {
    if (row.manifest !== undefined) fs.writeFileSync(manifestPath, JSON.stringify(row.manifest));
    if (row.project !== null) fs.writeFileSync(path.join(root, '.devflow', 'project.json'), row.project);
    if (row.personal !== null) fs.writeFileSync(path.join(root, '.devflow', 'config.json'), row.personal);
  }

  function gatesAt(opts: { noJq?: boolean; env?: NodeJS.ProcessEnv } = {}): { memory: string; curation: string; exitCode: number } {
    const { stdout, exitCode } = runWithQueueAppend(`
      ${opts.noJq ? '_HAS_JQ=false' : ''}
      queue_read_gates "${manifestPath}" "${root}"
      echo "MEMORY=$_QG_MEMORY"
      echo "CURATION=$_QG_CURATION"
    `, opts.env);
    return {
      memory: stdout.match(/MEMORY=(\S*)/)?.[1] ?? '',
      curation: stdout.match(/CURATION=(\S*)/)?.[1] ?? '',
      exitCode,
    };
  }

  for (const backend of [{ name: 'jq', noJq: false }, { name: 'node fallback', noJq: true }]) {
    // TP-49: the shared table, run through the shell gates. resolveSettings runs
    // the same rows in tests/evidence-policy/settings-mode.test.ts, so a row that
    // passes in both files is an answer the two implementations share.
    describe(`TP-49 (${backend.name} backend): the shared switch table`, () => {
      it.each(SETTINGS_SWITCH_TABLE.map((r) => [r.name, r] as const))('%s', (_name, row) => {
        writeLayers(row);
        expect(gatesAt({ noJq: backend.noJq })).toEqual({
          memory: String(row.expect.memory),
          curation: String(row.expect.curation),
          exitCode: 0,
        });
      });
    });
  }

  it('a symlinked project.json narrows nothing (the parser never follows one)', () => {
    const target = path.join(tmpDir, 'elsewhere.json');
    fs.writeFileSync(target, '{"features":{"memory":false,"learning":false}}');
    fs.symlinkSync(target, path.join(root, '.devflow', 'project.json'));
    expect(gatesAt()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
  });

  it('a directory or FIFO where a file belongs is skipped without blocking', () => {
    fs.mkdirSync(path.join(root, '.devflow', 'project.json'));
    execSync(`mkfifo "${path.join(root, '.devflow', 'config.json')}"`);
    expect(gatesAt()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
  });

  it('an empty <root> reads no repository file', () => {
    writeLayers({ manifest: undefined, project: '{"features":{"memory":false}}', personal: null });
    const { stdout } = runWithQueueAppend(`
      queue_read_gates "${manifestPath}" ""
      echo "MEMORY=$_QG_MEMORY CURATION=$_QG_CURATION"
    `);
    expect(stdout).toContain('MEMORY=true CURATION=true');
  });

  it('never exits non-zero with a narrowing file (set -e safety)', () => {
    writeLayers({ manifest: undefined, project: '{"features":{"memory":false,"learning":false}}', personal: null });
    expect(gatesAt()).toEqual({ memory: 'false', curation: 'false', exitCode: 0 });
  });

  // TP-34 (AC-30): the fork budget. Every capture hook and session start pays
  // this read, so a repository file that cannot narrow must cost nothing. The
  // counter is a PATH shim: `node` and `jq` stand-ins that log each exec and hand
  // over to the real binary, so every parser fork is seen however it is spelled.
  // Each stand-in is a link to the warm dispatcher, so no test runs a new executable.
  describe('TP-34 (AC-30): zero parser forks unless a file can narrow, exactly one when one can', () => {
    const writeFakeExecutable = useWarmFakeExecutables();
    let shimDir: string;
    let forkLog: string;

    const realBinary = (name: string): string | null => resolveOnPath(name, process.env.PATH ?? '/usr/bin:/bin') ?? null;

    beforeEach(() => {
      shimDir = path.join(tmpDir, 'shim');
      forkLog = path.join(tmpDir, 'forks.log');
      fs.mkdirSync(shimDir);
      for (const name of ['node', 'jq']) {
        const real = realBinary(name);
        if (real === null) continue;
        writeFakeExecutable(path.join(shimDir, name), `#!/bin/bash\necho ${name} >> "${forkLog}"\nexec "${real}" "$@"\n`);
      }
    });

    const forks = (): string[] => (fs.existsSync(forkLog) ? fs.readFileSync(forkLog, 'utf-8').trim().split('\n').filter(Boolean) : []);
    const shimEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}` });
    const MANIFEST = { version: '2.5.0', features: { memory: true, curation: true, learning: true, knowledge: true, proxy: false } };

    for (const backend of [{ name: 'jq', noJq: false }, { name: 'node fallback', noJq: true }]) {
      describe(`${backend.name} backend`, () => {
        const probe = () => gatesAt({ noJq: backend.noJq, env: shimEnv() });

        it('no repository files: zero forks', () => {
          writeLayers({ manifest: MANIFEST, project: null, personal: null });
          expect(probe()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('repository files free of false: zero forks', () => {
          writeLayers({
            manifest: MANIFEST,
            project: JSON.stringify({
              version: 1, evidence: 'required', compliance: ['gdpr'],
              tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
              reviewPublication: 'auto', features: { memory: true, curation: true, learning: true },
            }, null, 2),
            personal: '{"reviewPublication":"full","tracker":"github"}',
          });
          expect(probe()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('a false that is not a memory or curation switch: zero forks', () => {
          // The legacy top-level keys sit before `features`, and knowledge and
          // decisions have no shell gate: none of them can narrow a queue.
          writeLayers({
            manifest: MANIFEST,
            project: '{"memory":false,"curation":false,"learning":false,"decisions":false,"features":{"knowledge":false,"decisions":false}}',
            personal: '{"memory":false,"features":{"knowledge":false}}',
          });
          expect(probe()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('the legacy project.json features.learning false: exactly one fork, curation off', () => {
          writeLayers({ manifest: MANIFEST, project: '{"version":1,"features":{"learning":false}}', personal: null });
          expect(probe()).toEqual({ memory: 'true', curation: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('project.json features.curation false: exactly one fork, curation off (TP-33)', () => {
          writeLayers({ manifest: MANIFEST, project: '{"version":1,"features":{"curation":false}}', personal: null });
          expect(probe()).toEqual({ memory: 'true', curation: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('config.json features.curation false: exactly one fork, curation off', () => {
          writeLayers({ manifest: MANIFEST, project: null, personal: '{"features":{"curation":false}}' });
          expect(probe()).toEqual({ memory: 'true', curation: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('a repository file with both keys costs exactly one fork, whichever key is false (TP-33)', () => {
          for (const features of [
            '{"curation":false,"learning":false}',
            '{"curation":false,"learning":true}',
            '{"curation":true,"learning":false}',
          ]) {
            fs.rmSync(forkLog, { force: true });
            writeLayers({ manifest: MANIFEST, project: `{"version":1,"features":${features}}`, personal: null });
            expect(probe(), features).toEqual({ memory: 'true', curation: 'false', exitCode: 0 });
            expect(forks(), features).toEqual(['node']);
          }
        });

        it('a repository file with both keys true: zero forks', () => {
          writeLayers({ manifest: MANIFEST, project: '{"version":1,"features":{"curation":true,"learning":true}}', personal: null });
          expect(probe()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('a manifest curation:false with a repository file holding both keys: still exactly one fork', () => {
          writeLayers({
            manifest: { features: { memory: true, curation: false } },
            project: '{"features":{"curation":false,"learning":false}}',
            personal: '{"features":{"curation":false}}',
          });
          expect(probe()).toEqual({ memory: 'true', curation: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('a false in the manifest and in both repository files: still exactly one fork', () => {
          writeLayers({
            manifest: { features: { memory: false, learning: true } },
            project: '{"features":{"learning":false}}',
            personal: '{"features":{"memory":false}}',
          });
          expect(probe()).toEqual({ memory: 'false', curation: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('an oversize or NUL-cut file: zero forks (the bounded read already knows it is invalid)', () => {
          writeLayers({
            manifest: MANIFEST,
            project: '{"features":{"memory":false},"pad":"' + 'x'.repeat(5000) + '"}',
            personal: '{"features":{"learning":false}}\u0000',
          });
          expect(probe()).toEqual({ memory: 'true', curation: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The tracked-area gate: no row for a queue whose area git tracks (or did not answer for),
// decided before the row is built, with the git calls counted.
// ---------------------------------------------------------------------------

describe('queue_append_both and queue_append_row: the tracked-area gate', () => {
  const writeFakeExecutable = useWarmFakeExecutables();
  let tmpDir: string;
  let root: string;
  let memory: string;
  let curation: string;
  let forkLog: string;
  let gitLog: string;

  const git = (...args: string[]): void => {
    execSync(`git ${args.map((a) => `'${a}'`).join(' ')}`, { cwd: root, stdio: 'pipe' });
  };

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'queue-append-gate-')));
    root = path.join(tmpDir, 'repo');
    memory = path.join(root, '.devflow', 'memory', '.pending-turns.jsonl');
    curation = path.join(root, '.devflow', 'curation', '.pending-turns.jsonl');
    forkLog = path.join(tmpDir, 'forks.log');
    gitLog = path.join(tmpDir, 'git.log');
    const shimDir = path.join(tmpDir, 'shim');
    fs.mkdirSync(root);
    fs.mkdirSync(shimDir);
    git('init', '-q');
    for (const name of ['node', 'jq', 'git']) {
      const real = resolveOnPath(name, process.env.PATH ?? '/usr/bin:/bin');
      if (real === undefined) continue;
      const log = name === 'git' ? gitLog : forkLog;
      writeFakeExecutable(path.join(shimDir, name), `#!/bin/bash\necho ${name === 'git' ? '"$*"' : name} >> "${log}"\nexec "${real}" "$@"\n`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const shimEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${path.join(tmpDir, 'shim')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  });
  const forks = (): string[] => (fs.existsSync(forkLog) ? fs.readFileSync(forkLog, 'utf-8').trim().split('\n').filter(Boolean) : []);
  /** The `git ls-files` calls the gate made. */
  const listCalls = (): string[] => (fs.existsSync(gitLog) ? fs.readFileSync(gitLog, 'utf-8').split('\n').filter((l) => l.includes(' ls-files ')) : []);
  const reset = (): void => {
    fs.rmSync(forkLog, { force: true });
    fs.rmSync(gitLog, { force: true });
  };
  /** Run `script` with the dependency chain sourced and `log` echoing to stdout. */
  const run = (script: string): { stdout: string; exitCode: number } => {
    const res = spawnSync('bash', ['-c', withQueueAppend(`log() { echo "LOG: $*"; }\n${script}`)], { env: shimEnv(), encoding: 'utf-8' });
    return { stdout: res.stdout, exitCode: res.status ?? 1 };
  };
  const both = (flags = '"true" "true"', memoryRoot = root, curationRoot = root): { stdout: string; exitCode: number } =>
    run(`queue_append_both "${memoryRoot}" "${memory}" "${curationRoot}" "${curation}" ${flags} "user" "we chose X over Y" "5"`);
  const track = (...rels: string[]): void => {
    for (const rel of rels) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), 'content of the repository\n');
    }
    git('add', '-f', '--', ...rels);
  };
  const rowCount = (file: string): number => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).length : 0);

  it('an untracked project costs one git call when both roots are equal, and the row is still built once', () => {
    const { exitCode } = both();

    expect(exitCode).toBe(0);
    expect(listCalls()).toHaveLength(1);
    expect(rowCount(memory)).toBe(1);
    expect(rowCount(curation)).toBe(1);
    expect(forks().filter((f) => f === 'jq' || f === 'node')).toHaveLength(1);
  });

  it('roots that differ cost one call each, and one queue on costs one call', () => {
    const other = path.join(tmpDir, 'main-checkout');
    fs.mkdirSync(other);
    execSync('git init -q', { cwd: other, stdio: 'pipe' });
    reset();

    expect(both('"true" "true"', root, other).exitCode).toBe(0);
    expect(listCalls()).toHaveLength(2);

    reset();
    expect(both('"false" "true"').exitCode).toBe(0);
    expect(listCalls()).toHaveLength(1);

    reset();
    expect(both('"false" "false"').exitCode).toBe(0);
    expect(listCalls(), 'neither queue on: nothing asked').toHaveLength(0);
    expect(forks()).toEqual([]);
  });

  it('the same root and area are asked once per process', () => {
    const { exitCode } = run(`
      queue_append_both "${root}" "${memory}" "${root}" "${curation}" "true" "true" "user" "one" "1"
      queue_append_both "${root}" "${memory}" "${root}" "${curation}" "true" "true" "user" "two" "2"
      queue_append_row "${root}" "${memory}" "user" "three" "3"
    `);

    expect(exitCode).toBe(0);
    expect(listCalls()).toHaveLength(1);
    expect(rowCount(memory)).toBe(3);
    expect(rowCount(curation)).toBe(2);
  });

  it('a root with no .git entry makes no git call and appends as before', () => {
    fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });

    expect(both().exitCode).toBe(0);

    expect(listCalls()).toHaveLength(0);
    expect(rowCount(memory)).toBe(1);
    expect(rowCount(curation)).toBe(1);
  });

  it('a tracked curation queue reads as off for the call: the row is built once, memory takes it, curation is left alone with one log line', () => {
    track('.devflow/curation/.pending-turns.jsonl');
    const before = fs.readFileSync(curation, 'utf-8');

    const { exitCode, stdout } = both();

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(curation, 'utf-8')).toBe(before);
    expect(rowCount(memory)).toBe(1);
    expect(stdout.match(/LOG: Queue skipped: the curation area is paused/g)).toHaveLength(1);
    expect(stdout).not.toContain('the memory area is paused');
    expect(listCalls(), 'one union call, then one call per area').toHaveLength(3);
    expect(forks().filter((f) => f === 'jq' || f === 'node')).toHaveLength(1);
  });

  it('a tracked memory queue reads as off for the call: curation takes the row', () => {
    track('.devflow/memory/.pending-turns.jsonl');

    const { stdout } = both();

    expect(rowCount(memory), 'the tracked queue holds its own row only').toBe(1);
    expect(fs.readFileSync(memory, 'utf-8')).toBe('content of the repository\n');
    expect(rowCount(curation)).toBe(1);
    expect(stdout).toContain('LOG: Queue skipped: the memory area is paused');
  });

  it('both areas paused: nothing is built, so no jq or node process runs, and no file is made', () => {
    track('.devflow/memory/.pending-turns.jsonl', '.devflow/curation/.pending-turns.jsonl');
    reset();

    const { exitCode, stdout } = both();

    expect(exitCode).toBe(0);
    expect(forks()).toEqual([]);
    expect(stdout.match(/LOG: Queue skipped/g)).toHaveLength(2);
    expect(fs.readFileSync(curation, 'utf-8')).toBe('content of the repository\n');
  });

  it('git that fails reads as unknown: both queues are paused and no folder is made', () => {
    fs.rmSync(path.join(root, '.git', 'HEAD'));
    fs.rmSync(path.join(root, '.devflow'), { recursive: true, force: true });

    const { exitCode } = both();

    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(root, '.devflow'))).toBe(false);
  });

  it('queue_append_row asks for the area of its queue: a tracked memory queue is skipped, the curation queue is not', () => {
    track('.devflow/memory/.pending-turns.jsonl');

    const { exitCode, stdout } = run(`
      queue_append_row "${root}" "${memory}" "user" "memory row" "1"
      queue_append_row "${root}" "${curation}" "user" "curation row" "2"
    `);

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(memory, 'utf-8')).toBe('content of the repository\n');
    expect(rowCount(curation)).toBe(1);
    expect(stdout.match(/LOG: Queue skipped: the memory area is paused/g)).toHaveLength(1);
  });

  it('queue_append_row for the old ledger folder asks the curation area', () => {
    track('.devflow/learning/notes.txt');
    const queue = path.join(root, '.devflow', 'learning', '.pending-turns.jsonl');

    const { exitCode, stdout } = run(`queue_append_row "${root}" "${queue}" "user" "row" "1"`);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(queue)).toBe(false);
    expect(stdout).toContain('LOG: Queue skipped: the curation area is paused');
  });

  it('queue_append_row for a queue in neither area is paused when either area is', () => {
    track('.devflow/memory/note.txt');
    const elsewhere = path.join(root, 'elsewhere', '.pending-turns.jsonl');

    expect(run(`queue_append_row "${root}" "${elsewhere}" "user" "row" "1"`).exitCode).toBe(0);

    expect(fs.existsSync(elsewhere)).toBe(false);
  });

  it('is not ended under set -e by an untracked, tracked or unanswered area', () => {
    const broken = path.join(tmpDir, 'broken');
    fs.mkdirSync(path.join(broken, '.git'), { recursive: true });

    const { exitCode, stdout } = run(`
      queue_tracked_area "${root}" both git
      echo "after-untracked"
      mkdir -p "${root}/.devflow/memory" && echo x > "${root}/.devflow/memory/n.txt" && git -C "${root}" add -f .devflow/memory/n.txt
      _QTA_ASKED_CURATION=""; _QTA_ASKED_MEMORY=""
      queue_tracked_area "${root}" both git
      echo "after-tracked cur=$DF_TRACKED_AREA_CURATION mem=$DF_TRACKED_AREA_MEMORY"
      queue_tracked_area "/no/such/root" memory git
      echo "after-no-git mem=$DF_TRACKED_AREA_MEMORY"
      queue_tracked_area "${broken}" memory git
      echo "after-unknown mem=$DF_TRACKED_AREA_MEMORY"
    `);

    expect(exitCode).toBe(0);
    expect(stdout.trim().split('\n')).toEqual([
      'after-untracked',
      'after-tracked cur=untracked mem=tracked',
      'after-no-git mem=untracked',
      'after-unknown mem=unknown',
    ]);
  });
});

describe('every gate caller hands queue_read_gates its checkout root', () => {
  // D-FEATURES-NARROW-ONLY: a caller that omits <root> would silently ignore the
  // repository's narrowing, so the call shape is pinned across all of them.
  const CALLERS = [
    'capture-prompt', 'capture-turn', 'capture-question', 'memory-worker',
    'pre-compact-memory', 'session-start-memory', 'background-memory-update', 'session-start-context',
  ];

  it('the caller list is every hook that calls the gate', () => {
    const callers = fs.readdirSync(HOOKS_DIR)
      .filter((f) => f !== 'queue-append' && fs.statSync(path.join(HOOKS_DIR, f)).isFile())
      .filter((f) => /^\s*queue_read_gates /m.test(fs.readFileSync(path.join(HOOKS_DIR, f), 'utf-8')))
      .sort();
    expect(callers).toEqual([...CALLERS].sort());
  });

  it.each(CALLERS)('%s passes "$PROJECT_ROOT" as <root>', (hook) => {
    const calls = fs.readFileSync(path.join(HOOKS_DIR, hook), 'utf-8')
      .split('\n')
      .filter((l) => /^\s*queue_read_gates /.test(l));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.trim()).toMatch(/^queue_read_gates "[^"]+" "\$PROJECT_ROOT"$/);
  });
});
