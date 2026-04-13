// tests/learning/render-pitfall.test.ts
// Tests for the `render-ready` op — pitfall type handler.
// Validates PF file creation, sequential ID, dedup, TL;DR, and manifest (D5).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHelper, type LogEntry } from './helpers.js';

function makeReadyPitfall(id: string, pattern: string, details?: string): LogEntry {
  const now = new Date().toISOString();
  return {
    id,
    type: 'pitfall',
    pattern,
    confidence: 0.95,
    observations: 2,
    first_seen: now,
    last_seen: now,
    status: 'ready',
    evidence: ['"prior: I will amend"', '"user: no, create new commit"'],
    details: details || 'area: git commits; issue: amending pushed commits; impact: force push needed; resolution: create new commit instead',
    quality_ok: true,
  };
}

describe('render-ready — pitfall type', () => {
  let tmpDir: string;
  let logFile: string;
  let pitfallsFile: string;
  let manifestFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-pf-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    pitfallsFile = path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md');
    manifestFile = path.join(tmpDir, '.memory', '.learning-manifest.json');
    fs.mkdirSync(path.join(tmpDir, '.memory', 'knowledge'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates pitfalls.md with PF-001 for first pitfall', () => {
    const obs = makeReadyPitfall('obs_pf001', 'do not amend pushed commits');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));

    expect(result.rendered).toHaveLength(1);
    expect(result.rendered[0]).toContain('pitfalls.md#PF-001');
    expect(fs.existsSync(pitfallsFile)).toBe(true);

    const content = fs.readFileSync(pitfallsFile, 'utf8');
    expect(content).toContain('## PF-001:');
    expect(content).toContain('do not amend pushed commits');
    expect(content).toContain('**Area**:');
    // Status: Active is required so `devflow learn --review` deprecate can flip it
    expect(content).toContain('- **Status**: Active');
    expect(content).toContain('self-learning:obs_pf001');
  });

  it('assigns PF-002 for second pitfall', () => {
    const obs1 = makeReadyPitfall('obs_pf001', 'do not amend pushed commits');
    fs.writeFileSync(logFile, JSON.stringify(obs1) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const obs2 = makeReadyPitfall('obs_pf002', 'do not delete pending queue files',
      'area: working memory; issue: deleting pending queue; impact: data loss; resolution: check processing state');
    fs.writeFileSync(logFile, JSON.stringify(obs2) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const content = fs.readFileSync(pitfallsFile, 'utf8');
    expect(content).toContain('## PF-001:');
    expect(content).toContain('## PF-002:');
  });

  it('deduplicates: second pitfall with same Area + Issue is skipped', () => {
    const details = 'area: git commits; issue: amending pushed commits; impact: force push; resolution: create new';
    const obs1 = makeReadyPitfall('obs_pf001', 'amend pushed commits pitfall', details);
    fs.writeFileSync(logFile, JSON.stringify(obs1) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    // Same area + issue, different ID
    const obs2 = makeReadyPitfall('obs_pf_dup', 'amend is dangerous', details);
    fs.writeFileSync(logFile, JSON.stringify(obs2) + '\n');
    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    // Only PF-001 should exist
    const content = fs.readFileSync(pitfallsFile, 'utf8');
    expect(content).not.toContain('## PF-002:');
  });

  it('updates TL;DR comment with pitfall count', () => {
    const obs = makeReadyPitfall('obs_pf001', 'amend pushed commits');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const content = fs.readFileSync(pitfallsFile, 'utf8');
    expect(content).toMatch(/<!-- TL;DR: 1 pitfalls\. Key: PF-001 -->/);
  });

  it('updates manifest with anchorId for pitfall', () => {
    const obs = makeReadyPitfall('obs_pf001', 'amend pushed commits');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.entries[0].anchorId).toBe('PF-001');
    expect(manifest.entries[0].type).toBe('pitfall');
  });
});
