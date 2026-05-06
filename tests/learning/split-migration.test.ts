// tests/learning/split-migration.test.ts
// Tests for the split-migration.cjs script that partitions learning-log.jsonl
// by observation type into learning-log.jsonl (workflow/procedural) and
// decisions-log.jsonl (decision/pitfall).
//
// Uses temp directories and spawns `node split-migration.cjs <tmpdir>` directly,
// verifying file contents afterward.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPLIT_MIGRATION = path.resolve(__dirname, '../../scripts/hooks/lib/split-migration.cjs');

/**
 * Run the migration against a tmpDir.
 * Returns stdout (empty string on success since migration has no stdout output).
 * Throws on non-zero exit.
 */
function runMigration(tmpDir: string): void {
  execSync(`node "${SPLIT_MIGRATION}" "${tmpDir}"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Parse JSONL string into array of objects.
 */
function parseJsonl(content: string): object[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

/**
 * Write entries as JSONL to a file.
 */
function writeJsonl(filePath: string, entries: object[]): void {
  if (entries.length === 0) {
    fs.writeFileSync(filePath, '');
  } else {
    fs.writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
}

function makeEntry(id: string, type: string): object {
  const now = new Date().toISOString();
  return {
    id,
    type,
    pattern: `${type} pattern`,
    confidence: 0.9,
    observations: 3,
    first_seen: now,
    last_seen: now,
    status: 'created',
    evidence: ['e1'],
    details: 'details',
    quality_ok: true,
  };
}

function makeManifestEntry(observationId: string, type: string, artifactPath: string): object {
  return {
    observationId,
    type,
    path: artifactPath,
    contentHash: 'abc123',
    renderedAt: new Date().toISOString(),
  };
}

describe('split-migration — mixed-type log partition', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('partitions workflow and procedural entries into learning-log.jsonl, decision and pitfall into decisions-log.jsonl', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const decisionsLogPath = path.join(memoryDir, 'decisions-log.jsonl');

    const entries = [
      makeEntry('obs_w001', 'workflow'),
      makeEntry('obs_p001', 'procedural'),
      makeEntry('obs_d001', 'decision'),
      makeEntry('obs_f001', 'pitfall'),
    ];
    writeJsonl(logPath, entries);

    runMigration(tmpDir);

    // learning-log.jsonl should have only workflow + procedural
    const workflowEntries = parseJsonl(fs.readFileSync(logPath, 'utf8')) as { id: string; type: string }[];
    expect(workflowEntries).toHaveLength(2);
    const workflowIds = workflowEntries.map(e => e.id);
    expect(workflowIds).toContain('obs_w001');
    expect(workflowIds).toContain('obs_p001');
    const workflowTypes = new Set(workflowEntries.map(e => e.type));
    expect(workflowTypes.has('decision')).toBe(false);
    expect(workflowTypes.has('pitfall')).toBe(false);

    // decisions-log.jsonl should have only decision + pitfall
    expect(fs.existsSync(decisionsLogPath)).toBe(true);
    const decisionsEntries = parseJsonl(fs.readFileSync(decisionsLogPath, 'utf8')) as { id: string; type: string }[];
    expect(decisionsEntries).toHaveLength(2);
    const decisionIds = decisionsEntries.map(e => e.id);
    expect(decisionIds).toContain('obs_d001');
    expect(decisionIds).toContain('obs_f001');
    const decisionTypes = new Set(decisionsEntries.map(e => e.type));
    expect(decisionTypes.has('workflow')).toBe(false);
    expect(decisionTypes.has('procedural')).toBe(false);

    // Sentinel should be written
    expect(fs.existsSync(path.join(memoryDir, '.migration-split-done'))).toBe(true);
  });
});

describe('split-migration — manifest splitting', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-manifest-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('splits manifest entries by type — workflow/procedural stay in .learning-manifest.json, decision/pitfall go to .decisions-manifest.json', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const manifestPath = path.join(memoryDir, '.learning-manifest.json');
    const decisionsManifestPath = path.join(memoryDir, '.decisions-manifest.json');

    const logEntries = [
      makeEntry('obs_w001', 'workflow'),
      makeEntry('obs_p001', 'procedural'),
      makeEntry('obs_d001', 'decision'),
      makeEntry('obs_f001', 'pitfall'),
    ];
    writeJsonl(logPath, logEntries);

    const manifest = {
      schemaVersion: 1,
      entries: [
        makeManifestEntry('obs_w001', 'workflow', path.join(tmpDir, 'cmd.md')),
        makeManifestEntry('obs_p001', 'procedural', path.join(tmpDir, 'skill.md')),
        makeManifestEntry('obs_d001', 'decision', path.join(tmpDir, 'decisions.md')),
        makeManifestEntry('obs_f001', 'pitfall', path.join(tmpDir, 'pitfalls.md')),
      ],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    runMigration(tmpDir);

    // .learning-manifest.json: only workflow + procedural
    const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(updatedManifest.entries).toHaveLength(2);
    const workflowIds = updatedManifest.entries.map((e: { observationId: string }) => e.observationId);
    expect(workflowIds).toContain('obs_w001');
    expect(workflowIds).toContain('obs_p001');

    // .decisions-manifest.json: only decision + pitfall
    expect(fs.existsSync(decisionsManifestPath)).toBe(true);
    const decisionsManifest = JSON.parse(fs.readFileSync(decisionsManifestPath, 'utf8'));
    expect(decisionsManifest.entries).toHaveLength(2);
    const decisionsIds = decisionsManifest.entries.map((e: { observationId: string }) => e.observationId);
    expect(decisionsIds).toContain('obs_d001');
    expect(decisionsIds).toContain('obs_f001');
  });
});

describe('split-migration — notification file rename', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-notify-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renames .notifications.json to .decisions-notifications.json', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const notificationsPath = path.join(memoryDir, '.notifications.json');
    const decisionsNotificationsPath = path.join(memoryDir, '.decisions-notifications.json');

    writeJsonl(logPath, [makeEntry('obs_w001', 'workflow')]);
    fs.writeFileSync(notificationsPath, JSON.stringify({ lastNotified: 0 }));

    runMigration(tmpDir);

    expect(fs.existsSync(notificationsPath)).toBe(false);
    expect(fs.existsSync(decisionsNotificationsPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(decisionsNotificationsPath, 'utf8'));
    expect(content.lastNotified).toBe(0);
  });

  it('leaves .decisions-notifications.json untouched if it already exists', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const notificationsPath = path.join(memoryDir, '.notifications.json');
    const decisionsNotificationsPath = path.join(memoryDir, '.decisions-notifications.json');

    writeJsonl(logPath, [makeEntry('obs_w001', 'workflow')]);
    fs.writeFileSync(notificationsPath, JSON.stringify({ old: true }));
    fs.writeFileSync(decisionsNotificationsPath, JSON.stringify({ existing: true }));

    runMigration(tmpDir);

    // .decisions-notifications.json should be the existing one (not overwritten by rename)
    const content = JSON.parse(fs.readFileSync(decisionsNotificationsPath, 'utf8'));
    expect(content.existing).toBe(true);
    // .notifications.json stays (rename was skipped)
    expect(fs.existsSync(notificationsPath)).toBe(true);
  });
});

describe('split-migration — idempotency', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-idem-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('second run is a no-op — sentinel prevents re-processing', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');

    const entries = [
      makeEntry('obs_w001', 'workflow'),
      makeEntry('obs_d001', 'decision'),
    ];
    writeJsonl(logPath, entries);

    runMigration(tmpDir);

    // After first run: workflow stays in log, decision is in decisions-log
    const afterFirstRun = fs.readFileSync(logPath, 'utf8');
    const firstRunEntries = parseJsonl(afterFirstRun) as { id: string }[];
    expect(firstRunEntries).toHaveLength(1);
    expect(firstRunEntries[0].id).toBe('obs_w001');

    // Run again
    runMigration(tmpDir);

    // File should be unchanged from after first run
    const afterSecondRun = fs.readFileSync(logPath, 'utf8');
    expect(afterSecondRun).toBe(afterFirstRun);
  });

  it('sentinel file is created after successful run', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    writeJsonl(logPath, [makeEntry('obs_w001', 'workflow')]);

    expect(fs.existsSync(path.join(memoryDir, '.migration-split-done'))).toBe(false);
    runMigration(tmpDir);
    expect(fs.existsSync(path.join(memoryDir, '.migration-split-done'))).toBe(true);
  });
});

describe('split-migration — all workflow/procedural entries', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-workflow-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('when no decision/pitfall entries, creates empty decisions-log.jsonl', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const decisionsLogPath = path.join(memoryDir, 'decisions-log.jsonl');

    writeJsonl(logPath, [
      makeEntry('obs_w001', 'workflow'),
      makeEntry('obs_p001', 'procedural'),
    ]);

    runMigration(tmpDir);

    // learning-log unchanged (all workflow/procedural)
    const workflowEntries = parseJsonl(fs.readFileSync(logPath, 'utf8'));
    expect(workflowEntries).toHaveLength(2);

    // decisions-log.jsonl must exist (even if empty)
    expect(fs.existsSync(decisionsLogPath)).toBe(true);
    const decisionsContent = fs.readFileSync(decisionsLogPath, 'utf8').trim();
    expect(decisionsContent).toBe('');
  });

  it('empty decisions-log.jsonl is created when no decision/pitfall entries exist', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    writeJsonl(logPath, [makeEntry('obs_p001', 'procedural')]);

    runMigration(tmpDir);

    const decisionsLogPath = path.join(memoryDir, 'decisions-log.jsonl');
    expect(fs.existsSync(decisionsLogPath)).toBe(true);
  });
});

describe('split-migration — missing manifest', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-no-manifest-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completes without error when .learning-manifest.json does not exist', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    writeJsonl(logPath, [
      makeEntry('obs_w001', 'workflow'),
      makeEntry('obs_d001', 'decision'),
    ]);

    // No manifest file
    expect(fs.existsSync(path.join(memoryDir, '.learning-manifest.json'))).toBe(false);

    // Should not throw
    expect(() => runMigration(tmpDir)).not.toThrow();

    // Log partitioned correctly
    const decisionsLogPath = path.join(memoryDir, 'decisions-log.jsonl');
    expect(fs.existsSync(decisionsLogPath)).toBe(true);
    const decisionsEntries = parseJsonl(fs.readFileSync(decisionsLogPath, 'utf8')) as { id: string }[];
    expect(decisionsEntries).toHaveLength(1);
    expect(decisionsEntries[0].id).toBe('obs_d001');
  });
});

describe('split-migration — missing log file', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-migration-no-log-test-'));
    memoryDir = path.join(tmpDir, '.memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is a no-op (writes sentinel) when learning-log.jsonl does not exist', () => {
    const logPath = path.join(memoryDir, 'learning-log.jsonl');
    const decisionsLogPath = path.join(memoryDir, 'decisions-log.jsonl');

    expect(fs.existsSync(logPath)).toBe(false);

    // Should not throw
    expect(() => runMigration(tmpDir)).not.toThrow();

    // Neither file should be created (no log to migrate from)
    expect(fs.existsSync(logPath)).toBe(false);
    expect(fs.existsSync(decisionsLogPath)).toBe(false);

    // Sentinel is written so future runs skip immediately
    expect(fs.existsSync(path.join(memoryDir, '.migration-split-done'))).toBe(true);
  });
});
