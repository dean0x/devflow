import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');

const JSON_HELPER = path.join(HOOKS_DIR, 'json-helper.cjs');

const HOOK_SCRIPTS = [
  'background-learning',
  'session-end-learning',
  'stop-update-learning',
  'background-memory-update',
  'stop-update-memory',
  'session-start-memory',
  'pre-compact-memory',
  'prompt-capture-memory',
  'preamble',
  'json-parse',
  'get-mtime',
  'session-end-knowledge-refresh',
  'background-knowledge-refresh',
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

describe('background-learning pure functions', () => {
  it('check_daily_cap respects counter file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const counterFile = path.join(tmpDir, '.learning-runs-today');
    // Get today's date from bash to avoid timezone mismatches
    const today = execSync('date +%Y-%m-%d', { stdio: 'pipe' }).toString().trim();

    const makeScript = (cf: string) => `bash -c '
      check_daily_cap() {
        local COUNTER_FILE="${cf}"
        local MAX_DAILY_RUNS=10
        local TODAY=$(date +%Y-%m-%d)
        if [ -f "$COUNTER_FILE" ]; then
          local COUNTER_DATE=$(cut -f1 "$COUNTER_FILE")
          local COUNTER_COUNT=$(cut -f2 "$COUNTER_FILE")
          if [ "$COUNTER_DATE" = "$TODAY" ] && [ "$COUNTER_COUNT" -ge "$MAX_DAILY_RUNS" ]; then
            return 1
          fi
        fi
        return 0
      }
      check_daily_cap && echo "ok" || echo "capped"
    '`;

    try {
      // Under cap — should succeed
      fs.writeFileSync(counterFile, `${today}\t5\n`);
      const underCap = execSync(makeScript(counterFile), { stdio: 'pipe' }).toString().trim();
      expect(underCap).toBe('ok');

      // At cap — should return capped
      fs.writeFileSync(counterFile, `${today}\t10\n`);
      const atCap = execSync(makeScript(counterFile), { stdio: 'pipe' }).toString().trim();
      expect(atCap).toBe('capped');

      // Old date — should not be capped
      fs.writeFileSync(counterFile, `2020-01-01\t99\n`);
      const oldDate = execSync(makeScript(counterFile), { stdio: 'pipe' }).toString().trim();
      expect(oldDate).toBe('ok');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('increment_daily_counter creates and increments counter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const counterFile = path.join(tmpDir, '.learning-runs-today');
    // Get today's date from bash to avoid timezone mismatches
    const today = execSync('date +%Y-%m-%d', { stdio: 'pipe' }).toString().trim();

    const makeScript = (cf: string) => `bash -c '
      COUNTER_FILE="${cf}"
      increment_daily_counter() {
        local TODAY=$(date +%Y-%m-%d)
        local COUNT=1
        if [ -f "$COUNTER_FILE" ] && [ "$(cut -f1 "$COUNTER_FILE")" = "$TODAY" ]; then
          COUNT=$(( $(cut -f2 "$COUNTER_FILE") + 1 ))
        fi
        printf "%s\\t%d\\n" "$TODAY" "$COUNT" > "$COUNTER_FILE"
      }
      increment_daily_counter
    '`;

    try {
      // First call — creates file with count 1
      execSync(makeScript(counterFile), { stdio: 'pipe' });
      const content1 = fs.readFileSync(counterFile, 'utf-8').trim();
      expect(content1).toBe(`${today}\t1`);

      // Second call — increments to 2
      execSync(makeScript(counterFile), { stdio: 'pipe' });
      const content2 = fs.readFileSync(counterFile, 'utf-8').trim();
      expect(content2).toBe(`${today}\t2`);
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

describe('session-end-learning structure', () => {
  it('starts with bash shebang and sources json-parse', () => {
    const scriptPath = path.join(HOOKS_DIR, 'session-end-learning');
    const content = fs.readFileSync(scriptPath, 'utf8');
    const lines = content.split('\n');
    expect(lines[0]).toBe('#!/bin/bash');
    expect(content).toContain('source "$SCRIPT_DIR/json-parse"');
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
  const STOP_HOOK = path.join(HOOKS_DIR, 'stop-update-memory');
  const PREAMBLE_HOOK = path.join(HOOKS_DIR, 'preamble');
  const PROMPT_CAPTURE_HOOK = path.join(HOOKS_DIR, 'prompt-capture-memory');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-queue-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stop_reason tool_use — no queue append', () => {
    // Create .memory/ so the hook proceeds to the stop_reason check
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-001',
      stop_reason: 'tool_use',
      assistant_message: 'test response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('stop_reason end_turn — appends assistant turn to queue', () => {
    // Create .memory/ directory
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    // Touch throttle marker to prevent background spawn attempt
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-002',
      stop_reason: 'end_turn',
      assistant_message: 'test response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.role).toBe('assistant');
    expect(entry.content).toBe('test response');
    expect(typeof entry.ts).toBe('number');
  });

  it('prompt-capture-memory captures user prompt to queue', () => {
    // Create .memory/ directory so capture is triggered
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-003',
      prompt: 'implement the cache',
    });

    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.role).toBe('user');
    expect(entry.content).toBe('implement the cache');
    expect(typeof entry.ts).toBe('number');
  });

  it('prompt-capture-memory with missing .memory/ — creates it via ensure-memory-gitignore, exit 0', () => {
    // tmpDir exists but has no .memory/ subdirectory — ensure-memory-gitignore creates it
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-004a',
      prompt: 'implement the cache',
    });

    expect(() => {
      execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();

    // Hook creates .memory/ and writes to queue
    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  it('preamble does NOT write to queue — zero file I/O', () => {
    // Create .memory/ to confirm preamble doesn't touch the queue even when .memory/ exists
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-004',
      prompt: 'implement the cache',
    });

    // Should not throw (exit 0)
    expect(() => {
      execSync(`bash "${PREAMBLE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('preamble with slash command — exits 0, no queue write', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-004b',
      prompt: '/code-review',
    });

    expect(() => {
      execSync(`bash "${PREAMBLE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('queue JSONL format — each line is valid JSON with role, content, ts', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');

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

  it('stop_reason end_turn — content array: joins text blocks, excludes tool_use', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    // Touch throttle marker to prevent background spawn attempt
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-005',
      stop_reason: 'end_turn',
      assistant_message: [
        { type: 'text', text: 'First part of response' },
        { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/tmp/foo' } },
        { type: 'text', text: 'Second part of response' },
      ],
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);

    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.role).toBe('assistant');
    // Both text blocks joined with newline; tool_use block excluded
    expect(entry.content).toBe('First part of response\nSecond part of response');
    expect(typeof entry.ts).toBe('number');
  });

  it('queue overflow — >200 lines truncated to last 100', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    // Touch throttle marker to prevent background spawn attempt
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    const now = Math.floor(Date.now() / 1000);

    // Pre-populate queue with 201 entries
    const existingLines = Array.from({ length: 201 }, (_, i) =>
      JSON.stringify({ role: 'user', content: `entry ${i}`, ts: now + i }),
    );
    fs.writeFileSync(queueFile, existingLines.join('\n') + '\n');

    // Trigger stop hook — appends 1 more entry, then overflow check fires
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-session-006',
      stop_reason: 'end_turn',
      assistant_message: 'overflow trigger response',
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    // After overflow: 201 pre-existing + 1 new = 202 lines → truncated to last 100
    const resultLines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(resultLines).toHaveLength(100);

    // The new entry (the assistant turn) must be present as the last line
    const lastEntry = JSON.parse(resultLines[resultLines.length - 1]);
    expect(lastEntry.role).toBe('assistant');
    expect(lastEntry.content).toBe('overflow trigger response');
  });

  it('prompt-capture-memory truncates prompts longer than 2000 chars', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    const longPrompt = 'a'.repeat(3000);
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-trunc-001',
      prompt: longPrompt,
    });

    execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    // Truncated at 2000 chars + '... [truncated]' suffix (15 chars) = 2015
    expect(entry.content.length).toBe(2015);
    expect(entry.content).toContain('[truncated]');
  });

  it('stop-update-memory truncates assistant content longer than 2000 chars', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    // Touch throttle marker to prevent background spawn attempt
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

    const longMessage = 'b'.repeat(5000);
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-trunc-002',
      stop_reason: 'end_turn',
      assistant_message: longMessage,
    });

    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    // Truncated at 2000 chars + '... [truncated]' suffix (15 chars) = 2015
    expect(entry.content.length).toBe(2015);
    expect(entry.content).toContain('[truncated]');
  });

  it('stop-update-memory exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    // Hook exits at line 11 before reading stdin, so don't pipe input — would race
    // and EPIPE on Node 20 when bash closes the pipe before execSync flushes.
    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${STOP_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
  });

  it('prompt-capture-memory exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });

    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${PROMPT_CAPTURE_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();

    const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(false);
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

describe('session-end-knowledge-refresh guard clauses', () => {
  const KB_HOOK = path.join(HOOKS_DIR, 'session-end-knowledge-refresh');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-knowledge-hook-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits cleanly when DEVFLOW_BG_KNOWLEDGE_REFRESH=1', () => {
    expect(() => {
      execSync(`DEVFLOW_BG_KNOWLEDGE_REFRESH=1 bash "${KB_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();
  });

  it('exits cleanly when DEVFLOW_BG_UPDATER=1', () => {
    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${KB_HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();
  });

  it('exits cleanly when no .features/index.json exists', () => {
    const input = JSON.stringify({ cwd: tmpDir, session_id: 'test-knowledge-001' });
    expect(() => {
      execSync(`bash "${KB_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('exits cleanly when .features/.disabled sentinel exists', () => {
    const featuresDir = path.join(tmpDir, '.features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify({ version: 1, features: {} }));
    fs.writeFileSync(path.join(featuresDir, '.disabled'), '');

    const input = JSON.stringify({ cwd: tmpDir, session_id: 'test-knowledge-002' });
    expect(() => {
      execSync(`bash "${KB_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('exits cleanly when .knowledge-last-refresh is recent (throttled)', () => {
    const featuresDir = path.join(tmpDir, '.features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify({ version: 1, features: {} }));
    fs.writeFileSync(path.join(featuresDir, '.knowledge-last-refresh'), String(Math.floor(Date.now() / 1000)));

    const input = JSON.stringify({ cwd: tmpDir, session_id: 'test-knowledge-003' });
    expect(() => {
      execSync(`bash "${KB_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('exits cleanly when no stale knowledge bases are found', () => {
    // Non-git tmpDir → checkAllStaleness returns stale:false
    const featuresDir = path.join(tmpDir, '.features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify({
      version: 1,
      features: {
        'test-feature': {
          name: 'Test', description: '', directories: ['src/'],
          referencedFiles: ['src/index.ts'],
          lastUpdated: new Date().toISOString(), createdBy: 'test',
        },
      },
    }));

    const input = JSON.stringify({ cwd: tmpDir, session_id: 'test-knowledge-004' });
    expect(() => {
      execSync(`bash "${KB_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });
});
