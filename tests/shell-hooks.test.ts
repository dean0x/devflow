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
  'ensure-root-gitignore',
  'resolve-project-root',
  'queue-append',
  'capture-prompt',
  'capture-turn',
  'capture-question',
  'memory-worker',
  'spawn-dream-worker',
  'background-dream-update',
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

// =============================================================================
// resolve-project-root — anchor .devflow/ to the project root (Fix 6)
// =============================================================================

describe('resolve-project-root: df_resolve_root', () => {
  const RESOLVE = path.join(HOOKS_DIR, 'resolve-project-root');

  function resolveRoot(cwd: string): string {
    return execSync(`bash -c 'source "${RESOLVE}"; df_resolve_root "${cwd}"'`, { stdio: 'pipe' })
      .toString()
      .trim();
  }

  it('(a) returns the git toplevel for a normal subdir inside a repo', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-rpr-git-'));
    try {
      execSync(`git init -q "${repo}"`, { stdio: 'pipe' });
      const real = fs.realpathSync(repo);
      const sub = path.join(real, 'src', 'deep', 'nested');
      fs.mkdirSync(sub, { recursive: true });
      expect(fs.realpathSync(resolveRoot(sub))).toBe(real);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(b) returns the repo root for a path inside .devflow/ — git walks up (the stray-nesting fix)', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-rpr-dev-'));
    try {
      execSync(`git init -q "${repo}"`, { stdio: 'pipe' });
      const real = fs.realpathSync(repo);
      const nested = path.join(real, '.devflow', 'docs', 'waves', 'x', 'tickets');
      fs.mkdirSync(nested, { recursive: true });
      expect(fs.realpathSync(resolveRoot(nested))).toBe(real);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('(c) non-git: strips from the first /.devflow/ onward', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-rpr-nogit-'));
    try {
      const real = fs.realpathSync(base);
      const nested = path.join(real, '.devflow', 'docs', 'tickets');
      fs.mkdirSync(nested, { recursive: true });
      // No git repo above os.tmpdir() → fallback strip yields the path before /.devflow/.
      expect(resolveRoot(nested)).toBe(real);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('(c2) non-git, no .devflow in path: returns cwd unchanged', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-rpr-plain-'));
    try {
      const real = fs.realpathSync(base);
      const sub = path.join(real, 'a', 'b');
      fs.mkdirSync(sub, { recursive: true });
      expect(resolveRoot(sub)).toBe(sub);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('hooks anchor .devflow/ to the project root (no stray nested .devflow/)', () => {
  const STOP_HOOK = path.join(HOOKS_DIR, 'capture-turn');

  it('capture-turn run with a CWD inside .devflow/ writes the queue at the repo root, not a nested .devflow/', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-anchor-'));
    try {
      execSync(`git init -q "${repo}"`, { stdio: 'pipe' });
      const real = fs.realpathSync(repo);

      // The hook runs with a CWD deep inside .devflow/ — the stray-nesting scenario.
      const nestedCwd = path.join(real, '.devflow', 'docs', 'waves', 'w', 'tickets');
      fs.mkdirSync(nestedCwd, { recursive: true });

      const input = JSON.stringify({
        cwd: nestedCwd,
        session_id: 'anchor-test',
        last_assistant_message: 'hello from a nested cwd',
      });
      execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

      // Queue written at the REAL repo root .devflow/memory/ ...
      const rootQueue = path.join(real, '.devflow', 'memory', '.pending-turns.jsonl');
      expect(fs.existsSync(rootQueue)).toBe(true);
      const entry = JSON.parse(fs.readFileSync(rootQueue, 'utf-8').trim().split('\n').filter(Boolean)[0]);
      expect(entry.role).toBe('assistant');

      // ... and NO stray nested .devflow/ was scaffolded under the nested cwd.
      expect(fs.existsSync(path.join(nestedCwd, '.devflow'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
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

  it('creates .devflow/features/ directory when absent (no index.json — write-through model)', () => {
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    // Knowledge index is now write-through (written when a KB is created/refreshed in-command)
    // ensure-devflow-init only creates the directory, not the index file
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'features'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'features', 'index.json'))).toBe(false);
  });

  it('writes the .devflow/ carve-out to the project root .gitignore (creates it when absent)', () => {
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const lines = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8').split('\n').map(l => l.trim());
    // Wholesale .devflow/ replaced by the carve-out: everything local except feature knowledge
    expect(lines).toContain('.devflow/*');
    expect(lines).toContain('!.devflow/features/');
    expect(lines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(lines).not.toContain('.devflow/'); // no bare wholesale line
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'))).toBe(true);
    // No nested .devflow/.gitignore is written
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.gitignore'))).toBe(false);
  });

  it('appends the .devflow/ carve-out to an existing root .gitignore without clobbering it', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore.split('\n').map(l => l.trim())).toContain('!.devflow/features/*/KNOWLEDGE.md');
  });

  it('is idempotent — the carve-out appears exactly once after repeated runs', () => {
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const entries = gitignore.split('\n').map(l => l.trim()).filter(l => l === '!.devflow/features/*/KNOWLEDGE.md');
    expect(entries).toHaveLength(1);
  });

  it('respects a user-authored /.devflow/ entry — neither duplicates nor forces the carve-out', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '/.devflow/\n');
    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    // A leading-slash entry is treated as the user's own choice: left intact, no carve-out forced
    expect(gitignore.split('\n').map(l => l.trim()).filter(l => l === '.devflow/')).toHaveLength(0);
    expect(gitignore).toContain('/.devflow/');
    expect(gitignore).not.toContain('!.devflow/features/');
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

describe('ensure-root-gitignore behavioral', () => {
  const ENSURE_ROOT = path.join(HOOKS_DIR, 'ensure-root-gitignore');

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-rootignore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const ignoreLines = (file: string): string[] =>
    fs.readFileSync(file, 'utf-8').split('\n').map(l => l.trim());

  it('creates the root .gitignore (and .devflow/) when absent, writes the v2 marker', () => {
    // Standalone case (as session-start-context calls it): no .devflow/ exists yet.
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignore)).toBe(true);
    expect(ignoreLines(gitignore)).toContain('.devflow/*');
    expect(ignoreLines(gitignore)).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(ignoreLines(gitignore)).not.toContain('.devflow/'); // carve-out, not wholesale
    // The helper must create .devflow/ to host the marker even when called standalone
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'))).toBe(true);
    // No nested .devflow/.gitignore written
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.gitignore'))).toBe(false);
  });

  it('appends the carve-out to an existing root .gitignore without clobbering it', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\ndist/\n');
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    const content = fs.readFileSync(gitignore, 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(ignoreLines(gitignore)).toContain('!.devflow/features/*/KNOWLEDGE.md');
  });

  it('is idempotent — the carve-out appears exactly once after repeated runs', () => {
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const entries = ignoreLines(path.join(tmpDir, '.gitignore')).filter(l => l === '!.devflow/features/*/KNOWLEDGE.md');
    expect(entries).toHaveLength(1);
  });

  it('respects a user-authored /.devflow/ entry — no bare duplicate, no carve-out forced', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '/.devflow/\n');
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    // A leading-slash entry is the user's own choice: left intact, carve-out not forced
    expect(ignoreLines(gitignore).filter(l => l === '.devflow/')).toHaveLength(0);
    expect(fs.readFileSync(gitignore, 'utf-8')).toContain('/.devflow/');
    expect(ignoreLines(gitignore)).not.toContain('!.devflow/features/');
  });

  it('v2 marker short-circuits subsequent runs (O(1) fast-path) — does not touch .gitignore', () => {
    // Pre-seed the current-format marker; the helper must return early, leaving .gitignore untouched.
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'), '');
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    // No .gitignore should have been created because the marker fast-path fired first
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);
  });

  it('upgrades a legacy install: replaces bare .devflow/ with the carve-out and bumps v1 → v2', () => {
    // Simulate an existing v1 install: legacy comment + bare wholesale entry + v1 marker.
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      'node_modules/\n\n# Devflow runtime data (local by default; remove to share via git)\n.devflow/\n',
    );
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured'), ''); // v1 marker
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    const lines = ignoreLines(gitignore);
    const content = fs.readFileSync(gitignore, 'utf-8');
    // Legacy bare entry and old comment are gone; carve-out is in; unrelated entry preserved.
    expect(lines).not.toContain('.devflow/');
    expect(content).not.toContain('remove to share via git');
    expect(lines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(content).toContain('node_modules/');
    // Marker is bumped: v1 dropped, v2 written.
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'))).toBe(true);
  });

  it('returns non-zero and creates nothing when called with an empty argument', () => {
    const result = execSync(
      `bash -c 'source "${ENSURE_ROOT}" ""; echo $?'`,
      { stdio: 'pipe' },
    ).toString().trim();

    expect(result).toBe('1');
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

describe('run-hook behavioral', () => {
  const RUN_HOOK = path.join(HOOKS_DIR, 'run-hook');

  it('exits 0 with a stderr warning when the named script is absent', () => {
    // Covers the init upgrade-swap window and hand-edited settings.json entries
    // that still point at a hook name that was renamed or removed (e.g. a
    // pre-cutover dream-* registration lingering until the next `devflow init`).
    // Exit is 0 (no throw), so the warning is captured via 2>&1 redirection
    // rather than relying on execSync's catch-path stderr capture.
    const output = execSync(`bash "${RUN_HOOK}" definitely-not-a-real-hook-name 2>&1`, {
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    expect(output).toContain('definitely-not-a-real-hook-name');
    expect(output).toContain('not found');
  });

  it('still execs a real hook script normally (get-mtime sourced via a no-op wrapper check)', () => {
    // run-hook execs `bash <script> "$@"` — for a script that itself expects to be
    // sourced (like get-mtime) rather than executed, the safest smoke test is a
    // script designed for direct execution. debug-trace is sourced elsewhere but
    // also tolerates direct execution (no side effects without DEVFLOW_HOOK_DEBUG).
    expect(() => {
      execSync(`bash "${RUN_HOOK}" debug-trace`, { stdio: 'pipe' });
    }).not.toThrow();
  });
});

// =============================================================================
// Shared hook-invocation helper (JSON stdin, HOME override) — used by the
// session-start-context root .gitignore describe below.
// =============================================================================

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
// session-start-context: memory-independent root .gitignore write (PF-014 fix)
// =============================================================================
//
// The root .gitignore write must NOT depend on the memory feature toggle. Before
// this fix the only writer (ensure-devflow-init) was reached only behind the memory
// gate, so a project with memory OFF but decisions/knowledge ON never got .devflow/
// ignored. session-start-context (always-on) now sources ensure-root-gitignore early,
// covering exactly that case.

describe('session-start-context root .gitignore (memory-independent)', () => {
  const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-ignore-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-ignore-home-'));
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('adds .devflow/ to the root .gitignore even when memory is disabled', () => {
    // Memory OFF, decisions implicitly ON — the exact gap PF-014 describes.
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'dream', 'config.json'),
      JSON.stringify({ memory: false }),
    );
    // No root .gitignore present to begin with.
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);

    runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);

    const gitignore = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignore)).toBe(true);
    expect(fs.readFileSync(gitignore, 'utf-8').split('\n').map(l => l.trim())).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'))).toBe(true);
  });
});

