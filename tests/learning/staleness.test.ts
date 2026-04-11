// tests/learning/staleness.test.ts
// Tests for staleness pass in background-learning (D16).
// Since the staleness pass is in the shell script, we test the underlying
// logic by running it via a small node script that mirrors the grep-based check.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { JSON_HELPER } from './helpers.js';

const BACKGROUND_LEARNING = path.resolve(__dirname, '../../scripts/hooks/background-learning');

// Helper: minimal staleness check via node script that mirrors background-learning logic
// (D16 — grep-based staleness: extract file refs from details/evidence, check existence)
function checkStaleEntries(
  entries: Record<string, unknown>[],
  cwd: string,
): Record<string, unknown>[] {
  // Inline the staleness algorithm for testing without spawning the full shell script
  const FILE_REF_RE = /[A-Za-z0-9_/.-]+\.(ts|tsx|js|cjs|md|sh|py|go|java|rs)/g;

  return entries.map(entry => {
    const combined = `${entry.details || ''} ${(entry.evidence as string[] || []).join(' ')}`;
    const refs = combined.match(FILE_REF_RE) || [];
    const uniqueRefs = [...new Set(refs)];

    let staleRef: string | null = null;
    for (const ref of uniqueRefs) {
      const absPath = ref.startsWith('/') ? ref : path.join(cwd, ref);
      if (!fs.existsSync(absPath)) {
        staleRef = ref;
        break;
      }
    }

    if (staleRef) {
      return { ...entry, mayBeStale: true, staleReason: `code-ref-missing:${staleRef}` };
    }
    return entry;
  });
}

describe('staleness detection (D16)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flags entry as stale when referenced file is deleted', () => {
    // Create a file that will be referenced
    const refFile = path.join(tmpDir, 'src', 'hooks.ts');
    fs.mkdirSync(path.dirname(refFile), { recursive: true });
    fs.writeFileSync(refFile, '// hook code\n');

    const entries = [{
      id: 'obs_stale001',
      type: 'procedural',
      pattern: 'debug hooks',
      details: 'Check src/hooks.ts for hook definitions',
      evidence: ['look at src/hooks.ts first'],
      status: 'observing',
    }];

    // Verify NOT stale when file exists
    const before = checkStaleEntries(entries, tmpDir);
    expect(before[0].mayBeStale).toBeUndefined();

    // Delete the file
    fs.unlinkSync(refFile);

    // Now should be stale
    const after = checkStaleEntries(entries, tmpDir);
    expect(after[0].mayBeStale).toBe(true);
    expect(after[0].staleReason).toContain('code-ref-missing:');
    expect(after[0].staleReason).toContain('hooks.ts');
  });

  it('does not flag entry when all referenced files exist', () => {
    const refFile = path.join(tmpDir, 'scripts', 'deploy.sh');
    fs.mkdirSync(path.dirname(refFile), { recursive: true });
    fs.writeFileSync(refFile, '#!/bin/bash\n');

    const entries = [{
      id: 'obs_no_stale',
      type: 'workflow',
      pattern: 'run deploy script',
      details: 'Execute scripts/deploy.sh with proper flags',
      evidence: ['run scripts/deploy.sh after tests'],
      status: 'created',
    }];

    const result = checkStaleEntries(entries, tmpDir);
    expect(result[0].mayBeStale).toBeUndefined();
    expect(result[0].staleReason).toBeUndefined();
  });

  it('does not flag entry with no file references', () => {
    const entries = [{
      id: 'obs_no_refs',
      type: 'decision',
      pattern: 'use async functions',
      details: 'context: performance; decision: use async; rationale: non-blocking',
      evidence: ['async is better because non-blocking'],
      status: 'observing',
    }];

    const result = checkStaleEntries(entries, tmpDir);
    expect(result[0].mayBeStale).toBeUndefined();
  });

  it('picks up file references from evidence array as well as details', () => {
    // Only referenced in evidence, not details
    const refFile = path.join(tmpDir, 'config.md');
    fs.writeFileSync(refFile, '# Config\n');

    const entries = [{
      id: 'obs_evid_ref',
      type: 'procedural',
      pattern: 'update config',
      details: 'No file reference here',
      evidence: ['always edit config.md before deploying'],
      status: 'observing',
    }];

    // File exists — not stale
    const before = checkStaleEntries(entries, tmpDir);
    expect(before[0].mayBeStale).toBeUndefined();

    fs.unlinkSync(refFile);

    // File deleted — stale
    const after = checkStaleEntries(entries, tmpDir);
    expect(after[0].mayBeStale).toBe(true);
    expect(after[0].staleReason).toContain('config.md');
  });

  it('handles entries with multiple file refs — flags on first missing', () => {
    const existingFile = path.join(tmpDir, 'exists.ts');
    fs.writeFileSync(existingFile, '// exists\n');
    // missing.ts is intentionally not created

    const entries = [{
      id: 'obs_multi_ref',
      type: 'procedural',
      pattern: 'multi-file workflow',
      details: 'Modify exists.ts then update missing.ts accordingly',
      evidence: ['both exists.ts and missing.ts need changes'],
      status: 'observing',
    }];

    const result = checkStaleEntries(entries, tmpDir);
    expect(result[0].mayBeStale).toBe(true);
    expect(result[0].staleReason).toContain('missing.ts');
  });
});

describe('staleness — via json-helper process-observations integration', () => {
  let tmpDir: string;
  let logFile: string;
  let responseFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-int-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    responseFile = path.join(tmpDir, 'response.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('process-observations stores observations correctly (base for staleness)', () => {
    const response = {
      observations: [{
        id: 'obs_base001',
        type: 'procedural',
        pattern: 'check lock files',
        evidence: ['check .memory/.learning.lock first'],
        details: 'When debugging: check scripts/hooks/json-helper.cjs for errors',
        quality_ok: true,
      }],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    execSync(`node "${JSON_HELPER}" process-observations "${responseFile}" "${logFile}"`, { encoding: 'utf8' });

    const entries = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(entries[0].id).toBe('obs_base001');
    // Staleness is checked separately in shell script — just verify the observation was stored
    expect(entries[0].status).toBe('observing');
  });
});
