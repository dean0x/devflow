/**
 * Tests for the disable guards across memory and decisions hooks,
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
import { execHook } from './shell-hooks-helpers.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * A temp project inside a git checkout: the hooks scaffold and inject project
 * context only in a git project (D-HOOKS-GIT-ONLY). An empty `.git` is a marker,
 * not a repository, so the resolved root is the directory itself.
 */
function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-config-disable-guards-test-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

function mkMemoryDir(base: string): void {
  fs.mkdirSync(path.join(base, '.devflow', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(base, '.devflow', 'learning'), { recursive: true });
}

function sessionInput(tmpDir: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ cwd: tmpDir, session_id: 'test-session', ...extra });
}

/**
 * Seed a temp HOME that stands in for `~/.devflow` (AC-3.22).
 *
 * `session-start-context` reads user-scope state — the global learning.json and,
 * since Section 3, the tracker manifest and its `.tracker.enabled` sentinel — out
 * of `$HOME/.devflow`. Every hook in this file additionally
 * sources `hook-log-init`, whose `devflow_log_dir` does an unconditional
 * `mkdir -p "$HOME/.devflow/logs/<slug>"`. Every hook invocation below therefore
 * passes an explicit HOME, so no assertion in
 * this file can be decided by — or leave a directory behind on — the developer's
 * real machine (PF-060).
 *
 * SEEDED, never empty (PF-018): the directory tree the hook actually reads is
 * created, so a green run here means the hook reached its gates and declined,
 * not that it tripped over a missing path.
 */
function mkTmpHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-config-disable-guards-home-'));
  fs.mkdirSync(path.join(home, '.devflow', 'logs'), { recursive: true });
  return home;
}

/**
 * A user-scope manifest holding `features` — where memory, learning and
 * knowledge are switched for the machine (D-FEATURES-NARROW-ONLY).
 */
function writeManifest(home: string, features: Record<string, unknown>): void {
  fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
  fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), JSON.stringify({
    version: '2.0.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features,
  }, null, 2));
}

/** A per-repo config. Its memory/learning keys are retired: no gate reads them. */
function writeRepoConfig(base: string, fields: Record<string, unknown>): void {
  fs.writeFileSync(path.join(base, '.devflow', 'config.json'), JSON.stringify(fields));
}

/** A user-scope manifest naming `provider` at features.tracker.provider. */
function seedTrackerProvider(home: string, provider: string, features: Record<string, unknown> = {}): void {
  writeManifest(home, { ambient: true, memory: true, tracker: { provider }, ...features });
  // The presence sentinel devflow writes whenever the resolved provider is not
  // github — without it Section 3 stops at a shell builtin and the fixture would
  // be inert (the exact vacuous-seed shape PF-018 describes).
  fs.writeFileSync(path.join(home, '.devflow', '.tracker.enabled'), '');
}

/**
 * Hook environment: an explicit HOME on every invocation — the hooks resolve
 * user-scope state from `$HOME/.devflow` and nothing else (D-ONE-HOME).
 */
function hookEnv(home: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home };
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
  let tmpHome: string;

  beforeEach(() => { tmpDir = mkTmpDir(); tmpHome = mkTmpHome(); });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('exits cleanly when memory is switched off machine-wide, although the repo config says true', () => {
    mkMemoryDir(tmpDir);
    writeRepoConfig(tmpDir, { memory: true });
    writeManifest(tmpHome, { memory: false });
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // backup.json must NOT be written when disabled
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(false);
  });

  it('a stale repo config memory:false does not switch it off', () => {
    mkMemoryDir(tmpDir);
    writeRepoConfig(tmpDir, { memory: false });
    writeManifest(tmpHome, { memory: true });
    execSync(`bash "${HOOK}"`, { input: sessionInput(tmpDir), env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(true);
  });

  it('writes backup.json when disable guard absent', () => {
    mkMemoryDir(tmpDir);
    const input = sessionInput(tmpDir);
    expect(() => {
      execSync(`bash "${HOOK}"`, { input, env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] });
    }).not.toThrow();
    // pre-compact-memory creates backup.json
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(true);
  });
});

describe('config guard: session-start-memory', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-memory');
  let tmpDir: string;
  let tmpHome: string;

  beforeEach(() => { tmpDir = mkTmpDir(); tmpHome = mkTmpHome(); });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('outputs nothing when memory is switched off machine-wide (even with WORKING-MEMORY.md and a repo config saying true)', () => {
    mkMemoryDir(tmpDir);
    writeRepoConfig(tmpDir, { memory: true });
    writeManifest(tmpHome, { memory: false });
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(output).toBe('');
  });

  it('a stale repo config memory:false does not silence it', () => {
    mkMemoryDir(tmpDir);
    writeRepoConfig(tmpDir, { memory: false });
    writeManifest(tmpHome, { memory: true });
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const output = execSync(`bash "${HOOK}"`, { input: sessionInput(tmpDir), env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    expect(parseHookOutput(output)).toContain('WORKING MEMORY');
  });

  it('outputs context when disable guard absent and WORKING-MEMORY.md exists', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md'), '## Now\n- testing');
    const input = sessionInput(tmpDir);
    const output = execSync(`bash "${HOOK}"`, { input, env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
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
  let tmpHome: string;

  beforeEach(() => { tmpDir = mkTmpDir(); tmpHome = mkTmpHome(); });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('does NOT run scanner when learning is switched off machine-wide', () => {
    mkMemoryDir(tmpDir);
    writeManifest(tmpHome, { learning: false });
    // Create usage file to detect if scanner would have run
    const usagePath = path.join(tmpDir, '.devflow', 'learning', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({
      version: 1,
      entries: { 'ADR-001': { cites: 0, last_cited: null } },
    }, null, 2));
    const input = sessionInput(tmpDir, { last_assistant_message: 'applies ADR-001' });
    execSync(`bash "${HOOK}"`, { input, env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] });
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
    execSync(`bash "${HOOK}"`, { input, env: hookEnv(tmpHome), stdio: ['pipe', 'pipe', 'pipe'] });
    const updated = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    // Scanner ran — cites incremented
    expect(updated.entries['ADR-001'].cites).toBe(1);
  });
});

// ─── Part A: session-start-context hook ──────────────────────────────────────

describe('config guard: session-start-context', () => {
  const HOOK = path.join(HOOKS_DIR, 'session-start-context');
  let tmpDir: string;
  let tmpHome: string;

  beforeEach(() => { tmpDir = mkTmpDir(); tmpHome = mkTmpHome(); });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  /** Run the hook against the seeded temp HOME. Never the developer's own. */
  function runContextHook(input: string, home: string = tmpHome): string {
    return execSync(`bash "${HOOK}"`, {
      input,
      // Never the inherited cwd (the developer's repo): the empty-CWD row relies on
      // the hook's guard alone, and a regression there would resolve this directory.
      cwd: tmpDir,
      env: hookEnv(home),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
  }

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
    expect(runContextHook(input)).toBe('');
  });

  it('outputs decisions TL;DR when learning enabled and decisions.md exists', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    const output = runContextHook(sessionInput(tmpDir));
    expect(output.length).toBeGreaterThan(0);
    const additionalContext = parseHookOutput(output);
    expect(additionalContext).toContain('PROJECT DECISIONS');
  });

  it('skips decisions TL;DR when learning is switched off machine-wide', () => {
    mkMemoryDir(tmpDir);
    const decisionsDir = path.join(tmpDir, '.devflow', 'learning');
    fs.writeFileSync(path.join(decisionsDir, 'decisions.md'), '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n');
    writeManifest(tmpHome, { learning: false });
    // No output (nothing else to inject in this minimal test)
    expect(runContextHook(sessionInput(tmpDir))).toBe('');
  });

  it('a stale repo config learning:false does not skip the decisions TL;DR', () => {
    mkMemoryDir(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n',
    );
    writeRepoConfig(tmpDir, { learning: false });
    writeManifest(tmpHome, { learning: true });
    expect(parseHookOutput(runContextHook(sessionInput(tmpDir)))).toContain('PROJECT DECISIONS');
  });

  // ─── AC-3.22 — the developer's real $HOME never decides these assertions ───
  //
  // Both emptiness assertions above ran with NO `env`, so they inherited the
  // developer's real HOME. Since Section 3 reads user-scope tracker state out of
  // `$HOME/.devflow`, a maintainer who ran `devflow --tracker jira`
  // on their own machine turned both of them red locally while CI — whose HOME has
  // no devflow install — stayed green. The temp HOME above is the fix; the two
  // cases below are what keeps it honest.

  it('AC-3.22: the learning:false emptiness assertion survives a HOME with provider jira', () => {
    // The seeded HOME is the hostile one: manifest provider jira AND the presence
    // sentinel, i.e. exactly the machine state that used to break this file.
    // learning:false rides in the same manifest — it is the machine-wide switch.
    seedTrackerProvider(tmpHome, 'jira', { learning: false });
    mkMemoryDir(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n',
    );
    // The SessionStart event these guards send carries no `source`, and Section 3
    // emits only on startup/clear — so the output is empty for a reason that does
    // not depend on which HOME is in play.
    expect(runContextHook(sessionInput(tmpDir))).toBe('');
  });

  it('AC-3.22: two temp HOMEs produce identical output, and the seeded one is not inert', () => {
    const otherHome = mkTmpHome();
    try {
      seedTrackerProvider(tmpHome, 'jira');
      mkMemoryDir(tmpDir);
      // Section 3 is gated on the project root being inside a repository: the
      // `.git` marker mkTmpDir() seeds satisfies df_has_git_marker's `-e` walk
      // without being a repository to `git rev-parse`.

      // (a) Identical output across a bare HOME and a tracker-configured one.
      const bare = runContextHook(sessionInput(tmpDir), otherHome);
      const seeded = runContextHook(sessionInput(tmpDir), tmpHome);
      expect(bare).toBe('');
      expect(seeded).toBe(bare);

      // (b) Non-vacuity: the seeded HOME really is reachable. With `source:
      // startup` the two HOMEs diverge, so (a) is a property of the source gate
      // rather than a fixture the hook never looked at (PF-018).
      const startup = sessionInput(tmpDir, { source: 'startup' });
      expect(runContextHook(startup, otherHome)).toBe('');
      const withTracker = runContextHook(startup, tmpHome);
      expect(parseHookOutput(withTracker)).toContain('--- TRACKER SETUP ---');
    } finally {
      fs.rmSync(otherHome, { recursive: true, force: true });
    }
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
    const output = runContextHook(sessionInput(tmpDir));
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
    const output = execSync(`bash "${SESSION_START_MEMORY}"`, {
      input,
      env: hookEnv(tmpHome),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
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
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/.devflow/scripts/hooks/run-hook session-start-memory' }] }],
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
        { hooks: [{ type: 'command', command: '/path/.devflow/scripts/hooks/run-hook session-start-memory' }] },
        { hooks: [{ type: 'command', command: '/path/.devflow/scripts/hooks/run-hook session-start-context' }] },
        { hooks: [{ type: 'command', command: '/path/.devflow/scripts/hooks/run-hook spawn-dream-worker', timeout: 10 }] },
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
        SessionStart: [{ hooks: [{ type: 'command', command: '/path/.devflow/scripts/hooks/run-hook session-start-context' }] }],
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

// ─── D-EXACT-HOOK-OWNER: context and dream hooks are matched exactly (#391) ──
//
// A hook is devflow's only when its command ends in
// `/scripts/hooks/run-hook <marker>` under any directory. A user's hook that
// merely contains the marker word is theirs, and removal takes devflow's single
// hook out of a shared matcher group, keeping the siblings in order.

describe('context and dream hook ownership is exact (#391)', () => {
  const DEVFLOW = '/home/user/.devflow';
  const run = (marker: string) => `${DEVFLOW}/scripts/hooks/run-hook ${marker}`;
  /** A user group whose every hook mentions a marker word; none is devflow's. */
  const USER_GROUP = { matcher: 'startup', hooks: [
    { type: 'command', command: '~/bin/session-start-context.sh', timeout: 3 },
    { type: 'command', command: 'echo spawn-dream-worker session-start-context' },
    { type: 'command', command: '/opt/tools/run-hook session-start-context' },
    { type: 'command', command: '/opt/tools/run-hook spawn-dream-worker' },
  ] };
  const userSettings = (): string => JSON.stringify({ hooks: { SessionStart: [USER_GROUP] } }, null, 2) + '\n';

  it('user hooks that contain a marker word are neither the context nor the dream hook', async () => {
    const { hasContextHook, hasDreamHook } = await import('../src/cli/commands/init.js');
    expect(hasContextHook(userSettings())).toBe(false);
    expect(hasDreamHook(userSettings())).toBe(false);
  });

  it('remove on settings holding only the user group is a byte-identical no-op', async () => {
    const { removeContextHook, removeDreamHook } = await import('../src/cli/commands/init.js');
    const input = userSettings();
    expect(removeContextHook(input)).toBe(input);
    expect(removeDreamHook(input)).toBe(input);
  });

  it('add registers the context hook after the byte-identical user group; init (remove-then-add) and uninstall keep it', async () => {
    const { addContextHook, removeContextHook } = await import('../src/cli/commands/init.js');
    const on = addContextHook(userSettings(), DEVFLOW);
    const session = JSON.parse(on).hooks.SessionStart;
    expect(session).toEqual([USER_GROUP, { hooks: [{ type: 'command', command: run('session-start-context'), timeout: 10 }] }]);

    expect(addContextHook(removeContextHook(on), DEVFLOW), 're-init changes nothing').toBe(on);
    expect(removeContextHook(on)).toBe(userSettings());
  });

  it('removes only devflow\'s hook from a shared group and keeps the siblings in order', async () => {
    const { removeContextHook, removeDreamHook } = await import('../src/cli/commands/init.js');
    const input = JSON.stringify({ hooks: { SessionStart: [{ hooks: [
      { type: 'command', command: 'say hello' },
      { type: 'command', command: run('session-start-context'), timeout: 10 },
      { type: 'command', command: run('spawn-dream-worker'), timeout: 10 },
      { type: 'command', command: 'say ready' },
    ] }] } });

    const settings = JSON.parse(removeDreamHook(removeContextHook(input)));

    expect(settings.hooks.SessionStart).toEqual([{ hooks: [
      { type: 'command', command: 'say hello' },
      { type: 'command', command: 'say ready' },
    ] }]);
  });

  it.each([
    ['another directory', '/srv/old/.devflow/scripts/hooks/run-hook'],
    ['a Windows path', 'C:\\Users\\u\\.devflow\\scripts\\hooks\\run-hook'],
  ])('still recognises and removes devflow\'s hooks registered under %s', async (_label, runHook) => {
    const { hasContextHook, removeContextHook, hasDreamHook, removeDreamHook } = await import('../src/cli/commands/init.js');
    const input = JSON.stringify({ hooks: { SessionStart: [
      { hooks: [{ type: 'command', command: `${runHook} session-start-context` }] },
      { hooks: [{ type: 'command', command: `${runHook} spawn-dream-worker` }] },
    ] } });
    expect(hasContextHook(input)).toBe(true);
    expect(hasDreamHook(input)).toBe(true);
    expect(JSON.parse(removeDreamHook(removeContextHook(input))).hooks).toBeUndefined();
  });
});

// ─── Part F: DEVFLOW_BG_UPDATER re-entrancy guards (AC-F14) ─────────────────
//
// The memory worker's own nested claude -p session fires SessionStart and
// PreCompact hooks too — session-start-context, session-start-memory, and
// pre-compact-memory must all bail out before any read or write.
// capture-prompt, capture-turn, and capture-question carry the equivalent
// guard and are covered in tests/capture-hooks.test.ts.
//
// session-start-memory and pre-compact-memory exit on the guard BEFORE reading
// stdin, so they run through execHook: plain execSync throws EPIPE whenever that
// exit beats the write of `input` (see D-STDIN-EPIPE in shell-hooks-helpers.ts).
// session-start-context drains stdin as its first I/O, so execSync is race-free.

/** The inherited environment with the re-entrancy guard raised. */
const BG_UPDATER_ENV: NodeJS.ProcessEnv = { ...process.env, DEVFLOW_BG_UPDATER: '1' };

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
    const output = execHook(HOOK, input, { env: BG_UPDATER_ENV }).trim();
    expect(output).toBe('');
  });

  it('DEVFLOW_BG_UPDATER=1 does not recover a stale .pending-turns.processing (guard fires before the cold-path check)', () => {
    mkMemoryDir(tmpDir);
    const proc = path.join(tmpDir, '.devflow', 'memory', '.pending-turns.processing');
    fs.writeFileSync(proc, JSON.stringify({ role: 'user', content: 'x', ts: 1 }) + '\n');
    const old = new Date(Date.now() - 600 * 1000);
    fs.utimesSync(proc, old, old);
    const input = sessionInput(tmpDir);
    execHook(HOOK, input, { env: BG_UPDATER_ENV });
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
      execHook(HOOK, input, { env: BG_UPDATER_ENV });
    }).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', 'backup.json'))).toBe(false);
  });
});

