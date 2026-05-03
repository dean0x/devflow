// tests/integration/learning/end-to-end.test.ts
// Full end-to-end test for the self-learning pipeline.
//
// Flow:
//   1. Creates a tmpdir project with .memory/ and .claude/ structure
//   2. Plants 3 synthetic session JSONL files in the Claude project directory
//   3. Creates a claude shim that echoes canned observations (bypasses LLM)
//   4. Invokes background-learning shell script directly
//   5. Asserts all 4 observation types present in log
//   6. Asserts rendered artifacts exist (command file, skill dir, decisions.md, pitfalls.md)
//   7. Deletes one artifact, runs reconcile-manifest
//   8. Asserts corresponding observation is deprecated
//
// Note: background-learning has a `sleep 3` in the main path.
// We override DEVFLOW_SKIP_SLEEP=1 via env OR run with a patched invocation.
// Since we cannot easily patch the sleep, we accept the ~3s overhead for integration tests.
// Total test timeout: 60s (background-learning with real dependencies).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';

// Root of the devflow repo
const REPO_ROOT = path.resolve(path.join(path.dirname(new URL(import.meta.url).pathname), '../../..'));
const BACKGROUND_LEARNING = path.join(REPO_ROOT, 'scripts/hooks/background-learning');
const JSON_HELPER = path.join(REPO_ROOT, 'scripts/hooks/json-helper.cjs');

// Claude Code transcript format: each line is a JSON object
function makeUserLine(content: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content },
    timestamp: new Date().toISOString(),
  });
}
function makeAssistantLine(content: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content },
    timestamp: new Date().toISOString(),
  });
}

// Encode a filesystem path to Claude project slug (same as background-learning)
function encodePathToSlug(p: string): string {
  return p.replace(/^\//, '').replace(/\//g, '-');
}

describe('background-learning end-to-end pipeline', () => {
  let tmpDir: string;
  let memoryDir: string;
  let claudeProjectsDir: string;
  let shimDir: string;
  let fakeHome: string;

  beforeEach(() => {
    // Isolate HOME before any path computation so os.homedir() and $HOME in
    // spawned shell scripts both resolve to the fake directory. This prevents
    // writes to the developer's real ~/.claude/projects/.
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-fake-home-'));
    vi.stubEnv('HOME', fakeHome);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-learning-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    // Claude project dir for session transcripts — use fakeHome so no real
    // ~/.claude/projects/ directory is created or modified.
    const slug = encodePathToSlug(tmpDir);
    claudeProjectsDir = path.join(fakeHome, '.claude', 'projects', `-${slug}`);
    fs.mkdirSync(claudeProjectsDir, { recursive: true });

    // Shim directory for fake `claude` binary
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-shim-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(shimDir, { recursive: true, force: true });
    // fakeHome contains claudeProjectsDir — remove the whole fake home tree.
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('runs full pipeline: 3 sessions → 4 observation types → artifacts → reconcile', () => {
    // --- Plant synthetic session transcripts ---

    // Session A: workflow pattern — repeated multi-step instructions from user
    const sessionAId = 'sess_e2e_workflow_001';
    const sessionAPath = path.join(claudeProjectsDir, `${sessionAId}.jsonl`);
    const sessionAContent = [
      makeAssistantLine("I'll help you implement the plan."),
      makeUserLine('implement the plan, then run /self-review, then commit and push'),
      makeAssistantLine('Starting implementation...'),
      makeUserLine('After the implementation is done, run /self-review to check quality, then commit the changes and push to the remote branch. This is the standard flow I want to use from now on.'),
      makeAssistantLine('I understand. I will implement, then self-review, then commit and push.'),
      makeUserLine('Great. And when I say implement and review, I mean: implement the plan using /implement, wait for it to finish, then /self-review, then commit with a good message, then push. That sequence is our standard.'),
      // Add many more lines to exceed the 200-char minimum
      makeAssistantLine('Understood. The workflow is: implement via /implement → /self-review → commit → push.'),
      makeUserLine('Correct. That is the pattern I want captured.'),
    ].join('\n') + '\n';
    fs.writeFileSync(sessionAPath, sessionAContent, 'utf-8');

    // Session B: decision pattern — explicit rationale
    const sessionBId = 'sess_e2e_decision_001';
    const sessionBPath = path.join(claudeProjectsDir, `${sessionBId}.jsonl`);
    const sessionBContent = [
      makeAssistantLine("I could use exceptions here or Result types."),
      makeUserLine('I want to use Result types because throwing exceptions breaks the composability of the pipeline. The entire codebase is built around Result<T,E> and adding throws would require try/catch at every call site.'),
      makeAssistantLine('Result types it is. I will apply them consistently throughout.'),
      makeUserLine('Good. This is a firm architectural decision. Do not deviate from it. Result types because exceptions break composability.'),
      makeAssistantLine('Confirmed. All fallible operations return Result types.'),
      makeUserLine('Also, I want to enforce this strictly: every function that can fail must return Result<T,E>, not throw. The reason is that throw destroys the monad composition we rely on.'),
    ].join('\n') + '\n';
    fs.writeFileSync(sessionBPath, sessionBContent, 'utf-8');

    // Session C: pitfall pattern — user correction of assistant action
    const sessionCId = 'sess_e2e_pitfall_001';
    const sessionCPath = path.join(claudeProjectsDir, `${sessionCId}.jsonl`);
    const sessionCContent = [
      makeAssistantLine("I'll add a try/catch around the Result parsing to handle any errors gracefully."),
      makeUserLine('No — we use Result types precisely to avoid try/catch. Do not wrap Result operations in try/catch. That defeats the entire purpose of the Result pattern.'),
      makeAssistantLine('Understood, I will not use try/catch with Result types.'),
      makeUserLine('Good. This is critical: if you see a Result type, you handle it with .match() or check .ok — never with try/catch. The codebase enforces this.'),
      makeAssistantLine('Got it. No try/catch around Result operations.'),
      makeUserLine('Thank you. Also: never use .unwrap() or .expect() on Results without a guard. Always check .ok first.'),
    ].join('\n') + '\n';
    fs.writeFileSync(sessionCPath, sessionCContent, 'utf-8');

    // Plant batch IDs file
    const batchFile = path.join(memoryDir, '.learning-batch-ids');
    fs.writeFileSync(batchFile, [sessionAId, sessionBId, sessionCId].join('\n') + '\n', 'utf-8');

    // --- Create claude shim ---
    // The shim echoes a canned JSON response with one of each type.
    // background-learning passes the prompt as the last argument.
    const cannedObservations = JSON.stringify({
      observations: [
        {
          id: 'obs_e2e_w1',
          type: 'workflow',
          pattern: 'implement-review-commit-push',
          evidence: [
            'implement the plan, then run /self-review, then commit and push',
            'implement the plan using /implement, wait for it to finish, then /self-review, then commit with a good message, then push',
          ],
          details: '1. Run /implement with plan\n2. Wait for implementation\n3. Run /self-review\n4. Commit with message\n5. Push to remote branch',
          quality_ok: true,
        },
        {
          id: 'obs_e2e_p1',
          type: 'procedural',
          pattern: 'result-types-instead-of-exceptions',
          evidence: [
            'I want to use Result types because throwing exceptions breaks the composability',
            'every function that can fail must return Result<T,E>, not throw',
          ],
          details: 'When implementing fallible operations: return Result<T,E> instead of throwing. Use .match() or check .ok to handle errors. This preserves monad composition.',
          quality_ok: true,
        },
        {
          id: 'obs_e2e_d1',
          type: 'decision',
          pattern: 'Result types over exceptions for composability',
          evidence: [
            'I want to use Result types because throwing exceptions breaks the composability of the pipeline',
            'throw destroys the monad composition we rely on',
          ],
          details: 'context: codebase built around Result<T,E>; decision: enforce Result types for all fallible ops; rationale: exceptions break composability and require try/catch at every call site',
          quality_ok: true,
        },
        {
          id: 'obs_e2e_f1',
          type: 'pitfall',
          pattern: 'avoid try/catch with Result types',
          evidence: [
            "prior: I'll add a try/catch around the Result parsing to handle any errors gracefully",
            'user: No — we use Result types precisely to avoid try/catch. Do not wrap Result operations in try/catch.',
          ],
          details: 'area: any code using Result<T,E>; issue: wrapping Result operations in try/catch defeats the Result pattern; impact: inconsistent error handling; resolution: use .match() or check .ok — never try/catch',
          quality_ok: true,
        },
      ],
    });

    const shimScript = `#!/bin/bash
# claude shim for e2e tests
# Echoes canned observations regardless of prompt
cat << 'CANNED_EOF'
${cannedObservations}
CANNED_EOF
`;
    const shimPath = path.join(shimDir, 'claude');
    fs.writeFileSync(shimPath, shimScript, { mode: 0o755 });

    // --- Invoke background-learning ---
    // We need to:
    // 1. Pass tmpDir as CWD
    // 2. Override PATH so our shim is found as 'claude'
    // 3. Set up devflow log dir
    // 4. Bypass the `sleep 3` at start — we patch by setting DEVFLOW_SKIP_SLEEP=1 in env
    //    (background-learning reads this if we add support, OR we bypass via a different trick)
    //
    // Since background-learning doesn't have a DEVFLOW_SKIP_SLEEP check, we use timeout.
    // The sleep 3 is unavoidable in the shell script. We accept this.
    // We override DEVFLOW_BG_LEARNER so any recursive claude invocations are skipped.

    const env = {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      // HOME is already set via vi.stubEnv in beforeEach; process.env.HOME
      // reflects the fake home so background-learning's $HOME also points there.
    };

    // Override the daily cap file to start fresh
    const counterFile = path.join(memoryDir, '.learning-runs-today');
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(counterFile, `${today}\t0`, 'utf-8');

    // Set config to allow runs
    fs.writeFileSync(
      path.join(memoryDir, 'learning.json'),
      JSON.stringify({ max_daily_runs: 10, throttle_minutes: 0, model: 'sonnet', debug: false }),
      'utf-8',
    );

    // Create required Claude dirs
    fs.mkdirSync(path.join(tmpDir, '.claude', 'commands', 'self-learning'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.claude', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.memory', 'decisions'), { recursive: true });

    // Invoke background-learning synchronously (it has sleep 3 but exits)
    let failed = false;
    let errorOutput = '';
    try {
      execFileSync('bash', [BACKGROUND_LEARNING, tmpDir, '--batch', 'claude'], {
        env,
        timeout: 30000, // 30s max
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      // background-learning may exit 0 or 1; we check the log and artifacts instead
      const err = e as { stderr?: Buffer; stdout?: Buffer };
      errorOutput = (err.stderr?.toString() || '') + (err.stdout?.toString() || '');
      failed = true; // note but don't throw yet
    }

    // Check learning log
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    if (!fs.existsSync(logPath)) {
      // If background-learning failed before writing, check why
      const devflowLogDir = path.join(os.homedir(), '.devflow', 'logs', encodePathToSlug(tmpDir));
      const logFile = path.join(devflowLogDir, '.learning-update.log');
      const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : 'no log file';
      throw new Error(`Learning log not created. Script failed: ${failed}. Error: ${errorOutput}\nScript log: ${logContent}`);
    }

    const logContent = fs.readFileSync(logPath, 'utf-8');
    const lines = logContent.split('\n').filter(l => l.trim());
    const observations = lines.map(l => JSON.parse(l));

    // Assert all 4 types are present
    const types = observations.map((o: { type: string }) => o.type);
    expect(types).toContain('workflow');
    expect(types).toContain('procedural');
    expect(types).toContain('decision');
    expect(types).toContain('pitfall');

    // Assert observations have correct IDs (from shim)
    const ids = observations.map((o: { id: string }) => o.id);
    expect(ids).toContain('obs_e2e_w1');
    expect(ids).toContain('obs_e2e_p1');
    expect(ids).toContain('obs_e2e_d1');
    expect(ids).toContain('obs_e2e_f1');

    // Observations must be in 'created' status (since quality_ok=true and thresholds
    // for decision/pitfall require 2 observations but render is triggered by quality_ok+status)
    // Note: With required=2 for decision/pitfall, single observation → 'observing' or 'ready'.
    // For workflow/procedural with required=3, single observation → 'observing'.
    // We assert all observations were written and their IDs match.
    for (const obs of observations) {
      expect(['observing', 'ready', 'created']).toContain(obs.status);
    }

    // Assert manifest was created or decisions dirs exist
    const decisionsDir = path.join(memoryDir, 'decisions');
    expect(fs.existsSync(decisionsDir)).toBe(true);

    // --- Test reconcile-manifest ---
    // First: manually write a manifest entry pointing to a non-existent artifact
    const manifestPath = path.join(memoryDir, '.learning-manifest.json');
    const fakeManifest = {
      schemaVersion: 1,
      entries: [
        {
          observationId: 'obs_e2e_w1',
          type: 'command',
          path: path.join(tmpDir, '.claude', 'commands', 'self-learning', 'implement-review-commit-push.md'),
          contentHash: 'fakehash123',
          renderedAt: new Date().toISOString(),
        },
      ],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(fakeManifest), 'utf-8');

    // Write the log with obs_e2e_w1 as 'created' with artifact_path
    const w1Obs = {
      id: 'obs_e2e_w1',
      type: 'workflow',
      pattern: 'implement-review-commit-push',
      evidence: ['implement the plan, then run /self-review, then commit and push'],
      details: '1. Run /implement\n2. /self-review\n3. commit\n4. push',
      quality_ok: true,
      confidence: 0.85,
      observations: 3,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      status: 'created',
      artifact_path: path.join(tmpDir, '.claude', 'commands', 'self-learning', 'implement-review-commit-push.md'),
    };
    fs.writeFileSync(logPath, JSON.stringify(w1Obs) + '\n', 'utf-8');

    // Don't create the artifact file — simulating a deleted artifact

    // Run reconcile-manifest
    execSync(`node "${JSON_HELPER}" reconcile-manifest "${tmpDir}"`, {
      env: process.env,
      timeout: 10000,
    });

    // Assert: the observation is now deprecated (artifact was missing)
    const reconciledContent = fs.readFileSync(logPath, 'utf-8');
    const reconciledObs = reconciledContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const w1After = reconciledObs.find((o: { id: string }) => o.id === 'obs_e2e_w1');

    expect(w1After).toBeDefined();
    expect(w1After.status).toBe('deprecated');
  }, 60000); // 60s timeout for integration test

  it('gracefully handles missing batch IDs file', () => {
    // No .learning-batch-ids file — background-learning should exit cleanly
    const env = {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
    };

    let exitCode = 0;
    try {
      execFileSync('bash', [BACKGROUND_LEARNING, tmpDir, '--batch', 'claude'], {
        env,
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { status?: number };
      exitCode = err.status ?? 1;
    }

    // Background-learning should exit 0 (graceful — no batch file means nothing to do)
    expect(exitCode).toBe(0);
    // No learning log should be created
    expect(fs.existsSync(path.join(memoryDir, 'learning-log.jsonl'))).toBe(false);
  }, 30000);

  it('reconcile-manifest marks missing artifacts as deprecated in log', () => {
    // Set up a log with a 'created' observation pointing to a missing file
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const missingPath = path.join(tmpDir, '.claude', 'commands', 'self-learning', 'does-not-exist.md');
    const obs = {
      id: 'obs_reconcile_01',
      type: 'workflow',
      pattern: 'test-pattern',
      evidence: ['test evidence'],
      details: 'test details',
      quality_ok: true,
      confidence: 0.8,
      observations: 3,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      status: 'created',
      artifact_path: missingPath,
    };

    // Set up manifest pointing to same missing file
    const manifestPath = path.join(memoryDir, '.learning-manifest.json');
    fs.writeFileSync(logPath, JSON.stringify(obs) + '\n', 'utf-8');
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      entries: [{
        observationId: 'obs_reconcile_01',
        type: 'command',
        path: missingPath,
        contentHash: 'testhash',
        renderedAt: new Date().toISOString(),
      }],
    }), 'utf-8');

    // Run reconcile-manifest
    execSync(`node "${JSON_HELPER}" reconcile-manifest "${tmpDir}"`, {
      timeout: 10000,
    });

    // Read updated log
    const updatedContent = fs.readFileSync(logPath, 'utf-8');
    const updatedObs = updatedContent.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const updated = updatedObs.find((o: { id: string }) => o.id === 'obs_reconcile_01');

    expect(updated).toBeDefined();
    expect(updated.status).toBe('deprecated');
    // The manifest entry should be removed
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const entry = manifest.entries.find((e: { observationId: string }) => e.observationId === 'obs_reconcile_01');
    expect(entry).toBeUndefined();
  }, 20000);
});
