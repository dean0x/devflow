/**
 * tests/capture-hooks.test.ts
 *
 * Tests for the capture layer of the dream system: capture-prompt,
 * capture-turn, capture-question, and memory-worker. A dedicated file
 * (mirroring eager-memory-refresh.test.ts's precedent for a redesign-scoped
 * test file) rather than adding to the already-large shell-hooks.test.ts.
 *
 * Harness idioms follow eager-memory-refresh.test.ts: fake-claude PATH shim,
 * temp dirs, DEVFLOW_BG_WATCHDOG_SECS override, runHook + JSON stdin. Real
 * `claude` is never invoked from these tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pollForTerminalLine } from './helpers/poll-for-terminal-line.js';
import { HOOK_RUN_ALLOWANCE_MS, NODE_EXEC_STALL_MS, runHook as runSharedHook, spawnWithStdin } from './shell-hooks-helpers.js';

const HOOKS_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'scripts', 'hooks');
const CAPTURE_PROMPT = path.join(HOOKS_DIR, 'capture-prompt');
const CAPTURE_TURN = path.join(HOOKS_DIR, 'capture-turn');
const CAPTURE_QUESTION = path.join(HOOKS_DIR, 'capture-question');
const MEMORY_WORKER = path.join(HOOKS_DIR, 'memory-worker');

// ---------------------------------------------------------------------------
// Harness helpers (mirrors eager-memory-refresh.test.ts)
// ---------------------------------------------------------------------------

/**
 * The shared runHook (stdin-EPIPE safe: the DEVFLOW_BG_UPDATER guards below exit
 * before reading stdin). The gates read the manifest at $HOME/.devflow only
 * (D-ONE-HOME), so HOME alone decides which manifest they see.
 */
function runHook(
  hookPath: string,
  input: object,
  homeDir: string,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  return runSharedHook(hookPath, input, homeDir, extraEnv);
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
  const stagedFile = `${memFile}.new`;
  fs.writeFileSync(
    bin,
    `#!/bin/bash
# Writes to staged path; worker CAS-mv's it to the real path (D-MEMORY-STAGED-CAS)
echo "<!-- memory-head: testsha branch: main -->" > "${stagedFile}"
echo "## Now" >> "${stagedFile}"
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

/**
 * A per-repo .devflow/config.json. Its top-level memory/learning keys are RETIRED
 * (D-FEATURES-NARROW-ONLY): tests write them only to prove no gate reads them.
 * Only `features.<name>: false` narrows — see writeRepoFile.
 */
function writeFeatureConfig(projectDir: string, fields: Record<string, unknown>): void {
  const dir = path.join(projectDir, '.devflow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(fields));
}

/** Raw bytes for `<projectDir>/.devflow/<name>` (project.json or config.json). */
function writeRepoFile(projectDir: string, name: 'project.json' | 'config.json', bytes: string): void {
  const dir = path.join(projectDir, '.devflow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), bytes);
}

/** A devflow-global manifest.json under `devflowDir` holding `features`. */
function writeManifestFeatures(devflowDir: string, features: Record<string, unknown>): void {
  fs.mkdirSync(devflowDir, { recursive: true });
  fs.writeFileSync(path.join(devflowDir, 'manifest.json'), JSON.stringify({ version: '2.0.0', features }));
}

/** Switch features machine-wide, the way `devflow init` records them. */
function writeMachineFeatures(homeDir: string, features: Record<string, unknown>): void {
  writeManifestFeatures(path.join(homeDir, '.devflow'), features);
}

/**
 * A temp project inside a git checkout. The capture and memory hooks scaffold
 * `.devflow/` only in a git project (D-HOOKS-GIT-ONLY, via ensure-devflow-init),
 * so every fixture that expects a write carries a `.git` marker. An empty
 * directory satisfies df_has_git_marker and is not a repository to
 * `git rev-parse`, so the resolved project root is the directory itself.
 */
function makeGitProject(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
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
    projectDir = makeGitProject('cap-prompt-');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prompt-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('AC-F1: both features enabled (no config) -> one {role:"user"} row to BOTH queues', () => {
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'hello world' }, homeDir);
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    const learning = readJsonl(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'));
    expect(mem).toEqual([{ role: 'user', content: 'hello world', ts: expect.any(Number) }]);
    expect(learning).toEqual([{ role: 'user', content: 'hello world', ts: expect.any(Number) }]);
  });

  it('AC-F1: long prompt passes through whole (no truncation)', () => {
    const longPrompt = 'x'.repeat(2500);
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: longPrompt }, homeDir);
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    expect((mem[0].content as string)).toBe(longPrompt);
  });

  it('empty prompt -> zero appends, no .devflow scaffolding', () => {
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: '' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('AC-F4: memory switched off -> no memory-queue append (learning append unaffected)', () => {
    writeMachineFeatures(homeDir, { memory: false });
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(readJsonl(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'))).toHaveLength(1);
  });

  it('AC-F4: learning switched off -> no learning-queue append (memory unaffected)', () => {
    writeMachineFeatures(homeDir, { learning: false });
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(1);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'))).toBe(false);
  });

  it('both disabled -> zero appends, no scaffolding', () => {
    writeMachineFeatures(homeDir, { memory: false, learning: false });
    runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'))).toBe(false);
  });

  it('AC-F14: DEVFLOW_BG_UPDATER=1 -> exit 0, zero filesystem writes', () => {
    const { exitCode } = runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'test' }, homeDir, { DEVFLOW_BG_UPDATER: '1' });
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
    projectDir = makeGitProject('cap-turn-');
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
    expect(readJsonl(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'))).toEqual([
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

  it('AC-F4: gating independent per queue (memory:false, learning enabled)', () => {
    writeMachineFeatures(homeDir, { memory: false });
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'x' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
    expect(readJsonl(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'))).toHaveLength(1);
  });

  it('AC-F14: DEVFLOW_BG_UPDATER=1 -> exit 0, zero filesystem writes', () => {
    const { exitCode } = runHook(
      CAPTURE_TURN,
      { cwd: projectDir, session_id: 't', last_assistant_message: 'hi' },
      homeDir,
      { DEVFLOW_BG_UPDATER: '1' },
    );
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('long message passes through whole (no truncation)', () => {
    const longMessage = 'b'.repeat(5000);
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: longMessage }, homeDir);
    const mem = readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'));
    expect((mem[0].content as string)).toBe(longMessage);
  });

  it('ignores legacy response_text field — only last_assistant_message gates capture', () => {
    // Regression guard: a payload carrying only the old field name
    // (response_text) and not last_assistant_message must produce zero appends.
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', response_text: 'this should be ignored' }, homeDir);
    expect(fs.existsSync(path.join(projectDir, '.devflow'))).toBe(false);
  });

  it('creates its own log file tagged [capture-turn] on successful capture', () => {
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 't', last_assistant_message: 'hello' }, homeDir);
    const logFile = workerLogPath(projectDir, homeDir, 'capture-turn');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain('[capture-turn]');
  });
});

// =============================================================================
// capture-question
// =============================================================================
describe('capture-question', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = makeGitProject('cap-question-');
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
          question: 'How should I handle the Phase 5 Scrutinize review?',
          header: 'Scrutinize',
          multiSelect: false,
          options: [{ label: 'Re-run, inert probes only' }, { label: 'Skip Scrutinize entirely' }],
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
        'How should I handle the Phase 5 Scrutinize review?': 'Re-run, inert probes only',
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
    const learning = readJsonl(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'));
    expect(mem).toHaveLength(2);
    expect(learning).toHaveLength(2);
    expect(mem[0]).toMatchObject({
      role: 'qa',
      content: 'Q: How should I handle the Phase 5 Scrutinize review?\nA: Re-run, inert probes only',
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

  it('long Q and A pass through whole (no truncation)', () => {
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
    expect(qPart.replace('Q: ', '')).toBe(longQ);
    expect(aPart).toBe(longA);
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

  it('AC-F4: gating independent per queue (learning disabled, memory enabled)', () => {
    writeMachineFeatures(homeDir, { learning: false });
    runHook(CAPTURE_QUESTION, { ...REAL_MULTI_QUESTION_PAYLOAD, cwd: projectDir }, homeDir);
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(2);
    expect(fs.existsSync(path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl'))).toBe(false);
  });

  it('AC-F14: DEVFLOW_BG_UPDATER=1 -> exit 0, zero writes', () => {
    const r1 = runHook(CAPTURE_QUESTION, { ...REAL_MULTI_QUESTION_PAYLOAD, cwd: projectDir }, homeDir, { DEVFLOW_BG_UPDATER: '1' });
    expect(r1.exitCode).toBe(0);
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
    projectDir = makeGitProject('mem-worker-');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.devflow', 'learning'), { recursive: true });
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

    // Poll for the detached worker's log to contain a terminal line.
    // Bounded: 4000ms per attempt, ≤3 attempts total, explicit 15000ms it-timeout.
    const logFile = workerLogPath(projectDir, homeDir, 'background-memory-update');
    const found = await pollForTerminalLine(logFile, 'Starting (CWD=', 4000, 3);
    expect(found).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain('Starting (CWD=');
  }, 15000);

  it('BG_UPDATER guard prevents spawn', () => {
    const memFile = path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
    createFakeClaudeShim(shimDir, memFile);
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir, { DEVFLOW_BG_UPDATER: '1' });
    // Trigger must still be stale — guard fired before the throttle check even ran
    const age = Date.now() - fs.statSync(triggerFile).mtimeMs;
    expect(age).toBeGreaterThan(590 * 1000);
  });

  it('memory:false -> no spawn attempted, no trigger touch', () => {
    writeMachineFeatures(homeDir, { memory: false });
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    const age = Date.now() - fs.statSync(triggerFile).mtimeMs;
    expect(age).toBeGreaterThan(590 * 1000);
  });

  // ---------------------------------------------------------------------------
  // D-FEATURES-NARROW-ONLY — the machine layer: features.memory in ~/.devflow/manifest.json
  // ---------------------------------------------------------------------------

  it('manifest memory:false -> no spawn attempted, no trigger touch, although the repo config says true', () => {
    writeFeatureConfig(projectDir, { memory: true });
    writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: false });
    createFakeClaudeShim(shimDir, path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md'));
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    const age = Date.now() - fs.statSync(triggerFile).mtimeMs;
    expect(age).toBeGreaterThan(590 * 1000);
  });

  it('a stale repo config memory:false does not switch the worker off', () => {
    writeFeatureConfig(projectDir, { memory: false });
    writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: true });
    createFakeClaudeShim(shimDir, path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md'));
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    expect(fs.statSync(triggerFile).mtimeMs).toBeGreaterThan(Date.now() - 15000);
  });

  it('a manifest without the memory key leaves the worker on (fail-open)', () => {
    writeManifestFeatures(path.join(homeDir, '.devflow'), { learning: false });
    createFakeClaudeShim(shimDir, path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md'));
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');
    fs.writeFileSync(triggerFile, '');
    backdateMtime(triggerFile, 600);

    runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir);

    expect(fs.statSync(triggerFile).mtimeMs).toBeGreaterThan(Date.now() - 15000);
  });

  it('hands the spawned worker the machine-root manifest, not one under the project .devflow or an exported DEVFLOW_DIR', async () => {
    // The worker re-reads the switch after spawn against the manifest path it is
    // handed ($HOME/.devflow, D-ONE-HOME). Decoy "off" manifests under the project
    // .devflow and under an exported DEVFLOW_DIR prove it read neither.
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-override-'));
    try {
      writeManifestFeatures(path.join(homeDir, '.devflow'), { learning: true });
      writeManifestFeatures(overrideDir, { memory: false });
      writeManifestFeatures(path.join(projectDir, '.devflow'), { memory: false });
      const invokedMarker = path.join(shimDir, 'claude-invoked');
      fs.writeFileSync(path.join(shimDir, 'claude'), `#!/bin/bash\necho invoked >> "${invokedMarker}"\nexit 1\n`);
      fs.chmodSync(path.join(shimDir, 'claude'), 0o755);
      fs.writeFileSync(
        path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
        JSON.stringify({ role: 'user', content: 'hi', ts: 1 }) + '\n' + JSON.stringify({ role: 'assistant', content: 'hey', ts: 2 }) + '\n',
      );

      runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir, { DEVFLOW_DIR: overrideDir });

      // Bounded: 4000ms per attempt, ≤3 attempts total, explicit 15000ms it-timeout.
      expect(await pollForTerminalLine(invokedMarker, 'invoked', 4000, 3)).toBe(true);
      const log = fs.readFileSync(workerLogPath(projectDir, homeDir, 'background-memory-update'), 'utf-8');
      expect(log).not.toContain('ABORT: memory disabled');
    } finally {
      fs.rmSync(overrideDir, { recursive: true, force: true });
    }
  }, 15000);
});

// =============================================================================
// background-memory-update — the post-spawn re-check honours the switch too
// =============================================================================
const BG_UPDATER = path.join(HOOKS_DIR, 'background-memory-update');

/** The watchdog these runs set (DEVFLOW_BG_WATCHDOG_SECS): claude is SIGTERMed after it. */
const TEST_WATCHDOG_SECS = 2;

/** The worker's SIGTERM→SIGKILL grace, read from the worker itself so the bound follows it. */
const WORKER_KILL_GRACE_SECS = Number(
  /^WATCHDOG_KILL_GRACE_SECS=(\d+)/m.exec(fs.readFileSync(BG_UPDATER, 'utf-8'))?.[1],
);

/**
 * Allowance for the worker's bounded shell work around the claude run (queue claim,
 * JSON parsing, git evidence, CAS) on a loaded machine. Everything else in the bound
 * is the worker's own contract, derived rather than guessed.
 */
const WORKER_SHELL_BUDGET_MS = 20_000;

/**
 * The longest one synchronous worker run can take: the claude child is killed no
 * later than watchdog + grace, and the rest is WORKER_SHELL_BUDGET_MS. A default 5 s
 * test timeout sat INSIDE that bound, so a loaded machine failed a correct worker.
 * The execSync carries the bound too, so a genuinely hung worker still fails fast
 * and names itself instead of hitting the test timeout.
 */
const WORKER_RUN_BOUND_MS = (TEST_WATCHDOG_SECS + WORKER_KILL_GRACE_SECS) * 1000 + WORKER_SHELL_BUDGET_MS;

describe('background-memory-update: the memory switch (D-FEATURES-NARROW-ONLY)', { timeout: WORKER_RUN_BOUND_MS + 5_000 }, () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;
  let invokedMarker: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-switch-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-switch-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-switch-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'),
      JSON.stringify({ role: 'user', content: 'hi', ts: 1 }) + '\n' + JSON.stringify({ role: 'assistant', content: 'hey', ts: 2 }) + '\n',
    );
    writeFeatureConfig(projectDir, { memory: true });
    // A claude stand-in, so a run that fails to abort can never reach the real one.
    invokedMarker = path.join(shimDir, 'claude-invoked');
    fs.writeFileSync(path.join(shimDir, 'claude'), `#!/bin/bash\ntouch "${invokedMarker}"\nexit 1\n`);
    fs.chmodSync(path.join(shimDir, 'claude'), 0o755);
  });

  afterEach(() => {
    for (const dir of [projectDir, homeDir, shimDir]) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The worker got past the machine-wide memory gate and launched claude.
   *
   * Asserted from the worker's OWN log, which it writes synchronously: `runWorker`
   * is an execSync, and the worker `wait`s on the claude child before it logs the
   * run's outcome, so every line below is on disk when the call returns — there is
   * nothing to poll and no race to lose. The gate sits before `Spawning claude -p`,
   * so that line proves the gate let the run through; the outcome line proves the
   * spawn really happened, whichever way the stand-in ended.
   *
   * Not a marker the claude stand-in touches: that races the test watchdog. Under
   * heavy load the watchdog can SIGTERM the stand-in's process group before its bash
   * has started, so the marker is never written and a worker that passed the gate
   * reads as one that did not — a measure of the stand-in's scheduling, not of the
   * gate. A longer watchdog would only move that cliff; the worker's log has none.
   */
  function expectWorkerPassedTheGate(): void {
    const log = fs.readFileSync(workerLogPath(projectDir, homeDir, 'background-memory-update'), 'utf-8');
    expect(log).not.toContain('ABORT: memory disabled');
    expect(log).toContain('Spawning claude -p');
    // The stand-in exits 1 when it runs; the watchdog's kill is the loaded-machine arm.
    expect(log).toMatch(new RegExp(`FAIL: claude -p (exited with code 1|killed by watchdog after ${TEST_WATCHDOG_SECS}s)`));
  }

  /** `retiredDevflowDir`, when given, is exported as DEVFLOW_DIR — which the worker must ignore. */
  function runWorker(retiredDevflowDir?: string, manifestArg?: string): void {
    const args = manifestArg === undefined ? `"${projectDir}"` : `"${projectDir}" "${manifestArg}"`;
    execSync(`bash "${BG_UPDATER}" ${args}`, {
      env: {
        ...process.env,
        HOME: homeDir,
        ...(retiredDevflowDir === undefined ? {} : { DEVFLOW_DIR: retiredDevflowDir }),
        PATH: `${shimDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        // A run that gets past the gate reaches the claude watchdog: 2s, not 120s.
        DEVFLOW_BG_WATCHDOG_SECS: String(TEST_WATCHDOG_SECS),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: WORKER_RUN_BOUND_MS,
    });
  }

  it('the run bound is derived from the worker (non-vacuity: the grace was found)', () => {
    expect(Number.isInteger(WORKER_KILL_GRACE_SECS) && WORKER_KILL_GRACE_SECS > 0).toBe(true);
  });

  it('aborts before resolving claude when the manifest switches memory off, although the repo config says true', () => {
    writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: false });

    runWorker();

    expect(fs.readFileSync(workerLogPath(projectDir, homeDir, 'background-memory-update'), 'utf-8'))
      .toContain('ABORT: memory disabled');
    expect(fs.existsSync(invokedMarker)).toBe(false);
    // The queue is left for `devflow init --memory` to find, not consumed.
    expect(readJsonl(path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(2);
  });

  it('a stale repo config memory:false does not abort the worker', () => {
    writeFeatureConfig(projectDir, { memory: false });

    runWorker();

    expectWorkerPassedTheGate();
  });

  it('reads the manifest path it is handed as its second argument', () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-switch-override-'));
    try {
      writeManifestFeatures(overrideDir, { memory: false });
      // A decoy under $HOME that would say "on" if the argument were ignored.
      writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: true });

      runWorker(undefined, path.join(overrideDir, 'manifest.json'));

      expect(fs.readFileSync(workerLogPath(projectDir, homeDir, 'background-memory-update'), 'utf-8'))
        .toContain('ABORT: memory disabled');
      expect(fs.existsSync(invokedMarker)).toBe(false);
    } finally {
      fs.rmSync(overrideDir, { recursive: true, force: true });
    }
  });

  it('without that argument, reads $HOME/.devflow and ignores an exported DEVFLOW_DIR (D-ONE-HOME, AC-10)', () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-switch-override-'));
    try {
      writeManifestFeatures(overrideDir, { memory: false });
      writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: false });

      runWorker(overrideDir);

      // The machine root's "off" governs...
      expect(fs.readFileSync(workerLogPath(projectDir, homeDir, 'background-memory-update'), 'utf-8'))
        .toContain('ABORT: memory disabled');
      expect(fs.existsSync(invokedMarker)).toBe(false);
      // ...and the exported directory is never written to.
      expect(fs.readdirSync(overrideDir).sort()).toEqual(['manifest.json']);
    } finally {
      fs.rmSync(overrideDir, { recursive: true, force: true });
    }
  });

  it('an exported DEVFLOW_DIR whose manifest says off does not stop a worker the machine root allows', () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmu-switch-override-'));
    try {
      writeManifestFeatures(overrideDir, { memory: false });
      writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: true });

      runWorker(overrideDir);

      expectWorkerPassedTheGate();
    } finally {
      fs.rmSync(overrideDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// capture-prompt + capture-turn integration
// =============================================================================
describe('capture-prompt + capture-turn integration', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = makeGitProject('cap-integ-');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-integ-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('user turn then assistant turn are appended in order to both queues', () => {
    runHook(CAPTURE_PROMPT, { cwd: projectDir, session_id: 'integ', prompt: 'implement feature X' }, homeDir);
    runHook(CAPTURE_TURN, { cwd: projectDir, session_id: 'integ', last_assistant_message: 'done' }, homeDir);

    for (const queue of ['memory', 'learning'] as const) {
      const rows = readJsonl(path.join(projectDir, '.devflow', queue, '.pending-turns.jsonl'));
      expect(rows).toEqual([
        { role: 'user', content: 'implement feature X', ts: expect.any(Number) },
        { role: 'assistant', content: 'done', ts: expect.any(Number) },
      ]);
    }
  });
});

// =============================================================================
// D-FEATURES-NARROW-ONLY — the machine layer, and the retired per-repo keys
// =============================================================================
// `devflow init --no-learning` / `--no-memory` (and `devflow learning|memory
// --disable`) record features.learning:false / features.memory:false in
// ~/.devflow/manifest.json. Every capture hook must honour them in EVERY repo,
// and must ignore the retired per-repo keys either way: a stale `true` an
// earlier init wrote cannot keep a feature on, a stale `false` cannot turn it off.
describe('capture hooks read the machine-wide memory and learning switches only', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = makeGitProject('cap-switch-');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-switch-home-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  // These assertions are about which manifest is read; HOME alone decides it.
  const ENV = {};
  const learningQueue = () => path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl');
  const memoryQueue = () => path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');

  const HOOKS: ReadonlyArray<readonly [string, string, () => object, number]> = [
    ['capture-prompt', CAPTURE_PROMPT, () => ({ cwd: projectDir, prompt: 'we chose X over Y' }), 1],
    ['capture-turn', CAPTURE_TURN, () => ({ cwd: projectDir, session_id: 's', last_assistant_message: 'done' }), 1],
    [
      'capture-question',
      CAPTURE_QUESTION,
      () => ({
        cwd: projectDir,
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Proceed?' }] },
        tool_response: { answers: { 'Proceed?': 'yes' } },
      }),
      1,
    ],
  ];

  for (const [name, hook, input, rows] of HOOKS) {
    it(`${name}: switched off machine-wide → no learning append although the repo config says true`, () => {
      writeFeatureConfig(projectDir, { memory: true, learning: true });
      writeManifestFeatures(path.join(homeDir, '.devflow'), { learning: false });

      const { exitCode } = runHook(hook, input(), homeDir, ENV);
      expect(exitCode).toBe(0);
      expect(fs.existsSync(learningQueue())).toBe(false);
      // Each switch clears only its own gate: memory keeps capturing.
      expect(readJsonl(memoryQueue())).toHaveLength(rows);
    });

    it(`${name}: switched off machine-wide → no learning append in a repo with no config`, () => {
      writeManifestFeatures(path.join(homeDir, '.devflow'), { learning: false });

      runHook(hook, input(), homeDir, ENV);
      expect(fs.existsSync(learningQueue())).toBe(false);
    });

    it(`${name}: a manifest without the key leaves learning on (fail-open)`, () => {
      writeManifestFeatures(path.join(homeDir, '.devflow'), { ambient: true });

      runHook(hook, input(), homeDir, ENV);
      expect(readJsonl(learningQueue())).toHaveLength(rows);
    });

    it(`${name}: a stale repo config learning:false does not switch learning off`, () => {
      writeFeatureConfig(projectDir, { memory: false, learning: false });
      writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: true, learning: true });

      runHook(hook, input(), homeDir, ENV);
      expect(readJsonl(learningQueue())).toHaveLength(rows);
      expect(readJsonl(memoryQueue())).toHaveLength(rows);
    });

    // `devflow init --no-memory` removes the memory hooks and records
    // features.memory:false, but these capture hooks stay registered — they must
    // stop feeding a memory queue nothing will ever process.
    it(`${name}: memory switched off machine-wide → no memory append although the repo config says true`, () => {
      writeFeatureConfig(projectDir, { memory: true, learning: true });
      writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: false });

      const { exitCode } = runHook(hook, input(), homeDir, ENV);
      expect(exitCode).toBe(0);
      expect(fs.existsSync(memoryQueue())).toBe(false);
      // Each switch clears only its own gate: learning keeps capturing.
      expect(readJsonl(learningQueue())).toHaveLength(rows);
    });

    it(`${name}: memory switched off machine-wide → no memory append in a repo with no config`, () => {
      writeManifestFeatures(path.join(homeDir, '.devflow'), { memory: false });

      runHook(hook, input(), homeDir, ENV);
      expect(fs.existsSync(memoryQueue())).toBe(false);
    });

    it(`${name}: a manifest without the memory key leaves memory on (fail-open)`, () => {
      writeManifestFeatures(path.join(homeDir, '.devflow'), { learning: true });

      runHook(hook, input(), homeDir, ENV);
      expect(readJsonl(memoryQueue())).toHaveLength(rows);
    });

    it(`${name}: no config and no manifest → both queues capture (fail-open)`, () => {
      runHook(hook, input(), homeDir, ENV);
      expect(readJsonl(memoryQueue())).toHaveLength(rows);
      expect(readJsonl(learningQueue())).toHaveLength(rows);
    });
  }

  it('the manifest is read from $HOME/.devflow; an exported DEVFLOW_DIR is ignored and stays empty (D-ONE-HOME, AC-10)', () => {
    const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-switch-override-'));
    try {
      // A decoy under the retired override that would say "off" if it were read.
      writeManifestFeatures(overrideDir, { learning: false });
      writeManifestFeatures(path.join(homeDir, '.devflow'), { learning: true });

      runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'hello' }, homeDir, { DEVFLOW_DIR: overrideDir });
      expect(readJsonl(learningQueue())).toHaveLength(1);
      expect(readJsonl(memoryQueue())).toHaveLength(1);
      expect(fs.readdirSync(overrideDir).sort()).toEqual(['manifest.json']);
    } finally {
      fs.rmSync(overrideDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// TP-34 (AC-30): a repository narrows capture for itself (D-FEATURES-NARROW-ONLY).
// `features.learning: false` in a committed project.json — or in the worktree's
// own config.json — silences that queue here while the machine switch stays on.

/**
 * The budget of every test in the two narrowing groups below: one hook run plus
 * one node exec that may meet the syspolicyd wait. A repository file that can
 * narrow costs a hook run exactly one node exec — resolve-settings.cjs's fold
 * (D-GATES-FAST-PATH, pinned at one fork by TP-34 in queue-append.test.ts) —
 * and that exec is intended: the parser, not a shell copy of it, decides the
 * file. The hook's stdin parse is jq when jq is installed; where it falls back
 * to node, that exec comes first and the fold then meets a drained queue, so a
 * test still pays the wait at most once.
 */
const NARROWING_TEST_BUDGET_MS = HOOK_RUN_ALLOWANCE_MS + NODE_EXEC_STALL_MS;

describe('capture hooks honour a repository narrowing (D-FEATURES-NARROW-ONLY)', { timeout: NARROWING_TEST_BUDGET_MS }, () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    projectDir = makeGitProject('cap-narrow-');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-narrow-home-'));
    writeMachineFeatures(homeDir, { memory: true, learning: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const learningQueue = () => path.join(projectDir, '.devflow', 'learning', '.pending-turns.jsonl');
  const memoryQueue = () => path.join(projectDir, '.devflow', 'memory', '.pending-turns.jsonl');

  const HOOKS: ReadonlyArray<readonly [string, string, () => object]> = [
    ['capture-prompt', CAPTURE_PROMPT, () => ({ cwd: projectDir, prompt: 'we chose X over Y' })],
    ['capture-turn', CAPTURE_TURN, () => ({ cwd: projectDir, session_id: 's', last_assistant_message: 'done' })],
    [
      'capture-question',
      CAPTURE_QUESTION,
      () => ({
        cwd: projectDir,
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Proceed?' }] },
        tool_response: { answers: { 'Proceed?': 'yes' } },
      }),
    ],
  ];

  for (const [name, hook, input] of HOOKS) {
    it(`${name}: project.json features.learning false silences learning capture; memory keeps capturing`, () => {
      writeRepoFile(projectDir, 'project.json', '{"version":1,"features":{"learning":false}}');

      expect(runHook(hook, input(), homeDir).exitCode).toBe(0);
      expect(fs.existsSync(learningQueue())).toBe(false);
      expect(readJsonl(memoryQueue())).toHaveLength(1);
    });

    it(`${name}: config.json features.memory false silences memory capture; learning keeps capturing`, () => {
      writeRepoFile(projectDir, 'config.json', '{"features":{"memory":false}}');

      expect(runHook(hook, input(), homeDir).exitCode).toBe(0);
      expect(fs.existsSync(memoryQueue())).toBe(false);
      expect(readJsonl(learningQueue())).toHaveLength(1);
    });

    it(`${name}: a repository true never widens a machine off`, () => {
      writeMachineFeatures(homeDir, { learning: false });
      writeRepoFile(projectDir, 'project.json', '{"features":{"learning":true,"memory":true}}');

      runHook(hook, input(), homeDir);
      expect(fs.existsSync(learningQueue())).toBe(false);
      expect(readJsonl(memoryQueue())).toHaveLength(1);
    });

    it(`${name}: the legacy top-level keys in project.json narrow nothing`, () => {
      writeRepoFile(projectDir, 'project.json', '{"memory":false,"learning":false,"decisions":false}');

      runHook(hook, input(), homeDir);
      expect(readJsonl(memoryQueue())).toHaveLength(1);
      expect(readJsonl(learningQueue())).toHaveLength(1);
    });
  }

  it('a session started in a subdirectory reads the toplevel\'s project.json', () => {
    // A real repository, so the root comes from git: PROJECT_ROOT (DF_ROOT) is
    // the toplevel, not the directory Claude Code was launched in.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-narrow-repo-'));
    try {
      execSync('git init -q', { cwd: repo });
      const sub = path.join(repo, 'packages', 'app');
      fs.mkdirSync(sub, { recursive: true });
      writeRepoFile(repo, 'project.json', '{"features":{"learning":false}}');

      expect(runHook(CAPTURE_PROMPT, { cwd: sub, prompt: 'hello' }, homeDir).exitCode).toBe(0);
      expect(fs.existsSync(path.join(repo, '.devflow', 'learning', '.pending-turns.jsonl'))).toBe(false);
      expect(readJsonl(path.join(repo, '.devflow', 'memory', '.pending-turns.jsonl'))).toHaveLength(1);
      expect(fs.existsSync(path.join(sub, '.devflow'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('memory-worker: a repository narrowing stops the spawn (D-FEATURES-NARROW-ONLY)', { timeout: NARROWING_TEST_BUDGET_MS }, () => {
  let projectDir: string;
  let homeDir: string;
  let shimDir: string;

  beforeEach(() => {
    projectDir = makeGitProject('mem-worker-narrow-');
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-narrow-home-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-worker-narrow-shim-'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    writeMachineFeatures(homeDir, { memory: true });
  });

  afterEach(() => {
    for (const dir of [projectDir, homeDir, shimDir]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('project.json features.memory false: no trigger touch, no spawn', () => {
    writeRepoFile(projectDir, 'project.json', '{"features":{"memory":false}}');
    const triggerFile = path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger');

    expect(runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir).exitCode).toBe(0);
    expect(fs.existsSync(triggerFile)).toBe(false);
  });
});

// =============================================================================
// D-HOOKS-NO-SYMLINK: no capture hook writes through a symbolic link
// =============================================================================
// A repository can commit a symbolic link anywhere in its own .devflow/. An
// append (`>>`) and a `touch` follow one, and `mkdir -p` creates folders inside a
// linked folder, so a linked queue or folder would put captured conversation text
// into whatever file the link names. Each such write is skipped instead: the
// link's target is left byte-identical, the refusal is logged once, and the hook
// exits 0 as it does for any skipped capture.
describe('capture hooks never write through a symbolic link under .devflow (D-HOOKS-NO-SYMLINK)', () => {
  const UNTOUCHED = 'a file outside the project, which no hook may write\n';
  let tmp: string;
  let projectDir: string;
  let homeDir: string;
  let outsideFile: string;
  let outsideDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-nolink-'));
    projectDir = path.join(tmp, 'repo');
    homeDir = path.join(tmp, 'home');
    outsideFile = path.join(tmp, 'outside.txt');
    outsideDir = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
    fs.mkdirSync(homeDir);
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(outsideFile, UNTOUCHED);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const memoryQueue = (root = projectDir): string => path.join(root, '.devflow', 'memory', '.pending-turns.jsonl');
  const learningQueue = (root = projectDir): string => path.join(root, '.devflow', 'learning', '.pending-turns.jsonl');
  const isLink = (file: string): boolean => fs.lstatSync(file).isSymbolicLink();
  const modeOf = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8);

  /** The lines of `hookName`'s own log for `cwd` that report a refused write. */
  const refusals = (hookName: string, cwd = projectDir): string[] => {
    const log = workerLogPath(cwd, homeDir, hookName);
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n').filter((l) => l.includes('symbolic link')) : [];
  };

  const HOOKS: ReadonlyArray<readonly [string, string, () => object]> = [
    ['capture-prompt', CAPTURE_PROMPT, () => ({ cwd: projectDir, prompt: 'we chose X over Y' })],
    ['capture-turn', CAPTURE_TURN, () => ({ cwd: projectDir, session_id: 's', last_assistant_message: 'done' })],
    [
      'capture-question',
      CAPTURE_QUESTION,
      () => ({
        cwd: projectDir,
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Proceed?' }] },
        tool_response: { answers: { 'Proceed?': 'yes' } },
      }),
    ],
  ];

  for (const [name, hook, input] of HOOKS) {
    it(`${name}: a link at the memory queue path leaves its target byte-identical; the learning queue still captures`, () => {
      fs.mkdirSync(path.dirname(memoryQueue()), { recursive: true });
      fs.symlinkSync(outsideFile, memoryQueue());

      expect(runHook(hook, input(), homeDir).exitCode).toBe(0);

      expect(fs.readFileSync(outsideFile, 'utf-8'), 'the link target is byte-identical').toBe(UNTOUCHED);
      expect(isLink(memoryQueue()), 'the link is left as it was').toBe(true);
      expect(readJsonl(learningQueue()), 'the other queue still captures').toHaveLength(1);
      expect(refusals(name), 'the refusal is logged once').toHaveLength(1);
    });

    it(`${name}: a link at the learning queue path leaves its target byte-identical; the memory queue still captures`, () => {
      fs.mkdirSync(path.dirname(learningQueue()), { recursive: true });
      fs.symlinkSync(outsideFile, learningQueue());

      expect(runHook(hook, input(), homeDir).exitCode).toBe(0);

      expect(fs.readFileSync(outsideFile, 'utf-8'), 'the link target is byte-identical').toBe(UNTOUCHED);
      expect(isLink(learningQueue()), 'the link is left as it was').toBe(true);
      expect(readJsonl(memoryQueue()), 'the other queue still captures').toHaveLength(1);
      expect(refusals(name), 'the refusal is logged once').toHaveLength(1);
    });

    it(`${name}: a linked .devflow/memory folder is refused the same way`, () => {
      fs.mkdirSync(path.join(projectDir, '.devflow'));
      fs.symlinkSync(outsideDir, path.join(projectDir, '.devflow', 'memory'));

      expect(runHook(hook, input(), homeDir).exitCode).toBe(0);

      expect(fs.readdirSync(outsideDir), 'nothing is created in the folder the link names').toEqual([]);
      expect(readJsonl(learningQueue()), 'the other queue still captures').toHaveLength(1);
      expect(refusals(name), 'the refusal is logged once').toHaveLength(1);
    });
  }

  it('a linked .devflow/learning folder is refused the same way; the memory queue still captures', () => {
    fs.mkdirSync(path.join(projectDir, '.devflow'));
    fs.symlinkSync(outsideDir, path.join(projectDir, '.devflow', 'learning'));

    expect(runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'we chose X over Y' }, homeDir).exitCode).toBe(0);

    expect(fs.readdirSync(outsideDir), 'nothing is created in the folder the link names').toEqual([]);
    expect(readJsonl(memoryQueue())).toHaveLength(1);
    expect(refusals('capture-prompt')).toHaveLength(1);
  });

  it('a linked .devflow folder: the hook exits 0 and creates nothing where the link points', () => {
    fs.symlinkSync(outsideDir, path.join(projectDir, '.devflow'));

    expect(runHook(CAPTURE_PROMPT, { cwd: projectDir, prompt: 'we chose X over Y' }, homeDir).exitCode).toBe(0);

    expect(fs.readdirSync(outsideDir), 'nothing is created in the folder the link names').toEqual([]);
    expect(refusals('capture-prompt'), 'the refusal is logged once').toHaveLength(1);
  });

  it('a normal path still appends, and each queue it creates is 0600 whatever the caller umask', () => {
    const run = spawnWithStdin('bash', ['-c', 'umask 022 && exec bash "$0"', CAPTURE_PROMPT], {
      input: JSON.stringify({ cwd: projectDir, prompt: 'we chose X over Y' }),
      env: { ...process.env, HOME: homeDir },
    });

    expect(run.kind, run.stderr).toBe('clean');
    for (const queue of [memoryQueue(), learningQueue()]) {
      expect(readJsonl(queue), `${queue} captured the turn`).toEqual([{ role: 'user', content: 'we chose X over Y', ts: expect.any(Number) }]);
      expect(modeOf(queue), `${queue} holds conversation text, so it is owner-only`).toBe('600');
    }
    expect(refusals('capture-prompt'), 'nothing was refused').toEqual([]);
  });

  it('a project whose root sits under a linked parent still captures normally', () => {
    // Only the path below the root is checked: on macOS the temp tree itself sits
    // behind /var -> /private/var, and this builds the same shape on any platform.
    // The empty `.git` is a marker git cannot read, so the root stays the cwd, link included.
    const realParent = path.join(tmp, 'real-parent');
    const linkedParent = path.join(tmp, 'linked-parent');
    fs.mkdirSync(path.join(realParent, 'repo', '.git'), { recursive: true });
    fs.symlinkSync(realParent, linkedParent);
    const cwd = path.join(linkedParent, 'repo');

    expect(runHook(CAPTURE_PROMPT, { cwd, prompt: 'we chose X over Y' }, homeDir).exitCode).toBe(0);

    expect(readJsonl(memoryQueue(cwd))).toHaveLength(1);
    expect(readJsonl(learningQueue(cwd))).toHaveLength(1);
    expect(refusals('capture-prompt', cwd), 'nothing was refused').toEqual([]);
  });

  // A real repository under a linked parent: git names its roots with every link
  // resolved, while the cwd keeps the spelling it was given. Each queue is built from
  // the root it is checked against, so the two spellings never meet in one check; a
  // queue checked against the other spelling would be refused as not below its root.
  describe('a real git repository reached through a linked parent', () => {
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
    };
    let realParent: string;
    let linkedParent: string;

    beforeEach(() => {
      realParent = path.join(tmp, 'real-parent');
      linkedParent = path.join(tmp, 'linked-parent');
      fs.mkdirSync(path.join(realParent, 'main'), { recursive: true });
      git(path.join(realParent, 'main'), 'init', '-q');
      fs.symlinkSync(realParent, linkedParent);
    });

    it('a checkout captures to both of its queues', () => {
      const cwd = path.join(linkedParent, 'main');

      expect(runHook(CAPTURE_PROMPT, { cwd, prompt: 'we chose X over Y' }, homeDir).exitCode).toBe(0);

      expect(readJsonl(memoryQueue(path.join(realParent, 'main')))).toHaveLength(1);
      expect(readJsonl(learningQueue(path.join(realParent, 'main')))).toHaveLength(1);
      expect(refusals('capture-prompt', cwd), 'nothing was refused').toEqual([]);
    });

    it('a linked worktree captures memory to its own queue and learning to the main checkout\'s', () => {
      const main = path.join(realParent, 'main');
      git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
      fs.mkdirSync(path.join(main, '.devflow'));
      git(main, 'worktree', 'add', '-q', path.join(realParent, 'wt'), '-b', 'wt');
      const cwd = path.join(linkedParent, 'wt');

      expect(runHook(CAPTURE_PROMPT, { cwd, prompt: 'we chose X over Y' }, homeDir).exitCode).toBe(0);

      expect(readJsonl(memoryQueue(path.join(realParent, 'wt')))).toHaveLength(1);
      expect(readJsonl(learningQueue(main)), 'the ledger is the repository\'s: the main checkout\'s').toHaveLength(1);
      expect(fs.existsSync(learningQueue(path.join(realParent, 'wt'))), 'no learning queue in the worktree').toBe(false);
      expect(refusals('capture-prompt', cwd), 'nothing was refused').toEqual([]);
    });
  });

  it('memory-worker: a link at the throttle file creates nothing where it points, and no worker is spawned', () => {
    const shimDir = path.join(tmp, 'shim');
    fs.mkdirSync(shimDir);
    createFakeClaudeShim(shimDir, path.join(projectDir, '.devflow', 'memory', 'WORKING-MEMORY.md'));
    fs.mkdirSync(path.join(projectDir, '.devflow', 'memory'), { recursive: true });
    const created = path.join(tmp, 'created-through-the-link');
    fs.symlinkSync(created, path.join(projectDir, '.devflow', 'memory', '.working-memory-last-trigger'));

    expect(runHookWithPath(MEMORY_WORKER, { cwd: projectDir }, homeDir, shimDir).exitCode).toBe(0);

    expect(fs.existsSync(created), 'touch never follows the link').toBe(false);
    expect(refusals('memory-worker'), 'the refusal is logged once').toHaveLength(1);
    expect(fs.readFileSync(workerLogPath(projectDir, homeDir, 'memory-worker'), 'utf-8')).not.toContain('Spawned background-memory-update');
  });
});
