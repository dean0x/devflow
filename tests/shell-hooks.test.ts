import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { execSync, spawnSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { HANDOFF_TEMPLATE, REMINDER_TEMPLATE } from './fixtures/ambient-templates.js';
import { buildRoutingConfigJson } from '../src/core/proxy-state.js';
import {
  DEVFLOW_GITIGNORE_BLOCK,
  DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE,
  computeDevflowGitignore,
} from '../src/targets/claude-code/post-install.js';
import { HOOKS_DIR, execHook, runHook } from './shell-hooks-helpers.js';

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
  'is-hex-sha',
  'ensure-devflow-init',
  'ensure-root-gitignore',
  'resolve-project-root',
  'queue-append',
  'learning-lock',
  'capture-prompt',
  'capture-turn',
  'capture-question',
  'memory-worker',
  'ensure-proxy',
  'background-memory-update',
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

  const SLURP_INPUT = [
    JSON.stringify({ id: 'a', confidence: 0.3 }),
    JSON.stringify({ id: 'b', confidence: 0.9 }),
    'not json',
    JSON.stringify({ id: 'c', confidence: 0.5 }),
  ].join('\n');

  it('slurp-sort reads JSONL on stdin, sorts by the field, and limits', () => {
    const run = spawnSync(process.execPath, [JSON_HELPER, 'slurp-sort', 'confidence', '2'], { input: SLURP_INPUT, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).map((row: { id: string }) => row.id)).toEqual(['b', 'c']);
  });

  it('slurp-cap reads JSONL on stdin and prints the top rows one per line', () => {
    const run = spawnSync(process.execPath, [JSON_HELPER, 'slurp-cap', 'confidence', '2'], { input: SLURP_INPUT, encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split('\n').map(line => JSON.parse(line).id)).toEqual(['b', 'c']);
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

  it('a generic op loads none of the learning modules; a learning op loads the store, and the renderer only to render', () => {
    // Every hook that falls back from jq to node runs a generic op, so the learning
    // store loads only for a learning op, and the renderer and formatter only when
    // that op renders.
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-helper-lazy-'));
    try {
      const record = path.join(probeDir, 'loaded.txt');
      const preload = path.join(probeDir, 'record-loaded.cjs');
      fs.writeFileSync(preload, [
        "'use strict';",
        "const fs = require('fs');",
        `process.on('exit', () => fs.writeFileSync(${JSON.stringify(record)}, Object.keys(require.cache).join('\\n')));`,
        '',
      ].join('\n'));
      const learningModulesLoadedBy = (args: readonly string[], input: string): string[] => {
        const run = spawnSync(process.execPath, ['--require', preload, JSON_HELPER, ...args], {
          cwd: probeDir,
          input,
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(run.status, run.stderr).toBe(0);
        return fs.readFileSync(record, 'utf8').split('\n')
          .map(file => path.basename(file))
          .filter(name => /^(?:learning-store|render-decisions|decisions-format|mkdir-lock|project-paths)\.cjs$/.test(name))
          .sort();
      };

      expect(learningModulesLoadedBy(['get-field', 'cwd'], '{"cwd":"/tmp"}')).toEqual([]);
      // claim-queue answers none outside a learning tree, so it exits 0 here, and renders nothing.
      expect(learningModulesLoadedBy(['claim-queue'], '')).toEqual(['learning-store.cjs', 'mkdir-lock.cjs', 'project-paths.cjs']);
      // restore-anchor renders the entry it restores.
      const learningDir = path.join(probeDir, '.devflow', 'learning');
      fs.mkdirSync(learningDir, { recursive: true });
      fs.writeFileSync(
        path.join(learningDir, 'decisions-ledger.jsonl'),
        `${JSON.stringify({ id: 'obs_lazy_one', type: 'decision', anchor_id: 'ADR-001', decisions_status: 'Retired' })}\n`,
      );
      expect(learningModulesLoadedBy(['restore-anchor', 'ADR-001'], '')).toEqual([
        'decisions-format.cjs', 'learning-store.cjs', 'mkdir-lock.cjs', 'project-paths.cjs', 'render-decisions.cjs',
      ]);
    } finally {
      fs.rmSync(probeDir, { recursive: true, force: true });
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

  it('json_field_file reads a field from a file through the node fallback, a boolean false included', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-field-file-'));
    try {
      const file = path.join(dir, 'state.json');
      fs.writeFileSync(file, JSON.stringify({ enabled: false, port: 4141, nested: { model: 'opus' } }));
      const read = (field: string, fallback: string): string => {
        const run = spawnSync('bash', [
          '-c', 'source "$1" && _HAS_JQ=false && json_field_file "$2" "$3" "$4"',
          '_', path.join(HOOKS_DIR, 'json-parse'), file, field, fallback,
        ], { encoding: 'utf8' });
        expect(run.status, run.stderr).toBe(0);
        return run.stdout.trim();
      };

      expect(read('enabled', 'true')).toBe('false');
      expect(read('port', '0')).toBe('4141');
      expect(read('nested.model', '')).toBe('opus');
      expect(read('missing', 'fallback')).toBe('fallback');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
    // capture-turn sources hook-log-init, whose devflow_log_dir does an
    // unconditional `mkdir -p "$HOME/.devflow/logs/<slug>"` — one directory per
    // distinct cwd, so an inherited HOME accumulates them on the developer's real
    // machine forever. Seeded, never empty, so a green run is not vacuous.
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-anchor-home-'));
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
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
      execSync(`bash "${STOP_HOOK}"`, {
        input,
        env: { ...process.env, HOME: homeDir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Queue written at the REAL repo root .devflow/memory/ ...
      const rootQueue = path.join(real, '.devflow', 'memory', '.pending-turns.jsonl');
      expect(fs.existsSync(rootQueue)).toBe(true);
      const entry = JSON.parse(fs.readFileSync(rootQueue, 'utf-8').trim().split('\n').filter(Boolean)[0]);
      expect(entry.role).toBe('assistant');

      // ... and NO stray nested .devflow/ was scaffolded under the nested cwd.
      expect(fs.existsSync(path.join(nestedCwd, '.devflow'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// #390 — git-only scaffolding, the worktree ledger at main, detached HEAD
// =============================================================================

/** A repository with one commit, so worktrees and detached checkouts are possible. */
function initCommittedRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -q', { cwd: dir, stdio: 'pipe' });
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir, stdio: 'pipe' });
}

/**
 * Named collector: every path under `root`, relative and sorted, with `.git`
 * internals and any `exclude` prefix dropped. The listing IS the assertion for
 * "wrote nothing", so it walks the whole tree rather than probing known names.
 */
function collectTree(root: string, exclude: readonly string[] = []): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (relPath === '.git' || relPath.startsWith('.git/')) continue;
      if (exclude.some(p => relPath === p || relPath.startsWith(`${p}/`))) continue;
      out.push(entry.isDirectory() ? `${relPath}/` : relPath);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(dir, entry.name), relPath);
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * The #390 cases below each spawn a real `git init`/`git worktree add` plus several
 * hooks; under a loaded machine that sequence outruns vitest's 5 s default. The
 * budget is per-spawn arithmetic, not a guess: ≤10 spawns at ≤3 s each.
 */
const GIT_FIXTURE_TIMEOUT_MS = 30_000;

describe('D-HOOKS-GIT-ONLY: no project scaffolding outside a git project or at HOME (TP-16, TP-50)', { timeout: GIT_FIXTURE_TIMEOUT_MS }, () => {
  /** SessionStart and UserPromptSubmit, every hook installed on either event. */
  const HOOKS = [
    'session-start-context',
    'session-start-memory',
    'session-start-orchestrator',
    'preamble',
    'capture-prompt',
  ] as const;

  let base: string;
  let homeDir: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-gitonly-'));
    homeDir = path.join(base, 'home');
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  function runSessionAndPrompt(cwd: string, home: string): void {
    for (const hook of HOOKS) {
      const { exitCode } = runHook(
        path.join(HOOKS_DIR, hook),
        { cwd, prompt: 'we chose X over Y', source: 'startup', session_id: 'gitonly' },
        home,
      );
      expect(exitCode, `${hook} exit status`).toBe(0);
    }
  }

  it('a non-git directory is left exactly as it was', () => {
    const nonGit = path.join(base, 'downloads');
    fs.mkdirSync(nonGit);
    fs.writeFileSync(path.join(nonGit, 'notes.txt'), 'x');
    const before = collectTree(nonGit);

    runSessionAndPrompt(nonGit, homeDir);

    expect(collectTree(nonGit)).toEqual(before);
  });

  it('a repository rooted at HOME (a dotfiles repo) gets no project .devflow data and no .gitignore', () => {
    const dotfiles = path.join(base, 'dotfiles');
    initCommittedRepo(dotfiles);
    // Its .devflow IS the machine root; logs are machine data and are excluded.
    fs.mkdirSync(path.join(dotfiles, '.devflow', 'logs'), { recursive: true });
    const before = collectTree(dotfiles, ['.devflow/logs']);

    runSessionAndPrompt(dotfiles, dotfiles);

    expect(collectTree(dotfiles, ['.devflow/logs'])).toEqual(before);
    expect(fs.existsSync(path.join(dotfiles, '.gitignore'))).toBe(false);
  });

  it('TP-50: HOME reached through a symlink is compared by realpath, in both directions', () => {
    const realHome = path.join(base, 'real-home');
    initCommittedRepo(realHome);
    fs.mkdirSync(path.join(realHome, '.devflow', 'logs'), { recursive: true });
    const linkHome = path.join(base, 'link-home');
    fs.symlinkSync(realHome, linkHome);
    const before = collectTree(realHome, ['.devflow/logs']);

    // HOME is the link, the session starts in the real directory …
    runSessionAndPrompt(realHome, linkHome);
    // … and HOME is real while the session starts through the link.
    runSessionAndPrompt(linkHome, realHome);

    expect(collectTree(realHome, ['.devflow/logs'])).toEqual(before);
  });

  it('TP-50: a repo under the macOS /var → /private/var temp tree still matches its HOME', () => {
    // git reports every toplevel physically (/private/var/...) while HOME keeps the
    // spelling it was handed (/var/...). On Linux the temp tree has no such link,
    // and the explicit symlink case above carries the property there.
    const tmpHome = path.join(base, 'tmp-home');
    initCommittedRepo(tmpHome);
    fs.mkdirSync(path.join(tmpHome, '.devflow', 'logs'), { recursive: true });
    if (process.platform === 'darwin') {
      expect(fs.realpathSync(tmpHome), 'the fixture must exercise the /var link').not.toBe(tmpHome);
    }
    const before = collectTree(tmpHome, ['.devflow/logs']);

    runSessionAndPrompt(tmpHome, tmpHome);

    expect(collectTree(tmpHome, ['.devflow/logs'])).toEqual(before);
  });

  it('non-vacuity: the same hooks in a git project below HOME do scaffold', () => {
    const project = path.join(base, 'project');
    initCommittedRepo(project);

    runSessionAndPrompt(project, homeDir);

    expect(fs.existsSync(path.join(project, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.devflow', 'learning', '.pending-turns.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(true);
  });
});

describe('D-LEDGER-MAIN-WORKTREE: one ledger per repository (TP-17, TP-18, TP-19)', { timeout: GIT_FIXTURE_TIMEOUT_MS }, () => {
  const RESOLVE = path.join(HOOKS_DIR, 'resolve-project-root');
  const REAL_GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/bin/git']
    .find(p => fs.existsSync(p)) ?? 'git';

  let base: string;
  let homeDir: string;
  let main: string;
  let wt: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ledger-'));
    homeDir = path.join(base, 'home');
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
    main = path.join(base, 'main');
    initCommittedRepo(main);
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    main = fs.realpathSync(main);
    wt = fs.realpathSync(wt);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const queueOf = (root: string) => path.join(root, '.devflow', 'learning', '.pending-turns.jsonl');
  const rowsOf = (file: string): string[] =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];

  /** Source resolve-project-root and print both roots for `cwd`. */
  function resolveRoots(cwd: string, env: NodeJS.ProcessEnv = process.env): { root: string; ledger: string } {
    const out = spawnSync('bash', ['-c', 'source "$1"; df_resolve_roots "$2"; printf "%s\\n%s\\n" "$DF_ROOT" "$DF_LEDGER_ROOT"', '_', RESOLVE, cwd], { env, encoding: 'utf-8' });
    const [root = '', ledger = ''] = out.stdout.split('\n');
    return { root, ledger };
  }

  it('TP-17: capture in the worktree appends to the main queue; memory stays in the worktree', () => {
    fs.mkdirSync(path.join(main, '.devflow', 'learning'), { recursive: true });

    const { exitCode } = runHook(path.join(HOOKS_DIR, 'capture-prompt'), { cwd: wt, prompt: 'we chose X over Y' }, homeDir);
    expect(exitCode).toBe(0);

    expect(rowsOf(queueOf(main))).toHaveLength(1);
    expect(rowsOf(queueOf(wt)), 'the worktree must not start a ledger queue of its own').toHaveLength(0);
    expect(rowsOf(path.join(wt, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(1);
    expect(fs.existsSync(path.join(main, '.devflow', 'memory')), 'memory is per checkout').toBe(false);
    // ensure-devflow-init scaffolds per-checkout data only: a learning/ in the
    // worktree would be an empty directory nothing ever writes to.
    expect(fs.existsSync(path.join(wt, '.devflow', 'learning')), 'no dead ledger dir in the worktree').toBe(false);
    expect(fs.existsSync(path.join(wt, '.devflow', 'features'))).toBe(true);
  });

  it('a repository rooted at HOME never lends its main ledger to a linked worktree — that .devflow is the machine root', () => {
    // A dotfiles repo at HOME always has `<main>/.devflow` (the machine root), so the
    // existence test alone would anchor the worktree's ledger inside ~/.devflow.
    // HOME is left unresolved (/var/… on macOS) while git reports /private/var/…:
    // the refusal must compare physical paths.
    const dotHome = path.join(base, 'dothome');
    initCommittedRepo(dotHome);
    fs.mkdirSync(path.join(dotHome, '.devflow', 'logs'), { recursive: true });
    const dotWt = path.join(base, 'dotwt');
    execSync(`git worktree add -q "${dotWt}" -b dots`, { cwd: dotHome, stdio: 'pipe' });
    const dotWtReal = fs.realpathSync(dotWt);

    expect(resolveRoots(dotWt, { ...process.env, HOME: dotHome })).toEqual({ root: dotWtReal, ledger: dotWtReal });

    runHook(path.join(HOOKS_DIR, 'capture-prompt'), { cwd: dotWt, prompt: 'we chose X over Y' }, dotHome);
    expect(fs.existsSync(path.join(dotHome, '.devflow', 'learning')), 'nothing lands in the machine root').toBe(false);
    expect(rowsOf(queueOf(dotWtReal))).toHaveLength(1);

    const { stdout } = runHook(path.join(HOOKS_DIR, 'session-start-context'), { cwd: dotWt, source: 'startup' }, dotHome);
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain(`Project root: ${dotWtReal}")`);
  });

  it('a non-git directory costs one git call, not a second one that must fail the same way', () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-roots-nongit-'));
    const shim = fs.mkdtempSync(path.join(base, 'git-shim-'));
    const log = path.join(shim, 'git.log');
    fs.writeFileSync(path.join(shim, 'git'), `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`);
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const env = { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` };
    try {
      expect(resolveRoots(nonGit, env)).toEqual({ root: nonGit, ledger: nonGit });
      const nested = path.join(nonGit, '.devflow', 'docs');
      fs.mkdirSync(nested, { recursive: true });
      expect(resolveRoots(nested, env), 'the .devflow-nesting fallback still applies')
        .toEqual({ root: nonGit, ledger: nonGit });
      expect(rowsOf(log)).toHaveLength(2);
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it('TP-17: the directive and the TL;DR in the worktree come from the main ledger', () => {
    fs.mkdirSync(path.join(main, '.devflow', 'learning'), { recursive: true });
    fs.writeFileSync(path.join(main, '.devflow', 'learning', 'decisions.md'), '<!-- TL;DR: 3 decisions. Key: ADR-003 Main -->\n# Decisions\n');
    fs.writeFileSync(queueOf(main), '{"role":"user","content":"we chose X over Y","ts":1}\n');

    const { stdout } = runHook(path.join(HOOKS_DIR, 'session-start-context'), { cwd: wt, source: 'startup' }, homeDir);
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext as string;

    expect(ctx).toContain('--- LEARNING MAINTENANCE ---');
    expect(ctx).toContain(`Project root: ${main}")`);
    expect(ctx).not.toContain(`Project root: ${wt}`);
    expect(ctx).toContain('ADR-003 Main');
  });

  // Section 1 names the decisions index so the main model can pass it on as
  // DECISIONS_CONTEXT. The path is the ledger's — the main checkout's in a linked
  // worktree — so it is named only when the ledger root passed the shape gate.
  const SESSION_CONTEXT = path.join(HOOKS_DIR, 'session-start-context');
  const learningOf = (root: string) => path.join(root, '.devflow', 'learning');
  const indexOf = (root: string) => path.join(learningOf(root), 'index.md');

  /** The PROJECT DECISIONS section of the injected context, up to the blank line that ends it. */
  function decisionsSection(cwd: string): string {
    const { stdout, exitCode } = runHook(SESSION_CONTEXT, { cwd, source: 'startup' }, homeDir);
    expect(exitCode).toBe(0);
    if (stdout.trim() === '') return '';
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
    const at = ctx.indexOf('--- PROJECT DECISIONS (TL;DR) ---');
    if (at === -1) return '';
    const end = ctx.indexOf('\n\n', at);
    return end === -1 ? ctx.slice(at) : ctx.slice(at, end);
  }

  /** A rendered ledger at `root`: both TL;DR headers, and the index when given. */
  function seedRendered(root: string, index?: string): void {
    fs.mkdirSync(learningOf(root), { recursive: true });
    fs.writeFileSync(path.join(learningOf(root), 'decisions.md'), '<!-- TL;DR: 3 decisions -->\n# Architectural Decisions\n');
    fs.writeFileSync(path.join(learningOf(root), 'pitfalls.md'), '<!-- TL;DR: 2 pitfalls -->\n# Known Pitfalls\n');
    if (index !== undefined) fs.writeFileSync(indexOf(root), index);
  }

  it('TP-17: in a linked worktree, PROJECT DECISIONS names the main checkout index, last', () => {
    seedRendered(main, 'Decisions (1):\n  ADR-001  Main decision  [Accepted]\n');

    expect(decisionsSection(wt)).toBe(
      `--- PROJECT DECISIONS (TL;DR) ---\n3 decisions\n2 pitfalls\nIndex: ${indexOf(main)}`,
    );
  });

  it('PROJECT DECISIONS carries the index line alone when no TL;DR is rendered', () => {
    fs.mkdirSync(learningOf(main), { recursive: true });
    fs.writeFileSync(indexOf(main), 'Pitfalls (1):\n  PF-001  Main pitfall  [Active]\n');

    expect(decisionsSection(wt)).toBe(`--- PROJECT DECISIONS (TL;DR) ---\nIndex: ${indexOf(main)}`);
  });

  it('no index line when the index is missing', () => {
    seedRendered(main);

    expect(decisionsSection(wt)).toBe('--- PROJECT DECISIONS (TL;DR) ---\n3 decisions\n2 pitfalls');
  });

  it('no index line when the index lists no entry — (none) — or is empty', () => {
    seedRendered(main, '(none)\n');
    expect(decisionsSection(wt)).toBe('--- PROJECT DECISIONS (TL;DR) ---\n3 decisions\n2 pitfalls');

    fs.writeFileSync(indexOf(main), '');
    expect(decisionsSection(wt)).toBe('--- PROJECT DECISIONS (TL;DR) ---\n3 decisions\n2 pitfalls');

    // With no TL;DR either, there is no section at all.
    fs.rmSync(path.join(learningOf(main), 'decisions.md'));
    fs.rmSync(path.join(learningOf(main), 'pitfalls.md'));
    fs.writeFileSync(indexOf(main), '(none)\n');
    expect(decisionsSection(wt)).toBe('');
  });

  it('no index line, and no path, when the ledger root fails the shape gate', () => {
    const refused = path.join(base, 'proj name');
    initCommittedRepo(refused);
    seedRendered(refused, 'Decisions (1):\n  ADR-001  Refused decision  [Accepted]\n');

    // The TL;DR interpolates no path, so it stays; the index line would, so it goes.
    expect(decisionsSection(refused)).toBe('--- PROJECT DECISIONS (TL;DR) ---\n3 decisions\n2 pitfalls');
    // Non-vacuity: the same tree at an admitted path does name its index.
    const admitted = path.join(base, 'proj-name');
    initCommittedRepo(admitted);
    seedRendered(admitted, 'Decisions (1):\n  ADR-001  Admitted decision  [Accepted]\n');
    expect(decisionsSection(admitted)).toContain(`Index: ${fs.realpathSync(indexOf(admitted))}`);
  });

  it('the orchestrator charter passes the index this section names on as DECISIONS_CONTEXT', () => {
    const charter = fs.readFileSync(path.join(HOOKS_DIR, 'assets', 'orchestrator-charter.md'), 'utf-8');
    const hook = fs.readFileSync(SESSION_CONTEXT, 'utf-8');
    expect(hook).toContain('--- PROJECT DECISIONS (TL;DR) ---');
    expect(hook).toContain('DECISIONS_INDEX_LINE="Index: $_SC_INDEX"');
    expect(charter).toContain('pass the index named under PROJECT DECISIONS as DECISIONS_CONTEXT');
  });

  it('a main checkout that never ran devflow keeps the ledger in the worktree, and is not scaffolded', () => {
    const { exitCode } = runHook(path.join(HOOKS_DIR, 'capture-prompt'), { cwd: wt, prompt: 'we chose X over Y' }, homeDir);
    expect(exitCode).toBe(0);

    expect(rowsOf(queueOf(wt))).toHaveLength(1);
    expect(fs.existsSync(path.join(main, '.devflow'))).toBe(false);
  });

  it('TP-18: exactly one rev-parse per resolution, in the root, a subdirectory and the worktree', () => {
    fs.mkdirSync(path.join(main, '.devflow'), { recursive: true });
    const sub = path.join(main, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    const shim = fs.mkdtempSync(path.join(base, 'git-shim-'));
    const log = path.join(shim, 'git.log');
    fs.writeFileSync(path.join(shim, 'git'), `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`);
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const env = { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` };

    const cases: ReadonlyArray<readonly [string, string, string, string]> = [
      ['root', main, main, main],
      ['subdir', sub, main, main],
      ['worktree', wt, wt, main],
    ];
    for (const [label, cwd, root, ledger] of cases) {
      if (fs.existsSync(log)) fs.rmSync(log);
      expect(resolveRoots(cwd, env), label).toEqual({ root, ledger });
      const calls = rowsOf(log);
      expect(calls, `${label}: git calls`).toHaveLength(1);
      expect(calls[0]).toContain('rev-parse --path-format=absolute --show-toplevel --git-common-dir');
    }
  });

  it('TP-19: a pre-2.31 git that echoes the flag falls back to the toplevel for BOTH roots', () => {
    fs.mkdirSync(path.join(main, '.devflow'), { recursive: true });
    const shim = fs.mkdtempSync(path.join(base, 'old-git-'));
    // Old git prints an unknown `--path-format=...` back as a line of its own, then
    // the answers — three lines, the first not absolute, the last relative.
    fs.writeFileSync(path.join(shim, 'git'), [
      '#!/bin/bash',
      'case "$*" in',
      `  *--path-format=absolute*) printf '%s\\n' '--path-format=absolute' ${JSON.stringify(wt)} '.git' ;;`,
      `  *--show-toplevel*) printf '%s\\n' ${JSON.stringify(wt)} ;;`,
      '  *) exit 1 ;;',
      'esac',
    ].join('\n') + '\n');
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const env = { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` };

    expect(resolveRoots(wt, env)).toEqual({ root: wt, ledger: wt });
  });

  it('TP-19: empty and single-line git output fall back the same way', () => {
    for (const body of ['exit 128', `printf '%s\\n' ${JSON.stringify(wt)}`]) {
      const shim = fs.mkdtempSync(path.join(base, 'odd-git-'));
      fs.writeFileSync(path.join(shim, 'git'), [
        '#!/bin/bash',
        'case "$*" in',
        `  *--path-format=absolute*) ${body} ;;`,
        `  *--show-toplevel*) printf '%s\\n' ${JSON.stringify(wt)} ;;`,
        'esac',
      ].join('\n') + '\n');
      fs.chmodSync(path.join(shim, 'git'), 0o755);
      const env = { ...process.env, PATH: `${shim}:${process.env.PATH ?? ''}` };
      expect(resolveRoots(wt, env), body).toEqual({ root: wt, ledger: wt });
    }
  });
});

describe('D-DETACHED-HEAD: memory on a detached HEAD (TP-53, TP-54)', { timeout: GIT_FIXTURE_TIMEOUT_MS }, () => {
  const PRE_COMPACT = path.join(HOOKS_DIR, 'pre-compact-memory');
  const SESSION_MEMORY = path.join(HOOKS_DIR, 'session-start-memory');

  let base: string;
  let homeDir: string;
  let repo: string;
  let sha: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-detached-'));
    homeDir = path.join(base, 'home');
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
    repo = path.join(base, 'repo');
    initCommittedRepo(repo);
    sha = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf-8' }).trim();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const memoryFile = () => path.join(repo, '.devflow', 'memory', 'WORKING-MEMORY.md');

  function sessionContext(): string {
    const { stdout } = runHook(SESSION_MEMORY, { cwd: repo }, homeDir);
    return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
  }

  it('TP-53: a first compaction on a detached HEAD bootstraps memory stamped `(detached)`, keyed on the commit', () => {
    execSync('git checkout -q --detach', { cwd: repo });

    runHook(PRE_COMPACT, { cwd: repo }, homeDir);

    const lines = fs.readFileSync(memoryFile(), 'utf-8').split('\n');
    expect(lines[0]).toBe(`<!-- memory-head: ${sha} branch: (detached) -->`);
    expect(lines).toContain(`- Branch: (detached) @ ${sha.slice(0, 7)}`);
    const backup = JSON.parse(fs.readFileSync(path.join(repo, '.devflow', 'memory', 'backup.json'), 'utf-8'));
    expect(backup.git.branch, 'the backup names the state instead of leaving it blank').toBe('(detached)');
  });

  it('TP-53: an unborn branch still bootstraps nothing — there is no commit to key on', () => {
    const unborn = path.join(base, 'unborn');
    fs.mkdirSync(unborn);
    execSync('git init -q', { cwd: unborn });

    runHook(PRE_COMPACT, { cwd: unborn }, homeDir);

    expect(fs.existsSync(path.join(unborn, '.devflow', 'memory', 'WORKING-MEMORY.md'))).toBe(false);
  });

  it('TP-54: SessionStart on a detached HEAD labels the header `detached @ <short-sha>`', () => {
    fs.mkdirSync(path.dirname(memoryFile()), { recursive: true });
    fs.writeFileSync(memoryFile(), `<!-- memory-head: ${sha} branch: main -->\n## Now\n- x\n`);
    execSync('git checkout -q --detach', { cwd: repo });

    const ctx = sessionContext();

    expect(ctx).toContain(`synced @ ${sha} detached @ ${sha.slice(0, 7)},`);
    expect(ctx).not.toContain('on unknown');
  });

  it('TP-54: on a branch the header keeps `on <branch>`, and a detached stamp is named as a state', () => {
    const branch = execSync('git branch --show-current', { cwd: repo, encoding: 'utf-8' }).trim();
    fs.mkdirSync(path.dirname(memoryFile()), { recursive: true });
    fs.writeFileSync(memoryFile(), `<!-- memory-head: ${sha} branch: (detached) -->\n## Now\n- x\n`);

    const ctx = sessionContext();

    expect(ctx).toContain(`synced @ ${sha} on ${branch},`);
    expect(ctx).toContain(`Memory was written on a detached HEAD; you are now on ${branch}.`);
  });
});

describe('hook-log-init: first invocation for a fresh log dir', () => {
  const HOOK_LOG_INIT = path.join(HOOKS_DIR, 'hook-log-init');

  it('sources silently under set -e when the log file does not exist yet, and sizes it as 0', () => {
    // HOME is a mktemp dir: devflow_log_dir mkdirs $HOME/.devflow/logs/<slug>
    // unconditionally. Seeded, never empty, so a green run is not vacuous. CWD is
    // its own mktemp dir so its slug's log dir — and the log file — are brand new.
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-loginit-home-'));
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
    const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-loginit-cwd-'));
    try {
      // Sourced under `set -e` the way the capture hooks source it:
      // the caller must keep running past the size guard.
      const script = [
        'set -e',
        `SCRIPT_DIR="${HOOKS_DIR}"`,
        `CWD="${cwdDir}"`,
        `source "${HOOK_LOG_INIT}" "fresh-hook"`,
        'echo "size=$_LOG_SIZE"',
        '[ -f "$LOG_FILE" ] && echo "exists" || echo "absent"',
      ].join('\n');
      const result = spawnSync('bash', ['-c', script], {
        env: { ...process.env, HOME: homeDir },
        encoding: 'utf-8',
      });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('size=0\nabsent\n');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(cwdDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// preamble — orchestrator charter mode (Suites 1-4)
// =============================================================================

describe('preamble — orchestrator charter mode', () => {
  const PREAMBLE_HOOK = path.join(HOOKS_DIR, 'preamble');
  const PREAMBLE_SRC = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'preamble');

  let tmpDir: string;   // has a .git dir → git gate passes
  let noGitDir: string; // plain dir, no .git → git gate rejects

  // HANDOFF_TEMPLATE and REMINDER_TEMPLATE are imported from tests/fixtures/ambient-templates.ts
  // to keep this file and tests/integration/ambient-activation.test.ts in sync.

  beforeAll(() => {
    // Guard: verify that os.tmpdir() is not inside a git repository.
    // If it were, noGitDir (created in beforeEach) would have a .git ancestor and
    // the git gate would pass — making F6a/F6b assert empty output against a prompt
    // that actually goes through the full dispatch (producing reminder output instead).
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-gitguard-'));
    try {
      const result = execSync(
        `bash -c 'source "${path.join(HOOKS_DIR, 'git-marker')}"; df_has_git_marker "$PROBE" && printf YES || printf NO'`,
        { stdio: 'pipe', env: { ...process.env, PROBE: probe } },
      ).toString().trim();
      if (result === 'YES') {
        throw new Error(
          `os.tmpdir() (${os.tmpdir()}) has a .git ancestor — non-git preamble tests cannot run safely on this machine.`,
        );
      }
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
  });

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

    it('F2b: reminder names no model (no haiku/sonnet/opus)', () => {
      const out = runPreamble('fix the auth bug');
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).not.toMatch(/haiku|sonnet|opus/i);
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

    it('F12a: 300 leading spaces → HEAD collapses to empty after strip → silent exit [AC-F12]', () => {
      // HEAD = PROMPT[0:256] = 256 spaces.  After whitespace-strip, HEAD = "".
      // The empty-HEAD branch fires: exit 0, no output (same as F4f whitespace-only rule).
      const prompt = ' '.repeat(300) + 'Implement the following plan: add caching';
      const out = runPreamble(prompt);
      expect(out).toBe('');
    });

    it('F12b: non-space prefix pushed past byte 256 → reminder, not handoff directive [AC-F12]', () => {
      // HEAD = PROMPT[0:256] = 'a' × 256.  After strip, HEAD = 'a' × 256.
      // Does not match the handoff prefix → orchestrator reminder branch fires.
      const prompt = 'a'.repeat(260) + 'Implement the following plan: add caching';
      const out = runPreamble(prompt);
      expect(out.length).toBeGreaterThan(0);
      const parsed = JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe(REMINDER_TEMPLATE);
    });

    // --- Background-session re-entrancy guard ---

    it('F13: DEVFLOW_BG_UPDATER=1 → empty stdout (no injection into nested bg sessions) [AC-F9]', () => {
      // The background memory worker (claude -p) runs in the project git root and fires
      // UserPromptSubmit; the guard must suppress the orchestrator reminder there.
      // The guard exits before reading stdin: execHook, not execSync (D-STDIN-EPIPE).
      const input = JSON.stringify({ cwd: tmpDir, prompt: 'refresh working memory from these turns' });
      const out = execHook(PREAMBLE_HOOK, input, { env: { ...process.env, DEVFLOW_BG_UPDATER: '1' } });
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

    it('P1b: git-marker source is pure bash — no subprocess calls (no git command, awk, sed, tr, $())', () => {
      // git-marker is sourced on every UserPromptSubmit call; it must never spawn a
      // subprocess.  A reintroduced `git rev-parse` or similar would pass the preamble
      // P1 scan but this test would catch it in git-marker itself.
      // Note: `.git` appears as a path string literal ("$_dir/.git") which is fine —
      // we check for `git` as a command invocation (git followed by whitespace+word),
      // not as a path component.
      const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'git-marker'), 'utf-8');
      const codeLines = src
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

      // `git rev-parse`, `git status`, etc. — git used as a command (not `.git` path literal)
      expect(codeLines).not.toMatch(/\bgit\s+\w/);
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
// git-marker helper: df_has_git_marker behavioral tests
// =============================================================================
//
// git-marker is sourced on every UserPromptSubmit call via preamble.  Tests here
// exercise df_has_git_marker directly so a regression in the helper is caught
// without relying on end-to-end preamble invocations.
// =============================================================================

describe('git-marker helper: df_has_git_marker', () => {
  const GIT_MARKER_SRC = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'git-marker');

  /**
   * Source git-marker and run df_has_git_marker on the given directory.
   * Returns true (exit 0) when a .git marker is found, false (exit 1) when not.
   * The directory is passed via the DEVFLOW_GM_TEST_DIR env var to avoid
   * shell-quoting issues with special characters in tmpdir paths.
   */
  function hasGitMarker(dir: string): boolean {
    try {
      execSync(
        `bash -c 'source "${GIT_MARKER_SRC}"; df_has_git_marker "$DEVFLOW_GM_TEST_DIR"'`,
        { stdio: 'pipe', env: { ...process.env, DEVFLOW_GM_TEST_DIR: dir } },
      );
      return true; // exit 0 → found
    } catch {
      return false; // exit 1 → not found
    }
  }

  let repoDir: string; // has a .git dir

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-gm-test-'));
    fs.mkdirSync(path.join(repoDir, '.git'));
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns true for the repo root (contains .git directory)', () => {
    expect(hasGitMarker(repoDir)).toBe(true);
  });

  it('returns true for a nested subdirectory inside a git repo', () => {
    const subDir = path.join(repoDir, 'src', 'auth');
    fs.mkdirSync(subDir, { recursive: true });
    expect(hasGitMarker(subDir)).toBe(true);
  });

  it('returns true when .git is a plain file (worktree / submodule style)', () => {
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-gm-wt-'));
    try {
      fs.writeFileSync(path.join(worktreeDir, '.git'), 'gitdir: /some/path/.git');
      expect(hasGitMarker(worktreeDir)).toBe(true);
    } finally {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  });

  it('returns false for a plain directory with no .git ancestor', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-gm-nogit-'));
    try {
      expect(hasGitMarker(nonGitDir)).toBe(false);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('returns false for empty string (immediate termination via [ -z "$_dir" ] guard)', () => {
    expect(hasGitMarker('')).toBe(false);
  });

  it('returns false for "/" (terminates at [ "$_dir" = "/" ] guard with no .git at root)', () => {
    // Assumes the filesystem root is not a git repository.
    // If /.git exists on this machine, skip rather than fail.
    if (fs.existsSync('/.git')) return;
    expect(hasGitMarker('/')).toBe(false);
  });

  it('returns false and terminates within 64 iterations for a >64-level-deep non-existent path', () => {
    // The function walks at most 64 ancestor levels ([ "$_i" -lt 64 ] bound).
    // A non-existent path with 70+ levels has no .git anywhere in its non-existent
    // ancestry — the loop exhausts its budget and returns 1 without hanging.
    const deepPath = '/devflow-bound-test/' + 'x/'.repeat(70) + 'leaf';
    expect(hasGitMarker(deepPath)).toBe(false);
  });
});

// =============================================================================
// session-start-orchestrator: orchestrator charter injection
// =============================================================================

describe('session-start-orchestrator', () => {
  const ORCHESTRATOR_HOOK = path.join(HOOKS_DIR, 'session-start-orchestrator');
  const CHARTER_FILE = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md');

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

  it('AC-F1: additionalContext routes by roster agent and pins no model (no haiku/sonnet/opus)', () => {
    const { stdout } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = parsed.hookSpecificOutput.additionalContext;
    // Each agent's model/effort is user-configured; naming a model would steer the
    // orchestrator into overriding it on the Agent call.
    expect(ctx).not.toMatch(/haiku|sonnet|opus/i);
    for (const agent of ['Explore', 'Skim', 'Code', 'Validate', 'Git', 'Design', 'Research', 'Review', 'Triage']) {
      expect(ctx).toContain(agent);
    }
  });

  it('AC-F1: additionalContext carries no HTML comment (maintainer notes never reach users)', () => {
    const { stdout } = runHook(ORCHESTRATOR_HOOK, { cwd: tmpDir }, homeDir);
    const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain('<!--');
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

  it('AC-F10: oversize charter (>4096 chars, i.e. 4097) → empty stdout, exit 0 (fail-open)', () => {
    // The guard is `[ "${#CHARTER}" -gt 4096 ]` so 4097+ bytes are rejected.
    const hooksTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-bigcharter-'));
    try {
      copyHookDepsToDir(hooksTemp);
      fs.mkdirSync(path.join(hooksTemp, 'assets'));
      fs.writeFileSync(path.join(hooksTemp, 'assets', 'orchestrator-charter.md'), 'x'.repeat(4097));
      const { stdout, exitCode } = runHook(path.join(hooksTemp, 'session-start-orchestrator'), { cwd: tmpDir }, homeDir);
      expect(stdout).toBe('');
      expect(exitCode).toBe(0);
    } finally {
      fs.rmSync(hooksTemp, { recursive: true, force: true });
    }
  });

  it('AC-F10: charter at exact 4096-byte boundary → accepted, non-empty stdout', () => {
    // The guard is `[ "${#CHARTER}" -gt 4096 ]` (-gt, not -ge).
    // Exactly 4096 bytes passes the guard and is injected as additionalContext.
    const hooksTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-orch-exactcharter-'));
    try {
      copyHookDepsToDir(hooksTemp);
      fs.mkdirSync(path.join(hooksTemp, 'assets'));
      fs.writeFileSync(path.join(hooksTemp, 'assets', 'orchestrator-charter.md'), 'x'.repeat(4096));
      const { stdout, exitCode } = runHook(path.join(hooksTemp, 'session-start-orchestrator'), { cwd: tmpDir }, homeDir);
      expect(exitCode).toBe(0);
      expect(stdout.length).toBeGreaterThan(0);
      const parsed = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
      expect(parsed.hookSpecificOutput.additionalContext).toBe('x'.repeat(4096));
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
    // A `.git` marker: ensure-devflow-init scaffolds only inside a git project
    // (D-HOOKS-GIT-ONLY). An empty directory satisfies df_has_git_marker and is not a
    // repository to `git rev-parse`, so the root stays tmpDir itself.
    fs.mkdirSync(path.join(tmpDir, '.git'));
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
    // Wholesale .devflow/ replaced by the carve-out: everything local except feature knowledge + conventions
    expect(lines).toContain('.devflow/*');
    expect(lines).toContain('!.devflow/features/');
    expect(lines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(lines).toContain('!.devflow/conventions.md'); // v3 addition
    expect(lines).toContain('.claudeignore'); // v4 addition
    expect(lines).toContain('!.devflow/policy.json'); // v5 addition
    expect(lines).toContain('!.devflow/project.json'); // v6 addition
    expect(lines).not.toContain('.devflow/'); // no bare wholesale line
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v5'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'))).toBe(false);
    // No nested .devflow/.gitignore is written
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.gitignore'))).toBe(false);
  });

  it('a v4-marked project with every directory present is not fast-pathed: it gains the policy and project lines and is stamped v6', () => {
    // The whole installed base sits here: dirs scaffolded, v4 marker stamped, v4 block
    // written. If the fast path still keyed on -v4, this project would never be upgraded.
    for (const d of ['memory', 'docs', 'learning', 'features']) {
      fs.mkdirSync(path.join(tmpDir, '.devflow', d), { recursive: true });
    }
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'), '');
    const v4Block = [
      '.devflow/*',
      '!.devflow/features/',
      '.devflow/features/*',
      '!.devflow/features/index.md',
      '!.devflow/features/*/',
      '.devflow/features/*/*',
      '!.devflow/features/*/KNOWLEDGE.md',
      '!.devflow/conventions.md',
      '.claudeignore',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), v4Block);

    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    // Inserted inside the block, before its .claudeignore line (D-GITIGNORE-IN-BLOCK).
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')).toBe(v4Block.replace('!.devflow/conventions.md\n', '!.devflow/conventions.md\n!.devflow/policy.json\n!.devflow/project.json\n'));
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'))).toBe(false);
  });

  it('a v5-marked project with every directory present is not fast-pathed: it gains the project line and is stamped v6', () => {
    // D-GITIGNORE-V6: the installed base after #400 — dirs scaffolded, v5 marker, v5
    // block. If the fast path still keyed on -v5, project.json would stay ignored.
    for (const d of ['memory', 'docs', 'learning', 'features']) {
      fs.mkdirSync(path.join(tmpDir, '.devflow', d), { recursive: true });
    }
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v5'), '');
    const v5Block = [
      '.devflow/*',
      '!.devflow/features/',
      '.devflow/features/*',
      '!.devflow/features/index.md',
      '!.devflow/features/*/',
      '.devflow/features/*/*',
      '!.devflow/features/*/KNOWLEDGE.md',
      '!.devflow/conventions.md',
      '!.devflow/policy.json',
      '.claudeignore',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), v5Block);

    execSync(`bash -c 'source "${ENSURE_DEVFLOW}" "${tmpDir}"'`, { stdio: 'pipe' });

    // Just before its .claudeignore line, never at EOF (D-GITIGNORE-IN-BLOCK).
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')).toBe(v5Block.replace('!.devflow/policy.json\n.claudeignore\n', '!.devflow/policy.json\n!.devflow/project.json\n.claudeignore\n'));
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v5'))).toBe(false);
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
    // cwd is tmpDir, never the inherited repo: without the guard, `git -C ""` resolves
    // the working directory's repository, so a regression writes HERE — where the
    // assertion looks — instead of into the developer's checkout, where it would pass
    // unseen. tmpDir must be a repository for that resolution to land on it.
    execSync(`git init -q "${tmpDir}"`, { stdio: 'pipe' });
    const result = execSync(
      `bash -c 'source "${ENSURE_DEVFLOW}" ""; echo $?'`,
      { stdio: 'pipe', cwd: tmpDir },
    ).toString().trim();

    // return 1 from a sourced script propagates as the last exit status
    expect(result).toBe('1');
    // No .devflow/ directory should have been created in the test working directory
    expect(fs.existsSync(path.join(tmpDir, '.devflow'))).toBe(false);
  });

  it('fast-path gates on .root-gitignore-configured-v6 marker with no -v5/-v4/-v3 reference (P0-S13)', () => {
    // P0-S13 verify clause: the fast-path marker is bumped with each block format change,
    // in the same commit as both writers' stamps (D-GITIGNORE-V6).
    // RED: the #400 ensure-devflow-init references .root-gitignore-configured-v5, so
    //   the first two assertions below fail on that content — confirming -v6 is a
    //   genuine post-fix invariant, not a pre-existing truth.
    const hookContent = fs.readFileSync(ENSURE_DEVFLOW, 'utf-8');
    expect(hookContent, 'fast-path must reference .root-gitignore-configured-v6').toContain('.root-gitignore-configured-v6');
    expect(hookContent, 'fast-path must not reference -v5 marker').not.toContain('-v5');
    expect(hookContent, 'fast-path must not reference -v4 marker').not.toContain('-v4');
    expect(hookContent, 'fast-path must not reference -v3 marker').not.toContain('-v3');
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

  it('creates the root .gitignore (and .devflow/) when absent, writes the v6 marker', () => {
    // Standalone case (as session-start-context calls it): no .devflow/ exists yet.
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignore)).toBe(true);
    expect(ignoreLines(gitignore)).toContain('.devflow/*');
    expect(ignoreLines(gitignore)).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(ignoreLines(gitignore)).toContain('!.devflow/conventions.md'); // v3 addition
    expect(ignoreLines(gitignore)).toContain('.claudeignore'); // v4 addition
    expect(ignoreLines(gitignore)).toContain('!.devflow/policy.json'); // v5 addition
    expect(ignoreLines(gitignore)).toContain('!.devflow/project.json'); // v6 addition
    expect(ignoreLines(gitignore)).not.toContain('.devflow/'); // carve-out, not wholesale
    // The helper must create .devflow/ to host the marker even when called standalone
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
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

  it('v6 marker + sentinel + completion lines present: fast-path — .gitignore not re-written on second run', () => {
    // First run installs the carve-out, stamps the marker, and writes the sentinel.
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    const contentAfterFirst = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');

    // Second run: marker + sentinel both present → fast-path → .gitignore unchanged.
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')).toBe(contentAfterFirst);
  });

  // Every marker a v6 stamp retires. An older devflow can re-stamp one beside v6
  // (a second checkout, a downgrade), and the fast path must still drop it.
  const LEGACY_MARKERS = [
    '.root-gitignore-configured-v5',
    '.root-gitignore-configured-v4',
    '.root-gitignore-configured-v3',
    '.root-gitignore-configured-v2',
    '.root-gitignore-configured',
  ] as const;

  it('v6 fast path drops stale legacy markers (the unversioned one too) and leaves .gitignore unchanged', () => {
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    const converged = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    for (const marker of LEGACY_MARKERS) fs.writeFileSync(path.join(tmpDir, '.devflow', marker), '');

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')).toBe(converged);
    expect(LEGACY_MARKERS.filter(m => fs.existsSync(path.join(tmpDir, '.devflow', m)))).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
  });

  it('v6 fast path forks `rm` only for a legacy marker that exists (builtin `[ -e ]` tests)', () => {
    // An `rm` shim first on PATH logs every invocation, then does the real work.
    const shimBin = path.join(tmpDir, 'shim-bin');
    const rmLog = path.join(tmpDir, 'rm.log');
    fs.mkdirSync(shimBin);
    fs.writeFileSync(path.join(shimBin, 'rm'), `#!/bin/bash\necho "$@" >> "${rmLog}"\nexec /bin/rm "$@"\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${shimBin}:${process.env.PATH}` };
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe', env });
    expect(fs.existsSync(rmLog), 'a converged project forks no rm').toBe(false);

    // Non-vacuity: the shim is live — one stale marker is one rm, and it is gone.
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'), '');
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe', env });
    expect(fs.readFileSync(rmLog, 'utf-8').trim().split('\n')).toHaveLength(1);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'))).toBe(false);
  });

  it('a `set -e` caller keeps running after the stamping path and the fast path alike', () => {
    // capture-prompt, capture-turn and the other hooks that reach this file through
    // ensure-devflow-init run under `set -e`. With no unversioned marker present (the
    // common case) the legacy-marker helper's last `[ -e ]` test is false, and a
    // function's non-zero status IS fatal under errexit where an inlined loop's is
    // not — so the helper's `return 0` is what keeps those hooks alive, on both paths.
    const probe = `set -e; source "${ENSURE_ROOT}" "${tmpDir}"; echo reached`;

    const stamping = spawnSync('bash', ['-c', probe], { encoding: 'utf-8' });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6')), 'the first run stamps v6').toBe(true);
    expect({ status: stamping.status, out: stamping.stdout.trim() }, 'the stamping path').toEqual({ status: 0, out: 'reached' });

    const fast = spawnSync('bash', ['-c', probe], { encoding: 'utf-8' });
    expect({ status: fast.status, out: fast.stdout.trim() }, 'the converged fast path').toEqual({ status: 0, out: 'reached' });
  });

  it('v6 marker present but block dropped: heals the .gitignore (marker is a claim, not proof)', () => {
    // Simulate a merge-conflict resolution that drops the devflow block while leaving the v6 marker.
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'), '');
    // .gitignore exists but the devflow block was dropped — only unrelated content remains.
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const lines = ignoreLines(path.join(tmpDir, '.gitignore'));
    expect(lines).toContain('!.devflow/conventions.md');
    expect(lines).toContain('!.devflow/policy.json');
    expect(lines).toContain('!.devflow/project.json');
    expect(lines).toContain('.claudeignore');
    expect(lines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(lines).toContain('node_modules/');
  });

  it('v6 marker present but only the project line dropped: the fast path refuses and the line is restored in place', () => {
    // D-GITIGNORE-V6: the fast path requires the project line too.
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    const gitignore = path.join(tmpDir, '.gitignore');
    const converged = fs.readFileSync(gitignore, 'utf-8');
    const withoutProject = converged.split('\n').filter(l => l !== '!.devflow/project.json').join('\n');
    fs.writeFileSync(gitignore, withoutProject);

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    expect(fs.readFileSync(gitignore, 'utf-8')).toBe(converged);
  });

  it('v6 marker present but only the policy line dropped: the fast path refuses and the line is restored in place', () => {
    // The fast path requires the policy line too, so a converged-looking file that lost
    // it (a hand edit, a merge resolution) is completed on the next run.
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    const gitignore = path.join(tmpDir, '.gitignore');
    const converged = fs.readFileSync(gitignore, 'utf-8');
    const withoutPolicy = converged.split('\n').filter(l => l !== '!.devflow/policy.json').join('\n');
    fs.writeFileSync(gitignore, withoutPolicy);

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    expect(fs.readFileSync(gitignore, 'utf-8')).toBe(converged);
  });

  it('upgrades a legacy install: replaces bare .devflow/ with the carve-out and bumps v1 → v6', () => {
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
    expect(lines).toContain('!.devflow/conventions.md'); // v3 addition
    expect(lines).toContain('.claudeignore'); // v4 addition
    expect(lines).toContain('!.devflow/policy.json'); // v5 addition
    expect(lines).toContain('!.devflow/project.json'); // v6 addition
    expect(content).toContain('node_modules/');
    // Marker is bumped: v1 dropped, v6 written.
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
  });

  // The v2 carve-out block exactly as shipped before the conventions.md line was added.
  const V2_BLOCK = [
    '# Devflow runtime data — local by default (memory, learning, docs, locks).',
    '# Exception: feature knowledge bases under .devflow/features/ are shared via git —',
    '# index.md and every {slug}/KNOWLEDGE.md are tracked and committed; everything else',
    '# under .devflow/features/ stays local. To stop sharing, re-add `.devflow/features/`',
    '# to your own .gitignore.',
    '.devflow/*',
    '!.devflow/features/',
    '.devflow/features/*',
    '!.devflow/features/index.md',
    '!.devflow/features/*/',
    '.devflow/features/*/*',
    '!.devflow/features/*/KNOWLEDGE.md',
  ].join('\n');

  const seedV2Install = (gitignoreContent: string) => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), gitignoreContent);
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'), '');
  };

  it('upgrades a v2 install: appends the conventions.md, policy, project and .claudeignore lines and bumps v2 → v6', () => {
    seedV2Install(`node_modules/\n\n${V2_BLOCK}\n`);
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    const lines = ignoreLines(gitignore);
    // Every missing line is added exactly once — the whole block is NOT re-appended.
    expect(lines.filter(l => l === '!.devflow/conventions.md')).toHaveLength(1);
    expect(lines.filter(l => l === '!.devflow/policy.json')).toHaveLength(1);
    expect(lines.filter(l => l === '!.devflow/project.json')).toHaveLength(1);
    expect(lines.filter(l => l === '.claudeignore')).toHaveLength(1);
    expect(lines.filter(l => l === '!.devflow/features/*/KNOWLEDGE.md')).toHaveLength(1);
    expect(lines.filter(l => l === '.devflow/*')).toHaveLength(1);
    expect(fs.readFileSync(gitignore, 'utf-8')).toContain('node_modules/');
    // Marker is bumped: v2 dropped, v6 written.
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
  });

  it('v2 → v6 upgrade does not fuse onto a .gitignore with no trailing newline', () => {
    // A file whose last byte is not \n would otherwise turn the appended lines into
    // `!.devflow/features/*/KNOWLEDGE.md!.devflow/conventions.md`, corrupting both patterns.
    seedV2Install(`node_modules/\n\n${V2_BLOCK}`); // note: no trailing newline
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const lines = ignoreLines(path.join(tmpDir, '.gitignore'));
    expect(lines).toContain('!.devflow/conventions.md');
    expect(lines).toContain('!.devflow/policy.json');
    expect(lines).toContain('!.devflow/project.json');
    expect(lines).toContain('.claudeignore');
    expect(lines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(lines.some(l => l.includes('KNOWLEDGE.md!'))).toBe(false);
  });

  it('re-running after a v2 → v6 upgrade is a no-op (idempotent)', () => {
    seedV2Install(`${V2_BLOCK}\n`);
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    const afterFirst = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');

    // Drop the marker so the fast-path cannot mask a non-idempotent content branch.
    fs.rmSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'));
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8')).toBe(afterFirst);
  });

  it('upgrades a v4 install: inserts only the policy and project lines, bumps v4 → v6, and is idempotent', () => {
    // The shipped v4 block (f3a2198), retyped verbatim because it is history.
    const v4Block = [
      '# Devflow runtime data — local by default (memory, learning, docs, locks).',
      '# Two exceptions are shared via git: feature knowledge bases under .devflow/features/',
      '# (index.md and every {slug}/KNOWLEDGE.md) and .devflow/conventions.md (naming',
      '# authority). To stop sharing, re-add `.devflow/features/` or `.devflow/conventions.md`',
      '# to your own .gitignore.',
      '.devflow/*',
      '!.devflow/features/',
      '.devflow/features/*',
      '!.devflow/features/index.md',
      '!.devflow/features/*/',
      '.devflow/features/*/*',
      '!.devflow/features/*/KNOWLEDGE.md',
      '!.devflow/conventions.md',
      '.claudeignore',
    ].join('\n');
    const seeded = `node_modules/\n\n${v4Block}\n`;
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), seeded);
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'), '');

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    // User lines and the old comment stay untouched; only the missing lines are
    // inserted, inside the block, before its .claudeignore line (D-GITIGNORE-IN-BLOCK).
    const upgraded = seeded.replace('!.devflow/conventions.md\n', '!.devflow/conventions.md\n!.devflow/policy.json\n!.devflow/project.json\n');
    expect(upgraded).not.toBe(seeded);
    expect(fs.readFileSync(gitignore, 'utf-8')).toBe(upgraded);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v4'))).toBe(false);

    // Idempotent with the marker dropped, so the fast path cannot mask a re-insert.
    fs.rmSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'));
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    expect(fs.readFileSync(gitignore, 'utf-8')).toBe(upgraded);
  });

  it('upgrades a v5 install: inserts only the project line before .claudeignore, bumps v5 → v6, and is idempotent (D-GITIGNORE-V6)', () => {
    // The shipped v5 block (through #400), retyped verbatim because it is history.
    const v5Block = [
      '# Devflow runtime data — local by default (memory, learning, docs, locks).',
      '# Shared via git: feature knowledge bases under .devflow/features/ (index.md and',
      '# every {slug}/KNOWLEDGE.md), .devflow/conventions.md (naming authority) and',
      '# .devflow/policy.json (evidence policy). To stop sharing the first two, re-add',
      '# `.devflow/features/` or `.devflow/conventions.md` to your own .gitignore.',
      '.devflow/*',
      '!.devflow/features/',
      '.devflow/features/*',
      '!.devflow/features/index.md',
      '!.devflow/features/*/',
      '.devflow/features/*/*',
      '!.devflow/features/*/KNOWLEDGE.md',
      '!.devflow/conventions.md',
      '!.devflow/policy.json',
      '.claudeignore',
    ].join('\n');
    const seeded = `node_modules/\n\n${v5Block}\n`;
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), seeded);
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v5'), '');

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const gitignore = path.join(tmpDir, '.gitignore');
    const upgraded = seeded.replace('!.devflow/policy.json\n.claudeignore\n', '!.devflow/policy.json\n!.devflow/project.json\n.claudeignore\n');
    expect(upgraded).not.toBe(seeded);
    expect(fs.readFileSync(gitignore, 'utf-8')).toBe(upgraded);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v5'))).toBe(false);

    fs.rmSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'));
    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });
    expect(fs.readFileSync(gitignore, 'utf-8')).toBe(upgraded);
  });

  it('the v5 → v6 upgrade never overrides a user re-ignore of project.json, as git itself reads the file (D-GITIGNORE-IN-BLOCK)', () => {
    // gitignore is last-match-wins. Asked of real git, not of the text: with the
    // project line inside the block, the user's later `.devflow/project.json` still
    // decides; without the re-ignore the upgraded block shares the file.
    const v5Tail = [
      '.devflow/*',
      '!.devflow/conventions.md',
      '!.devflow/policy.json',
      '.claudeignore',
    ].join('\n');
    const probe = (gitignoreContent: string): boolean => {
      const repo = fs.mkdtempSync(path.join(tmpDir, 'repo-'));
      execSync(`git init -q "${repo}"`, { stdio: 'pipe', env: { ...process.env, HOME: tmpDir } });
      fs.writeFileSync(path.join(repo, '.gitignore'), gitignoreContent);
      execSync(`bash -c 'source "${ENSURE_ROOT}" "${repo}"'`, { stdio: 'pipe' });
      expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8').split('\n')).toContain('!.devflow/project.json');
      const check = spawnSync('git', ['-C', repo, 'check-ignore', '-q', '.devflow/project.json'], {
        env: { ...process.env, HOME: tmpDir },
      });
      return check.status === 0; // 0 = ignored, 1 = not ignored
    };

    expect(probe(`${v5Tail}\n\n# keep our settings local\n.devflow/project.json\n`), 'the user re-ignore must win').toBe(true);
    expect(probe(`${v5Tail}\n`), 'non-vacuity: the upgraded block alone shares project.json').toBe(false);
  });

  it('returns non-zero and creates nothing when called with an empty argument', () => {
    const result = execSync(
      `bash -c 'source "${ENSURE_ROOT}" ""; echo $?'`,
      { stdio: 'pipe' },
    ).toString().trim();

    expect(result).toBe('1');
    expect(fs.existsSync(path.join(tmpDir, '.devflow'))).toBe(false);
  });

  it('branch-order: /.devflow/ wins over v2 sentinel when both present — no carve-out appended', () => {
    // A .gitignore with BOTH /.devflow/ (user-authored) AND the v2 sentinel.
    // Shell (after fix) checks /.devflow/ BEFORE v2/v3 sentinels — same as TS twin.
    // The v2→v4 upgrade must be suppressed; /.devflow/ must survive untouched.
    const v2Block = [
      '!.devflow/features/*/KNOWLEDGE.md',
      '.devflow/*',
    ].join('\n');
    const content = `/.devflow/\n${v2Block}\n`;
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), content);

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const after = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    // /.devflow/ respected — none of conventions.md, policy or .claudeignore is appended
    expect(after).not.toContain('!.devflow/conventions.md');
    expect(after).not.toContain('!.devflow/policy.json');
    expect(after).not.toContain('!.devflow/project.json');
    expect(after).not.toContain('.claudeignore');
    // Original content preserved byte-for-byte
    expect(after).toBe(content);
  });

  it('non-contiguous v3: conventions.md present non-contiguously → v3→v6 upgrade: policy + project + .claudeignore appended, v6 marker stamped (P0-S24)', () => {
    // Simulates a .gitignore where !.devflow/conventions.md sits after unrelated sections
    // (non-contiguous). The script detects the v3 sentinel with a whole-line match anywhere
    // in the file and must NOT duplicate it — it appends only the missing completion lines.
    const gitignoreContent = [
      'node_modules/',
      '',
      V2_BLOCK,
      '',
      '# Launch marketing materials',
      '/launch/',
      '',
      '# Competitive analysis codenames',
      '.competitive-codenames.json',
      '',
      '!.devflow/conventions.md',
      '',
    ].join('\n');

    fs.writeFileSync(path.join(tmpDir, '.gitignore'), gitignoreContent);
    fs.mkdirSync(path.join(tmpDir, '.devflow'), { recursive: true });
    // Seed v2 marker to simulate a prior v2 install that already ran once.
    fs.writeFileSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2'), '');

    execSync(`bash -c 'source "${ENSURE_ROOT}" "${tmpDir}"'`, { stdio: 'pipe' });

    const afterContent = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const afterLines = afterContent.split('\n').map(l => l.trim());

    // conventions.md must appear exactly once — never duplicated by the upgrade path.
    expect(
      afterLines.filter(l => l === '!.devflow/conventions.md'),
      'conventions.md must appear exactly once (not duplicated by upgrade)',
    ).toHaveLength(1);
    // The policy line and .claudeignore must each be appended exactly once, in that order.
    expect(
      afterLines.filter(l => l === '!.devflow/policy.json'),
      'policy line must appear exactly once (v3→v6 upgrade)',
    ).toHaveLength(1);
    expect(
      afterLines.filter(l => l === '.claudeignore'),
      '.claudeignore must appear exactly once (v3→v6 upgrade)',
    ).toHaveLength(1);
    expect(afterContent).toBe(`${gitignoreContent}!.devflow/policy.json\n!.devflow/project.json\n.claudeignore\n`);
    // Unrelated blocks must be preserved intact.
    expect(afterContent).toContain('/launch/');
    expect(afterContent).toContain('.competitive-codenames.json');
    // The v2 sentinel must still be present (upgrade does not strip it).
    expect(afterLines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    // v6 marker stamped; v2 marker removed.
    expect(
      fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6')),
      'v6 marker must be stamped',
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v2')),
      'v2 marker must be removed after upgrade',
    ).toBe(false);
  });
});

// =============================================================================
// Cross-implementation parity: ensure-root-gitignore (shell) ×
// computeDevflowGitignore (TS) — both state machines must produce semantically
// identical outcomes for each branch. Exercises the REAL shell script (no
// reimplementation in the test).
// =============================================================================

describe('ensure-root-gitignore × computeDevflowGitignore cross-implementation parity', () => {
  const ENSURE_ROOT_PARITY = path.join(HOOKS_DIR, 'ensure-root-gitignore');

  // The v2 block (without the conventions.md line) used to seed v2-install state.
  // This is the historically shipped v2 format; the comment text differs intentionally
  // from the current DEVFLOW_GITIGNORE_BLOCK.
  const V2_BLOCK_SEED = [
    '# Devflow runtime data — local by default (memory, learning, docs, locks).',
    '# Exception: feature knowledge bases under .devflow/features/ are shared via git —',
    '# index.md and every {slug}/KNOWLEDGE.md are tracked and committed; everything else',
    '# under .devflow/features/ stays local. To stop sharing, re-add `.devflow/features/`',
    '# to your own .gitignore.',
    '.devflow/*',
    '!.devflow/features/',
    '.devflow/features/*',
    '!.devflow/features/index.md',
    '!.devflow/features/*/',
    '.devflow/features/*/*',
    '!.devflow/features/*/KNOWLEDGE.md',
  ].join('\n');

  /** Run the REAL shell hook on a fresh tmpDir with an optional initial .gitignore. */
  function runShell(initialContent: string | null): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-xparity-'));
    try {
      if (initialContent !== null) {
        fs.writeFileSync(path.join(tmpDir, '.gitignore'), initialContent);
      }
      execSync(`bash -c 'source "${ENSURE_ROOT_PARITY}" "${tmpDir}"'`, { stdio: 'pipe' });
      const gi = path.join(tmpDir, '.gitignore');
      return fs.existsSync(gi) ? fs.readFileSync(gi, 'utf-8') : '';
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Apply the TS pure function computeDevflowGitignore to the initial content. */
  function applyTs(initialContent: string | null): string {
    const content = initialContent ?? '';
    return computeDevflowGitignore(content) ?? content;
  }

  // -------------------------------------------------------------------------
  // Verbatim check: shell hook emits DEVFLOW_GITIGNORE_BLOCK byte-for-byte
  // -------------------------------------------------------------------------

  it('verbatim: fresh dir (no .gitignore) — shell output contains DEVFLOW_GITIGNORE_BLOCK verbatim', () => {
    const shellResult = runShell(null);
    expect(shellResult).toContain(DEVFLOW_GITIGNORE_BLOCK);
    // For the "no file" branch both writers emit exactly DEVFLOW_GITIGNORE_BLOCK + '\n'.
    const tsResult = applyTs(null);
    expect(shellResult).toBe(tsResult);
  });

  // -------------------------------------------------------------------------
  // Table-driven branch coverage: each state-machine branch, both implementations
  // -------------------------------------------------------------------------

  // The CURRENT block minus its final `.claudeignore` line. Taken from the exported
  // constant rather than retyped so a block edit cannot leave this seed silently
  // describing a shape that no longer ships.
  const CURRENT_BLOCK_NO_CI = DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE;

  // The v4 block exactly as shipped at f3a2198 — "Two exceptions" comment, conventions
  // line, `.claudeignore`, no policy line. Retyped verbatim like V2_BLOCK_SEED because it
  // is history: slicing it off the exported constant would silently turn it into v5.
  const V4_BLOCK_SEED_LINES = [
    '# Devflow runtime data — local by default (memory, learning, docs, locks).',
    '# Two exceptions are shared via git: feature knowledge bases under .devflow/features/',
    '# (index.md and every {slug}/KNOWLEDGE.md) and .devflow/conventions.md (naming',
    '# authority). To stop sharing, re-add `.devflow/features/` or `.devflow/conventions.md`',
    '# to your own .gitignore.',
    '.devflow/*',
    '!.devflow/features/',
    '.devflow/features/*',
    '!.devflow/features/index.md',
    '!.devflow/features/*/',
    '.devflow/features/*/*',
    '!.devflow/features/*/KNOWLEDGE.md',
    '!.devflow/conventions.md',
    '.claudeignore',
  ];
  const V4_BLOCK_SEED = V4_BLOCK_SEED_LINES.join('\n');
  // The shipped v3 block is the v4 block minus its final `.claudeignore` line (the v4
  // change added only that line), so it is derived from the history literal, never from
  // the exported constant.
  const V3_BLOCK_SEED = V4_BLOCK_SEED_LINES.slice(0, -1).join('\n');

  // The v5 block exactly as shipped through #400 — the policy line, no project line.
  // History, so retyped verbatim rather than derived from the exported constant.
  const V5_BLOCK_SEED_LINES = [
    '# Devflow runtime data — local by default (memory, learning, docs, locks).',
    '# Shared via git: feature knowledge bases under .devflow/features/ (index.md and',
    '# every {slug}/KNOWLEDGE.md), .devflow/conventions.md (naming authority) and',
    '# .devflow/policy.json (evidence policy). To stop sharing the first two, re-add',
    '# `.devflow/features/` or `.devflow/conventions.md` to your own .gitignore.',
    '.devflow/*',
    '!.devflow/features/',
    '.devflow/features/*',
    '!.devflow/features/index.md',
    '!.devflow/features/*/',
    '.devflow/features/*/*',
    '!.devflow/features/*/KNOWLEDGE.md',
    '!.devflow/conventions.md',
    '!.devflow/policy.json',
    '.claudeignore',
  ];
  const V5_BLOCK_SEED = V5_BLOCK_SEED_LINES.join('\n');
  const V5_BLOCK_SEED_NO_CI = V5_BLOCK_SEED_LINES.slice(0, -1).join('\n');

  /** The block's devflow-unique presence sentinel. */
  const V3_SENTINEL = '!.devflow/conventions.md';
  /** A block LINE users also author themselves — never a sentinel. */
  const CLAUDEIGNORE_LINE = '.claudeignore';
  /** The v5 completion line — users may author it too, so it is never a sentinel (D-GITIGNORE-V5). */
  const POLICY_LINE = '!.devflow/policy.json';
  /** The v6 completion line — likewise never a sentinel (D-GITIGNORE-V6). */
  const PROJECT_LINE = '!.devflow/project.json';

  /** Start a new block after unrelated content: one blank separator line. */
  const appendBlock = (body: string, block: string): string =>
    body.length === 0
      ? `${block}\n`
      : `${body}${body.endsWith('\n') ? '' : '\n'}\n${block}\n`;

  /**
   * Continue an existing devflow block whose run ends the file with the lines it
   * lacks: no blank separator, one newline guard. Rows whose block is followed by
   * other lines spell the inserted bytes out instead (D-GITIGNORE-IN-BLOCK).
   */
  const appendLines = (body: string, block: string): string =>
    `${body}${body.endsWith('\n') ? '' : '\n'}${block}\n`;

  const wholeLines = (content: string): string[] => content.split('\n').map(l => l.trim());

  const PARITY_CASES: Array<{
    label: string;
    input: string | null;
    /** Exact bytes BOTH twins must leave in .gitignore. */
    expected: string;
    /** Result differs from the input (a no-op row expects the input back verbatim). */
    changed: boolean;
    /** The devflow-unique block sentinel is present in the result. */
    devflowSentinelPresent: boolean;
    /** A bare `.claudeignore` line is present in the result. */
    claudeignoreLinePresent: boolean;
    /** A whole-line `!.devflow/policy.json` is present in the result. */
    policyLinePresent: boolean;
    /** A whole-line `!.devflow/project.json` is present in the result. */
    projectLinePresent: boolean;
    /** DEVFLOW_GITIGNORE_BLOCK appears verbatim in the result. */
    blockPresent: boolean;
  }> = [
    {
      label: 'no .gitignore',
      input: null,
      expected: `${DEVFLOW_GITIGNORE_BLOCK}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: 'unrelated content only',
      input: 'node_modules/\ndist/\n',
      expected: appendBlock('node_modules/\ndist/\n', DEVFLOW_GITIGNORE_BLOCK),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: 'legacy bare .devflow/ entry',
      input: 'node_modules/\n.devflow/\n',
      expected: appendBlock('node_modules/\n', DEVFLOW_GITIGNORE_BLOCK),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      // The legacy filter emits nothing here, so the shell twin must not treat the
      // filtering grep's exit status as failure.
      label: 'legacy bare .devflow/ entry as the whole file',
      input: '.devflow/\n',
      expected: `${DEVFLOW_GITIGNORE_BLOCK}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: '(j) v2-format block present (conventions.md, policy, project and .claudeignore lines inserted after its sentinel, block not re-added)',
      input: `${V2_BLOCK_SEED}\n`,
      expected: appendLines(`${V2_BLOCK_SEED}\n`, `${V3_SENTINEL}\n${POLICY_LINE}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}`),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false, // only the missing lines are inserted, not the whole block
    },
    {
      label: 'current block minus its .claudeignore line (.claudeignore appended, completing the block)',
      input: `${CURRENT_BLOCK_NO_CI}\n`,
      expected: appendLines(`${CURRENT_BLOCK_NO_CI}\n`, CLAUDEIGNORE_LINE),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      // CURRENT_BLOCK_NO_CI + '\n' + '.claudeignore' = DEVFLOW_GITIGNORE_BLOCK verbatim,
      // so the full block IS present in the result even though only one line was appended.
      blockPresent: true,
    },
    {
      label: 'user-authored /.devflow/ entry (no carve-out forced)',
      input: '/.devflow/\n',
      expected: '/.devflow/\n',
      changed: false,
      devflowSentinelPresent: false, // user-authored entry respected; no block installed
      claudeignoreLinePresent: false,
      policyLinePresent: false,
      projectLinePresent: false,
      blockPresent: false,
    },
    // -------------------------------------------------------------------------
    // .claudeignore is a block LINE, never a presence sentinel (users author it themselves).
    // -------------------------------------------------------------------------
    {
      label: '(a) user .claudeignore entry — block still installed, minus its .claudeignore line',
      input: 'node_modules/\n.claudeignore\n',
      expected: appendBlock('node_modules/\n.claudeignore\n', DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true, // the user's own line, not one we appended
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(b) user !.claudeignore un-ignore — never reversed by an appended .claudeignore',
      input: 'node_modules/\n!.claudeignore\n',
      expected: appendBlock('node_modules/\n!.claudeignore\n', DEVFLOW_GITIGNORE_BLOCK_WITHOUT_CLAUDEIGNORE),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: false, // last-match-wins: appending it would reverse the user
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(c) v2 block + user .claudeignore entry — conventions.md, policy and project lines inserted above it',
      input: `${V2_BLOCK_SEED}\n${CLAUDEIGNORE_LINE}\n`,
      expected: `${V2_BLOCK_SEED}\n${V3_SENTINEL}\n${POLICY_LINE}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(d) current block (no .claudeignore line) + user .claudeignore placed before it — no-op',
      input: `${CLAUDEIGNORE_LINE}\n\nnode_modules/\n\n${CURRENT_BLOCK_NO_CI}\n`,
      expected: `${CLAUDEIGNORE_LINE}\n\nnode_modules/\n\n${CURRENT_BLOCK_NO_CI}\n`,
      changed: false,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false, // the .claudeignore line is not adjacent to the block
    },
    {
      label: '(e) current block (no .claudeignore line) + user !.claudeignore un-ignore — no-op',
      input: `${CURRENT_BLOCK_NO_CI}\n!${CLAUDEIGNORE_LINE}\n`,
      expected: `${CURRENT_BLOCK_NO_CI}\n!${CLAUDEIGNORE_LINE}\n`,
      changed: false,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: false,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    // -------------------------------------------------------------------------
    // Newline edge cases: the rows above all happen to end in exactly one
    // newline, which is what let a trimEnd/no-trimEnd divergence hide.
    // -------------------------------------------------------------------------
    {
      label: '(f1) existing but empty .gitignore',
      input: '',
      expected: `${DEVFLOW_GITIGNORE_BLOCK}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: '(f2) no trailing newline',
      input: 'node_modules/',
      expected: `node_modules/\n\n${DEVFLOW_GITIGNORE_BLOCK}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: '(f3) multiple trailing newlines preserved verbatim',
      input: 'node_modules/\n\n',
      expected: `node_modules/\n\n\n${DEVFLOW_GITIGNORE_BLOCK}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    // -------------------------------------------------------------------------
    // D-GITIGNORE-V5: `!.devflow/policy.json` is a completion line topped up when
    // missing, never a presence sentinel — users may author it themselves.
    // -------------------------------------------------------------------------
    {
      label: '(g) shipped v4 block — the policy and project lines inserted before .claudeignore (the v4→v6 upgrade)',
      input: `${V4_BLOCK_SEED}\n`,
      expected: `${V3_BLOCK_SEED}\n${POLICY_LINE}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false, // the old comment stays
    },
    {
      label: '(h) shipped v4 block minus .claudeignore + user !.claudeignore — only the policy and project lines inserted, above the un-ignore',
      input: `${V3_BLOCK_SEED}\n!${CLAUDEIGNORE_LINE}\n`,
      expected: `${V3_BLOCK_SEED}\n${POLICY_LINE}\n${PROJECT_LINE}\n!${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: false, // the user's un-ignore is never reversed
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(i) shipped v3 block — policy, project and .claudeignore lines appended, in that order',
      input: `${V3_BLOCK_SEED}\n`,
      expected: appendLines(`${V3_BLOCK_SEED}\n`, `${POLICY_LINE}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}`),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      // No-sentinel proof: a user-authored policy line must NOT read as "block installed".
      label: '(k) only a user-authored !.devflow/policy.json — full block appended',
      input: `${POLICY_LINE}\n`,
      expected: appendBlock(`${POLICY_LINE}\n`, DEVFLOW_GITIGNORE_BLOCK),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true, // the user's line duplicates harmlessly
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: '(l) current block — no-op',
      input: `${DEVFLOW_GITIGNORE_BLOCK}\n`,
      expected: `${DEVFLOW_GITIGNORE_BLOCK}\n`,
      changed: false,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: true,
    },
    {
      label: '(m) v2 block + user-authored policy line — conventions.md, project and .claudeignore inserted after the v2 sentinel, policy not duplicated',
      input: `${V2_BLOCK_SEED}\n${POLICY_LINE}\n`,
      expected: `${V2_BLOCK_SEED}\n${V3_SENTINEL}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n${POLICY_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(n) shipped v4 block + user-authored policy line elsewhere — only the project line inserted after the sentinel, policy not duplicated',
      input: `${V4_BLOCK_SEED}\n\n# team files\n${POLICY_LINE}\n`,
      expected: `${V3_BLOCK_SEED}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n\n# team files\n${POLICY_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
      // -------------------------------------------------------------------------
    // D-GITIGNORE-V6: `!.devflow/project.json` is a completion line like the policy
    // line — topped up when missing, never a presence sentinel.
    // -------------------------------------------------------------------------
    {
      label: '(o) shipped v5 block — only the project line inserted, just before .claudeignore (the v5→v6 upgrade)',
      input: `${V5_BLOCK_SEED}\n`,
      expected: `${V5_BLOCK_SEED_NO_CI}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false, // the v5 comment stays
    },
    {
      label: '(p) shipped v5 block minus .claudeignore + user !.claudeignore — only the project line inserted, above the un-ignore',
      input: `${V5_BLOCK_SEED_NO_CI}\n!${CLAUDEIGNORE_LINE}\n`,
      expected: `${V5_BLOCK_SEED_NO_CI}\n${PROJECT_LINE}\n!${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: false, // the user's un-ignore is never reversed
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(q) shipped v5 block minus .claudeignore — project and .claudeignore lines appended, in that order',
      input: `${V5_BLOCK_SEED_NO_CI}\n`,
      expected: appendLines(`${V5_BLOCK_SEED_NO_CI}\n`, `${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}`),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      // No-sentinel proof: a user-authored project line must NOT read as "block installed".
      label: '(r) only a user-authored !.devflow/project.json — full block appended',
      input: `${PROJECT_LINE}\n`,
      expected: appendBlock(`${PROJECT_LINE}\n`, DEVFLOW_GITIGNORE_BLOCK),
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true, // the user's line duplicates harmlessly
      blockPresent: true,
    },
    {
      label: '(s) shipped v5 block + user-authored project line elsewhere — no-op',
      input: `${V5_BLOCK_SEED}\n\n# team files\n${PROJECT_LINE}\n`,
      expected: `${V5_BLOCK_SEED}\n\n# team files\n${PROJECT_LINE}\n`,
      changed: false,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    // -------------------------------------------------------------------------
    // D-GITIGNORE-IN-BLOCK: a topped-up line goes inside the block, never at EOF,
    // and every byte around it is kept.
    // -------------------------------------------------------------------------
    {
      // gitignore is last-match-wins: an EOF append would override the re-ignore.
      label: '(t) shipped v5 block + a later user re-ignore of project.json — the project line stays above it',
      input: `${V5_BLOCK_SEED}\n\n# keep our settings local\n.devflow/project.json\n`,
      expected: `${V5_BLOCK_SEED_NO_CI}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n\n# keep our settings local\n.devflow/project.json\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(u) shipped v5 block minus .claudeignore, no trailing newline — the run ends the file, so a newline is added first',
      input: V5_BLOCK_SEED_NO_CI,
      expected: `${V5_BLOCK_SEED_NO_CI}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(v) shipped v4 block, no trailing newline — lines inserted, the last line keeps its missing newline',
      input: V4_BLOCK_SEED,
      expected: `${V3_BLOCK_SEED}\n${POLICY_LINE}\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(w) CRLF v5 block — the project line inserted after the policy line, every CR kept',
      input: `${V5_BLOCK_SEED_LINES.join('\r\n')}\r\n`,
      expected: `${V5_BLOCK_SEED_LINES.slice(0, -1).join('\r\n')}\r\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\r\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(x) whitespace-padded policy line under the sentinel — part of the run, the project line goes after it',
      input: `${V3_BLOCK_SEED}\n  ${POLICY_LINE}\t\n${CLAUDEIGNORE_LINE}\n`,
      expected: `${V3_BLOCK_SEED}\n  ${POLICY_LINE}\t\n${PROJECT_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
    {
      label: '(y) a foreign line between the sentinel and the policy line — the run stops at the sentinel',
      input: `${V3_BLOCK_SEED}\n# user note\n${POLICY_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      expected: `${V3_BLOCK_SEED}\n${PROJECT_LINE}\n# user note\n${POLICY_LINE}\n${CLAUDEIGNORE_LINE}\n`,
      changed: true,
      devflowSentinelPresent: true,
      claudeignoreLinePresent: true,
      policyLinePresent: true,
      projectLinePresent: true,
      blockPresent: false,
    },
];

  it('PARITY_CASES covers every v5 and v6 upgrade row and keeps the completion lines out of every no-sentinel row', () => {
    // Non-vacuity for the table itself: the rows the D-GITIGNORE-V5
    // and D-GITIGNORE-V6 migrations depend on exist, and the only row with no block
    // sentinel in its result is the user opt-out.
    const labels = PARITY_CASES.map(r => r.label);
    for (const tag of ['(g)', '(h)', '(i)', '(j)', '(k)', '(l)', '(m)', '(n)', '(o)', '(p)', '(q)', '(r)', '(s)', '(t)', '(u)', '(v)', '(w)', '(x)', '(y)']) {
      expect(labels.filter(l => l.startsWith(tag)), `row ${tag}`).toHaveLength(1);
    }
    expect(PARITY_CASES.length).toBeGreaterThanOrEqual(33);
    // The v5 history literal really is v5: the policy line, no project line.
    expect(V5_BLOCK_SEED_LINES).toContain(POLICY_LINE);
    expect(V5_BLOCK_SEED_LINES).not.toContain(PROJECT_LINE);
    // The current block is v6: the project line sits after the policy line and
    // before `.claudeignore`, the order both twins insert completion lines in.
    const current = DEVFLOW_GITIGNORE_BLOCK.split('\n');
    expect(current.slice(-3)).toEqual([POLICY_LINE, PROJECT_LINE, CLAUDEIGNORE_LINE]);
    expect(PARITY_CASES.filter(r => !r.devflowSentinelPresent).map(r => r.label))
      .toEqual(['user-authored /.devflow/ entry (no carve-out forced)']);
  });

  for (const row of PARITY_CASES) {
    const {
      label, input, expected, changed, devflowSentinelPresent, claudeignoreLinePresent,
      policyLinePresent, projectLinePresent, blockPresent,
    } = row;

    it(`branch: ${label} — shell and TS agree byte-for-byte`, () => {
      const shellResult = runShell(input);
      const tsResult = applyTs(input);
      const baseline = input ?? '';

      // Byte equality is the contract; the booleans below only name WHY it holds.
      // Asserting only has-line booleans would hide whitespace divergence.
      expect(shellResult, 'shell and TS must produce identical bytes').toBe(tsResult);
      expect(shellResult, 'both twins must produce the expected bytes').toBe(expected);

      for (const [who, result] of [['shell', shellResult], ['ts', tsResult]] as const) {
        expect(result !== baseline, `${who}: changed`).toBe(changed);
        expect(wholeLines(result).includes(V3_SENTINEL), `${who}: devflowSentinelPresent`)
          .toBe(devflowSentinelPresent);
        expect(wholeLines(result).includes(CLAUDEIGNORE_LINE), `${who}: claudeignoreLinePresent`)
          .toBe(claudeignoreLinePresent);
        expect(wholeLines(result).includes(POLICY_LINE), `${who}: policyLinePresent`)
          .toBe(policyLinePresent);
        expect(wholeLines(result).includes(PROJECT_LINE), `${who}: projectLinePresent`)
          .toBe(projectLinePresent);
        expect(result.includes(DEVFLOW_GITIGNORE_BLOCK), `${who}: blockPresent`).toBe(blockPresent);
      }

      // Convergence: every branch must be a fixed point on re-run.
      expect(computeDevflowGitignore(tsResult), 'TS: re-running over its own output must be a no-op')
        .toBeNull();
      expect(runShell(shellResult), 'shell: re-running over its own output must be a byte no-op')
        .toBe(shellResult);
    });
  }

  // ---------------------------------------------------------------------------
  // D-GITIGNORE-V5/V6 under REAL git: byte parity proves the twins agree, not that the
  // block they agree on does what it claims. `git check-ignore --no-index` answers
  // the actual question — would git ignore this path? — for paths that need not exist.
  // ---------------------------------------------------------------------------
  describe('real git check-ignore over the v6 block (TP-35)', () => {
    /** Paths the carve-out must keep TRACKABLE (check-ignore exits 1). */
    const TRACKED = [
      '.devflow/project.json',
      '.devflow/policy.json',
      '.devflow/conventions.md',
      '.devflow/features/index.md',
      '.devflow/features/x/KNOWLEDGE.md',
    ];
    /** Paths that must stay IGNORED (check-ignore exits 0). */
    const IGNORED = [
      '.devflow/config.json',
      '.devflow/memory/W.md',
      '.devflow/docs/a.md',
      '.devflow/features/x/o.md',
      '.claudeignore',
    ];

    let sandbox: string;
    let repo: string;
    let gitEnv: NodeJS.ProcessEnv;

    beforeAll(() => {
      sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-checkignore-'));
      repo = path.join(sandbox, 'repo');
      fs.mkdirSync(repo);
      // Every inherited GIT_* variable is dropped (a GIT_DIR from a surrounding hook would
      // aim git at the developer's repo), and no global, system or XDG excludes file can
      // add a pattern the block did not write.
      gitEnv = Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
      );
      gitEnv.HOME = sandbox;
      gitEnv.XDG_CONFIG_HOME = path.join(sandbox, '.config');
      gitEnv.GIT_CONFIG_GLOBAL = '/dev/null';
      gitEnv.GIT_CONFIG_NOSYSTEM = '1';
      const init = spawnSync('git', ['init', '-q', '.'], { cwd: repo, env: gitEnv, encoding: 'utf-8' });
      expect(init.status, init.stderr).toBe(0);
    });

    afterAll(() => {
      fs.rmSync(sandbox, { recursive: true, force: true });
    });

    /** Write `content` as the repo's .gitignore and ask git whether `p` is ignored. */
    function isIgnored(content: string, p: string): boolean {
      fs.writeFileSync(path.join(repo, '.gitignore'), content);
      const r = spawnSync('git', ['check-ignore', '-q', '--no-index', p], {
        cwd: repo, env: gitEnv, encoding: 'utf-8',
      });
      // 0 = ignored, 1 = not ignored; anything else is a git error, never an answer.
      expect([0, 1], `git check-ignore ${p}: ${r.stderr}`).toContain(r.status);
      return r.status === 0;
    }

    const SUBJECTS: ReadonlyArray<readonly [string, () => string]> = [
      ['fresh TS output', () => applyTs(null)],
      ['fresh shell output', () => runShell(null)],
      ['shipped v4 block upgraded by TS', () => applyTs(`${V4_BLOCK_SEED}\n`)],
      ['shipped v4 block upgraded by shell', () => runShell(`${V4_BLOCK_SEED}\n`)],
      ['shipped v5 block upgraded by TS', () => applyTs(`${V5_BLOCK_SEED}\n`)],
      ['shipped v5 block upgraded by shell', () => runShell(`${V5_BLOCK_SEED}\n`)],
    ];

    for (const [subject, produce] of SUBJECTS) {
      it(`${subject}: project.json, policy.json and the existing carve-outs are tracked, every other .devflow/ path is ignored`, () => {
        const content = produce();
        // Non-vacuity: the subject really carries the lines under test.
        expect(wholeLines(content)).toContain(POLICY_LINE);
        expect(wholeLines(content)).toContain(PROJECT_LINE);
        for (const p of TRACKED) expect(isIgnored(content, p), `${subject}: ${p} must be tracked`).toBe(false);
        for (const p of IGNORED) expect(isIgnored(content, p), `${subject}: ${p} must be ignored`).toBe(true);
      });
    }

    it('probe: the shipped v5 block ignores project.json — the arm can see the defect it guards', () => {
      expect(isIgnored(`${V5_BLOCK_SEED}\n`, '.devflow/project.json')).toBe(true);
      // ...while its own carve-outs still hold, so the probe isolates the missing line.
      expect(isIgnored(`${V5_BLOCK_SEED}\n`, '.devflow/policy.json')).toBe(false);
    });

    it('probe: the shipped v4 block ignores policy.json — the arm can see the defect it guards', () => {
      expect(isIgnored(`${V4_BLOCK_SEED}\n`, '.devflow/policy.json')).toBe(true);
      // ...while its own carve-outs still hold, so the probe isolates the missing line.
      expect(isIgnored(`${V4_BLOCK_SEED}\n`, '.devflow/conventions.md')).toBe(false);
    });
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
// session-start-context: memory-independent root .gitignore write
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
    // The carve-out is project work, written only inside a git project (D-HOOKS-GIT-ONLY).
    fs.mkdirSync(path.join(tmpDir, '.git'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-ignore-home-'));
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('adds .devflow/ to the root .gitignore even when memory is disabled', () => {
    // Memory OFF, decisions implicitly ON — the case the memory-gated writer missed.
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
    expect(fs.readFileSync(gitignore, 'utf-8').split('\n').map(l => l.trim())).toContain('!.devflow/policy.json');
    expect(fs.readFileSync(gitignore, 'utf-8').split('\n').map(l => l.trim())).toContain('!.devflow/project.json');
    expect(fs.existsSync(path.join(tmpDir, '.devflow', '.root-gitignore-configured-v6'))).toBe(true);
  });
});

// =============================================================================
// session-start-context Section 2: Learning maintenance directive
// =============================================================================
//
// When the learning queue holds captured turns (or a crashed run left a stale
// .processing batch), session-start-context emits a "--- LEARNING MAINTENANCE ---"
// directive instructing the main model to spawn the background Learning agent with
// the resolved model (project learning.json → global ~/.devflow/learning.json
// → opus). A FRESH .processing (younger than 900s) means a live agent already
// owns the batch, so the directive is suppressed. Gate is the machine
// `features.learning` in ~/.devflow/manifest.json, which the checkout's
// project.json / config.json can only narrow (D-FEATURES-NARROW-ONLY).

describe('session-start-context: learning maintenance directive (Section 2)', () => {
  const CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');

  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-learning-'));
    // Learning is project work, active only inside a git project (D-HOOKS-GIT-ONLY).
    // An empty `.git` is a marker, not a repository, so the root stays tmpDir.
    fs.mkdirSync(path.join(tmpDir, '.git'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-ctx-learning-home-'));
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const queuePath = (dir: string) => path.join(dir, '.devflow', 'learning', '.pending-turns.jsonl');
  const processingPath = (dir: string) => path.join(dir, '.devflow', 'learning', '.pending-turns.processing');

  function seedQueue(dir: string): void {
    fs.writeFileSync(queuePath(dir), '{"role":"user","content":"we chose X over Y","ts":1}\n');
  }

  function contextOf(stdout: string): string {
    return JSON.parse(stdout).hookSpecificOutput.additionalContext;
  }

  it('emits the directive when the queue is non-empty: Learning agent, background, default opus', () => {
    seedQueue(tmpDir);

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);

    const ctx = contextOf(stdout);
    expect(ctx).toContain('--- LEARNING MAINTENANCE ---');
    expect(ctx).toContain('subagent_type="Learning"');
    expect(ctx).toContain('model="opus"');
    expect(ctx).toContain('run_in_background: true');
    expect(ctx).toContain('Do not narrate');
    expect(ctx).toContain('Never mention');
    expect(ctx).toContain('first visible words');
    // The prompt names the project root the agent must operate from
    // (a marker-only `.git` → df_resolve_roots falls back to the cwd as given).
    expect(ctx).toContain(`Project root: ${tmpDir}`);
    // The directive never spawns anything itself — the queue is untouched.
    expect(fs.existsSync(queuePath(tmpDir))).toBe(true);
  });

  it('no directive when the queue is empty or absent', () => {
    // Zero-byte queue file (the -s test) + a TL;DR so there is JSON output to inspect.
    fs.writeFileSync(queuePath(tmpDir), '');
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '<!-- TL;DR: 1 decision. Key: ADR-001 Test -->\n# Architectural Decisions',
    );

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);
    expect(contextOf(stdout)).not.toContain('LEARNING MAINTENANCE');
  });

  // D-FEATURES-NARROW-ONLY: `devflow init --no-learning` / `devflow learning
  // --disable` write features.learning:false to ~/.devflow/manifest.json; that
  // switches the directive (and the TL;DR) off in every repo, and no repository
  // file can switch it back on — the retired per-repo `learning` key decides
  // nothing either way.
  describe('machine-wide learning switch (manifest only)', () => {
    const ENV = {};
    const TLDR = '<!-- TL;DR: 1 decision. Key: ADR-001 Test -->\n# Architectural Decisions';

    function writeManifestFeatures(features: Record<string, unknown>): void {
      fs.writeFileSync(
        path.join(homeDir, '.devflow', 'manifest.json'),
        JSON.stringify({ version: '2.0.0', features }),
      );
    }

    it('learning:false in the manifest suppresses the directive and the TL;DR although the repo config says true', () => {
      seedQueue(tmpDir);
      fs.writeFileSync(path.join(tmpDir, '.devflow', 'config.json'), JSON.stringify({ learning: true }));
      fs.writeFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), TLDR);
      writeManifestFeatures({ learning: false });

      const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir, ENV);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('learning:false in the manifest suppresses the directive where the repo has no config', () => {
      seedQueue(tmpDir);
      writeManifestFeatures({ learning: false });

      const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir, ENV);
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('');
    });

    it('a manifest without the learning key leaves the directive on (fail-open)', () => {
      seedQueue(tmpDir);
      writeManifestFeatures({ ambient: true });

      const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir, ENV);
      expect(contextOf(stdout)).toContain('--- LEARNING MAINTENANCE ---');
    });

    it('a stale repo config learning:false does not suppress the directive or the TL;DR', () => {
      seedQueue(tmpDir);
      fs.writeFileSync(path.join(tmpDir, '.devflow', 'config.json'), JSON.stringify({ learning: false }));
      fs.writeFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), TLDR);
      writeManifestFeatures({ learning: true });

      const ctx = contextOf(runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir, ENV).stdout);
      expect(ctx).toContain('--- LEARNING MAINTENANCE ---');
      expect(ctx).toContain('PROJECT DECISIONS');
    });
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
    expect(stdout.trim() === '' || !contextOf(stdout).includes('LEARNING MAINTENANCE')).toBe(true);
  });

  it('stale .processing (older than 900s) emits the directive even with an empty queue', () => {
    fs.writeFileSync(processingPath(tmpDir), '{"role":"user","content":"orphaned","ts":1}\n');
    const past = new Date(Date.now() - 1000 * 1000); // ~16.7 min ago, past the 900s threshold
    fs.utimesSync(processingPath(tmpDir), past, past);

    const { stdout, exitCode } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(exitCode).toBe(0);
    const ctx = contextOf(stdout);
    expect(ctx).toContain('--- LEARNING MAINTENANCE ---');
    expect(ctx).toContain('subagent_type="Learning"');
  });

  it('model resolution: project learning.json wins', () => {
    seedQueue(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'learning.json'),
      JSON.stringify({ model: 'haiku', debug: false }),
    );
    // Global config present too — project must win.
    fs.writeFileSync(path.join(homeDir, '.devflow', 'learning.json'), JSON.stringify({ model: 'sonnet' }));

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(contextOf(stdout)).toContain('model="haiku"');
  });

  it('model resolution: global ~/.devflow/learning.json used when the project sets none', () => {
    seedQueue(tmpDir);
    fs.writeFileSync(path.join(homeDir, '.devflow', 'learning.json'), JSON.stringify({ model: 'sonnet' }));

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    expect(contextOf(stdout)).toContain('model="sonnet"');
  });

  it('model resolution: an invalid/unallowlisted model value falls back to opus (defense in depth)', () => {
    seedQueue(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'learning.json'),
      JSON.stringify({ model: 'gpt-5\ninjected", "evil": "payload' }),
    );

    const { stdout } = runHook(CONTEXT_HOOK, { cwd: tmpDir }, homeDir);
    const ctx = contextOf(stdout);
    expect(ctx).toContain('model="opus"');
    expect(ctx).not.toContain('injected');
    expect(ctx).not.toContain('evil');
  });
});

// =============================================================================
// ensure-proxy behavioral tests
// =============================================================================
//
// Tests cover: disabled/absent proxy, re-entrancy guard, missing prerequisites,
// UserPromptSubmit silent path, port-up fast-exit (with ephemeral TCP server),
// and the relay-spawn path (stub relay that binds the port on startup, so the
// bounded 80×0.1s wait resolves on the first probes instead of running to timeout).
//
// Not covered here: the spawn path's failure branch (relay binary that never binds),
// which costs the full 8s wait and would dominate suite runtime.

describe('ensure-proxy behavioral tests', () => {
  const PROXY_HOOK = path.join(HOOKS_DIR, 'ensure-proxy');

  let tmpDir: string;
  let homeDir: string;

  /**
   * D-PROXY-EXEC-BARRIER: this group execs `node` (relay stubs, the CONS-5 health
   * stub, json-parse's node fallback), and on macOS a node exec that follows the
   * fork-heavy hook tests above it waits on syspolicyd. The shell forks of a hook
   * spawned from this node worker are reported to syspolicyd against node
   * ("violates validation category policy") — 100 `bash -c` runs with two command
   * substitutions each produced ~1,700 reports — and syspolicyd drains ~200/s,
   * while an exec of node itself is held at `_dyld_start` until the queue ahead
   * of it clears. Measured on macOS 26.2: the first exec here waits
   * 5-7 s — past the 5 s test timeout of whichever test happens to be first — and
   * the next one takes ~30 ms. Paying that once, here, keeps every test's budget
   * measuring the hook rather than the OS queue. Linux has no such queue, so
   * there this costs one ~30 ms exec.
   *
   * The bound: this file raises ~4,200 reports per run, so a queue holding all
   * of them drains in ~21 s at the measured rate; 30 s covers it. A barrier that
   * still times out fails here, naming the cause, instead of as a timeout inside
   * an unrelated test.
   */
  const NODE_EXEC_BARRIER_MS = 30000;

  beforeAll(() => {
    const warm = spawnSync(process.execPath, ['-e', '0'], { timeout: NODE_EXEC_BARRIER_MS });
    expect(
      warm.status,
      `a node exec did not complete within ${NODE_EXEC_BARRIER_MS} ms: ${warm.error?.message ?? `signal ${warm.signal}`}`,
    ).toBe(0);
  }, NODE_EXEC_BARRIER_MS + 5000);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-proxy-test-'));
    homeDir = path.join(tmpDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.devflow'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeProxyJson(opts: {
    enabled: boolean;
    port: number;
    binPath?: string | null;
    configPath?: string | null;
  }) {
    const state = {
      version: 1,
      enabled: opts.enabled,
      port: opts.port,
      binPath: opts.binPath !== undefined ? opts.binPath : null,
      configPath: opts.configPath !== undefined ? opts.configPath : null,
      resolvedAt: new Date().toISOString(),
      devflowVersion: null,
    };
    fs.writeFileSync(
      path.join(homeDir, '.devflow', 'proxy.json'),
      JSON.stringify(state, null, 2),
    );
  }

  /** Bind an ephemeral listener (port 0), read the assigned port, close it, and return it. */
  async function allocateFreePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      });
      srv.on('error', reject);
    });
  }

  /**
   * D-PROXY-HERMETIC-PATH: the child env for a run whose binPath is null or stale.
   *
   * Such a run takes the hook's binPath re-resolution (D-FIX4), which looks for a
   * `devflow` CLI on PATH, walks up to its `node_modules/subswitch` and execs
   * `node -p` to read the bin field — then falls back to a `subswitch` on PATH.
   * The inherited PATH carries the developer's global `devflow` install and the
   * repo's own `node_modules/.bin/subswitch`, so without this the test reads the
   * developer's installation, heals binPath and lands on a different warning
   * than the one it names — and pays a `node` exec it never asked for (the exec
   * that met the D-PROXY-EXEC-BARRIER queue before that barrier existed).
   *
   * The returned PATH drops every directory that holds `devflow` or `subswitch`
   * and puts back only `node` (a symlink to this process's own binary), so the
   * hook still finds node and jq, and re-resolution fails the way it does on a
   * machine with neither installed — deterministically, with no node exec.
   */
  function withoutRelayResolvers(): Record<string, string> {
    const nodeOnlyBin = path.join(tmpDir, 'node-only-bin');
    fs.mkdirSync(nodeOnlyBin);
    fs.symlinkSync(process.execPath, path.join(nodeOnlyBin, 'node'));
    const kept = (process.env.PATH ?? '')
      .split(path.delimiter)
      .filter((dir) => dir !== '' && !['devflow', 'subswitch'].some((bin) => fs.existsSync(path.join(dir, bin))));
    return { PATH: [nodeOnlyBin, ...kept].join(path.delimiter) };
  }

  const SESSION_INPUT = {
    session_id: 'aa-bb-cc',
    cwd: os.tmpdir(),
    hooks_base_url: 'http://127.0.0.1:7777',
  };
  const PROMPT_INPUT = {
    session_id: 'aa-bb-cc',
    cwd: os.tmpdir(),
    hooks_base_url: 'http://127.0.0.1:7777',
    prompt: 'hello world',
  };

  // ── No-op paths ─────────────────────────────────────────────────────────────

  it('exits 0 silently when proxy.json is absent', () => {
    // No proxy.json written at all
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('exits 0 silently when proxy.json contains malformed JSON (TEST-6)', () => {
    // Regression: a corrupted proxy.json (partial write, manual edit) must never
    // crash the hook or emit any output. json_field_file returns the default value
    // ("false") when parsing fails, so PROXY_ENABLED!="true" → early silent exit.
    fs.writeFileSync(
      path.join(homeDir, '.devflow', 'proxy.json'),
      'not-json{{{',
    );
    const result = spawnSync('bash', [PROXY_HOOK], {
      input: JSON.stringify(SESSION_INPUT),
      env: { ...process.env, HOME: homeDir },
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('exits 0 silently when proxy is disabled', async () => {
    writeProxyJson({ enabled: false, port: await allocateFreePort() });
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('exits 0 silently when DEVFLOW_BG_UPDATER=1 (re-entrancy guard)', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort() });
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, {
      DEVFLOW_BG_UPDATER: '1',
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  // ── Always exits 0 (never blocks Claude Code) ────────────────────────────────

  it('always exits with code 0 regardless of state', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: null });
    const { exitCode } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, withoutRelayResolvers());
    expect(exitCode).toBe(0);
  });

  // ── Missing prerequisite paths ───────────────────────────────────────────────

  it('emits SessionStart additionalContext warning when binPath is null', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: null });
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, withoutRelayResolvers());
    expect(exitCode).toBe(0);
    // Should emit JSON envelope for the model context
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty('hookSpecificOutput');
    const output = parsed['hookSpecificOutput'] as Record<string, unknown>;
    expect((output['additionalContext'] as string)).toContain('[Devflow proxy]');
    expect((output['additionalContext'] as string)).toContain('relay binary not found');
    expect((output['additionalContext'] as string)).not.toContain('subswitch');
  });

  it('emits SessionStart warning when binPath points to nonexistent file', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: '/this/does/not/exist/relay.js' });
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, withoutRelayResolvers());
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const output = parsed['hookSpecificOutput'] as Record<string, unknown>;
    expect(output['additionalContext'] as string).toContain('[Devflow proxy]');
    expect(output['additionalContext'] as string).toContain('relay binary not found');
  });

  it('emits SessionStart warning when configPath is null (bin exists)', async () => {
    // Create a real file to act as the bin so the binPath check passes
    const fakeBin = path.join(tmpDir, 'fake-relay.js');
    fs.writeFileSync(fakeBin, '// fake relay');
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: fakeBin, configPath: null });
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const output = parsed['hookSpecificOutput'] as Record<string, unknown>;
    expect(output['additionalContext'] as string).toContain('[Devflow proxy]');
  });

  it('emits SessionStart warning when configPath points to nonexistent file', async () => {
    const fakeBin = path.join(tmpDir, 'fake-relay.js');
    fs.writeFileSync(fakeBin, '// fake relay');
    writeProxyJson({
      enabled: true,
      port: await allocateFreePort(),
      binPath: fakeBin,
      configPath: '/this/config/does/not/exist.json',
    });
    const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty('hookSpecificOutput');
  });

  // ── UserPromptSubmit silent path ─────────────────────────────────────────────

  it('exits 0 silently on UserPromptSubmit when port is down', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort() });
    const { exitCode, stdout } = runHook(PROXY_HOOK, PROMPT_INPUT, homeDir);
    expect(exitCode).toBe(0);
    // Silent — no output; SessionStart already warned
    expect(stdout).toBe('');
  });

  it('does not emit additionalContext on UserPromptSubmit regardless of state', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: null });
    const { stdout } = runHook(PROXY_HOOK, PROMPT_INPUT, homeDir);
    expect(stdout).toBe('');
  });

  // ── First-run: no proxy.log yet → no stderr ──────────────────────────────────

  it('emits no stderr on first run when proxy.log does not exist', async () => {
    // Use spawnSync so we can capture stderr even when the hook exits 0.
    // execSync does not expose stderr for successful invocations.
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: null });
    // Intentionally do NOT create $HOME/.devflow/logs/proxy.log
    const result = spawnSync('bash', [PROXY_HOOK], {
      input: JSON.stringify(SESSION_INPUT),
      env: { ...process.env, HOME: homeDir, ...withoutRelayResolvers() },
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  // ── Warning strings must not contain "subswitch" ──────────────────────────────

  it('warning messages never contain the internal package name "subswitch"', async () => {
    writeProxyJson({ enabled: true, port: await allocateFreePort(), binPath: null });
    const { stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, withoutRelayResolvers());
    expect(stdout).not.toContain('subswitch');
  });

  // ── Port-up fast-exit (ephemeral TCP server) ─────────────────────────────────

  describe('port-up paths (ephemeral TCP server)', () => {
    let server: net.Server;
    let listenPort: number;

    beforeAll(async () => {
      await new Promise<void>((resolve, reject) => {
        server = net.createServer((socket) => {
          // Accept and immediately close — we just need TCP accept for the probe
          socket.end();
        });
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          listenPort = typeof addr === 'object' && addr ? addr.port : 0;
          resolve();
        });
        server.on('error', reject);
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('exits 0 silently on UserPromptSubmit when port is UP', () => {
      // This describes the fast-exit path: port up + event=UserPromptSubmit → exit 0, no output
      let epTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-proxy-ep-'));
      const epHomeDir = path.join(epTmpDir, 'home');
      fs.mkdirSync(path.join(epHomeDir, '.devflow'), { recursive: true });
      const state = {
        version: 1,
        enabled: true,
        port: listenPort,
        binPath: null,
        configPath: null,
        resolvedAt: new Date().toISOString(),
        devflowVersion: null,
      };
      fs.writeFileSync(
        path.join(epHomeDir, '.devflow', 'proxy.json'),
        JSON.stringify(state),
      );
      try {
        const portInput = { ...PROMPT_INPUT };
        const { exitCode, stdout } = runHook(PROXY_HOOK, portInput, epHomeDir);
        expect(exitCode).toBe(0);
        expect(stdout).toBe('');
      } finally {
        fs.rmSync(epTmpDir, { recursive: true, force: true });
      }
    });

    it('exits 0 silently on SessionStart when port is UP and curl is absent — no spurious warning (CONS-4)', () => {
      // Regression test: before the fix, the hook called curl unconditionally; if curl was
      // absent from PATH, HEALTH_BODY="" fell through to the "*)" branch and emitted
      // a spurious "port occupied by another application" warning even when the relay was ours.
      // After the fix: "command -v curl" guards the health check; absent curl → assume ours,
      // exit 0 with no output.
      //
      // We build a controlled shadow bin directory containing every external command
      // the hook needs for the SessionStart + port-UP + curl-absent path, then set
      // PATH=shadowBin ONLY (no /bin suffix). The PATH restriction is required because
      // on Ubuntu (merged-usr) /bin is a symlink to /usr/bin which exposes /bin/curl;
      // adding /bin would let "command -v curl" succeed on Linux, defeating the test.
      //
      // Binaries we must symlink (all needed for this path):
      //   bash    — Node.js resolves 'bash' in spawnSync using the child's PATH (shadowBin);
      //             without bash in shadowBin, spawnSync fails with ENOENT before the
      //             hook even starts.
      //   dirname — for SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
      //   node    — for json-parse / json_field_file calls (or jq if node absent)
      //   cat     — for INPUT=$(cat); command substitution inherits stderr, so missing
      //             cat leaks "bash: cat: command not found" into result.stderr
      //   mkdir   — for "mkdir -p $LOG_DIR" (log directory creation); without it
      //             log() tries to open a file in a missing directory. On macOS bash 3.2
      //             a >> ENOENT on a missing parent terminates the process via signal
      //             (status=null) instead of a clean non-zero that || true can handle.
      //             On Linux bash 5.x it leaks to stderr.
      //   date    — for log() timestamp; $(date ...) inherits stderr, same as cat above.
      //
      // Binaries we deliberately omit:
      //   curl    — "command -v curl" must fail so the hook takes the "assume ours" path.
      //   stat    — only reached when LOG_FILE already exists; it won't on first run.
      //   tail/mv/rm — only in the log-truncation block (same gate as stat).

      const shadowBin = fs.mkdtempSync(path.join(os.tmpdir(), 'nocurl-bin-'));
      try {
        // Symlink bash — Node.js resolves 'bash' in spawnSync via the child env PATH;
        // with PATH=shadowBin, bash must be present or spawnSync itself fails with ENOENT.
        const bashR = spawnSync('which', ['bash'], { encoding: 'utf-8' });
        const bashPath = bashR.stdout.trim();
        if (bashPath) {
          try { fs.symlinkSync(bashPath, path.join(shadowBin, 'bash')); } catch { /* ok */ }
        }

        // Symlink dirname — needed for SCRIPT_DIR resolution (may be in /usr/bin, not /bin)
        const dirnameR = spawnSync('which', ['dirname'], { encoding: 'utf-8' });
        const dirnamePath = dirnameR.stdout.trim();
        if (dirnamePath) {
          try { fs.symlinkSync(dirnamePath, path.join(shadowBin, 'dirname')); } catch { /* ok */ }
        }

        // Symlink node or jq — needed for json-parse to be available (one is sufficient)
        const nodeR = spawnSync('which', ['node'], { encoding: 'utf-8' });
        const nodePath = nodeR.stdout.trim();
        if (nodePath) {
          try { fs.symlinkSync(nodePath, path.join(shadowBin, 'node')); } catch { /* ok */ }
        } else {
          const jqR = spawnSync('which', ['jq'], { encoding: 'utf-8' });
          const jqPath = jqR.stdout.trim();
          if (jqPath) {
            try { fs.symlinkSync(jqPath, path.join(shadowBin, 'jq')); } catch { /* ok */ }
          }
        }

        // Symlink cat — needed for INPUT=$(cat); command substitution inherits stderr so
        // a missing cat would leak "bash: cat: command not found" into result.stderr
        const catR = spawnSync('which', ['cat'], { encoding: 'utf-8' });
        const catPath = catR.stdout.trim();
        if (catPath) {
          try { fs.symlinkSync(catPath, path.join(shadowBin, 'cat')); } catch { /* ok */ }
        }

        // Symlink date — needed for log(); $(date ...) in log() also inherits stderr
        const dateR = spawnSync('which', ['date'], { encoding: 'utf-8' });
        const datePath = dateR.stdout.trim();
        if (datePath) {
          try { fs.symlinkSync(datePath, path.join(shadowBin, 'date')); } catch { /* ok */ }
        }

        // Symlink mkdir — needed for "mkdir -p $LOG_DIR" at the top of log setup; without
        // it the log directory is never created and the subsequent "echo >> $LOG_FILE" in
        // log() fails with ENOENT. On macOS bash 3.2 that failure terminates the process
        // via signal (status=null) rather than a clean non-zero exit that || true handles.
        const mkdirR = spawnSync('which', ['mkdir'], { encoding: 'utf-8' });
        const mkdirPath = mkdirR.stdout.trim();
        if (mkdirPath) {
          try { fs.symlinkSync(mkdirPath, path.join(shadowBin, 'mkdir')); } catch { /* ok */ }
        }

        // Deliberately DO NOT symlink curl → "command -v curl" will fail inside the hook

        writeProxyJson({ enabled: true, port: listenPort });

        const result = spawnSync('bash', [PROXY_HOOK], {
          input: JSON.stringify(SESSION_INPUT),
          // PATH=shadowBin only: all needed binaries are symlinked above; curl deliberately
          // omitted so "command -v curl" fails. No /bin suffix — on Linux merged-usr /bin
          // is /usr/bin, which exposes /bin/curl and would defeat the test.
          env: { ...process.env, HOME: homeDir, PATH: shadowBin },
          encoding: 'utf-8',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(''); // no spurious "port occupied" warning
        expect(result.stderr).toBe('');
      } finally {
        fs.rmSync(shadowBin, { recursive: true, force: true });
      }
    });
  });

  // ── HTTP health body identity check (key-order-independent parse) ────────────
  //
  // Regression: the old case *'"name":"subswitch"'* pattern required the "name"
  // key to appear first in the JSON body. The fixed code uses json_field which
  // parses key-order-independently via jq or node.
  //
  // CONS-5: health body with reordered fields must still match as "ours".
  //
  // Implementation note: runHook uses execSync, which blocks Node.js's event loop.
  // An in-process http.createServer would be starved and unable to respond while
  // execSync is running. The HTTP stub is spawned as a SEPARATE child process
  // so it has its own event loop and can respond to curl independently.

  it('CONS-5: recognizes relay identity when "name" field is not first in health body', async () => {
    const port = await allocateFreePort();

    // Write a minimal HTTP server that returns the health body with "name" LAST.
    // Old pattern *'"name":"subswitch"'* fails this body; json_field parse succeeds.
    const stubScript = path.join(tmpDir, 'http-health-stub.js');
    fs.writeFileSync(
      stubScript,
      [
        "const http = require('http');",
        `http.createServer((_req, res) => {`,
        // Deliberately put "version" and "providers" BEFORE "name" so the old
        // *'"name":"subswitch"'* substring match would fail (key-order-dependent).
        `  const body = JSON.stringify({version:'0.2.0',providers:[],name:'subswitch'});`,
        `  res.writeHead(200, {'Content-Type':'application/json'});`,
        `  res.end(body);`,
        `}).listen(${port}, '127.0.0.1');`,
      ].join('\n'),
    );

    // Spawn the stub in a separate process so it has its own event loop
    // (execSync in runHook would starve an in-process http.Server).
    const stubProc = spawn(process.execPath, [stubScript], {
      detached: true,
      stdio: 'ignore',
    });
    stubProc.unref();
    const stubPid = stubProc.pid ?? null;

    try {
      // Wait for the HTTP server to be up (TCP probe, max 3s)
      const deadline = Date.now() + 3000;
      let up = false;
      while (Date.now() < deadline) {
        try {
          execSync(`bash -c '(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null'`, { timeout: 500 });
          up = true;
          break;
        } catch { /* not yet */ }
        await new Promise<void>((r) => setTimeout(r, 50));
      }
      expect(up, `HTTP stub did not come up on port ${port}`).toBe(true);

      writeProxyJson({ enabled: true, port });
      const { exitCode, stdout } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir);
      expect(exitCode).toBe(0);
      // No "port occupied" warning — relay identity correctly recognized via json_field parse
      expect(stdout).toBe('');
    } finally {
      if (stubPid !== null) {
        try { process.kill(stubPid, 'SIGTERM'); } catch { /* already gone */ }
        try { process.kill(stubPid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  });

  // ── Relay spawn path (stub relay) ────────────────────────────────────────────

  describe('relay spawn path (stub relay binds the port)', () => {
    let spawnedPid: number | null = null;

    afterEach(async () => {
      // The hook spawns a detached, disowned process — the test owns its teardown.
      // SIGTERM → 200ms async sleep → SIGKILL to avoid leaving orphaned relay processes
      // that corrupt subsequent test runs (observed: 3 leaked processes per suite).
      if (spawnedPid !== null) {
        const pid = spawnedPid;
        spawnedPid = null;
        try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
        // Yield to the event loop while waiting for the process to exit cleanly.
        await new Promise<void>((r) => setTimeout(r, 200));
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
        // Verify termination — log a warning rather than throwing so afterEach always completes.
        try {
          process.kill(pid, 0);
          console.warn(`[shell-hooks afterEach] relay PID ${pid} survived SIGKILL — may leak`);
        } catch { /* expected: process is gone */ }
      }
    });

    /**
     * Write a stub relay that mimics the one contract the spawn path depends on:
     * read the port from $SUBSWITCH_CONFIG and accept TCP on it. Invoked by the
     * hook as `node <binPath> serve`.
     */
    function writeStubRelay(): string {
      const binPath = path.join(tmpDir, 'stub-relay.js');
      fs.writeFileSync(
        binPath,
        [
          "const net = require('net');",
          "const fs = require('fs');",
          "const cfg = JSON.parse(fs.readFileSync(process.env.SUBSWITCH_CONFIG, 'utf-8'));",
          'net.createServer((s) => s.end()).listen(cfg.port, "127.0.0.1");',
        ].join('\n'),
      );
      return binPath;
    }

    function writeRoutingConfig(port: number): string {
      const configPath = path.join(tmpDir, 'proxy-routing.json');
      fs.writeFileSync(configPath, buildRoutingConfigJson(port));
      return configPath;
    }

    it('spawns the relay on SessionStart when the port is down, and exits 0 silently', async () => {
      const port = await allocateFreePort();
      writeProxyJson({
        enabled: true,
        port,
        binPath: writeStubRelay(),
        configPath: writeRoutingConfig(port),
      });

      const { exitCode, stdout, stderr } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir);

      const pidFile = path.join(homeDir, '.devflow', 'proxy.pid');
      if (fs.existsSync(pidFile)) {
        spawnedPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      }

      // Relay came up within the bounded wait → no warning is emitted.
      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toBe('');
    });

    it('writes proxy.pid with the live relay pid so --status can report the process', async () => {
      const port = await allocateFreePort();
      writeProxyJson({
        enabled: true,
        port,
        binPath: writeStubRelay(),
        configPath: writeRoutingConfig(port),
      });

      runHook(PROXY_HOOK, SESSION_INPUT, homeDir);

      // Read and register PID BEFORE any assertions so afterEach can always kill it.
      // If we set spawnedPid after an assertion that throws, the relay leaks.
      const pidFile = path.join(homeDir, '.devflow', 'proxy.pid');
      const rawPid = fs.existsSync(pidFile)
        ? parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
        : NaN;
      if (!Number.isNaN(rawPid) && rawPid > 0) {
        spawnedPid = rawPid; // registered before any assertions
      }

      expect(fs.existsSync(pidFile)).toBe(true);
      expect(Number.isInteger(rawPid)).toBe(true);
      expect(rawPid).toBeGreaterThan(0);
      // The recorded pid must be the live relay — the same liveness probe --status uses.
      expect(() => process.kill(rawPid, 0)).not.toThrow();
    });

    it('releases the spawn lock after a successful start', async () => {
      const port = await allocateFreePort();
      writeProxyJson({
        enabled: true,
        port,
        binPath: writeStubRelay(),
        configPath: writeRoutingConfig(port),
      });

      runHook(PROXY_HOOK, SESSION_INPUT, homeDir);

      const pidFile = path.join(homeDir, '.devflow', 'proxy.pid');
      if (fs.existsSync(pidFile)) {
        spawnedPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      }

      // A retained lock would make every later session take the "starting elsewhere" path.
      expect(fs.existsSync(path.join(homeDir, '.devflow', '.proxy-spawn.lock'))).toBe(false);
    });

    // C2-SEC-1 regression: the relay spawn must use an env allowlist, not a denylist.
    // Before the fix, `nohup env -u ANTHROPIC_API_KEY` spread the full parent env so
    // every secret the shell had exported (SSH_AUTH_SOCK, OPENAI_API_KEY, etc.) reached
    // the third-party routing runtime. The fix converts to `env -i` with 5+1 explicit
    // vars (PATH, HOME, TMPDIR, LANG, LC_ALL, SUBSWITCH_CONFIG).
    //
    // Strategy: pass canary vars via extraEnv to the hook process, then have a
    // custom stub relay capture its own process.env to a file BEFORE binding the
    // port (so the file is written by the time the hook's TCP probe succeeds).
    // Assert both canary vars are absent from the relay's captured environment.
    it('C2-SEC-1: spawned relay does not receive canary env vars (SSH_AUTH_SOCK, OPENAI_API_KEY)', async () => {
      const port = await allocateFreePort();
      const envCapturePath = path.join(tmpDir, 'relay-env.json');

      // Stub relay: capture env to file synchronously, then bind.
      // Writing env before listen() guarantees the file exists by the time the
      // hook's TCP probe sees the port as up (probe only succeeds after listen()).
      const binPath = path.join(tmpDir, 'env-capture-relay.js');
      fs.writeFileSync(
        binPath,
        [
          "const net = require('net');",
          "const fs = require('fs');",
          'const cfg = JSON.parse(fs.readFileSync(process.env.SUBSWITCH_CONFIG, "utf-8"));',
          `fs.writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify(process.env));`,
          'net.createServer((s) => s.end()).listen(cfg.port, "127.0.0.1");',
        ].join('\n'),
      );

      writeProxyJson({
        enabled: true,
        port,
        binPath,
        configPath: writeRoutingConfig(port),
      });

      // Pass canary vars into the hook's environment — they must NOT reach the relay.
      const { exitCode } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, {
        SSH_AUTH_SOCK: '/tmp/test-canary-ssh-auth.sock',
        OPENAI_API_KEY: 'sk-test-canary-0000',
      });

      // Register pid for afterEach cleanup before any assertions.
      const pidFile = path.join(homeDir, '.devflow', 'proxy.pid');
      if (fs.existsSync(pidFile)) {
        spawnedPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      }

      expect(exitCode).toBe(0);
      expect(fs.existsSync(envCapturePath), 'relay env capture file must exist').toBe(true);

      const relayEnv = JSON.parse(fs.readFileSync(envCapturePath, 'utf-8')) as Record<string, string>;
      // Both canary vars must be absent — the allowlist does not include them.
      expect(
        Object.prototype.hasOwnProperty.call(relayEnv, 'SSH_AUTH_SOCK'),
        'SSH_AUTH_SOCK must be absent from relay env (allowlist enforced)',
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(relayEnv, 'OPENAI_API_KEY'),
        'OPENAI_API_KEY must be absent from relay env (allowlist enforced)',
      ).toBe(false);
    });

    // NODE_EXTRA_CA_CERTS corporate-TLS pass-through: the bash hook's _RELAY_ENV
    // must forward this var to the relay when set so corporate-TLS deployments can
    // supply a CA bundle.
    //
    // Prove this test can fail: before adding the conditional _RELAY_ENV append to
    // ensure-proxy, the relay env does not contain NODE_EXTRA_CA_CERTS → the
    // expect(relayEnv['NODE_EXTRA_CA_CERTS']).toBe(expectedBundle) assertion fails.
    it('NODE_EXTRA_CA_CERTS is forwarded to spawned relay when set in hook env', async () => {
      const port = await allocateFreePort();
      const envCapturePath = path.join(tmpDir, 'relay-env-ca.json');
      const expectedBundle = '/tmp/devflow-test-ca-bundle.crt';

      // Stub relay: capture env to file synchronously, then bind.
      // File is written before listen() so it exists when the hook's TCP probe sees the port up.
      const binPath = path.join(tmpDir, 'env-capture-relay-ca.js');
      fs.writeFileSync(
        binPath,
        [
          "const net = require('net');",
          "const fs = require('fs');",
          'const cfg = JSON.parse(fs.readFileSync(process.env.SUBSWITCH_CONFIG, "utf-8"));',
          `fs.writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify(process.env));`,
          'net.createServer((s) => s.end()).listen(cfg.port, "127.0.0.1");',
        ].join('\n'),
      );

      writeProxyJson({
        enabled: true,
        port,
        binPath,
        configPath: writeRoutingConfig(port),
      });

      // Pass NODE_EXTRA_CA_CERTS into the hook's environment — must reach the relay.
      const { exitCode } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, {
        NODE_EXTRA_CA_CERTS: expectedBundle,
      });

      // Register pid for afterEach cleanup before any assertions.
      const pidFile = path.join(homeDir, '.devflow', 'proxy.pid');
      if (fs.existsSync(pidFile)) {
        spawnedPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      }

      expect(exitCode).toBe(0);
      expect(
        fs.existsSync(envCapturePath),
        'relay env capture file must exist',
      ).toBe(true);

      const relayEnv = JSON.parse(
        fs.readFileSync(envCapturePath, 'utf-8'),
      ) as Record<string, string>;
      expect(
        relayEnv['NODE_EXTRA_CA_CERTS'],
        'NODE_EXTRA_CA_CERTS must be forwarded to relay env (corporate TLS)',
      ).toBe(expectedBundle);
    });

    it('NODE_OPTIONS is excluded from spawned relay env even when set in hook env', async () => {
      const port = await allocateFreePort();
      const envCapturePath = path.join(tmpDir, 'relay-env-nodeopt.json');

      const binPath = path.join(tmpDir, 'env-capture-relay-nodeopt.js');
      fs.writeFileSync(
        binPath,
        [
          "const net = require('net');",
          "const fs = require('fs');",
          'const cfg = JSON.parse(fs.readFileSync(process.env.SUBSWITCH_CONFIG, "utf-8"));',
          `fs.writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify(process.env));`,
          'net.createServer((s) => s.end()).listen(cfg.port, "127.0.0.1");',
        ].join('\n'),
      );

      writeProxyJson({
        enabled: true,
        port,
        binPath,
        configPath: writeRoutingConfig(port),
      });

      // Pass NODE_OPTIONS into the hook's env — must NOT reach the relay.
      const { exitCode } = runHook(PROXY_HOOK, SESSION_INPUT, homeDir, {
        NODE_OPTIONS: '--require /tmp/evil.js',
      });

      const pidFile = path.join(homeDir, '.devflow', 'proxy.pid');
      if (fs.existsSync(pidFile)) {
        spawnedPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      }

      expect(exitCode).toBe(0);
      expect(
        fs.existsSync(envCapturePath),
        'relay env capture file must exist',
      ).toBe(true);

      const relayEnv = JSON.parse(
        fs.readFileSync(envCapturePath, 'utf-8'),
      ) as Record<string, string>;
      expect(
        Object.prototype.hasOwnProperty.call(relayEnv, 'NODE_OPTIONS'),
        'NODE_OPTIONS must be absent from relay env (prevents arbitrary code execution via --require/--import)',
      ).toBe(false);
    });
  });

  // ── FIX 4 (issue #313): stale binPath re-resolution ─────────────────────────
  //
  // When proxy.json exists with enabled:true but the stored binPath is absent
  // (e.g., npx cache GC cleared the subswitch package), the hook must attempt
  // re-resolution before emitting the "relay binary not found" warning.
  //
  // Every run here uses withoutRelayResolvers() (D-PROXY-HERMETIC-PATH): node is
  // on PATH, so json-parse is always available (jq or its node fallback) and the
  // hook reaches the re-resolution branch on every platform — a bare
  // `/usr/bin:/bin` PATH reached it only where the OS ships /usr/bin/jq, and on a
  // host without jq or node there the hook exited at the json-parse gate and
  // every assertion below held vacuously. No `devflow` is on PATH either, so
  // strategy a (the devflow walk) cannot heal from the developer's install and
  // mask strategy b. Each test asserts the branch it names, unconditionally.

  describe('FIX 4 — stale binPath re-resolution (issue #313)', () => {
    /** The SessionStart additionalContext the hook printed; fails the test when there is none. */
    function sessionContext(stdout: string): string {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const output = parsed['hookSpecificOutput'] as Record<string, unknown>;
      expect(output, 'hook printed no hookSpecificOutput').toBeDefined();
      return output['additionalContext'] as string;
    }

    it('always exits 0 when binPath is stale (regression: no crash)', async () => {
      // Base case: stale path + re-resolution fails (no devflow/subswitch in PATH)
      // → hook falls through to warning and exits 0 (same as before fix).
      writeProxyJson({
        enabled: true,
        port: await allocateFreePort(),
        binPath: '/this/stale/path/does/not/exist/relay.js',
      });
      const result = spawnSync('bash', [PROXY_HOOK], {
        input: JSON.stringify(SESSION_INPUT),
        env: { ...process.env, HOME: homeDir, ...withoutRelayResolvers() },
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0); // must always exit 0
      // The branch was reached, not skipped at the json-parse gate.
      expect(sessionContext(result.stdout)).toContain('relay binary not found');
    });

    it('emits relay-binary-not-found warning when re-resolution fails', async () => {
      writeProxyJson({
        enabled: true,
        port: await allocateFreePort(),
        binPath: '/stale/relay.js',
      });
      const result = spawnSync('bash', [PROXY_HOOK], {
        input: JSON.stringify(SESSION_INPUT),
        env: { ...process.env, HOME: homeDir, ...withoutRelayResolvers() },
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      const context = sessionContext(result.stdout);
      expect(context).toContain('[Devflow proxy]');
      expect(context).toContain('relay binary not found');
      const log = fs.readFileSync(path.join(homeDir, '.devflow', 'logs', 'proxy.log'), 'utf-8');
      expect(log).toContain('re-resolution failed');
    });

    it('heals (exits 0, no binary warning) when strategy-b finds subswitch via PATH', async () => {
      // A fake subswitch in a shadow bin directory. It is never run: with no
      // configPath the hook stops at the config prerequisite right after the heal.
      const fakeBinDir = path.join(tmpDir, 'shadow-bin');
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeSubswitch = path.join(fakeBinDir, 'subswitch');
      fs.writeFileSync(fakeSubswitch, '#!/bin/sh\nexec true\n');
      fs.chmodSync(fakeSubswitch, '0755');

      writeProxyJson({
        enabled: true,
        port: await allocateFreePort(),
        binPath: '/stale/relay.js', // non-existent stored path
      });

      // The hermetic PATH (node, no devflow) with the shadow dir in front, so
      // strategy b is the only one that can heal.
      const hermetic = withoutRelayResolvers();
      const result = spawnSync('bash', [PROXY_HOOK], {
        input: JSON.stringify(SESSION_INPUT),
        env: { ...process.env, HOME: homeDir, PATH: `${fakeBinDir}${path.delimiter}${hermetic.PATH}` },
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      // Past the binPath check: the next prerequisite (configPath) is what warns.
      const context = sessionContext(result.stdout);
      expect(context).not.toContain('relay binary not found');
      expect(context).toContain('routing config not found');
      const log = fs.readFileSync(path.join(homeDir, '.devflow', 'logs', 'proxy.log'), 'utf-8');
      expect(log).toContain(`re-resolved binPath via command -v subswitch: ${fakeSubswitch}`);
    });
  });
});
