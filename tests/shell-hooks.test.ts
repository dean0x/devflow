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
  'session-start-orchestrator',
  'pre-compact-memory',
  'preamble',
  'git-marker',
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
// preamble — orchestrator charter mode (Suites 1-4)
// =============================================================================

describe('preamble — orchestrator charter mode', () => {
  const PREAMBLE_HOOK = path.join(HOOKS_DIR, 'preamble');
  const PREAMBLE_SRC = path.resolve(__dirname, '..', 'scripts', 'hooks', 'preamble');

  let tmpDir: string;   // has a .git dir → git gate passes
  let noGitDir: string; // plain dir, no .git → git gate rejects

  // Exact output templates — tests assert byte equality to detect injection
  const HANDOFF_TEMPLATE =
    "The user's prompt is a plan handoff (it begins with `Implement the following plan:`). " +
    "In one short sentence, tell the user you're invoking `devflow:implement`. " +
    'Then immediately invoke it with the Skill tool, passing the full plan ' +
    '(everything after the handoff prefix) as the skill input so it can be executed. ' +
    'Do not pause to ask whether to proceed.';

  const REMINDER_TEMPLATE =
    "Orchestrator reminder: coordinate, don't produce — delegate edits, builds, multi-file reads, " +
    'and debug loops via the Agent tool (haiku=mechanical, sonnet=defined execution, opus=analysis/design/research) ' +
    'or the matching devflow workflow skill.\n' +
    'Keep only judgment work mainline: conversation, decisions, routing, synthesis of agent reports.';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-preamble-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));  // git gate must pass
    noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-preamble-nogit-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(noGitDir, { recursive: true, force: true });
  });

  /** Run the preamble hook in a git repo and return stdout. */
  function runPreamble(prompt: string, cwd?: string): string {
    const dir = cwd ?? tmpDir;
    const input = JSON.stringify({ cwd: dir, prompt });
    return execSync(`bash "${PREAMBLE_HOOK}"`, {
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  }

  /** Run the preamble hook in a non-git dir. */
  function runPreambleNoGit(prompt: string): string {
    const input = JSON.stringify({ cwd: noGitDir, prompt });
    return execSync(`bash "${PREAMBLE_HOOK}"`, {
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  }

  // -------------------------------------------------------------------------
  // Suite 1 — Functionality
  // -------------------------------------------------------------------------

  describe('Suite 1 — Functionality', () => {
    // --- Plan-handoff fast-path ---

    it('F3a: native handoff flavor (prefix + \\n\\n + plan + transcript suffix) → handoff directive', () => {
      const prompt =
        'Implement the following plan:\n\n# Add caching\n\n1. Add Redis\n2. Write tests\n\n' +
        '...before exiting plan mode (if you are in plan mode), read the full transcript at: /tmp/session.jsonl';
      const out = runPreamble(prompt);
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(HANDOFF_TEMPLATE);
    });

    it('F3b: same-session handoff flavor (prefix + space + plan text) → handoff directive', () => {
      const out = runPreamble('Implement the following plan: add caching to the system');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(HANDOFF_TEMPLATE);
    });

    it('F3c: modest leading whitespace before prefix → handoff directive', () => {
      const out = runPreamble('  \n\nImplement the following plan: add caching');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(HANDOFF_TEMPLATE);
    });

    it('F3d: prefix mid-prompt → reminder (not handoff)', () => {
      const out = runPreamble('Please Implement the following plan: add X');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    it('F3e: lowercase prefix → reminder (prefix is case-sensitive)', () => {
      const out = runPreamble('implement the following plan: add X');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    it('F3f: prefix without colon → reminder (literal match requires colon)', () => {
      const out = runPreamble('Implement the following plan now — add caching');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    // --- Slash / empty skip ---

    it('F4a: slash command → empty stdout', () => {
      expect(runPreamble('/implement foo')).toBe('');
    });

    it('F4b: slash command with leading spaces → empty stdout', () => {
      expect(runPreamble('  /help now')).toBe('');
    });

    it('F4c: bare slash → empty stdout', () => {
      expect(runPreamble('/')).toBe('');
    });

    it('F4d: path-like prompt → empty stdout (slash prefix)', () => {
      expect(runPreamble('/Users/dean/x.ts')).toBe('');
    });

    it('F4e: empty prompt → empty stdout', () => {
      expect(runPreamble('')).toBe('');
    });

    it('F4f: whitespace-only prompt → empty stdout', () => {
      expect(runPreamble('   \n\n  ')).toBe('');
    });

    // --- Orchestrator reminder (normal prompts) ---

    it('F2a: normal prompt → reminder template exact', () => {
      const out = runPreamble('fix the auth bug');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    it('F5a: old keyword prompt (implement the cache) → reminder, not directive [AC-F5]', () => {
      const out = runPreamble('implement the cache');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    it('F5b: old keyword prompt (plan a caching layer) → reminder, not directive [AC-F5]', () => {
      const out = runPreamble('plan a caching layer');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    it('F5c: 3-marker plan body (## Goal/Steps/Files) → reminder, not directive [AC-F5]', () => {
      const out = runPreamble('## Goal\nBuild a cache\n## Steps\n1. Add\n## Files\ncache.ts');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    // --- Git gate ---

    it('F6a: non-git CWD → empty stdout for normal prompt [AC-F6]', () => {
      expect(runPreambleNoGit('fix the auth bug')).toBe('');
    });

    it('F6b: non-git CWD → empty stdout for handoff prompt [AC-F6]', () => {
      expect(runPreambleNoGit('Implement the following plan: add caching')).toBe('');
    });

    it('F6c: .git as a plain FILE (worktree style) → fires correctly', () => {
      const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-wt-'));
      try {
        fs.writeFileSync(path.join(worktreeDir, '.git'), 'gitdir: /some/path/.git');
        const out = runPreamble('fix the auth bug', worktreeDir);
        expect(out.length).toBeGreaterThan(0);
        const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
        expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
      } finally {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
    });

    it('F6d: .git in ancestor dir (subdir of git repo) → fires correctly', () => {
      const subDir = path.join(tmpDir, 'src', 'auth');
      fs.mkdirSync(subDir, { recursive: true });
      // tmpDir already has .git — subDir is a child of the repo
      const out = runPreamble('fix the auth bug', subDir);
      expect(out.length).toBeGreaterThan(0);
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    // --- 256-window bound ---

    it('F12: 300 leading spaces before prefix → no plan handoff (prefix beyond 256-byte window) [AC-F12]', () => {
      // 300 leading spaces fill the 256-byte HEAD window with whitespace; after stripping,
      // HEAD is empty — plan handoff does NOT fire. Silent exit (AC-F4 whitespace rule applies).
      const prompt = ' '.repeat(300) + 'Implement the following plan: add caching';
      const out = runPreamble(prompt);
      // Either empty (whitespace-only HEAD) or reminder — never the handoff directive
      if (out.length > 0) {
        const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
        expect(parsed.hookSpecificOutput.additionalContext).not.toBe(HANDOFF_TEMPLATE);
      }
      // No plan handoff directive fired — this is the key AC-F12 assertion
      expect(out).not.toContain('plan handoff');
    });

    // --- Background-session re-entrancy guard ---

    it('F13: DEVFLOW_BG_UPDATER=1 → empty stdout (no injection into nested bg sessions) [AC-F9]', () => {
      // The background memory worker (claude -p) runs in the project git root and fires
      // UserPromptSubmit; the guard must suppress the orchestrator reminder there.
      const input = JSON.stringify({ cwd: tmpDir, prompt: 'refresh working memory from these turns' });
      const out = execSync(`bash "${PREAMBLE_HOOK}"`, {
        input,
        env: { ...process.env, DEVFLOW_BG_UPDATER: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();
      expect(out).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Suite 2 — API contract (C1–C6)
  // -------------------------------------------------------------------------

  describe('Suite 2 — API contract', () => {
    it('C1/C6a: handoff output has exactly one top-level key hookSpecificOutput with correct schema', () => {
      const out = runPreamble('Implement the following plan: add caching');
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
      const hso = parsed.hookSpecificOutput as Record<string, unknown>;
      expect(hso.hookEventName).toBe('UserPromptSubmit');
      expect(typeof hso.additionalContext).toBe('string');
      expect((hso.additionalContext as string).length).toBeGreaterThan(0);
      expect(Object.keys(hso).sort()).toEqual(['additionalContext', 'hookEventName'].sort());
    });

    it('C1/C6b: reminder output has correct schema', () => {
      const out = runPreamble('fix the auth bug');
      const parsed = JSON.parse(out) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
      const hso = parsed.hookSpecificOutput as Record<string, unknown>;
      expect(hso.hookEventName).toBe('UserPromptSubmit');
      expect(Object.keys(hso).sort()).toEqual(['additionalContext', 'hookEventName'].sort());
    });

    it('C2: empty stdout on slash → zero bytes', () => {
      expect(runPreamble('/implement foo').length).toBe(0);
    });

    it('C2: empty stdout on empty prompt → zero bytes', () => {
      expect(runPreamble('').length).toBe(0);
    });

    it('C3a: exit code 0 on handoff match', () => {
      expect(() => runPreamble('Implement the following plan: add caching')).not.toThrow();
    });

    it('C3b: exit code 0 on reminder (normal prompt)', () => {
      expect(() => runPreamble('fix the auth bug')).not.toThrow();
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

    it('C4: no file I/O on handoff — tmpDir unchanged (only .git present)', () => {
      const before = fs.readdirSync(tmpDir).sort();
      runPreamble('Implement the following plan: add caching');
      expect(fs.readdirSync(tmpDir).sort()).toEqual(before);
    });

    it('C4: no file I/O on reminder — tmpDir unchanged', () => {
      const before = fs.readdirSync(tmpDir).sort();
      runPreamble('fix the auth bug');
      expect(fs.readdirSync(tmpDir).sort()).toEqual(before);
    });

    it('C5: preamble source contains no bash-4-only ${var,,} or ${var^^} in non-comment code', () => {
      const src = fs.readFileSync(PREAMBLE_SRC, 'utf-8');
      const codeLines = src
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(codeLines).not.toMatch(/\$\{[^}]+,,\}/);
      expect(codeLines).not.toMatch(/\$\{[^}]+\^\^\}/);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 3 — Security / fuzz (C3 zero-interpolation)
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
      it(`C3: hostile tail after handoff prefix (${label}) — fixed handoff template, no injection`, () => {
        const prompt = `Implement the following plan: ${tail}`;
        const inputFile = path.join(tmpDir, `input-handoff-${label.replace(/\W/g, '_')}.json`);
        fs.writeFileSync(inputFile, JSON.stringify({ cwd: tmpDir, prompt }));
        const out = execSync(`bash "${PREAMBLE_HOOK}" < "${inputFile}"`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();
        const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
        expect(parsed.hookSpecificOutput.additionalContext).toBe(HANDOFF_TEMPLATE);
      });

      it(`C3: hostile standalone prompt (${label}) — fixed reminder template, no injection`, () => {
        const prompt = `${tail}`;
        const inputFile = path.join(tmpDir, `input-stand-${label.replace(/\W/g, '_')}.json`);
        fs.writeFileSync(inputFile, JSON.stringify({ cwd: tmpDir, prompt }));
        // Run only if prompt doesn't start with / (which would be silenced)
        const head = tail.trimStart().slice(0, 256);
        if (head.startsWith('/')) return; // slash-prefix → empty, not reminder
        const out = execSync(`bash "${PREAMBLE_HOOK}" < "${inputFile}"`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();
        if (out.length === 0) return; // empty (e.g., whitespace-only) → no assertion needed
        const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
        expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Suite 4 — Performance (P1–P3)
  // -------------------------------------------------------------------------

  describe('Suite 4 — Performance', () => {
    it('P1: no subprocess calls in git-gate + dispatch blocks (awk/sed/tr/$() absent)', () => {
      const src = fs.readFileSync(PREAMBLE_SRC, 'utf-8');
      // Locate the git-gate block through to end of dispatch
      const blockStart = src.indexOf('# --- Git-repo gate');
      const blockEnd = src.indexOf('dbg "=== HOOK COMPLETE ===');
      expect(blockStart).toBeGreaterThan(-1);
      expect(blockEnd).toBeGreaterThan(blockStart);
      const block = src.slice(blockStart, blockEnd);

      const codeLines = block
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

      expect(codeLines).not.toMatch(/\bawk\b/);
      expect(codeLines).not.toMatch(/\bsed\b/);
      expect(codeLines).not.toMatch(/\btr\b/);
      expect(codeLines).not.toMatch(/\$\(\s*[a-zA-Z]/);
    });

    it('P2/P3: wall-time on large prompt is bounded — delta < 500ms and ratio < 5×', () => {
      // O(1) dispatch (capped at 256 bytes); wall-time difference is dominated by JSON parsing.
      // Thresholds are intentionally generous — correctness test, not a benchmark.
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

      const smallPrompt = 'fix the auth module';
      const largePrompt = `fix ${'x'.repeat(200_000)}`;

      const smallMs = median(measureMs(smallPrompt));
      const largeMs = median(measureMs(largePrompt));

      const delta = largeMs - smallMs;
      const ratio = smallMs > 0 ? largeMs / smallMs : largeMs;

      expect(delta).toBeLessThan(500);
      expect(ratio).toBeLessThan(5);
    });
  });
});

// =============================================================================
// session-start-orchestrator: orchestrator charter injection
// =============================================================================

describe('session-start-orchestrator', () => {
  const ORCHESTRATOR_HOOK = path.join(HOOKS_DIR, 'session-start-orchestrator');
  const CHARTER_FILE = path.resolve(__dirname, '..', 'scripts', 'hooks', 'orchestrator-charter.md');

  let tmpDir: string;   // has a .git dir
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-test-'));
    fs.mkdirSync(path.join(tmpDir, '.git'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-home-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  /** Copy the hook + all sourced dependencies to destDir so tests can manipulate the charter. */
  function copyHookDepsToDir(destDir: string): void {
    const deps = ['hook-bootstrap', 'debug-trace', 'json-parse', 'json-helper.cjs', 'git-marker', 'session-start-orchestrator'];
    for (const f of deps) {
      const src = path.join(HOOKS_DIR, f);
      const dest = path.join(destDir, f);
      fs.cpSync(src, dest);
      try { fs.chmodSync(dest, fs.statSync(src).mode); } catch { /* ignore */ }
    }
  }

  it('AC-C1: SessionStart envelope — correct schema', () => {
    const { stdout } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir);
    expect(stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso.hookEventName).toBe('SessionStart');
    expect(typeof hso.additionalContext).toBe('string');
    expect(Object.keys(hso).sort()).toEqual(['additionalContext', 'hookEventName'].sort());
  });

  it('AC-F1: additionalContext contains ORCHESTRATOR CHARTER', () => {
    const { stdout } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(parsed.hookSpecificOutput.additionalContext).toContain('ORCHESTRATOR CHARTER');
  });

  it('AC-F1: additionalContext contains plan-handoff prefix and devflow:implement', () => {
    const { stdout } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain('Implement the following plan:');
    expect(ctx).toContain('devflow:implement');
  });

  it('AC-F1: additionalContext contains model-tier names (haiku, sonnet, opus)', () => {
    const { stdout } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain('haiku');
    expect(ctx).toContain('sonnet');
    expect(ctx).toContain('opus');
  });

  it('AC-F9: DEVFLOW_BG_UPDATER=1 → empty stdout (no injection into nested bg sessions)', () => {
    const { stdout, exitCode } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(stdout).toBe('');
    expect(exitCode).toBe(0);
  });

  it('AC-F6: non-git CWD → empty stdout', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-nogit-'));
    try {
      const { stdout, exitCode } = runHook(ORCHESTRATOR_HOOK, { cwd: nonGitDir }, homeDir);
      expect(stdout).toBe('');
      expect(exitCode).toBe(0);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('AC-C4: bad CWD → empty stdout', () => {
    const { stdout, exitCode } = runHook(ORCHESTRATOR_HOOK, { cwd: '/nonexistent/path/devflow-orch' }, homeDir);
    expect(stdout).toBe('');
    expect(exitCode).toBe(0);
  });

  it('AC-F10: charter missing → empty stdout, exit 0 (fail-open)', () => {
    const hooksTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-nocharter-'));
    try {
      copyHookDepsToDir(hooksTemp);
      // orchestrator-charter.md intentionally NOT copied
      const { stdout, exitCode } = runHook(path.join(hooksTemp, 'session-start-orchestrator'), { cwd: tmpDir }, homeDir);
      expect(stdout).toBe('');
      expect(exitCode).toBe(0);
    } finally {
      fs.rmSync(hooksTemp, { recursive: true, force: true });
    }
  });

  it('AC-F10: oversize charter (>4096 chars) → empty stdout, exit 0 (fail-open)', () => {
    const hooksTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-bigcharter-'));
    try {
      copyHookDepsToDir(hooksTemp);
      fs.writeFileSync(path.join(hooksTemp, 'orchestrator-charter.md'), 'x'.repeat(4097));
      const { stdout, exitCode } = runHook(path.join(hooksTemp, 'session-start-orchestrator'), { cwd: tmpDir }, homeDir);
      expect(stdout).toBe('');
      expect(exitCode).toBe(0);
    } finally {
      fs.rmSync(hooksTemp, { recursive: true, force: true });
    }
  });

  it('AC-P3: repo charter asset exists, is non-empty, and is <4096 chars', () => {
    expect(fs.existsSync(CHARTER_FILE)).toBe(true);
    const content = fs.readFileSync(CHARTER_FILE, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    expect(content.length).toBeLessThan(4096);
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

function runHook(
  hookPath: string,
  input: object,
  homeDir: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`bash "${hookPath}"`, {
      input: JSON.stringify(input),
      env: { ...process.env, HOME: homeDir, ...extraEnv },
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

// =============================================================================
// session-start-context Section 2: Dream maintenance directive
// =============================================================================
//
// When the dream queue holds captured turns (or a crashed run left a stale
// .processing batch), session-start-context emits a "--- DREAM MAINTENANCE ---"
// directive instructing the main model to spawn the background Dream agent with
// the resolved model (project decisions.json → global ~/.devflow/decisions.json
// → opus). A FRESH .processing (younger than 900s) means a live agent already
// owns the batch, so the directive is suppressed. Gate is config-only: the
// `decisions` field in dream config.

describe('session-start-context: dream maintenance directive (Section 2)', () => {
  const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-dream-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-dream-home-'));
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const queuePath = (dir: string) => path.join(dir, '.devflow', 'dream', '.pending-turns.jsonl');
  const processingPath = (dir: string) => path.join(dir, '.devflow', 'dream', '.pending-turns.processing');

  function seedQueue(dir: string): void {
    fs.writeFileSync(queuePath(dir), '{"role":"user","content":"we chose X over Y","ts":1}\n');
  }

  function contextOf(stdout: string): string {
    return JSON.parse(stdout).hookSpecificOutput.additionalContext;
  }

  it('emits the directive when the queue is non-empty: Dream agent, background, default opus', () => {
    seedQueue(tmpDir);

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);

    const ctx = contextOf(stdout);
    expect(ctx).toContain('--- DREAM MAINTENANCE ---');
    expect(ctx).toContain('subagent_type="Dream"');
    expect(ctx).toContain('model="opus"');
    expect(ctx).toContain('run_in_background: true');
    expect(ctx).toContain('Do not narrate');
    // The prompt names the project root the agent must operate from
    // (non-git tmp dir → df_resolve_root falls back to the cwd as given).
    expect(ctx).toContain(`Project root: ${tmpDir}`);
    // The directive never spawns anything itself — the queue is untouched.
    expect(fs.existsSync(queuePath(tmpDir))).toBe(true);
  });

  it('no directive when the queue is empty or absent', () => {
    // Zero-byte queue file (the -s test) + a TL;DR so there is JSON output to inspect.
    fs.writeFileSync(queuePath(tmpDir), '');
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'decisions', 'decisions.md'),
      '<!-- TL;DR: 1 decision. Key: ADR-001 Test -->\n# Architectural Decisions',
    );

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);
    expect(contextOf(stdout)).not.toContain('DREAM MAINTENANCE');
  });

  it('decisions:false in dream config suppresses the directive (and the TL;DR)', () => {
    seedQueue(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'dream', 'config.json'),
      JSON.stringify({ decisions: false }),
    );
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'decisions', 'decisions.md'),
      '<!-- TL;DR: 1 decision. Key: ADR-001 Test -->\n# Architectural Decisions',
    );

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('DEVFLOW_BG_UPDATER=1 -> empty stdout even with a pending queue (guard precedes everything)', () => {
    seedQueue(tmpDir);

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(fs.existsSync(queuePath(tmpDir))).toBe(true);
  });

  it('fresh .processing suppresses the directive even when new turns queued since the claim', () => {
    seedQueue(tmpDir);
    fs.writeFileSync(processingPath(tmpDir), '{"role":"user","content":"claimed","ts":1}\n');

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);
    expect(stdout.trim() === '' || !contextOf(stdout).includes('DREAM MAINTENANCE')).toBe(true);
  });

  it('stale .processing (older than 900s) emits the directive even with an empty queue', () => {
    fs.writeFileSync(processingPath(tmpDir), '{"role":"user","content":"orphaned","ts":1}\n');
    const past = new Date(Date.now() - 1000 * 1000); // ~16.7 min ago, past the 900s threshold
    fs.utimesSync(processingPath(tmpDir), past, past);

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);
    const ctx = contextOf(stdout);
    expect(ctx).toContain('--- DREAM MAINTENANCE ---');
    expect(ctx).toContain('subagent_type="Dream"');
  });

  it('model resolution: project decisions.json wins', () => {
    seedQueue(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'decisions', 'decisions.json'),
      JSON.stringify({ model: 'haiku', debug: false }),
    );
    // Global config present too — project must win.
    fs.writeFileSync(path.join(homeDir, '.devflow', 'decisions.json'), JSON.stringify({ model: 'sonnet' }));

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(contextOf(stdout)).toContain('model="haiku"');
  });

  it('model resolution: global ~/.devflow/decisions.json used when the project sets none', () => {
    seedQueue(tmpDir);
    fs.writeFileSync(path.join(homeDir, '.devflow', 'decisions.json'), JSON.stringify({ model: 'sonnet' }));

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(contextOf(stdout)).toContain('model="sonnet"');
  });

  it('model resolution: an invalid/unallowlisted model value falls back to opus (defense in depth)', () => {
    seedQueue(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'decisions', 'decisions.json'),
      JSON.stringify({ model: 'gpt-5\ninjected", "evil": "payload' }),
    );

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    const ctx = contextOf(stdout);
    expect(ctx).toContain('model="opus"');
    expect(ctx).not.toContain('injected');
    expect(ctx).not.toContain('evil');
  });
});

