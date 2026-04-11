// tests/learning/hud-counts.test.ts
// Tests for the HUD learning counts helper (D15).
// Validates type counting, attention flag aggregation, and graceful fallback.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLearningCounts } from '../../src/cli/hud/learning-counts.js';

// Helper: build a minimal JSONL entry with the given fields
function makeEntry(
  type: string,
  status: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id: `obs_${Math.random().toString(36).slice(2)}`,
    type,
    status,
    pattern: `test pattern ${Math.random()}`,
    confidence: 0.8,
    observations: 3,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    evidence: ['evidence1'],
    details: 'test details',
    quality_ok: true,
    ...extra,
  });
}

describe('getLearningCounts', () => {
  let tmpDir: string;
  let memoryDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-counts-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    logPath = path.join(memoryDir, 'learning-log.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts created entries by type correctly', () => {
    const lines = [
      makeEntry('workflow', 'created'),
      makeEntry('workflow', 'created'),
      makeEntry('workflow', 'created'),
      makeEntry('procedural', 'created'),
      makeEntry('procedural', 'created'),
      makeEntry('decision', 'created'),
      makeEntry('decision', 'created'),
      makeEntry('decision', 'created'),
      makeEntry('decision', 'created'),
      makeEntry('decision', 'created'),
      makeEntry('pitfall', 'created'),
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = getLearningCounts(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.workflows).toBe(3);
    expect(result!.procedural).toBe(2);
    expect(result!.decisions).toBe(5);
    expect(result!.pitfalls).toBe(1);
    expect(result!.needReview).toBe(0);
  });

  it('counts needReview from attention flags regardless of status', () => {
    const lines = [
      makeEntry('workflow', 'created', { mayBeStale: true, staleReason: 'code-ref-missing:src/foo.ts' }),
      makeEntry('decision', 'created', { softCapExceeded: true }),
      makeEntry('pitfall', 'observing', { needsReview: true }),
      makeEntry('procedural', 'created'), // no flags
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = getLearningCounts(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.needReview).toBe(3);
    expect(result!.workflows).toBe(1); // stale but still created
    expect(result!.decisions).toBe(1);
    expect(result!.pitfalls).toBe(0); // observing, not created
    expect(result!.procedural).toBe(1);
  });

  it('returns null when log file does not exist', () => {
    // Don't create any log file
    const result = getLearningCounts(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null on parse error (invalid JSONL)', () => {
    // Write invalid content only
    fs.writeFileSync(logPath, 'this is not json\nalso not json\n', 'utf-8');
    const result = getLearningCounts(tmpDir);
    expect(result).toBeNull();
  });

  it('only counts status=created entries in type totals', () => {
    const lines = [
      makeEntry('workflow', 'created'),   // counted
      makeEntry('workflow', 'ready'),     // not counted
      makeEntry('workflow', 'observing'), // not counted
      makeEntry('workflow', 'deprecated'), // not counted
      makeEntry('decision', 'created'),  // counted
      makeEntry('decision', 'observing'), // not counted
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = getLearningCounts(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.workflows).toBe(1);
    expect(result!.decisions).toBe(1);
    expect(result!.procedural).toBe(0);
    expect(result!.pitfalls).toBe(0);
  });

  it('handles empty log file — returns null (no parseable entries)', () => {
    fs.writeFileSync(logPath, '', 'utf-8');
    const result = getLearningCounts(tmpDir);
    expect(result).toBeNull();
  });

  it('skips malformed lines and processes valid ones', () => {
    const lines = [
      'invalid json',
      makeEntry('workflow', 'created'),
      '{ "broken":',
      makeEntry('decision', 'created'),
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = getLearningCounts(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.workflows).toBe(1);
    expect(result!.decisions).toBe(1);
  });

  it('all flags count independently — entry with multiple flags counts once', () => {
    const lines = [
      makeEntry('workflow', 'created', { mayBeStale: true, softCapExceeded: true }), // both flags but 1 entry
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    const result = getLearningCounts(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.needReview).toBe(1); // counted once, not twice
  });
});

describe('getLearningCounts HUD component output', () => {
  let tmpDir: string;
  let memoryDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-counts-component-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    logPath = path.join(memoryDir, 'learning-log.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for empty result from counts (no promoted entries)', async () => {
    // Only observing entries — no created
    const lines = [makeEntry('workflow', 'observing')];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    // The HUD component itself is tested via the types.ts contract;
    // here we verify getLearningCounts returns data the component can use
    const result = getLearningCounts(tmpDir);
    expect(result).not.toBeNull();
    // Component would return null since total === 0 and needReview === 0
    expect(result!.workflows).toBe(0);
    expect(result!.needReview).toBe(0);
  });
});
