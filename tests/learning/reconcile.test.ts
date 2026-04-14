// tests/learning/reconcile.test.ts
// Tests for the `reconcile-manifest` op (D6, D13).
// Validates deletion detection, edit detection, no-change, anchor checks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runHelper, type LogEntry } from './helpers.js';

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

// ---------------------------------------------------------------------------
// Self-healing reconciler tests (Fix 2)
// Validates that reconcile-manifest heals render-ready crash-window duplicates:
// anchors present in knowledge files but missing from manifest + log shows status=ready
// ---------------------------------------------------------------------------

describe('reconcile-manifest — self-heal (Fix 2)', () => {
  let tmpDir: string;

  // djb2 hash — matches contentHash() in json-helper.cjs
  function djb2(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  }

  // Build a decisions.md with the given ADR sections
  function buildDecisionsFile(sections: Array<{ anchorId: string; heading: string; body: string }>): string {
    const parts = sections.map(s =>
      `## ${s.anchorId}: ${s.heading}\n\n${s.body}\n`
    );
    return `<!-- TL;DR: ${sections.length} decisions. -->\n# Decisions\n\n${parts.join('\n')}`;
  }

  // Build a pitfalls.md with the given PF sections
  function buildPitfallsFile(sections: Array<{ anchorId: string; heading: string; body: string }>): string {
    const parts = sections.map(s =>
      `## ${s.anchorId}: ${s.heading}\n\n${s.body}\n`
    );
    return `<!-- TL;DR: ${sections.length} pitfalls. -->\n# Pitfalls\n\n${parts.join('\n')}`;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-heal-test-'));
    fs.mkdirSync(path.join(tmpDir, '.memory', 'knowledge'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('heal: anchor in file + ready log entry + missing manifest → status=created, manifest reconstructed', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');

    // decisions.md has ADR-001 written (crash window: file written, log not updated yet)
    const adrContent = buildDecisionsFile([{
      anchorId: 'ADR-001',
      heading: 'use result types everywhere',
      body: '- **Status**: Accepted\n- **Source**: self-learning:obs_heal_001',
    }]);
    fs.writeFileSync(decisionFile, adrContent);

    // Manifest is empty (crash happened before manifest write)
    writeManifest(manifestPath, []);

    // Log still shows status=ready (crash happened before log write)
    const obs: LogEntry = {
      ...baseEntry('obs_heal_001', 'decision', 'ready'),
      pattern: 'use result types everywhere',
      confidence: 0.90,
    };
    writeLog(logPath, [obs]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    // healed counter must be present and non-zero
    expect(result.healed).toBe(1);

    // Log entry upgraded to created
    const entries = readLog(logPath);
    const healed = entries.find(e => e.id === 'obs_heal_001');
    expect(healed).toBeDefined();
    expect(healed!.status).toBe('created');
    expect(healed!.artifact_path).toContain('ADR-001');

    // Manifest now has an entry for this obs
    const manifest = readManifest(manifestPath);
    const manifestEntry = manifest.entries.find(e => e.observationId === 'obs_heal_001');
    expect(manifestEntry).toBeDefined();
    expect(manifestEntry!.anchorId).toBe('ADR-001');
    expect(manifestEntry!.path).toBe(decisionFile);
    expect(manifestEntry!.contentHash).toBeTruthy();
  });

  it('heal: anchor in file, no matching log entry → no-op (user-curated entry)', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');

    // decisions.md has ADR-001 but NO matching log entry (user manually added it)
    const adrContent = buildDecisionsFile([{
      anchorId: 'ADR-001',
      heading: 'manual decision',
      body: '- **Status**: Accepted',
    }]);
    fs.writeFileSync(decisionFile, adrContent);

    writeManifest(manifestPath, []);

    // Log has a different obs that doesn't match the heading
    const obs: LogEntry = {
      ...baseEntry('obs_other_001', 'decision', 'ready'),
      pattern: 'completely different pattern',
    };
    writeLog(logPath, [obs]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.healed).toBe(0);

    // The manifest should remain empty
    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(0);
  });

  it('heal: anchor heading does not match any ready log pattern → no-op', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');

    const adrContent = buildDecisionsFile([{
      anchorId: 'ADR-001',
      heading: 'use dependency injection',
      body: '- **Status**: Accepted\n- **Source**: self-learning:obs_heal_002',
    }]);
    fs.writeFileSync(decisionFile, adrContent);

    writeManifest(manifestPath, []);

    // Pattern in log uses a different heading text → no match after normalizeForDedup
    const obs: LogEntry = {
      ...baseEntry('obs_heal_002', 'decision', 'ready'),
      pattern: 'prefer factory methods over constructors',
    };
    writeLog(logPath, [obs]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.healed).toBe(0);
    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(0);
  });

  it('heal: multiple log entries match the same anchor heading → no-op (D-D ambiguity guard)', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');

    const heading = 'use result types everywhere';
    const adrContent = buildDecisionsFile([{
      anchorId: 'ADR-001',
      heading,
      body: '- **Status**: Accepted',
    }]);
    fs.writeFileSync(decisionFile, adrContent);

    writeManifest(manifestPath, []);

    // Two log entries with the same normalised pattern — ambiguous, must skip
    const obs1: LogEntry = { ...baseEntry('obs_ambig_001', 'decision', 'ready'), pattern: heading };
    const obs2: LogEntry = { ...baseEntry('obs_ambig_002', 'decision', 'ready'), pattern: heading };
    writeLog(logPath, [obs1, obs2]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.healed).toBe(0);
    // Both log entries remain 'ready'
    const entries = readLog(logPath);
    expect(entries.every(e => e.status === 'ready')).toBe(true);
  });

  it('heal: pitfalls.md scanned with PF- prefix', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const pitfallFile = path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md');

    const pfContent = buildPitfallsFile([{
      anchorId: 'PF-001',
      heading: 'avoid mutation in reducers',
      body: '- **Area**: State management\n- **Issue**: Mutation causes silent bugs\n- **Source**: self-learning:obs_pf_001',
    }]);
    fs.writeFileSync(pitfallFile, pfContent);

    writeManifest(manifestPath, []);

    const obs: LogEntry = {
      ...baseEntry('obs_pf_001', 'pitfall', 'ready'),
      pattern: 'avoid mutation in reducers',
    };
    writeLog(logPath, [obs]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.healed).toBe(1);

    const entries = readLog(logPath);
    const healed = entries.find(e => e.id === 'obs_pf_001');
    expect(healed!.status).toBe('created');
    expect(healed!.artifact_path).toContain('PF-001');

    const manifest = readManifest(manifestPath);
    const mEntry = manifest.entries.find(e => e.observationId === 'obs_pf_001');
    expect(mEntry!.anchorId).toBe('PF-001');
    expect(mEntry!.path).toBe(pitfallFile);
  });

  it('heal: multiple anchors healed in a single reconcile pass', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');
    const pitfallFile = path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md');

    // decisions.md has ADR-001 and ADR-002; pitfalls.md has PF-001
    const adrContent = buildDecisionsFile([
      { anchorId: 'ADR-001', heading: 'use immutable data structures', body: '- **Status**: Accepted\n- **Source**: self-learning:obs_multi_001' },
      { anchorId: 'ADR-002', heading: 'inject dependencies explicitly', body: '- **Status**: Accepted\n- **Source**: self-learning:obs_multi_002' },
    ]);
    fs.writeFileSync(decisionFile, adrContent);

    const pfContent = buildPitfallsFile([
      { anchorId: 'PF-001', heading: 'avoid global state mutations', body: '- **Area**: State\n- **Issue**: Silent bugs\n- **Source**: self-learning:obs_multi_003' },
    ]);
    fs.writeFileSync(pitfallFile, pfContent);

    writeManifest(manifestPath, []);

    const obs1: LogEntry = { ...baseEntry('obs_multi_001', 'decision', 'ready'), pattern: 'use immutable data structures' };
    const obs2: LogEntry = { ...baseEntry('obs_multi_002', 'decision', 'ready'), pattern: 'inject dependencies explicitly' };
    const obs3: LogEntry = { ...baseEntry('obs_multi_003', 'pitfall', 'ready'), pattern: 'avoid global state mutations' };
    writeLog(logPath, [obs1, obs2, obs3]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result.healed).toBe(3);

    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(3);

    const anchorIds = manifest.entries.map(e => e.anchorId);
    expect(anchorIds).toContain('ADR-001');
    expect(anchorIds).toContain('ADR-002');
    expect(anchorIds).toContain('PF-001');
  });

  it('heal: registerUsageEntry called — usage file has entry for healed anchorId', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');

    const adrContent = buildDecisionsFile([{
      anchorId: 'ADR-001',
      heading: 'use result types everywhere',
      body: '- **Status**: Accepted\n- **Source**: self-learning:obs_usage_001',
    }]);
    fs.writeFileSync(decisionFile, adrContent);

    writeManifest(manifestPath, []);

    const obs: LogEntry = {
      ...baseEntry('obs_usage_001', 'decision', 'ready'),
      pattern: 'use result types everywhere',
    };
    writeLog(logPath, [obs]);

    runHelper(`reconcile-manifest "${tmpDir}"`);

    // Verify usage file was written with ADR-001 entry
    const usagePath = path.join(tmpDir, '.memory', '.knowledge-usage.json');
    expect(fs.existsSync(usagePath)).toBe(true);
    const usageData = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    expect(usageData.entries['ADR-001']).toBeDefined();
    expect(usageData.entries['ADR-001'].cites).toBe(0);
  });

  it('result JSON always includes healed counter — zero case (no anchors to heal)', () => {
    const { manifestPath, logPath } = setup(tmpDir);
    const filePath = path.join(tmpDir, 'my-workflow.md');
    fs.writeFileSync(filePath, '# Workflow\n');

    // Normal workflow entry — already tracked in manifest and log
    writeManifest(manifestPath, [{
      observationId: 'obs_zero_heal',
      type: 'workflow',
      path: filePath,
      contentHash: djb2('# Workflow\n'),
      renderedAt: NOW,
    }]);
    writeLog(logPath, [{ ...baseEntry('obs_zero_heal', 'workflow', 'created') }]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    expect(result).toHaveProperty('healed');
    expect(result.healed).toBe(0);
    // Other fields still present
    expect(result).toHaveProperty('deletions');
    expect(result).toHaveProperty('edits');
    expect(result).toHaveProperty('unchanged');
  });

  it('heal: pre-v2 anchor lacking self-learning source marker → no-op even when log obs would match', () => {
    // Regression guard: a pre-v2 seeded section whose heading happens to match a
    // current ready obs by normalizeForDedup must NOT be paired. Pre-v2 entries
    // are removed by the v3 migration; the heal path must not steal their anchor IDs.
    const { manifestPath, logPath } = setup(tmpDir);
    const decisionFile = path.join(tmpDir, '.memory', 'knowledge', 'decisions.md');

    // Pre-v2 seeded ADR — has no `- **Source**: self-learning:` marker
    const preV2Content = buildDecisionsFile([{
      anchorId: 'ADR-001',
      heading: 'use result types everywhere',
      body: '- **Status**: Accepted\n- **Source**: /code-review (seed v1)',
    }]);
    fs.writeFileSync(decisionFile, preV2Content);

    writeManifest(manifestPath, []);

    // Current ready obs whose pattern would normalise-match the pre-v2 heading
    const obs: LogEntry = {
      ...baseEntry('obs_collision_001', 'decision', 'ready'),
      pattern: 'use result types everywhere',
    };
    writeLog(logPath, [obs]);

    const result = JSON.parse(runHelper(`reconcile-manifest "${tmpDir}"`));

    // Heal must NOT trigger — pre-v2 entries lack the source marker
    expect(result.healed).toBe(0);
    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(0);

    // Obs stays in `ready` state — it will be rendered as a NEW ADR (e.g., ADR-002)
    // by the next render-ready pass, not paired to the pre-v2 ADR-001.
    const entries = readLog(logPath);
    expect(entries[0].status).toBe('ready');
  });
});
