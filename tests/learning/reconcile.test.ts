// tests/learning/reconcile.test.ts
// Tests for the `reconcile-manifest` op (D6, D13).
// Validates deletion detection, edit detection, no-change, anchor checks.

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

interface ManifestEntry {
  observationId: string;
  type: string;
  path: string;
  contentHash: string;
  renderedAt: string;
  anchorId?: string;
}

interface Manifest {
  schemaVersion: number;
  entries: ManifestEntry[];
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
  status_deprecated?: string;
  deprecated_at?: string;
}

function setup(tmpDir: string) {
  fs.mkdirSync(path.join(tmpDir, '.memory', 'knowledge'), { recursive: true });
  const manifestPath = path.join(tmpDir, '.memory', '.learning-manifest.json');
  const logPath = path.join(tmpDir, '.memory', 'learning-log.jsonl');
  return { manifestPath, logPath };
}

function writeManifest(manifestPath: string, entries: ManifestEntry[]): void {
  const manifest: Manifest = { schemaVersion: 1, entries };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function writeLog(logPath: string, entries: LogEntry[]): void {
  fs.writeFileSync(logPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function readLog(logPath: string): LogEntry[] {
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function readManifest(manifestPath: string): Manifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

const NOW = new Date().toISOString();

function baseEntry(id: string, type = 'workflow', status = 'created'): LogEntry {
  return {
    id, type,
    pattern: 'test pattern',
    confidence: 0.95,
    observations: 3,
    first_seen: NOW,
    last_seen: NOW,
    status,
    evidence: ['e1'],
    details: 'details',
    quality_ok: true,
  };
}

describe('reconcile-manifest — deletion detection (D6)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletion: manifest entry with missing file → confidence × 0.3, status=deprecated', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const missingPath = path.join(tmpDir, '.claude', 'commands', 'self-learning', 'gone.md');

    writeManifest(manifestPath, [{
      observationId: 'obs_del001',
      type: 'workflow',
      path: missingPath,
      contentHash: 'abc123',
      renderedAt: NOW,
    }]);

    const entry = { ...baseEntry('obs_del001'), confidence: 0.90 };
    writeLog(logPath, [entry]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.deletions).toBe(1);
    expect(result.unchanged).toBe(0);

    const entries = readLog(logPath);
    expect(entries[0].confidence).toBeCloseTo(0.90 * 0.3, 2);
    expect(entries[0].status).toBe('deprecated');
    expect(entries[0].deprecated_at).toBeTruthy();
  });

  it('deletion: manifest entry removed from manifest after file deletion', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const missingPath = path.join(tmpDir, 'gone.md');

    writeManifest(manifestPath, [{
      observationId: 'obs_del002',
      type: 'workflow',
      path: missingPath,
      contentHash: 'xyz',
      renderedAt: NOW,
    }]);
    writeLog(logPath, [baseEntry('obs_del002')]);

    runHelper(`reconcile-manifest "${tmpDir}"`);

    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(0);
  });
});

describe('reconcile-manifest — edit detection (D13)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-edit-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('edit: existing file with different content hash → hash updated, no confidence penalty (D13)', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const filePath = path.join(tmpDir, 'my-command.md');
    fs.writeFileSync(filePath, '# My command\n\nOriginal content here\n');

    writeManifest(manifestPath, [{
      observationId: 'obs_edit001',
      type: 'workflow',
      path: filePath,
      contentHash: 'old-hash-value',
      renderedAt: NOW,
    }]);

    const entry = { ...baseEntry('obs_edit001'), confidence: 0.80 };
    writeLog(logPath, [entry]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.edits).toBe(1);
    expect(result.deletions).toBe(0);

    // Confidence should NOT change (D13)
    const entries = readLog(logPath);
    expect(entries[0].confidence).toBe(0.80);
    expect(entries[0].status).toBe('created');

    // Hash should be updated in manifest
    const manifest = readManifest(manifestPath);
    expect(manifest.entries[0].contentHash).not.toBe('old-hash-value');
    expect(manifest.entries[0].contentHash).toBeTruthy();
  });

  it('no-change: same hash → no mutation', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const filePath = path.join(tmpDir, 'stable.md');
    const content = '# Stable\n\nThis content does not change\n';
    fs.writeFileSync(filePath, content);

    // We need to get the real hash first by running render-ready on a file
    // Instead, let's manually compute it using same djb2 algorithm
    function djb2(s: string): string {
      let h = 5381;
      for (let i = 0; i < s.length; i++) {
        h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
      }
      return h.toString(16);
    }
    const hash = djb2(content);

    writeManifest(manifestPath, [{
      observationId: 'obs_nochange',
      type: 'workflow',
      path: filePath,
      contentHash: hash,
      renderedAt: NOW,
    }]);
    writeLog(logPath, [{ ...baseEntry('obs_nochange'), confidence: 0.75 }]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.unchanged).toBe(1);
    expect(result.edits).toBe(0);
    expect(result.deletions).toBe(0);
  });
});

describe('reconcile-manifest — anchor handling (D6)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-anchor-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ADR anchor missing from file → treated as deletion', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');
    // File exists but doesn't have ADR-002
    fs.writeFileSync(decisionFile, '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n\n## ADR-001: first decision\n\n- **Status**: Accepted\n');

    writeManifest(manifestPath, [{
      observationId: 'obs_anchor001',
      type: 'decision',
      path: decisionFile,
      contentHash: 'old-hash',
      renderedAt: NOW,
      anchorId: 'ADR-002', // not present in file
    }]);
    const entry = { ...baseEntry('obs_anchor001', 'decision'), confidence: 0.90 };
    writeLog(logPath, [entry]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.deletions).toBe(1);
    const entries = readLog(logPath);
    expect(entries[0].status).toBe('deprecated');
    expect(entries[0].confidence).toBeCloseTo(0.90 * 0.3, 2);
  });

  it('ADR anchor present in file → no deletion', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');
    fs.writeFileSync(decisionFile, '<!-- TL;DR: 1 decisions. Key: ADR-001 -->\n# Decisions\n\n## ADR-001: the decision\n\n- **Status**: Accepted\n');

    writeManifest(manifestPath, [{
      observationId: 'obs_anchor002',
      type: 'decision',
      path: decisionFile,
      contentHash: 'some-hash',
      renderedAt: NOW,
      anchorId: 'ADR-001', // present in file
    }]);
    writeLog(logPath, [{ ...baseEntry('obs_anchor002', 'decision'), confidence: 0.85 }]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.deletions).toBe(0);
    // Might be unchanged or edit depending on hash
    const entries = readLog(logPath);
    expect(entries[0].status).toBe('created');
    expect(entries[0].confidence).toBe(0.85);
  });
});

describe('reconcile-manifest — stale manifest entries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-stale-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stale manifest entry (no obs in log) → silently dropped from manifest', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const filePath = path.join(tmpDir, 'some-file.md');
    fs.writeFileSync(filePath, '# Some content\n');

    writeManifest(manifestPath, [{
      observationId: 'obs_stale_only_in_manifest',
      type: 'workflow',
      path: filePath,
      contentHash: 'abc',
      renderedAt: NOW,
    }]);

    // Log is empty — no matching obs
    writeLog(logPath, []);

    runHelper(`reconcile-manifest "${tmpDir}"`);

    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(0);
  });

  it('no-op when both manifest and log files are missing', () => {
    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));
    expect(result.deletions).toBe(0);
    expect(result.edits).toBe(0);
    expect(result.unchanged).toBe(0);
  });
});
