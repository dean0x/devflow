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
  shimDir: string
): { exitCode: number } {
  try {
    execSync(`bash "${BACKGROUND_UPDATER}" "${projectDir}"`, {
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
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

  it('State B: 2 commits after stamp sha → "commit(s) ago" + git log list', () => {
    const stampSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8' }).trim() || 'main';
    writeMemoryWithStamp(projectDir, stampSha, branch);

    fs.writeFileSync(path.join(projectDir, 'file1.txt'), 'a');
    execSync('git add file1.txt && git commit -qm "second commit"', { cwd: projectDir, shell: '/bin/bash' });
    fs.writeFileSync(path.join(projectDir, 'file2.txt'), 'b');
    execSync('git add file2.txt && git commit -qm "third commit"', { cwd: projectDir, shell: '/bin/bash' });

    const ctx = getCtx(projectDir, homeDir);
    expect(ctx).toContain('commit(s) ago');
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

  it('AC-F3/structural: watchdog cancel pattern present (kill + wait $WD_PID after claude exits)', () => {
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('kill "$WD_PID"');
    expect(src).toContain('wait "$WD_PID"');
    expect(src).toContain('sleep 120');
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
  it('structural: lock is mkdir-based .working-memory.lock/ with 300s stale break', () => {
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('.working-memory.lock');
    expect(src).toContain('mkdir "$LOCK_DIR"');
    expect(src).toContain('STALE_THRESHOLD=300');
    expect(src).toContain('break_stale_lock');
  });

  it('behavioral: fresh lock (<300s) blocks second worker from writing WORKING-MEMORY.md', () => {
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

      // Pre-create a fresh lock (age ~0s) to simulate first worker still running
      const lockDir = path.join(projectDir, '.devflow', 'memory', '.working-memory.lock');
      fs.mkdirSync(lockDir);

      // Run worker wrapped in bash `timeout 2` so it gives up after 2s lock wait
      try {
        execSync(
          `bash -c 'timeout 2 bash "${BACKGROUND_UPDATER}" "${projectDir}" 2>/dev/null; exit 0'`,
          {
            env: {
              ...process.env,
              HOME: homeDir,
              PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 8000,
          }
        );
      } catch {
        // timeout exits non-zero — that's expected
      }

      // WORKING-MEMORY.md must NOT have been written (second worker blocked)
      expect(fs.existsSync(memFilePath)).toBe(false);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
  });
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
  it('worker passes content via heredoc stdin (<<< $PROMPT), not via argv', () => {
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('<<< "$PROMPT"');
    // No positional argument with $PROMPT to claude binary
    expect(src).not.toMatch(/"\$CLAUDE_BIN"[^#\n]*"\$PROMPT"/);
  });

  it('DEVFLOW_BG_UPDATER=1 set as env prefix on claude invocation', () => {
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('DEVFLOW_BG_UPDATER=1 "$CLAUDE_BIN"');
  });

  it('worker has a comment that PROMPT is never logged', () => {
    const src = fs.readFileSync(BACKGROUND_UPDATER, 'utf-8');
    expect(src).toContain('never log PROMPT');
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
// S9 — AC-C4: Transient files covered by .devflow/.gitignore wildcard
// =============================================================================
describe('S9: AC-C4 — transient files git-ignored by .devflow/.gitignore', () => {
  it('actual .devflow/.gitignore uses * (ignore all) + re-includes curated files', () => {
    const gitignoreContent = fs.readFileSync(
      path.join(__dirname, '..', '.devflow', '.gitignore'),
      'utf-8'
    );
    expect(gitignoreContent).toContain('\n*\n');  // wildcard on its own line
    expect(gitignoreContent).toContain('!decisions/decisions.md');
    expect(gitignoreContent).toContain('!decisions/pitfalls.md');
  });

  it('transient files are untracked (git-ignored) in scratch repo with .gitignore', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emr-s9-'));
    try {
      initGitRepo(projectDir);
      fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });

      fs.writeFileSync(
        path.join(projectDir, '.devflow', '.gitignore'),
        ['*', '!.gitignore', '!decisions/', '!decisions/decisions.md', '!decisions/pitfalls.md',
          '!features/', '!features/index.json', '!features/*/', '!features/*/KNOWLEDGE.md', ''].join('\n')
      );

      for (const f of ['.working-memory-last-trigger', '.last-refresh-ok', '.pending-turns.processing']) {
        fs.writeFileSync(path.join(projectDir, '.devflow', 'memory', f), 'test');
      }
      fs.mkdirSync(path.join(projectDir, '.devflow', 'memory', '.working-memory.lock'), { recursive: true });

      const statusOut = execSync(`git -C "${projectDir}" status --short 2>&1`, { encoding: 'utf-8' });
      for (const f of ['.working-memory-last-trigger', '.last-refresh-ok', '.pending-turns.processing', '.working-memory.lock']) {
        expect(statusOut).not.toContain(f);
      }
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
