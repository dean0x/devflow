/**
 * Tests for src/cli/utils/learning-agent.ts
 *
 * Strategy: mock child_process.execFile to avoid actually calling `claude -p`.
 * Test prompt construction by inspecting captured args, and response parsing
 * with canned responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Mock child_process BEFORE importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
import {
  runLearningAgent,
  _buildLearningPrompt,
  _stripMarkdownFences,
} from '../../src/cli/utils/learning-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExecFileMock = ReturnType<typeof vi.fn>;

/**
 * Configure `execFile` to return a canned response for the first matching call.
 * `claude -p` calls return stdout; `node` calls (filter-observations) return '[]'.
 */
function mockExecFile(claudeStdout: string, nodeStdout = '[]'): ExecFileMock {
  const mock = vi.mocked(execFile) as unknown as ExecFileMock;
  mock.mockImplementation((cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    if (cmd === 'node') {
      callback(null, { stdout: nodeStdout, stderr: '' });
    } else {
      callback(null, { stdout: claudeStdout, stderr: '' });
    }
    return {} as ReturnType<typeof execFile>;
  });
  return mock;
}

/** Captured args from the most recent `claude` execFile call. */
function getCapturedClaudeArgs(mock: ExecFileMock): string[] {
  const calls = mock.mock.calls as Array<[string, string[], ...unknown[]]>;
  const claudeCall = calls.find(([cmd]) => cmd === 'claude');
  return claudeCall ? claudeCall[1] : [];
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'learning-agent-test-'));
}

// ---------------------------------------------------------------------------
// _buildLearningPrompt
// ---------------------------------------------------------------------------

describe('_buildLearningPrompt', () => {
  it('includes WORKFLOW and PROCEDURAL sections', () => {
    const prompt = _buildLearningPrompt(['signal one'], '[]');
    expect(prompt).toContain('WORKFLOW');
    expect(prompt).toContain('PROCEDURAL');
  });

  it('does NOT include DECISION or PITFALL sections', () => {
    const prompt = _buildLearningPrompt(['signal one'], '[]');
    expect(prompt).not.toContain('## 1. DECISION');
    expect(prompt).not.toContain('## 2. PITFALL');
    expect(prompt).not.toContain('DIALOG_PAIRS');
  });

  it('includes user signals in the prompt', () => {
    const prompt = _buildLearningPrompt(['do the thing first then commit', 'run tests then push'], '[]');
    expect(prompt).toContain('do the thing first then commit');
    expect(prompt).toContain('run tests then push');
  });

  it('includes existing observations as dedup context', () => {
    const existing = JSON.stringify([{ id: 'obs_abc123', type: 'workflow', pattern: 'existing' }]);
    const prompt = _buildLearningPrompt(['signal'], existing);
    expect(prompt).toContain('obs_abc123');
    expect(prompt).toContain('existing');
  });

  it('shows (no signals) when user signals array is empty', () => {
    const prompt = _buildLearningPrompt([], '[]');
    expect(prompt).toContain('(no signals)');
  });

  it('instructs output to be JSON only (no markdown fences)', () => {
    const prompt = _buildLearningPrompt(['signal'], '[]');
    expect(prompt).toContain('Output ONLY the JSON object');
    expect(prompt).toContain('No markdown fences');
  });
});

// ---------------------------------------------------------------------------
// _stripMarkdownFences
// ---------------------------------------------------------------------------

describe('_stripMarkdownFences', () => {
  it('strips ```json fence', () => {
    const input = '```json\n{"observations": []}\n```';
    expect(_stripMarkdownFences(input)).toBe('{"observations": []}');
  });

  it('strips plain ``` fence', () => {
    const input = '```\n{"observations": []}\n```';
    expect(_stripMarkdownFences(input)).toBe('{"observations": []}');
  });

  it('returns plain JSON unchanged', () => {
    const input = '{"observations": []}';
    expect(_stripMarkdownFences(input)).toBe('{"observations": []}');
  });

  it('trims surrounding whitespace', () => {
    const input = '  {"observations": []}  ';
    expect(_stripMarkdownFences(input)).toBe('{"observations": []}');
  });

  it('strips fences with leading whitespace', () => {
    const input = '  ```json\n{"observations": []}\n  ```';
    expect(_stripMarkdownFences(input)).toBe('{"observations": []}');
  });

  it('strips fences with trailing whitespace after markers', () => {
    const input = '```json  \n{"observations": []}\n```  ';
    expect(_stripMarkdownFences(input)).toBe('{"observations": []}');
  });
});

// ---------------------------------------------------------------------------
// runLearningAgent — claude invocation
// ---------------------------------------------------------------------------

describe('runLearningAgent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes --output-format text to claude', async () => {
    const mock = mockExecFile('{"observations": []}');

    await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['do this then that'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('text');
  });

  it('passes 300s timeout to execFile', async () => {
    const mock = vi.mocked(execFile) as unknown as ExecFileMock;
    let capturedTimeout: number | undefined;

    mock.mockImplementation((cmd: string, _args: string[], opts: { timeout?: number } | null, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (cmd === 'claude' && opts) capturedTimeout = opts.timeout;
      callback(null, { stdout: '{"observations": []}', stderr: '' });
      return {} as ReturnType<typeof execFile>;
    });

    await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['signal'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    expect(capturedTimeout).toBe(300_000);
  });

  it('passes --allowedTools Read to claude', async () => {
    const mock = mockExecFile('{"observations": []}');

    await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['signal'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read');
  });

  it('passes --dangerously-skip-permissions to claude', async () => {
    const mock = mockExecFile('{"observations": []}');

    await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['signal'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('returns path to a temp file containing validated JSON', async () => {
    mockExecFile('{"observations": [{"id": "obs_abc123", "type": "workflow", "pattern": "test", "evidence": ["a", "b"], "details": "step 1\\nstep 2", "quality_ok": true}]}');

    const resultPath = await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['signal'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    expect(typeof resultPath).toBe('string');
    expect(fs.existsSync(resultPath)).toBe(true);
    const content = fs.readFileSync(resultPath, 'utf-8');
    const parsed = JSON.parse(content) as { observations: unknown[] };
    expect(Array.isArray(parsed.observations)).toBe(true);

    // Cleanup.
    fs.unlinkSync(resultPath);
  });

  it('strips markdown fences from claude response before writing', async () => {
    mockExecFile('```json\n{"observations": []}\n```');

    const resultPath = await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['signal'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const content = fs.readFileSync(resultPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
    fs.unlinkSync(resultPath);
  });

  it('throws when claude returns invalid JSON', async () => {
    mockExecFile('this is not json at all');

    await expect(
      runLearningAgent({
        cwd: tmpDir,
        userSignals: ['signal'],
        model: 'sonnet',
        logFile: path.join(tmpDir, 'learning-log.jsonl'),
        jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
      }),
    ).rejects.toThrow(/invalid JSON/i);
  });

  it('throws when claude response is missing observations field', async () => {
    mockExecFile('{"result": "ok"}');

    await expect(
      runLearningAgent({
        cwd: tmpDir,
        userSignals: ['signal'],
        model: 'sonnet',
        logFile: path.join(tmpDir, 'learning-log.jsonl'),
        jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
      }),
    ).rejects.toThrow(/observations/i);
  });

  it('passes user signals in the prompt argument to claude', async () => {
    const mock = mockExecFile('{"observations": []}');

    await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['unique-signal-xyz-789'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    const promptArg = args[args.indexOf('-p') + 1] ?? '';
    expect(promptArg).toContain('unique-signal-xyz-789');
  });

  it('includes dedup context from filter-observations when log exists', async () => {
    const existingObs = JSON.stringify([{ id: 'obs_dedup1', type: 'workflow', pattern: 'existing-pattern' }]);
    const mock = mockExecFile('{"observations": []}', existingObs);

    await runLearningAgent({
      cwd: tmpDir,
      userSignals: ['signal'],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'learning-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    const promptArg = args[args.indexOf('-p') + 1] ?? '';
    expect(promptArg).toContain('obs_dedup1');
  });
});
