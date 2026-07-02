/**
 * tests/capture-hooks.test.ts
 *
 * Tests for the Phase 1/2 capture + dispatch layer of the dream system
 * simplification: capture-prompt, capture-turn, capture-question,
 * memory-worker, and spawn-dream-worker. A dedicated file (mirroring
 * eager-memory-refresh.test.ts's precedent for a redesign-scoped test file)
 * rather than adding to the already-large shell-hooks.test.ts.
 *
 * Harness idioms follow eager-memory-refresh.test.ts: fake-claude PATH shim,
 * temp dirs, DEVFLOW_BG_WATCHDOG_SECS override, execSync + JSON stdin. Real
 * `claude` is never invoked from these tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HOOKS_DIR = path.resolve(__dirname, '..', 'scripts', 'hooks');
const CAPTURE_PROMPT = path.join(HOOKS_DIR, 'capture-prompt');
const CAPTURE_TURN = path.join(HOOKS_DIR, 'capture-turn');
const CAPTURE_QUESTION = path.join(HOOKS_DIR, 'capture-question');
const MEMORY_WORKER = path.join(HOOKS_DIR, 'memory-worker');
const SPAWN_DREAM_WORKER = path.join(HOOKS_DIR, 'spawn-dream-worker');

// ---------------------------------------------------------------------------
// Harness helpers (mirrors eager-memory-refresh.test.ts)
// ---------------------------------------------------------------------------

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
    return { stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? '', exitCode: err.status ?? 1 };
  }
}

function runHookWithPath(
  hookPath: string,
  input: object,
  homeDir: string,
  shimDir: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  return runHook(hookPath, input, homeDir, {
    PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    ...extraEnv,
  });
}

function createFakeClaudeShim(shimDir: string, memFile: string): void {
  const bin = path.join(shimDir, 'claude');
  fs.writeFileSync(
    bin,
    `#!/bin/bash
echo "<!-- memory-head: testsha branch: main -->" > "${memFile}"
echo "## Now" >> "${memFile}"
exit 0
`,
  );
  fs.chmodSync(bin, 0o755);
}

function backdateMtime(filePath: string, secondsAgo: number): void {
  const past = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(filePath, past, past);
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function writeDreamConfig(projectDir: string, fields: Record<string, unknown>): void {
  const dir = path.join(projectDir, '.devflow', 'dream');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(fields));
}

function workerLogPath(projectDir: string, homeDir: string, hookName: string): string {
  const slug = projectDir.replace(/^\//, '').replace(/\//g, '-');
  return path.join(homeDir, '.devflow', 'logs', slug, `.${hookName}.log`);
}

// =============================================================================
// capture-prompt
// =============================================================================
describe('capture-prompt', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prompt-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prompt-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('AC-F1: both features enabled (no config) -> one {role:"user"} row to BOTH queues', () => {
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'hello world' }, homeDir);
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    const dream = readJsonl(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'));
    expect(mem).toEqual([{ role: 'user', content: 'hello world', ts: expect.any(Number) }]);
    expect(dream).toEqual([{ role: 'user', content: 'hello world', ts: expect.any(Number) }]);
  });

  it('AC-F1: content truncated at 2000 chars', () => {
    const longPrompt = 'x'.repeat(2500);
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: longPrompt }, homeDir);
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    expect((mem[0].content as string).length).toBe(2000 + '... [truncated]'.length);
  });

  it('empty prompt -> zero appends, no .devflow scaffolding', () => {
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: '' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('AC-F4: memory:false -> no memory-queue append (dream append unaffected)', () => {
    writeDreamConfig(projectDir, { memory: false });
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(readJsonl(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toHaveLength(1);
  });

  it('AC-F4: decisions disabled via config field -> no dream-queue append (memory unaffected)', () => {
    writeDreamConfig(projectDir, { decisions: false });
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(1);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toBe(false);
  });

  it('AC-F4: decisions disabled via .disabled sentinel -> no dream-queue append (memory unaffected)', () => {
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.devflow', 'decisions', '.disabled'), '');
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(1);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toBe(false);
  });

  it('both disabled -> zero appends, no scaffolding', () => {
    writeDreamConfig(projectDir, { memory: false, decisions: false });
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toBe(false);
  });

  it('AC-F14: DEVFLOW_BG_UPDATER=1 -> exit 0, zero filesystem writes', () => {
    const { exitCode } = runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('AC-F14: DEVFLOW_BG_DREAM=1 -> exit 0, zero filesystem writes', () => {
    const { exitCode } = runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir, { DEVFLOW_BG_DREAM: '1' });
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });
});

// =============================================================================
// capture-turn
// =============================================================================
describe('capture-turn', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-turn-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-turn-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('AC-F2: last_assistant_message present -> one {role:"assistant"} row to both queues', () => {
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'response text' }, homeDir);
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toEqual([
      { role: 'assistant', content: 'response text', ts: expect.any(Number) },
    ]);
    expect(readJsonl(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toEqual([
      { role: 'assistant', content: 'response text', ts: expect.any(Number) },
    ]);
  });

  it('AC-F2: empty message -> zero appends', () => {
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: '' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('AC-F5: capture-turn NEVER spawns a process', () => {
    // No claude shim on PATH at all, and no trigger/throttle files involved.
    // If capture-turn tried to spawn anything, .working-memory.lock/ or a
    // worker log line would appear; assert their total absence.
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'hi' }, homeDir, {
      PATH: '/usr/bin:/bin', // deliberately excludes any claude shim
    });
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.working-memory.lock'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger'))).toBe(false);
    const logFile = workerLogPath(projectDir, homeDir, 'background-memory-update');
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('capture-turn never spawns even with a stale trigger + populated queue + no claude shim', () => {
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600); // "throttle expired" — would matter for memory-worker, not capture-turn
    const beforeMtime = fs.statSync(triggerFile).mtimeMs;

    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'hello' }, homeDir);

    // capture-turn must not touch the trigger file (that's memory-worker's job)
    expect(fs.statSync(triggerFile).mtimeMs).toBe(beforeMtime);
    const logFile = workerLogPath(projectDir, homeDir, 'background-memory-update');
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('AC-F4: gating independent per queue (memory:false, decisions enabled)', () => {
    writeDreamConfig(projectDir, { memory: false });
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'x' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(readJsonl(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toHaveLength(1);
  });

  it('decisions usage scanner still runs when memory is disabled (matches dream-capture behavior)', () => {
    writeDreamConfig(projectDir, { memory: false });
    // decisions-usage-scan.cjs itself no-ops when .devflow/memory/ is absent
    // (its own guard) — pre-create it, matching the established convention in
    // sentinel.test.ts's mkMemoryDir helper for the equivalent dream-capture test.
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
    const usagePath = path.join(projectDir, '.devflow', 'decisions', '.decisions-usage.json');
    fs.writeFileSync(usagePath, JSON.stringify({ version: 1, entries: { 'ADR-001': { cites: 0, last_cited: null } } }));
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'applies ADR-001' }, homeDir);
    const updated = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    expect(updated.entries['ADR-001'].cites).toBe(1);
  });

  it('AC-F14: DEVFLOW_BG_DREAM=1 -> exit 0, zero filesystem writes', () => {
    const { exitCode } = runHook(
      CAPTURE_TURN,
      { cwd: projectDir, session_id: 't', last_assistant_message: 'hi' },
      homeDir,
      { DEVFLOW_BG_DREAM: '1' },
    );
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });
});

// =============================================================================
// capture-question
// =============================================================================
describe('capture-question', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-question-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-question-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // Fixture mined from a real transcript (~/.claude/projects/-Users-dean-Sandbox-devflow),
  // structurally identical to the captured toolUseResult shape (verified byte-identical
  // to the PostToolUse tool_response field via a scratch-project probe).
  const REAL_MULTI_QUESTION_PAYLOAD = {
    session_id: 'test',
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'How should I handle the Phase 5 Scrutinizer review?',
          header: 'Scrutinizer',
          multiSelect: false,
          options: [{ label: 'Re-run, inert probes only' }, { label: 'Skip Scrutinizer entirely' }],
        },
        {
          question: 'Going forward, how do you want me to handle subagents?',
          header: 'Shell policy',
          multiSelect: false,
          options: [{ label: 'Flag before running' }],
        },
      ],
    },
    tool_response: {
      questions: [],
      answers: {
        'How should I handle the Phase 5 Scrutinizer review?': 'Re-run, inert probes only',
        'Going forward, how do you want me to handle subagents?': 'Flag before running',
      },
      annotations: {},
    },
  };

  // Real errored sample mined from ~/.claude/projects (a different project's
  // transcript): an AskUserQuestion call with a missing required `questions` param.
  const REAL_ERRORED_PAYLOAD = {
    session_id: 'test',
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {},
    tool_response:
      'InputValidationError: [\n  {\n    "expected": "array",\n    "code": "invalid_type",\n    "path": [\n      "questions"\n    ],\n    "message": "Invalid input: expected array, received undefined"\n  }\n]',
  };

  it('AC-F3: one {role:"qa"} row PER QUESTION, to both queues', () => {
    runHook(CAPTURE_QUESTION, { ...REAL_MULTI_QUESTION_PAYLOAD, cwd: projectDir }, homeDir);
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    const dream = readJsonl(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'));
    expect(mem).toHaveLength(2);
    expect(dream).toHaveLength(2);
    expect(mem[0]).toMatchObject({
      role: 'qa',
      content: 'Q: How should I handle the Phase 5 Scrutinizer review?\nA: Re-run, inert probes only',
    });
    expect(mem[1]).toMatchObject({
      role: 'qa',
      content: 'Q: Going forward, how do you want me to handle subagents?\nA: Flag before running',
    });
  });

  it('non-AskUserQuestion tool_name -> zero appends (even with a matcher, defensively)', () => {
    runHook(
      CAPTURE_QUESTION,
      { cwd: projectDir, tool_name: 'Read', tool_input: { file_path: '/tmp/x' }, tool_response: { type: 'text' } },
      homeDir,
    );
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('malformed/errored tool_response (real InputValidationError sample) -> exit 0, zero writes', () => {
    const { exitCode } = runHook(CAPTURE_QUESTION, { ...REAL_ERRORED_PAYLOAD, cwd: projectDir }, homeDir);
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('absent tool_response -> exit 0, zero writes', () => {
    const { exitCode } = runHook(
      CAPTURE_QUESTION,
      { cwd: projectDir, tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'q?' }] } },
      homeDir,
    );
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('multiSelect array answer -> joined with "; "', () => {
    runHook(
      CAPTURE_QUESTION,
      {
        cwd: projectDir,
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Pick colors', multiSelect: true, options: [{ label: 'Red' }, { label: 'Blue' }] }] },
        tool_response: { answers: { 'Pick colors': ['Red', 'Blue'] } },
      },
      homeDir,
    );
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    expect(mem[0].content).toBe('Q: Pick colors\nA: Red; Blue');
  });

  it('truncation: Q and A are capped at 1000 chars INDEPENDENTLY', () => {
    const longQ = 'Q'.repeat(1500);
    const longA = 'A'.repeat(1500);
    runHook(
      CAPTURE_QUESTION,
      {
        cwd: projectDir,
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: longQ, multiSelect: false, options: [] }] },
        tool_response: { answers: { [longQ]: longA } },
      },
      homeDir,
    );
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    const content = mem[0].content as string;
    const [qPart, aPart] = content.split('\nA: ');
    expect(qPart.replace('Q: ', '')).toHaveLength(1000 + '... [truncated]'.length);
    expect(aPart).toHaveLength(1000 + '... [truncated]'.length);
  });

  it('hostile answer content is safely escaped (quotes, $(...), newlines collapsed)', () => {
    const hostileAnswer = 'yes "quoted" $(rm -rf /) `backtick`';
    runHook(
      CAPTURE_QUESTION,
      {
        cwd: projectDir,
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'proceed?', multiSelect: false, options: [] }] },
        tool_response: { answers: { 'proceed?': hostileAnswer } },
      },
      homeDir,
    );
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    expect(mem[0].content).toBe(`Q: proceed?\nA: ${hostileAnswer}`);
  });

  it('AC-F4: gating independent per queue (decisions disabled, memory enabled)', () => {
    writeDreamConfig(projectDir, { decisions: false });
    runHook(CAPTURE_QUESTION, { ...REAL_MULTI_QUESTION_PAYLOAD, cwd: projectDir }, homeDir);
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(2);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'))).toBe(false);
  });

  it('AC-F14: both BG guards -> exit 0, zero writes', () => {
    const r1 = runHook(CAPTURE_QUESTION, { ...REAL_MULTI_QUESTION_PAYLOAD, cwd: projectDir }, homeDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(r1.exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);

    const r2 = runHook(CAPTURE_QUESTION, { ...REAL_MULTI_QUESTION_PAYLOAD, cwd: projectDir }, homeDir, { DEVFLOW_BG_DREAM: '1' });
    expect(r2.exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });
});

// =============================================================================
// memory-worker
// =============================================================================
describe('memory-worker', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  it('120s throttle honored: fresh trigger -> no spawn', () => {
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    const beforeMtime = fs.statSync(triggerFile).mtimeMs;

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    expect(fs.statSync(triggerFile).mtimeMs).toBe(beforeMtime);
  });

  it('touch-before-spawn: stale trigger -> trigger touched, worker spawned', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    expect(fs.statSync(triggerFile).mtimeMs).toBeGreaterThan(Date.now() - 15000);
  });

  it('spawn happens: worker log shows Starting (fake claude shim on PATH)', async () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      JSON.stringify({ role: 'user', content: 'hi', ts: 1 }) + '\n' + JSON.stringify({ role: 'assistant', content: 'hey', ts: 2 }) + '\n',
    );
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    // Poll briefly for the detached worker's log (nohup-spawned, async)
    const logFile = workerLogPath(projectDir, homeDir, 'background-memory-update');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !fs.existsSync(logFile)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain('Starting (CWD=');
  });

  it('both BG guards prevent spawn', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(fs.statSync(triggerFile).mtimeMs).toBeLessThan(Date.now() - 590 * 1000 + 15000);

    backdateMtime(triggerFile, 600);
    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir, { DEVFLOW_BG_DREAM: '1' });
    // Trigger must still be stale — guard fired before the throttle check even ran
    const age = Date.now() - fs.statSync(triggerFile).mtimeMs;
    expect(age).toBeGreaterThan(590 * 1000);
  });

  it('memory:false -> no spawn attempted, no trigger touch', () => {
    writeDreamConfig(projectDir, { memory: false });
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    const age = Date.now() - fs.statSync(triggerFile).mtimeMs;
    expect(age).toBeGreaterThan(590 * 1000);
  });
});

// =============================================================================
// spawn-dream-worker
// =============================================================================
describe('spawn-dream-worker', () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdw-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdw-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdw-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'dream'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
  });

  function fakeClaudeShim(): void {
    const bin = path.join(shimDir, 'claude');
    fs.writeFileSync(bin, `#!/bin/bash\nsleep 0.2\n`);
    fs.chmodSync(bin, 0o755);
  }

  async function waitForWorkerLog(): Promise<string> {
    const logFile = workerLogPath(projectDir, homeDir, 'background-dream-update');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !fs.existsSync(logFile)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
  }

  it('queue non-empty + claude present -> spawns background-dream-update', async () => {
    fakeClaudeShim();
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');

    runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir);

    const log = await waitForWorkerLog();
    expect(log).toContain('Starting (CWD=');
  });

  it('empty queue + no .processing -> no spawn', async () => {
    runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir);
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(workerLogPath(projectDir, homeDir, 'background-dream-update'))).toBe(false);
  });

  it('leftover .processing alone (empty queue) -> spawns', async () => {
    fakeClaudeShim();
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.processing'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');

    runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir);

    const log = await waitForWorkerLog();
    expect(log).toContain('Starting (CWD=');
  });

  it('config decisions:false blocks spawn independently', async () => {
    writeDreamConfig(projectDir, { decisions: false });
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');

    runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir);
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(workerLogPath(projectDir, homeDir, 'background-dream-update'))).toBe(false);
  });

  it('.disabled sentinel blocks spawn independently of the config field', async () => {
    fs.writeFileSync(path.join(projectDir, '.devflow', 'decisions', '.disabled'), '');
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');

    runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir);
    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(workerLogPath(projectDir, homeDir, 'background-dream-update'))).toBe(false);
  });

  it('claude absent from PATH -> clean no-op, no error', () => {
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');
    const { exitCode } = runHook(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, { PATH: '/usr/bin:/bin' });
    expect(exitCode).toBe(0);
  });

  it('never emits stdout, regardless of outcome', () => {
    fakeClaudeShim();
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');
    const { stdout } = runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir);
    expect(stdout.trim()).toBe('');
  });

  it('AC-F14: both BG guards -> exit 0, no spawn', async () => {
    fakeClaudeShim();
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), JSON.stringify({ role: 'assistant', content: 'x', ts: 1 }) + '\n');

    const r1 = runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir, { DEVFLOW_BG_DREAM: '1' });
    expect(r1.exitCode).toBe(0);
    const r2 = runHookWithPath(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, shimDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(r2.exitCode).toBe(0);

    await new Promise((r) => setTimeout(r, 300));
    expect(fs.existsSync(workerLogPath(projectDir, homeDir, 'background-dream-update'))).toBe(false);
  });

  it('AC-P2: synchronous portion completes quickly (no jq parse of the queue)', () => {
    // A large queue file should not slow down the gate check itself, since it
    // only ever does `test -s` (existence + non-empty), never a jq/node parse.
    const bigQueue = Array.from({ length: 500 }, (_, i) => JSON.stringify({ role: 'assistant', content: `line ${i}`, ts: i })).join('\n') + '\n';
    fs.writeFileSync(path.join(projectDir, '.devflow', 'dream', '.pending-turns.jsonl'), bigQueue);
    const start = Date.now();
    runHook(SPAWN_DREAM_WORKER, { cwd: projectDir }, homeDir, { PATH: '/usr/bin:/bin' }); // no claude -> returns fast regardless
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
