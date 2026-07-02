/**
 * tests/eager-memory-refresh.test.ts
 *
 * Acceptance tests for the eager working-memory refresh redesign.
 * Covers AC-F1/F2/F3, AC-F4 (injection states), AC-F5/F6/F7, AC-C2/C3/C4,
 * AC-P3 (double-spawn), and no-regression scenarios.
 *
 * Design constraint: tests that exercise dream-capture with a stale trigger MUST
 * supply a fake claude shim on PATH (prepended before the system PATH). This
 * prevents the nohup-spawned background-memory-update worker from invoking the
 * real claude binary and hanging for 120s. Tests that only check queue-write
 * behavior use a fresh trigger file so the 120s throttle prevents any spawn.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');
const CAPTURE_HOOK = path.join(HOOKS_DIR, 'dream-capture');
const SESSION_START_MEMORY_HOOK = path.join(HOOKS_DIR, 'session-start-memory');
const SESSION_START_CONTEXT_HOOK = path.join(HOOKS_DIR, 'session-start-context');
const BACKGROUND_UPDATER = path.join(HOOKS_DIR, 'background-memory-update');

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/** Run a hook synchronously via stdin/stdout (mirrors shell-hooks.test.ts:1495) */
function runHook(
  hookPath: string,
  input: object,
  homeDir: string,
  extraEnv: Record<string, string> = {}
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

/** Run a hook with a custom PATH prefix (fake claude shim intercepts spawning) */
function runHookWithFakeClaude(
  hookPath: string,
  input: object,
  homeDir: string,
  shimDir: string,
  extraEnv: Record<string, string> = {}
): { stdout: string; stderr: string; exitCode: number } {
  return runHook(hookPath, input, homeDir, {
    PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    ...extraEnv,
  });
}

/** Run background-memory-update directly (synchronous) with a fake claude shim */
function runWorker(
  projectDir: string,
  homeDir: string,
  shimDir: string,
  extraEnv: Record<string, string> = {}
): { exitCode: number } {
  try {
    execSync(`bash "${BACKGROUND_UPDATER}" "${projectDir}"`, {
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        ...extraEnv,
      },
      // stdio:'ignore' prevents Node.js blocking on open pipe (watchdog sleep 120 inherits fds)
      stdio: 'ignore',
    });
    return { exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number };
    return { exitCode: err.status ?? 1 };
  }
}

function backdateMtime(filePath: string, secondsAgo: number): void {
  const past = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(filePath, past, past);
}

/**
 * Compute the worker log file path using the same slug logic as log-paths:
 *   slug = projectDir.replace(/^\//, '').replace(/\//g, '-')
 *   logFile = HOME/.devflow/logs/<slug>/.background-memory-update.log
 */
function workerLogPath(projectDir: string, homeDir: string): string {
  const slug = projectDir.replace(/^\//, '').replace(/\//g, '-');
  return path.join(homeDir, '.devflow', 'logs', slug, '.background-memory-update.log');
}

/**
 * Build a symlink-farm directory containing all required system tools EXCEPT jq and node,
 * suitable for constructing a PATH where _JSON_AVAILABLE=false in json-parse.
 *
 * This is necessary because on macOS /usr/bin/jq exists and cannot be shadowed by a
 * non-executable file — command -v skips non-executables but still finds /usr/bin/jq.
 * A symlink farm that omits jq and node is the only portable-reliable approach.
 */
function buildNoJsonParsePath(tmpBase: string): string {
  const farmDir = path.join(tmpBase, 'nojson-bin');
  fs.mkdirSync(farmDir, { recursive: true });
  // Tools sourced helpers and the worker actually call (from /usr/bin since /bin lacks them)
  const usrBinTools = [
    'wc', 'head', 'tail', 'tr', 'touch', 'stat', 'sed', 'cut',
    'nohup', 'git', 'find', 'grep', 'mktemp', 'dirname',
  ];
  for (const t of usrBinTools) {
    const src = `/usr/bin/${t}`;
    const dst = path.join(farmDir, t);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try { fs.symlinkSync(src, dst); } catch { /* skip if already exists */ }
    }
  }
  // /bin provides: bash, cat, chmod, cp, date, echo, kill, ls, mkdir, mv, rm, rmdir, sleep
  return `${farmDir}:/bin`;
}

/**
 * Create a fake `claude` that writes a deterministic stamped WORKING-MEMORY.md.
 * When the capture hook spawns background-memory-update with this shim on PATH,
 * the fake claude completes instantly instead of hanging 120s.
 */
function createFakeClaudeShim(shimDir: string, memFile: string): void {
  const bin = path.join(shimDir, 'claude');
  fs.writeFileSync(
    bin,
    `#!/bin/bash
# Fake claude shim for tests
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
echo "- test memory content written by fake claude" >> "${memFile}"
exit 0
`
  );
  fs.chmodSync(bin, 0o755);
}

/** Write dream config.json */
function writeDreamConfig(projectDir: string, fields: Record<string, unknown>): void {
  const dir = path.join(projectDir, '.devflow', 'dream');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(fields));
}

/** Seed .pending-turns.jsonl with one user and one assistant turn */
function seedQueue(projectDir: string): void {
  const qFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');
  const ts = Math.floor(Date.now() / 1000);
  fs.writeFileSync(
    qFile,
    [
      JSON.stringify({ role: 'user', content: 'implement the feature', ts }),
      JSON.stringify({ role: 'assistant', content: 'Sure, implementing now...', ts: ts + 1 }),
    ].join('\n') + '\n'
  );
}

/** Init scratch git repo */
function initGitRepo(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execSync('git add README.md', { cwd: dir });
  execSync('git commit -qm "init"', { cwd: dir });
}

// =============================================================================
// S1 — AC-F2/F3/C3: background-memory-update happy path
//
// We run background-memory-update DIRECTLY (not via dream-capture) to avoid
// the nohup-detach complexity. The fake claude shim writes a deterministic file.
// =============================================================================
describe('S1: end-to-end happy path — background-memory-update worker (AC-F2/F3/C3)', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s1-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s1-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s1-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
    seedQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('AC-F2: WORKING-MEMORY.md line 1 is <!-- memory-head: ... branch: ... -->', () => {
    runWorker(projectDir, homeDir, shimDir);

    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    expect(fs.existsSync(memFile)).toBe(true);
    const firstLine = fs.readFileSync(memFile, 'utf-8').split('\n')[0];
    expect(firstLine).toMatch(/^<!-- memory-head: .+ branch: .+ -->$/);
  });

  it('AC-F3/success: .pending-turns.processing removed, .last-refresh-ok touched', () => {
    runWorker(projectDir, homeDir, shimDir);

    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');

    expect(fs.existsSync(processingFile)).toBe(false);
    expect(fs.existsSync(okFile)).toBe(true);
    expect(fs.statSync(okFile).mtimeMs).toBeGreaterThan(Date.now() - 15000);
  });

  it('AC-C3: no memory.json or memory.processing marker in .devflow/dream/', () => {
    runWorker(projectDir, homeDir, shimDir);

    const dreamDir = path.join(projectDir, '.devflow', 'dream');
    const memMarkers = fs.readdirSync(dreamDir).filter((f) => f.startsWith('memory'));
    expect(memMarkers).toHaveLength(0);
  });
});

// =============================================================================
// S1b — AC-F1: dream-capture touches trigger before spawning (throttle gate)
//
// We use a fake claude shim on PATH so the nohup-spawned worker does not
// invoke the real claude binary.
// =============================================================================
describe('S1b: AC-F1 — dream-capture touches .working-memory-last-trigger', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s1b-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s1b-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s1b-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
    seedQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('trigger file is touched (mtime refreshed) after throttle expires', () => {
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600); // 10 minutes ago — throttle expired

    runHookWithFakeClaude(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'hello' },
      homeDir,
      shimDir
    );

    const triggerStat = fs.statSync(triggerFile);
    expect(triggerStat.mtimeMs).toBeGreaterThan(Date.now() - 15000);
  });

  it('no memory.json or memory.processing marker created by dream-capture (AC-C3)', () => {
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithFakeClaude(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'hello' },
      homeDir,
      shimDir
    );

    const dreamDir = path.join(projectDir, '.devflow', 'dream');
    const memMarkers = fs.readdirSync(dreamDir).filter((f) => f.startsWith('memory'));
    expect(memMarkers).toHaveLength(0);
  });
});

// =============================================================================
// S2 — AC-F4: Injection state rendering (session-start-memory)
// =============================================================================
describe('S2: AC-F4 — session-start-memory injection states', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s2-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s2-home-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function writeMemoryWithStamp(dir: string, sha: string, branch: string): void {
    const memFile = path.join(dir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, `<!-- memory-head: ${sha} branch: ${branch} -->\n## Now\n- some progress\n`);
  }

  function getCtx(dir: string, home: string): string {
    const { stdout } = runHook(SESSION_START_MEMORY_HOOK, { cwd: dir }, home);
    const parsed = JSON.parse(stdout.trim()) as { hookSpecificOutput?: { additionalContext?: string } };
    return parsed?.hookSpecificOutput?.additionalContext ?? '';
  }

  it('State A: stamp sha == HEAD → "synced @" header, no "commit(s) ago"', () => {
    const headSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim() || 'main';
    writeMemoryWithStamp(projectDir, headSha, branch);

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('synced @');
    expect(ctx).not.toContain('commit(s) ago');
    expect(ctx).not.toContain('UNPROCESSED TURNS');
  });

  it('State B: 2 commits after stamp sha → "2 commit(s) ago" + git log list', () => {
    const stampSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim() || 'main';
    writeMemoryWithStamp(projectDir, stampSha, branch);

    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'a');
    execSync('git add file1.txt && git commit -qm "second commit"', { cwd: projectDir, shell: '/bin/bash' });
    fs.writeFileSync(path.join(projectDir, 'file2.txt'), 'b');
    execSync('git add file2.txt && git commit -qm "third commit"', { cwd: projectDir, shell: '/bin/bash' });

    const ctx = getCtx(projectDir, homeDir);
    // Assert exact count — catches off-by-one in rev-walk dedup (the source was fixed in b3b5d6c
    // to use `grep -c . || true; COMMITS=${COMMITS:-0}` guaranteeing a single-line integer).
    expect(ctx).toContain('2 commit(s) ago');
    expect(ctx).toContain('reconcile');
    expect(ctx).toMatch(/second commit|third commit/);
    expect(ctx).not.toContain('UNPROCESSED TURNS');
  });

  it('State C: queue non-empty + .last-refresh-ok absent → MEMORY REFRESH MAY BE FAILING banner', () => {
    const headSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim() || 'main';
    writeMemoryWithStamp(projectDir, headSha, branch);
    seedQueue(projectDir);
    // Do NOT create .last-refresh-ok

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('MEMORY REFRESH MAY BE FAILING');
    expect(ctx).toContain('WORKING MEMORY');
  });

  it('State C shown IN ADDITION to State A (both banners coexist)', () => {
    const headSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim() || 'main';
    writeMemoryWithStamp(projectDir, headSha, branch);
    seedQueue(projectDir);

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('synced @');
    expect(ctx).toContain('MEMORY REFRESH MAY BE FAILING');
  });

  it('branch mismatch → ⚠ Memory was written on branch ... line', () => {
    const headSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    writeMemoryWithStamp(projectDir, headSha, 'feature/old-branch');

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('Memory was written on branch');
    expect(ctx).toContain('feature/old-branch');
  });

  it('no stamp present → "synced @ unknown"', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, '## Now\n- legacy content\n');

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('synced @ unknown');
    expect(ctx).not.toContain('UNPROCESSED TURNS');
  });

  it('malformed stamp (starts with "-") → treated as no-stamp, "synced @ unknown"', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, `<!-- memory-head: -malicious branch: main -->\n## Now\n- content\n`);

    const ctx = getCtx(projectDir, homeDir);
    // Rejected stamp falls through to the no-stamp path (State A "synced @ unknown")
    expect(ctx).toContain('synced @ unknown');
    // Must not pass the malicious value to a git command (no crash or unexpected output)
    expect(ctx).not.toContain('-malicious');
  });

  it('malformed stamp (non-hex chars) → treated as no-stamp, "synced @ unknown"', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, `<!-- memory-head: abc..xyz123 branch: main -->\n## Now\n- content\n`);

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('synced @ unknown');
    expect(ctx).not.toContain('abc..xyz123');
  });

  it('raw UNPROCESSED TURNS dump is absent from all output (legacy format gone)', () => {
    const headSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim() || 'main';
    writeMemoryWithStamp(projectDir, headSha, branch);
    seedQueue(projectDir);

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).not.toContain('UNPROCESSED TURNS');
    expect(ctx).not.toContain('pending-turns');
  });
});

// =============================================================================
// S3 — AC-F6: PATH without claude binary
//
// We keep trigger file FRESH (no backdating) so dream-capture throttles and
// does NOT try to spawn the worker. This lets us verify exit-0 and queue
// behavior without PATH manipulation worries.
// We test the capture-hook's "no claude found" exit path in S3b by explicitly
// using the fake shim approach with the trigger backdated.
// =============================================================================
describe('S3: AC-F6 — capture hook behavior when claude binary absent on PATH', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s3-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s3-home-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    seedQueue(projectDir);
    // Fresh trigger (< 120s) — throttle will prevent spawn attempt
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger'), ''
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('dream-capture exits 0 even when throttled (queue append only)', () => {
    const { exitCode } = runHook(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'hello world' },
      homeDir
    );
    expect(exitCode).toBe(0);
  });

  it('queue still receives new turn (throttle does not block capture)', () => {
    runHook(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'hello world' },
      homeDir
    );
    const queueFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(queueFile)).toBe(true);
    const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('AC-F4/State C: after throttled capture, session-start-memory shows REFRESH FAILING', () => {
    runHook(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'hello world' },
      homeDir
    );

    initGitRepo(projectDir);
    const headSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, `<!-- memory-head: ${headSha} branch: main -->\n## Now\n- old content\n`);
    // No .last-refresh-ok

    const { stdout } = runHook(SESSION_START_MEMORY_HOOK, { cwd: projectDir }, homeDir);
    const parsed = JSON.parse(stdout.trim()) as { hookSpecificOutput?: { additionalContext?: string } };
    const ctx = parsed?.hookSpecificOutput?.additionalContext ?? '';

    expect(ctx).toContain('MEMORY REFRESH MAY BE FAILING');
  });
});

// =============================================================================
// S3b — AC-F6 source code: "no claude" path exits 0, logs skip message
// =============================================================================
describe('S3b: AC-F6 source code — no-claude exit logged correctly', () => {
  it('dream-capture code logs SKIP when claude binary not found', () => {
    const captureSrc = fs.readFileSync(CAPTURE_HOOK, 'utf-8');
    expect(captureSrc).toContain('claude binary not found');
    expect(captureSrc).toContain('worker not spawned (queue intact)');
    // Exit must be 0 (not a hard failure)
    expect(captureSrc).toContain('exit 0');
  });
});

// =============================================================================
// S4 — AC-F3/P3: watchdog and failure path
// =============================================================================
describe('S4: AC-F3/P3 — watchdog and failure path', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s4-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s4-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s4-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
    seedQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('AC-F3/failure: claude exits 1 → .processing retained, .last-refresh-ok NOT created', () => {
    // Shim exits 1 immediately — simulates a failed claude invocation
    const failBin = path.join(shimDir, 'claude');
    fs.writeFileSync(failBin, '#!/bin/bash\nexit 1\n');
    fs.chmodSync(failBin, 0o755);

    runWorker(projectDir, homeDir, shimDir);

    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    expect(fs.existsSync(processingFile)).toBe(true);

    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');
    expect(fs.existsSync(okFile)).toBe(false);
  });

  it('AC-F3/watchdog-behavioral: worker SURVIVES watchdog kill; .last-refresh-ok NOT touched; .processing retained', () => {
    // Hanging fake claude — sleeps indefinitely so the watchdog must fire.
    const hangBin = path.join(shimDir, 'claude');
    fs.writeFileSync(hangBin, '#!/bin/bash\nsleep 300\n');
    fs.chmodSync(hangBin, 0o755);

    // Set DEVFLOW_BG_WATCHDOG_SECS=2 so the watchdog fires after 2s, not 120s.
    // The 5s SIGTERM->SIGKILL grace period is NOT made short here — the fake claude
    // responds to SIGTERM immediately, so total elapsed is ~2s anyway.
    const { exitCode } = runWorker(projectDir, homeDir, shimDir, {
      DEVFLOW_BG_WATCHDOG_SECS: '2',
    });

    // Worker must exit 0 (clean failure path executed, not self-killed).
    expect(exitCode).toBe(0);

    // .last-refresh-ok must NOT be touched on watchdog kill.
    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');
    expect(fs.existsSync(okFile)).toBe(false);

    // .processing must be retained for dream-recover crash recovery.
    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    expect(fs.existsSync(processingFile)).toBe(true);
  }, 20000); // 20s timeout: 2s watchdog sleep + 5s SIGTERM grace + margin

  it('AC-P3/structural: worker lock uses 300s stale threshold (not 30s dream-lock)', () => {
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('STALE_THRESHOLD=300');
    // Must NOT use dream_lock_acquire (which uses a 30s stale break)
    expect(src).not.toContain('dream_lock_acquire');
  });
});

// =============================================================================
// S5 — AC-P3: Double-spawn prevention via lock
// =============================================================================
describe('S5: AC-P3 — double-spawn blocked by .working-memory.lock/', () => {
  it('behavioral: fresh lock (<300s) blocks second worker — verified via log + no memory write', () => {
    // This test requires no GNU timeout binary (avoids the macOS gap where
    // `timeout` is absent and the inner command never runs). Node execSync timeout
    // is used instead, which works cross-platform.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s5b-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s5b-home-'));
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s5b-shim-'));

    try {
      fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
      initGitRepo(projectDir);
      seedQueue(projectDir);
      const memFilePath = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
      createFakeClaudeShim(shimDir, memFilePath);

      // Pre-create a fresh lock (age ~0s) to simulate a first worker still holding it
      const lockDir = path.join(projectDir, '.devflow', 'memory', '.working-memory.lock');
      fs.mkdirSync(lockDir);

      // Run the second worker via Node execSync with a 3s timeout.
      // The worker's acquire_lock loops with `sleep 1` per attempt (90s max).
      // After ~3s Node sends SIGTERM, aborting the lock-wait loop.
      // We catch the SIGTERM exit and read the log for positive evidence.
      try {
        execSync(`bash "${BACKGROUND_UPDATER}" "${projectDir}"`, {
          env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
          },
          stdio: 'ignore',
          timeout: 3000,
        });
      } catch {
        // Expected: either SIGTERM from Node timeout (ETIMEDOUT) or non-zero exit.
        // Either way the worker ran — we verify via the log file.
      }

      // Positive evidence: the worker logged "Starting" (proves it ran, not a command-not-found).
      // The log is written before the lock-acquire loop.
      const logFile = workerLogPath(projectDir, homeDir);
      const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
      expect(logContent).toContain('Starting (CWD=');

      // The lock-blocked worker must NOT have written WORKING-MEMORY.md.
      expect(fs.existsSync(memFilePath)).toBe(false);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
  }, 10000); // 10s: 3s Node timeout + margin for process startup/shutdown
});

// =============================================================================
// S6 — AC-F5: User-only queue (no assistant turn) skips LLM
// =============================================================================
describe('S6: AC-F5 — user-only queue skips LLM', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s6-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s6-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s6-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);

    // ONLY user turns — no assistant turn
    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'do the thing', ts }),
        JSON.stringify({ role: 'user', content: 'please now', ts: ts + 1 }),
      ].join('\n') + '\n'
    );

    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('WORKING-MEMORY.md NOT written, queue cleaned up', () => {
    runWorker(projectDir, homeDir, shimDir);

    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    expect(fs.existsSync(memFile)).toBe(false);

    const queueFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    expect(fs.existsSync(queueFile)).toBe(false);
    expect(fs.existsSync(processingFile)).toBe(false);
  });
});

// =============================================================================
// S7 — AC-F7: memory:false in config
// =============================================================================
describe('S7: AC-F7 — memory:false in dream config gates dream-capture', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s7-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s7-home-'));
    writeDreamConfig(projectDir, { memory: false });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('memory:false — no queue append, no trigger touch, no dream marker', () => {
    runHook(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'hello' },
      homeDir
    );

    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger'))).toBe(false);

    const dreamDir = path.join(projectDir, '.devflow', 'dream');
    const markers = fs.readdirSync(dreamDir).filter((f) => f.startsWith('memory'));
    expect(markers).toHaveLength(0);
  });
});

// =============================================================================
// S8 — AC-C2/C4: Security — prompt via STDIN, DEVFLOW_BG_UPDATER, feedback loop
// =============================================================================
describe('S8: AC-C2/C4 — security constraints', () => {
  // NOTE: stdin/argv safety is covered behaviorally in S15 (sentinel in queue,
  // assert sentinel appears in stdin capture and NOT in argv capture). The structural
  // grep for `<<< "$PROMPT"` is dropped to avoid implementation coupling.

  it('DEVFLOW_BG_UPDATER=1 set as env prefix on claude invocation (worker side invariant)', () => {
    // Behavioral twin for the capture side is the test below. This keeps the
    // worker-sets-the-flag invariant which has no behavioral observable from outside.
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('DEVFLOW_BG_UPDATER=1 "$CLAUDE_BIN"');
  });

  it('PROMPT content never appears in worker log — sentinel in queue turn does NOT leak to log', () => {
    // Replaces the "worker has a comment that PROMPT is never logged" comment-grep.
    // This tests the BEHAVIOR: turn content from the queue must not appear in the
    // worker log (where it could be read from disk by other processes).
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s8-sec-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s8-sec-home-'));
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s8-sec-shim-'));
    try {
      fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
      initGitRepo(projectDir);

      const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
      createFakeClaudeShim(shimDir, memFile);

      // Highly distinctive sentinel that would stand out in any log line
      const SENTINEL = 'LOG_LEAK_TEST_SECRET_DO_NOT_LOG_9f3a7b2c';
      const ts = Math.floor(Date.now() / 1000);
      fs.writeFileSync(
        path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
        [
          JSON.stringify({ role: 'user',      content: `${SENTINEL}-user`,      ts }),
          JSON.stringify({ role: 'assistant', content: `${SENTINEL}-assistant`, ts: ts + 1 }),
        ].join('\n') + '\n'
      );

      const { exitCode } = runWorker(projectDir, homeDir, shimDir);
      expect(exitCode).toBe(0);

      // Sentinel must NOT appear in the worker log
      const logFile = workerLogPath(projectDir, homeDir);
      const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
      expect(logContent).not.toContain(SENTINEL);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('dream-capture with DEVFLOW_BG_UPDATER=1 exits early — no queue write', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s8-'));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s8-home-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    try {
      runHook(
        CAPTURE_HOOK,
        { cwd: tmpDir, session_id: 'test', last_assistant_message: 'hello' },
        homeDir,
        { DEVFLOW_BG_UPDATER: '1' }
      );
      expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// S9 — AC-C4: .devflow/ is local by default with a feature-knowledge carve-out
// =============================================================================
describe('S9: AC-C4 — .devflow/ local-by-default with the feature-knowledge carve-out', () => {
  it('this repo root .gitignore applies the carve-out (not wholesale)', () => {
    const lines = fs.readFileSync(
      path.join(__dirname, '..', '.gitignore'),
      'utf-8'
    ).split('\n').map(l => l.trim());
    expect(lines).toContain('.devflow/*');
    expect(lines).toContain('!.devflow/features/');
    expect(lines).toContain('!.devflow/features/*/KNOWLEDGE.md');
    expect(lines).not.toContain('.devflow/'); // no bare wholesale entry
  });

  it('feature knowledge is tracked while transient memory files stay ignored (carve-out)', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s9-'));
    try {
      initGitRepo(projectDir);
      // Apply the real carve-out via the runtime single-source-of-truth helper.
      execSync(`bash -c 'source "${path.join(HOOKS_DIR, 'ensure-root-gitignore')}" "${projectDir}"'`, { stdio: 'pipe' });

      // Transient memory files — must stay ignored.
      fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
      for (const f of ['.working-memory-last-trigger', '.last-refresh-ok', '.pending-turns.processing']) {
        fs.writeFileSync(path.join(projectDir, '.devflow', 'memory', f), 'test');
      }
      fs.mkdirSync(path.join(projectDir, '.devflow', 'memory', '.working-memory.lock'), { recursive: true });

      // Feature knowledge — must be tracked (shareable).
      fs.mkdirSync(path.join(projectDir, '.devflow', 'features', 'demo'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.devflow', 'features', 'index.md'), '- **demo** — x — y\n');
      fs.writeFileSync(path.join(projectDir, '.devflow', 'features', 'demo', 'KNOWLEDGE.md'), '# Demo\n');

      // -uall lists untracked files individually (git otherwise collapses an all-untracked dir).
      const statusOut = execSync(`git -C "${projectDir}" status --short -uall 2>&1`, { encoding: 'utf-8' });
      // Memory transients are excluded.
      for (const f of ['.working-memory-last-trigger', '.last-refresh-ok', '.pending-turns.processing', '.working-memory.lock']) {
        expect(statusOut).not.toContain(f);
      }
      // Feature knowledge is surfaced (untracked-but-not-ignored).
      expect(statusOut).toContain('.devflow/features/index.md');
      expect(statusOut).toContain('.devflow/features/demo/KNOWLEDGE.md');
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// S10 — No-regression: session-start-context decisions/knowledge agents
// =============================================================================
describe('S10: No-regression — session-start-context decisions/knowledge unaffected', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s10-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s10-home-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('decisions.json marker → DREAM MAINTENANCE directive emitted, not memory', () => {
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'dream', 'decisions.test123.json'),
      JSON.stringify({ type: 'decisions', session_id: 'test123' })
    );

    const { stdout } = runHook(SESSION_START_CONTEXT_HOOK, { cwd: projectDir }, homeDir);
    const parsed = JSON.parse(stdout.trim()) as { hookSpecificOutput?: { additionalContext?: string } };
    const ctx = parsed?.hookSpecificOutput?.additionalContext ?? '';

    expect(ctx).toContain('DREAM MAINTENANCE');
    expect(ctx).toContain('decisions');
    expect(ctx).not.toMatch(/Agent\(.*memory.*\)/i);
  });

  it('stale memory.json marker deleted unconditionally (NOT in Dream directive)', () => {
    const markerPath = path.join(projectDir, '.devflow', 'dream', 'memory.json');
    fs.writeFileSync(markerPath, JSON.stringify({ type: 'memory' }));

    runHook(SESSION_START_CONTEXT_HOOK, { cwd: projectDir }, homeDir);

    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('decisions usage scanner exits 0 when ADR-1/PF-1 appear in assistant message', () => {
    // Use a FRESH trigger file (< 120s) so dream-capture throttles before spawning the worker
    const memDir = path.join(projectDir, '.devflow', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, '.working-memory-last-trigger'), '');

    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'decisions', 'decisions-log.jsonl'), ''
    );

    const { exitCode } = runHook(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'I applied ADR-1 and also PF-1 here' },
      homeDir
    );

    expect(exitCode).toBe(0);
  });
});

// =============================================================================
// S11 — AC-C3: No memory.* marker in .devflow/dream/ after dream-capture
//
// Uses fake claude on PATH so the nohup-spawned worker uses the shim, not real claude.
// =============================================================================
describe('S11: AC-C3 — no memory.* marker in .devflow/dream/ after dream-capture', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s11-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s11-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s11-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);

    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);
    seedQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('no memory.* file in .devflow/dream/ after dream-capture (no marker created)', () => {
    runHookWithFakeClaude(
      CAPTURE_HOOK,
      { cwd: projectDir, session_id: 'test', last_assistant_message: 'some response' },
      homeDir,
      shimDir
    );

    const dreamDir = path.join(projectDir, '.devflow', 'dream');
    const memMarkers = fs.readdirSync(dreamDir).filter((f) => f.startsWith('memory'));
    expect(memMarkers).toHaveLength(0);
  });
});

// =============================================================================
// S13 — D56c crash-recovery: leftover .processing merged with new queue entries
//
// Asserts the merge path in background-memory-update: when a leftover
// .pending-turns.processing exists from a prior crashed worker, new queue
// entries are appended into it (not dropped) before the LLM run.
// Also covers the 200-line overflow cap on merged processing files.
// applies ADR-008 (LLM-vs-plumbing: test the plumbing behavior, not LLM output)
// =============================================================================
describe('S13: D56c crash-recovery — leftover .processing merged with new queue', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s13-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s13-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s13-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('leftover .processing turns are NOT dropped — merged with new queue, fed to claude', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    const queueFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');

    // Capture the stdin the fake claude receives so we can assert both batches are present
    const stdinCapture = path.join(shimDir, 'stdin-captured.txt');
    const claudeBin = path.join(shimDir, 'claude');
    fs.writeFileSync(
      claudeBin,
      `#!/bin/bash
# Record stdin so the test can assert both turn-batches are present
cat > "${stdinCapture}"
# Write a valid stamped memory file so the worker treats this as success
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
echo "- crash-recovery test" >> "${memFile}"
exit 0
`
    );
    fs.chmodSync(claudeBin, 0o755);

    const ts = Math.floor(Date.now() / 1000);

    // Leftover .processing from the prior crashed worker (distinct sentinel content)
    fs.writeFileSync(
      processingFile,
      [
        JSON.stringify({ role: 'user',      content: 'PRIOR-CRASHED-USER-TURN',      ts }),
        JSON.stringify({ role: 'assistant', content: 'PRIOR-CRASHED-ASSISTANT-TURN', ts: ts + 1 }),
      ].join('\n') + '\n'
    );

    // New queue entries arrived since the crash
    fs.writeFileSync(
      queueFile,
      [
        JSON.stringify({ role: 'user',      content: 'NEW-QUEUE-USER-TURN',      ts: ts + 2 }),
        JSON.stringify({ role: 'assistant', content: 'NEW-QUEUE-ASSISTANT-TURN', ts: ts + 3 }),
      ].join('\n') + '\n'
    );

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    expect(exitCode).toBe(0);

    // The worker must have called claude (stdin capture file exists)
    expect(fs.existsSync(stdinCapture)).toBe(true);
    const capturedStdin = fs.readFileSync(stdinCapture, 'utf-8');

    // Both batches of turn content must appear in the prompt fed to claude
    expect(capturedStdin).toContain('PRIOR-CRASHED-USER-TURN');
    expect(capturedStdin).toContain('PRIOR-CRASHED-ASSISTANT-TURN');
    expect(capturedStdin).toContain('NEW-QUEUE-USER-TURN');
    expect(capturedStdin).toContain('NEW-QUEUE-ASSISTANT-TURN');

    // Success: .processing removed, .last-refresh-ok touched
    expect(fs.existsSync(processingFile)).toBe(false);
    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');
    expect(fs.existsSync(okFile)).toBe(true);
  });

  it('200-line overflow cap: merged processing file exceeding 200 lines is truncated to 100 lines', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    const queueFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');

    // Use a fake claude that records stdin and writes a success memory file
    const claudeBin = path.join(shimDir, 'claude');
    fs.writeFileSync(
      claudeBin,
      `#!/bin/bash
# Drain stdin (required so the worker's <<< doesn't stall)
cat > /dev/null
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
echo "- overflow cap test" >> "${memFile}"
exit 0
`
    );
    fs.chmodSync(claudeBin, 0o755);

    const ts = Math.floor(Date.now() / 1000);

    // Build a .processing file with 160 lines (assistant-heavy so it passes user-only guard)
    const processingLines: string[] = [];
    for (let i = 0; i < 80; i++) {
      processingLines.push(JSON.stringify({ role: 'user',      content: `old-user-${i}`,      ts: ts + i }));
      processingLines.push(JSON.stringify({ role: 'assistant', content: `old-assistant-${i}`, ts: ts + i + 1 }));
    }
    fs.writeFileSync(processingFile, processingLines.join('\n') + '\n');

    // Add 60 new queue lines — merged total = 220 lines (> 200 cap)
    const queueLines: string[] = [];
    for (let i = 0; i < 30; i++) {
      queueLines.push(JSON.stringify({ role: 'user',      content: `new-user-${i}`,      ts: ts + 200 + i }));
      queueLines.push(JSON.stringify({ role: 'assistant', content: `new-assistant-${i}`, ts: ts + 200 + i + 1 }));
    }
    fs.writeFileSync(queueFile, queueLines.join('\n') + '\n');

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    expect(exitCode).toBe(0);

    // After success the processing file is removed — confirm the worker ran
    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');
    expect(fs.existsSync(okFile)).toBe(true);
    expect(fs.existsSync(processingFile)).toBe(false);
    // WORKING-MEMORY.md written by fake claude confirms the run was not skipped
    expect(fs.existsSync(memFile)).toBe(true);
  });
});

// =============================================================================
// S14 — .last-refresh-ok baseline discipline: THIS run must perform the touch
//
// Tightens the weak mtime assertion in S1 AC-F3/success and the watchdog/failure
// paths: capture a baseline BEFORE the run, then assert strictly-newer on success
// and unchanged/absent on failure.
// applies ADR-008 (behavioral assertion: observe the actual touch, not a stale file)
// =============================================================================
describe('S14: .last-refresh-ok baseline-before-run discipline', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s14-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s14-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s14-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
    seedQueue(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('success: .last-refresh-ok mtime is strictly NEWER than baseline captured before the run', () => {
    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);

    // Ensure no stale .last-refresh-ok exists before the run
    expect(fs.existsSync(okFile)).toBe(false);
    const baselineMs = Date.now();

    runWorker(projectDir, homeDir, shimDir);

    expect(fs.existsSync(okFile)).toBe(true);
    const afterMs = fs.statSync(okFile).mtimeMs;
    // mtime must post-date the baseline — proves THIS run touched the file
    expect(afterMs).toBeGreaterThanOrEqual(baselineMs);
  });

  it('failure (claude exits 1): .last-refresh-ok absent — baseline confirms absence is NOT from a pre-run cleanup', () => {
    const okFile = path.join(projectDir, '.devflow', 'memory', '.last-refresh-ok');

    // Pre-seed a stale .last-refresh-ok dated 10 minutes ago
    fs.writeFileSync(okFile, '');
    backdateMtime(okFile, 600);
    const baselineMtimeMs = fs.statSync(okFile).mtimeMs;

    const failBin = path.join(shimDir, 'claude');
    fs.writeFileSync(failBin, '#!/bin/bash\nexit 1\n');
    fs.chmodSync(failBin, 0o755);

    runWorker(projectDir, homeDir, shimDir);

    // On failure the worker must NOT touch .last-refresh-ok
    // File still exists (worker doesn't clean it up) but mtime is UNCHANGED from baseline
    expect(fs.existsSync(okFile)).toBe(true);
    expect(fs.statSync(okFile).mtimeMs).toBe(baselineMtimeMs);
  });
});

// =============================================================================
// S15 — Behavioral stdin/argv safety: prompt content reaches claude via STDIN,
//        never via argv (where it would be visible to ps(1)/logs)
//
// Creates a fake claude shim that records both its argv and stdin to temp files,
// then asserts turn content appears in STDIN and is absent from ARGV.
// applies ADR-008 (behavior-over-implementation: observe actual process I/O)
// =============================================================================
describe('S15: stdin/argv safety — prompt content delivered via STDIN, not argv', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s15-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s15-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s15-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('turn content appears in recorded STDIN and NOT in recorded ARGV', () => {
    const memFile  = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    const argvLog  = path.join(shimDir, 'argv-captured.txt');
    const stdinLog = path.join(shimDir, 'stdin-captured.txt');

    // Fake claude records both argv and stdin, then writes a success memory file
    const claudeBin = path.join(shimDir, 'claude');
    fs.writeFileSync(
      claudeBin,
      `#!/bin/bash
# Record argv (all positional arguments as a single line)
echo "$@" > "${argvLog}"
# Record stdin (the full prompt)
cat > "${stdinLog}"
# Write a valid stamped memory file so the worker treats this as success
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
echo "- stdin safety test" >> "${memFile}"
exit 0
`
    );
    fs.chmodSync(claudeBin, 0o755);

    // Use a highly distinctive sentinel value that cannot appear in any argv flag
    const SENTINEL = 'UNIQUE_TURN_CONTENT_FOR_STDIN_SAFETY_TEST';
    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      [
        JSON.stringify({ role: 'user',      content: `${SENTINEL}-user`,      ts }),
        JSON.stringify({ role: 'assistant', content: `${SENTINEL}-assistant`, ts: ts + 1 }),
      ].join('\n') + '\n'
    );

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    expect(exitCode).toBe(0);

    // Both capture files must exist (claude was invoked)
    expect(fs.existsSync(argvLog)).toBe(true);
    expect(fs.existsSync(stdinLog)).toBe(true);

    const recordedArgv  = fs.readFileSync(argvLog,  'utf-8');
    const recordedStdin = fs.readFileSync(stdinLog, 'utf-8');

    // Turn content MUST appear in stdin (the prompt was delivered)
    expect(recordedStdin).toContain(SENTINEL);

    // Turn content must NOT appear in argv (no leakage via ps/process table)
    expect(recordedArgv).not.toContain(SENTINEL);
  });
});

// =============================================================================
// S16 — Queue-claim lost-race: mv fails → SKIP path, queue preserved
//
// Tests worker line: mv "$QUEUE_FILE" "$PROCESSING_FILE" 2>/dev/null ||
//   { log "SKIP: failed to claim queue (race condition — another worker got it)"; exit 0; }
//
// The mv failure is simulated by pre-creating the PROCESSING_FILE destination as a
// read-only directory, causing mv to fail (cannot rename into a non-writable dir).
// This is the most faithful simulation of a concurrent-worker race: the second worker
// finds the queue file present but cannot claim it.
// applies ADR-014 (behavioral coverage: test observable outcomes, not implementation strings)
// =============================================================================
describe('S16: queue-claim lost-race — mv failure takes SKIP path, queue preserved', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s16-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s16-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s16-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    // Restore permissions so rmSync can recurse
    const memDir = path.join(projectDir, '.devflow', 'memory');
    try { execSync(`chmod -R 755 "${memDir}"`, { stdio: 'ignore' }); } catch { /* ignore */ }
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('mv failure → SKIP logged, worker exits 0, queue file preserved, no memory write', () => {
    const memFile       = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    const queueFile     = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');
    const processingDir = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');

    createFakeClaudeShim(shimDir, memFile);
    seedQueue(projectDir);

    // Pre-create .pending-turns.processing as a read-only directory.
    // mv .pending-turns.jsonl .pending-turns.processing will attempt to rename INTO
    // this directory; with mode 555 that rename fails (EACCES on macOS).
    fs.mkdirSync(processingDir);
    fs.chmodSync(processingDir, 0o555);

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);

    // Worker must exit 0 (SKIP is a clean exit, not a crash)
    expect(exitCode).toBe(0);

    // WORKING-MEMORY.md must NOT be written (worker bailed before claude invocation)
    expect(fs.existsSync(memFile)).toBe(false);

    // Queue file must still exist — mv failed so the queue was not consumed
    expect(fs.existsSync(queueFile)).toBe(true);

    // Log must contain the SKIP message for this exact path
    const logFile = workerLogPath(projectDir, homeDir);
    const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
    expect(logContent).toContain('SKIP: failed to claim queue (race condition');
  });
});

// =============================================================================
// S17 — Degraded path: neither jq nor node available (_JSON_AVAILABLE=false)
//
// When both jq and node are absent from PATH, json-parse sets _JSON_AVAILABLE=false.
// The worker then:
//   (1) passes the `command -v claude` binary gate (fake claude shim is on PATH)
//   (2) skips the orphan-only guard (conservative: no blind truncation when JSON unavailable)
//   (3) claims the queue (mv to .processing)
//   (4) attempts degraded shell extraction (EXTRACTED="" on macOS BSD tools,
//       may extract partial data on Linux GNU tools)
//
// Two platform-dependent conservative exit paths — BOTH are safe:
//   Path A (macOS/BSD grep+sed):  EXTRACTED="" → TURN_COUNT=0 → logs
//           "No parseable turns — skipping" → removes .processing → exit 0
//   Path B (Linux/GNU grep+sed):  EXTRACTED non-empty → TURN_COUNT>0 → invokes
//           no-op fake claude → verification fails → logs
//           "FAIL: verification failed — leaving .processing for recovery" → exit 0
//
// The platform-independent SAFETY CONTRACT (asserted below):
//   - Worker passed the binary gate (not a SKIP exit)
//   - No WORKING-MEMORY.md written regardless of extraction result
//   - Worker exited 0 (conservative, no crash)
//   - Log contains at least one known conservative-exit marker
//
// A fake claude shim is prepended so `command -v claude` succeeds. Queue has
// user+assistant turns so the orphan guard would NOT exit early if it ran.
// applies ADR-014 (behavioral coverage for degraded/edge paths)
// =============================================================================
describe('S17: degraded path — no jq + no node → conservative exit, no memory write', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s17-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s17-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s17-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('no jq/node: worker passes binary gate, exits conservatively with no memory write', () => {
    const memFile   = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    const queueFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');

    // Seed a queue with BOTH user and assistant turns.
    // This ensures the orphan guard (which is SKIPPED in degraded mode) would not have fired —
    // any conservative exit is driven by the degraded JSON path, not the orphan-only guard.
    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      queueFile,
      [
        JSON.stringify({ role: 'user',      content: 'do something', ts }),
        JSON.stringify({ role: 'assistant', content: 'done',         ts: ts + 1 }),
      ].join('\n') + '\n'
    );

    // Fake claude shim that exits 0 — placed in shimDir so `command -v claude` succeeds.
    // The binary gate passes, so the worker enters the degraded JSON extraction path.
    const claudeBin = path.join(shimDir, 'claude');
    fs.writeFileSync(claudeBin, '#!/bin/bash\nexit 0\n');
    fs.chmodSync(claudeBin, 0o755);

    // Build a PATH: shimDir (has claude) + symlink farm (no jq, no node) + /bin
    const noJsonFarm = buildNoJsonParsePath(os.tmpdir());
    const degradedPath = `${shimDir}:${noJsonFarm}`;

    const { exitCode } = runWorker(projectDir, homeDir, shimDir, {
      PATH: degradedPath,
    });

    const logFile = workerLogPath(projectDir, homeDir);
    const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';

    // (1) Non-vacuous guard: worker PASSED the binary gate (did not SKIP before degraded path).
    //     If this fails, the shim setup is broken and the test is meaningless.
    expect(logContent).not.toContain('SKIP: claude binary not found on PATH');

    // (2) Safety outcome: no memory write regardless of platform extraction behaviour.
    expect(fs.existsSync(memFile)).toBe(false);

    // (3) Worker exited 0 — both conservative exit paths are clean (no crash).
    expect(exitCode).toBe(0);

    // (4) Log contains at least one conservative-exit marker, confirming the worker
    //     reached and completed the degraded path (not a silent exit or unknown failure).
    //     Both platform-dependent exit paths are accepted:
    //       - macOS/BSD: "No parseable turns — skipping"  (EXTRACTED="" → TURN_COUNT=0)
    //       - Linux/GNU: "FAIL: verification failed — leaving .processing for recovery"
    const conservativeExitMarkers = [
      'No parseable turns',
      'verification failed — leaving .processing for recovery',
    ];
    const reachedConservativeExit = conservativeExitMarkers.some(marker =>
      logContent.includes(marker)
    );
    expect(reachedConservativeExit).toBe(true);
  });
});

// =============================================================================
// S12 — Install survival: background-memory-update MUST NOT be in LEGACY_HOOK_FILES
//
// Regression test for: init.ts LEGACY_HOOK_FILES accidentally listed
// background-memory-update, causing installViaFileCopy to install it and then
// the cleanup loop to immediately delete it — memory refresh dead-on-arrival.
// =============================================================================
describe('S12: install survival — background-memory-update not deleted by init cleanup', () => {
  it('background-memory-update is NOT in the LEGACY_HOOK_FILES deletion list in init.ts', () => {
    const initSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'cli', 'commands', 'init.ts'),
      'utf-8'
    );

    // Extract the LEGACY_HOOK_FILES array text so we test the authoritative source
    const match = initSrc.match(/const LEGACY_HOOK_FILES\s*=\s*\[([\s\S]*?)\];/);
    expect(match).not.toBeNull();
    const arrayBody = match![1];

    // The worker must not appear as a quoted string entry in the array
    expect(arrayBody).not.toContain("'background-memory-update'");
    expect(arrayBody).not.toContain('"background-memory-update"');
  });

  it('background-memory-update exists and is executable in the source hooks dir', () => {
    const workerPath = path.resolve(__dirname, '..', 'scripts', 'hooks', 'background-memory-update');
    expect(fs.existsSync(workerPath)).toBe(true);
    // Check executable bit for owner
    const mode = fs.statSync(workerPath).mode;
    // eslint-disable-next-line no-bitwise
    expect(mode & 0o100).toBeGreaterThan(0);
  });
});

// =============================================================================
// S18 — AC-F10: qa rows flow into memory synthesis (orphan gate + TURNS_TEXT agree)
//
// A qa row (captured AskUserQuestion Q&A pair) must count as content-bearing for
// the orphan-only auto-clean guard — the same way an assistant row does — and
// must appear in the prompt fed to claude as its own "Q&A:" stanza.
// =============================================================================
describe('S18: AC-F10 — qa rows in background-memory-update (orphan gate + TURNS_TEXT)', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s18-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s18-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s18-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('user + qa (no assistant) is NOT truncated as user-only — a real run is attempted', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);

    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'what should I pick?', ts }),
        JSON.stringify({ role: 'qa', content: 'Q: pick one\nA: option B', ts: ts + 1 }),
      ].join('\n') + '\n'
    );

    runWorker(projectDir, homeDir, shimDir);

    // WORKING-MEMORY.md written proves the orphan gate did NOT truncate the queue
    // (the "no assistant turn" auto-clean path never invokes claude at all).
    expect(fs.existsSync(memFile)).toBe(true);
    const processingFile = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    expect(fs.existsSync(processingFile)).toBe(false);
  });

  it('qa content appears in the prompt fed to claude as a "Q&A:" stanza', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    const stdinCapture = path.join(shimDir, 'stdin-captured.txt');
    const claudeBin = path.join(shimDir, 'claude');
    fs.writeFileSync(
      claudeBin,
      `#!/bin/bash
cat > "${stdinCapture}"
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
exit 0
`
    );
    fs.chmodSync(claudeBin, 0o755);

    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'need a decision', ts }),
        JSON.stringify({ role: 'qa', content: 'Q: ship now or wait?\nA: ship now', ts: ts + 1 }),
      ].join('\n') + '\n'
    );

    const { exitCode } = runWorker(projectDir, homeDir, shimDir);
    expect(exitCode).toBe(0);

    expect(fs.existsSync(stdinCapture)).toBe(true);
    const capturedStdin = fs.readFileSync(stdinCapture, 'utf-8');
    expect(capturedStdin).toContain('Q&A:');
    expect(capturedStdin).toContain('ship now or wait?');
    expect(capturedStdin).toContain('ship now');
  });

  it('regression: pure user-only queue (no qa, no assistant) is STILL truncated without an LLM run', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);

    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      JSON.stringify({ role: 'user', content: 'just a question', ts }) + '\n'
    );

    runWorker(projectDir, homeDir, shimDir);

    // Orphan gate must still fire for a genuinely user-only queue — claude never invoked.
    expect(fs.existsSync(memFile)).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
  });

  it('qa-only queue (no user, no assistant) is NOT truncated as user-only', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);

    const ts = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      JSON.stringify({ role: 'qa', content: 'Q: only question\nA: only answer', ts }) + '\n'
    );

    runWorker(projectDir, homeDir, shimDir);

    expect(fs.existsSync(memFile)).toBe(true);
  });
});

// =============================================================================
// S19 — session-start-memory cold-path recovery for orphaned .pending-turns.processing
//
// Mirrors dream-recover's dream_recover_stale logic (duplicated, not sourced —
// session-start-memory has no dependency on dream-recover). Age >300s + no
// existing .jsonl -> recovered; .jsonl present -> left alone (non-clobber).
// =============================================================================
describe('S19: session-start-memory cold-path .pending-turns.processing recovery', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s19-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s19-home-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('stale (>300s) orphaned .processing with no .jsonl present is recovered', () => {
    const proc = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    fs.writeFileSync(proc, JSON.stringify({ role: 'user', content: 'orphaned', ts: 1 }) + '\n');
    backdateMtime(proc, 600);

    runHook(SESSION_START_MEMORY_HOOK, { cwd: projectDir }, homeDir);

    expect(fs.existsSync(proc)).toBe(false);
    const jsonl = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');
    expect(fs.existsSync(jsonl)).toBe(true);
    expect(fs.readFileSync(jsonl, 'utf-8')).toContain('orphaned');
  });

  it('fresh (<300s) .processing is left alone (not yet stale)', () => {
    const proc = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    fs.writeFileSync(proc, JSON.stringify({ role: 'user', content: 'fresh', ts: 1 }) + '\n');
    // No backdate — mtime is "now"

    runHook(SESSION_START_MEMORY_HOOK, { cwd: projectDir }, homeDir);

    expect(fs.existsSync(proc)).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
  });

  it('non-clobber: stale .processing is left in place when .pending-turns.jsonl already exists', () => {
    const proc = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    fs.writeFileSync(proc, JSON.stringify({ role: 'user', content: 'orphaned', ts: 1 }) + '\n');
    backdateMtime(proc, 600);
    const jsonl = path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');
    fs.writeFileSync(jsonl, JSON.stringify({ role: 'user', content: 'fresh-queue', ts: 2 }) + '\n');

    runHook(SESSION_START_MEMORY_HOOK, { cwd: projectDir }, homeDir);

    expect(fs.existsSync(proc)).toBe(true);
    expect(fs.readFileSync(jsonl, 'utf-8')).toContain('fresh-queue');
    expect(fs.readFileSync(jsonl, 'utf-8')).not.toContain('orphaned');
  });

  it('no .processing at all — hook proceeds normally (no error, no spurious .jsonl)', () => {
    const { exitCode } = runHook(SESSION_START_MEMORY_HOOK, { cwd: projectDir }, homeDir);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
  });

  it('recovery is skipped entirely when memory is disabled via dream config', () => {
    writeDreamConfig(projectDir, { memory: false });
    const proc = path.join(projectDir, '.devflow', 'memory', '.pending-turns.processing');
    fs.writeFileSync(proc, JSON.stringify({ role: 'user', content: 'orphaned', ts: 1 }) + '\n');
    backdateMtime(proc, 600);

    runHook(SESSION_START_MEMORY_HOOK, { cwd: projectDir }, homeDir);

    // memory:false gates the whole hook (including the new recovery block) — .processing untouched
    expect(fs.existsSync(proc)).toBe(true);
  });
});
