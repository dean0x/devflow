// tests/decisions/ledger-ops.test.ts
//
// Tests for Phase 3 ledger ops: assign-anchor, retire-anchor, rotate-observations,
// numbering stability, and locking discipline.
//
// AC-A2: assign-anchor computes max+1 from ledger incl Retired; 3-digit-padded
// AC-A3: retire-anchor flips decisions_status, row otherwise intact, idempotent
// AC-F5: retired entries vanish from .md but stay in ledger
// AC-F7: retired numbers leave gaps, never reused
// AC-F9: observing rows >30d never promoted are archived; anchored rows never archived
// AC-P2: assign-anchor is O(anchored) — single pass (structural check)
// AC-P3: rotate-observations bounded (structural/ratio check)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Helpers: load the modules under test
// ---------------------------------------------------------------------------

const jsonHelper = require(
  path.join(ROOT, 'scripts/hooks/json-helper.cjs')
) as {
  nextAnchorFromLedger: (rows: Record<string, unknown>[], type: 'decision' | 'pitfall') => { anchorId: string; nextN: string };
  countActiveLedgerRows: (rows: Record<string, unknown>[], type: 'decision' | 'pitfall') => number;
  rotateObservations: (logPath: string, archivePath: string, nowMs: number) => number;
  registerUsageEntry: (projectRoot: string, anchorId: string) => void;
  writeJsonlAtomic: (file: string, entries: object[]) => void;
};

const {
  renderDecisionsFile,
  parseLedger,
  isActive,
} = require(path.join(ROOT, 'scripts/hooks/lib/render-decisions.cjs')) as {
  renderDecisionsFile: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => string;
  parseLedger: (ledgerPath: string) => Record<string, unknown>[];
  isActive: (row: Record<string, unknown>) => boolean;
};

const JSON_HELPER_BIN = path.join(ROOT, 'scripts/hooks/json-helper.cjs');

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeObsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_test001',
    type: 'decision',
    pattern: 'Use Result types everywhere',
    confidence: 0.9,
    observations: 1,
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-01-01T00:00:00Z',
    status: 'observing',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  };
}

function makeLedgerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'obs_test001',
    type: 'decision',
    pattern: 'Use Result types everywhere',
    anchor_id: 'ADR-001',
    date: '2026-01-01',
    decisions_status: 'Accepted',
    confidence: 0.9,
    observations: 1,
    first_seen: '2026-01-01T00:00:00Z',
    last_seen: '2026-01-01T00:00:00Z',
    status: 'created',
    evidence: [],
    details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
    quality_ok: true,
    ...overrides,
  };
}

function writeLedger(dir: string, rows: Record<string, unknown>[]): string {
  const ledgerPath = path.join(dir, '.devflow', 'decisions', 'decisions-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return ledgerPath;
}

function writeLog(dir: string, rows: Record<string, unknown>[]): string {
  const logPath = path.join(dir, '.devflow', 'decisions', 'decisions-log.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return logPath;
}

function readLedger(dir: string): Record<string, unknown>[] {
  const ledgerPath = path.join(dir, '.devflow', 'decisions', 'decisions-ledger.jsonl');
  return parseLedger(ledgerPath);
}

function readLog(dir: string): Record<string, unknown>[] {
  const logPath = path.join(dir, '.devflow', 'decisions', 'decisions-log.jsonl');
  return parseLedger(logPath);
}

function runHelper(args: string, cwd: string): { stdout: string; code: number; stderr: string } {
  try {
    const stdout = execSync(`node "${JSON_HELPER_BIN}" ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, code: 0, stderr: '' };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number; stderr?: string };
    return {
      stdout: err.stdout ?? '',
      code: err.status ?? 1,
      stderr: err.stderr ?? '',
    };
  }
}

// ---------------------------------------------------------------------------
// nextAnchorFromLedger — unit tests (the pure function behind assign-anchor)
// ---------------------------------------------------------------------------

describe('nextAnchorFromLedger', () => {
  it('empty ledger => ADR-001 for decisions', () => {
    const { anchorId } = jsonHelper.nextAnchorFromLedger([], 'decision');
    expect(anchorId).toBe('ADR-001');
  });

  it('empty ledger => PF-001 for pitfalls', () => {
    const { anchorId } = jsonHelper.nextAnchorFromLedger([], 'pitfall');
    expect(anchorId).toBe('PF-001');
  });

  it('max+1 over existing active anchors', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001' }),
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted' }),
    ];
    const { anchorId } = jsonHelper.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-004');
  });

  it('max+1 includes Retired rows (Retired max is NOT reused)', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-005', id: 'obs_005', decisions_status: 'Retired' }),
    ];
    const { anchorId } = jsonHelper.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-006');
  });

  it('max+1 includes Deprecated rows', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-007', id: 'obs_007', decisions_status: 'Deprecated' }),
    ];
    const { anchorId } = jsonHelper.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-008');
  });

  it('ADR and PF sequences are independent', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-009', id: 'obs_a', type: 'decision' }),
      { ...makeLedgerRow({ anchor_id: 'PF-002', id: 'obs_b', type: 'pitfall' }), type: 'pitfall' },
    ];
    const { anchorId: adrNext } = jsonHelper.nextAnchorFromLedger(rows, 'decision');
    const { anchorId: pfNext } = jsonHelper.nextAnchorFromLedger(rows, 'pitfall');
    expect(adrNext).toBe('ADR-010');
    expect(pfNext).toBe('PF-003');
  });

  it('next N is zero-padded to 3 digits', () => {
    const { anchorId, nextN } = jsonHelper.nextAnchorFromLedger([], 'decision');
    expect(nextN).toBe('001');
    expect(anchorId).toBe('ADR-001');
  });

  it('zero-padding when N > 99', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeLedgerRow({ anchor_id: `ADR-${String(i + 1).padStart(3, '0')}`, id: `obs_${i}` })
    );
    const { anchorId } = jsonHelper.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-101');
  });
});

// ---------------------------------------------------------------------------
// countActiveLedgerRows — unit tests
// ---------------------------------------------------------------------------

describe('countActiveLedgerRows', () => {
  it('counts Accepted decisions', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ];
    expect(jsonHelper.countActiveLedgerRows(rows, 'decision')).toBe(2);
  });

  it('excludes Retired decisions', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Retired' }),
    ];
    expect(jsonHelper.countActiveLedgerRows(rows, 'decision')).toBe(1);
  });

  it('excludes Deprecated decisions', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Deprecated' }),
    ];
    expect(jsonHelper.countActiveLedgerRows(rows, 'decision')).toBe(0);
  });

  it('excludes unanchored rows', () => {
    const rows = [
      makeObsRow({ type: 'decision' }), // no anchor_id
    ];
    expect(jsonHelper.countActiveLedgerRows(rows, 'decision')).toBe(0);
  });

  it('counts only matching type', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', type: 'decision', decisions_status: 'Accepted' }),
      { ...makeLedgerRow({ anchor_id: 'PF-001', id: 'obs_pf', decisions_status: 'Active' }), type: 'pitfall' },
    ];
    expect(jsonHelper.countActiveLedgerRows(rows, 'decision')).toBe(1);
    expect(jsonHelper.countActiveLedgerRows(rows, 'pitfall')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// assign-anchor CLI op
// ---------------------------------------------------------------------------

describe('assign-anchor CLI op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('empty ledger => assigns ADR-001 and prints it to stdout', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_aa_001', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_aa_001', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  it('empty ledger => assigns PF-001 for pitfall type', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_pf_001', type: 'pitfall', status: 'ready' })]);
    const result = runHelper('assign-anchor pitfall obs_pf_001', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('PF-001');
  });

  it('appends anchored row to ledger', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_aa_002', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_aa_002', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].anchor_id).toBe('ADR-001');
    expect(rows[0].id).toBe('obs_aa_002');
  });

  it('marks source log row as created', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_aa_003', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_aa_003', tmpDir);
    const logRows = readLog(tmpDir);
    const row = logRows.find(r => r.id === 'obs_aa_003');
    expect(row).toBeDefined();
    expect(row!.status).toBe('created');
  });

  it('sets decisions_status to Accepted for decisions', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_aa_004', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_aa_004', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Accepted');
  });

  it('sets decisions_status to Active for pitfalls', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_pf_004', type: 'pitfall', status: 'ready' })]);
    runHelper('assign-anchor pitfall obs_pf_004', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Active');
  });

  it('sets date for decisions', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_aa_005', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_aa_005', tmpDir);
    const rows = readLedger(tmpDir);
    expect(typeof rows[0].date).toBe('string');
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does NOT set date on pitfalls (byte-compat asymmetry)', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_pf_005', type: 'pitfall', status: 'ready' })]);
    runHelper('assign-anchor pitfall obs_pf_005', tmpDir);
    const rows = readLedger(tmpDir);
    // pitfall rows should not have a date field set by assign-anchor
    expect(rows[0].date).toBeUndefined();
  });

  it('with existing anchors including Retired — assigns max+1, number not reused', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-005', id: 'obs_retired', decisions_status: 'Retired' }),
    ]);
    writeLog(tmpDir, [makeObsRow({ id: 'obs_new_006', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_new_006', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-006');
  });

  it('ADR and PF sequences are independent', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-010', id: 'obs_a', type: 'decision', decisions_status: 'Accepted' }),
    ]);
    writeLog(tmpDir, [makeObsRow({ id: 'obs_pf_ind', type: 'pitfall', status: 'ready' })]);
    const result = runHelper('assign-anchor pitfall obs_pf_ind', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('PF-001'); // PF sequence starts at 1 regardless of ADR-010
  });

  it('registers usage entry', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_usage_01', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_usage_01', tmpDir);
    const usagePath = path.join(tmpDir, '.devflow', 'decisions', '.decisions-usage.json');
    expect(fs.existsSync(usagePath)).toBe(true);
    const usage = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    expect(usage.entries['ADR-001']).toBeDefined();
    expect(usage.entries['ADR-001'].cites).toBe(0);
  });

  it('re-renders decisions.md with the new entry', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_render_01', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_render_01', tmpDir);
    const decisionsPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions.md');
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toContain('## ADR-001:');
  });

  it('exits non-zero when obs_id not found in log', () => {
    writeLog(tmpDir, []);
    const result = runHelper('assign-anchor decision nonexistent_id', tmpDir);
    expect(result.code).not.toBe(0);
  });

  it('exits non-zero when type is invalid', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_bad', status: 'ready' })]);
    const result = runHelper('assign-anchor workflow obs_bad', tmpDir);
    expect(result.code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// retire-anchor CLI op
// ---------------------------------------------------------------------------

describe('retire-anchor CLI op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flips decisions_status to Retired', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runHelper('retire-anchor ADR-001 Retired', tmpDir);
    expect(result.code).toBe(0);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Retired');
  });

  it('flips decisions_status to Deprecated', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' })]);
    runHelper('retire-anchor ADR-002 Deprecated', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Deprecated');
  });

  it('flips decisions_status to Superseded', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted' })]);
    runHelper('retire-anchor ADR-003 Superseded', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Superseded');
  });

  it('row is otherwise byte-intact (other fields unchanged)', () => {
    const original = makeLedgerRow({
      anchor_id: 'ADR-007',
      id: 'obs_007',
      pattern: 'My pattern',
      details: 'context: test; decision: do X; rationale: Y',
      date: '2026-03-01',
      raw_body: '\n## ADR-007: My pattern\n\n- **Status**: Accepted\n',
      amendments: [{ date: '2026-04-01', note: 'Amendment' }],
    });
    writeLedger(tmpDir, [original]);
    runHelper('retire-anchor ADR-007 Retired', tmpDir);
    const rows = readLedger(tmpDir);
    const r = rows[0];
    expect(r.id).toBe('obs_007');
    expect(r.pattern).toBe('My pattern');
    expect(r.date).toBe('2026-03-01');
    expect(r.raw_body).toBe('\n## ADR-007: My pattern\n\n- **Status**: Accepted\n');
    expect(r.amendments).toEqual([{ date: '2026-04-01', note: 'Amendment' }]);
    expect(r.decisions_status).toBe('Retired');
  });

  it('is idempotent — running twice with same status yields same result', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-004', id: 'obs_004', decisions_status: 'Accepted' })]);
    runHelper('retire-anchor ADR-004 Deprecated', tmpDir);
    runHelper('retire-anchor ADR-004 Deprecated', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].decisions_status).toBe('Deprecated');
  });

  it('retired entry vanishes from rendered decisions.md (AC-F5)', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', pattern: 'To be retired', decisions_status: 'Accepted' }),
    ]);
    runHelper('retire-anchor ADR-002 Retired', tmpDir);
    const decisionsPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions.md');
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toContain('ADR-001');
    expect(content).not.toContain('ADR-002');
  });

  it('retired entry stays in the ledger (AC-F5 — ledger is permanent)', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);
    runHelper('retire-anchor ADR-002 Retired', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(2);
    const retiredRow = rows.find(r => r.anchor_id === 'ADR-002');
    expect(retiredRow).toBeDefined();
    expect(retiredRow!.decisions_status).toBe('Retired');
  });

  it('exits non-zero when anchor_id not found in ledger', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runHelper('retire-anchor ADR-999 Retired', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-999');
  });

  it('exits non-zero for invalid retire status', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runHelper('retire-anchor ADR-001 Invalid', tmpDir);
    expect(result.code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Number stability: retire current-max, then assign-anchor => skip (AC-F7)
// ---------------------------------------------------------------------------

describe('AC-F7: number stability — retired number is never reused', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'num-stability-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retire ADR-005 (current max), then assign-anchor gives ADR-006, not ADR-005', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-005', id: 'obs_005', decisions_status: 'Accepted' }),
    ]);
    // Retire the current max
    runHelper('retire-anchor ADR-005 Retired', tmpDir);

    // Now assign-anchor should give ADR-006, not ADR-005
    writeLog(tmpDir, [makeObsRow({ id: 'obs_new', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_new', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-006');
  });

  it('multiple retirements still produce gap-safe numbering', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted' }),
    ]);
    runHelper('retire-anchor ADR-002 Deprecated', tmpDir);
    runHelper('retire-anchor ADR-003 Superseded', tmpDir);

    writeLog(tmpDir, [makeObsRow({ id: 'obs_gap', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_gap', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-004');
  });
});

// ---------------------------------------------------------------------------
// rotateObservations — unit tests
// ---------------------------------------------------------------------------

describe('rotateObservations — internal function', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-obs-test-'));
    fs.mkdirSync(path.join(tmpDir, 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
  const NOW = new Date('2026-06-10T12:00:00Z').getTime();

  function makeObsLog(dir: string, rows: Record<string, unknown>[]): string {
    const logPath = path.join(dir, 'decisions', 'decisions-log.jsonl');
    jsonHelper.writeJsonlAtomic(logPath, rows);
    return logPath;
  }

  function makeObsArchive(dir: string): string {
    return path.join(dir, 'decisions', 'decisions-log.archive.jsonl');
  }

  it('moves observing rows older than 30 days to archive', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_stale', status: 'observing', last_seen: staleDate }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(1);

    const archive = parseLedger(archivePath);
    expect(archive).toHaveLength(1);
    expect(archive[0].id).toBe('obs_stale');

    const remaining = parseLedger(logPath);
    expect(remaining).toHaveLength(0);
  });

  it('keeps observing rows younger than 30 days', () => {
    const recentDate = new Date(NOW - (15 * 24 * 60 * 60 * 1000)).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_recent', status: 'observing', last_seen: recentDate }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(0);

    const remaining = parseLedger(logPath);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('obs_recent');
  });

  it('never archives anchored rows regardless of age (AC-F9)', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_anchored', status: 'observing', last_seen: staleDate, anchor_id: 'ADR-001' }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(0);

    const remaining = parseLedger(logPath);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('obs_anchored');
  });

  it('never archives created rows regardless of age', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_created', status: 'created', last_seen: staleDate }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(0);

    const remaining = parseLedger(logPath);
    expect(remaining).toHaveLength(1);
  });

  it('never archives ready rows regardless of age', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_ready', status: 'ready', last_seen: staleDate }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(0);

    const remaining = parseLedger(logPath);
    expect(remaining).toHaveLength(1);
  });

  it('no-op when nothing qualifies (idempotent)', () => {
    const recentDate = new Date(NOW - (5 * 24 * 60 * 60 * 1000)).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_r1', status: 'observing', last_seen: recentDate }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated1 = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    const rotated2 = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated1).toBe(0);
    expect(rotated2).toBe(0);
  });

  it('no-op when log file does not exist', () => {
    const logPath = path.join(tmpDir, 'decisions', 'nonexistent.jsonl');
    const archivePath = makeObsArchive(tmpDir);
    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(0);
  });

  it('appends to existing archive (does not overwrite)', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_stale2', status: 'observing', last_seen: staleDate }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    // Pre-populate archive with existing row
    jsonHelper.writeJsonlAtomic(archivePath, [makeObsRow({ id: 'obs_pre_existing' })]);

    jsonHelper.rotateObservations(logPath, archivePath, NOW);

    const archive = parseLedger(archivePath);
    expect(archive).toHaveLength(2);
    expect(archive.map((r: Record<string, unknown>) => r.id)).toContain('obs_pre_existing');
    expect(archive.map((r: Record<string, unknown>) => r.id)).toContain('obs_stale2');
  });

  it('uses last_seen when present, falls back to first_seen', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const recentDate = new Date(NOW - (5 * 24 * 60 * 60 * 1000)).toISOString();

    const logPath = makeObsLog(tmpDir, [
      // last_seen recent, first_seen stale — should NOT be rotated
      makeObsRow({ id: 'obs_recent_last', status: 'observing', first_seen: staleDate, last_seen: recentDate }),
      // No last_seen, first_seen stale — SHOULD be rotated
      makeObsRow({ id: 'obs_stale_first', status: 'observing', first_seen: staleDate, last_seen: undefined }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(1);

    const remaining = parseLedger(logPath);
    expect(remaining.map(r => r.id)).toContain('obs_recent_last');
    expect(remaining.map(r => r.id)).not.toContain('obs_stale_first');
  });

  it('mixed batch: some stale, some not, some anchored — correct split', () => {
    const staleDate = new Date(NOW - THIRTY_ONE_DAYS_MS).toISOString();
    const recentDate = new Date(NOW - (5 * 24 * 60 * 60 * 1000)).toISOString();

    const logPath = makeObsLog(tmpDir, [
      makeObsRow({ id: 'obs_stale_a', status: 'observing', last_seen: staleDate }),
      makeObsRow({ id: 'obs_recent_b', status: 'observing', last_seen: recentDate }),
      makeObsRow({ id: 'obs_created_c', status: 'created', last_seen: staleDate }),
      makeObsRow({ id: 'obs_anchored_d', status: 'observing', last_seen: staleDate, anchor_id: 'ADR-001' }),
    ]);
    const archivePath = makeObsArchive(tmpDir);

    const rotated = jsonHelper.rotateObservations(logPath, archivePath, NOW);
    expect(rotated).toBe(1);

    const archive = parseLedger(archivePath);
    expect(archive.map(r => r.id)).toContain('obs_stale_a');
    expect(archive.map(r => r.id)).not.toContain('obs_recent_b');
    expect(archive.map(r => r.id)).not.toContain('obs_created_c');
    expect(archive.map(r => r.id)).not.toContain('obs_anchored_d');

    const remaining = parseLedger(logPath);
    expect(remaining).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// rotate-observations CLI op
// ---------------------------------------------------------------------------

describe('rotate-observations CLI op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-cli-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'dream'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 and prints "rotated N observing rows" summary', () => {
    // Empty log — 0 rows to rotate
    const result = runHelper('rotate-observations', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/rotated \d+ observing rows/);
  });

  it('accepts explicit log and archive paths', () => {
    const logPath = path.join(tmpDir, '.devflow', 'decisions', 'decisions-log.jsonl');
    const archivePath = path.join(tmpDir, '.devflow', 'decisions', 'decisions-log.archive.jsonl');
    fs.writeFileSync(logPath, '');
    const result = runHelper(`rotate-observations "${logPath}" "${archivePath}"`, tmpDir);
    expect(result.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-P2: assign-anchor O(anchored) — structural check (no N^2 scan)
// Per ADR-014: ratio/bounded-delta methodology, not absolute ms.
// ---------------------------------------------------------------------------

describe('AC-P2: assign-anchor O(anchored) performance (ratio methodology, per ADR-014)', () => {
  it('nextAnchorFromLedger is O(N) — 10x rows yields <15x time', () => {
    const SMALL = 50;
    const LARGE = 500;
    const WARMUP = 3;
    const RUNS = 5;

    function buildRows(n: number): Record<string, unknown>[] {
      return Array.from({ length: n }, (_, i) =>
        makeLedgerRow({ anchor_id: `ADR-${String(i + 1).padStart(3, '0')}`, id: `obs_p${i}` })
      );
    }

    // Warmup
    for (let i = 0; i < WARMUP; i++) {
      jsonHelper.nextAnchorFromLedger(buildRows(SMALL), 'decision');
      jsonHelper.nextAnchorFromLedger(buildRows(LARGE), 'decision');
    }

    const smallTimes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const rows = buildRows(SMALL);
      const start = performance.now();
      jsonHelper.nextAnchorFromLedger(rows, 'decision');
      smallTimes.push(performance.now() - start);
    }

    const largeTimes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const rows = buildRows(LARGE);
      const start = performance.now();
      jsonHelper.nextAnchorFromLedger(rows, 'decision');
      largeTimes.push(performance.now() - start);
    }

    const medianSmall = smallTimes.sort((a, b) => a - b)[Math.floor(RUNS / 2)];
    const medianLarge = largeTimes.sort((a, b) => a - b)[Math.floor(RUNS / 2)];

    if (medianSmall < 0.01) {
      // Sub-millisecond — too fast to measure reliably; skip ratio assertion
      return;
    }

    const ratio = medianLarge / medianSmall;
    expect(ratio).toBeLessThan(15); // 10x rows should be <15x time (linear or better)
  });
});

// ---------------------------------------------------------------------------
// Locking discipline: assign-anchor and render happen under one lock (no deadlock)
// ---------------------------------------------------------------------------

describe('locking discipline: assign-anchor and render under single .decisions.lock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'decisions'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('assign-anchor completes without deadlock and leaves no lock dir behind', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_lock_01', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_lock_01', tmpDir);
    expect(result.code).toBe(0);

    // Lock dir should be released
    const lockDir = path.join(tmpDir, '.devflow', 'decisions', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('retire-anchor completes without deadlock and leaves no lock dir behind', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runHelper('retire-anchor ADR-001 Retired', tmpDir);
    expect(result.code).toBe(0);

    const lockDir = path.join(tmpDir, '.devflow', 'decisions', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
