// tests/learning/type-filter.test.ts
// Tests for optional type filter in process-observations, custom manifest/notifications
// paths in render-ready, and custom log/manifest paths in reconcile-manifest.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHelper } from './helpers.js';

// ---------------------------------------------------------------------------
// process-observations --types filter
// ---------------------------------------------------------------------------

describe('process-observations — --types filter', () => {
  let tmpDir: string;
  let logFile: string;
  let responseFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-filter-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    responseFile = path.join(tmpDir, 'response.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('without --types, processes all observation types (backward compat)', () => {
    const response = {
      observations: [
        { id: 'obs_w001', type: 'workflow',   pattern: 'workflow pattern',   evidence: ['e1'], details: 'd1', quality_ok: true },
        { id: 'obs_p001', type: 'procedural', pattern: 'procedural pattern', evidence: ['e2'], details: 'd2', quality_ok: true },
        { id: 'obs_d001', type: 'decision',   pattern: 'decision pattern',   evidence: ['e3'], details: 'd3', quality_ok: true },
        { id: 'obs_f001', type: 'pitfall',    pattern: 'pitfall pattern',    evidence: ['e4'], details: 'd4', quality_ok: true },
      ],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const out = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}"`));

    // All 4 should be created, none skipped by the type filter
    expect(out.created).toBe(4);
    expect(out.skipped).toBe(0);
  });

  it('--types workflow,procedural: skips decision and pitfall observations', () => {
    const response = {
      observations: [
        { id: 'obs_w001', type: 'workflow',   pattern: 'workflow pattern',   evidence: ['e1'], details: 'd1', quality_ok: true },
        { id: 'obs_p001', type: 'procedural', pattern: 'procedural pattern', evidence: ['e2'], details: 'd2', quality_ok: true },
        { id: 'obs_d001', type: 'decision',   pattern: 'decision pattern',   evidence: ['e3'], details: 'd3', quality_ok: true },
        { id: 'obs_f001', type: 'pitfall',    pattern: 'pitfall pattern',    evidence: ['e4'], details: 'd4', quality_ok: true },
      ],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const out = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}" --types workflow,procedural`));

    // Only workflow and procedural created; decision and pitfall skipped by type filter
    expect(out.created).toBe(2);
    expect(out.skipped).toBe(2);

    // Only workflow and procedural entries should be in the log
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    const entries = lines.map(l => JSON.parse(l));
    const types = new Set(entries.map((e: { type: string }) => e.type));
    expect(types.has('workflow')).toBe(true);
    expect(types.has('procedural')).toBe(true);
    expect(types.has('decision')).toBe(false);
    expect(types.has('pitfall')).toBe(false);
  });

  it('--types decision,pitfall: skips workflow and procedural observations', () => {
    const response = {
      observations: [
        { id: 'obs_w001', type: 'workflow',   pattern: 'workflow pattern',   evidence: ['e1'], details: 'd1', quality_ok: true },
        { id: 'obs_p001', type: 'procedural', pattern: 'procedural pattern', evidence: ['e2'], details: 'd2', quality_ok: true },
        { id: 'obs_d001', type: 'decision',   pattern: 'decision pattern',   evidence: ['e3'], details: 'd3', quality_ok: true },
        { id: 'obs_f001', type: 'pitfall',    pattern: 'pitfall pattern',    evidence: ['e4'], details: 'd4', quality_ok: true },
      ],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const out = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}" --types decision,pitfall`));

    // Only decision and pitfall created; workflow and procedural skipped by type filter
    expect(out.created).toBe(2);
    expect(out.skipped).toBe(2);

    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    const entries = lines.map(l => JSON.parse(l));
    const types = new Set(entries.map((e: { type: string }) => e.type));
    expect(types.has('decision')).toBe(true);
    expect(types.has('pitfall')).toBe(true);
    expect(types.has('workflow')).toBe(false);
    expect(types.has('procedural')).toBe(false);
  });

  it('--types filter increments skipped counter for filtered types', () => {
    const response = {
      observations: [
        { id: 'obs_d001', type: 'decision', pattern: 'some decision', evidence: ['e1'], details: 'd1', quality_ok: true },
        { id: 'obs_d002', type: 'decision', pattern: 'another decision', evidence: ['e2'], details: 'd2', quality_ok: true },
      ],
    };
    fs.writeFileSync(responseFile, JSON.stringify(response));

    const out = JSON.parse(runHelper(`process-observations "${responseFile}" "${logFile}" --types workflow`));

    expect(out.created).toBe(0);
    expect(out.skipped).toBe(2);
    // Log file should be created but empty of entries
    const entries = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    expect(entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// render-ready --manifest-path
// ---------------------------------------------------------------------------

describe('render-ready — --manifest-path', () => {
  let tmpDir: string;
  let logFile: string;
  let baseDir: string;
  let customManifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-ready-test-'));
    logFile = path.join(tmpDir, 'learning-log.jsonl');
    baseDir = tmpDir;
    customManifestPath = path.join(tmpDir, 'custom-manifest.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('without --manifest-path, writes manifest to default location', () => {
    // A ready workflow observation
    const obs = {
      id: 'obs_w001',
      type: 'workflow',
      pattern: 'deploy workflow steps',
      confidence: 0.95,
      observations: 3,
      first_seen: new Date(Date.now() - 4 * 86400 * 1000).toISOString(),
      last_seen: new Date().toISOString(),
      status: 'ready',
      evidence: ['evidence 1', 'evidence 2'],
      details: 'step 1; step 2',
      quality_ok: true,
    };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');

    runHelper(`render-ready "${logFile}" "${baseDir}"`);

    const defaultManifestPath = path.join(baseDir, '.memory', '.learning-manifest.json');
    expect(fs.existsSync(defaultManifestPath)).toBe(true);
    expect(fs.existsSync(customManifestPath)).toBe(false);
  });

  it('--manifest-path writes manifest to custom path instead of default', () => {
    const obs = {
      id: 'obs_w002',
      type: 'workflow',
      pattern: 'custom manifest workflow test',
      confidence: 0.95,
      observations: 3,
      first_seen: new Date(Date.now() - 4 * 86400 * 1000).toISOString(),
      last_seen: new Date().toISOString(),
      status: 'ready',
      evidence: ['evidence a'],
      details: 'step a; step b',
      quality_ok: true,
    };
    fs.writeFileSync(logFile, JSON.stringify(obs) + '\n');
    fs.mkdirSync(path.dirname(customManifestPath), { recursive: true });

    runHelper(`render-ready "${logFile}" "${baseDir}" --manifest-path "${customManifestPath}"`);

    // Custom manifest should be written
    expect(fs.existsSync(customManifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(customManifestPath, 'utf8'));
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].observationId).toBe('obs_w002');

    // Default manifest should NOT be created
    const defaultManifestPath = path.join(baseDir, '.memory', '.learning-manifest.json');
    expect(fs.existsSync(defaultManifestPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reconcile-manifest — custom log and manifest paths
// ---------------------------------------------------------------------------

describe('reconcile-manifest — custom logFile and manifestPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('without custom paths, uses default .memory/learning-log.jsonl and .memory/.learning-manifest.json', () => {
    // Create default log file so reconcile-manifest does not short-circuit
    const memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    const defaultLog = path.join(memoryDir, 'learning-log.jsonl');
    fs.writeFileSync(defaultLog, ''); // empty — no entries to reconcile

    const out = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));
    // Empty log → all counters zero
    expect(out.deletions).toBe(0);
    expect(out.edits).toBe(0);
    expect(out.healed).toBe(0);
  });

  it('with custom logFile: reads from the specified log file', () => {
    const customLog = path.join(tmpDir, 'custom-log.jsonl');
    // Empty log — no entries, so reconcile short-circuits immediately
    // (before acquiring lock)
    const result = runHelper(`reconcile-manifest "${tmpDir}" "${customLog}"`);
    const out = JSON.parse(result);
    // Log does not exist → emptyReconcileResult returned
    expect(out.deletions).toBe(0);
    expect(out.edits).toBe(0);
    expect(out.healed).toBe(0);
  });

  it('with custom logFile and manifestPath: uses both custom paths', () => {
    // reconcile-manifest always uses <cwd>/.memory/.learning.lock — create that dir
    const memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    const customLog = path.join(tmpDir, 'custom-log.jsonl');
    const customManifest = path.join(tmpDir, 'custom-manifest.json');

    // Write a minimal log with one created entry
    const entry = {
      id: 'obs_w001',
      type: 'workflow',
      pattern: 'deploy workflow',
      confidence: 0.95,
      observations: 3,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      status: 'created',
      evidence: ['e1'],
      details: 'step 1',
      quality_ok: true,
      artifact_path: path.join(tmpDir, 'nonexistent-artifact.md'),
    };
    fs.writeFileSync(customLog, JSON.stringify(entry) + '\n');

    // Write a manifest pointing to a non-existent artifact path
    const manifest = {
      schemaVersion: 1,
      entries: [{
        observationId: 'obs_w001',
        type: 'workflow',
        path: path.join(tmpDir, 'nonexistent-artifact.md'),
        contentHash: 'abc123',
        renderedAt: new Date().toISOString(),
      }],
    };
    fs.writeFileSync(customManifest, JSON.stringify(manifest, null, 2));

    const out = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}" "${customLog}" "${customManifest}"`));

    // The artifact file doesn't exist → detected as deletion
    expect(out.deletions).toBe(1);

    // The custom manifest should be updated (not the default one)
    const updatedManifest = JSON.parse(fs.readFileSync(customManifest, 'utf8'));
    expect(updatedManifest.entries).toHaveLength(0); // deletion removed the entry

    // Default manifest should NOT have been created
    const defaultManifest = path.join(memoryDir, '.learning-manifest.json');
    expect(fs.existsSync(defaultManifest)).toBe(false);
  });
});
