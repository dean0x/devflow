// tests/learning/render-decision.test.ts
// Tests for the `render-ready` op — decision type handler.
// Validates ADR file creation, sequential ID assignment, TL;DR update,
// capacity limit, lock protocol, and manifest update (D5).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const JSON_HELPER = path.resolve(__dirname, '../../scripts/hooks/json-helper.cjs');

function runHelper(args: string): string {
  return execSync(`node "${JSON_HELPER}" ${args}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

interface LogEntry {
  id: string;
  type: string;
  pattern: string;
  confidence: number;
  observations: number;
  first_seen: string;
  last_seen: string;
  status: string;
  evidence: string[];
  details: string;
  quality_ok?: boolean;
  artifact_path?: string;
  pendingCapacity?: boolean;
}

function makeReadyDecision(id: string, pattern: string, details?: string): LogEntry {
  const now = new Date().toISOString();
  return {
    id,
    type: 'decision',
    pattern,
    confidence: 0.95,
    observations: 2,
    first_seen: now,
    last_seen: now,
    status: 'ready',
    evidence: ['"use X because Y"', '"rationale: Y is better"'],
    details: details || 'context: we needed X; decision: use X; rationale: Y avoids Z',
    quality_ok: true,
  };
}

describe('render-ready — decision type', () => {
  let tmpDir: string;
  let logFile: string;
  let knowledgeFile: string;
  let manifestFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-dec-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    knowledgeFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');
    manifestFile = path.join(tmpDir, '.memory', '.learning-manifest.json');
    fs.mkdirSync(path.join(tmpDir, '.memory', 'knowledge'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates decisions.md with ADR-001 for first decision', () => {
    const obs = makeReadyDecision('obs_dec001', 'prefer async over sync for I/O');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));

    expect(result.rendered).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(result.rendered[0]).toContain('decisions.md#ADR-001');

    expect(fs.existsSync(knowledgeFile)).toBe(true);
    const content = fs.readFileSync(knowledgeFile, 'utf8');
    expect(content).toContain('## ADR-001:');
    expect(content).toContain('prefer async over sync for I/O');
    expect(content).toContain('**Status**: Accepted');
    expect(content).toContain('self-learning:obs_dec001');
  });

  it('assigns ADR-002 for second decision in same file', () => {
    // First render
    const obs1 = makeReadyDecision('obs_dec001', 'prefer async over sync');
    fs.writeFileSync(logFile, JSON.stringify(obs1) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    // Reset log for second render
    const obs2 = makeReadyDecision('obs_dec002', 'use Result types not throws');
    fs.writeFileSync(logFile, JSON.stringify(obs2) + '\n');
    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));

    expect(result.rendered).toHaveLength(1);
    const content = fs.readFileSync(knowledgeFile, 'utf8');
    expect(content).toContain('## ADR-001:');
    expect(content).toContain('## ADR-002:');
    expect(content).toContain('use Result types not throws');
  });

  it('updates TL;DR comment with count and top-5 IDs', () => {
    const obs = makeReadyDecision('obs_dec001', 'async is preferred');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const content = fs.readFileSync(knowledgeFile, 'utf8');
    expect(content).toMatch(/<!-- TL;DR: 1 decisions\. Key: ADR-001 -->/);
  });

  it('sets status=created and artifact_path on the log entry', () => {
    const obs = makeReadyDecision('obs_dec001', 'async preferred');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    const updated: LogEntry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.status).toBe('created');
    expect(updated.artifact_path).toContain('decisions.md#ADR-001');
  });

  it('updates manifest with schemaVersion and entry', () => {
    const obs = makeReadyDecision('obs_dec001', 'async preferred');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    runHelper(`render-ready "${logFile}" "${tmpDir}"`);

    expect(fs.existsSync(manifestFile)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].observationId).toBe('obs_dec001');
    expect(manifest.entries[0].type).toBe('decision');
    expect(manifest.entries[0].anchorId).toBe('ADR-001');
    expect(manifest.entries[0].contentHash).toBeTruthy();
  });

  it('skips observations where quality_ok is false', () => {
    const obs: LogEntry = { ...makeReadyDecision('obs_dec_bad', 'bad decision'), quality_ok: false };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));

    expect(result.rendered).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(fs.existsSync(knowledgeFile)).toBe(false);
  });

  it('skips observations with status !== ready', () => {
    const obs: LogEntry = { ...makeReadyDecision('obs_dec_obs', 'observing'), status: 'observing' };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.rendered).toHaveLength(0);
  });

  it('sets pendingCapacity when knowledge file is at capacity (50 entries)', () => {
    // Create a decisions.md with 50 ADR entries
    const header = '<!-- TL;DR: 50 decisions. Key: ADR-050 -->\n# Architectural Decisions\n\nAppend-only.\n';
    let entries = '';
    for (let i = 1; i <= 50; i++) {
      const n = i.toString().padStart(3, '0');
      entries += `\n## ADR-${n}: entry ${i}\n\n- **Date**: 2026-01-01\n- **Status**: Accepted\n- **Source**: test\n`;
    }
    fs.writeFileSync(knowledgeFile, header + entries);

    const obs = makeReadyDecision('obs_capacity', 'this should be capacity-blocked');
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    const result = JSON.parse(runHelper(`render-ready "${logFile}" "${tmpDir}"`));
    expect(result.skipped).toBe(1);

    const updated: LogEntry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    expect(updated.pendingCapacity).toBe(true);
  });
});
