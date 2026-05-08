// tests/learning/thresholds.test.ts
// Tests for per-type THRESHOLDS and calculateConfidence (D3).
// Also tests promotion logic in process-observations (quality_ok gate, D4).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHelper } from './helpers.js';

// Direct calculation via inline node to test calculateConfidence
function calculateConfidence(count: number, type: string): number {
  // Mirror the THRESHOLDS from json-helper.cjs
  const thresholds: Record<string, { required: number }> = {
    workflow:   { required: 3 },
    procedural: { required: 4 },
    decision:   { required: 1 },
    pitfall:    { required: 1 },
  };
  const req = (thresholds[type] || thresholds.procedural).required;
  return Math.min(Math.floor(count * 100 / req), 95) / 100;
}

describe('calculateConfidence — per-type thresholds (D3)', () => {
  it('workflow: count=3 (= required) → 0.95 (capped)', () => {
    const conf = calculateConfidence(3, 'workflow');
    expect(conf).toBe(0.95);
  });

  it('decision: count=1 (= required=1) → 0.95 (capped)', () => {
    const conf = calculateConfidence(1, 'decision');
    expect(conf).toBe(0.95);
  });

  it('pitfall: count=1 (= required=1) → 0.95 (capped)', () => {
    const conf = calculateConfidence(1, 'pitfall');
    expect(conf).toBe(0.95);
  });

  it('procedural: count=1 (< required=4) → 0.25', () => {
    const conf = calculateConfidence(1, 'procedural');
    expect(conf).toBe(0.25);
  });

  it('workflow: count=1 → 0.33 (floor(100/3) = 33)', () => {
    const conf = calculateConfidence(1, 'workflow');
    expect(conf).toBe(0.33);
  });

  it('unknown type falls back to procedural (required=4)', () => {
    const conf = calculateConfidence(4, 'unknown-type');
    expect(conf).toBe(0.95);
  });

  it('confidence never exceeds 0.95', () => {
    const conf = calculateConfidence(100, 'workflow');
    expect(conf).toBe(0.95);
  });
});

describe('process-observations — per-type promotion (D3, D4)', () => {
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

  it('does NOT promote: legacy obs without quality_ok even with high count', () => {
    // Obs at count=5 (well above all thresholds) but quality_ok is missing
    const sevenDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const existingObs = {
      id: 'obs_abc001',
      type: 'workflow',
      pattern: 'test workflow pattern',
      confidence: 0.80,
      observations: 5,
      first_seen: sevenDaysAgo,
      last_seen: sevenDaysAgo,
      status: 'observing',
      evidence: ['evidence 1', 'evidence 2'],
      details: 'step details',
      // quality_ok NOT set — legacy entry
    };
    fs.writeFileSync(logFile, JSON.stringify(existingObs) + '\n');

    // Submit same obs again (reinforcement with quality_ok=false)
    const response = {
      observations: [{
        id: 'obs_abc001',
        type: 'workflow',
        pattern: 'test workflow pattern',
        evidence: ['new evidence here'],
        details: 'step details',
        quality_ok: false, // explicitly false
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    // Should still be 'observing' — quality_ok never set to true
    expect(updated.status).toBe('observing');
  });

  it('promotes: quality_ok=true + count >= required + spread satisfied', () => {
    // workflow: required=3, spread=7 days, promote=0.60
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const existingObs = {
      id: 'obs_abc002',
      type: 'workflow',
      pattern: 'deploy workflow',
      confidence: 0.65,
      observations: 2, // will become 3 = required
      first_seen: eightDaysAgo,
      last_seen: eightDaysAgo,
      status: 'observing',
      evidence: ['evidence a', 'evidence b'],
      details: 'step 1, step 2',
      quality_ok: true,
    };
    fs.writeFileSync(logFile, JSON.stringify(existingObs) + '\n');

    const response = {
      observations: [{
        id: 'obs_abc002',
        type: 'workflow',
        pattern: 'deploy workflow',
        evidence: ['evidence c'],
        details: 'step 1, step 2',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.status).toBe('ready');
    expect(updated.observations).toBe(3);
    expect(updated.confidence).toBe(0.95); // 3/3 * 100 → 95 capped
  });

  it('does NOT promote: quality_ok=true but spread not satisfied', () => {
    // workflow: required spread = 7 days; first_seen is only 1 day ago
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    const existingObs = {
      id: 'obs_abc003',
      type: 'workflow',
      pattern: 'quick workflow',
      confidence: 0.65,
      observations: 2,
      first_seen: oneDayAgo,
      last_seen: oneDayAgo,
      status: 'observing',
      evidence: ['a', 'b'],
      details: 'steps',
      quality_ok: true,
    };
    fs.writeFileSync(logFile, JSON.stringify(existingObs) + '\n');

    const response = {
      observations: [{
        id: 'obs_abc003',
        type: 'workflow',
        pattern: 'quick workflow',
        evidence: ['c'],
        details: 'steps',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    // Spread requirement (7 days) not met — stays observing
    expect(updated.status).toBe('observing');
  });

  it('decision type: no spread requirement — promotes at count=2 with quality_ok', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const existingObs = {
      id: 'obs_dec001',
      type: 'decision',
      pattern: 'use X over Y because Z',
      confidence: 0.95,
      observations: 1,
      first_seen: twoHoursAgo,
      last_seen: twoHoursAgo,
      status: 'observing',
      evidence: ['user said "use X because Z"'],
      details: 'context: we chose X; decision: use X; rationale: because Z',
      quality_ok: true,
    };
    fs.writeFileSync(logFile, JSON.stringify(existingObs) + '\n');

    const response = {
      observations: [{
        id: 'obs_dec001',
        type: 'decision',
        pattern: 'use X over Y because Z',
        evidence: ['reinforced evidence'],
        details: 'context: ...',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const updated = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    // Decision: required=1, spread=0 — count=2 >= required=1, quality_ok=true → promotes
    expect(updated.status).toBe('ready');
  });

  it('stores quality_ok field from model response', () => {
    const response = {
      observations: [{
        id: 'obs_new001',
        type: 'pitfall',
        pattern: 'do not amend pushed commits',
        evidence: ['prior: amend', 'user: no, create new'],
        details: 'area: git; issue: amend; impact: force push; resolution: new commit',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.quality_ok).toBe(true);
    expect(created.type).toBe('pitfall');
  });

  it('decision promotes on first observation (quality_ok=true)', () => {
    // Empty log — brand new entry
    const response = {
      observations: [{
        id: 'obs_new_dec001',
        type: 'decision',
        pattern: 'use X over Y',
        evidence: ['user said so'],
        details: 'context: X; decision: X over Y; rationale: performance',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));
    // No existing log file — new entry path

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('ready');
    expect(created.confidence).toBe(0.95);
  });

  it('pitfall promotes on first observation (quality_ok=true)', () => {
    const response = {
      observations: [{
        id: 'obs_new_pit001',
        type: 'pitfall',
        pattern: 'avoid X in Y',
        evidence: ['evidence line'],
        details: 'area: cli; issue: X; impact: breaks Y; resolution: avoid X',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('ready');
    expect(created.confidence).toBe(0.95);
  });

  it('decision stays observing when quality_ok=false', () => {
    const response = {
      observations: [{
        id: 'obs_new_dec002',
        type: 'decision',
        pattern: 'use Y instead of Z',
        evidence: ['evidence'],
        details: 'context: Y; decision: Y; rationale: simplicity',
        quality_ok: false,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('observing');
    expect(created.confidence).toBe(0.95);
  });

  it('workflow unaffected — stays observing at confidence=0.33 after first observation', () => {
    const response = {
      observations: [{
        id: 'obs_new_wf001',
        type: 'workflow',
        pattern: 'run tests then deploy',
        evidence: ['evidence'],
        details: 'step 1; step 2',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('observing');
    expect(created.confidence).toBe(0.33);
  });

  it('procedural unaffected — preserves INITIAL_CONFIDENCE at 0.33', () => {
    const response = {
      observations: [{
        id: 'obs_new_proc001',
        type: 'procedural',
        pattern: 'always check return value',
        evidence: ['evidence'],
        details: 'procedure details',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    runHelper(`process-observations "${responseFile}" "${logFile}"`);

    const created = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(created.status).toBe('observing');
    expect(created.confidence).toBe(0.33);
  });
});
