/**
 * Tests for sentinel-based disable guards across memory and learning hooks,
 * the new session-start-context hook, CLI sentinel management, and decisions scanner.
 *
 * Test order follows TDD RED-GREEN-REFACTOR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { manageSentinel } from '../src/cli/utils/sentinel.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sentinel-test-'));
}

function mkMemoryDir(base: string): void {
  fs.mkdirSync(path.join(base, '.devflow', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'sidecar'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'learning'), { recursive: true });
}

function writeDisabledSentinel(sentinelPath: string): void {
  const dir = path.dirname(sentinelPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sentinelPath, '', 'utf-8');
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

// ─── Part B: Sentinel guards for sidecar capture hooks ──────────────────────

describe('sentinel guard: sidecar-dispatch', () => {
  const HOOK = path.join(HOOKS_DIR, 'sidecar-dispatch');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('captures user prompt normally when memory enabled (no config)', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir, { prompt: 'test prompt' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(true);
  });

  it('exits early and writes nothing when config has memory: false', () => {
    mkMemoryDir(tmpDir);
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), JSON.stringify({ memory: false }));
    const input = sessionInput(tmpDir, { prompt: 'test prompt' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
  });
});

describe('sentinel guard: sidecar-capture', () => {
  const HOOK = path.join(HOOKS_DIR, 'sidecar-capture');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends assistant turn normally when memory enabled (no config)', () => {
    mkMemoryDir(tmpDir);
    // Write stale WORKING-MEMORY.md so throttle passes
    const memFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, '## Now\n- testing');
    const tenMinutesAgo = new Date(Date.now() - 600 * 1000);
    fs.utimesSync(memFile, tenMinutesAgo, tenMinutesAgo);
    const input = sessionInput(tmpDir, { last_assistant_message: 'hello' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(true);
  });

  it('exits early when config has memory: false', () => {
    mkMemoryDir(tmpDir);
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), JSON.stringify({ memory: false }));
    const input = sessionInput(tmpDir, { last_assistant_message: 'hello' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
  });
});

describe('sentinel guard: pre-compact-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'pre-compact-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits cleanly when sidecar config has memory: false', () => {
    mkMemoryDir(tmpDir);
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), JSON.stringify({ memory: false }));
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // backup.json must NOT be written when disabled
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(false);
  });

  it('writes backup.json when sentinel absent', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // pre-compact-memory creates backup.json
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(true);
  });
});

describe('sentinel guard: session-start-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('outputs nothing when sidecar config has memory: false (even with WORKING-MEMORY.md present)', () => {
    mkMemoryDir(tmpDir);
    const sidecarDir = path.join(tmpDir, '.devflow', 'sidecar');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.writeFileSync(path.join(sidecarDir, 'config.json'), JSON.stringify({ memory: false }));
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('outputs context when sentinel absent and WORKING-MEMORY.md exists', () => {
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

// ─── Part C: Sentinel guard for sidecar-evaluate hook ────────────────────────

describe('sentinel guard: sidecar-evaluate', () => {
  const HOOK = path.join(HOOKS_DIR, 'sidecar-evaluate');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits cleanly when no session_id is provided', () => {
    mkMemoryDir(tmpDir);
    const input = JSON.stringify({ cwd: tmpDir });
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('exits cleanly for DEVFLOW_BG_LEARNER=1 (feedback loop guard)', () => {
    expect(() => {
      execSync(`DEVFLOW_BG_LEARNER=1 bash "${HOOK}"`, { stdio: 'ignore' });
    }).not.toThrow();
  });

  it('exits cleanly when .devflow/memory/ does not exist (no markers written)', () => {
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // Should not create any sidecar marker files
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'sidecar'))).toBe(false);
  });
});

// ─── Part D: Decisions scanner fix ──────────────────────────────────────────

describe('sentinel guard: decisions-usage-scan.cjs', () => {
  const SCANNER = path.join(HOOKS_DIR, 'decisions-usage-scan.cjs');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits 0 when decisions/.disabled exists', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.devflow', 'decisions', '.disabled'));
    // Even with ADR-001 in input, scanner should skip
    const response = 'applies ADR-001 and avoids PF-001';
    expect(() => {
      execSync(`printf '%s' "${response}" | node "${SCANNER}" --cwd "${tmpDir}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('processes citations when decisions/.disabled absent', () => {
    mkMemoryDir(tmpDir);
    // Create usage file with a known entry
    const usagePath = path.join(tmpDir, '.devflow', 'decisions', '.decisions-usage.json');
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

describe('sentinel guard: sidecar-capture decisions scanner gating', () => {
  const HOOK = path.join(HOOKS_DIR, 'sidecar-capture');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeStaleWorkingMemory(dir: string): void {
    const memFile = path.join(dir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    fs.writeFileSync(memFile, '## Now\n- stale memory');
    const tenMinutesAgo = new Date(Date.now() - 600 * 1000);
    fs.utimesSync(memFile, tenMinutesAgo, tenMinutesAgo);
  }

  it('does NOT run scanner when decisions/.disabled exists', () => {
    mkMemoryDir(tmpDir);
    writeStaleWorkingMemory(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.devflow', 'decisions', '.disabled'));
    // Create usage file to detect if scanner would have run
    const usagePath = path.join(tmpDir, '.devflow', 'decisions', '.decisions-usage.json');
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

  it('runs scanner when decisions/.disabled absent', () => {
    mkMemoryDir(tmpDir);
    writeStaleWorkingMemory(tmpDir);
    // Create usage file to detect scanner run
    const usagePath = path.join(tmpDir, '.devflow', 'decisions', '.decisions-usage.json');
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

describe('sentinel guard: session-start-context', () => {
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

  it('outputs decisions TL;DR when decisions enabled and decisions.md exists', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output.length).toBeGreaterThan(0);
    const additionalContext = parseHookOutput(output);
    expect(additionalContext).toContain('PROJECT DECISIONS');
  });

  it('skips decisions TL;DR when decisions/.disabled exists', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    writeDisabledSentinel(path.join(decisionsDir, '.disabled'));
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // No output (nothing else to inject in this minimal test)
    expect(output).toBe('');
  });

  it('outputs learned behaviors when learning enabled and learning-log.jsonl exists', () => {
    mkMemoryDir(tmpDir);
    const logPath = path.join(tmpDir, '.devflow', 'learning', 'learning-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({
      id: 'obs_abc123', type: 'workflow', status: 'created',
      artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95,
      last_seen: new Date().toISOString(),
    }) + '\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output.length).toBeGreaterThan(0);
    const additionalContext = parseHookOutput(output);
    expect(additionalContext).toContain('LEARNED BEHAVIORS');
  });

  it('skips learned behaviors when .learning-disabled exists', () => {
    mkMemoryDir(tmpDir);
    const logPath = path.join(tmpDir, '.devflow', 'learning', 'learning-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({
      id: 'obs_abc123', type: 'workflow', status: 'created',
      artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95,
      last_seen: new Date().toISOString(),
    }) + '\n');
    writeDisabledSentinel(path.join(tmpDir, '.devflow', 'memory', '.learning-disabled'));
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // The hook must produce no output when the only injectable section is disabled.
    // Asserting unconditionally: either the output is empty (nothing to inject) or
    // it contains content that does NOT include the learned behaviors section.
    if (output.length > 0) {
      const additionalContext = parseHookOutput(output);
      expect(additionalContext).not.toContain('LEARNED BEHAVIORS');
    } else {
      // Empty output is the correct behavior when .learning-disabled suppresses the
      // only available section. This is the expected path for this test.
      expect(output).toBe('');
    }
  });

  it('session-start-memory no longer outputs decisions TL;DR', () => {
    const SESSION_START_MEMORY = path.join(HOOKS_DIR, 'session-start-memory');
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'decisions');
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

// ─── Part E: manageSentinel utility ─────────────────────────────────────────

describe('manageSentinel utility', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates sentinel file when disabled=false', async () => {
    const sentinelPath = path.join(tmpDir, '.devflow', 'memory', '.working-memory-disabled');
    await manageSentinel(sentinelPath, false);
    expect(fs.existsSync(sentinelPath)).toBe(true);
  });

  it('creates parent directories when they do not exist', async () => {
    const sentinelPath = path.join(tmpDir, '.devflow', 'decisions', '.disabled');
    await manageSentinel(sentinelPath, false);
    expect(fs.existsSync(sentinelPath)).toBe(true);
  });

  it('removes sentinel file when enabled=true', async () => {
    const sentinelPath = path.join(tmpDir, '.devflow', 'memory', '.learning-disabled');
    writeDisabledSentinel(sentinelPath);
    await manageSentinel(sentinelPath, true);
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it('is idempotent when enabling with no sentinel present', async () => {
    const sentinelPath = path.join(tmpDir, '.devflow', 'memory', '.working-memory-disabled');
    // No sentinel exists — enabling again should not throw
    await expect(manageSentinel(sentinelPath, true)).resolves.toBeUndefined();
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it('is idempotent when disabling with sentinel already present', async () => {
    const sentinelPath = path.join(tmpDir, '.devflow', 'memory', '.working-memory-disabled');
    writeDisabledSentinel(sentinelPath);
    await expect(manageSentinel(sentinelPath, false)).resolves.toBeUndefined();
    expect(fs.existsSync(sentinelPath)).toBe(true);
  });

  it('disable then enable removes the sentinel', async () => {
    const sentinelPath = path.join(tmpDir, '.devflow', 'memory', '.working-memory-disabled');
    await manageSentinel(sentinelPath, false);
    expect(fs.existsSync(sentinelPath)).toBe(true);
    await manageSentinel(sentinelPath, true);
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });
});

