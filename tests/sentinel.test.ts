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
import {
  addMemoryHooks,
  removeMemoryHooks,
  hasMemoryHooks,
} from '../src/cli/commands/memory.js';
import {
  addLearningHook,
  hasLearningHook,
} from '../src/cli/commands/learn.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-sentinel-test-'));
}

function mkMemoryDir(base: string): void {
  fs.mkdirSync(path.join(base, '.memory'), { recursive: true });
}

function writeDisabledSentinel(sentinelPath: string): void {
  const dir = path.dirname(sentinelPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sentinelPath, '', 'utf-8');
}

function sessionInput(tmpDir: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ cwd: tmpDir, session_id: 'test-session', ...extra });
}

// ─── Part B: Sentinel guards for memory hooks ────────────────────────────────

describe('sentinel guard: prompt-capture-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'prompt-capture-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('captures user prompt normally when sentinel absent', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir, { prompt: 'test prompt' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(true);
  });

  it('exits early and writes nothing when .working-memory-disabled exists', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.working-memory-disabled'));
    const input = sessionInput(tmpDir, { prompt: 'test prompt' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(false);
  });
});

describe('sentinel guard: stop-update-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'stop-update-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('appends assistant turn normally when sentinel absent', () => {
    mkMemoryDir(tmpDir);
    // Touch throttle marker to prevent background spawn attempt
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');
    const input = sessionInput(tmpDir, { stop_reason: 'end_turn', response_text: 'hello' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(true);
  });

  it('exits early when .working-memory-disabled exists', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.working-memory-disabled'));
    const input = sessionInput(tmpDir, { stop_reason: 'end_turn', response_text: 'hello' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(false);
  });
});

describe('sentinel guard: background-memory-update', () => {
  const HOOK = path.join(HOOKS_DIR, 'background-memory-update');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits cleanly and logs when .working-memory-disabled exists', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.working-memory-disabled'));

    // background-memory-update takes CWD and CLAUDE_BIN as positional args
    expect(() => {
      execSync(`bash "${HOOK}" "${tmpDir}" ""`, { stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });
});

describe('sentinel guard: pre-compact-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'pre-compact-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits cleanly when .working-memory-disabled exists', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.working-memory-disabled'));
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // backup.json must NOT be written when disabled
    expect(fs.existsSync(path.join(tmpDir, '.memory', 'backup.json'))).toBe(false);
  });

  it('writes backup.json when sentinel absent', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // pre-compact-memory creates backup.json
    expect(fs.existsSync(path.join(tmpDir, '.memory', 'backup.json'))).toBe(true);
  });
});

describe('sentinel guard: session-start-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('outputs nothing when .working-memory-disabled exists (even with WORKING-MEMORY.md present)', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.working-memory-disabled'));
    fs.writeFileSync(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('outputs context when sentinel absent and WORKING-MEMORY.md exists', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // Should output the session JSON envelope
    expect(output.length).toBeGreaterThan(0);
    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('WORKING MEMORY');
  });
});

// ─── Part C: Sentinel guard for learning hook ─────────────────────────────

describe('sentinel guard: session-end-learning', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-end-learning');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('exits cleanly when .learning-disabled sentinel exists', () => {
    mkMemoryDir(tmpDir);
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.learning-disabled'));
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('proceeds normally when .learning-disabled absent (DEVFLOW_BG_LEARNER guard covers no-op)', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir);
    // The hook should exit 0 even without a transcript (no-op on missing projects dir)
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
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
    writeDisabledSentinel(path.join(tmpDir, '.memory', 'decisions', '.disabled'));
    // Even with ADR-001 in input, scanner should skip
    const response = 'applies ADR-001 and avoids PF-001';
    expect(() => {
      execSync(`printf '%s' "${response}" | node "${SCANNER}" --cwd "${tmpDir}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
  });

  it('processes citations when decisions/.disabled absent', () => {
    mkMemoryDir(tmpDir);
    // Create usage file with a known entry
    const usagePath = path.join(tmpDir, '.memory', '.decisions-usage.json');
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

describe('sentinel guard: stop-update-memory decisions scanner gating', () => {
  const HOOK = path.join(HOOKS_DIR, 'stop-update-memory');
  let tmpDir: string;

  beforeEach(() => { tmpDir = mkTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('does NOT run scanner when decisions/.disabled exists', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');
    writeDisabledSentinel(path.join(tmpDir, '.memory', 'decisions', '.disabled'));
    // Create usage file to detect if scanner would have run
    const usagePath = path.join(tmpDir, '.memory', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({
      version: 1,
      entries: { 'ADR-001': { cites: 0, last_cited: null } },
    }, null, 2));
    const input = sessionInput(tmpDir, { stop_reason: 'end_turn', response_text: 'applies ADR-001' });
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    const updated = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    // Scanner should not have run — cites stays at 0
    expect(updated.entries['ADR-001'].cites).toBe(0);
  });

  it('runs scanner when decisions/.disabled absent', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');
    // Create usage file to detect scanner run
    const usagePath = path.join(tmpDir, '.memory', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({
      version: 1,
      entries: { 'ADR-001': { cites: 0, last_cited: null } },
    }, null, 2));
    const input = sessionInput(tmpDir, { stop_reason: 'end_turn', response_text: 'applies ADR-001' });
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
    const decisionsDir = path.join(tmpDir, '.memory', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output.length).toBeGreaterThan(0);
    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('PROJECT DECISIONS');
  });

  it('skips decisions TL;DR when decisions/.disabled exists', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.memory', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    writeDisabledSentinel(path.join(decisionsDir, '.disabled'));
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // No output (nothing else to inject in this minimal test)
    expect(output).toBe('');
  });

  it('outputs learned behaviors when learning enabled and learning-log.jsonl exists', () => {
    mkMemoryDir(tmpDir);
    const logPath = path.join(tmpDir, '.memory', 'learning-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({
      id: 'obs_abc123', type: 'workflow', status: 'created',
      artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95,
      last_seen: new Date().toISOString(),
    }) + '\n');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output.length).toBeGreaterThan(0);
    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('LEARNED BEHAVIORS');
  });

  it('skips learned behaviors when .learning-disabled exists', () => {
    mkMemoryDir(tmpDir);
    const logPath = path.join(tmpDir, '.memory', 'learning-log.jsonl');
    fs.writeFileSync(logPath, JSON.stringify({
      id: 'obs_abc123', type: 'workflow', status: 'created',
      artifact_path: '/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95,
      last_seen: new Date().toISOString(),
    }) + '\n');
    writeDisabledSentinel(path.join(tmpDir, '.memory', '.learning-disabled'));
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // No learned behaviors section
    if (output.length > 0) {
      const parsed = JSON.parse(output);
      expect(parsed.hookSpecificOutput.additionalContext).not.toContain('LEARNED BEHAVIORS');
    }
  });

  it('session-start-memory no longer outputs decisions TL;DR', () => {
    const SESSION_START_MEMORY = path.join(HOOKS_DIR, 'session-start-memory');
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.memory', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    fs.writeFileSync(path.join(tmpDir, '.memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${SESSION_START_MEMORY}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    // session-start-memory should output context (WORKING MEMORY), but NOT decisions TL;DR
    if (output.length > 0) {
      const parsed = JSON.parse(output);
      expect(parsed.hookSpecificOutput.additionalContext).not.toContain('PROJECT DECISIONS');
      expect(parsed.hookSpecificOutput.additionalContext).toContain('WORKING MEMORY');
    }
  });
});

// ─── Part A: Hook registration utilities ────────────────────────────────────

describe('context hook registration', () => {
  it('addContextHook adds session-start-context to SessionStart', async () => {
    const { addContextHook } = await import('../src/cli/commands/init.js');
    const result = addContextHook('{}', '/home/user/.devflow');
    const settings = JSON.parse(result);
    expect(settings.hooks?.SessionStart).toBeDefined();
    const hasContextHook = settings.hooks.SessionStart.some(
      (m: { hooks: { command: string }[] }) =>
        m.hooks.some((h: { command: string }) => h.command.includes('session-start-context')),
    );
    expect(hasContextHook).toBe(true);
  });

  it('removeContextHook removes session-start-context from settings', async () => {
    const { addContextHook, removeContextHook } = await import('../src/cli/commands/init.js');
    const withHook = addContextHook('{}', '/home/user/.devflow');
    const removed = removeContextHook(withHook);
    const settings = JSON.parse(removed);
    const hasContextHook = settings.hooks?.SessionStart?.some(
      (m: { hooks: { command: string }[] }) =>
        m.hooks.some((h: { command: string }) => h.command.includes('session-start-context')),
    ) ?? false;
    expect(hasContextHook).toBe(false);
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

