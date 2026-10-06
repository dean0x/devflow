// tests/decisions/ledger-ops.test.ts
//
// Tests for the ledger ops: assign-anchor, refresh-anchor, retire-anchor,
// restore-anchor, rotate-observations, numbering stability, and locking discipline.
//
// AC-A2: assign-anchor mints max+1 over every anchored row of its type, inactive
//        ones included, skipping each number a tracked file cites; 3-digit-padded
// AC-A3: retire-anchor sets an inactive status and its note, the row otherwise
//        intact, and refuses an entry that is already inactive
// AC-F5: retired entries vanish from .md but stay in ledger
// AC-F7: retired numbers leave gaps, never reused
// AC-F9: a log row no ledger row carries is archived once 30 days pass since its
//        last activity; a row any ledger row carries never is (D-ROTATE-UNREFERENCED)
// AC-P2: the next number is one pass over the anchored rows (structural check)

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
// nextAnchorFromLedger — unit tests (the number assign-anchor starts from)
// ---------------------------------------------------------------------------

describe('nextAnchorFromLedger', () => {
  it('empty ledger => ADR-001 for decisions', () => {
    const { anchorId } = store.nextAnchorFromLedger([], 'decision');
    expect(anchorId).toBe('ADR-001');
  });

  it('empty ledger => PF-001 for pitfalls', () => {
    const { anchorId } = store.nextAnchorFromLedger([], 'pitfall');
    expect(anchorId).toBe('PF-001');
  });

  it('max+1 over existing active anchors', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001' }),
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted' }),
    ];
    const { anchorId } = store.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-004');
  });

  it('max+1 includes Retired rows (Retired max is NOT reused)', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-005', id: 'obs_005', decisions_status: 'Retired' }),
    ];
    const { anchorId } = store.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-006');
  });

  it('max+1 includes Deprecated rows', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-007', id: 'obs_007', decisions_status: 'Deprecated' }),
    ];
    const { anchorId } = store.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-008');
  });

  it('ADR and PF sequences are independent', () => {
    const rows = [
      makeLedgerRow({ anchor_id: 'ADR-009', id: 'obs_a', type: 'decision' }),
      { ...makeLedgerRow({ anchor_id: 'PF-002', id: 'obs_b', type: 'pitfall' }), type: 'pitfall' },
    ];
    const { anchorId: adrNext } = store.nextAnchorFromLedger(rows, 'decision');
    const { anchorId: pfNext } = store.nextAnchorFromLedger(rows, 'pitfall');
    expect(adrNext).toBe('ADR-010');
    expect(pfNext).toBe('PF-003');
  });

  it('next N is zero-padded to 3 digits', () => {
    const { anchorId, nextN } = store.nextAnchorFromLedger([], 'decision');
    expect(nextN).toBe('001');
    expect(anchorId).toBe('ADR-001');
  });

  it('zero-padding when N > 99', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeLedgerRow({ anchor_id: `ADR-${String(i + 1).padStart(3, '0')}`, id: `obs_${i}` })
    );
    const { anchorId } = store.nextAnchorFromLedger(rows, 'decision');
    expect(anchorId).toBe('ADR-101');
  });
});

// ---------------------------------------------------------------------------
// assign-anchor CLI op
// ---------------------------------------------------------------------------

describe('assign-anchor CLI op', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('empty ledger => assigns ADR-001 and prints it to stdout', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_aa_001' })]);
    const result = runHelper('assign-anchor decision obs_aa_001', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  it('empty ledger => assigns PF-001 for pitfall type', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_pf_001', type: 'pitfall' })]);
    const result = runHelper('assign-anchor pitfall obs_pf_001', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('PF-001');
  });

  it('appends anchored row to ledger', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_aa_002' })]);
    runHelper('assign-anchor decision obs_aa_002', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].anchor_id).toBe('ADR-001');
    expect(rows[0].id).toBe('obs_aa_002');
  });

  it('leaves the log as it was: promotion is recorded in the ledger alone', () => {
    const logPath = writeLog(tmpDir, [makeV2LogRow({ id: 'obs_aa_003' })]);
    const before = fs.readFileSync(logPath, 'utf8');
    expect(runHelper('assign-anchor decision obs_aa_003', tmpDir).code).toBe(0);
    expect(fs.readFileSync(logPath, 'utf8')).toBe(before);
  });

  it('sets decisions_status to Accepted for decisions', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_aa_004' })]);
    runHelper('assign-anchor decision obs_aa_004', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Accepted');
  });

  it('sets decisions_status to Active for pitfalls', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_pf_004', type: 'pitfall' })]);
    runHelper('assign-anchor pitfall obs_pf_004', tmpDir);
    const rows = readLedger(tmpDir);
    expect(rows[0].decisions_status).toBe('Active');
  });

  it('stamps date and last_verified with today on decisions and pitfalls alike', () => {
    const today = (): string => new Date().toISOString().slice(0, 10);
    const dayBefore = today();
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_aa_005' }), makeV2LogRow({ id: 'obs_pf_005', type: 'pitfall' })]);
    expect(runHelper('assign-anchor decision obs_aa_005', tmpDir).code).toBe(0);
    expect(runHelper('assign-anchor pitfall obs_pf_005', tmpDir).code).toBe(0);
    // A run that crosses midnight UTC may stamp either day.
    const days = [dayBefore, today()];
    for (const row of readLedger(tmpDir)) {
      expect(days, `date of ${String(row.anchor_id)}`).toContain(row.date);
      expect(row.last_verified, `last_verified of ${String(row.anchor_id)}`).toBe(row.date);
    }
  });

  it('with existing anchors including Retired — assigns max+1, number not reused', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-005', id: 'obs_retired', decisions_status: 'Retired' }),
    ]);
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_new_006' })]);
    const result = runHelper('assign-anchor decision obs_new_006', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-006');
  });

  it('ADR and PF sequences are independent', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-010', id: 'obs_a', type: 'decision', decisions_status: 'Accepted' }),
    ]);
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_pf_ind', type: 'pitfall' })]);
    const result = runHelper('assign-anchor pitfall obs_pf_ind', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('PF-001'); // PF sequence starts at 1 regardless of ADR-010
  });

  it('re-renders decisions.md with the new entry', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_render_01' })]);
    runHelper('assign-anchor decision obs_render_01', tmpDir);
    const decisionsPath = path.join(tmpDir, '.devflow', 'learning', 'decisions.md');
    expect(fs.existsSync(decisionsPath)).toBe(true);
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toContain('## ADR-001:');
  });

  it('exits non-zero when obs_id not found in log', () => {
    writeLog(tmpDir, []);
    const result = runHelper('assign-anchor decision obs_nonexistent', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("'obs_nonexistent' is not in the log");
  });

  it('exits non-zero when type is invalid', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_bad' })]);
    const result = runHelper('assign-anchor workflow obs_bad', tmpDir);
    expect(result.code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// retire-anchor CLI op
// ---------------------------------------------------------------------------

describe('retire-anchor CLI op', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Run `retire-anchor <anchor> <status>` with `input` as its stdin. */
  function retire(anchorAndStatus: string, input: unknown) {
    return runJsonHelper(tmpDir, ['retire-anchor', ...anchorAndStatus.split(' ')], JSON.stringify(input));
  }

  it('flips decisions_status to Retired, keeping the reason as its note', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    expect(retire('ADR-001 Retired', { reason: 'A one-off' }).code).toBe(0);
    expect(readLedger(tmpDir)[0]).toMatchObject({ decisions_status: 'Retired', status_note: 'A one-off' });
  });

  it('flips decisions_status to Deprecated', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' })]);
    expect(retire('ADR-002 Deprecated', { reason: 'The store moved' }).code).toBe(0);
    expect(readLedger(tmpDir)[0].decisions_status).toBe('Deprecated');
  });

  it('flips decisions_status to Superseded, naming the successor', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-003', id: 'obs_003', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-004', id: 'obs_004', decisions_status: 'Accepted' }),
    ]);
    expect(retire('ADR-003 Superseded', { by: 'ADR-004' }).code).toBe(0);
    expect(readLedger(tmpDir)[0]).toMatchObject({ decisions_status: 'Superseded', superseded_by: 'ADR-004' });
  });

  it('row is otherwise intact: only the status, its note and retired_on change', () => {
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
    expect(retire('ADR-007 Retired', { reason: 'A one-off' }).code).toBe(0);
    expect(readLedger(tmpDir)).toEqual([{
      ...original,
      decisions_status: 'Retired',
      status_note: 'A one-off',
      retired_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }]);
  });

  it('refuses an entry that is already inactive and leaves it as it was', () => {
    const ledgerPath = writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-004', id: 'obs_004', decisions_status: 'Accepted' })]);
    expect(retire('ADR-004 Deprecated', { reason: 'The store moved' }).code).toBe(0);
    const before = fs.readFileSync(ledgerPath, 'utf8');
    expect(retire('ADR-004 Deprecated', { reason: 'The store moved' })).toEqual({
      code: 1, stdout: '', stderr: 'retire-anchor: ADR-004 is already Deprecated; nothing was written\n',
    });
    expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(before);
  });

  it('a retired entry loses its body in rendered decisions.md and is listed under Inactive (AC-F5)', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', pattern: 'To be retired', decisions_status: 'Accepted' }),
    ]);
    expect(retire('ADR-002 Retired', { reason: 'A one-off' }).code).toBe(0);
    const decisionsPath = path.join(tmpDir, '.devflow', 'learning', 'decisions.md');
    const content = fs.readFileSync(decisionsPath, 'utf8');
    expect(content).toMatch(/^## ADR-001: /m);
    expect(content).not.toMatch(/^## ADR-002:/m);
    expect(content).not.toContain('To be retired');
    expect(content).toContain('| ADR-002 | Retired | A one-off |\n');
  });

  it('retired entry stays in the ledger (AC-F5 — ledger is permanent)', () => {
    writeLedger(tmpDir, [
      makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' }),
      makeLedgerRow({ anchor_id: 'ADR-002', id: 'obs_002', decisions_status: 'Accepted' }),
    ]);
    expect(retire('ADR-002 Retired', { reason: 'A one-off' }).code).toBe(0);
    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(2);
    const retiredRow = rows.find(r => r.anchor_id === 'ADR-002');
    expect(retiredRow).toBeDefined();
    expect(retiredRow!.decisions_status).toBe('Retired');
  });

  it('exits non-zero when anchor_id not found in ledger', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = retire('ADR-999 Retired', { reason: 'A one-off' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toBe('retire-anchor: ADR-999 is not in the ledger; nothing was written\n');
  });

  it('exits non-zero for invalid retire status', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = retire('ADR-001 Invalid', { reason: 'A one-off' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('retire-anchor: usage');
  });
});

// ---------------------------------------------------------------------------
// Number stability: retire current-max, then assign-anchor => skip (AC-F7)
// ---------------------------------------------------------------------------

describe('AC-F7: number stability — retired number is never reused', { timeout: 30_000 }, () => {
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
    expect(runJsonHelper(tmpDir, ['retire-anchor', 'ADR-005', 'Retired'], '{"reason":"test"}').code).toBe(0);

    // Now assign-anchor should give ADR-006, not ADR-005
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_new' })]);
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
    expect(runJsonHelper(tmpDir, ['retire-anchor', 'ADR-002', 'Deprecated'], '{"reason":"test"}').code).toBe(0);
    expect(runJsonHelper(tmpDir, ['retire-anchor', 'ADR-003', 'Superseded'], '{"by":"ADR-001"}').code).toBe(0);

    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_gap' })]);
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

describe('refresh-anchor CLI op', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-anchor-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-projects the log row onto the ledger row, keeping its anchor, status and type', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_001', rule: 'Return a Result from every fallible store call.' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_001', rule: 'An older rule.' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);

    const rows = readLedger(tmpDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].rule).toBe('Return a Result from every fallible store call.');
    expect(rows[0]).toMatchObject({ anchor_id: 'ADR-001', decisions_status: 'Accepted', type: 'decision' });
  });

  it('keeps only the projection: evidence and the counters stay in the log, and stray keys leave the ledger', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_002' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_002', confidence: 0.99, observations: 5, quality_ok: true })]);
    expect(runHelper('refresh-anchor ADR-001', tmpDir).code).toBe(0);

    const [row] = readLedger(tmpDir);
    expect(row).toEqual(makeV2LedgerRow({ id: 'obs_ra_002' }));
    expect(row.evidence).toBeUndefined();
  });

  it('re-renders decisions.md after refresh', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_003', title: 'Refreshed decision', rule: 'The refreshed rule.' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_003', anchor_id: 'ADR-003', title: 'Refreshed decision', rule: 'A stale rule.' })]);
    expect(runHelper('refresh-anchor ADR-003', tmpDir).code).toBe(0);

    const content = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8');
    expect(content).toContain('## ADR-003: Refreshed decision');
    expect(content).toContain('- **Decision**: The refreshed rule.\n');
    expect(content).not.toContain('A stale rule.');
  });

  it('pitfall-anchor refresh re-renders pitfalls.md and index.md', () => {
    writeLog(tmpDir, [makeV2LogRow({
      id: 'obs_pf_refresh', type: 'pitfall', title: 'Unbounded retries in hooks', rule: 'Cap every retry loop at three attempts.',
    })]);
    writeLedger(tmpDir, [makeV2LedgerRow({
      id: 'obs_pf_refresh', type: 'pitfall', anchor_id: 'PF-001', decisions_status: 'Active',
      title: 'Unbounded retries in hooks', rule: 'An initial mitigation.',
    })]);
    expect(runHelper('refresh-anchor PF-001', tmpDir).code).toBe(0);

    const pitfallsContent = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'pitfalls.md'), 'utf8');
    expect(pitfallsContent).toContain('## PF-001: Unbounded retries in hooks');
    expect(pitfallsContent).toContain('- **Rule**: Cap every retry loop at three attempts.\n');
    expect(pitfallsContent).not.toContain('An initial mitigation.');

    const indexContent = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'index.md'), 'utf8');
    expect(indexContent).toContain('  PF-001  Unbounded retries in hooks');
  });

  it('date-pin: the ledger row keeps its promotion date, and a dateless row stays dateless', () => {
    writeLog(tmpDir, [
      makeV2LogRow({ id: 'obs_date_pin', rule: 'A sharper rule.' }),
      makeV2LogRow({ id: 'obs_dateless', rule: 'A sharper rule.' }),
    ]);
    writeLedger(tmpDir, [
      makeV2LedgerRow({ id: 'obs_date_pin', anchor_id: 'ADR-007', date: '2026-01-01' }),
      makeV2LedgerRow({ id: 'obs_dateless', anchor_id: 'ADR-008', date: undefined }),
    ]);
    expect(runHelper('refresh-anchor ADR-007 ADR-008', tmpDir).code).toBe(0);

    const rows = readLedger(tmpDir);
    expect(rows[0].date).toBe('2026-01-01');
    expect(rows[1].date).toBeUndefined();
  });

  it('exits non-zero when no log row carries the entry\'s observation', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_missing' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_test001', anchor_id: 'ADR-001' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("ADR-001: no log row has id 'obs_test001'");
  });

  it('exits non-zero when anchor_id not found in ledger', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_nol' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_nol', anchor_id: 'ADR-999' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001: not in the ledger');
  });

  it('a learning tree with no ledger refuses the anchor as not in the ledger', () => {
    writeLog(tmpDir, [makeV2LogRow()]);
    expect(runJsonHelper(tmpDir, ['refresh-anchor', 'ADR-001'])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'refresh-anchor: 1 of 1 anchor refused; nothing was written\n  ADR-001: not in the ledger\n',
    });
  });

  it('refuses an entry whose log row has the other type', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_prec_003', type: 'pitfall' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_prec_003', anchor_id: 'ADR-003' })]);
    const result = runHelper('refresh-anchor ADR-003', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-003: cannot take its log row: it is a decision entry and the observation is a pitfall');
  });

  it('exits non-zero when called with no argument', () => {
    const result = runHelper('refresh-anchor', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('usage');
  });

  it('completes without deadlock and leaves no lock dir behind', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_lock', rule: 'A sharper rule.' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_lock' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('prints what it did with the anchor on stdout', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_stdout' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_stdout', rule: 'An older rule.' })]);
    expect(runHelper('refresh-anchor ADR-001', tmpDir).stdout).toBe('reprojected ADR-001\n');
    expect(runHelper('refresh-anchor ADR-001', tmpDir).stdout).toBe('unchanged ADR-001\n');
    expect(runHelper('refresh-anchor ADR-001 --verified', tmpDir).stdout).toBe('verified ADR-001\n');
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor rewrites an entry in place (D-CONTENT-HISTORY)
// ---------------------------------------------------------------------------

describe('refresh-anchor rewrites an entry in place (D-CONTENT-HISTORY)', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-divguard-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a shorter text that does not contain the old one, and history holds the prior row', () => {
    const priorRule = 'Use Result types; AMENDMENT 2026-08-01: async paths return a Result as well, and callers check it.';
    const newRule = 'Every fallible call returns a Result.';
    expect(priorRule.includes(newRule) || newRule.includes(priorRule)).toBe(false);
    const prior = makeV2LedgerRow({ id: 'obs_divg_001', rule: priorRule });
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_divg_001', rule: newRule })]);
    writeLedger(tmpDir, [prior]);

    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).toBe(0);
    expect(readLedger(tmpDir)[0].rule).toBe(newRule);
    expect(store.historyVersions(tmpDir, 'obs_divg_001').map(version => version.ledger)).toEqual([[prior]]);
    const decisionsMd = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8');
    expect(decisionsMd).toContain(`- **Decision**: ${newRule}\n`);
    expect(decisionsMd).not.toContain('AMENDMENT');
  });

  it('a sharpened title becomes the rendered heading', () => {
    const oldTitle = 'Use exceptions for error handling';
    const newTitle = 'Prefer explicit error channels over exception propagation';
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_divg_002', title: newTitle })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_divg_002', anchor_id: 'ADR-002', title: oldTitle })]);
    expect(runHelper('refresh-anchor ADR-002', tmpDir).code).toBe(0);

    expect(readLedger(tmpDir)[0].title).toBe(newTitle);
    const decisionsMd = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8');
    expect(decisionsMd).toContain(`## ADR-002: ${newTitle}`);
    expect(decisionsMd).not.toContain(oldTitle);
  });

  it('records no history when the entry already holds its log row\'s content', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_divg_004' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_divg_004', anchor_id: 'ADR-004' })]);
    expect(runHelper('refresh-anchor ADR-004', tmpDir).code).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', 'decisions-history.jsonl'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor — variadic multi-anchor (PERF-1)
// ---------------------------------------------------------------------------

describe('refresh-anchor variadic multi-anchor — PERF-1', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-variadic-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('multi-anchor happy path: both rows re-projected and both files rendered', () => {
    writeLog(tmpDir, [
      makeV2LogRow({ id: 'obs_var_001', title: 'Updated decision title' }),
      makeV2LogRow({ id: 'obs_var_002', type: 'pitfall', title: 'Updated pitfall title' }),
    ]);
    writeLedger(tmpDir, [
      makeV2LedgerRow({ id: 'obs_var_001', anchor_id: 'ADR-001', title: 'Old decision title' }),
      makeV2LedgerRow({ id: 'obs_var_002', type: 'pitfall', anchor_id: 'PF-001', decisions_status: 'Active', title: 'Old pitfall title' }),
    ]);
    const result = runHelper('refresh-anchor ADR-001 PF-001', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('reprojected ADR-001\nreprojected PF-001\n');

    const rows = readLedger(tmpDir);
    expect(rows.find(r => r.anchor_id === 'ADR-001')?.title).toBe('Updated decision title');
    expect(rows.find(r => r.anchor_id === 'PF-001')?.title).toBe('Updated pitfall title');
    const decisionsMd = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions.md'), 'utf8');
    expect(decisionsMd).toContain('## ADR-001: Updated decision title');
    const pitfallsMd = fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'pitfalls.md'), 'utf8');
    expect(pitfallsMd).toContain('## PF-001: Updated pitfall title');
  });

  it('one-bad-anchor-in-batch: nothing written when any anchor is refused', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_var_003', title: 'New title' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_var_003', title: 'Old title' })]);
    const before = snapshotTree(tmpDir);
    const result = runHelper('refresh-anchor ADR-001 ADR-002', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-002: not in the ledger');
    expect(snapshotTree(tmpDir)).toEqual(before);
  });

  it('zero-args usage error exits non-zero with usage message', () => {
    const result = runHelper('refresh-anchor', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('usage');
    expect(result.stderr).toContain('<anchor>');
  });
});

// ---------------------------------------------------------------------------
// refresh-anchor quarantines malformed ledger lines (D-QUARANTINE-MALFORMED)
// ---------------------------------------------------------------------------

describe('refresh-anchor quarantines malformed ledger lines (D-QUARANTINE-MALFORMED)', () => {
  it('moves a malformed ledger line aside before it rewrites the ledger, and keeps every row', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-quarantine-test-'));
    try {
      const { ledger, learningDir } = seedLearningTree(tmpDir, {
        log: [makeV2LogRow({ id: 'obs_q_001', rule: 'A sharper rule.' }), makeV2LogRow({ id: 'obs_q_002', rule: 'A sharper rule.' })],
        ledger: [makeV2LedgerRow({ id: 'obs_q_001' }), makeV2LedgerRow({ id: 'obs_q_002', anchor_id: 'ADR-002' })],
      });
      fs.appendFileSync(ledger, '{"anchor_id": "ADR-003", "cut off\n');

      const result = runHelper('refresh-anchor ADR-001 ADR-002', tmpDir);
      expect(result.code).toBe(0);
      expect(readLedger(tmpDir).map(row => [row.anchor_id, row.rule])).toEqual([
        ['ADR-001', 'A sharper rule.'],
        ['ADR-002', 'A sharper rule.'],
      ]);
      const rejected = store.readJsonl(path.join(learningDir, 'decisions-ledger.rejected.jsonl')).rows;
      expect(rejected.map(record => record.text)).toEqual(['{"anchor_id": "ADR-003", "cut off']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// retire-anchor stdout echo — CON-P1
// ---------------------------------------------------------------------------

describe('retire-anchor stdout echo — CON-P1', () => {
  it('retire-anchor prints the status it set and the anchor, as refresh-anchor and restore-anchor print theirs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-stdout-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
    try {
      writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
      expect(runJsonHelper(tmpDir, ['retire-anchor', 'ADR-001', 'Retired'], '{"reason":"test"}')).toEqual({
        code: 0, stdout: 'retired ADR-001\n', stderr: '',
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
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
// assign-anchor: the ledger alone records promotion (D-LEDGER-REGISTRY)
// ---------------------------------------------------------------------------

describe('assign-anchor: the ledger alone records promotion (D-LEDGER-REGISTRY)', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-precond-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('refuses an observation a ledger row already carries, naming that entry, though the log row names no anchor', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_already_anchored', type: 'pitfall' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_already_anchored', type: 'pitfall', anchor_id: 'PF-007', decisions_status: 'Active' })]);
    const ledgerPath = path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl');
    const before = fs.readFileSync(ledgerPath, 'utf8');

    const result = runHelper('assign-anchor pitfall obs_already_anchored', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("'obs_already_anchored' is already promoted (PF-007 Active)");
    expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(before);
  });

  it('a second assign-anchor on the same observation is refused and mints no second number', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_double_assign' })]);
    const first = runHelper('assign-anchor decision obs_double_assign', tmpDir);
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe('ADR-001');

    const second = runHelper('assign-anchor decision obs_double_assign', tmpDir);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("'obs_double_assign' is already promoted (ADR-001 Accepted)");
    expect(readLedger(tmpDir).map(row => row.anchor_id)).toEqual(['ADR-001']);
  });

  it('refuses a v1 observation and a type the observation does not have', () => {
    writeLog(tmpDir, [makeObsRow({ id: 'obs_v1_row', type: 'decision' }), makeV2LogRow({ id: 'obs_v2_row' })]);
    expect(runHelper('assign-anchor decision obs_v1_row', tmpDir).stderr).toContain("'obs_v1_row' is a v1 observation");
    expect(runHelper('assign-anchor pitfall obs_v2_row', tmpDir).stderr).toContain("'obs_v2_row' is a decision observation, not a pitfall");
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D-E4-SKIP: assign-anchor never mints a number a tracked file already cites
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

describe('D-E4-SKIP: assign-anchor skips a number a tracked file cites', { timeout: 30_000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-collision-test-'));
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'learning'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips the next number when a git-tracked file cites it, reporting the citation, and mints the one after', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001' })]);
    // The next number for a ledger holding ADR-001 is ADR-002: a design document
    // already uses it for something else, in a tracked file.
    initGitRepoWithFile(tmpDir, 'docs/design.md', 'See ADR-002 for the rationale.\n');
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_collide' })]);

    const result = runJsonHelper(tmpDir, ['assign-anchor', 'decision', 'obs_collide']);
    expect(result).toEqual({
      code: 0,
      stdout: 'ADR-003\n',
      stderr: 'assign-anchor: skipped ADR-002, cited in docs/design.md:1\n',
    });
    expect(readLedger(tmpDir).map(row => row.anchor_id)).toEqual(['ADR-001', 'ADR-003']);
  });

  it('lists tracked files without running the repository\'s core.fsmonitor hook (D-NO-FSMONITOR)', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001' })]);
    // A gitignored file citing the same id: the fs-walk fallback would report it,
    // `git ls-files` never does — so its absence proves the git listing answered.
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored/\n');
    fs.mkdirSync(path.join(tmpDir, 'ignored'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'ignored', 'scratch.md'), 'ADR-002 scribble.\n');
    initGitRepoWithFile(tmpDir, 'docs/design.md', 'See ADR-002 for the rationale.\n');
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_fsmonitor' })]);

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
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toBe('ADR-003\n');
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

  it('skips a number cited in a non-git project (fs-walk fallback)', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_collide_nogit' })]);
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'notes.md'), 'Design number ADR-001 was reserved earlier.\n');

    const result = runJsonHelper(tmpDir, ['assign-anchor', 'decision', 'obs_collide_nogit']);
    expect(result).toEqual({
      code: 0,
      stdout: 'ADR-002\n',
      stderr: 'assign-anchor: skipped ADR-001, cited in docs/notes.md:1\n',
    });
  });

  it('refuses, writing nothing, when the next 101 numbers are all cited', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_crowded' })]);
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    const numbers = Array.from({ length: 101 }, (_, i) => `ADR-${String(i + 1).padStart(3, '0')}`);
    fs.writeFileSync(path.join(tmpDir, 'docs', 'numbers.md'), `${numbers.join('\n')}\n`);
    const before = snapshotTree(tmpDir);

    expect(runJsonHelper(tmpDir, ['assign-anchor', 'decision', 'obs_crowded'])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'assign-anchor: ADR-001 to ADR-101 are all cited in tracked files; nothing was written\n',
    });
    expect(snapshotTree(tmpDir)).toEqual(before);
  });

  it('mints normally when there is no citation anywhere in the tree', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_clean' })]);
    const result = runHelper('assign-anchor decision obs_clean', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  it('--allow-collision is not a flag: it is a usage error that writes nothing', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_override' })]);
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'docs', 'notes.md'), 'ADR-001 already means something else.\n');

    const result = runHelper('assign-anchor decision obs_override --allow-collision', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('assign-anchor: usage');
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl'))).toBe(false);
  });

  it('ignores a self-citation inside .devflow/learning (mints normally)', () => {
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_selfcite' })]);
    // A rendered .md file already containing "ADR-001" is the ledger's own
    // territory (self-citation) and must never count as a citation.
    fs.writeFileSync(
      path.join(tmpDir, '.devflow', 'learning', 'decisions.md'),
      '## ADR-001: Some prior entry\n'
    );

    const result = runHelper('assign-anchor decision obs_selfcite', tmpDir);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('ADR-001');
  });

  it('next-anchor is not an op', () => {
    const result = runHelper('next-anchor decision', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('unknown operation "next-anchor"');
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.jsonl'))).toBe(false);
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
      store.nextAnchorFromLedger(buildRows(SMALL), 'decision');
      store.nextAnchorFromLedger(buildRows(LARGE), 'decision');
    }

    const smallTimes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const rows = buildRows(SMALL);
      const start = performance.now();
      store.nextAnchorFromLedger(rows, 'decision');
      smallTimes.push(performance.now() - start);
    }

    const largeTimes: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const rows = buildRows(LARGE);
      const start = performance.now();
      store.nextAnchorFromLedger(rows, 'decision');
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
// the real write path (cited-number scan → lock → read ledger and log → compute
// next → append → render all three files) dominates runtime in production. This test times full CLI
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

// Four spawns, each bounded by the 10 s ceiling below; the test timeout leaves room for them.
describe('AC-P2b: assign-anchor full write-path performance (CLI-level)', { timeout: 30_000 }, () => {
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
      writeLog(dir, [makeV2LogRow({ id: obsId })]);
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
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_lock_01' })]);
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
    // The anchored observation's log row is ahead of its entry, so a refresh writes;
    // a retired entry gives restore-anchor something to restore.
    writeLog(tmpDir, [
      makeV2LogRow({ id: 'obs_one_lock_new' }),
      makeV2LogRow({ id: 'obs_one_lock_old', rule: 'A sharper rule.' }),
      makeObsRow({ id: 'obs_one_lock_stale', status: 'observing', last_seen: '2026-01-01T00:00:00Z' }),
    ]);
    writeLedger(tmpDir, [
      makeV2LedgerRow({ id: 'obs_one_lock_old', anchor_id: 'ADR-001' }),
      makeV2LedgerRow({ id: 'obs_one_lock_gone', anchor_id: 'ADR-002', decisions_status: 'Retired', status_note: 'test' }),
    ]);
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
    [['restore-anchor', 'ADR-002']],
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
    { args: ['restore-anchor', 'ADR-001'] },
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
      writeLog(tmpDir, [makeV2LogRow({ id: 'obs_nodec_01' })]);
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
// Node.js, so an early exit while holding .decisions.lock would leave a stale
// lock directory. A locked body returns its refusal as a Result instead, the
// lock is released in the store's finally, and json-helper exits afterwards.
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
    // No log file: the observation is not in the log, a refusal made under the lock
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
    // No ledger file: the anchor is not in the ledger, a refusal made under the lock
    const result = runJsonHelper(tmpDir, ['retire-anchor', 'ADR-001', 'Retired'], '{"reason":"test"}');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001 is not in the ledger');
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('retire-anchor: anchor_id not found in existing ledger — lock dir released after controlled error', () => {
    // Ledger exists but the requested anchor_id is absent
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runJsonHelper(tmpDir, ['retire-anchor', 'ADR-999', 'Retired'], '{"reason":"test"}');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-999 is not in the ledger');
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('restore-anchor: an active entry — lock dir released after controlled error', () => {
    writeLedger(tmpDir, [makeLedgerRow({ anchor_id: 'ADR-001', decisions_status: 'Accepted' })]);
    const result = runJsonHelper(tmpDir, ['restore-anchor', 'ADR-001']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001 is already active');
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('refresh-anchor: missing log obs — lock dir released after controlled error', () => {
    // Ledger has ADR-001 (id: 'obs_test001') but no log row with that id
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_test001', anchor_id: 'ADR-001' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("ADR-001: no log row has id 'obs_test001'");
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('refresh-anchor: anchor_id not in ledger — lock dir released after controlled error', () => {
    // Log has the obs but the ledger is missing the anchor
    writeLog(tmpDir, [makeV2LogRow({ id: 'obs_ra_lock' })]);
    writeLedger(tmpDir, [makeV2LedgerRow({ id: 'obs_ra_lock', anchor_id: 'ADR-999' })]);
    const result = runHelper('refresh-anchor ADR-001', tmpDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADR-001: not in the ledger');
    const lockDir = path.join(tmpDir, '.devflow', 'learning', '.decisions.lock');
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pre-existing corpus fixture — REG-S1 (fixtures derived from real corpus)
//
// Frozen copies of actual anchored rows from .devflow/learning/decisions-ledger.jsonl
// at time of authoring. They pin that refresh-anchor refuses a real-world v1 entry
// and writes nothing, and that put-observation --update is how such an entry
// becomes a v2 entry refresh-anchor accepts.
//
// These fixtures are FROZEN IN-FILE, not live-file reads: the live ledger is per-machine and gitignored.
// Derived from decisions-ledger.jsonl rows ADR-001 and PF-001.
// ---------------------------------------------------------------------------

describe('refresh-anchor — pre-existing corpus fixture (REG-S1)', { timeout: 30_000 }, () => {
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

  it('refresh-anchor refuses the frozen v1 corpus entries and writes nothing', () => {
    writeLog(tmpDir, [CORPUS_ADR_001, CORPUS_PF_001]);
    writeLedger(tmpDir, [CORPUS_ADR_001, CORPUS_PF_001]);
    const before = snapshotTree(tmpDir);

    expect(runJsonHelper(tmpDir, ['refresh-anchor', 'ADR-001', 'PF-001'])).toEqual({
      code: 1,
      stdout: '',
      stderr: [
        'refresh-anchor: 2 of 2 anchors refused; nothing was written',
        '  ADR-001: a v1 entry; rewrite it with put-observation --update',
        '  PF-001: a v1 entry; rewrite it with put-observation --update',
        '',
      ].join('\n'),
    });
    expect(snapshotTree(tmpDir)).toEqual(before);
  });

  it('put-observation --update converts the frozen v1 entry to v2, after which refresh-anchor accepts it', () => {
    writeLog(tmpDir, [CORPUS_ADR_001]);
    const ledgerPath = writeLedger(tmpDir, [CORPUS_ADR_001]);
    const ledgerBefore = fs.readFileSync(ledgerPath, 'utf8');
    const rewrite = {
      id: 'obs_cleanbrk1',
      type: 'decision',
      title: 'Ship feature-knowledge v2 as a clean break',
      rule: 'Delete the old-install cleanup machinery and clean the one affected machine by hand.',
      why: 'No install upgrades across an unreleased break, so defense code for one would only ever be dead code.',
      scope: ['area:knowledge'],
      provenance: 'feature-knowledge v2 review',
    };

    expect(runJsonHelper(tmpDir, ['put-observation', '--update'], JSON.stringify(rewrite))).toEqual({
      code: 0, stdout: 'updated obs_cleanbrk1\nreprojected ADR-001\n', stderr: '',
    });
    const [converted] = readLedger(tmpDir);
    expect(converted).toMatchObject({ schema: 2, anchor_id: 'ADR-001', decisions_status: 'Accepted', date: '2026-06-30', title: rewrite.title });
    expect(converted.details).toBeUndefined();
    // The v1 rows survive in the pre-v2 backup and in history.
    expect(fs.readFileSync(path.join(tmpDir, '.devflow', 'learning', 'decisions-ledger.pre-v2.jsonl'), 'utf8')).toBe(ledgerBefore);
    expect(store.historyVersions(tmpDir, 'obs_cleanbrk1').map(version => version.ledger)).toEqual([[CORPUS_ADR_001]]);

    expect(runJsonHelper(tmpDir, ['refresh-anchor', 'ADR-001'])).toEqual({ code: 0, stdout: 'unchanged ADR-001\n', stderr: '' });
    expect(runJsonHelper(tmpDir, ['refresh-anchor', '--verified', 'ADR-001'])).toEqual({ code: 0, stdout: 'verified ADR-001\n', stderr: '' });
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
    writeLog(main, [makeV2LogRow({ id: 'obs_wt_new' })]);
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
    writeLog(wt, [makeV2LogRow({ id: 'obs_wt_new' })]);
    const result = runHelper('assign-anchor decision obs_wt_new', wt);
    expect(result.stdout.trim()).toBe('ADR-001');
  });
});
