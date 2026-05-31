// tests/learning/thresholds.test.ts
// Tests for process-observations id-keyed record behavior.
// Phase 3: calculateConfidence and tryImmediatePromotion have been removed.
// The LLM now sets confidence, status, and quality_ok fields directly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHelper } from './helpers.js';

describe('process-observations — id-keyed record op', () => {
  let tmpDir: string;
  let logFile: string;
  let responseFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thresholds-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    responseFile = path.join(tmpDir, 'response.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates new observation with LLM-provided confidence and status', () => {
    const response = {
      observations: [{
        id: 'obs_new001',
        type: 'pitfall',
        pattern: 'do not amend pushed commits',
        evidence: ['prior: amend', 'user: no, create new'],
        details: 'area: git; issue: amend; impact: force push; resolution: new commit',
        quality_ok: true,
        confidence: 0.85,
        status: 'ready',
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.quality_ok).toBe(true);
    expect(created.type).toBe('pitfall');
    // LLM-provided confidence stored verbatim
    expect(created.confidence).toBe(0.85);
    // LLM-provided status stored verbatim
    expect(created.status).toBe('ready');
    expect(created.observations).toBe(1);
  });

  it('creates new observation with status=observing when not provided', () => {
    const response = {
      observations: [{
        id: 'obs_new002',
        type: 'workflow',
        pattern: 'run tests then deploy',
        evidence: ['evidence'],
        details: 'step 1; step 2',
        quality_ok: false,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('observing');
    expect(created.confidence).toBe(0); // no confidence provided → defaults to 0
  });

  it('increments count and merges evidence when id already exists', () => {
    const existingObs = {
      id: 'obs_abc001',
      type: 'workflow',
      pattern: 'test workflow pattern',
      confidence: 0.33,
      observations: 1,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-01T00:00:00Z',
      status: 'observing',
      evidence: ['evidence 1'],
      details: 'step details',
      quality_ok: false,
    };
    fs.writeFileSync(logFile, JSON.stringify(existingObs) + '\n');

    const response = {
      observations: [{
        id: 'obs_abc001',
        type: 'workflow',
        pattern: 'test workflow pattern',
        evidence: ['evidence 2'],
        details: 'step details',
        quality_ok: true,
        confidence: 0.65,
        status: 'observing',
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.observations).toBe(2);
    expect(updated.evidence).toContain('evidence 1');
    expect(updated.evidence).toContain('evidence 2');
    expect(updated.confidence).toBe(0.65); // LLM-provided confidence
    expect(updated.quality_ok).toBe(true); // sticky once true
  });

  it('quality_ok is sticky — stays true once set', () => {
    const existingObs = {
      id: 'obs_sticky001',
      type: 'decision',
      pattern: 'use X over Y',
      confidence: 0.95,
      observations: 1,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-01T00:00:00Z',
      status: 'ready',
      evidence: ['e1'],
      details: 'context: X; decision: X; rationale: performance',
      quality_ok: true,
    };
    fs.writeFileSync(logFile, JSON.stringify(existingObs) + '\n');

    // Reinforce with quality_ok=false — should NOT regress quality_ok
    const response = {
      observations: [{
        id: 'obs_sticky001',
        type: 'decision',
        pattern: 'use X over Y',
        evidence: ['e2'],
        details: 'context: X; decision: X; rationale: performance',
        quality_ok: false,
        confidence: 0.80,
        status: 'ready',
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.quality_ok).toBe(true); // sticky
  });

  it('stores LLM-provided status verbatim (no auto-promotion)', () => {
    const response = {
      observations: [{
        id: 'obs_status001',
        type: 'decision',
        pattern: 'use Y instead of Z',
        evidence: ['evidence'],
        details: 'context: Y; decision: Y; rationale: simplicity',
        quality_ok: true,
        confidence: 0.95,
        status: 'ready', // LLM sets ready directly
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('ready');
    expect(created.confidence).toBe(0.95);
  });

  it('skips observations with invalid id format', () => {
    const response = {
      observations: [{
        id: 'bad-id-format',
        type: 'workflow',
        pattern: 'some pattern',
        evidence: [],
        details: 'details',
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const result = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}"`));
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it('skips observations with invalid type', () => {
    const response = {
      observations: [{
        id: 'obs_valid001',
        type: 'invalid-type',
        pattern: 'some pattern',
        evidence: [],
        details: 'details',
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const result = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}"`));
    expect(result.skipped).toBe(1);
  });

  it('--types filter limits which types are processed', () => {
    const response = {
      observations: [
        { id: 'obs_w001', type: 'workflow', pattern: 'wf pattern', evidence: [], details: 'd1' },
        { id: 'obs_d001', type: 'decision', pattern: 'dec pattern', evidence: [], details: 'd2' },
      ],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const result = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}" --types workflow`));
    expect(result.created).toBe(1); // only workflow processed
    expect(result.skipped).toBe(1); // decision skipped

    const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe('workflow');
  });
});
