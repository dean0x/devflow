// tests/learning/migration.test.ts
// Tests for D7 Greenfield migration — v1 learning-log detection and rename.
//
// DESIGN: D7 — On first v2 run in a project where a v1 learning-log exists
// (detected by absence of quality_ok field on all entries), background-learning
// moves it to .learning-log.v1.jsonl.bak and starts fresh. No dual-writer period.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// The migration logic in background-learning is a bash function. We test it
// by running an isolated inline bash script that mirrors the function exactly,
// so tests are hermetic and do not require full background-learning setup.

const MIGRATION_SCRIPT = `
migrate_v1_log() {
  [ ! -f "$LEARNING_LOG" ] && return

  local has_quality_ok
  has_quality_ok=$(grep -c '"quality_ok"' "$LEARNING_LOG" 2>/dev/null || true)

  if [ "\${has_quality_ok:-0}" -gt 0 ]; then
    return
  fi

  local bak="\${LEARNING_LOG%.jsonl}.v1.jsonl.bak"
  mv "$LEARNING_LOG" "$bak"
}
`;

function runMigration(logPath: string): void {
  const script = `
${MIGRATION_SCRIPT}
LEARNING_LOG="${logPath}"
migrate_v1_log
`;
  execSync(`bash -c '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf8' });
}

describe('D7 — Greenfield migration', () => {
  let tmpDir: string;
  let logFile: string;
  let bakFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    bakFile = path.join(tmpDir, 'learning-log.v1.jsonl.bak');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves v1 log (no quality_ok) to .bak and removes the original', () => {
    // v1 entries: no quality_ok field
    const v1Entries = [
      { id: 'obs_v1a', type: 'workflow', pattern: 'deploy flow', confidence: 0.8, observations: 3, status: 'observing', evidence: ['e1'], details: 'step 1' },
      { id: 'obs_v1b', type: 'procedural', pattern: 'run tests', confidence: 0.6, observations: 2, status: 'observing', evidence: ['e2'], details: 'step 2' },
    ];
    fs.writeFileSync(logFile, v1Entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    runMigration(logFile);

    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(bakFile)).toBe(true);

    const bakContent = fs.readFileSync(bakFile, 'utf8');
    const entries = bakContent.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('obs_v1a');
    expect(entries[1].id).toBe('obs_v1b');
  });

  it('leaves v2 log (has quality_ok) untouched', () => {
    // v2 entries: quality_ok field present
    const v2Entries = [
      { id: 'obs_v2a', type: 'workflow', pattern: 'deploy flow', confidence: 0.8, observations: 3, status: 'ready', evidence: ['e1'], details: 'step 1', quality_ok: true },
      { id: 'obs_v2b', type: 'decision', pattern: 'use Result types', confidence: 0.9, observations: 2, status: 'created', evidence: ['e2'], details: 'context: error handling; decision: Result types; rationale: avoids exceptions', quality_ok: false },
    ];
    fs.writeFileSync(logFile, v2Entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const originalContent = fs.readFileSync(logFile, 'utf8');

    runMigration(logFile);

    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(bakFile)).toBe(false);
    expect(fs.readFileSync(logFile, 'utf8')).toBe(originalContent);
  });

  it('is a no-op when no log exists', () => {
    // logFile does not exist
    expect(fs.existsSync(logFile)).toBe(false);

    runMigration(logFile);

    expect(fs.existsSync(logFile)).toBe(false);
    expect(fs.existsSync(bakFile)).toBe(false);
  });

  it('treats a log with mixed entries (some have quality_ok) as v2', () => {
    // At least one entry has quality_ok — considered v2, do not migrate
    const mixedEntries = [
      { id: 'obs_m1', type: 'workflow', pattern: 'old style', confidence: 0.5, observations: 1, status: 'observing', evidence: ['e1'], details: 'old' },
      { id: 'obs_m2', type: 'procedural', pattern: 'new style', confidence: 0.7, observations: 2, status: 'observing', evidence: ['e2'], details: 'new', quality_ok: true },
    ];
    fs.writeFileSync(logFile, mixedEntries.map(e => JSON.stringify(e)).join('\n') + '\n');

    runMigration(logFile);

    // The presence of quality_ok in any entry means it's already a v2 log
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(bakFile)).toBe(false);
  });
});
