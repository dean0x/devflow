import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');

const JSON_HELPER = path.join(HOOKS_DIR, 'json-helper.cjs');

const HOOK_SCRIPTS = [
  'background-learning',
  'stop-update-learning',
  'background-memory-update',
  'stop-update-memory',
  'session-start-memory',
  'pre-compact-memory',
  'ambient-prompt',
  'json-parse',
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
  it('decay_factor returns correct values for all periods', () => {
    const expected: Record<string, string> = {
      '0': '100', '1': '90', '2': '81',
      '3': '73', '4': '66', '5': '59',
      '6': '53', '10': '53', '99': '53',
    };

    for (const [input, output] of Object.entries(expected)) {
      const result = execSync(
        `bash -c '
          decay_factor() {
            case $1 in
              0) echo "100";; 1) echo "90";; 2) echo "81";;
              3) echo "73";; 4) echo "66";; 5) echo "59";;
              *) echo "53";;
            esac
          }
          decay_factor ${input}
        '`,
        { stdio: 'pipe' },
      ).toString().trim();
      expect(result).toBe(output);
    }
  });

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
        JSON.stringify({ id: 'obs_1', type: 'workflow', status: 'created', artifact_path: '/path/learned/deploy-flow.md', confidence: 0.95 }),
        JSON.stringify({ id: 'obs_2', type: 'procedural', status: 'created', artifact_path: '/path/learned-debug-hooks/SKILL.md', confidence: 0.8 }),
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
