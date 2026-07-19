/**
 * Tests for config-based disable guards across memory and decisions hooks,
 * the session-start-context hook, hook registration utilities, and the
 * decisions usage scanner.
 *
 * Test order follows TDD RED-GREEN-REFACTOR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-config-disable-guards-test-'));
}

function mkMemoryDir(base: string): void {
  fs.mkdirSync(path.join(base, '.devflow', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'dream'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'learning'), { recursive: true });
}

function sessionInput(tmpDir: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ cwd: tmpDir, session_id: 'test-session', ...extra });
}

/**
 * Parse hook stdout into the additionalContext string.
 * Asserts structural validity before property access so test failures are
 * clear rather than runtime TypeErrors on undefined properties.
 */
function parseHookOutput(rawOutput: string): string {
  const parsed: unknown = JSON.parse(rawOutput);
  expect(parsed).toBeTypeOf('object');
  expect(parsed).not.toBeNull();
  const envelope = parsed as Record<string, unknown>;
  expect(envelope.hookSpecificOutput).toBeTypeOf('object');
  const hookOutput = envelope.hookSpecificOutput as Record<string, unknown>;
  expect(hookOutput.additionalContext).toBeTypeOf('string');
  return hookOutput.additionalContext as string;
}

describe('config guard: pre-compact-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'pre-compact-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits cleanly when feature config has memory: false', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'config.json'), JSON.stringify({ memory: false }));
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // backup.json must NOT be written when disabled
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(false);
  });

  it('writes backup.json when disable guard absent', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // pre-compact-memory creates backup.json
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(true);
  });
});

describe('config guard: session-start-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('outputs nothing when feature config has memory: false (even with WORKING-MEMORY.md present)', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'config.json'), JSON.stringify({ memory: false }));
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('outputs context when disable guard absent and WORKING-MEMORY.md exists', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // Should output the session JSON envelope
    expect(output.length).toBeGreaterThan(0);
    const additionalContext = parseHookOutput(output);
    expect(additionalContext).toContain('WORKING MEMORY');
  });
});

// ─── Part D: Decisions scanner fix ──────────────────────────────────────────

describe('decisions-usage-scan.cjs', () => {
  const SCANNER = path.join(HOOKS_DIR, 'decisions-usage-scan.cjs');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('processes citations (gating lives in the caller, not the scanner)', () => {
    mkMemoryDir(tmpDir);
    // Create usage file with a known entry
    const usagePath = path.join(tmpDir, '.devflow', 'learning', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({
      version: 1,
      entries: { 'ADR-001': { cites: 0, last_cited: null } },
    }, null, 2));
    const response = 'applies ADR-001';
    execSync(`printf '%s' "${response}" | node "${SCANNER}" --cwd "${tmpDir}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    const updated = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    expect(updated.entries['ADR-001'].cites).toBe(1);
  });
});

describe('config guard: capture-turn decisions scanner gating', () => {
  const HOOK = path.join(HOOKS_DIR, 'capture-turn');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('does NOT run scanner when feature config has learning: false', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'config.json'),
      JSON.stringify({ learning: false }),
    );
    // Create usage file to detect if scanner would have run
    const usagePath = path.join(tmpDir, '.devflow', 'learning', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({
      version: 1,
      entries: { 'ADR-001': { cites: 0, last_cited: null } },
    }, null, 2));
    const input = sessionInput(tmpDir, { last_assistant_message: 'applies ADR-001' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    const updated = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    // Scanner should not have run — cites stays at 0
    expect(updated.entries['ADR-001'].cites).toBe(0);
  });

  it('runs scanner when learning enabled (config absent defaults true)', () => {
    mkMemoryDir(tmpDir);
    // Create usage file to detect scanner run
    const usagePath = path.join(tmpDir, '.devflow', 'learning', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({
      version: 1,
      entries: { 'ADR-001': { cites: 0, last_cited: null } },
    }, null, 2));
    const input = sessionInput(tmpDir, { last_assistant_message: 'applies ADR-001' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    const updated = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    // Scanner ran — cites incremented
    expect(updated.entries['ADR-001'].cites).toBe(1);
  });
});

// ─── Part A: session-start-context hook ──────────────────────────────────────

describe('config guard: session-start-context', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-context');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('script exists and passes bash -n', () => {
    expect(fs.existsSync(HOOK)).toBe(true);
    expect(() => {
      execSync(`bash -n "${HOOK}"`, { stdio: 'pipe' });
    }).not.toThrow();
  });

  it('is executable', () => {
    const stat = fs.statSync(HOOK);
    // Owner execute bit (0o100)
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it('outputs nothing when CWD is empty', () => {
    const input = JSON.stringify({ cwd: '', session_id: 'test' });
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('outputs decisions TL;DR when learning enabled and decisions.md exists', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output.length).toBeGreaterThan(0);
    const additionalContext = parseHookOutput(output);
    expect(additionalContext).toContain('PROJECT DECISIONS');
  });

  it('skips decisions TL;DR when feature config has learning: false', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'config.json'),
      JSON.stringify({ learning: false }),
    );
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // No output (nothing else to inject in this minimal test)
    expect(output).toBe('');
  });

  it('session-start-context does not output LEARNED BEHAVIORS (learning pipeline removed)', () => {
    // Section 1.75 removed — LEARNED BEHAVIORS must never appear
    mkMemoryDir(tmpDir);
    // Create a learning log that would have triggered the old section
    const learningDir = path.join(tmpDir, '.devflow', 'learning');
    fs.mkdirSync(learningDir, { recursive: true });
    const logPath = path.join(learningDir, 'learning-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({
      id: 'obs_abc123', type: 'workflow', status: 'created',
      artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95,
      last_seen: new Date().toISOString(),
    }) + '\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // LEARNED BEHAVIORS section must never appear (AC-F1)
    if (output.length > 0) {
      const additionalContext = parseHookOutput(output);
      expect(additionalContext).not.toContain('LEARNED BEHAVIORS');
    }
    // Empty output is also acceptable — hook correctly skips section
  });

  it('session-start-memory no longer outputs decisions TL;DR', () => {
    const SESSION_START_MEMORY = path.join(HOOKS_DIR, 'session-start-memory');
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${SESSION_START_MEMORY}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // WORKING-MEMORY.md exists so the hook always produces output here.
    expect(output.length).toBeGreaterThan(0);
    const additionalContext = parseHookOutput(output);
    // session-start-memory must not include PROJECT DECISIONS (moved to session-start-context)
    expect(additionalContext).not.toContain('PROJECT DECISIONS');
    expect(additionalContext).toContain('WORKING MEMORY');
  });
});

// ─── Part A: Hook registration utilities ────────────────────────────────────

describe('context hook registration', () => {
  it('addContextHook adds session-start-context to SessionStart', async () => {
    const { addContextHook } = await import('../src/cli/commands/init.js');
    const result = addContextHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);
    expect(settings.hooks?.SessionStart).toBeDefined();
    const hookPresent = settings.hooks.SessionStart.some(
      (m: { hooks: { command: string }[] }) =>
        m.hooks.some((h: { command: string }) => h.command.includes('session-start-context')),
    );
    expect(hookPresent).toBe(true);
  });

  it('removeContextHook removes session-start-context from settings', async () => {
    const { addContextHook, removeContextHook } = await import('../src/cli/commands/init.js');
    const withHook = addContextHook('{}', '/home/user/.devflow');
    const removed = removeContextHook(withHook);
    const settings = JSON.parse(removed);
    const hookPresent = settings.hooks?.SessionStart?.some(
      (m: { hooks: { command: string }[] }) =>
        m.hooks.some((h: { command: string }) => h.command.includes('session-start-context')),
    ) ?? false;
    expect(hookPresent).toBe(false);
  });

  it('hasContextHook returns true when hook registered', async () => {
    const { addContextHook, hasContextHook } = await import('../src/cli/commands/init.js');
    const withHook = addContextHook('{}', '/home/user/.devflow');
    expect(hasContextHook(withHook)).toBe(true);
  });

  it('hasContextHook returns false when hook absent', async () => {
    const { hasContextHook } = await import('../src/cli/commands/init.js');
    expect(hasContextHook('{}')).toBe(false);
  });

  it('addContextHook is idempotent', async () => {
    const { addContextHook } = await import('../src/cli/commands/init.js');
    const first = addContextHook('{}', '/home/user/.devflow');
    const second = addContextHook(first, '/home/user/.devflow');
    expect(second).toBe(first);
  });

  it('removeContextHook preserves other SessionStart hooks', async () => {
    const { addContextHook, removeContextHook } = await import('../src/cli/commands/init.js');
    const input = JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/run-hook session-start-memory' }] }],
      },
    });
    const withContext = addContextHook(input, '/home/user/.devflow');
    const removed = removeContextHook(withContext);
    const settings = JSON.parse(removed);
    expect(settings.hooks?.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('session-start-memory');
  });
});

// ─── Part A: dream hook upgrade cleanup (spawn-dream-worker) ────────────────
//
// The spawn-dream-worker SessionStart hook belonged to the retired detached
// dream worker. removeDreamHook/hasDreamHook exist for upgrade cleanup only:
// init and uninstall strip any stale entry left by a prior install.

describe('dream hook upgrade cleanup', () => {
  const SETTINGS_WITH_DREAM_HOOK = JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: '/path/run-hook session-start-memory' }] },
        { hooks: [{ type: 'command', command: '/path/run-hook session-start-context' }] },
        { hooks: [{ type: 'command', command: '/path/run-hook spawn-dream-worker', timeout: 10 }] },
      ],
    },
  });

  it('removeDreamHook removes a stale spawn-dream-worker entry from settings', async () => {
    const { removeDreamHook } = await import('../src/cli/commands/init.js');
    const removed = removeDreamHook(SETTINGS_WITH_DREAM_HOOK);
    const settings = JSON.parse(removed);
    const hookPresent = settings.hooks?.SessionStart?.some(
      (m: { hooks: { command: string }[] }) =>
        m.hooks.some((h: { command: string }) => h.command.includes('spawn-dream-worker')),
    ) ?? false;
    expect(hookPresent).toBe(false);
  });

  it('removeDreamHook preserves other SessionStart hooks (session-start-memory, session-start-context)', async () => {
    const { removeDreamHook } = await import('../src/cli/commands/init.js');
    const removed = removeDreamHook(SETTINGS_WITH_DREAM_HOOK);
    const settings = JSON.parse(removed);
    expect(settings.hooks?.SessionStart).toHaveLength(2);
    const commands = settings.hooks.SessionStart.map((m: { hooks: { command: string }[] }) => m.hooks[0].command);
    expect(commands.some((c: string) => c.includes('session-start-memory'))).toBe(true);
    expect(commands.some((c: string) => c.includes('session-start-context'))).toBe(true);
  });

  it('removeDreamHook returns settings unchanged when no stale entry exists', async () => {
    const { removeDreamHook } = await import('../src/cli/commands/init.js');
    const input = JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/run-hook session-start-context' }] }],
      },
    });
    expect(removeDreamHook(input)).toBe(input);
    expect(removeDreamHook('{}')).toBe('{}');
  });

  it('hasDreamHook detects a stale entry and its absence', async () => {
    const { hasDreamHook } = await import('../src/cli/commands/init.js');
    expect(hasDreamHook(SETTINGS_WITH_DREAM_HOOK)).toBe(true);
    expect(hasDreamHook('{}')).toBe(false);
  });
});

// ─── Part F: DEVFLOW_BG_UPDATER re-entrancy guards (AC-F14) ─────────────────
//
// The memory worker's own nested claude -p session fires SessionStart and
// PreCompact hooks too — session-start-context, session-start-memory, and
// pre-compact-memory must all bail out before any read or write.
// capture-prompt, capture-turn, and capture-question carry the equivalent
// guard and are covered in tests/capture-hooks.test.ts.

describe('re-entrancy guard: session-start-context DEVFLOW_BG_UPDATER', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-context');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('outputs nothing when DEVFLOW_BG_UPDATER=1, even with a decisions TL;DR present', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.mkdirSync(decisionsDir, { recursive: true });
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`DEVFLOW_BG_UPDATER=1 bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('DEVFLOW_BG_UPDATER=1 makes zero filesystem writes (no .gitignore/.devflow scaffolding)', () => {
    // A fresh tmpDir with no .devflow/ at all — the guard must fire before
    // ensure-root-gitignore or any other write-side-effect runs.
    const input = sessionInput(tmpDir);
    execSync(`DEVFLOW_BG_UPDATER=1 bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow'))).toBe(false);
  });
});

describe('re-entrancy guard: session-start-memory DEVFLOW_BG_UPDATER', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('outputs nothing when DEVFLOW_BG_UPDATER=1, even with WORKING-MEMORY.md present', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`DEVFLOW_BG_UPDATER=1 bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('DEVFLOW_BG_UPDATER=1 does not recover a stale .pending-turns.processing (guard fires before the cold-path check)', () => {
    mkMemoryDir(tmpDir);
    const proc = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.processing');
    fs.writeFileSync(proc, JSON.stringify({ role: 'user', content: 'x', ts: 1 }) + '\n');
    const old = new Date(Date.now() - 600 * 1000);
    fs.utimesSync(proc, old, old);
    const input = sessionInput(tmpDir);
    execSync(`DEVFLOW_BG_UPDATER=1 bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(proc)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
  });
});

describe('re-entrancy guard: pre-compact-memory DEVFLOW_BG_UPDATER', () => {
  const HOOK = path.join(HOOKS_DIR, 'pre-compact-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('does not write backup.json when DEVFLOW_BG_UPDATER=1', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`DEVFLOW_BG_UPDATER=1 bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(false);
  });
});

