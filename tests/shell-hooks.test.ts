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
  'sidecar-capture',
  'sidecar-evaluate',
  'sidecar-dispatch',
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
const SIDECAR_LOCK = path.join(HOOKS_DIR, 'sidecar-lock');

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
        source "${SIDECAR_LOCK}"
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
        source "${SIDECAR_LOCK}"
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
        source "${SIDECAR_LOCK}"
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
          source "${SIDECAR_LOCK}"
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

describe('json-helper.cjs temporal-decay', () => {
  it('applies decay to old entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      const oldDate = new Date(Date.now() - 35 * 86400000).toISOString();
      fs.writeFileSync(file, JSON.stringify({
        id: 'obs_test1', confidence: 0.66, last_seen: oldDate,
      }) + '\n');

      const result = execSync(
        `node "${JSON_HELPER}" temporal-decay "${file}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.decayed).toBe(1);

      const updated = fs.readFileSync(file, 'utf8').trim();
      const entry = JSON.parse(updated);
      expect(entry.confidence).toBeLessThan(0.66);
      expect(entry.confidence).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('removes entries below threshold', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      const oldDate = new Date(Date.now() - 200 * 86400000).toISOString();
      fs.writeFileSync(file, JSON.stringify({
        id: 'obs_test1', confidence: 0.15, last_seen: oldDate,
      }) + '\n');

      const result = execSync(
        `node "${JSON_HELPER}" temporal-decay "${file}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.removed).toBe(1);

      const content = fs.readFileSync(file, 'utf8').trim();
      expect(content).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves fresh entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      const recentDate = new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify({
        id: 'obs_test1', confidence: 0.66, last_seen: recentDate,
      }) + '\n');

      const result = execSync(
        `node "${JSON_HELPER}" temporal-decay "${file}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.decayed).toBe(0);
      expect(counts.removed).toBe(0);

      const entry = JSON.parse(fs.readFileSync(file, 'utf8').trim());
      expect(entry.confidence).toBe(0.66);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles missing file gracefully', () => {
    const result = execSync(
      `node "${JSON_HELPER}" temporal-decay "/tmp/nonexistent-devflow-test-${Date.now()}.jsonl"`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ).toString().trim();
    const counts = JSON.parse(result);
    expect(counts.removed).toBe(0);
    expect(counts.decayed).toBe(0);
  });

  it('handles empty file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(file, '');
      const result = execSync(
        `node "${JSON_HELPER}" temporal-decay "${file}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.removed).toBe(0);
      expect(counts.decayed).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns correct counts for mixed entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      const old35 = new Date(Date.now() - 35 * 86400000).toISOString();
      const old200 = new Date(Date.now() - 200 * 86400000).toISOString();
      const recent = new Date().toISOString();
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'obs_a', confidence: 0.66, last_seen: old35 }),
        JSON.stringify({ id: 'obs_b', confidence: 0.15, last_seen: old200 }),
        JSON.stringify({ id: 'obs_c', confidence: 0.95, last_seen: recent }),
      ].join('\n') + '\n');

      const result = execSync(
        `node "${JSON_HELPER}" temporal-decay "${file}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.decayed).toBe(1);
      expect(counts.removed).toBe(1);

      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('json-helper.cjs process-observations', () => {
  it('creates new observations', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [{
          id: 'obs_abc123', type: 'workflow', pattern: 'test pattern',
          evidence: ['evidence1'], details: 'test details',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.created).toBe(1);
      expect(counts.updated).toBe(0);

      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      expect(entry.id).toBe('obs_abc123');
      expect(entry.confidence).toBe(0.33);
      expect(entry.status).toBe('observing');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updates existing observations', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'old pattern',
        confidence: 0.33, observations: 1,
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-20T00:00:00Z',
        status: 'observing', evidence: ['old evidence'], details: 'old',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [{
          id: 'obs_abc123', type: 'workflow', pattern: 'updated pattern',
          evidence: ['new evidence'], details: 'updated',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.updated).toBe(1);

      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      expect(entry.observations).toBe(2);
      expect(entry.confidence).toBe(0.66);
      expect(entry.evidence).toContain('old evidence');
      expect(entry.evidence).toContain('new evidence');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips observations with missing fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [
          { id: 'obs_abc123', type: 'workflow' },
        ],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.skipped).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips observations with invalid type', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [
          { id: 'obs_abc123', type: 'invalid', pattern: 'test' },
        ],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.skipped).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips observations with invalid id format', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [
          { id: 'bad_id', type: 'workflow', pattern: 'test' },
        ],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.skipped).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('calculates confidence correctly from count', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.80, observations: 4,
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-20T00:00:00Z',
        status: 'observing', evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [{ id: 'obs_abc123', type: 'workflow', pattern: 'test', evidence: [] }],
      }));

      execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      expect(entry.confidence).toBe(0.95);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sets ready on temporal spread', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.80, observations: 4,
        first_seen: eightDaysAgo, last_seen: eightDaysAgo,
        status: 'observing', evidence: [], details: '', quality_ok: true,
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [{ id: 'obs_abc123', type: 'workflow', pattern: 'test', evidence: [], quality_ok: true }],
      }));

      execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      expect(entry.status).toBe('ready');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves created status', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3,
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-22T00:00:00Z',
        status: 'created', evidence: [], details: '',
        artifact_path: '/some/path.md',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [{ id: 'obs_abc123', type: 'workflow', pattern: 'test', evidence: ['new'] }],
      }));

      execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      expect(entry.status).toBe('created');
      expect(entry.observations).toBe(4);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles missing log file by creating it', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [{
          id: 'obs_abc123', type: 'workflow', pattern: 'test', evidence: [],
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.created).toBe(1);
      expect(fs.existsSync(logFile)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns correct counts for mixed operations', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_exist1', type: 'workflow', pattern: 'existing',
        confidence: 0.33, observations: 1,
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-20T00:00:00Z',
        status: 'observing', evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        observations: [
          { id: 'obs_exist1', type: 'workflow', pattern: 'existing', evidence: [] },
          { id: 'obs_new001', type: 'procedural', pattern: 'new pattern', evidence: [] },
          { id: 'bad', type: 'workflow', pattern: 'test' },
        ],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.updated).toBe(1);
      expect(counts.created).toBe(1);
      expect(counts.skipped).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('json-helper.cjs create-artifacts', () => {
  it('creates command with correct frontmatter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'deploy flow',
        confidence: 0.95, observations: 3, status: 'ready',
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-22T00:00:00Z',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'deploy-flow', description: 'Deploy workflow',
          content: '# Deploy Flow\nDeploy the app.',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.created).toHaveLength(1);

      const artPath = path.join(tmpDir, '.claude', 'commands', 'self-learning', 'deploy-flow.md');
      expect(fs.existsSync(artPath)).toBe(true);
      const content = fs.readFileSync(artPath, 'utf8');
      expect(content).toContain('description: "Deploy workflow"');
      expect(content).toContain('devflow-learning: auto-generated');
      expect(content).toContain('# Deploy Flow');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates skill with correct frontmatter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'procedural', pattern: 'debug hooks',
        confidence: 0.95, observations: 3, status: 'ready',
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-22T00:00:00Z',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'skill',
          name: 'debug-hooks', description: 'Debug hook issues',
          content: '# Debug Hooks\nHow to debug hooks.',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.created).toHaveLength(1);

      const artPath = path.join(tmpDir, '.claude', 'skills', 'debug-hooks', 'SKILL.md');
      expect(fs.existsSync(artPath)).toBe(true);
      const content = fs.readFileSync(artPath, 'utf8');
      expect(content).toContain('name: self-learning:debug-hooks');
      expect(content).toContain('user-invocable: false');
      expect(content).toContain('allowed-tools: Read, Grep, Glob');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips non-ready observations', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.33, observations: 1, status: 'observing',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'test-cmd', description: 'Test', content: 'Test',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.skipped).toBe(1);
      expect(counts.created).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips empty or invalid names', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: '!!!', description: 'Test', content: 'Test',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.skipped).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('never overwrites existing files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        evidence: [], details: '',
      }) + '\n');

      const artDir = path.join(tmpDir, '.claude', 'commands', 'self-learning');
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(path.join(artDir, 'existing.md'), 'USER CONTENT');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'existing', description: 'Test', content: 'New content',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.skipped).toBe(1);

      const content = fs.readFileSync(path.join(artDir, 'existing.md'), 'utf8');
      expect(content).toBe('USER CONTENT');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sanitizes artifact name', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'My Cool_Command!@#', description: 'Test', content: 'Test',
        }],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.created).toHaveLength(1);
      expect(counts.created[0]).toContain('mycoolcommand');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('updates observation status in log', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'test-cmd', description: 'Test', content: 'Test',
        }],
      }));

      execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
      expect(entry.status).toBe('created');
      expect(entry.artifact_path).toContain('test-cmd.md');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('escapes description quotes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'test-cmd', description: 'A "quoted" description', content: 'Test',
        }],
      }));

      execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const artPath = path.join(tmpDir, '.claude', 'commands', 'self-learning', 'test-cmd.md');
      const content = fs.readFileSync(artPath, 'utf8');
      expect(content).toContain('description: "A \\"quoted\\" description"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns created paths', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, [
        JSON.stringify({
          id: 'obs_abc123', type: 'workflow', pattern: 'test1',
          confidence: 0.95, observations: 3, status: 'ready',
          evidence: [], details: '',
        }),
        JSON.stringify({
          id: 'obs_def456', type: 'procedural', pattern: 'test2',
          confidence: 0.95, observations: 3, status: 'ready',
          evidence: [], details: '',
        }),
      ].join('\n') + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [
          { observation_id: 'obs_abc123', type: 'command', name: 'cmd1', description: 'Cmd 1', content: 'C1' },
          { observation_id: 'obs_def456', type: 'skill', name: 'skill1', description: 'Skill 1', content: 'S1' },
        ],
      }));

      const result = execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      const counts = JSON.parse(result);
      expect(counts.created).toHaveLength(2);
      expect(counts.created[0]).toContain('cmd1.md');
      expect(counts.created[1]).toContain('SKILL.md');
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


describe('json-helper.cjs create-artifacts frontmatter stripping', () => {
  it('strips model-generated YAML frontmatter from artifact content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-22T00:00:00Z',
        evidence: [], details: '',
      }) + '\n');

      // Model incorrectly includes frontmatter in content
      const contentWithFrontmatter = '---\ndescription: "model added this"\n---\n\n# Real Content\nActual body.';
      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'strip-test', description: 'Test stripping',
          content: contentWithFrontmatter,
        }],
      }));

      execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const artPath = path.join(tmpDir, '.claude', 'commands', 'self-learning', 'strip-test.md');
      const content = fs.readFileSync(artPath, 'utf8');
      // Should have system-generated frontmatter, NOT the model's frontmatter
      expect(content).toContain('description: "Test stripping"');
      expect(content).toContain('devflow-learning: auto-generated');
      // Model's frontmatter should be stripped, leaving only the body
      expect(content).toContain('# Real Content');
      expect(content).not.toContain('model added this');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('preserves content without frontmatter unchanged', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const responseFile = path.join(tmpDir, 'response.json');
    const logFile = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(logFile, JSON.stringify({
        id: 'obs_abc123', type: 'workflow', pattern: 'test',
        confidence: 0.95, observations: 3, status: 'ready',
        first_seen: '2026-03-20T00:00:00Z', last_seen: '2026-03-22T00:00:00Z',
        evidence: [], details: '',
      }) + '\n');

      fs.writeFileSync(responseFile, JSON.stringify({
        artifacts: [{
          observation_id: 'obs_abc123', type: 'command',
          name: 'no-strip-test', description: 'No stripping needed',
          content: '# Clean Content\nNo frontmatter here.',
        }],
      }));

      execSync(
        `node "${JSON_HELPER}" create-artifacts "${responseFile}" "${logFile}" "${tmpDir}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const artPath = path.join(tmpDir, '.claude', 'commands', 'self-learning', 'no-strip-test.md');
      const content = fs.readFileSync(artPath, 'utf8');
      expect(content).toContain('# Clean Content');
      expect(content).toContain('No frontmatter here.');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
  const STOP_HOOK = path.join(HOOKS_DIR, 'sidecar-capture');
  const PREAMBLE_HOOK = path.join(HOOKS_DIR, 'preamble');
  const PROMPT_CAPTURE_HOOK = path.join(HOOKS_DIR, 'sidecar-dispatch');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-queue-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: write a fresh WORKING-MEMORY.md with an old mtime so the throttle passes.
  // sidecar-capture throttles if WORKING-MEMORY.md was updated <120s ago.
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

  it('sidecar-dispatch captures user prompt to queue', () => {
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

  it('sidecar-dispatch with missing .devflow/ — creates it via ensure-devflow-init, exit 0', () => {
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
    // Pre-populate with user-only entries (from sidecar-dispatch)
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

    // Step 1: sidecar-dispatch writes user turn
    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test-fresh', prompt: 'implement feature X' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Step 2: sidecar-capture writes assistant turn
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

  it('sidecar-dispatch truncates prompts longer than 2000 chars', () => {
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

  it('sidecar-capture truncates assistant content longer than 2000 chars', () => {
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

  it('sidecar-capture exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    // Hook exits at line 11 before reading stdin, so don't pipe input — would race
    // and EPIPE on Node 20 when bash closes the pipe before execSync flushes.
    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${STOP_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('sidecar-dispatch exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });

    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${PROMPT_CAPTURE_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
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
  const dir = path.join(cwdDir, '.devflow', 'sidecar');
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
// sidecar-evaluate business logic
// =============================================================================

describe('sidecar-evaluate business logic', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'sidecar-evaluate');

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
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    expect(fs.existsSync(path.join(sidecarDir, 'learning.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    expect(fs.existsSync(path.join(sidecarDir, 'learning.json'))).toBe(false);
    expect(fs.existsSync(path.join(sidecarDir, 'decisions.json'))).toBe(false);
  });

  it('deep session (5 turns) proceeds with evaluation', () => {
    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Session depth: 5 turns');
  });

  it('learning batch accumulation triggers at batch_size threshold', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });

    // Pre-write 2 session IDs (batch_size defaults to 3)
    const sessionCountFile = path.join(sidecarDir, '.learning-sessions');
    fs.writeFileSync(sessionCountFile, 'session-a\nsession-b\n');

    // Create a deep transcript for session-c (the 3rd session)
    createTranscript(homeDir, tmpDir, 5, 5, 'session-c');
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'session-c',
    }, homeDir);

    // Batch complete: per-session learning marker should be written (learning.session-c.json)
    const learningMarker = path.join(sidecarDir, 'learning.session-c.json');
    expect(fs.existsSync(learningMarker)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(learningMarker, 'utf-8'));
    expect(marker).toHaveProperty('userSignals');
    expect(marker).toHaveProperty('existingObservationIds');

    // Session count file should be cleaned up
    expect(fs.existsSync(sessionCountFile)).toBe(false);
  });

  it('learning daily cap blocks marker creation', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });

    // Set daily cap to max
    const today = localDateString();
    fs.writeFileSync(path.join(sidecarDir, '.learning-runs-today'), `${today}\t5\n`);

    // Pre-fill batch to trigger
    fs.writeFileSync(path.join(sidecarDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    expect(fs.existsSync(path.join(sidecarDir, 'learning.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });

    // Pre-fill only 3 sessions (less than adaptive batch_size=5)
    fs.writeFileSync(path.join(sidecarDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    runHook(EVALUATE_HOOK, {
      cwd: tmpDir,
      session_id: 'test-session',
    }, homeDir);

    // 4 sessions total (3 pre-existing + 1 new) < 5 adaptive threshold
    expect(fs.existsSync(path.join(sidecarDir, 'learning.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('4/5 sessions');
  });

  it('learning session dedup: same ID twice counted once', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });

    createTranscript(homeDir, tmpDir, 5, 5, 'dup-session');

    // Run twice with same session_id
    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'dup-session' }, homeDir);
    runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'dup-session' }, homeDir);

    const sessionCountFile = path.join(sidecarDir, '.learning-sessions');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    // Per-session marker: decisions.test-session.json
    const decisionsMarker = path.join(sidecarDir, 'decisions.test-session.json');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    expect(fs.existsSync(path.join(sidecarDir, 'knowledge.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    expect(fs.existsSync(path.join(sidecarDir, 'knowledge.json'))).toBe(false);

    const logDir = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir));
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
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
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('Session depth');
  });
});

// =============================================================================
// sidecar-evaluate artifact reinforcement
// =============================================================================

describe('sidecar-evaluate artifact reinforcement', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'sidecar-evaluate');

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

    const hookLog = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir), '.sidecar-evaluate.log');
    if (fs.existsSync(hookLog)) {
      const log = fs.readFileSync(hookLog, 'utf-8');
      expect(log).not.toContain('Reinforced');
    }
  });
});

// =============================================================================
// sidecar-evaluate read_daily_cap sanitization
// =============================================================================

describe('sidecar-evaluate read_daily_cap sanitization', () => {
  const EVALUATE_HOOK = path.join(HOOKS_DIR, 'sidecar-evaluate');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-cap-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-cap-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'sidecar'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('tab-less counter file does not crash and returns default', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    const today = localDateString();
    // Write date string with no tab separator — cut -f2 returns the whole line
    fs.writeFileSync(path.join(sidecarDir, '.learning-runs-today'), `${today}\n`);

    // Pre-fill batch to trigger learning evaluation
    fs.writeFileSync(path.join(sidecarDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);
  });

  it('empty counter file does not crash', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.writeFileSync(path.join(sidecarDir, '.learning-runs-today'), '');

    fs.writeFileSync(path.join(sidecarDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);
  });

  it('non-numeric count field returns default', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    const today = localDateString();
    fs.writeFileSync(path.join(sidecarDir, '.learning-runs-today'), `${today}\tabc\n`);

    // Pre-fill batch to trigger
    fs.writeFileSync(path.join(sidecarDir, '.learning-sessions'), 'a\nb\nc\n');

    createTranscript(homeDir, tmpDir, 5);
    const { exitCode } = runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
    expect(exitCode).toBe(0);

    // The marker should still be written because cap defaults to 0 (not at max)
    // Per-session marker: learning.test-session.json
    expect(fs.existsSync(path.join(sidecarDir, 'learning.test-session.json'))).toBe(true);
  });

  it('non-numeric config values do not crash', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'learning.json'),
      JSON.stringify({ max_daily_runs: 'xyz', batch_size: 'abc' }),
    );

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    // Pre-fill enough sessions for any reasonable batch_size default (3)
    fs.writeFileSync(path.join(sidecarDir, '.learning-sessions'), 'a\nb\nc\n');

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
    const logFile = path.join(logDir, '.sidecar-evaluate.log');
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
    // We call sidecar-capture (not sidecar-evaluate) for this one since it does the get_mtime check
    const CAPTURE_HOOK = path.join(HOOKS_DIR, 'sidecar-capture');
    // Use execSync to avoid wrapping in runHook abstraction
    const { execSync: execSyncLocal } = require('child_process');
    const exitCode = (() => {
      try {
        execSyncLocal(`bash "${CAPTURE_HOOK}"`, {
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
// sidecar-dispatch stale marker recovery
// =============================================================================

describe('sidecar-dispatch stale marker recovery', () => {
  const DISPATCH_HOOK = path.join(HOOKS_DIR, 'sidecar-dispatch');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-dispatch-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'sidecar'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fresh .processing left alone', () => {
    const procFile = path.join(tmpDir, '.devflow', 'sidecar', 'learning.processing');
    fs.writeFileSync(procFile, '{}');

    execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(fs.existsSync(procFile)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'sidecar', 'learning.json'))).toBe(false);
  });

  it('stale .processing retried — renamed back to .json', () => {
    const procFile = path.join(tmpDir, '.devflow', 'sidecar', 'learning.processing');
    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 600);

    execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'sidecar', 'learning.json'))).toBe(true);

    const retryFile = path.join(tmpDir, '.devflow', 'sidecar', 'learning.retries');
    expect(fs.existsSync(retryFile)).toBe(true);
    expect(fs.readFileSync(retryFile, 'utf-8').trim()).toBe('1');
  });

  it('retry count increments on repeated stale recovery', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    const procFile = path.join(sidecarDir, 'learning.processing');
    const retryFile = path.join(sidecarDir, 'learning.retries');

    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 600);
    fs.writeFileSync(retryFile, '1');

    execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(fs.readFileSync(retryFile, 'utf-8').trim()).toBe('2');
  });

  it('max retries exhausted — marked as .failed', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    const procFile = path.join(sidecarDir, 'learning.processing');
    const retryFile = path.join(sidecarDir, 'learning.retries');

    fs.writeFileSync(procFile, '{}');
    backdateMtime(procFile, 600);
    fs.writeFileSync(retryFile, '3');

    execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(fs.existsSync(procFile)).toBe(false);
    expect(fs.existsSync(path.join(sidecarDir, 'learning.failed'))).toBe(true);
    expect(fs.existsSync(retryFile)).toBe(false);
  });

  it('pending marker directive includes multiple task names', () => {
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.writeFileSync(path.join(sidecarDir, 'learning.json'), '{}');
    fs.writeFileSync(path.join(sidecarDir, 'decisions.json'), '{}');

    const result = execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello world' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();

    const parsed = JSON.parse(result);
    const context = parsed.hookSpecificOutput.additionalContext;
    expect(context).toContain('SIDECAR:');
    expect(context).toContain('learning');
    expect(context).toContain('decisions');
  });
});

// =============================================================================
// sidecar-capture memory marker
// =============================================================================

describe('sidecar-capture memory marker', () => {
  const CAPTURE_HOOK = path.join(HOOKS_DIR, 'sidecar-capture');

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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    const memMarker = path.join(sidecarDir, 'memory.json');
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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'memory.processing'), '{}');

    runHook(CAPTURE_HOOK, {
      cwd: tmpDir,
      session_id: 'test',
      last_assistant_message: 'test response',
    }, homeDir);

    expect(fs.existsSync(path.join(sidecarDir, 'memory.json'))).toBe(false);

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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    expect(fs.existsSync(path.join(sidecarDir, 'memory.json'))).toBe(false);

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

    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    expect(fs.existsSync(path.join(sidecarDir, 'memory.json'))).toBe(false);
  });
});

