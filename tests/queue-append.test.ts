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
import { SETTINGS_SWITCH_TABLE, type SwitchRow } from './fixtures/settings-switch-table.js';
import { HOOK_RUN_ALLOWANCE_MS, NODE_EXEC_STALL_MS } from './shell-hooks-helpers.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');
const QUEUE_APPEND = path.join(HOOKS_DIR, 'queue-append');

/** Source the full dependency chain queue-append needs, then run `script`. */
function runWithQueueAppend(script: string, env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; exitCode: number } {
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

    it('keeps the memory and the learning queue at mode 0600 through the trim, whatever the caller umask', () => {
      // A queue holds captured conversation text, so it is created 0600. The trim
      // replaces it with a renamed copy, and from then on the file has the copy's
      // mode. Both queues take this path (queue_append_both -> queue_append_row),
      // and a hook runs under its parent's umask, typically 022.
      const mem = path.join(tmpDir, 'mem.jsonl');
      const learning = path.join(tmpDir, 'learning.jsonl');
      const modeOf = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8);
      const rowsOf = (file: string): number => readJsonl(file).length;
      const append = (content: string, ts: number): void => {
        const { exitCode, stderr } = runWithQueueAppend(`
          umask 022
          queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${learning}" "true" "true" "user" "${content}" "${ts}"
        `);
        expect(exitCode, stderr).toBe(0);
      };

      // The helper creates both files; rows 2..200 are appended directly, which
      // keeps the mode, so the precondition is a helper-made 0600 file at the cap.
      append('row-1', 1);
      const rest = Array.from({ length: 199 }, (_, i) =>
        JSON.stringify({ role: 'user', content: `row-${i + 2}`, ts: i + 2 }) + '\n').join('');
      for (const q of [mem, learning]) {
        fs.appendFileSync(q, rest);
        expect(rowsOf(q), `${path.basename(q)} must sit at the cap before the trim`).toBe(200);
        expect(modeOf(q), `${path.basename(q)} must start at 0600`).toBe('600');
      }

      append('row-201', 201);

      for (const q of [mem, learning]) {
        const rows = readJsonl(q);
        expect(rows, `${path.basename(q)} must have been trimmed`).toHaveLength(100);
        expect(rows[rows.length - 1].content).toBe('row-201');
        expect(modeOf(q), `${path.basename(q)} must keep 0600 after the trim`).toBe('600');
      }
      expect(fs.readdirSync(tmpDir).sort(), 'no temporary copy or lock is left behind').toEqual(['learning.jsonl', 'mem.jsonl']);
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
source "${path.join(HOOKS_DIR, 'learning-lock')}"
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
source "${path.join(HOOKS_DIR, 'learning-lock')}"
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
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${learning}" "true" "true" "user" "hi" "1"`);
    expect(readJsonl(mem)).toHaveLength(1);
    expect(readJsonl(learning)).toHaveLength(1);
  });

  it('writes only to the memory queue when learning_enabled is false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${learning}" "true" "false" "user" "hi" "1"`);
    expect(readJsonl(mem)).toHaveLength(1);
    expect(fs.existsSync(learning)).toBe(false);
  });

  it('writes only to the learning queue when memory_enabled is false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${learning}" "false" "true" "user" "hi" "1"`);
    expect(fs.existsSync(mem)).toBe(false);
    expect(readJsonl(learning)).toHaveLength(1);
  });

  it('writes to neither queue when both flags are false', () => {
    const mem = path.join(tmpDir, 'mem.jsonl');
    const learning = path.join(tmpDir, 'learning.jsonl');
    runWithQueueAppend(`queue_append_both "${tmpDir}" "${mem}" "${tmpDir}" "${learning}" "false" "false" "user" "hi" "1"`);
    expect(fs.existsSync(mem)).toBe(false);
    expect(fs.existsSync(learning)).toBe(false);
  });
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
});

describe('queue_read_gates', () => {
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

  function readGates(manifest: Raw, opts: { noJq?: boolean } = {}): { memory: string; learning: string; exitCode: number } {
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (manifest !== null) fs.writeFileSync(manifestPath, manifest);
    const { stdout, exitCode } = runWithQueueAppend(`
      ${opts.noJq ? '_HAS_JQ=false' : ''}
      queue_read_gates "${manifestPath}"
      echo "MEMORY=$_QG_MEMORY"
      echo "LEARNING=$_QG_LEARNING"
    `);
    return {
      memory: stdout.match(/MEMORY=(\S*)/)?.[1] ?? '',
      learning: stdout.match(/LEARNING=(\S*)/)?.[1] ?? '',
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
          memory: 'true', learning: 'false', exitCode: 0,
        });
        expect(gates(manifestWith({ memory: false, learning: true }))).toMatchObject({
          memory: 'false', learning: 'true', exitCode: 0,
        });
      });

      it('each switch clears only its own gate', () => {
        expect(gates(manifestWith({ memory: false, learning: false }))).toMatchObject({ memory: 'false', learning: 'false' });
        expect(gates(manifestWith({ learning: false }))).toMatchObject({ memory: 'true', learning: 'false' });
        expect(gates(manifestWith({ memory: false }))).toMatchObject({ memory: 'false', learning: 'true' });
      });

      it('no manifest file → both on (fail-open)', () => {
        expect(gates(null)).toMatchObject({ memory: 'true', learning: 'true', exitCode: 0 });
      });

      it('a manifest without the keys → both on (fail-open)', () => {
        expect(gates(manifestWith({ ambient: true }))).toMatchObject({ memory: 'true', learning: 'true' });
      });

      it('a malformed manifest fails open', () => {
        for (const raw of ['{ not json', '[1, 2]', JSON.stringify({ features: 'nope' }), JSON.stringify({ features: [false] })]) {
          expect(gates(raw), raw).toMatchObject({ memory: 'true', learning: 'true', exitCode: 0 });
        }
      });

      it('only an explicit boolean false is the switch (a string "false" is not)', () => {
        expect(gates(manifestWith({ memory: 'false', learning: 0 }))).toMatchObject({ memory: 'true', learning: 'true' });
      });

      it('learning falls back to the legacy decisions key, mirroring readManifest (D-LEARNING-LEGACY-DECISIONS)', () => {
        expect(gates(manifestWith({ memory: true, decisions: false }))).toMatchObject({ memory: 'true', learning: 'false', exitCode: 0 });
        expect(gates(manifestWith({ decisions: true }))).toMatchObject({ memory: 'true', learning: 'true' });
        // An explicit boolean learning wins over the legacy key, either way.
        expect(gates(manifestWith({ decisions: false, learning: true }))).toMatchObject({ learning: 'true' });
        expect(gates(manifestWith({ decisions: true, learning: false }))).toMatchObject({ learning: 'false' });
        // A non-boolean learning is not a value, so the legacy key decides; a
        // non-boolean decisions decides nothing.
        expect(gates(manifestWith({ decisions: false, learning: 'yes' }))).toMatchObject({ learning: 'false' });
        expect(gates(manifestWith({ decisions: 'false' }))).toMatchObject({ learning: 'true' });
      }, 15000);

      it('an escaped key still switches off (a \\u escape always takes the full parse)', () => {
        // JSON.parse and jq decode "memory" to "memory"; the builtin fast
        // path cannot see through an escape, so it must never decide such a file.
        const raw = '{"features":{"m\\u0065mory":false,"le\\u0061rning":false}}';
        expect(gates(raw)).toMatchObject({ memory: 'false', learning: 'false', exitCode: 0 });
        expect(gates('{"features":{"d\\u0065cisions":false}}')).toMatchObject({ memory: 'true', learning: 'false' });
      });

      it('forks no parser when no switch can be off, and exactly one when one can (D-GATES-FAST-PATH)', () => {
        // Every capture hook and session start pays this read. A manifest whose
        // text holds no `"memory"|"learning"|"decisions": false` cannot switch
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
            echo "MEMORY=$_QG_MEMORY LEARNING=$_QG_LEARNING"
          `);
          const forks = fs.existsSync(forkLog) ? fs.readFileSync(forkLog, 'utf-8').trim().split('\n').length : 0;
          return { stdout, exitCode, forks };
        };

        // A real manifest carries other `false` values (proxy, compliance.enabled);
        // they are not switches and must not cost a fork.
        const on = probe(JSON.stringify({
          version: '2.0.0',
          features: { ambient: true, memory: true, learning: true, proxy: false, compliance: { enabled: false } },
        }, null, 2));
        expect(on).toMatchObject({ exitCode: 0, forks: 0 });
        expect(on.stdout).toContain('MEMORY=true LEARNING=true');

        const off = probe(JSON.stringify({ features: { memory: false } }, null, 2));
        expect(off).toMatchObject({ exitCode: 0, forks: 1 });
        expect(off.stdout).toContain('MEMORY=false LEARNING=true');
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
      echo "MEMORY=$_QG_MEMORY LEARNING=$_QG_LEARNING"
    `);
    expect(stdout).toContain('MEMORY=true LEARNING=true');
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

/**
 * The budget of every test in the group below: one sourced queue-append run plus
 * one node exec that may meet the syspolicyd wait. A gate read execs node at
 * most once — the resolver's fold when a repository file can narrow, else the
 * node-backend manifest parse (TP-34 pins it) — and the manifest parse that
 * follows only a failed fold would meet a drained queue.
 */
const GATE_READ_TEST_BUDGET_MS = HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS;

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

  function gatesAt(opts: { noJq?: boolean; env?: NodeJS.ProcessEnv } = {}): { memory: string; learning: string; exitCode: number } {
    const { stdout, exitCode } = runWithQueueAppend(`
      ${opts.noJq ? '_HAS_JQ=false' : ''}
      queue_read_gates "${manifestPath}" "${root}"
      echo "MEMORY=$_QG_MEMORY"
      echo "LEARNING=$_QG_LEARNING"
    `, opts.env);
    return {
      memory: stdout.match(/MEMORY=(\S*)/)?.[1] ?? '',
      learning: stdout.match(/LEARNING=(\S*)/)?.[1] ?? '',
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
          learning: String(row.expect.learning),
          exitCode: 0,
        });
      });
    });
  }

  it('a symlinked project.json narrows nothing (the parser never follows one)', () => {
    const target = path.join(tmpDir, 'elsewhere.json');
    fs.writeFileSync(target, '{"features":{"memory":false,"learning":false}}');
    fs.symlinkSync(target, path.join(root, '.devflow', 'project.json'));
    expect(gatesAt()).toEqual({ memory: 'true', learning: 'true', exitCode: 0 });
  });

  it('a directory or FIFO where a file belongs is skipped without blocking', () => {
    fs.mkdirSync(path.join(root, '.devflow', 'project.json'));
    execSync(`mkfifo "${path.join(root, '.devflow', 'config.json')}"`);
    expect(gatesAt()).toEqual({ memory: 'true', learning: 'true', exitCode: 0 });
  });

  it('an empty <root> reads no repository file', () => {
    writeLayers({ manifest: undefined, project: '{"features":{"memory":false}}', personal: null });
    const { stdout } = runWithQueueAppend(`
      queue_read_gates "${manifestPath}" ""
      echo "MEMORY=$_QG_MEMORY LEARNING=$_QG_LEARNING"
    `);
    expect(stdout).toContain('MEMORY=true LEARNING=true');
  });

  it('never exits non-zero with a narrowing file (set -e safety)', () => {
    writeLayers({ manifest: undefined, project: '{"features":{"memory":false,"learning":false}}', personal: null });
    expect(gatesAt()).toEqual({ memory: 'false', learning: 'false', exitCode: 0 });
  });

  // TP-34 (AC-30): the fork budget. Every capture hook and session start pays
  // this read, so a repository file that cannot narrow must cost nothing. The
  // counter is a PATH shim: `node` and `jq` stand-ins that log each exec and hand
  // over to the real binary, so every parser fork is seen however it is spelled.
  describe('TP-34 (AC-30): zero parser forks unless a file can narrow, exactly one when one can', () => {
    let shimDir: string;
    let forkLog: string;

    const realBinary = (name: string): string | null => {
      try {
        return execSync(`command -v ${name}`, { shell: '/bin/bash' }).toString().trim() || null;
      } catch {
        return null;
      }
    };

    beforeEach(() => {
      shimDir = path.join(tmpDir, 'shim');
      forkLog = path.join(tmpDir, 'forks.log');
      fs.mkdirSync(shimDir);
      for (const name of ['node', 'jq']) {
        const real = realBinary(name);
        if (real === null) continue;
        const shim = path.join(shimDir, name);
        fs.writeFileSync(shim, `#!/bin/bash\necho ${name} >> "${forkLog}"\nexec "${real}" "$@"\n`);
        fs.chmodSync(shim, 0o755);
      }
    });

    const forks = (): string[] => (fs.existsSync(forkLog) ? fs.readFileSync(forkLog, 'utf-8').trim().split('\n').filter(Boolean) : []);
    const shimEnv = (): NodeJS.ProcessEnv => ({ ...process.env, PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}` });
    const MANIFEST = { version: '2.5.0', features: { memory: true, learning: true, knowledge: true, proxy: false } };

    for (const backend of [{ name: 'jq', noJq: false }, { name: 'node fallback', noJq: true }]) {
      describe(`${backend.name} backend`, () => {
        const probe = () => gatesAt({ noJq: backend.noJq, env: shimEnv() });

        it('no repository files: zero forks', () => {
          writeLayers({ manifest: MANIFEST, project: null, personal: null });
          expect(probe()).toEqual({ memory: 'true', learning: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('repository files free of false: zero forks', () => {
          writeLayers({
            manifest: MANIFEST,
            project: JSON.stringify({
              version: 1, evidence: 'required', compliance: ['gdpr'],
              tracker: { provider: 'jira', site: 'https://acme.atlassian.net', key: 'ACME' },
              reviewPublication: 'auto', features: { memory: true, learning: true },
            }, null, 2),
            personal: '{"reviewPublication":"full","tracker":"github"}',
          });
          expect(probe()).toEqual({ memory: 'true', learning: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('a false that is not a memory or learning switch: zero forks', () => {
          // The legacy top-level keys sit before `features`, and knowledge and
          // decisions have no shell gate: none of them can narrow a queue.
          writeLayers({
            manifest: MANIFEST,
            project: '{"memory":false,"learning":false,"decisions":false,"features":{"knowledge":false,"decisions":false}}',
            personal: '{"memory":false,"features":{"knowledge":false}}',
          });
          expect(probe()).toEqual({ memory: 'true', learning: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });

        it('project.json features.learning false: exactly one fork, learning off', () => {
          writeLayers({ manifest: MANIFEST, project: '{"version":1,"features":{"learning":false}}', personal: null });
          expect(probe()).toEqual({ memory: 'true', learning: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('a false in the manifest and in both repository files: still exactly one fork', () => {
          writeLayers({
            manifest: { features: { memory: false, learning: true } },
            project: '{"features":{"learning":false}}',
            personal: '{"features":{"memory":false}}',
          });
          expect(probe()).toEqual({ memory: 'false', learning: 'false', exitCode: 0 });
          expect(forks()).toEqual(['node']);
        });

        it('an oversize or NUL-cut file: zero forks (the bounded read already knows it is invalid)', () => {
          writeLayers({
            manifest: MANIFEST,
            project: '{"features":{"memory":false},"pad":"' + 'x'.repeat(5000) + '"}',
            personal: '{"features":{"learning":false}}\u0000',
          });
          expect(probe()).toEqual({ memory: 'true', learning: 'true', exitCode: 0 });
          expect(forks()).toEqual([]);
        });
      });
    }
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
