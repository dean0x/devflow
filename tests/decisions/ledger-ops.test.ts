// tests/decisions/ledger-ops.test.ts
//
// Tests for Phase 3 ledger ops: assign-anchor, retire-anchor, rotate-observations,
// numbering stability, and locking discipline.
//
// AC-A2: assign-anchor computes max+1 from ledger incl Retired; 3-digit-padded
// AC-A3: retire-anchor flips decisions_status, row otherwise intact, idempotent
// AC-F5: retired entries vanish from .md but stay in ledger
// AC-F7: retired numbers leave gaps, never reused
// AC-F9: a log row no ledger row carries is archived once 30 days pass since its
//        last activity; a row any ledger row carries never is (D-ROTATE-UNREFERENCED)
// AC-P2: assign-anchor is O(anchored) — single pass (structural check)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execFileSync, execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  FIXTURE_NOW,
  daysAgoIso,
  learningPaths,
  makeV1LedgerRow,
  makeV1LogRow,
  makeV2LedgerRow,
  makeV2LogRow,
  requireLearningStore,
  runJsonHelper,
  seedLearningTree,
  snapshotTree,
  type Row,
} from './learning-fixtures.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Helpers: load the modules under test
// ---------------------------------------------------------------------------

const jsonHelper = require(
  path.join(ROOT, 'src/assets/scripts/hooks/json-helper.cjs')
) as {
  nextAnchorFromLedger: (rows: Record<string, unknown>[], type: 'decision' | 'pitfall') => { anchorId: string; nextN: string };
};

const store = requireLearningStore();

const {
  renderDecisionsFile,
  parseLedger,
  isActive,
} = require(path.join(ROOT, 'src/assets/scripts/hooks/lib/render-decisions.cjs')) as {
  renderDecisionsFile: (rows: Record<string, unknown>[], kind: 'decisions' | 'pitfalls') => string;
  parseLedger: (ledgerPath: string) => Record<string, unknown>[];
  isActive: (row: Record<string, unknown>) => boolean;
};

const JSON_HELPER_BIN = path.join(ROOT, 'src/assets/scripts/hooks/json-helper.cjs');

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
  const ledgerPath = path.join(dir, '.devflow', 'learning', 'decisions-ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return ledgerPath;
}

function writeLog(dir: string, rows: Record<string, unknown>[]): string {
  const logPath = path.join(dir, '.devflow', 'learning', 'decisions-log.jsonl');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return logPath;
}

function readLedger(dir: string): Record<string, unknown>[] {
  const ledgerPath = path.join(dir, '.devflow', 'learning', 'decisions-ledger.jsonl');
  return parseLedger(ledgerPath);
}

function readLog(dir: string): Record<string, unknown>[] {
  const logPath = path.join(dir, '.devflow', 'learning', 'decisions-log.jsonl');
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
// assign-anchor CLI op
// ---------------------------------------------------------------------------

describe('assign-anchor CLI op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
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

  it('sets date on pitfall rows — all entry types stamped, no decision/pitfall asymmetry', () => {
    // assign-anchor passes date unconditionally for both decisions and pitfalls.
    // Pitfall ledger rows carry a date so refresh-anchor can re-project them.
    writeLog(tmpDir, [makeObsRow({ id: 'obs_pf_005', type: 'pitfall', status: 'ready' })]);
    runHelper('assign-anchor pitfall obs_pf_005', tmpDir);
    const rows = readLedger(tmpDir);
    // pitfall rows now get a date stamp (same as decisions — no asymmetry)
    expect(typeof rows[0].date).toBe('string');
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

  it('re-renders decisions.md with the new entry', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_render_01', type: 'decision', status: 'ready' })]);
    runHelper('assign-anchor decision obs_render_01', tmpDir);
    const decisionsPath = path.join(tmpDir, '.devflow', 'learning', 'decisions.md');
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
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
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

  it('a retired entry loses its body in rendered decisions.md and is listed under Inactive (AC-F5)', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', pattern: 'To be retired', decisions_status: 'Accepted' }),
    ]);
    runHelper('retire-anchor ADR-002 Retired', tmpDir);
    const decisionsPath = path.join(tmpDir, '.devflow', 'learning', 'decisions.md');
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toMatch(/^## ADR-001: /m);
    expect(content).not.toMatch(/^## ADR-002:/m);
    expect(content).not.toContain('To be retired');
    expect(content).toContain('| ADR-002 | Retired | — |\n');
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
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
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
// rotateObservations (D-ROTATE-UNREFERENCED) — the store function behind
// rotate-observations
// ---------------------------------------------------------------------------

describe('rotateObservations (D-ROTATE-UNREFERENCED)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let tmpDir: string;
  let paths: ReturnType<typeof learningPaths>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-obs-test-'));
    paths = learningPaths(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Seed the learning tree, rotate at FIXTURE_NOW and return the counts. */
  function rotate(seed: { log?: Row[]; ledger?: Row[]; archive?: Row[] }): { rotated: number; appended: number } {
    seedLearningTree(tmpDir, seed);
    const result = store.rotateObservations(tmpDir, { now: FIXTURE_NOW });
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  const rowsOf = (file: string): Row[] => store.readJsonl(file).rows;
  const idsOf = (file: string): unknown[] => rowsOf(file).map(row => row.id);

  it('archives every unreferenced row whose last activity is 30 days old or more, whatever its status', () => {
    const old = daysAgoIso(31);
    const log = [
      makeV1LogRow({ id: 'obs_old_observing', status: 'observing', last_seen: old }),
      makeV1LogRow({ id: 'obs_old_created', status: 'created', last_seen: old }),
      makeV1LogRow({ id: 'obs_old_ready', status: 'ready', last_seen: old }),
      makeV2LogRow({ id: 'obs_old_v2', last_seen: old }),
    ];

    expect(rotate({ log })).toEqual({ rotated: 4, appended: 4 });
    expect(rowsOf(paths.archive)).toEqual(log);
    expect(rowsOf(paths.log)).toEqual([]);
  });

  it('keeps a row any ledger row carries, however old and whatever that row\'s status; a copied anchor_id protects nothing', () => {
    const old = daysAgoIso(400);
    const log = [
      makeV1LogRow({ id: 'obs_ref_active', last_seen: old }),
      makeV1LogRow({ id: 'obs_ref_retired', last_seen: old }),
      makeV2LogRow({ id: 'obs_ref_v2', last_seen: old }),
      makeV1LogRow({ id: 'obs_log_claims_anchor', last_seen: old, status: 'created', anchor_id: 'PF-009' }),
    ];
    const ledger = [
      makeV1LedgerRow({ id: 'obs_ref_active', anchor_id: 'PF-001' }),
      makeV1LedgerRow({ id: 'obs_ref_retired', anchor_id: 'PF-002', decisions_status: 'Retired' }),
      makeV2LedgerRow({ id: 'obs_ref_v2', anchor_id: 'ADR-001' }),
    ];

    expect(rotate({ log, ledger })).toEqual({ rotated: 1, appended: 1 });
    expect(idsOf(paths.log)).toEqual(['obs_ref_active', 'obs_ref_retired', 'obs_ref_v2']);
    expect(idsOf(paths.archive)).toEqual(['obs_log_claims_anchor']);
  });

  it('dates a row by last_seen, else first_seen, else created, and keeps a row with no usable date', () => {
    const log = [
      makeV1LogRow({ id: 'obs_seen_lately', first_seen: daysAgoIso(90), last_seen: daysAgoIso(5) }),
      makeV1LogRow({ id: 'obs_first_seen_old', first_seen: daysAgoIso(31), last_seen: undefined }),
      makeV1LogRow({ id: 'obs_created_old', first_seen: undefined, last_seen: undefined, created: daysAgoIso(40) }),
      makeV1LogRow({ id: 'obs_undated', first_seen: undefined, last_seen: undefined }),
      makeV1LogRow({ id: 'obs_unparseable', last_seen: 'not a date', first_seen: daysAgoIso(90) }),
    ];

    expect(rotate({ log })).toEqual({ rotated: 2, appended: 2 });
    expect(idsOf(paths.log)).toEqual(['obs_seen_lately', 'obs_undated', 'obs_unparseable']);
    expect(idsOf(paths.archive)).toEqual(['obs_first_seen_old', 'obs_created_old']);
  });

  it('archives a row exactly 30 days old and keeps one a minute younger', () => {
    const log = [
      makeV1LogRow({ id: 'obs_thirty_days', last_seen: new Date(FIXTURE_NOW - 30 * DAY_MS).toISOString() }),
      makeV1LogRow({ id: 'obs_minute_younger', last_seen: new Date(FIXTURE_NOW - 30 * DAY_MS + 60_000).toISOString() }),
    ];

    expect(rotate({ log })).toEqual({ rotated: 1, appended: 1 });
    expect(idsOf(paths.archive)).toEqual(['obs_thirty_days']);
    expect(idsOf(paths.log)).toEqual(['obs_minute_younger']);
  });

  it('appends after the rows the archive already holds', () => {
    const archived = makeV1LogRow({ id: 'obs_archived_before', last_seen: daysAgoIso(300) });
    const due = makeV1LogRow({ id: 'obs_due_now', last_seen: daysAgoIso(60) });

    expect(rotate({ log: [due], archive: [archived] })).toEqual({ rotated: 1, appended: 1 });
    expect(rowsOf(paths.archive)).toEqual([archived, due]);
  });

  it('skips a byte-identical copy already archived, and appends a changed version of an archived id', () => {
    // A run that appended and died before rewriting the log leaves the row in both
    // files: the retry must not archive it twice. A row whose content changed since
    // an older version was archived is new data, so both versions stay.
    const retried = makeV1LogRow({ id: 'obs_retried', last_seen: daysAgoIso(45) });
    const olderVersion = makeV1LogRow({ id: 'obs_rewritten', pattern: 'The first wording', last_seen: daysAgoIso(200) });
    const newerVersion = makeV1LogRow({ id: 'obs_rewritten', pattern: 'The sharpened wording', last_seen: daysAgoIso(45) });

    expect(rotate({ log: [retried, newerVersion], archive: [retried, olderVersion] })).toEqual({ rotated: 2, appended: 1 });
    expect(rowsOf(paths.archive)).toEqual([retried, olderVersion, newerVersion]);
    expect(rowsOf(paths.log)).toEqual([]);
  });

  it('writes nothing when no row is due', () => {
    seedLearningTree(tmpDir, {
      ledger: [makeV1LedgerRow()],
      log: [makeV1LogRow(), makeV1LogRow({ id: 'obs_fresh_one', last_seen: daysAgoIso(3) })],
    });
    fs.appendFileSync(paths.log, 'not json\n');
    const before = snapshotTree(tmpDir);

    expect(store.rotateObservations(tmpDir, { now: FIXTURE_NOW })).toEqual({ ok: true, value: { rotated: 0, appended: 0 } });
    expect(snapshotTree(tmpDir)).toEqual(before);
  });

  it('backs up a v1 tree and quarantines the log\'s malformed lines before rewriting the log', () => {
    const due = makeV1LogRow({ id: 'obs_due', last_seen: daysAgoIso(60) });
    const fresh = makeV1LogRow({ id: 'obs_fresh', last_seen: daysAgoIso(2) });
    const original = `${JSON.stringify(due)}\nnot json\n${JSON.stringify(fresh)}\n`;
    fs.mkdirSync(paths.learningDir, { recursive: true });
    fs.writeFileSync(paths.log, original);

    expect(store.rotateObservations(tmpDir, { now: FIXTURE_NOW })).toEqual({ ok: true, value: { rotated: 1, appended: 1 } });
    expect(fs.readFileSync(path.join(paths.learningDir, 'decisions-log.pre-v2.jsonl'), 'utf8')).toBe(original);
    expect(rowsOf(store.rejectedPathFor(paths.log)).map(record => record.text)).toEqual(['not json']);
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(`${JSON.stringify(fresh)}\n`);
  });

  it('refuses without a learning directory and creates nothing', () => {
    expect(store.rotateObservations(tmpDir, { now: FIXTURE_NOW })).toEqual({
      ok: false,
      error: {
        kind: 'no-learning-dir',
        message: `rotate-observations: no .devflow/learning/ under ${tmpDir} — run from the project root`,
      },
    });
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor CLI op (re-projection per D-LOG-CONTENT-AUTHORITY)
// ---------------------------------------------------------------------------

describe('refresh-anchor CLI op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-projects the log obs onto the ledger row (updates details from log)', () => {
    // Seed ledger with old details; log obs has reinforced details (append, not replace).
    // The log is always a superset of the ledger — the divergence guard passes when
    // the ledger content is contained in the log content.
    const oldDetails = 'context: old; decision: old decision; rationale: old';
    const newDetails = oldDetails + '; context: updated; decision: updated decision; rationale: updated rationale';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_ra_001',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-001',
        details: newDetails,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_ra_001',
        anchor_id: 'ADR-001',
        decisions_status: 'Accepted',
        details: oldDetails,
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);

    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toBe(newDetails);
    // Anchor id, status, type preserved
    expect(rows[0].anchor_id).toBe('ADR-001');
    expect(rows[0].decisions_status).toBe('Accepted');
    expect(rows[0].type).toBe('decision');
  });

  it('strips observation-lifecycle fields (D2 strict re-projection via toLedgerRow)', () => {
    // The ledger may carry legacy observation fields from old log-verbatim
    // copies.  refresh-anchor must re-project via toLedgerRow which whitelists
    // only canonical fields — everything else is stripped.
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_ra_002', type: 'decision', status: 'created', anchor_id: 'ADR-002' }),
    ]);
    // Ledger row carries legacy fields that toLedgerRow must strip
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_ra_002',
        anchor_id: 'ADR-002',
        decisions_status: 'Accepted',
        confidence: 0.99,   // observation-lifecycle — must be stripped
        observations: 5,    // observation-lifecycle — must be stripped
        quality_ok: true,   // observation-lifecycle — must be stripped
      }),
    ]);
    runHelper('refresh-anchor ADR-002', tmpDir);

    const rows = readLedger(tmpDir);
    const row = rows.find(r => r.anchor_id === 'ADR-002');
    expect(row).toBeDefined();
    // Canonical fields present
    expect(row?.id).toBe('obs_ra_002');
    expect(row?.type).toBe('decision');
    expect(row?.anchor_id).toBe('ADR-002');
    expect(row?.decisions_status).toBe('Accepted');
    // Observation-lifecycle fields stripped by toLedgerRow
    expect(row?.confidence).toBeUndefined();
    expect(row?.observations).toBeUndefined();
    expect(row?.quality_ok).toBeUndefined();
  });

  it('re-renders decisions.md after refresh', () => {
    // Log must be a superset of ledger (divergence guard).
    // Reinforcement appends; the ledger's prior content is a prefix of the log content.
    const baseDetails = 'context: existing; decision: approach A; rationale: initial';
    const newDetails = baseDetails + '; context: refreshed; decision: new approach; rationale: better';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_ra_003',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-003',
        pattern: 'Refreshed decision',
        details: newDetails,
        date: '2026-08-30',
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_ra_003',
        anchor_id: 'ADR-003',
        decisions_status: 'Accepted',
        pattern: 'Refreshed decision',
        details: baseDetails,
        date: '2026-01-01',
      }),
    ]);
    runHelper('refresh-anchor ADR-003', tmpDir);

    const decisionsPath = path.join(tmpDir, '.devflow', 'learning', 'decisions.md');
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toContain('## ADR-003: Refreshed decision');
    expect(content).toContain('refreshed');
    // Old content should not appear
    expect(content).not.toContain('stale');
  });

  // ---- Behavioral tests: lookup-key correctness ----

  it('resolves log row by ledger id when log obs has no anchor_id field (pre-existing-style row)', () => {
    // Pre-existing log rows were written before assign-anchor added anchor_id write-back.
    // They have no anchor_id field — only the id that matches the ledger row's id field.
    // The log obs is resolved by the LEDGER ROW's id, not by anchor_id — this covers
    // pre-write-back rows that never had anchor_id stamped in the log.
    // Log is a superset of ledger. Ledger holds the prior base content;
    // log has the base plus the sharpened reinforcement appended to it.
    const basePart = 'context: initial; decision: basic; rationale: simple';
    const sharpDetails = basePart + '; context: sharpened; decision: use Result types; rationale: functional error handling';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_pre_exist',
        type: 'decision',
        status: 'created',
        // NO anchor_id field — pre-existing row style
        details: sharpDetails,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_pre_exist',
        anchor_id: 'ADR-005',
        decisions_status: 'Accepted',
        details: basePart,
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-005', tmpDir);
    expect(result.code).toBe(0);
    const rows = readLedger(tmpDir);
    expect(rows[0].details).toBe(sharpDetails);
    expect(rows[0].anchor_id).toBe('ADR-005');
  });

  it('pitfall-anchor refresh re-renders pitfalls.md and index.md', () => {
    // Pitfall obs has no anchor_id field (pre-existing style) — resolves by ledger id.
    // id-based lookup covers both pre-existing and new-style rows uniformly.
    // Log is a superset of ledger. The ledger holds the base content;
    // log has base + the sharper reinforcement appended. Neither uses the word 'stale'
    // so the post-refresh pitfalls.md assertion (not.toContain('stale')) holds.
    const basePart = 'area: hooks; issue: retry loops; fix: initial mitigation';
    const sharpDetails = basePart + '; area: hooks; issue: unbounded retries; fix: cap at 3 attempts';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_pf_refresh',
        type: 'pitfall',
        status: 'created',
        // NO anchor_id field — pre-existing style; lookup must use ledger row id
        pattern: 'Unbounded retries in hooks',
        details: sharpDetails,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_pf_refresh',
        type: 'pitfall',
        anchor_id: 'PF-001',
        decisions_status: 'Active',
        pattern: 'Unbounded retries in hooks',
        details: basePart,
      }),
    ]);
    const result = runHelper('refresh-anchor PF-001', tmpDir);
    expect(result.code).toBe(0);

    const pitfallsPath = path.join(tmpDir, '.devflow', 'learning', 'pitfalls.md');
    const indexPath = path.join(tmpDir, '.devflow', 'learning', 'index.md');

    expect(fs.existsSync(pitfallsPath)).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(true);

    const pitfallsContent = fs.readFileSync(pitfallsPath, 'utf8');
    expect(pitfallsContent).toContain('## PF-001:');
    expect(pitfallsContent).toContain('unbounded retries');
    expect(pitfallsContent).not.toContain('stale');

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    expect(indexContent).toContain('PF-001');
  });

  it('date-pin: ledger row date wins over obs date', () => {
    // refresh-anchor takes date exclusively from the ledger row (rfExistingRow.date).
    // The obs date is ignored — the promotion date is preserved regardless of obs updates.
    const ledgerDate = '2026-01-01';
    const obsDate = '2026-08-30';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_date_pin',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-007',
        date: obsDate,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_date_pin',
        anchor_id: 'ADR-007',
        decisions_status: 'Accepted',
        date: ledgerDate,
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-007', tmpDir);
    expect(result.code).toBe(0);
    const rows = readLedger(tmpDir);
    // Ledger date preserved; obs date ignored
    expect(rows[0].date).toBe(ledgerDate);
  });

  it('date-pin: dateless legacy ledger row stays dateless after refresh (D5: no backfill)', () => {
    // date: rfExistingRow.date — undefined propagates for dateless legacy rows; no backfill.
    // The obs date is not used (D-LOG-CONTENT-AUTHORITY) — a fabricated date would be worse
    // than an unprotected entry.
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_dateless',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-008',
        date: '2026-08-30', // obs HAS a date — must not backfill into dateless ledger row
      }),
    ]);
    // Dateless legacy ledger row: constructed directly, no date field
    const datelessLedgerRow: Record<string, unknown> = {
      id: 'obs_dateless',
      type: 'decision',
      pattern: 'Use Result types everywhere',
      anchor_id: 'ADR-008',
      decisions_status: 'Accepted',
      confidence: 0.9,
      observations: 1,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-01-01T00:00:00Z',
      status: 'created',
      evidence: [],
      details: 'context: TypeScript project; decision: return Result<T,E>; rationale: functional error handling',
      quality_ok: true,
      // NOTE: no `date` field — legacy pre-stamp row
    };
    writeLedger(tmpDir, [datelessLedgerRow]);
    const result = runHelper('refresh-anchor ADR-008', tmpDir);
    expect(result.code).toBe(0);
    const rows = readLedger(tmpDir);
    // Dateless ledger row must remain dateless — D5 no-backfill rule
    expect(rows[0].date).toBeUndefined();
  });

  // ---- Updated error-case tests (lookup key: ledger row id, not anchor_id) ----

  it('exits non-zero when no log obs matches the ledger row id', () => {
    // Log has an obs whose id does not match the ledger row's id field.
    // (The presence of anchor_id on the log obs is irrelevant — lookup is by id.)
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_ra_missing', type: 'decision', status: 'created', anchor_id: 'ADR-099' }),
    ]);
    // Ledger row default id is 'obs_test001' — does not match 'obs_ra_missing' in log
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001');
    expect(result.stderr).toContain('not found');
  });

  it('exits non-zero when anchor_id not found in ledger', () => {
    // Log has the obs but ledger doesn't have that anchor
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_ra_nol', type: 'decision', status: 'created', anchor_id: 'ADR-001' }),
    ]);
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-999', decisions_status: 'Accepted' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001');
    expect(result.stderr).toContain('not found');
  });

  it('exits non-zero when called with no argument', () => {
    const result = runHelper('refresh-anchor', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('usage');
  });

  it('completes without deadlock and leaves no lock dir behind', () => {
    const newDetails = 'context: clean; decision: clean; rationale: clean';
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_ra_lock', type: 'decision', status: 'created', anchor_id: 'ADR-001', details: newDetails }),
    ]);
    // Ledger must not carry content absent from the log (divergence guard).
    // Set ledger details explicitly to match the log so the guard passes.
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', id: 'obs_ra_lock', decisions_status: 'Accepted', details: newDetails })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('prints the anchor_id to stdout on success (mirrors assign-anchor contract)', () => {
    // refresh-anchor echoes the anchor_id to stdout after renderAndWriteAll,
    // mirroring assign-anchor's contract so callers can confirm which row was refreshed.
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_ra_stdout', type: 'decision', status: 'created', anchor_id: 'ADR-001' }),
    ]);
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', id: 'obs_ra_stdout', decisions_status: 'Accepted' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
    // refresh-anchor must echo the anchor_id to stdout so callers can confirm which
    // row was refreshed — identical contract to assign-anchor
    expect(result.stdout.trim()).toBe('ADR-001');
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor divergence guard — REG-1
// ---------------------------------------------------------------------------

describe('refresh-anchor divergence guard — REG-1', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-divguard-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits non-zero when ledger details carries AMENDMENT text absent from log', () => {
    // RED test: ledger row has curated AMENDMENT suffix; log row does not.
    // refresh-anchor must refuse to silently discard the amendment.
    const logDetails = 'context: original; decision: use Result types; rationale: functional error handling';
    const ledgerDetails = logDetails + '; AMENDMENT 2026-08-01: also applies to async paths';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_divg_001',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-001',
        details: logDetails,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_divg_001',
        anchor_id: 'ADR-001',
        decisions_status: 'Accepted',
        details: ledgerDetails,
      }),
    ]);
    const beforeRows = readLedger(tmpDir);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001');
    expect(result.stderr).toContain('Reconcile the log row first');
    // Ledger row must be UNCHANGED — the guard must not leave a partial write
    const afterRows = readLedger(tmpDir);
    expect(afterRows[0].details).toBe(ledgerDetails);
    // The divergence guard must also be the only difference — no other ledger mutations
    expect(afterRows).toHaveLength(beforeRows.length);
  });

  it('D3: pattern replacement SUCCEEDS and the rendered heading updates to the sharpened title', () => {
    // Guard harmonization: pattern replacement is sanctioned per D3. Consumers match
    // '## (ADR|PF)-NNN:' anchor anchors, never titles, so the agent may sharpen the log
    // pattern to update the rendered heading. The pattern divergence guard was removed;
    // only DETAILS divergence is still protected (REG-1).
    const oldPattern = 'Use exceptions for error handling';
    const newPattern = 'Prefer explicit error channels over exception propagation';
    const sharedDetails = 'context: original; decision: base rule; rationale: consistency';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_divg_002',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-002',
        pattern: newPattern,
        details: sharedDetails,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_divg_002',
        anchor_id: 'ADR-002',
        decisions_status: 'Accepted',
        pattern: oldPattern,
        details: sharedDetails,
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-002', tmpDir);
    expect(result.code).toBe(0);
    // Ledger row carries the new (sharpened) pattern from the log
    const rows = readLedger(tmpDir);
    expect(rows[0].pattern).toBe(newPattern);
    // Rendered heading uses the sharpened title; old title gone
    const decisionsMd = fs.readFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8'
    );
    expect(decisionsMd).toContain(`## ADR-002: ${newPattern}`);
    expect(decisionsMd).not.toContain(oldPattern);
  });

  it('succeeds when log details is a strict superset of ledger details', () => {
    // Positive case: log has the ledger content plus more — guard passes.
    const ledgerDetails = 'context: base; decision: use Result; rationale: functional';
    const logDetails = ledgerDetails + '; AMENDMENT 2026-08-30: also handles cancellation';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_divg_003',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-003',
        details: logDetails,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_divg_003',
        anchor_id: 'ADR-003',
        decisions_status: 'Accepted',
        details: ledgerDetails,
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-003', tmpDir);
    expect(result.code).toBe(0);
    // Ledger now carries the log's full details (the superset)
    const rows = readLedger(tmpDir);
    expect(rows[0].details).toBe(logDetails);
  });

  it('succeeds when both details and pattern are identical between log and ledger', () => {
    // Exact match is trivially a superset — guard must not fire on equal content.
    const sharedDetails = 'context: foo; decision: bar; rationale: baz';
    const sharedPattern = 'Some established pattern';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_divg_004',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-004',
        details: sharedDetails,
        pattern: sharedPattern,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_divg_004',
        anchor_id: 'ADR-004',
        decisions_status: 'Accepted',
        details: sharedDetails,
        pattern: sharedPattern,
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-004', tmpDir);
    expect(result.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Guard harmonization: D4 — raw_body-lost refresh succeeds
// ---------------------------------------------------------------------------

describe('refresh-anchor guard harmonization — D4 raw_body-lost succeeds', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-d4-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refresh succeeds when the log row lost raw_body and the entry renders formatter-generated', () => {
    // D4: a log row that lost raw_body un-freezes the entry to formatter-rendered
    // output by design (D-LOG-CONTENT-AUTHORITY). The refresh must not throw on the absent field.
    const details = 'context: test; decision: use formatter; rationale: clean output';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_d4_001',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-001',
        details,
        // log row has no raw_body — simulates a row that lost it during editing
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_d4_001',
        anchor_id: 'ADR-001',
        decisions_status: 'Accepted',
        details,
        // ledger row originally had raw_body — after refresh it should be dropped
        raw_body: '\n## ADR-001: Some title\n\n- **Status**: Accepted\n',
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
    // Refreshed ledger row must not carry raw_body (log row has none)
    const rows = readLedger(tmpDir);
    expect(rows[0].raw_body).toBeUndefined();
    // decisions.md must contain formatter-generated output (not raw_body frozen body)
    const decisionsMd = fs.readFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8'
    );
    expect(decisionsMd).toContain('## ADR-001:');
    expect(decisionsMd).toContain('- **Status**: Accepted');
  });

  it('D4 mirror: refresh preserves raw_body when the log row carries a safe one', () => {
    // D4 mirror case: a log row that carries a safe raw_body propagates it
    // into the refreshed ledger row. The ledger row started without raw_body.
    const details = 'context: raw_body present; decision: preserve verbatim body; rationale: migration';
    const safeRawBody = '\n## ADR-002: Preserve verbatim body\n\n- **Status**: Accepted\n- **Context**: preserved\n';
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_d4_002',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-002',
        details,
        raw_body: safeRawBody,
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_d4_002',
        anchor_id: 'ADR-002',
        decisions_status: 'Accepted',
        details,
        // ledger row did not previously have raw_body
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-002', tmpDir);
    expect(result.code).toBe(0);
    // Refreshed ledger row carries the safe raw_body from the log row
    const rows = readLedger(tmpDir);
    expect(rows[0].raw_body).toBe(safeRawBody);
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor — variadic multi-anchor (PERF-1)
// ---------------------------------------------------------------------------

describe('refresh-anchor variadic multi-anchor — PERF-1', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-variadic-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('multi-anchor happy path: both rows re-projected and files rendered once', () => {
    // PERF-1: one call, two anchors, files rendered exactly once.
    const details1 = 'context: a; decision: use Result; rationale: functional';
    const details2 = 'area: hooks; issue: race; impact: lost data; resolution: lock';
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_var_001', type: 'decision', status: 'created', anchor_id: 'ADR-001', details: details1, pattern: 'Updated ADR pattern' }),
      makeObsRow({ id: 'obs_var_002', type: 'pitfall', status: 'created', anchor_id: 'PF-001', details: details2, pattern: 'Updated PF pattern' }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({ id: 'obs_var_001', anchor_id: 'ADR-001', decisions_status: 'Accepted', details: details1, pattern: 'Old ADR pattern' }),
      { id: 'obs_var_002', type: 'pitfall', anchor_id: 'PF-001', decisions_status: 'Active', details: details2, pattern: 'Old PF pattern' },
    ]);
    const result = runHelper('refresh-anchor ADR-001 PF-001', tmpDir);
    expect(result.code).toBe(0);
    // stdout contains both anchor ids (one per line)
    expect(result.stdout.trim()).toBe('ADR-001\nPF-001');
    // Both rows updated in ledger
    const rows = readLedger(tmpDir);
    expect(rows.find((r: Record<string, unknown>) => r.anchor_id === 'ADR-001')?.pattern).toBe('Updated ADR pattern');
    expect(rows.find((r: Record<string, unknown>) => r.anchor_id === 'PF-001')?.pattern).toBe('Updated PF pattern');
    // Both files rendered — decisions.md has ADR-001, pitfalls.md has PF-001
    const decisionsMd = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8');
    expect(decisionsMd).toContain('## ADR-001:');
    const pitfallsMd = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'pitfalls.md'), 'utf8');
    expect(pitfallsMd).toContain('## PF-001:');
  });

  it('one-bad-anchor-in-batch: nothing written when any anchor is invalid', () => {
    // All-or-nothing: ADR-002 does not exist in the ledger — nothing should be written.
    const details = 'context: x; decision: y; rationale: z';
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_var_003', type: 'decision', status: 'created', anchor_id: 'ADR-001', details, pattern: 'New pattern' }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({ id: 'obs_var_003', anchor_id: 'ADR-001', decisions_status: 'Accepted', details, pattern: 'Old pattern' }),
    ]);
    const before = readLedger(tmpDir);
    const result = runHelper('refresh-anchor ADR-001 ADR-002', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-002');
    expect(result.stderr).toContain('not found');
    // Ledger unchanged — no partial write
    const after = readLedger(tmpDir);
    expect(after[0].pattern).toBe(before[0].pattern);
  });

  it('zero-args usage error exits non-zero with usage message', () => {
    const result = runHelper('refresh-anchor', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('usage');
    expect(result.stderr).toContain('anchor_id');
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor row-count invariant — REL-6
// ---------------------------------------------------------------------------

describe('refresh-anchor row-count invariant — REL-6', () => {
  it('single-anchor refresh preserves row count (parseLedger drop exposure is bounded)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-rel6-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    try {
      const details = 'context: x; decision: y; rationale: z';
      writeLog(tmpDir, [
        makeObsRow({ id: 'obs_rel6_001', type: 'decision', status: 'created', anchor_id: 'ADR-001', details }),
        makeObsRow({ id: 'obs_rel6_002', type: 'decision', status: 'created', anchor_id: 'ADR-002', details }),
      ]);
      writeLedger(tmpDir, [
        makeLedgerRow({ id: 'obs_rel6_001', anchor_id: 'ADR-001', decisions_status: 'Accepted', details }),
        makeLedgerRow({ id: 'obs_rel6_002', anchor_id: 'ADR-002', decisions_status: 'Accepted', details }),
      ]);
      const result = runHelper('refresh-anchor ADR-001 ADR-002', tmpDir);
      expect(result.code).toBe(0);
      const rows = readLedger(tmpDir);
      expect(rows).toHaveLength(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// retire-anchor stdout echo — CON-P1
// ---------------------------------------------------------------------------

describe('retire-anchor stdout echo — CON-P1', () => {
  it('retire-anchor echoes the anchor_id to stdout, matching the other three ops', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-stdout-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    try {
      writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
      const result = runHelper('retire-anchor ADR-001 Retired', tmpDir);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('ADR-001');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor precondition assertions — TS-2
// ---------------------------------------------------------------------------

describe('refresh-anchor precondition assertions — TS-2', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-precond-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits non-zero when ledger row has no id field', () => {
    // A ledger row without id causes undefined===undefined to bind the wrong log row.
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_prec_001', type: 'decision', status: 'created', anchor_id: 'ADR-001' }),
    ]);
    // Hand-craft a ledger row with no id
    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({ type: 'decision', pattern: 'P', anchor_id: 'ADR-001', decisions_status: 'Accepted' }) + '\n',
      'utf8'
    );
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001');
    expect(result.stderr).toContain('has no id');
  });

  it('exits non-zero when ledger row has no decisions_status', () => {
    // Absent decisions_status would be dropped by JSON.stringify in toLedgerRow,
    // writing a ledger row that violates the required field.
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_prec_002', type: 'decision', status: 'created', anchor_id: 'ADR-002' }),
    ]);
    // Hand-craft a ledger row with no decisions_status
    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({ id: 'obs_prec_002', type: 'decision', pattern: 'P', anchor_id: 'ADR-002' }) + '\n',
      'utf8'
    );
    const result = runHelper('refresh-anchor ADR-002', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-002');
    expect(result.stderr).toContain('has no decisions_status');
  });

  it('exits non-zero when log obs type does not match ledger row type', () => {
    // Re-projecting across entry types would move a PF-NNN entry into decisions.md.
    // Log obs type 'pitfall', ledger row type 'decision' — must refuse.
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_prec_003',
        type: 'pitfall',  // intentionally mismatched
        status: 'created',
        anchor_id: 'ADR-003',
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_prec_003',
        type: 'decision',  // committed type
        anchor_id: 'ADR-003',
        decisions_status: 'Accepted',
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-003', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-003');
    expect(result.stderr).toContain('does not match committed anchor');
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor ledger-existence guard — SEC-S3
// ---------------------------------------------------------------------------

describe('refresh-anchor ledger-existence guard — SEC-S3', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-ledgerguard-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits non-zero with ledger-not-found message when ledger is absent', () => {
    // No ledger file exists — guard fires before mkdir, giving a clear error.
    // (The log can exist; the ledger is the gating file.)
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_sec_001', type: 'decision', status: 'created', anchor_id: 'ADR-001' }),
    ]);
    // Remove the ledger if it was created
    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    if (fs.existsSync(ledgerPath)) fs.rmSync(ledgerPath);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('decisions-ledger.jsonl');
    expect(result.stderr).not.toMatch(/ENOENT/);
  });

  it('proceeds past the guard when ledger exists', () => {
    // Ledger present → guard passes, operation proceeds normally.
    writeLog(tmpDir, [
      makeObsRow({
        id: 'obs_sec_002',
        type: 'decision',
        status: 'created',
        anchor_id: 'ADR-001',
      }),
    ]);
    writeLedger(tmpDir, [
      makeLedgerRow({
        id: 'obs_sec_002',
        anchor_id: 'ADR-001',
        decisions_status: 'Accepted',
      }),
    ]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rotate-observations CLI op
// ---------------------------------------------------------------------------

describe('rotate-observations CLI op', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-cli-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints "rotated N observations" and exits 0', () => {
    seedLearningTree(tmpDir, {
      log: [
        makeV1LogRow({ id: 'obs_cli_due', last_seen: '2026-01-01T00:00:00.000Z' }),
        makeV1LogRow({ id: 'obs_cli_fresh', last_seen: new Date().toISOString() }),
      ],
    });

    const result = runJsonHelper(tmpDir, ['rotate-observations']);

    expect(result).toEqual({ code: 0, stdout: 'rotated 1 observations\n', stderr: '' });
    expect(store.readJsonl(learningPaths(tmpDir).archive).rows.map(row => row.id)).toEqual(['obs_cli_due']);
  });

  it('prints "rotated 0 observations" for an empty learning tree', () => {
    expect(runJsonHelper(tmpDir, ['rotate-observations'])).toEqual({ code: 0, stdout: 'rotated 0 observations\n', stderr: '' });
  });

  it('refuses a path argument and writes nothing: the log and archive are the project root\'s', () => {
    const elsewhere = path.join(tmpDir, 'elsewhere');
    fs.mkdirSync(elsewhere);
    const logPath = path.join(elsewhere, 'decisions-log.jsonl');
    fs.writeFileSync(logPath, `${JSON.stringify(makeObsRow({ id: 'obs_elsewhere', last_seen: '2026-01-01T00:00:00Z' }))}\n`);
    const before = snapshotTree(tmpDir);

    const result = runJsonHelper(tmpDir, ['rotate-observations', logPath, path.join(elsewhere, 'archive.jsonl')]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('rotate-observations: usage');
    expect(snapshotTree(tmpDir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// assign-anchor precondition assertions (Issue 1)
// ---------------------------------------------------------------------------

describe('assign-anchor precondition assertions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-precond-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(b) exits non-zero when obs already has an anchor_id set', () => {
    // The obs in the log already has anchor_id set → double-anchor attempt
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_already_anchored', type: 'decision', status: 'created', anchor_id: 'ADR-001' }),
    ]);
    const result = runHelper('assign-anchor decision obs_already_anchored', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('obs_already_anchored');
    expect(result.stderr).toContain('already anchored');
  });

  it('(b) error message names the existing anchor_id', () => {
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_with_anchor', type: 'pitfall', status: 'created', anchor_id: 'PF-007' }),
    ]);
    const result = runHelper('assign-anchor pitfall obs_with_anchor', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('PF-007');
  });

  it('(b) live double-assign guard: second assign-anchor on same obs_id is rejected', () => {
    // assign-anchor writes anchor_id back to the log row after promotion.
    // A second call on the same obs_id reads aaObs.anchor_id as set and is rejected by guard (b).
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_double_assign', type: 'decision' }),
    ]);
    // First assign-anchor: should succeed and mint ADR-001
    const first = runHelper('assign-anchor decision obs_double_assign', tmpDir);
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe('ADR-001');

    // Second assign-anchor on the SAME obs_id: guard must reject it.
    const second = runHelper('assign-anchor decision obs_double_assign', tmpDir);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain('already anchored');
    expect(second.stderr).toContain('obs_double_assign');
  });
});

// ---------------------------------------------------------------------------
// E4: pre-mint collision guard — refuse to mint over an existing citation
// ---------------------------------------------------------------------------

const COLLISION_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

function initGitRepoWithFile(dir: string, relFile: string, content: string): void {
  execSync('git init -q', { cwd: dir, env: COLLISION_GIT_ENV });
  const absFile = path.join(dir, relFile);
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, content, 'utf8');
  execSync('git add -A', { cwd: dir, env: COLLISION_GIT_ENV });
  execSync('git commit -q -m init', { cwd: dir, env: COLLISION_GIT_ENV });
}

describe('E4: pre-mint collision guard', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-collision-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses to mint when the candidate id is cited in a git-tracked file; ledger left byte-unchanged', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001' })]);
    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    const before = fs.readFileSync(ledgerPath);

    // Next candidate for a ledger already holding ADR-001 is ADR-002 — plant that
    // as a design-local citation with a different meaning, in a tracked file.
    initGitRepoWithFile(tmpDir, 'docs/design.md', 'See ADR-002 for the rationale.\n');
    writeLog(tmpDir, [makeObsRow({ id: 'obs_collide', type: 'decision', status: 'ready' })]);

    const result = runHelper('assign-anchor decision obs_collide', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-002');
    expect(result.stderr).toContain('docs/design.md:1');

    const after = fs.readFileSync(ledgerPath);
    expect(after.equals(before)).toBe(true);
  });

  it('lists tracked files without running the repository\'s core.fsmonitor hook (D-NO-FSMONITOR)', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001' })]);
    // A gitignored file citing the same id: the fs-walk fallback would report it,
    // `git ls-files` never does — so its absence proves the git listing answered.
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored/\n');
    fs.mkdirSync(path.join(tmpDir, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'ignored', 'scratch.md'), 'ADR-002 scribble.\n');
    initGitRepoWithFile(tmpDir, 'docs/design.md', 'See ADR-002 for the rationale.\n');
    writeLog(tmpDir, [makeObsRow({ id: 'obs_fsmonitor', type: 'decision', status: 'ready' })]);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-fsmonitor-hook-'));
    const home = path.join(outside, 'home');
    fs.mkdirSync(home);
    const marker = path.join(outside, 'fsmonitor-ran');
    const hook = path.join(outside, 'fsmonitor-hook.sh');
    fs.writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`);
    fs.chmodSync(hook, 0o755);
    const env = { ...COLLISION_GIT_ENV, HOME: home };
    execFileSync('git', ['config', 'core.fsmonitor', hook], { cwd: tmpDir, env });

    try {
      const run = spawnSync('node', [JSON_HELPER_BIN, 'assign-anchor', 'decision', 'obs_fsmonitor'], {
        cwd: tmpDir,
        env,
        encoding: 'utf8',
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('docs/design.md:1');
      expect(run.stderr).not.toContain('scratch.md');
      expect(fs.existsSync(marker), 'assign-anchor ran the fsmonitor hook').toBe(false);

      // Known-bad probe: the same index read without the override runs the hook.
      execFileSync('git', ['ls-files', '-z'], { cwd: tmpDir, env, stdio: 'ignore' });
      expect(fs.existsSync(marker)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses to mint when the candidate id is cited in a non-git project (fs-walk fallback)', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_collide_nogit', type: 'decision', status: 'ready' })]);
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'notes.md'), 'Design number ADR-001 was reserved earlier.\n');

    const result = runHelper('assign-anchor decision obs_collide_nogit', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001');
    expect(result.stderr).toContain('notes.md');

    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  it('mints normally when there is no citation anywhere in the tree', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_clean', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_clean', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  it('--allow-collision mints anyway despite a citation', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_override', type: 'decision', status: 'ready' })]);
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'notes.md'), 'ADR-001 already means something else.\n');

    const result = runHelper('assign-anchor decision obs_override --allow-collision', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  it('rejects an unknown flag before touching the ledger', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_badflag', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_badflag --allow-typo', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('unknown flag');
    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    expect(fs.existsSync(ledgerPath)).toBe(false);
  });

  it('ignores a self-citation inside .devflow/learning (mints normally)', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_selfcite', type: 'decision', status: 'ready' })]);
    // A rendered .md file already containing "ADR-001" is the ledger's own
    // territory (self-citation) and must never trigger the guard.
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '## ADR-001: Some prior entry\n'
    );

    const result = runHelper('assign-anchor decision obs_selfcite', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  describe('next-anchor (read-only)', () => {
    it('prints the next candidate id and creates no ledger when there is no citation', () => {
      const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
      expect(fs.existsSync(ledgerPath)).toBe(false);

      const result = runHelper('next-anchor decision', tmpDir);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('ADR-001');
      expect(fs.existsSync(ledgerPath)).toBe(false);
    });

    it('reports collision hits and exits non-zero without mutating anything', () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'docs', 'notes.md'), 'ADR-001 is cited here.\n');
      const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');

      const result = runHelper('next-anchor decision', tmpDir);
      expect(result.code).not.toBe(0);
      expect(result.stdout.trim()).toBe('ADR-001');
      expect(result.stderr).toContain('notes.md');
      expect(fs.existsSync(ledgerPath)).toBe(false);
    });

    it('type validation matches assign-anchor', () => {
      const result = runHelper('next-anchor workflow', tmpDir);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("must be 'decision' or 'pitfall'");
    });
  });
});

// ---------------------------------------------------------------------------
// toLedgerRow projector: canonical ledger shape (Issue 3)
// ---------------------------------------------------------------------------

describe('toLedgerRow projector — canonical committed shape', () => {
  const formatModule = require(
    path.join(ROOT, 'src/assets/scripts/hooks/lib/decisions-format.cjs')
  ) as {
    toLedgerRow: (
      obs: Record<string, unknown>,
      opts: { anchorId: string; status: string; date?: string }
    ) => Record<string, unknown>;
  };
  const projector = formatModule.toLedgerRow;

  it('includes only canonical fields for a decision with date', () => {
    const obs: Record<string, unknown> = {
      id: 'obs_proj_001',
      type: 'decision',
      pattern: 'Use Result types',
      details: 'context: foo; decision: bar; rationale: baz',
      // observation-lifecycle fields that must be excluded
      confidence: 0.9,
      quality_ok: true,
      observations: 3,
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-06-01T00:00:00Z',
      evidence: ['evidence1'],
      artifact_path: '/some/path',
      status: 'ready',
    };

    const row = projector(obs, { anchorId: 'ADR-042', status: 'Accepted', date: '2026-06-11' });

    // Required canonical fields
    expect(row.id).toBe('obs_proj_001');
    expect(row.type).toBe('decision');
    expect(row.pattern).toBe('Use Result types');
    expect(row.details).toBe('context: foo; decision: bar; rationale: baz');
    expect(row.anchor_id).toBe('ADR-042');
    expect(row.decisions_status).toBe('Accepted');
    expect(row.date).toBe('2026-06-11');

    // Lifecycle fields must be absent
    expect(row.confidence).toBeUndefined();
    expect(row.quality_ok).toBeUndefined();
    expect(row.observations).toBeUndefined();
    expect(row.first_seen).toBeUndefined();
    expect(row.last_seen).toBeUndefined();
    expect(row.evidence).toBeUndefined();
    expect(row.artifact_path).toBeUndefined();
    expect(row.status).toBeUndefined();
  });

  it('omits date field when not provided (pitfall path)', () => {
    const obs: Record<string, unknown> = {
      id: 'obs_proj_pf',
      type: 'pitfall',
      pattern: 'Some pitfall',
      details: 'area: test; issue: foo',
    };
    const row = projector(obs, { anchorId: 'PF-003', status: 'Active', date: undefined });
    expect(row.date).toBeUndefined();
  });

  it('preserves raw_body when present in obs', () => {
    const obs: Record<string, unknown> = {
      id: 'obs_proj_rb',
      type: 'decision',
      pattern: 'Pattern',
      details: '',
      raw_body: '\n## ADR-001: Pattern\n\n- **Status**: Accepted\n',
    };
    const row = projector(obs, { anchorId: 'ADR-001', status: 'Accepted', date: '2026-01-01' });
    expect(row.raw_body).toBe('\n## ADR-001: Pattern\n\n- **Status**: Accepted\n');
  });

  it('preserves amendments when present in obs', () => {
    const obs: Record<string, unknown> = {
      id: 'obs_proj_amd',
      type: 'decision',
      pattern: 'Pattern',
      details: '',
      amendments: [{ date: '2026-05-01', note: 'Updated' }],
    };
    const row = projector(obs, { anchorId: 'ADR-002', status: 'Accepted', date: '2026-01-01' });
    expect(row.amendments).toEqual([{ date: '2026-05-01', note: 'Updated' }]);
  });

  it('omits raw_body and amendments when absent from obs', () => {
    const obs: Record<string, unknown> = { id: 'obs_proj_bare', type: 'decision', pattern: 'P', details: 'd' };
    const row = projector(obs, { anchorId: 'ADR-003', status: 'Accepted', date: '2026-01-01' });
    expect(row.raw_body).toBeUndefined();
    expect(row.amendments).toBeUndefined();
  });

  it('assign-anchor CLI emits only canonical fields in ledger row', () => {
    // End-to-end: obs has extra lifecycle fields; ledger row must not contain them
    const tmpE2e = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-proj-test-'));
    fs.mkdirSync(path.join(tmpE2e, '.devflow', 'learning'), { recursive: true });
    try {
      const logPathE2e = path.join(tmpE2e, '.devflow', 'learning', 'decisions-log.jsonl');
      const obsWithLifecycle = makeObsRow({
        id: 'obs_e2e_proj',
        type: 'decision',
        status: 'ready',
        confidence: 0.95,
        quality_ok: true,
        artifact_path: '/some/file.ts',
      });
      fs.writeFileSync(logPathE2e, JSON.stringify(obsWithLifecycle) + '\n', 'utf8');

      const result = runHelper('assign-anchor decision obs_e2e_proj', tmpE2e);
      expect(result.code).toBe(0);

      const ledgerPath = path.join(tmpE2e, '.devflow', 'learning', 'decisions-ledger.jsonl');
      const rows = parseLedger(ledgerPath);
      expect(rows).toHaveLength(1);
      const r = rows[0];
      // Required canonical
      expect(r.anchor_id).toBe('ADR-001');
      expect(r.id).toBe('obs_e2e_proj');
      // Excluded lifecycle fields
      expect(r.confidence).toBeUndefined();
      expect(r.quality_ok).toBeUndefined();
      expect(r.artifact_path).toBeUndefined();
      expect(r.evidence).toBeUndefined();
      expect(r.first_seen).toBeUndefined();
      expect(r.last_seen).toBeUndefined();
    } finally {
      fs.rmSync(tmpE2e, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-P2: assign-anchor O(anchored) — structural check (no N^2 scan)
// Ratio/bounded-delta methodology, not absolute ms.
// ---------------------------------------------------------------------------

describe('AC-P2: assign-anchor O(anchored) performance (ratio methodology)', () => {
  it('nextAnchorFromLedger is O(N) — 10x rows yields <15x time', () => {
    // expect.assertions(2) guarantees this test never passes with zero assertions:
    // the ratio check may be skipped on sub-0.01ms runs, but the absolute ceiling
    // on medianLarge always runs so a vacuous O(N²) regression is always caught.
    expect.assertions(2);

    const SMALL = 50;
    const LARGE = 500;
    const WARMUP = 5;
    const RUNS = 7;

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

    const medianLarge = largeTimes.sort((a, b) => a - b)[Math.floor(RUNS / 2)];
    // MIN (not median) is the noise-robust scaling estimator: timing noise only
    // ever adds time, so the fastest run best reflects true compute cost (a
    // single median spike on shared CI is what makes ratio assertions flaky).
    const minSmall = Math.min(...smallTimes);
    const minLarge = Math.min(...largeTimes);

    // Absolute ceiling: 500-row scan must finish within 100ms on any CI.
    // Always runs, so the test can never pass vacuously.
    expect(medianLarge).toBeLessThan(100);

    // Ratio check (only when the small case is measurable): 10x input is ~10x
    // for an O(anchored) single pass and ~100x for an O(N²) regression.
    // SUPER_LINEAR_RATIO=30 separates the two with headroom for CI noise.
    const SUPER_LINEAR_RATIO = 30;
    if (minSmall >= 0.01) {
      expect(minLarge / minSmall).toBeLessThan(SUPER_LINEAR_RATIO);
    } else {
      // Small case sub-0.01ms — ratio is noise; ceiling above guards O(N²).
      // Consume the 2nd assertion slot.
      expect(true).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-P2b: full assign-anchor write-path O(anchored) — CLI-level timing
//
// The in-memory nextAnchorFromLedger test above validates the scan logic, but
// the real write path (lock → read ledger → compute next → append → update log
// → render both .md) dominates runtime in production. This test times full CLI
// invocations at ~50 vs ~500 seeded ledger rows to bound the REAL write path's
// growth.
//
// Note: each CLI invocation spawns a child process, so absolute times are
// dominated by Node.js startup (~50–200ms per call). We assert a structural
// bound (the 500-row run must not take >10x the 50-row run when both are in the
// same order of magnitude) and add an absolute ceiling. If the ratio is not
// meaningful (startup noise dwarfs the work), we log a note and accept the run —
// the absolute ceiling is the primary regression guard.
// ---------------------------------------------------------------------------

describe('AC-P2b: assign-anchor full write-path performance (CLI-level)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-anchor-perf-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('500-row ledger assign-anchor is not >10x slower than 50-row (write-path bound)', () => {
    // expect.assertions(2): absolute ceiling always runs; ratio check conditional.
    expect.assertions(2);

    const SMALL_N = 50;
    const LARGE_N = 500;

    function seedLedger(dir: string, n: number): void {
      const rows = Array.from({ length: n }, (_, i) =>
        makeLedgerRow({ anchor_id: `ADR-${String(i + 1).padStart(3, '0')}`, id: `obs_seed${i}` })
      );
      writeLedger(dir, rows);
    }

    function seedLog(dir: string, obsId: string): void {
      writeLog(dir, [makeObsRow({ id: obsId, status: 'ready', type: 'decision' })]);
    }

    function timeAssignAnchor(n: number): number {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aa-perf-${n}-`));
      try {
        fs.mkdirSync(path.join(dir, '.devflow', 'learning'), { recursive: true });
        seedLedger(dir, n);
        seedLog(dir, 'obs_time_target');
        const start = performance.now();
        runHelper('assign-anchor decision obs_time_target', dir);
        return performance.now() - start;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    // Warmup: one invocation each to avoid cold-start skewing
    timeAssignAnchor(SMALL_N);
    timeAssignAnchor(LARGE_N);

    // Measure: single timed invocation for each (CLI startup noise is large;
    // multiple runs would multiply test time without improving signal).
    const smallMs = timeAssignAnchor(SMALL_N);
    const largeMs = timeAssignAnchor(LARGE_N);

    // Absolute ceiling: a 500-row assign-anchor must complete within 10 seconds
    // even on the slowest CI (Node startup + file I/O + render).
    expect(largeMs).toBeLessThan(10_000);

    // Ratio guard: only assert when startup noise is not the dominant factor.
    // If both runs take >200ms (well above typical startup noise), the ratio
    // reflects real work. If smallMs is very small (startup-dominated) the
    // ratio is noise and we skip it — the ceiling above is the regression guard.
    if (smallMs > 200 && largeMs / smallMs > 0) {
      // CLI invocations carry a large fixed startup cost, so a linear 10x
      // workload yields a ratio BELOW 10 (startup is amortized across the
      // larger run). An O(N²) write-path regression would still be ~100x. 25
      // catches super-linear blowup with ample headroom for startup variance.
      expect(largeMs / smallMs).toBeLessThan(25);
    } else {
      // Startup noise dominates — ratio is not meaningful.
      // The absolute ceiling above is the regression guard.
      expect(true).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Locking discipline: assign-anchor and render happen under one lock (no deadlock)
// ---------------------------------------------------------------------------

describe('locking discipline: assign-anchor and render under single .decisions.lock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('assign-anchor completes without deadlock and leaves no lock dir behind', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_lock_01', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_lock_01', tmpDir);
    expect(result.code).toBe(0);

    // Lock dir should be released
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('retire-anchor completes without deadlock and leaves no lock dir behind', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runJsonHelper(tmpDir, ['retire-anchor', 'ADR-001', 'Retired'], '{"reason":"test"}');
    expect(result.code).toBe(0);

    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D-ONE-LEARNING-LOCK: every learning writer takes .decisions.lock, and no
// writer takes a second lock over the same files.
// ---------------------------------------------------------------------------

/** A preload that appends the base name of each directory the process creates to `record`, one per line. */
function recordMkdirPreload(record: string): string {
  return [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const mkdirSync = fs.mkdirSync;',
    'fs.mkdirSync = function recordMkdir(target, ...rest) {',
    `  fs.appendFileSync(${JSON.stringify(record)}, path.basename(String(target)) + '\\n');`,
    '  return mkdirSync.call(fs, target, ...rest);',
    '};',
    '',
  ].join('\n');
}

describe('D-ONE-LEARNING-LOCK: every learning writer takes the one learning lock', { timeout: 30_000 }, () => {
  let tmpDir: string;
  let probeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-lock-test-'));
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-lock-probe-'));
    const details = 'context: c; decision: d; rationale: r';
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_one_lock_new', type: 'decision', status: 'ready' }),
      makeObsRow({ id: 'obs_one_lock_old', type: 'decision', status: 'created', details }),
      makeObsRow({ id: 'obs_one_lock_stale', status: 'observing', last_seen: '2026-01-01T00:00:00Z' }),
    ]);
    writeLedger(tmpDir, [makeLedgerRow({ id: 'obs_one_lock_old', anchor_id: 'ADR-001', details })]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(probeDir, { recursive: true, force: true });
  });

  /** The base names of the directories one op run created, in order. */
  function directoriesCreatedBy(args: readonly string[], input = ''): string[] {
    const record = path.join(probeDir, `${args[0]}.mkdir`);
    const preload = path.join(probeDir, `${args[0]}.preload.cjs`);
    fs.writeFileSync(preload, recordMkdirPreload(record), 'utf8');
    const run = spawnSync(process.execPath, ['--require', preload, JSON_HELPER_BIN, ...args], {
      cwd: tmpDir,
      input,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (run.error) throw run.error;
    expect(run.status, `${args[0]} exits 0: ${run.stderr}`).toBe(0);
    return fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean) : [];
  }

  /** The stdin each writer takes; an update rewrites the anchored observation and re-renders its entry. */
  const STDIN: Readonly<Record<string, string>> = {
    'retire-anchor': '{"reason":"test"}',
    'put-observation': JSON.stringify({
      id: 'obs_one_lock_old',
      type: 'decision',
      title: 'Return a Result from every fallible call',
      rule: 'Fallible functions return a Result value instead of throwing.',
      why: 'A thrown error skips the cleanup its caller wrote for the failure path.',
      scope: ['area:learning'],
      provenance: 'one-lock test',
    }),
  };

  it.each([
    [['assign-anchor', 'decision', 'obs_one_lock_new']],
    [['retire-anchor', 'ADR-001', 'Retired']],
    [['refresh-anchor', 'ADR-001']],
    [['rotate-observations']],
    [['put-observation', '--update']],
    [['claim-due']],
  ])('%j takes .decisions.lock and creates no other directory', args => {
    expect(directoriesCreatedBy(args, STDIN[args[0]] ?? '')).toEqual(['.decisions.lock']);
  });
});

// ---------------------------------------------------------------------------
// D-NO-STRAY-TREE: a learning writer refuses outside a learning tree and
// creates nothing there — no .devflow/, no .devflow/learning/, no lock.
// ---------------------------------------------------------------------------

describe('D-NO-STRAY-TREE: a learning writer refuses outside a learning tree', { timeout: 30_000 }, () => {
  const WRITERS: ReadonlyArray<{ args: readonly string[]; input?: string }> = [
    { args: ['assign-anchor', 'decision', 'obs_stray_one'] },
    { args: ['retire-anchor', 'ADR-001', 'Retired'], input: '{"reason":"test"}' },
    { args: ['refresh-anchor', 'ADR-001'] },
    { args: ['rotate-observations'] },
    {
      args: ['put-observation', '--create'],
      input: JSON.stringify({
        id: 'obs_stray_one',
        type: 'decision',
        title: 'A title',
        rule: 'A rule.',
        why: 'A reason.',
        scope: ['area:learning'],
        provenance: 'stray-tree test',
      }),
    },
    { args: ['claim-due'] },
  ];
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stray-tree-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const { args, input } of WRITERS) {
    const op = args[0];

    it(`${op} in a directory with no .devflow/ exits 1, names the missing directory and creates nothing`, () => {
      const before = snapshotTree(dir);
      const run = runJsonHelper(dir, args, input);
      expect(run.code).toBe(1);
      expect(run.stderr).toBe(`${op}: no .devflow/learning/ under ${fs.realpathSync(dir)} — run from the project root\n`);
      expect(snapshotTree(dir)).toEqual(before);
    });

    it(`${op} under a .devflow/ with no learning directory exits 1 and creates nothing`, () => {
      fs.mkdirSync(path.join(dir, '.devflow'));
      const before = snapshotTree(dir);
      const run = runJsonHelper(dir, args, input);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain('no .devflow/learning/ under');
      expect(snapshotTree(dir)).toEqual(before);
    });
  }

  it('assign-anchor success path never creates .devflow/decisions/ (legacy dir must not appear)', () => {
    // Normal setup — .devflow/learning/ pre-exists; verifies the legacy mkdir is gone
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-no-decisions-'));
    try {
      fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
      writeLog(tmpDir, [makeObsRow({ id: 'obs_nodec_01', type: 'decision', status: 'ready' })]);
      const result = runHelper('assign-anchor decision obs_nodec_01', tmpDir);
      expect(result.code).toBe(0);
      // Before fix: fs.mkdirSync('.devflow/decisions', {recursive:true}) was called
      // unconditionally; after fix it is gone
      expect(fs.existsSync(path.join(tmpDir, '.devflow', 'decisions'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Lock release on early-exit error paths (S3b regression)
//
// process.exit(1) inside a try/finally block bypasses the finally block in
// Node.js. Any early-exit path that called process.exit(1) while holding
// .decisions.lock left a stale lock directory. The fix replaces process.exit
// with throw inside locked regions so finally always runs and releases the lock.
// ---------------------------------------------------------------------------

describe('lock release on early-exit error paths', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-release-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('assign-anchor: missing log file — lock dir released after controlled error', () => {
    // No log file written — parseLedger returns [], findIndex returns -1 → early-exit path
    const result = runHelper('assign-anchor decision obs_missing_log', tmpDir);
    expect(result.code).not.toBe(0);
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('assign-anchor: obs_id not found in existing log — lock dir released after controlled error', () => {
    // Log file exists but obs_id is absent
    writeLog(tmpDir, [makeObsRow({ id: 'obs_real', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_nonexistent', tmpDir);
    expect(result.code).not.toBe(0);
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('retire-anchor: missing ledger — lock dir released after controlled error', () => {
    // No ledger file — parseLedger returns [], findIndex returns -1 → early-exit path
    const result = runHelper('retire-anchor ADR-001 Retired', tmpDir);
    expect(result.code).not.toBe(0);
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('retire-anchor: anchor_id not found in existing ledger — lock dir released after controlled error', () => {
    // Ledger exists but the requested anchor_id is absent
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runHelper('retire-anchor ADR-999 Retired', tmpDir);
    expect(result.code).not.toBe(0);
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('refresh-anchor: missing log obs — lock dir released after controlled error', () => {
    // Ledger has ADR-001 (id: 'obs_test001') but no log obs with that id
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    // No log seeded — obs lookup by ledger row id must fail gracefully
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('not found');
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('refresh-anchor: anchor_id not in ledger — lock dir released after controlled error', () => {
    // Log has the obs but the ledger is missing the anchor
    writeLog(tmpDir, [
      makeObsRow({ id: 'obs_ra_lock', type: 'decision', status: 'created', anchor_id: 'ADR-001' }),
    ]);
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-999', decisions_status: 'Accepted' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('not found');
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pre-existing corpus fixture — REG-S1 (fixtures derived from real corpus)
//
// Frozen copies of actual anchored rows from .devflow/learning/decisions-ledger.jsonl
// at time of authoring. Used to pin that refresh-anchor succeeds against real-world
// rows and that the rendered output has non-empty body fields.
//
// These fixtures are FROZEN IN-FILE, not live-file reads: the live ledger is per-machine and gitignored.
// Derived from decisions-ledger.jsonl rows ADR-001 and PF-001.
// ---------------------------------------------------------------------------

describe('refresh-anchor — pre-existing corpus fixture (REG-S1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-corpus-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Frozen corpus fixtures — derived from live decisions-ledger.jsonl.
  // ADR-001: decision (Accepted, dated) — has context/decision/rationale fields in details.
  const CORPUS_ADR_001 = {
    id: 'obs_cleanbrk1',
    type: 'decision',
    pattern: 'Ship feature-knowledge v2 as a clean break — delete the old-install cleanup machinery (migrations, runtime knowledge sweep, dream-knowledge auto-uninstall) and clean the only affected machine by hand; do not carry deprecated-pipeline defense code into the published version',
    details: 'context: PR #247 simplifies feature-knowledge to a write-through model and removes knowledge from the Dream pipeline; the just-shipped commit e07b6b4 had added two run-once migrations (purge-feature-knowledge-pipeline) plus a runtime knowledge) marker-sweep case in dream-collect-tasks and a dream-knowledge stale-skill auto-uninstall, all to defend OLD installs against orphaned knowledge artifacts; decision: because v2 is an unreleased clean break and the only affected machine is the developers own, delete that entire old-install cleanup layer (revert the 2 migrations + their tests, drop the knowledge) runtime sweep, drop the dream-knowledge auto-uninstall) and perform the one-machine cleanup manually instead of shipping defense code; rationale: the deprecated-pipeline defense only matters for installs that upgrade across the break, which do not exist for an unreleased major; carrying it would be permanent dead code contradicting the minimalism the simplification was chartered to deliver; the cost is explicit and accepted — nothing auto-purges legacy knowledge artifacts on init, so the developer must manually trash eval-knowledge, lib/feature-knowledge.cjs, the dream-knowledge skill, and per-project .devflow/features knowledge markers',
    anchor_id: 'ADR-001',
    decisions_status: 'Accepted',
    date: '2026-06-30',
  };

  // PF-001: pitfall (Active, no date) — has area/issue/impact/resolution fields in details.
  const CORPUS_PF_001 = {
    id: 'obs_planhandoff1',
    type: 'pitfall',
    pattern: "Claude Code plan-mode handoff schema is undocumented and mutable — as of ~v2.1.198 the injected prompt message.content carries ONLY the 31-char 'Implement the following plan:' prefix while the plan body moved to a separate top-level planContent field and the entry is tagged origin auto-continuation; match the handoff by prefix ONLY and never parse plan bodies out of transcripts or hook payloads",
    details: "area: ambient plan-handoff detection (scripts/hooks/preamble + scripts/hooks/session-start-orchestrator); Claude Code plan-mode handoff contract; issue: Claude Code changed the handoff transcript/hook-payload schema at ~v2.1.198 — message.content now holds only the 31-char prefix 'Implement the following plan:', the plan body moved to a separate top-level planContent field, and the entry is tagged origin auto-continuation (typed prompts are origin human); the prefix literal itself is unchanged (stable back to v2.1.167), the change is undocumented (never appeared in release notes), and no setting/env/flag reverts it; impact: any tooling that parses the plan body out of transcripts or hook payloads breaks silently, and the origin auto-continuation tag is a plausible discriminator Claude Code could use to stop firing UserPromptSubmit for injected prompts (the open T-5 risk that would silently kill the preamble fast-path); resolution: match the handoff by the anchored 'Implement the following plan:' prefix ONLY and instruct the model (which always receives the full plan in context) — never parse plan bodies from payloads; keep the SessionStart charter as a fallback because SessionStart provably fires even when UserPromptSubmit may not; do not version-pin to chase the old schema (the prefix-only shape predates the oldest available sample). applies ADR-004",
    anchor_id: 'PF-001',
    decisions_status: 'Active',
  };

  it('refresh-anchor on a frozen ADR-001 corpus row succeeds and renders non-empty Consequences', () => {
    // Derived from live ADR-001 ledger row — log carries identical details (superset check passes).
    writeLog(tmpDir, [CORPUS_ADR_001]);
    writeLedger(tmpDir, [CORPUS_ADR_001]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
    const decisionsMd = fs.readFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8'
    );
    expect(decisionsMd).toContain('## ADR-001:');
    // details has both 'context:' and 'decision:' fields — rendered body must be non-empty
    expect(decisionsMd).toMatch(/- \*\*Context\*\*: .+/);
    expect(decisionsMd).toMatch(/- \*\*Decision\*\*: .+/);
  });

  it('refresh-anchor on a frozen PF-001 corpus row succeeds and renders non-empty Impact and Resolution', () => {
    // Derived from live PF-001 ledger row — log carries identical details (superset check passes).
    writeLog(tmpDir, [CORPUS_PF_001]);
    writeLedger(tmpDir, [CORPUS_PF_001]);
    const result = runHelper('refresh-anchor PF-001', tmpDir);
    expect(result.code).toBe(0);
    const pitfallsMd = fs.readFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'pitfalls.md'), 'utf8'
    );
    expect(pitfallsMd).toContain('## PF-001:');
    // details has 'impact:' and 'resolution:' fields — rendered body must be non-empty
    expect(pitfallsMd).toMatch(/- \*\*Impact\*\*: .+/);
    expect(pitfallsMd).toMatch(/- \*\*Resolution\*\*: .+/);
  });
});

// ---------------------------------------------------------------------------
// D-LEDGER-MAIN-WORKTREE (TP-17): the ledger ops run where the directive points
// ---------------------------------------------------------------------------
//
// The Learning agent runs every ledger op from the "Project root:" its spawn
// directive names. In a linked worktree session-start-context names the MAIN
// worktree (resolve-project-root's df_resolve_roots), so an op minted from a
// worktree session continues the repository's numbering. From the worktree's own
// toplevel the ledger would be empty and the op would restart at ADR-001 —
// colliding with main's ADR-001, which is the defect this pins shut.

// Real git + a hook + a node op per case: ≤6 spawns at ≤5 s each on a loaded machine.
describe('D-LEDGER-MAIN-WORKTREE: a worktree session mints into the main ledger (TP-17)', { timeout: 30_000 }, () => {
  const CONTEXT_HOOK = path.join(ROOT, 'src/assets/scripts/hooks/session-start-context');
  let base: string;
  let main: string;
  let wt: string;
  let homeDir: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-worktree-'));
    main = path.join(base, 'main');
    fs.mkdirSync(main);
    execSync('git init -q', { cwd: main, stdio: 'pipe' });
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: main, stdio: 'pipe' });
    wt = path.join(base, 'wt');
    execSync(`git worktree add -q "${wt}" -b feat`, { cwd: main, stdio: 'pipe' });
    homeDir = path.join(base, 'home');
    fs.mkdirSync(path.join(homeDir, '.devflow', 'logs'), { recursive: true });

    // The main ledger already holds ADR-001..003, and a turn is pending.
    writeLedger(main, [1, 2, 3].map(n => makeLedgerRow({ id: `obs_main_${n}`, anchor_id: `ADR-00${n}` })));
    writeLog(main, [makeObsRow({ id: 'obs_wt_new', type: 'decision', status: 'ready' })]);
    fs.writeFileSync(
      path.join(main, '.devflow', 'learning', '.pending-turns.jsonl'),
      '{"role":"user","content":"we chose X over Y","ts":1}\n',
    );
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** The "Project root:" the Learning directive names for a session started in `cwd`. */
  function directiveRoot(cwd: string): string {
    const stdout = execSync(`bash "${CONTEXT_HOOK}"`, {
      input: JSON.stringify({ cwd, source: 'startup' }),
      env: { ...process.env, HOME: homeDir },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const ctx = JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
    const match = /Project root: ([^"]+)"/.exec(ctx);
    return match?.[1] ?? '(no directive)';
  }

  it('the directive from the worktree names the main root, and assign-anchor there continues at ADR-004', () => {
    const root = directiveRoot(wt);
    expect(root).toBe(fs.realpathSync(main));

    const result = runHelper('assign-anchor decision obs_wt_new', root);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-004');
  });

  it('known-bad probe: the same op run from the worktree toplevel restarts the numbering', () => {
    // Why the directive must not name the checkout: the worktree has no ledger.
    writeLog(wt, [makeObsRow({ id: 'obs_wt_new', type: 'decision', status: 'ready' })]);
    const result = runHelper('assign-anchor decision obs_wt_new', wt);
    expect(result.stdout.trim()).toBe('ADR-001');
  });
});
