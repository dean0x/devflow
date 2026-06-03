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
  'eval-reinforce',
  'eval-learning',
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

  it('learning-created extracts artifacts from JSONL', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');

    try {
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'obs_1', type: 'workflow', status: 'created', artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95 }),
        JSON.stringify({ id: 'obs_2', type: 'procedural', status: 'created', artifact_path: '/.claude/skills/debug-hooks/SKILL.md', confidence: 0.8 }),
        JSON.stringify({ id: 'obs_3', type: 'workflow', status: 'observing', confidence: 0.3 }),
      ].join('\n'));

      const result = execSync(
        `node "${JSON_HELPER}" learning-created "${file}"`,
        { stdio: 'pipe' },
      ).toString().trim();
      const parsed = JSON.parse(result);
      expect(parsed.commands).toHaveLength(1);
      expect(parsed.commands[0].name).toBe('deploy-flow');
      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].name).toBe('debug-hooks');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('learning-new outputs new artifact notifications with self-learning prefix', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');

    try {
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'obs_1', type: 'workflow', status: 'created', artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95, last_seen: '2026-03-22T00:00:00Z' }),
        JSON.stringify({ id: 'obs_2', type: 'procedural', status: 'created', artifact_path: '/.claude/skills/debug-hooks/SKILL.md', confidence: 0.8, last_seen: '2026-03-22T00:00:00Z' }),
        JSON.stringify({ id: 'obs_3', type: 'workflow', status: 'observing', confidence: 0.3, last_seen: '2026-03-22T00:00:00Z' }),
      ].join('\n'));

      const result = execSync(
        `node "${JSON_HELPER}" learning-new "${file}" 0`,
        { stdio: 'pipe' },
      ).toString().trim();
      const lines = result.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('self-learning/deploy-flow');
      expect(lines[0]).toContain('command created');
      expect(lines[1]).toContain('debug-hooks');
      expect(lines[1]).toContain('skill created');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('json-helper.cjs filter-observations', () => {
  it('returns valid entries as sorted array', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'obs_a', type: 'workflow', pattern: 'p1', confidence: 0.3 }),
        JSON.stringify({ id: 'obs_b', type: 'procedural', pattern: 'p2', confidence: 0.9 }),
        JSON.stringify({ id: 'obs_c', type: 'workflow', pattern: 'p3', confidence: 0.5 }),
      ].join('\n') + '\n');

      const result = execSync(
        `node "${JSON_HELPER}" filter-observations "${file}" confidence 2`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('obs_b');
      expect(parsed[1].id).toBe('obs_c');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('filters out malformed entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'obs_valid', type: 'workflow', pattern: 'valid', confidence: 0.5 }),
        JSON.stringify({ id: 'bad_id', type: 'workflow', pattern: 'bad id' }),
        JSON.stringify({ id: 'obs_notype', pattern: 'no type' }),
        JSON.stringify({ id: 'obs_nopattern', type: 'workflow' }),
        'not json at all',
      ].join('\n') + '\n');

      const result = execSync(
        `node "${JSON_HELPER}" filter-observations "${file}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('obs_valid');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for missing file', () => {
    const result = execSync(
      `node "${JSON_HELPER}" filter-observations "/tmp/nonexistent-devflow-test-${Date.now()}.jsonl"`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString().trim();
    expect(result).toBe('[]');
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
      { prompt: 'explore A or B?',        label: 'F6a: question form suppressed' },
      { prompt: 'debug this?  ',          label: 'F6b: question with trailing whitespace suppressed' },
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

  it('creates .devflow/.gitignore with transient file entries', () => {
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.devflow', '.gitignore'), 'utf-8');
    expect(gitignore).toContain('features/.knowledge.lock/');
    expect(gitignore).toContain('memory/');
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.gitignore-configured'))).toBe(true);
  });

  it('is idempotent — marker prevents repeated gitignore writes', () => {
    // Run twice
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.devflow', '.gitignore'), 'utf-8');
    const lockEntries = gitignore.split('\n').filter(l => l === 'features/.knowledge.lock/');
    expect(lockEntries).toHaveLength(1);
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
// Sidecar hook test helpers
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

function createSidecarConfig(cwdDir: string, config: Record<string, boolean>): void {
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
    expect(log).toContain('Evaluating learning');
    expect(log).toContain('Evaluating decisions');
    expect(log).toContain('Evaluating knowledge');
  });

  it('config disables learning: learning skipped, decisions still evaluated', () => {
    createSidecarConfig(tmpDir, { learning: false });
    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'learning.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).not.toContain('Evaluating learning');
    expect(log).toContain('Evaluating decisions');
  });

  it('shallow session (2 turns) skips learning and decisions', () => {
    createTranscript(homeDir, tmpDir, 2);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'learning.json'))).toBe(false);
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

  it('learning batch accumulation triggers at batch_size threshold', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });

    // Pre-write 2 session IDs (batch_size defaults to 3)
    const sessionCountFile = path.join(dreamDir, '.learning-sessions');
    fs.writeFileSync(sessionCountFile, 'session-a\nsession-b\n');

    // Create a deep transcript for session-c (the 3rd session)
    createTranscript(homeDir, tmpDir, 5, 5, 'session-c');
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'session-c',
    }, homeDir);

    // Batch complete: per-session learning marker should be written (learning.session-c.json)
    const learningMarker = path.join(dreamDir, 'learning.session-c.json');
    expect(fs.existsSync(learningMarker)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(learningMarker, 'utf-8'));
    expect(marker).toHaveProperty('userSignals');
    expect(marker).toHaveProperty('existingObservationIds');

    // Session count file should be cleaned up
    expect(fs.existsSync(sessionCountFile)).toBe(false);
  });

  it('learning daily cap blocks marker creation', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });

    // Set daily cap to max
    const today = localDateString();
    fs.writeFileSync(path.join(dreamDir, '.learning-runs-today'), `${today}\t5\n`);

    // Pre-fill batch to trigger
    fs.writeFileSync(path.join(dreamDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    expect(fs.existsSync(path.join(dreamDir, 'learning.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('daily cap reached');
  });

  it('learning adaptive batch: >=15 obs requires batch_size=5', () => {
    // Write 16 observation lines
    const logLines = Array.from({ length: 16 }, (_, i) =>
      JSON.stringify({ id: `obs_${i}`, type: 'workflow', pattern: `p${i}` }),
    );
    const learningDir = path.join(tmpDir, '.devflow', 'learning');
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(path.join(learningDir, 'learning-log.jsonl'), logLines.join('\n') + '\n');

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });

    // Pre-fill only 3 sessions (less than adaptive batch_size=5)
    fs.writeFileSync(path.join(dreamDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    // 4 sessions total (3 pre-existing + 1 new) < 5 adaptive threshold
    expect(fs.existsSync(path.join(dreamDir, 'learning.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.dream-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('4/5 sessions');
  });

  it('learning session dedup: same ID twice counted once', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });

    createTranscript(homeDir, tmpDir, 5, 5, 'dup-session');

    // Run twice with same session_id
    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'dup-session' }, homeDir);
    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'dup-session' }, homeDir);

    const sessionCountFile = path.join(dreamDir, '.learning-sessions');
    if (fs.existsSync(sessionCountFile)) {
      const lines = fs.readFileSync(sessionCountFile, 'utf-8').trim().split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
    }
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
// dream-evaluate artifact reinforcement
// =============================================================================

describe('dream-evaluate artifact reinforcement', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'dream-evaluate');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-reinforce-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-reinforce-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('reinforcement updates last_seen for matching slugs', () => {
    const logFile = path.join(tmpDir, '.devflow', 'learning', 'learning-log.jsonl');
    const obs = {
      id: 'obs_reinforce_1',
      type: 'workflow',
      pattern: 'test pattern',
      status: 'created',
      artifact_path: '.claude/commands/self-learning/test-cmd.md',
      confidence: 0.9,
      last_seen: '2026-01-01T00:00:00Z',
    };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    // Create transcript that references the slug
    const encoded = encodeCwd(tmpDir);
    const projDir = path.join(homeDir, '.claude', 'projects', `-${encoded}`);
    fs.mkdirSync(projDir, { recursive: true });
    const transcriptPath = path.join(projDir, 'test-session.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 0' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Used self-learning:test-cmd in response' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 1' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 1' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 2' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 2' }] } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf-8').trim());
    expect(updated.last_seen).not.toBe('2026-01-01T00:00:00Z');
    expect(new Date(updated.last_seen).getTime()).toBeGreaterThan(0);
  });

  it('reinforcement leaves non-matching slugs unchanged', () => {
    const logFile = path.join(tmpDir, '.devflow', 'learning', 'learning-log.jsonl');
    const obs = {
      id: 'obs_reinforce_2',
      type: 'workflow',
      pattern: 'unrelated pattern',
      status: 'created',
      artifact_path: '.claude/commands/self-learning/unrelated-slug.md',
      confidence: 0.9,
      last_seen: '2026-01-01T00:00:00Z',
    };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    // Create transcript referencing a different slug
    const encoded = encodeCwd(tmpDir);
    const projDir = path.join(homeDir, '.claude', 'projects', `-${encoded}`);
    fs.mkdirSync(projDir, { recursive: true });
    const transcriptPath = path.join(projDir, 'test-session.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 0' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Used self-learning:other-slug here' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 1' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 1' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 2' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 2' }] } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf-8').trim());
    expect(updated.last_seen).toBe('2026-01-01T00:00:00Z');
  });

  it('reinforcement log is conditional — no message when nothing reinforced', () => {
    const logFile = path.join(tmpDir, '.devflow', 'learning', 'learning-log.jsonl');
    const obs = {
      id: 'obs_reinforce_3',
      type: 'workflow',
      pattern: 'some pattern',
      status: 'created',
      artifact_path: '.claude/commands/self-learning/no-match.md',
      confidence: 0.9,
      last_seen: '2026-01-01T00:00:00Z',
    };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    // Transcript with no self-learning references at all — but still 3+ turns for depth
    const encoded = encodeCwd(tmpDir);
    const projDir = path.join(homeDir, '.claude', 'projects', `-${encoded}`);
    fs.mkdirSync(projDir, { recursive: true });
    const transcriptPath = path.join(projDir, 'test-session.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 0' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 0' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 1' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 1' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'user turn 2' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response 2' }] } }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);

    const hookLog = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir), '.dream-evaluate.log');
    if (fs.existsSync(hookLog)) {
      const log = fs.readFileSync(hookLog, 'utf-8');
      expect(log).not.toContain('Reinforced');
    }
  });
});

// =============================================================================
// dream-evaluate read_daily_cap sanitization
// =============================================================================

describe('dream-evaluate read_daily_cap sanitization', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'dream-evaluate');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-cap-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-cap-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('tab-less counter file does not crash and returns default', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    const today = localDateString();
    // Write date string with no tab separator — cut -f2 returns the whole line
    fs.writeFileSync(path.join(dreamDir, '.learning-runs-today'), `${today}\n`);

    // Pre-fill batch to trigger learning evaluation
    fs.writeFileSync(path.join(dreamDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);
  });

  it('empty counter file does not crash', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.writeFileSync(path.join(dreamDir, '.learning-runs-today'), '');

    fs.writeFileSync(path.join(dreamDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);
  });

  it('non-numeric count field returns default', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    const today = localDateString();
    fs.writeFileSync(path.join(dreamDir, '.learning-runs-today'), `${today}\tabc\n`);

    // Pre-fill batch to trigger
    fs.writeFileSync(path.join(dreamDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);

    // The marker should still be written because cap defaults to 0 (not at max)
    // Per-session marker: learning.test-session.json
    expect(fs.existsSync(path.join(dreamDir, 'learning.test-session.json'))).toBe(true);
  });

  it('non-numeric config values do not crash', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'learning.json'),
      JSON.stringify({ max_daily_runs: 'xyz', batch_size: 'abc' }),
    );

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    // Pre-fill enough sessions for any reasonable batch_size default (3)
    fs.writeFileSync(path.join(dreamDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);
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
    // Do NOT disable learning/decisions sentinels here — doing so would also
    // cause dream-collect-tasks to delete those marker types. Instead we
    // rely on the absence of decisions.md, pitfalls.md, and learning-log.jsonl
    // to keep Sections 1.5 and 1.75 silent (no file → no output).
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // T5: directive lists expected task names from pending {type}.{session}.json markers
  it('pending marker directive includes multiple task names (T5)', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.writeFileSync(path.join(dreamDir, 'learning.sess1.json'), '{}');
    fs.writeFileSync(path.join(dreamDir, 'decisions.sess1.json'), '{}');

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    const parsed = JSON.parse(stdout.trim());
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain('SIDECAR MAINTENANCE');
    expect(context).toContain('learning');
    expect(context).toContain('decisions');
  });

  it('no directive emitted when no pending markers present', () => {
    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    // No pending markers — hook should produce no output
    expect(stdout.trim()).toBe('');
  });

  it('stale .processing recovered and included in directive', () => {
    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    // Seed a stale learning .processing — should be recovered then emitted
    const procFile = path.join(dreamDir, 'learning.stale.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 2000); // past 1800s threshold

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    const parsed = JSON.parse(stdout.trim());
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain('SIDECAR MAINTENANCE');
    expect(context).toContain('learning');
    // The .processing should have been renamed to .json
    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(dreamDir, 'learning.stale.json'))).toBe(true);
  });
});

// =============================================================================
// dream-capture memory marker
// =============================================================================

describe('dream-capture memory marker', () => {
  const CAPTURE_HOOK = path.join(HOOKS_DIR, 'dream-capture');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-capture-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-capture-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('marker written when throttle expired', () => {
    const wmFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(wmFile, '## Now\n- stale');
    backdateMtime(wmFile, 600);

    runHook(CAPTURE_HOOK, {
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    const memMarker = path.join(dreamDir, 'memory.json');
    expect(fs.existsSync(memMarker)).toBe(true);

    const marker = JSON.parse(fs.readFileSync(memMarker, 'utf-8'));
    expect(marker).toHaveProperty('pendingTurnsFile');
    expect(marker).toHaveProperty('existingMemoryFile');
    expect(marker.model).toBe('haiku');
    expect(typeof marker.timestamp).toBe('number');
  });

  it('marker skipped when .processing exists', () => {
    const wmFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(wmFile, '## Now\n- stale');
    backdateMtime(wmFile, 600);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    fs.mkdirSync(dreamDir, { recursive: true });
    fs.writeFileSync(path.join(dreamDir, 'memory.processing'), '{}');

    runHook(CAPTURE_HOOK, {
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    }, homeDir);

    expect(fs.existsSync(path.join(dreamDir, 'memory.json'))).toBe(false);

    // Queue append still happens
    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  it('marker skipped when memory recently updated', () => {
    const wmFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(wmFile, '## Now\n- fresh');
    // mtime is current — within 120s threshold

    runHook(CAPTURE_HOOK, {
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    }, homeDir);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'memory.json'))).toBe(false);

    // Queue append still happens
    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  it('memory disabled via config skips all capture', () => {
    createSidecarConfig(tmpDir, { memory: false });

    runHook(CAPTURE_HOOK, {
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    }, homeDir);

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);

    const dreamDir = path.join(tmpDir, '.devflow', 'dream');
    expect(fs.existsSync(path.join(dreamDir, 'memory.json'))).toBe(false);
  });
});

