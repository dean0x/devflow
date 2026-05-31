// tests/learning/staleness.test.ts
// Tests for staleness pass in the learning pipeline (D16).
// Imports the real checkStaleEntries from scripts/hooks/lib/staleness.cjs — the
// shared implementation used by devflow learn --run-background — so tests exercise
// the actual algorithm rather than a TypeScript reimplementation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkStaleEntries } = require('../../scripts/hooks/lib/staleness.cjs') as {
  checkStaleEntries: (entries: Record<string, unknown>[], cwd: string) => Record<string, unknown>[];
};

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

// process-observations integration block removed in Part A — op was removed (zero
// production callers). The staleness signal is now consumed directly by the LLM
// sidecar-processor via staleness.cjs invocation during the learning phase. See SKILL.md.
