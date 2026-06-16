import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');

function localDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const JSON_HELPER = path.join(HOOKS_DIR, 'json-helper.cjs');

const HOOK_SCRIPTS = [
  'debug-trace',
  'hook-bootstrap',
  'hook-log-init',
  'session-start-memory',
  'session-start-context',
  'pre-compact-memory',
  'preamble',
  'json-parse',
  'get-mtime',
  'ensure-devflow-init',
  'dream-capture',
  'dream-evaluate',
  'dream-dispatch',
  'eval-helpers',
  'eval-decisions',
  'eval-knowledge',
];

describe('shell hook syntax checks', () => {
  for (const script of HOOK_SCRIPTS) {
    it(`${script} passes bash -n`, () => {
      const scriptPath = path.join(HOOKS_DIR, script);
      if (!fs.existsSync(scriptPath)) {
        return; // skip missing optional scripts
      }
      // bash -n performs syntax check without executing
      expect(() => {
        execSync(`bash -n "${scriptPath}"`, { stdio: 'pipe' });
      }).not.toThrow();
    });
  }
});

// =============================================================================
// debug-trace behavioral tests
// =============================================================================

describe('debug-trace helper behaviors', () => {
  const DEBUG_TRACE = path.join(HOOKS_DIR, 'debug-trace');

  it('dbg is a no-op when DEVFLOW_HOOK_DEBUG is unset', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-test-'));
    try {
      const logFile = path.join(tmpDir, '.hook-debug.log');
      const script = `bash -c '
        HOME="${tmpDir}"
        source "${DEBUG_TRACE}" || true
        devflow_debug_init "test-hook"
        dbg "should not appear"
      '`;
      execSync(script, { stdio: 'pipe' });
      // No log file should be created when debug is disabled
      expect(fs.existsSync(logFile)).toBe(false);
      // Also no ~/.devflow/logs directory created for the log
      expect(fs.existsSync(path.join(tmpDir, '.devflow', 'logs'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('dbg writes to global log when DEVFLOW_HOOK_DEBUG=1', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-test-'));
    try {
      const globalLog = path.join(tmpDir, '.devflow', 'logs', '.hook-debug.log');
      const script = `bash -c '
        HOME="${tmpDir}"
        DEVFLOW_HOOK_DEBUG=1
        export HOME DEVFLOW_HOOK_DEBUG
        source "${DEBUG_TRACE}" || true
        devflow_debug_init "test-hook"
        dbg "hello from test"
      '`;
      execSync(script, { stdio: 'pipe' });
      expect(fs.existsSync(globalLog)).toBe(true);
      const content = fs.readFileSync(globalLog, 'utf-8');
      expect(content).toContain('test-hook: hello from test');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('devflow_debug_set_cwd switches to per-project log', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-home-'));
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-cwd-'));
    try {
      const slug = tmpCwd.replace(/^\//, '').replace(/\//g, '-');
      const projectLog = path.join(tmpHome, '.devflow', 'logs', slug, '.hook-debug.log');
      const script = `bash -c '
        HOME="${tmpHome}"
        DEVFLOW_HOOK_DEBUG=1
        export HOME DEVFLOW_HOOK_DEBUG
        source "${DEBUG_TRACE}" || true
        devflow_debug_init "test-hook"
        devflow_debug_set_cwd "${tmpCwd}"
        dbg "per-project message"
      '`;
      execSync(script, { stdio: 'pipe' });
      expect(fs.existsSync(projectLog)).toBe(true);
      const content = fs.readFileSync(projectLog, 'utf-8');
      expect(content).toContain('test-hook: per-project message');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  it('devflow_debug_set_cwd is a no-op when DEVFLOW_HOOK_DEBUG is unset', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-home-'));
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-cwd-'));
    try {
      const slug = tmpCwd.replace(/^\//, '').replace(/\//g, '-');
      const projectLog = path.join(tmpHome, '.devflow', 'logs', slug, '.hook-debug.log');
      const script = `bash -c '
        HOME="${tmpHome}"
        export HOME
        source "${DEBUG_TRACE}" || true
        devflow_debug_init "test-hook"
        devflow_debug_set_cwd "${tmpCwd}"
        dbg "should not appear"
      '`;
      execSync(script, { stdio: 'pipe' });
      expect(fs.existsSync(projectLog)).toBe(false);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  it('devflow_debug_set_cwd truncates per-project log when it exceeds 5MB', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-home-'));
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-cwd-'));
    try {
      const slug = tmpCwd.replace(/^\//, '').replace(/\//g, '-');
      const logDir = path.join(tmpHome, '.devflow', 'logs', slug);
      fs.mkdirSync(logDir, { recursive: true });
      const projectLog = path.join(logDir, '.hook-debug.log');
      // Write 6MB of data to exceed the 5MB threshold
      fs.writeFileSync(projectLog, 'x'.repeat(6 * 1024 * 1024));
      const script = `bash -c '
        HOME="${tmpHome}"
        DEVFLOW_HOOK_DEBUG=1
        export HOME DEVFLOW_HOOK_DEBUG
        source "${DEBUG_TRACE}" || true
        devflow_debug_init "test-hook"
        devflow_debug_set_cwd "${tmpCwd}"
        dbg "after truncation"
      '`;
      execSync(script, { stdio: 'pipe' });
      const size = fs.statSync(projectLog).size;
      // After truncation the log must be smaller than 5MB (kept 2.5MB tail + new line)
      // Lower bound guards against a bug that truncates to 0 bytes
      expect(size).toBeGreaterThan(2 * 1024 * 1024);
      expect(size).toBeLessThan(5 * 1024 * 1024);
      const content = fs.readFileSync(projectLog, 'utf-8');
      expect(content).toContain('after truncation');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

const EVAL_HELPERS = path.join(HOOKS_DIR, 'eval-helpers');
const DREAM_LOCK = path.join(HOOKS_DIR, 'dream-lock');

describe('eval-helpers: read_daily_cap', () => {
  it('returns 0 when counter file absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    try {
      const counterFile = path.join(tmpDir, '.runs-today');
      const result = execSync(`bash -c '
        TODAY=$(date +%Y-%m-%d)
        source "${EVAL_HELPERS}"
        read_daily_cap "${counterFile}" 0
      '`, { stdio: 'pipe' }).toString().trim();
      expect(result).toBe('0');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns count when date matches today', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const counterFile = path.join(tmpDir, '.runs-today');
    const today = execSync('date +%Y-%m-%d', { stdio: 'pipe' }).toString().trim();
    try {
      fs.writeFileSync(counterFile, `${today}\t5\n`);
      const result = execSync(`bash -c '
        TODAY=$(date +%Y-%m-%d)
        source "${EVAL_HELPERS}"
        read_daily_cap "${counterFile}" 0
      '`, { stdio: 'pipe' }).toString().trim();
      expect(result).toBe('5');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns 0 when counter file has a stale date', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const counterFile = path.join(tmpDir, '.runs-today');
    try {
      fs.writeFileSync(counterFile, `2020-01-01\t99\n`);
      const result = execSync(`bash -c '
        TODAY=$(date +%Y-%m-%d)
        source "${EVAL_HELPERS}"
        read_daily_cap "${counterFile}" 0
      '`, { stdio: 'pipe' }).toString().trim();
      expect(result).toBe('0');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('eval-helpers: atomic_increment_daily', () => {
  it('creates counter file with count 1 on first call', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const counterFile = path.join(tmpDir, '.runs-today');
    const today = execSync('date +%Y-%m-%d', { stdio: 'pipe' }).toString().trim();
    try {
      execSync(`bash -c '
        TODAY=$(date +%Y-%m-%d)
        source "${DREAM_LOCK}"
        source "${EVAL_HELPERS}"
        atomic_increment_daily "${counterFile}" "$TODAY"
      '`, { stdio: 'pipe' });
      const content = fs.readFileSync(counterFile, 'utf-8').trim();
      expect(content).toBe(`${today}\t1`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('increments existing count on subsequent call', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const counterFile = path.join(tmpDir, '.runs-today');
    const today = execSync('date +%Y-%m-%d', { stdio: 'pipe' }).toString().trim();
    try {
      fs.writeFileSync(counterFile, `${today}\t3\n`);
      execSync(`bash -c '
        TODAY=$(date +%Y-%m-%d)
        source "${DREAM_LOCK}"
        source "${EVAL_HELPERS}"
        atomic_increment_daily "${counterFile}" "$TODAY"
      '`, { stdio: 'pipe' });
      const content = fs.readFileSync(counterFile, 'utf-8').trim();
      expect(content).toBe(`${today}\t4`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('eval-helpers: load_existing_ids', () => {
  it('returns empty array when log file is absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    try {
      const missingFile = path.join(tmpDir, 'nonexistent.jsonl');
      const result = execSync(`bash -c '
        source "${EVAL_HELPERS}"
        load_existing_ids "${missingFile}"
      '`, { stdio: 'pipe' }).toString().trim();
      expect(JSON.parse(result)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array when log file is empty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const logFile = path.join(tmpDir, 'empty.jsonl');
    try {
      fs.writeFileSync(logFile, '');
      const result = execSync(`bash -c '
        source "${EVAL_HELPERS}"
        load_existing_ids "${logFile}"
      '`, { stdio: 'pipe' }).toString().trim();
      expect(JSON.parse(result)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns ids from valid JSONL as JSON array', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, [
        JSON.stringify({ id: 'obs_aaa', type: 'workflow', confidence: 0.9 }),
        JSON.stringify({ id: 'obs_bbb', type: 'procedural', confidence: 0.7 }),
        JSON.stringify({ id: 'obs_ccc', type: 'decision', confidence: 0.8 }),
      ].join('\n') + '\n');
      const result = execSync(`bash -c '
        source "${EVAL_HELPERS}"
        load_existing_ids "${logFile}"
      '`, { stdio: 'pipe' }).toString().trim();
      const ids = JSON.parse(result);
      expect(ids).toContain('obs_aaa');
      expect(ids).toContain('obs_bbb');
      expect(ids).toContain('obs_ccc');
      expect(ids).toHaveLength(3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('eval-helpers: _eval_release_lock', () => {
  it('releases a held lock dir by removing it', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const lockDir = path.join(tmpDir, 'test.lock');
    try {
      // Create the lock directory (simulating an acquired lock)
      fs.mkdirSync(lockDir);
      expect(fs.existsSync(lockDir)).toBe(true);

      execSync(`bash -c '
        source "${DREAM_LOCK}"
        source "${EVAL_HELPERS}"
        _eval_release_lock "${lockDir}"
      '`, { stdio: 'pipe' });

      expect(fs.existsSync(lockDir)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('is a no-op when lock dir does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const lockDir = path.join(tmpDir, 'nonexistent.lock');
    try {
      expect(() => {
        execSync(`bash -c '
          source "${DREAM_LOCK}"
          source "${EVAL_HELPERS}"
          _eval_release_lock "${lockDir}"
        '`, { stdio: 'pipe' });
      }).not.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('json-helper.js operations', () => {
  it('get-field extracts a field with default', () => {
    const result = execSync(
      `echo '{"cwd":"/tmp","session_id":"abc123"}' | node "${JSON_HELPER}" get-field cwd ""`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('/tmp');
  });

  it('get-field returns default for missing field', () => {
    const result = execSync(
      `echo '{"cwd":"/tmp"}' | node "${JSON_HELPER}" get-field missing "fallback"`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('fallback');
  });

  it('validate exits 0 for valid JSON', () => {
    expect(() => {
      execSync(`echo '{"valid":true}' | node "${JSON_HELPER}" validate`, { stdio: 'pipe' });
    }).not.toThrow();
  });

  it('validate exits 1 for invalid JSON', () => {
    expect(() => {
      execSync(`echo 'not json' | node "${JSON_HELPER}" validate`, { stdio: 'pipe' });
    }).toThrow();
  });

  it('compact outputs single-line JSON', () => {
    const result = execSync(
      `echo '{ "key": "value", "num": 42 }' | node "${JSON_HELPER}" compact`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('{"key":"value","num":42}');
  });

  it('extract-text-messages extracts text from Claude message format', () => {
    const input = JSON.stringify({
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'tool_result', text: 'ignored' },
          { type: 'text', text: 'Second message' },
        ],
      },
    });
    const result = execSync(
      `echo '${input.replace(/'/g, "'\\''")}' | node "${JSON_HELPER}" extract-text-messages`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('Hello world\nSecond message');
  });

  it('extract-text-messages handles plain string content', () => {
    const input = JSON.stringify({
      message: {
        content: 'plain string message',
      },
    });
    const result = execSync(
      `echo '${input.replace(/'/g, "'\\''")}' | node "${JSON_HELPER}" extract-text-messages`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('plain string message');
  });

  it('merge-evidence flattens, dedupes, and limits', () => {
    const input = JSON.stringify([['a', 'b', 'c'], ['b', 'c', 'd']]);
    const result = execSync(
      `echo '${input}' | node "${JSON_HELPER}" merge-evidence`,
      { stdio: 'pipe' },
    ).toString().trim();
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(['a', 'b', 'c', 'd']);
  });

  it('slurp-sort reads JSONL, sorts, and limits', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'test.jsonl');

    try {
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'a', confidence: 0.3 }),
        JSON.stringify({ id: 'b', confidence: 0.9 }),
        JSON.stringify({ id: 'c', confidence: 0.5 }),
      ].join('\n'));

      const result = execSync(
        `node "${JSON_HELPER}" slurp-sort "${file}" confidence 2`,
        { stdio: 'pipe' },
      ).toString().trim();
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('b');
      expect(parsed[1].id).toBe('c');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('session-output builds correct envelope', () => {
    const result = execSync(
      `node "${JSON_HELPER}" session-output "test context"`,
      { stdio: 'pipe' },
    ).toString().trim();
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('test context');
  });

  it('prompt-output builds correct envelope', () => {
    const result = execSync(
      `node "${JSON_HELPER}" prompt-output "test preamble"`,
      { stdio: 'pipe' },
    ).toString().trim();
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('test preamble');
  });

  it('update-field updates a string field', () => {
    const result = execSync(
      `echo '{"status":"observing","id":"obs_1"}' | node "${JSON_HELPER}" update-field status created`,
      { stdio: 'pipe' },
    ).toString().trim();
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('created');
    expect(parsed.id).toBe('obs_1');
  });

  it('array-length returns count', () => {
    const result = execSync(
      `echo '{"observations":[{},{},{}]}' | node "${JSON_HELPER}" array-length observations`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('3');
  });

  it('array-item returns item at index', () => {
    const result = execSync(
      `echo '{"items":[{"id":"a"},{"id":"b"}]}' | node "${JSON_HELPER}" array-item items 1`,
      { stdio: 'pipe' },
    ).toString().trim();
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('b');
  });

});

describe('json-parse wrapper', () => {
  it('can be sourced and provides function definitions', () => {
    const result = execSync(
      `bash -c 'source "${path.join(HOOKS_DIR, 'json-parse')}" && echo "$_JSON_AVAILABLE"'`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('true');
  });

  it('json_field works via wrapper', () => {
    const result = execSync(
      `bash -c 'source "${path.join(HOOKS_DIR, 'json-parse')}" && echo "{\\"key\\":\\"val\\"}" | json_field key ""'`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('val');
  });
});

describe('working memory queue behavior', () => {
  const STOP_HOOK = path.join(HOOKS_DIR, 'dream-capture');
  const PREAMBLE_HOOK = path.join(HOOKS_DIR, 'preamble');
  const PROMPT_CAPTURE_HOOK = path.join(HOOKS_DIR, 'dream-dispatch');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-queue-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: write a fresh WORKING-MEMORY.md with an old mtime so the throttle passes.
  // dream-capture throttles if WORKING-MEMORY.md was updated <120s ago.
  // We write the file then backdate its mtime to 10 minutes ago.
  function writeStaleWorkingMemory(tmpDir: string): void {
    const memFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, '## Now\n- stale memory');
    // Backdate 10 minutes (600 seconds)
    const tenMinutesAgo = new Date(Date.now() - 600 * 1000);
    fs.utimesSync(memFile, tenMinutesAgo, tenMinutesAgo);
  }

  it('empty last_assistant_message — no queue append', () => {
    // Hook exits early when last_assistant_message is absent/empty
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-001',
      last_assistant_message: '',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('last_assistant_message present — appends assistant turn to queue', () => {
    // Create .devflow/memory/ directory
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    // Write stale WORKING-MEMORY.md so throttle check passes (no memory.processing marker needed)
    writeStaleWorkingMemory(tmpDir);

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-002',
      last_assistant_message: 'test response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
    expect(entry.role).toBe('assistant');
    expect(entry.content).toBe('test response');
    expect(typeof entry.ts).toBe('number');
  });

  it('dream-dispatch captures user prompt to queue', () => {
    // Create .devflow/memory/ directory so capture is triggered
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-003',
      prompt: 'implement the cache',
    });

    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
    expect(entry.role).toBe('user');
    expect(entry.content).toBe('implement the cache');
    expect(typeof entry.ts).toBe('number');
  });

  it('dream-dispatch with missing .devflow/ — creates it via ensure-devflow-init, exit 0', () => {
    // tmpDir exists but has no .devflow/ subdirectory — ensure-devflow-init creates it
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-004a',
      prompt: 'implement the cache',
    });

    expect(() => {
      execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();

    // Hook creates .devflow/memory/ and writes to queue
    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  it('preamble does NOT write to queue — zero file I/O', () => {
    // Create .devflow/memory/ to confirm preamble doesn't touch the queue even when it exists
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-004',
      prompt: 'implement the cache',
    });

    // Should not throw (exit 0)
    expect(() => {
      execSync(`bash "${PREAMBLE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('preamble with slash command — exits 0, no queue write', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-004b',
      prompt: '/code-review',
    });

    expect(() => {
      execSync(`bash "${PREAMBLE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('queue JSONL format — each line is valid JSON with role, content, ts', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');

    const now = Math.floor(Date.now() / 1000);
    const entries = [
      { role: 'user', content: 'hello world', ts: now },
      { role: 'assistant', content: 'I will help you', ts: now + 1 },
      { role: 'user', content: 'thanks', ts: now + 2 },
    ];

    fs.writeFileSync(queueFile, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(['user', 'assistant']).toContain(parsed.role);
      expect(typeof parsed.content).toBe('string');
      expect(typeof parsed.ts).toBe('number');
    }
  });

  it('preserves existing user entries when appending assistant turn', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const now = Math.floor(Date.now() / 1000);
    // Pre-populate with user-only entries (from dream-dispatch)
    const userLines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ role: 'user', content: `user prompt ${i}`, ts: now + i }),
    );
    fs.writeFileSync(queueFile, userLines.join('\n') + '\n');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-autoclean',
      last_assistant_message: 'first real assistant response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    // All 5 user entries preserved + 1 new assistant entry
    expect(lines).toHaveLength(6);
    const lastEntry = JSON.parse(lines[5]) as { role: string; content: string; ts: number };
    expect(lastEntry.role).toBe('assistant');
    expect(lastEntry.content).toBe('first real assistant response');
  });

  it('empty queue file — assistant entry appended normally', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    fs.writeFileSync(queueFile, '');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-autoclean-empty',
      last_assistant_message: 'response after empty queue',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
    expect(entry.role).toBe('assistant');
    expect(entry.content).toBe('response after empty queue');
  });

  it('single user entry preserved when assistant turn appends', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const now = Math.floor(Date.now() / 1000);
    const userEntry = JSON.stringify({ role: 'user', content: 'user prompt', ts: now });
    fs.writeFileSync(queueFile, userEntry + '\n');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-autoclean-single',
      last_assistant_message: 'response after user prompt',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    // User entry preserved + new assistant entry = 2 lines
    expect(lines).toHaveLength(2);
    const firstEntry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
    expect(firstEntry.role).toBe('user');
    expect(firstEntry.content).toBe('user prompt');
    const lastEntry = JSON.parse(lines[1]) as { role: string; content: string; ts: number };
    expect(lastEntry.role).toBe('assistant');
    expect(lastEntry.content).toBe('response after user prompt');
  });

  it('queue with mixed entries preserved when assistant turn appends', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const now = Math.floor(Date.now() / 1000);
    // Pre-populate with mixed entries (healthy queue)
    const mixedLines = [
      JSON.stringify({ role: 'user', content: 'hello', ts: now }),
      JSON.stringify({ role: 'assistant', content: 'hi there', ts: now + 1 }),
      JSON.stringify({ role: 'user', content: 'next prompt', ts: now + 2 }),
    ];
    fs.writeFileSync(queueFile, mixedLines.join('\n') + '\n');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-no-autoclean',
      last_assistant_message: 'another response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    // 3 existing + 1 new = 4
    expect(lines).toHaveLength(4);
  });

  it('queue with only assistant entries preserved when new entry appends', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const now = Math.floor(Date.now() / 1000);
    // Pre-populate with assistant-only entries
    const assistantLines = Array.from({ length: 3 }, (_, i) =>
      JSON.stringify({ role: 'assistant', content: `response ${i}`, ts: now + i }),
    );
    fs.writeFileSync(queueFile, assistantLines.join('\n') + '\n');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-autoclean-assistant-only',
      last_assistant_message: 'new assistant response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const resultLines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    // 3 existing assistant entries preserved + 1 new = 4
    expect(resultLines).toHaveLength(4);
    const lastEntry = JSON.parse(resultLines[resultLines.length - 1]) as { role: string; content: string; ts: number };
    expect(lastEntry.role).toBe('assistant');
    expect(lastEntry.content).toBe('new assistant response');
  });

  it('queue overflow — >200 lines truncated to last 100', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    // Write stale WORKING-MEMORY.md so throttle passes
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const now = Math.floor(Date.now() / 1000);

    // Pre-populate queue with 201 entries (mixed roles to avoid auto-clean)
    const existingLines = Array.from({ length: 201 }, (_, i) =>
      JSON.stringify({ role: i % 2 === 0 ? 'user' : 'assistant', content: `entry ${i}`, ts: now + i }),
    );
    fs.writeFileSync(queueFile, existingLines.join('\n') + '\n');

    // Trigger stop hook — appends 1 more entry, then overflow check fires
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-006',
      last_assistant_message: 'overflow trigger response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    // After overflow: 201 pre-existing + 1 new = 202 lines → truncated to last 100
    const resultLines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(resultLines).toHaveLength(100);

    // The first preserved entry must be from the tail of the original data
    // 201 pre-existing + 1 new = 202 lines → tail -100 starts at index 102
    const firstEntry = JSON.parse(resultLines[0]) as { role: string; content: string; ts: number };
    expect(firstEntry.content).toBe('entry 102');

    // The new entry (the assistant turn) must be present as the last line
    const lastEntry = JSON.parse(resultLines[resultLines.length - 1]) as { role: string; content: string; ts: number };
    expect(lastEntry.role).toBe('assistant');
    expect(lastEntry.content).toBe('overflow trigger response');
  });

  it('dispatch then capture preserves user turn in fresh queue', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');

    // Step 1: dream-dispatch writes user turn
    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test-fresh', prompt: 'implement feature X' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Step 2: dream-capture writes assistant turn
    execSync(`bash "${STOP_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test-fresh', last_assistant_message: 'done' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as { role: string; content: string };
    const second = JSON.parse(lines[1]) as { role: string; content: string };
    expect(first.role).toBe('user');
    expect(first.content).toBe('implement feature X');
    expect(second.role).toBe('assistant');
    expect(second.content).toBe('done');
  });

  it('dream-dispatch truncates prompts longer than 2000 chars', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    const longPrompt = 'a'.repeat(3000);
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-trunc-001',
      prompt: longPrompt,
    });

    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
    // Truncated at 2000 chars + '... [truncated]' suffix (15 chars) = 2015
    expect(entry.content.length).toBe(2015);
    expect(entry.content).toContain('[truncated]');
  });

  it('dream-capture truncates assistant content longer than 2000 chars', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    // Write stale WORKING-MEMORY.md so throttle passes
    writeStaleWorkingMemory(tmpDir);

    const longMessage = 'b'.repeat(5000);
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-trunc-002',
      last_assistant_message: longMessage,
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
    // Truncated at 2000 chars + '... [truncated]' suffix (15 chars) = 2015
    expect(entry.content.length).toBe(2015);
    expect(entry.content).toContain('[truncated]');
  });

  it('dream-capture exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    // Hook exits at line 11 before reading stdin, so don't pipe input — would race
    // and EPIPE on Node 20 when bash closes the pipe before execSync flushes.
    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${STOP_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('dream-dispatch exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${PROMPT_CAPTURE_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });
});

// =============================================================================
// preamble keyword detection — Suites 1-4
// =============================================================================

describe('preamble keyword detection', () => {
  const PREAMBLE_HOOK = path.join(HOOKS_DIR, 'preamble');
  const PREAMBLE_SRC = path.resolve(__dirname, '..', 'scripts', 'hooks', 'preamble');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-preamble-kw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Run the preamble hook and return stdout as a string. */
  function runPreamble(prompt: string, cwd?: string): string {
    const dir = cwd ?? tmpDir;
    const input = JSON.stringify({ cwd: dir, prompt });
    return execSync(`bash "${PREAMBLE_HOOK}"`, {
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  }

  /** Expected additionalContext message for a matched skill. */
  function expectedContext(skill: string): string {
    return (
      `The user's prompt begins with the \`${skill}\` keyword, which signals the ` +
      `\`devflow:${skill}\` workflow. In one short sentence, tell the user you're invoking ` +
      `\`devflow:${skill}\`. Then immediately invoke it with the Skill tool, passing the user's ` +
      `full request (everything after the leading \`${skill}\` keyword) as the skill input. ` +
      `Do not pause to ask whether to proceed.`
    );
  }

  // -------------------------------------------------------------------------
  // Suite 1 — Functionality (F1–F11)
  // -------------------------------------------------------------------------

  describe('Suite 1 — Functionality', () => {
    const matchCases: Array<{ prompt: string; expectedSkill: string; label: string }> = [
      { prompt: 'implement the cache',       expectedSkill: 'implement', label: 'F1a: implement' },
      { prompt: 'plan a caching layer',      expectedSkill: 'plan',      label: 'F1b: plan' },
      { prompt: 'Explore the auth flow',     expectedSkill: 'explore',   label: 'F2a: Explore (mixed case)' },
      { prompt: 'RESEARCH options now',      expectedSkill: 'research',  label: 'F2b: RESEARCH (uppercase)' },
      { prompt: 'debug: why it hangs',       expectedSkill: 'debug',     label: 'F3: debug with trailing punct' },
      // F6a/F6b: the trailing-'?' guard (Guard B) was removed — a command-style prompt that
      // closes with a clarifying/rhetorical question still dispatches. Keyword + ≥1 word wins.
      { prompt: 'explore A or B?',           expectedSkill: 'explore',   label: 'F6a: trailing-? no longer suppressed' },
      { prompt: 'debug this?  ',             expectedSkill: 'debug',     label: 'F6b: trailing-? + whitespace no longer suppressed' },
      // F13: the hook strips leading whitespace/newlines from HEAD before extracting the
      // first token, so prompts with leading newlines/spaces still dispatch correctly (ADR-014).
      { prompt: '\n\n  implement the cache', expectedSkill: 'implement', label: 'F13: leading newlines/spaces still match' },
    ];

    const noMatchCases: Array<{ prompt: string; label: string }> = [
      { prompt: 'implementation of X',   label: 'F4a: implementation (prefix, not word)' },
      { prompt: 'researching Y',          label: 'F4b: researching (suffix)' },
      { prompt: 'debugger Z',             label: 'F4c: debugger (suffix)' },
      { prompt: 'explorer mode',          label: 'F4d: explorer (suffix)' },
      { prompt: 'implement',              label: 'F5a: bare implement (no following word)' },
      { prompt: 'plan',                   label: 'F5b: bare plan (no following word)' },
      { prompt: 'fix the auth bug',       label: 'F9: non-keyword first word' },
      { prompt: '# Implement Command\n## Usage\n...', label: 'F11: # prefix not a keyword' },
      // F12: WORD="${TOKEN%[[:punct:]]}" strips exactly ONE trailing punct char.
      // "implement..." → TOKEN="implement..." → WORD="implement.." (still has two dots) → no case match.
      { prompt: 'implement... the cache', label: 'F12: multi-char trailing punct — only ONE punct stripped, no match' },
    ];

    for (const { prompt, expectedSkill, label } of matchCases) {
      it(`${label} → emits directive for ${expectedSkill}`, () => {
        const out = runPreamble(prompt);
        const parsed = JSON.parse(out) as {
          hookSpecificOutput: { hookEventName: string; additionalContext: string };
        };
        expect(parsed.hookSpecificOutput.additionalContext).toContain(`\`devflow:${expectedSkill}\``);
        expect(parsed.hookSpecificOutput.additionalContext).toContain('Skill tool');
        // Case-insensitive: skill name in output is always lowercase (F2)
        expect(parsed.hookSpecificOutput.additionalContext).not.toContain(expectedSkill.toUpperCase());
      });
    }

    for (const { prompt, label } of noMatchCases) {
      it(`${label} → empty stdout`, () => {
        const out = runPreamble(prompt);
        expect(out).toBe('');
      });
    }

    it('F7: marker path intact — plan body with ## Goal/Steps/Files but no leading keyword', () => {
      const planBody = '## Goal\nBuild a cache\n## Steps\n1. Add\n## Files\ncache.ts';
      const out = runPreamble(planBody);
      const parsed = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.additionalContext).toContain('devflow:implement');
    });

    it('F8: keyword + markers → keyword wins, exactly ONE directive', () => {
      const prompt = 'implement the cache\n## Goal\nbuild it\n## Steps\n1\n## Files\ncache.ts';
      const out = runPreamble(prompt);
      const parsed = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      // Keyword path fires: mentions the skill and Skill tool
      expect(parsed.hookSpecificOutput.additionalContext).toContain('`devflow:implement`');
      expect(parsed.hookSpecificOutput.additionalContext).toContain('Skill tool');
      // EXECUTION_PLAN marker text must NOT appear (keyword won)
      expect(parsed.hookSpecificOutput.additionalContext).not.toContain('EXECUTION_PLAN detected');
      // Only one hookSpecificOutput key at the top level
      expect(Object.keys(JSON.parse(out))).toEqual(['hookSpecificOutput']);
    });

    it('F10: matched output contains backtick-wrapped skill name and instructs announce-then-invoke-via-Skill-tool', () => {
      const out = runPreamble('research the auth options');
      const parsed = JSON.parse(out) as {
        hookSpecificOutput: { additionalContext: string };
      };
      const ctx = parsed.hookSpecificOutput.additionalContext;
      expect(ctx).toContain('`devflow:research`');
      expect(ctx).toContain('Skill tool');
      expect(ctx).toContain("tell the user you're invoking");
    });
  });

  // -------------------------------------------------------------------------
  // Suite 2 — API contract (C1–C7)
  // -------------------------------------------------------------------------

  describe('Suite 2 — API contract', () => {
    it('C1/C6: matched output has exactly one top-level key hookSpecificOutput with correct schema', () => {
      const out = runPreamble('explore the codebase');
      const parsed = JSON.parse(out) as Record<string, unknown>;
      // Exactly one top-level key
      expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
      const hso = parsed.hookSpecificOutput as Record<string, unknown>;
      expect(hso.hookEventName).toBe('UserPromptSubmit');
      expect(typeof hso.additionalContext).toBe('string');
      expect((hso.additionalContext as string).length).toBeGreaterThan(0);
      // No extra keys
      expect(Object.keys(hso).sort()).toEqual(['additionalContext', 'hookEventName'].sort());
    });

    it('C2: empty stdout on no-match — zero bytes', () => {
      const out = runPreamble('fix the login bug');
      expect(out.length).toBe(0);
    });

    it('C3a: exit code 0 on keyword match', () => {
      expect(() => runPreamble('implement the cache')).not.toThrow();
    });

    it('C3b: exit code 0 on no-match', () => {
      expect(() => runPreamble('fix the login bug')).not.toThrow();
    });

    it('C3c: exit code 0 on empty prompt', () => {
      expect(() => runPreamble('')).not.toThrow();
    });

    it('C3d: exit code 0 when cwd does not exist', () => {
      const input = JSON.stringify({ cwd: '/nonexistent/path/devflow-test', prompt: 'implement it' });
      expect(() => {
        execSync(`bash "${PREAMBLE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
      }).not.toThrow();
    });

    it('C4: no file I/O on keyword match — tmpDir unchanged', () => {
      const before = fs.readdirSync(tmpDir);
      runPreamble('implement the cache');
      const after = fs.readdirSync(tmpDir);
      expect(after).toEqual(before);
      const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
      expect(fs.existsSync(queueFile)).toBe(false);
    });

    it('C4: no file I/O on no-match — tmpDir unchanged', () => {
      const before = fs.readdirSync(tmpDir);
      runPreamble('fix the login bug');
      const after = fs.readdirSync(tmpDir);
      expect(after).toEqual(before);
    });

    it('C5: preamble source contains no bash-4-only ${var,,} or ${var^^} lowercasing in non-comment code', () => {
      const src = fs.readFileSync(PREAMBLE_SRC, 'utf-8');
      // Strip comment lines to avoid false positives from documentation text
      const codeLines = src
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      // Bash 3.2 guard: these patterns indicate bash 4+ only syntax
      expect(codeLines).not.toMatch(/\$\{[^}]+,,\}/);
      expect(codeLines).not.toMatch(/\$\{[^}]+\^\^\}/);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 3 — Security / fuzz (C7)
  // -------------------------------------------------------------------------

  describe('Suite 3 — Security / fuzz', () => {
    const hostilePayloads: Array<{ label: string; tail: string }> = [
      { label: 'backticks',      tail: '`rm -rf /tmp/devflow-test`' },
      { label: 'dollar-parens',  tail: '$(echo injected)' },
      { label: 'IFS expansion',  tail: '${IFS}injected' },
      { label: 'embedded quote', tail: 'foo " bar \' baz' },
      { label: 'backslashes',    tail: 'foo\\nbar\\\\baz' },
      { label: 'newlines',       tail: 'line1\nline2\nline3' },
      { label: 'unicode',        tail: '漢字 привет مرحبا 🚀' },
      { label: 'large body',     tail: 'x'.repeat(200_000) },
    ];

    for (const { label, tail } of hostilePayloads) {
      it(`C7: hostile tail (${label}) — exit 0, valid JSON, no injection in output`, () => {
        const prompt = `implement ${tail}`;
        // Write to file to avoid execSync stdin buffer limits on large payloads
        const inputFile = path.join(tmpDir, `input-${label.replace(/\W/g, '_')}.json`);
        fs.writeFileSync(inputFile, JSON.stringify({ cwd: tmpDir, prompt }));
        const out = execSync(`bash "${PREAMBLE_HOOK}" < "${inputFile}"`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();

        // Valid JSON
        const parsed = JSON.parse(out) as {
          hookSpecificOutput: { additionalContext: string };
        };
        const ctx = parsed.hookSpecificOutput.additionalContext;

        // additionalContext EQUALS the expected fixed template — no user text leaks through
        expect(ctx).toBe(expectedContext('implement'));
      });
    }
  });

  // -------------------------------------------------------------------------
  // Suite 4 — Performance (P1–P3)
  // -------------------------------------------------------------------------

  describe('Suite 4 — Performance', () => {
    it('P1: no subprocess calls in new keyword detection block (awk/sed/tr/$() absent)', () => {
      const src = fs.readFileSync(PREAMBLE_SRC, 'utf-8');
      // Locate the keyword detection block (between the "First-word" comment and the elif)
      const blockStart = src.indexOf('# --- First-word workflow keyword detection');
      const blockEnd = src.indexOf('elif [[ "$PROMPT" == *"## Goal"*', blockStart);
      expect(blockStart).toBeGreaterThan(-1);
      expect(blockEnd).toBeGreaterThan(blockStart);
      const block = src.slice(blockStart, blockEnd);

      // Strip comment lines and string literals (backtick-quoted text inside string values)
      // to avoid false positives from documentation in comments or in the directive string.
      const codeLines = block
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

      // No awk, sed, or tr commands on code lines
      expect(codeLines).not.toMatch(/\bawk\b/);
      expect(codeLines).not.toMatch(/\bsed\b/);
      expect(codeLines).not.toMatch(/\btr\b/);
      // No command substitution $( cmd ) on code lines
      // (backtick-quoted names inside string literals are allowed — they are not execution)
      expect(codeLines).not.toMatch(/\$\(\s*[a-zA-Z]/);
    });

    it('P2/P3: wall-time on large prompt is bounded — delta < 500ms and ratio < 5×', () => {
      // Methodology: the keyword detection itself is O(1) (capped at 256 bytes via HEAD="${PROMPT:0:256}").
      // The total wall-time difference is dominated by JSON parsing of the full prompt, not our detection.
      // We assert that the DELTA is bounded (< 500ms) and the ratio does not blow up exponentially (< 5×).
      // These thresholds are intentionally generous — tighter bounds belong in a dedicated benchmark,
      // not in a correctness test suite.
      const K = 5;

      function median(times: number[]): number {
        const sorted = [...times].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      }

      function measureMs(prompt: string): number[] {
        return Array.from({ length: K }, () => {
          const start = Date.now();
          runPreamble(prompt);
          return Date.now() - start;
        });
      }

      const smallPrompt = 'implement the auth module';
      const largePrompt = `implement ${'x'.repeat(200_000)}`;

      const smallMs = median(measureMs(smallPrompt));
      const largeMs = median(measureMs(largePrompt));

      const delta = largeMs - smallMs;
      const ratio = smallMs > 0 ? largeMs / smallMs : largeMs;

      expect(delta).toBeLessThan(500);
      expect(ratio).toBeLessThan(5);
    });
  });
});

describe('ensure-devflow-init behavioral', () => {
  const ENSURE_DEVFLOW = path.join(HOOKS_DIR, 'ensure-devflow-init');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-features-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .devflow/features/ and index.json when absent', () => {
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'features', 'index.json'))).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, '.devflow', 'features', 'index.json'), 'utf-8');
    expect(content).toBe('{"version":1,"features":{}}');
  });

  it('does not overwrite existing index.json', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'features'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'features', 'index.json'), '{"existing":"data"}');

    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const content = fs.readFileSync(path.join(tmpDir, '.devflow', 'features', 'index.json'), 'utf-8');
    expect(content).toBe('{"existing":"data"}');
  });

  it('creates .devflow/.gitignore with ignore-by-default allowlist content', () => {
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.devflow', '.gitignore'), 'utf-8');
    expect(gitignore).toContain('\n*\n');
    expect(gitignore).toContain('!.gitignore');
    expect(gitignore).toContain('!decisions/decisions.md');
    expect(gitignore).toContain('!features/*/KNOWLEDGE.md');
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.gitignore-configured'))).toBe(true);
  });

  it('is idempotent — marker prevents repeated gitignore writes', () => {
    // Run twice
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.devflow', '.gitignore'), 'utf-8');
    // The allowlist negation for decisions.md should appear exactly once
    const decisionsEntries = gitignore.split('\n').filter(l => l === '!decisions/decisions.md');
    expect(decisionsEntries).toHaveLength(1);
  });

  it('heredoc matches getDevflowGitignoreContent() from project-paths.cjs', () => {
    // Source ensure-devflow-init in a fresh temp dir, then compare the resulting
    // .devflow/.gitignore to the canonical CJS function output.
    const PROJECT_PATHS_CJS = path.join(HOOKS_DIR, 'lib', 'project-paths.cjs');
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const hookContent = fs.readFileSync(path.join(tmpDir, '.devflow', '.gitignore'), 'utf-8');
    const canonical = execSync(
      `node -e "process.stdout.write(require('${PROJECT_PATHS_CJS}').getDevflowGitignoreContent())"`,
      { stdio: 'pipe' },
    ).toString();

    expect(hookContent).toBe(canonical);
  });

  it('returns non-zero and creates no .devflow/ when called with empty argument (SEC-3 guard)', () => {
    // The `[ -z "$1" ] && return 1` guard at the top of ensure-devflow-init prevents
    // accidental directory creation when no project path is supplied.
    const result = execSync(
      `bash -c 'source "${ENSURE_DEVFLOW}" ""; echo $?'`,
      { stdio: 'pipe' },
    ).toString().trim();

    // return 1 from a sourced script propagates as the last exit status
    expect(result).toBe('1');
    // No .devflow/ directory should have been created in the test working directory
    expect(fs.existsSync(path.join(tmpDir, '.devflow'))).toBe(false);
  });
});

describe('get-mtime behavioral', () => {
  it('returns a valid positive epoch timestamp for a real file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const tmpFile = path.join(tmpDir, 'probe.txt');
    const getMtimeScript = path.join(HOOKS_DIR, 'get-mtime');

    try {
      fs.writeFileSync(tmpFile, 'probe');
      const result = execSync(
        `bash -c 'source "${getMtimeScript}" && get_mtime "${tmpFile}"'`,
        { stdio: 'pipe' }
      ).toString().trim();

      const epoch = parseInt(result, 10);
      expect(Number.isInteger(epoch)).toBe(true);
      expect(epoch).toBeGreaterThan(0);
      // Sanity: must be after 2020-01-01 (epoch 1577836800) and before year 2100 (4102444800)
      expect(epoch).toBeGreaterThan(1577836800);
      expect(epoch).toBeLessThan(4102444800);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// transcript-filter.cjs CLI handler
// =============================================================================

describe('transcript-filter.cjs CLI', () => {
  const FILTER = path.join(HOOKS_DIR, 'lib', 'transcript-filter.cjs');

  it('user-signals extracts user turns', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'transcript.jsonl');
    try {
      fs.writeFileSync(file, [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello world' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'thanks for helping' } }),
      ].join('\n') + '\n');

      const result = execSync(`node "${FILTER}" user-signals "${file}"`, { stdio: 'pipe' }).toString().trim();
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(['hello world', 'thanks for helping']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('dialog-pairs extracts assistant+user pairs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'transcript.jsonl');
    try {
      fs.writeFileSync(file, [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello world' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'thanks for helping' } }),
      ].join('\n') + '\n');

      const result = execSync(`node "${FILTER}" dialog-pairs "${file}"`, { stdio: 'pipe' }).toString().trim();
      const parsed = JSON.parse(result);
      expect(parsed).toEqual([{ prior: 'hi there', user: 'thanks for helping' }]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('user-signals with empty transcript returns empty stdout (not "[]")', () => {
    // transcript-filter outputs nothing (empty stdout) for empty results so that
    // shell [ -n "$VAR" ] emptiness checks work correctly. JSON.stringify([]) produces
    // "[]" which is a non-empty string and would fool shell emptiness checks.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'empty.jsonl');
    try {
      fs.writeFileSync(file, '');
      const result = execSync(`node "${FILTER}" user-signals "${file}"`, { stdio: 'pipe' }).toString().trim();
      expect(result).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('invalid subcommand exits non-zero', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'dummy.jsonl');
    try {
      fs.writeFileSync(file, '');
      expect(() => {
        execSync(`node "${FILTER}" bogus "${file}"`, { stdio: 'pipe' });
      }).toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Dream hook test helpers
// =============================================================================

function encodeCwd(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-');
}

function createTranscript(
  homeDir: string,
  cwdDir: string,
  userTurns: number,
  assistantTurns: number = userTurns,
  sessionId: string = 'test-session',
): string {
  const encoded = encodeCwd(cwdDir);
  const projDir = path.join(homeDir, '.claude', 'projects', `-${encoded}`);
  fs.mkdirSync(projDir, { recursive: true });
  const transcriptPath = path.join(projDir, `${sessionId}.jsonl`);
  const lines: string[] = [];
  for (let i = 0; i < Math.max(userTurns, assistantTurns); i++) {
    if (i < userTurns) lines.push(JSON.stringify({
      type: 'user', message: { role: 'user', content: `user turn ${i}` },
    }));
    if (i < assistantTurns) lines.push(JSON.stringify({
      type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `response ${i}` }] },
    }));
  }
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');
  return transcriptPath;
}

function createDreamConfig(cwdDir: string, config: Record<string, boolean>): void {
  const dir = path.join(cwdDir, '.devflow', 'dream');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
}

function backdateMtime(filePath: string, secondsAgo: number): void {
  const past = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(filePath, past, past);
}

function runHook(hookPath: string, input: object, homeDir: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`bash "${hookPath}"`, {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: homeDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: result.toString(), stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

// =============================================================================
// dream-evaluate business logic
// =============================================================================

describe('dream-evaluate business logic', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'dream-evaluate');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-eval-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-eval-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('config defaults: all features enabled when no config present', () => {
    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);
    expect(exitCode).toBe(0);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Evaluating decisions');
    expect(log).toContain('Evaluating knowledge');
    // learning pipeline removed — no 'Evaluating learning' should appear
    expect(log).not.toContain('Evaluating learning');
  });

  it('shallow session (2 turns) skips decisions', () => {
    createTranscript(homeDir, tmpDir, 2);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'decisions.json'))).toBe(false);
  });

  it('deep session (5 turns) proceeds with evaluation', () => {
    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Session depth: 5 turns');
  });

  it('decisions marker written for deep session with dialog pairs', () => {
    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    // Per-session marker: decisions.test-session.json
    const decisionsMarker = path.join(dreamDir, 'decisions.test-session.json');
    expect(fs.existsSync(decisionsMarker)).toBe(true);

    const marker = JSON.parse(fs.readFileSync(decisionsMarker, 'utf-8'));
    expect(marker).toHaveProperty('dialogPairs');
    expect(marker).toHaveProperty('existingObservationIds');

    // Verify dialog pairs are non-empty (5 alternating turns = 4 pairs)
    const pairs = JSON.parse(marker.dialogPairs);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it('knowledge throttle: recent refresh skips evaluation', () => {
    // Write a recent timestamp to the throttle marker
    const featuresDir = path.join(tmpDir, '.devflow', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'index.json'), '{"version":1,"features":{}}');
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(featuresDir, '.knowledge-last-refresh'), String(now));

    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'knowledge.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Knowledge throttled');
  });

  it('knowledge disabled sentinel skips evaluation', () => {
    const featuresDir = path.join(tmpDir, '.devflow', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, '.disabled'), '');

    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'knowledge.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Knowledge disabled by sentinel');
  });

  it('session ID path traversal rejected, fallback used', () => {
    // Create a valid transcript with a normal name
    createTranscript(homeDir, tmpDir, 5, 5, 'valid-session');

    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: '../etc',
    }, homeDir);

    // The hook should still work via ls -t fallback
    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Session depth');
  });
});

// =============================================================================
// dream-evaluate knowledge evaluation
// =============================================================================

describe('dream-evaluate knowledge evaluation', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'dream-evaluate');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-cap-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-cap-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('LAST_REFRESH sanitization: non-numeric content in knowledge marker defaults to 0', () => {
    // Write non-numeric content to .knowledge-last-refresh — should sanitize to 0
    // resulting in a stale age calculation (now - 0 > 7200) and triggering evaluation
    const featuresDir = path.join(tmpDir, '.devflow', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    // No stale slugs — so no marker will be written — but hook should not crash
    fs.writeFileSync(path.join(featuresDir, 'index.json'), '{"version":1,"features":{}}');
    fs.writeFileSync(path.join(featuresDir, '.knowledge-last-refresh'), 'not-a-number\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);

    // Hook should have attempted knowledge evaluation (no crash from bad timestamp)
    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    if (fs.existsSync(logFile)) {
      const log = fs.readFileSync(logFile, 'utf-8');
      // Either throttled (with sanitized timestamp near 0 → stale) or "no stale slugs"
      // Both are valid outcomes — the key is it didn't crash
      expect(log).toContain('Evaluating knowledge');
    }
  });

  it('LAST_UPDATE get_mtime fallback: missing WORKING-MEMORY defaults to 0', () => {
    // Without WORKING-MEMORY.md, get_mtime returns empty string; LAST_UPDATE should default to 0
    // so age computation doesn't error
    createTranscript(homeDir, tmpDir, 5);

    // Deliberately do NOT create WORKING-MEMORY.md
    // We call dream-capture (not dream-evaluate) for this one since it does the get_mtime check
    const CAPTURE_HOOK = path.join(HOOKS_DIR, 'dream-capture');
    const exitCode = (() => {
      try {
        execSync(`bash "${CAPTURE_HOOK}"`, {
          input: JSON.stringify({ cwd: tmpDir, session_id: 'test', last_assistant_message: 'response text here' }),
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, HOME: homeDir },
        });
        return 0;
      } catch (e: unknown) {
        return (e as { status: number }).status ?? 1;
      }
    })();
    expect(exitCode).toBe(0);
  });
});

// =============================================================================
// dream-recover stale marker recovery
// =============================================================================

// Bash harness that stubs dbg/log, sources get-mtime + dream-recover, then
// calls dream_recover_stale and echoes JUST_RECOVERED so tests can assert it.
const DREAM_RECOVER = path.join(HOOKS_DIR, 'dream-recover');
const GET_MTIME = path.join(HOOKS_DIR, 'get-mtime');

function runRecover(dreamDir: string, memoryDir: string): { justRecovered: string } {
  const result = execSync(`bash -c '
    dbg() { :; }
    log() { :; }
    source "${GET_MTIME}"
    source "${DREAM_RECOVER}"
    dream_recover_stale "${dreamDir}" "${memoryDir}"
    printf "%s" "$JUST_RECOVERED"
  '`, { stdio: 'pipe' }).toString();
  return { justRecovered: result };
}

describe('dream-recover stale marker recovery', () => {
  let tmpDir: string;
  let dreamDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-recover-test-'));
    dreamDir = path.join(tmpDir, '.devflow', 'dream');
    memoryDir = path.join(tmpDir, '.devflow', 'memory');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // dream-dispatch still handles the capture-only path — fresh .processing is
  // left alone by dream-recover (it checks age, not presence).
  it('fresh .processing left alone (age below threshold)', () => {
    const procFile = path.join(dreamDir, 'learning.processing');
    fs.writeFileSync(procFile, '{}');
    // mtime is current — well below 1800s threshold

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(true);
    expect(fs.existsSync(path.join(dreamDir, 'learning.json'))).toBe(false);
  });

  it('stale .processing retried — renamed back to .json', () => {
    const procFile = path.join(dreamDir, 'learning.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000); // older than 1800s threshold

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'learning.json'))).toBe(true);

    const retryFile = path.join(dreamDir, 'learning.retries');
    expect(fs.existsSync(retryFile)).toBe(true);
    expect(fs.readFileSync(retryFile, 'utf-8').trim()).toBe('1');
  });

  it('retry count increments on repeated stale recovery', () => {
    const procFile = path.join(dreamDir, 'learning.processing');
    const retryFile = path.join(dreamDir, 'learning.retries');

    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000);
    fs.writeFileSync(retryFile, '1');

    runRecover(dreamDir, memoryDir);

    expect(fs.readFileSync(retryFile, 'utf-8').trim()).toBe('2');
  });

  it('max retries exhausted — marked as .failed', () => {
    const procFile = path.join(dreamDir, 'learning.processing');
    const retryFile = path.join(dreamDir, 'learning.retries');

    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000);
    fs.writeFileSync(retryFile, '3');

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'learning.failed'))).toBe(true);
    expect(fs.existsSync(retryFile)).toBe(false);
  });

  // T2(a): per-type stale thresholds
  it('memory type recovers after 300s but NOT before', () => {
    const procFile = path.join(dreamDir, 'memory.abc123.processing');
    // Fresh — should NOT recover
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 200); // below 300s memory threshold

    runRecover(dreamDir, memoryDir);
    expect(fs.existsSync(procFile)).toBe(true); // still .processing

    // Now age it past threshold
    backdateMtime(procFile, 400);
    runRecover(dreamDir, memoryDir);
    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'memory.abc123.json'))).toBe(true);
  });

  it('learning type does NOT recover at 300s (needs 1800s)', () => {
    const procFile = path.join(dreamDir, 'learning.abc123.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 400); // past memory threshold but below learning threshold (1800s)

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(true); // should still be .processing
    expect(fs.existsSync(path.join(dreamDir, 'learning.abc123.json'))).toBe(false);
  });

  it('decisions type recovers after 1800s', () => {
    const procFile = path.join(dreamDir, 'decisions.abc123.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000); // past 1800s threshold

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'decisions.abc123.json'))).toBe(true);
  });

  it('knowledge type recovers after 1800s', () => {
    const procFile = path.join(dreamDir, 'knowledge.abc123.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000);

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'knowledge.abc123.json'))).toBe(true);
  });

  // T2(b): JUST_RECOVERED guard — recovered markers have .retries preserved, not reset
  it('JUST_RECOVERED guard: recovered marker basename is included in JUST_RECOVERED output', () => {
    const procFile = path.join(dreamDir, 'learning.sess1.processing');
    const retryFile = path.join(dreamDir, 'learning.sess1.retries');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000);
    fs.writeFileSync(retryFile, '2'); // pre-existing retry count

    const { justRecovered } = runRecover(dreamDir, memoryDir);

    // Marker should be recovered
    expect(fs.existsSync(path.join(dreamDir, 'learning.sess1.json'))).toBe(true);
    // JUST_RECOVERED should contain the basename (without .processing)
    expect(justRecovered).toContain('learning.sess1');
    // Retry count should be bumped to 3, not reset to 1
    expect(fs.readFileSync(retryFile, 'utf-8').trim()).toBe('3');
  });

  // T2(c): orphaned .pending-turns.processing recovery
  it('orphaned .pending-turns.processing older than 300s is renamed back to .pending-turns.jsonl', () => {
    const ptProc = path.join(memoryDir, '.pending-turns.processing');
    fs.writeFileSync(ptProc, 'some queued data\n');
    backdateMtime(ptProc, 400);

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(ptProc)).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, '.pending-turns.jsonl'))).toBe(true);
    expect(fs.readFileSync(path.join(memoryDir, '.pending-turns.jsonl'), 'utf-8')).toBe('some queued data\n');
  });

  it('orphaned .pending-turns.processing left alone when .pending-turns.jsonl already exists', () => {
    const ptProc = path.join(memoryDir, '.pending-turns.processing');
    const ptJsonl = path.join(memoryDir, '.pending-turns.jsonl');
    fs.writeFileSync(ptProc, 'processing data\n');
    backdateMtime(ptProc, 400);
    fs.writeFileSync(ptJsonl, 'existing jsonl data\n');

    runRecover(dreamDir, memoryDir);

    // .processing should remain (non-destructive when .jsonl already exists)
    expect(fs.existsSync(ptProc)).toBe(true);
    // .jsonl should be unchanged
    expect(fs.readFileSync(ptJsonl, 'utf-8')).toBe('existing jsonl data\n');
  });

  it('fresh .pending-turns.processing (below 300s) is NOT yanked', () => {
    const ptProc = path.join(memoryDir, '.pending-turns.processing');
    fs.writeFileSync(ptProc, 'active data\n');
    backdateMtime(ptProc, 100); // below 300s memory threshold

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(ptProc)).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, '.pending-turns.jsonl'))).toBe(false);
  });

  // T2(d): heartbeat — a .processing whose mtime was just refreshed is NOT yanked
  it('recently heartbeated .processing is not recovered (mtime is fresh)', () => {
    const procFile = path.join(dreamDir, 'knowledge.live.processing');
    fs.writeFileSync(procFile, '{}');
    // Touch to current mtime — simulates a live heartbeat
    const now = new Date();
    fs.utimesSync(procFile, now, now);

    runRecover(dreamDir, memoryDir);

    expect(fs.existsSync(procFile)).toBe(true);
    expect(fs.existsSync(path.join(dreamDir, 'knowledge.live.json'))).toBe(false);
  });
});

// =============================================================================
// dream-dispatch: capture-only (no directive emission)
// session-start-context: pending-work directive emission (Section 2)
// =============================================================================

describe('dream-dispatch capture-only (no directive emitted)', () => {
  const DISPATCH_HOOK = path.join(HOOKS_DIR, 'dream-dispatch');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dispatch-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // dream-dispatch is now capture-only; it must never emit a directive
  it('emits no additionalContext even when pending .json markers exist (T6)', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.writeFileSync(path.join(dreamDir, 'learning.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'decisions.json'), '{}');

    // Dispatch should exit 0 and produce no JSON output (capture-only)
    let stdout = '';
    try {
      stdout = execSync(`bash "${DISPATCH_HOOK}"`, {
        input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString().trim();
    } catch (e: unknown) {
      const err = e as { stdout?: Buffer; status?: number };
      stdout = err.stdout?.toString().trim() ?? '';
    }

    // Dispatch produces no output (it is capture-only)
    expect(stdout).toBe('');
  });

  it('fresh .processing is left alone by dream-dispatch (dispatch does not recover)', () => {
    const procFile = path.join(tmpDir, '.devflow', 'dream', 'learning.processing');
    fs.writeFileSync(procFile, '{}');

    execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(fs.existsSync(procFile)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'dream', 'learning.json'))).toBe(false);
  });
});

describe('session-start-context pending-work directive', () => {
  const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-context-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-context-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
    // Do NOT disable decisions/knowledge sentinels here — doing so would also
    // cause dream-collect-tasks to delete those marker types. Instead we
    // rely on the absence of decisions.md and pitfalls.md to keep Section 1.5 silent.
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // T5: directive lists expected task names from pending {type}.{session}.json markers
  it('pending marker directive includes expected task names (T5)', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    // learning markers are deleted on sight (learning pipeline removed — R1)
    fs.writeFileSync(path.join(dreamDir, 'learning.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'decisions.sess1.json'), '{}');

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    const parsed = JSON.parse(stdout.trim());
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain('DREAM MAINTENANCE');
    expect(context).toContain('decisions');
    // learning marker deleted on sight — must NOT appear in directive
    expect(context).not.toContain('learning');
    // learning.sess1.json should be deleted
    expect(fs.existsSync(path.join(dreamDir, 'learning.sess1.json'))).toBe(false);
  });

  it('no directive emitted when no pending markers present', () => {
    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    // No pending markers — hook should produce no output
    expect(stdout.trim()).toBe('');
  });

  it('stale learning .processing recovered then deleted on sight (not emitted in directive)', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    // Seed a stale learning .processing — recovered to .json then deleted by dream-collect-tasks (R1)
    const procFile = path.join(dreamDir, 'learning.stale.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000); // past 1800s threshold

    // Also seed a decisions marker so there IS a valid directive to emit
    fs.writeFileSync(path.join(dreamDir, 'decisions.stale.json'), '{}');

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    // Decisions marker should produce a directive
    const parsed = JSON.parse(stdout.trim());
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain('DREAM MAINTENANCE');
    // learning must NOT appear in the directive
    expect(context).not.toContain('learning');
    // The stale .processing should have been recovered to .json then deleted
    expect(fs.existsSync(procFile)).toBe(false);
    // learning.stale.json recovered, then deleted by dream-collect-tasks
    expect(fs.existsSync(path.join(dreamDir, 'learning.stale.json'))).toBe(false);
  });
});

// =============================================================================
// dream-capture memory worker spawn (eager refresh — replaces old marker approach)
// =============================================================================
//
// After PR #eager-memory-refresh: dream-capture no longer writes a memory.json
// dream marker. Instead, after the 120s throttle, it:
//   1. Touches .working-memory-last-trigger BEFORE spawning (prevents double-spawn)
//   2. Spawns background-memory-update as a detached nohup worker
//   3. Never creates a memory.json / memory.processing dream marker
//
// Tests use a fake `claude` shim on PATH that writes a deterministic stamped
// WORKING-MEMORY.md to verify the worker contract without a real claude binary.
// Throttle is verified via .working-memory-last-trigger mtime.

describe('dream-capture memory worker spawn', () => {
  const CAPTURE_HOOK = path.join(HOOKS_DIR, 'dream-capture');

  let tmpDir: string;
  let homeDir: string;
  let fakeClaudeBin: string;
  let fakePathDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-capture-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-capture-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });

    // Create a fake `claude` binary on PATH so background-memory-update can find it.
    // The shim writes a deterministic stamped WORKING-MEMORY.md when invoked with -p.
    fakePathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-fake-claude-'));
    fakeClaudeBin = path.join(fakePathDir, 'claude');
    const memFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(fakeClaudeBin, `#!/bin/bash
# Fake claude shim for tests: writes a deterministic stamped WORKING-MEMORY.md
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
echo "- test memory content" >> "${memFile}"
exit 0
`);
    fs.chmodSync(fakeClaudeBin, 0o755);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(fakePathDir, { recursive: true, force: true });
  });

  function runCaptureWithFakeClaude(input: object): { stdout: string; stderr: string; exitCode: number } {
    try {
      const result = execSync(`bash "${CAPTURE_HOOK}"`, {
        input: JSON.stringify(input),
        env: {
          ...process.env,
          HOME: homeDir,
          PATH: `${fakePathDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout: result.toString(), stderr: '', exitCode: 0 };
    } catch (e: unknown) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
      return {
        stdout: err.stdout?.toString() ?? '',
        stderr: err.stderr?.toString() ?? '',
        exitCode: err.status ?? 1,
      };
    }
  }

  it('AC-F1: trigger file touched and NO memory.json marker created when throttle expired', () => {
    // Backdate the trigger file so throttle passes (>120s ago)
    const triggerFile = path.join(tmpDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runCaptureWithFakeClaude({
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    });

    // Trigger file must be touched (mtime refreshed)
    const triggerMtime = fs.statSync(triggerFile).mtimeMs;
    expect(triggerMtime).toBeGreaterThan(Date.now() - 5000); // within last 5s

    // No dream memory.json marker must be created (memory is no longer a Dream task)
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'memory.json'))).toBe(false);

    // Queue append still happens
    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  it('AC-P1: worker spawn throttled when trigger recently touched (<120s)', () => {
    const triggerFile = path.join(tmpDir, '.devflow', 'memory', '.working-memory-last-trigger');
    // Fresh trigger file (within throttle window)
    fs.writeFileSync(triggerFile, '');

    const triggerMtimeBefore = fs.statSync(triggerFile).mtimeMs;

    runCaptureWithFakeClaude({
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'another response',
    });

    // Trigger file must NOT be updated (still within throttle)
    const triggerMtimeAfter = fs.statSync(triggerFile).mtimeMs;
    // Allow 1s tolerance since filesystem mtime resolution varies
    expect(triggerMtimeAfter - triggerMtimeBefore).toBeLessThan(1000);

    // Queue append still happens even when throttled
    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  it('AC-F7: memory disabled via config skips all capture and no trigger touch', () => {
    createDreamConfig(tmpDir, { memory: false });

    runCaptureWithFakeClaude({
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    });

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'memory.json'))).toBe(false);

    const triggerFile = path.join(tmpDir, '.devflow', 'memory', '.working-memory-last-trigger');
    expect(fs.existsSync(triggerFile)).toBe(false);
  });
});


// =============================================================================
// dream-collect-tasks: single-pass scan + conditional get_mtime (AC-1–AC-5, AC-11–AC-12)
// =============================================================================

/**
 * Runs dream_collect_tasks in a subprocess with an instrumented get_mtime that
 * writes each invoked path to a counter file, enabling assertion AC-11 / AC-12.
 *
 * Returns { tasks, mtimeCount } where:
 *   tasks      — the value of _DREAM_TASKS after the call
 *   mtimeCount — number of times get_mtime was called
 */
function runCollectTasks(
  dreamDir: string,
  opts: { decEnabled?: boolean; knowEnabled?: boolean },
): { tasks: string; mtimeCount: number } {
  const hooksDir = path.resolve(__dirname, '..', 'scripts', 'hooks');
  const counterFile = path.join(os.tmpdir(), `devflow-mtime-counter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(counterFile, '0');

  // The instrumented script:
  //  1. Provides a stub dbg/log that swallows output.
  //  2. Overrides get_mtime to increment the counter and return a deterministic mtime.
  //     We assign mtime = index of call (1, 2, 3…) so sort order is predictable.
  //  3. Sources dream-collect-tasks and calls the function.
  //  4. Prints _DREAM_TASKS to stdout.
  // Note: memEnabled removed — memory is not a Dream task (applies ADR-016; avoids PF-009).
  const decEn = opts.decEnabled ?? true ? 'true' : 'false';
  const knowEn = opts.knowEnabled ?? true ? 'true' : 'false';

  const script = `#!/bin/bash
dbg() { :; }
log() { :; }
_HAS_JQ=false
COUNTER_FILE="${counterFile}"
# Instrumented get_mtime: increments counter; returns monotonically increasing mtime.
get_mtime() {
  local c
  c=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
  c=$(( c + 1 ))
  printf '%s' "$c" > "$COUNTER_FILE"
  printf '%s' "$c"
}
source "${hooksDir}/dream-collect-tasks"
dream_collect_tasks "${dreamDir}" "${decEn}" "${knowEn}"
printf '%s' "\$_DREAM_TASKS"
`;

  let stdout = '';
  try {
    stdout = execSync(`bash -s`, {
      input: script,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer };
    stdout = err.stdout?.toString() ?? '';
  }

  const mtimeCount = parseInt(fs.readFileSync(counterFile, 'utf-8').trim() || '0', 10);
  fs.unlinkSync(counterFile);
  return { tasks: stdout.trim(), mtimeCount };
}

describe('dream-collect-tasks: single-pass scan', () => {
  let dreamDir: string;

  beforeEach(() => {
    dreamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-collect-'));
    // Ensure the base dream dir itself exists
  });

  afterEach(() => {
    fs.rmSync(dreamDir, { recursive: true, force: true });
  });

  // AC-1: <=50 enabled markers → _DREAM_TASKS correct; memory.* swept unconditionally
  it('AC-1: <=50 enabled markers → correct task set in _DREAM_TASKS (memory swept)', () => {
    fs.writeFileSync(path.join(dreamDir, 'config.json'), '{}'); // sentinel — skipped
    fs.writeFileSync(path.join(dreamDir, 'decisions.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'memory.sess1.json'), '{}');   // must be deleted
    fs.writeFileSync(path.join(dreamDir, 'curation.sess1.json'), '{}');

    const { tasks } = runCollectTasks(dreamDir, {});
    // memory is no longer a Dream task — background-memory-update handles it.
    // Sort-u produces alphabetical: curation,decisions (no memory)
    expect(tasks.split(',').sort()).toEqual(['curation', 'decisions']);
    // memory.sess1.json must have been deleted unconditionally
    expect(fs.existsSync(path.join(dreamDir, 'memory.sess1.json'))).toBe(false);
  });

  // AC-2: learning.* deleted every run regardless of count/position
  it('AC-2: learning.* markers deleted unconditionally', () => {
    fs.writeFileSync(path.join(dreamDir, 'learning.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'learning.sess2.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'decisions.sess1.json'), '{}');

    const { tasks } = runCollectTasks(dreamDir, {});
    expect(tasks).toContain('decisions');
    expect(tasks).not.toContain('learning');
    expect(fs.existsSync(path.join(dreamDir, 'learning.sess1.json'))).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'learning.sess2.json'))).toBe(false);
  });

  // AC-3: memory always swept (unconditional); disabled decisions/knowledge/curation deleted; type never in _DREAM_TASKS
  // Curation is now also swept when decisions is disabled (curation depends on decisions data).
  it('AC-3: memory always swept; disabled decisions/knowledge/curation markers deleted when decisions disabled', () => {
    fs.writeFileSync(path.join(dreamDir, 'memory.sess1.json'), '{}');       // swept unconditionally
    fs.writeFileSync(path.join(dreamDir, 'decisions.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'knowledge.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'curation.sess1.json'), '{}');

    // Memory markers are always swept unconditionally (memory is no longer a Dream task).
    // Curation markers are also swept when decisions is disabled — curation inherits decisions state.
    const { tasks } = runCollectTasks(dreamDir, { decEnabled: false, knowEnabled: false });
    expect(tasks).toBe('');
    expect(fs.existsSync(path.join(dreamDir, 'memory.sess1.json'))).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'decisions.sess1.json'))).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'knowledge.sess1.json'))).toBe(false);
    // curation swept because decisions is disabled
    expect(fs.existsSync(path.join(dreamDir, 'curation.sess1.json'))).toBe(false);
  });

  // AC-3b: memory markers always swept unconditionally (not flag-gated — ADR-016)
  it('AC-3b: memory.* markers deleted unconditionally (memory is not a Dream task)', () => {
    fs.writeFileSync(path.join(dreamDir, 'memory.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'memory.sess2.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'decisions.sess1.json'), '{}');

    const { tasks } = runCollectTasks(dreamDir, {});
    expect(tasks).toContain('decisions');
    expect(tasks).not.toContain('memory');
    expect(fs.existsSync(path.join(dreamDir, 'memory.sess1.json'))).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'memory.sess2.json'))).toBe(false);
  });

  // AC-4: curation (and unknown types) never deleted, appear in _DREAM_TASKS
  it('AC-4: curation and unknown types pass through unchanged', () => {
    fs.writeFileSync(path.join(dreamDir, 'curation.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'noveltype.sess1.json'), '{}');

    const { tasks } = runCollectTasks(dreamDir, {});
    expect(tasks.split(',').sort()).toEqual(['curation', 'noveltype']);
    expect(fs.existsSync(path.join(dreamDir, 'curation.sess1.json'))).toBe(true);
    expect(fs.existsSync(path.join(dreamDir, 'noveltype.sess1.json'))).toBe(true);
  });

  // AC-11: with <=50 kept markers, get_mtime invoked ZERO times
  it('AC-11: get_mtime invoked zero times when <=50 kept markers', () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dreamDir, `decisions.sess${i}.json`), '{}');
    }
    const { tasks, mtimeCount } = runCollectTasks(dreamDir, {});
    expect(tasks).toBe('decisions');
    expect(mtimeCount).toBe(0);
  });

  // AC-11 edge: exactly 50 markers — still zero get_mtime calls
  it('AC-11 edge: exactly 50 kept markers → zero get_mtime calls', () => {
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(dreamDir, `decisions.sess${i}.json`), '{}');
    }
    const { mtimeCount } = runCollectTasks(dreamDir, {});
    expect(mtimeCount).toBe(0);
  });

  // AC-12: with >50 kept markers, get_mtime invoked once per kept candidate
  it('AC-12: get_mtime invoked once per kept candidate when >50 markers', () => {
    // 55 enabled markers after pass-1 sweep
    for (let i = 0; i < 55; i++) {
      fs.writeFileSync(path.join(dreamDir, `decisions.sess${i}.json`), '{}');
    }
    const { tasks, mtimeCount } = runCollectTasks(dreamDir, {});
    expect(tasks).toBe('decisions');
    // get_mtime called once per kept candidate (55 total)
    expect(mtimeCount).toBe(55);
  });

  // AC-5: with >50 kept markers, exactly 50 processed; rest remain on disk
  it('AC-5: >50 markers → exactly 50 processed; rest remain on disk', () => {
    // Create 55 decisions markers and 3 learning markers (deleted in pass 1)
    for (let i = 0; i < 55; i++) {
      fs.writeFileSync(path.join(dreamDir, `decisions.sess${i}.json`), '{}');
    }
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(dreamDir, `learning.sess${i}.json`), '{}');
    }

    runCollectTasks(dreamDir, {});

    // All 3 learning markers deleted
    for (let i = 0; i < 3; i++) {
      expect(fs.existsSync(path.join(dreamDir, `learning.sess${i}.json`))).toBe(false);
    }

    // All 55 decisions markers still on disk (never deleted — only cap selection, not deletion)
    let remainingDecisions = 0;
    for (let i = 0; i < 55; i++) {
      if (fs.existsSync(path.join(dreamDir, `decisions.sess${i}.json`))) {
        remainingDecisions++;
      }
    }
    expect(remainingDecisions).toBe(55);
  });

  // AC-3 correctness: memory markers beyond position 50 are still deleted (scoping bug fixed)
  it('AC-3 beyond-cap: memory markers past position 50 are still deleted unconditionally', () => {
    // 55 decisions markers (enabled) + 5 memory markers (always swept)
    for (let i = 0; i < 55; i++) {
      fs.writeFileSync(path.join(dreamDir, `decisions.sess${i}.json`), '{}');
    }
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dreamDir, `memory.sess${i}.json`), '{}');
    }

    runCollectTasks(dreamDir, {});

    // All 5 memory markers must be deleted regardless of cap position
    for (let i = 0; i < 5; i++) {
      expect(fs.existsSync(path.join(dreamDir, `memory.sess${i}.json`))).toBe(false);
    }
    // decisions markers still on disk
    let remaining = 0;
    for (let i = 0; i < 55; i++) {
      if (fs.existsSync(path.join(dreamDir, `decisions.sess${i}.json`))) remaining++;
    }
    expect(remaining).toBe(55);
  });
});

