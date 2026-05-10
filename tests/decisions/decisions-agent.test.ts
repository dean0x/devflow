/**
 * Tests for src/cli/utils/decisions-agent.ts
 *
 * Strategy: mock child_process.execFile to avoid actually calling `claude -p`.
 * Test prompt construction by inspecting captured args, and response parsing
 * with canned structured output responses.
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
  runDecisionsAgent,
  _buildDecisionsPrompt,
  _extractStructuredOutput,
  _normalizeObservations,
} from '../../src/cli/utils/decisions-agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ExecFileMock = ReturnType<typeof vi.fn>;

/**
 * Configure `execFile` to return a canned Claude response (structured JSON).
 * `node` calls (filter-observations) return '[]'.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-agent-test-'));
}

/** Build a valid structured output envelope from Claude's JSON mode. */
function makeClaudeEnvelope(observations: unknown[]): string {
  return JSON.stringify({ structured_output: { observations } });
}

// ---------------------------------------------------------------------------
// _buildDecisionsPrompt
// ---------------------------------------------------------------------------

describe('_buildDecisionsPrompt', () => {
  it('includes DECISION and PITFALL sections', () => {
    const prompt = _buildDecisionsPrompt([], '[]');
    expect(prompt).toContain('DECISION');
    expect(prompt).toContain('PITFALL');
  });

  it('does NOT include WORKFLOW or PROCEDURAL sections', () => {
    const prompt = _buildDecisionsPrompt([], '[]');
    expect(prompt).not.toContain('## 1. WORKFLOW');
    expect(prompt).not.toContain('## 2. PROCEDURAL');
    expect(prompt).not.toContain('USER_SIGNALS');
  });

  it('includes dialog pairs in the prompt', () => {
    const pairs = [
      { prior: 'I will use a try/catch here', user: 'no — use Result types instead because we avoid exceptions' },
    ];
    const prompt = _buildDecisionsPrompt(pairs, '[]');
    expect(prompt).toContain('I will use a try/catch here');
    expect(prompt).toContain('no — use Result types instead because we avoid exceptions');
  });

  it('includes existing observations as dedup context', () => {
    const existing = JSON.stringify([{ id: 'obs_xyz789', type: 'decision', pattern: 'existing-decision' }]);
    const prompt = _buildDecisionsPrompt([], existing);
    expect(prompt).toContain('obs_xyz789');
    expect(prompt).toContain('existing-decision');
  });

  it('shows (no dialog pairs) when pairs array is empty', () => {
    const prompt = _buildDecisionsPrompt([], '[]');
    expect(prompt).toContain('(no dialog pairs)');
  });

  it('formats pairs as [PRIOR]: ... [USER]: ...', () => {
    const pairs = [{ prior: 'assistant said this', user: 'user replied this' }];
    const prompt = _buildDecisionsPrompt(pairs, '[]');
    expect(prompt).toContain('[PRIOR]: assistant said this');
    expect(prompt).toContain('[USER]: user replied this');
  });
});

// ---------------------------------------------------------------------------
// _extractStructuredOutput
// ---------------------------------------------------------------------------

describe('_extractStructuredOutput', () => {
  it('extracts observations from structured_output envelope', () => {
    const obs = [{ id: 'obs_a1b2c3', type: 'decision', pattern: 'test', evidence: ['e1'], quality_ok: true }];
    const stdout = makeClaudeEnvelope(obs);
    const result = _extractStructuredOutput(stdout);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('obs_a1b2c3');
  });

  it('falls back to direct observations field when no structured_output wrapper', () => {
    const obs = [{ id: 'obs_direct', type: 'pitfall', pattern: 'test', evidence: [], quality_ok: false }];
    const stdout = JSON.stringify({ observations: obs });
    const result = _extractStructuredOutput(stdout);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('obs_direct');
  });

  it('handles empty observations array', () => {
    const stdout = makeClaudeEnvelope([]);
    const result = _extractStructuredOutput(stdout);
    expect(result).toHaveLength(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => _extractStructuredOutput('not json')).toThrow(/invalid JSON/i);
  });

  it('throws when observations field is missing', () => {
    expect(() => _extractStructuredOutput('{"structured_output": {"result": "ok"}}')).toThrow(/observations/i);
  });
});

// ---------------------------------------------------------------------------
// _normalizeObservations
// ---------------------------------------------------------------------------

describe('_normalizeObservations', () => {
  it('serializes decision fields into semicolon-delimited details', () => {
    const obs = [{
      id: 'obs_d1',
      type: 'decision',
      pattern: 'use Result types',
      evidence: ['because we avoid exceptions'],
      quality_ok: true,
      context: 'Error handling in business logic',
      decision: 'Use Result types instead of throw',
      rationale: 'Keeps error handling explicit and testable',
    }];
    const result = _normalizeObservations(obs);
    expect(result[0]!.details).toBe(
      'context: Error handling in business logic; decision: Use Result types instead of throw; rationale: Keeps error handling explicit and testable',
    );
  });

  it('serializes pitfall fields into semicolon-delimited details', () => {
    const obs = [{
      id: 'obs_p1',
      type: 'pitfall',
      pattern: 'no amend on pushed commits',
      evidence: ['dont amend pushed commits', 'create a new one'],
      quality_ok: true,
      area: 'git',
      issue: 'Amending pushed commits',
      impact: 'Requires force push, destroys shared history',
      resolution: 'Create a new commit instead',
    }];
    const result = _normalizeObservations(obs);
    expect(result[0]!.details).toBe(
      'area: git; issue: Amending pushed commits; impact: Requires force push, destroys shared history; resolution: Create a new commit instead',
    );
  });

  it('preserves id, type, pattern, evidence, quality_ok fields', () => {
    const obs = [{
      id: 'obs_x1',
      type: 'decision',
      pattern: 'my pattern',
      evidence: ['evidence 1'],
      quality_ok: false,
      context: 'ctx',
      decision: 'dec',
      rationale: 'rat',
    }];
    const result = _normalizeObservations(obs);
    expect(result[0]!.id).toBe('obs_x1');
    expect(result[0]!.type).toBe('decision');
    expect(result[0]!.pattern).toBe('my pattern');
    expect(result[0]!.evidence).toEqual(['evidence 1']);
    expect(result[0]!.quality_ok).toBe(false);
  });

  it('handles missing optional fields gracefully (omits from details)', () => {
    const obs = [{
      id: 'obs_partial',
      type: 'decision',
      pattern: 'partial decision',
      evidence: [],
      quality_ok: true,
      // No context/decision/rationale
    }];
    const result = _normalizeObservations(obs);
    expect(result[0]!.details).toBe('');
  });

  it('handles empty observations array', () => {
    expect(_normalizeObservations([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runDecisionsAgent — claude invocation
// ---------------------------------------------------------------------------

describe('runDecisionsAgent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes --output-format json to claude', async () => {
    const mock = mockExecFile(makeClaudeEnvelope([]));

    await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });

  it('passes --json-schema to claude', async () => {
    const mock = mockExecFile(makeClaudeEnvelope([]));

    await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    expect(args).toContain('--json-schema');
    const schemaArg = args[args.indexOf('--json-schema') + 1] ?? '';
    // Should be valid JSON.
    expect(() => JSON.parse(schemaArg)).not.toThrow();
    const schema = JSON.parse(schemaArg) as { type: string; properties: { observations: unknown } };
    expect(schema.type).toBe('object');
    expect(schema.properties.observations).toBeDefined();
  });

  it('passes 300s timeout to execFile', async () => {
    const mock = vi.mocked(execFile) as unknown as ExecFileMock;
    let capturedTimeout: number | undefined;

    mock.mockImplementation((cmd: string, _args: string[], opts: { timeout?: number } | null, callback: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
      if (cmd === 'claude' && opts) capturedTimeout = opts.timeout;
      callback(null, { stdout: makeClaudeEnvelope([]), stderr: '' });
      return {} as ReturnType<typeof execFile>;
    });

    await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    expect(capturedTimeout).toBe(300_000);
  });

  it('passes --dangerously-skip-permissions to claude', async () => {
    const mock = mockExecFile(makeClaudeEnvelope([]));

    await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('returns path to a temp file containing normalized JSON', async () => {
    const obs = [{
      id: 'obs_d1',
      type: 'decision',
      pattern: 'use Result types',
      evidence: ['because we avoid exceptions'],
      quality_ok: true,
      context: 'ctx',
      decision: 'Use Result',
      rationale: 'avoids throw',
    }];
    mockExecFile(makeClaudeEnvelope(obs));

    const resultPath = await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [{ prior: 'I will throw', user: 'no, use Result because cleaner' }],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    expect(fs.existsSync(resultPath)).toBe(true);
    const content = fs.readFileSync(resultPath, 'utf-8');
    const parsed = JSON.parse(content) as { observations: Array<{ details: string }> };
    expect(Array.isArray(parsed.observations)).toBe(true);
    expect(parsed.observations[0]!.details).toContain('context: ctx');
    expect(parsed.observations[0]!.details).toContain('decision: Use Result');
    expect(parsed.observations[0]!.details).toContain('rationale: avoids throw');

    fs.unlinkSync(resultPath);
  });

  it('serializes pitfall fields into semicolon-delimited details', async () => {
    const obs = [{
      id: 'obs_p1',
      type: 'pitfall',
      pattern: 'no amend pushed',
      evidence: ['dont amend', 'create new commit'],
      quality_ok: true,
      area: 'git',
      issue: 'Amending pushed commits',
      impact: 'Requires force push',
      resolution: 'Create a new commit',
    }];
    mockExecFile(makeClaudeEnvelope(obs));

    const resultPath = await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const content = fs.readFileSync(resultPath, 'utf-8');
    const parsed = JSON.parse(content) as { observations: Array<{ details: string }> };
    expect(parsed.observations[0]!.details).toBe(
      'area: git; issue: Amending pushed commits; impact: Requires force push; resolution: Create a new commit',
    );

    fs.unlinkSync(resultPath);
  });

  it('passes dialog pairs in the prompt argument to claude', async () => {
    const mock = mockExecFile(makeClaudeEnvelope([]));

    await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [{ prior: 'unique-prior-content-xyz', user: 'unique-user-content-abc' }],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    const promptArg = args[args.indexOf('-p') + 1] ?? '';
    expect(promptArg).toContain('unique-prior-content-xyz');
    expect(promptArg).toContain('unique-user-content-abc');
  });

  it('includes dedup context from filter-observations when available', async () => {
    const existingObs = JSON.stringify([{ id: 'obs_exist99', type: 'decision', pattern: 'dedup-pattern' }]);
    const mock = mockExecFile(makeClaudeEnvelope([]), existingObs);

    await runDecisionsAgent({
      cwd: tmpDir,
      dialogPairs: [],
      model: 'sonnet',
      logFile: path.join(tmpDir, 'decisions-log.jsonl'),
      jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
    });

    const args = getCapturedClaudeArgs(mock);
    const promptArg = args[args.indexOf('-p') + 1] ?? '';
    expect(promptArg).toContain('obs_exist99');
  });

  it('throws when claude returns invalid JSON', async () => {
    mockExecFile('not-json-at-all');

    await expect(
      runDecisionsAgent({
        cwd: tmpDir,
        dialogPairs: [],
        model: 'sonnet',
        logFile: path.join(tmpDir, 'decisions-log.jsonl'),
        jsonHelperPath: path.join(tmpDir, 'json-helper.cjs'),
      }),
    ).rejects.toThrow(/invalid JSON/i);
  });
});
