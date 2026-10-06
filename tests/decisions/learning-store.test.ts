// tests/decisions/learning-store.test.ts
//
// Tests for src/assets/scripts/hooks/lib/learning-store.cjs — the v2 learning
// store: frozen constants, the one status list (and its TypeScript mirror),
// strict JSONL reads with quarantine, the atomic writers, the lock wrapper,
// observation validation, the ledger projection, content history, the pre-v2
// backup, and the read-only listing, due-selection and show helpers.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';

import {
  DECISIONS_ENTRY_STATUSES,
  INACTIVE_DECISIONS_STATUSES,
  isActiveDecisionsStatus,
} from '../../src/core/observations.js';
import {
  FIXTURE_NOW,
  GIT_ENV,
  daysAgoDate,
  daysAgoIso,
  git,
  initGitRepo,
  learningPaths,
  makeV1LedgerRow,
  makeV1LogRow,
  makeV2LedgerRow,
  makeV2LogRow,
  requireLearningStore,
  runJsonHelper,
  seedLearningTree,
  snapshotTree,
  toJsonl,
  type Row,
  type ValidationResult,
} from './learning-fixtures.js';

const store = requireLearningStore();

const HOUR_MS = 60 * 60 * 1000;

function makeTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('frozen constants', () => {
  it('pin the schema version, the field limits and the due parameters', () => {
    expect(store.SCHEMA_VERSION).toBe(2);
    expect(store.FIELD_LIMITS).toEqual({
      title: 120, rule: 400, why: 300, provenance: 120,
      scopeMin: 1, scopeMax: 5, scopeEntry: 200,
      evidenceMax: 5, evidenceItem: 300,
      note: 120, quoteMin: 12, quoteMax: 200, path: 300,
    });
    expect(store.DUE).toEqual({ verifyAgeDays: 30, leaseHours: 24, maxEntries: 5, byteBudget: 61440 });
    expect(store.HISTORY_DEPTH).toBe(3);
    expect(store.LOCK_ACQUIRE_TIMEOUT_MS).toBe(30000);
    expect(store.LOCK_STALE_MS).toBe(60000);
  });

  it('pin the status lists and the key ownership lists', () => {
    expect(store.ACTIVE_STATUSES).toEqual(['Accepted', 'Active']);
    expect(store.INACTIVE_STATUSES).toEqual(['Encoded', 'Superseded', 'Retired', 'Deprecated']);
    expect(store.ENTRY_STATUSES).toEqual(['Accepted', 'Active', 'Encoded', 'Superseded', 'Retired', 'Deprecated']);
    expect(store.CONTENT_KEYS).toEqual(['type', 'title', 'rule', 'why', 'scope', 'provenance', 'evidence']);
    expect(store.PLUMBING_OWNED_KEYS).toEqual(['schema', 'observations', 'first_seen', 'last_seen', 'status', 'anchor_id']);
    expect(store.LEDGER_OWNED_KEYS).toEqual([
      'date', 'last_verified', 'last_attempt', 'status_note', 'superseded_by', 'encoded_at', 'retired_on',
    ]);
  });

  it('are frozen, so no caller can widen a list or a limit', () => {
    for (const value of [
      store.FIELD_LIMITS, store.ACTIVE_STATUSES, store.INACTIVE_STATUSES, store.ENTRY_STATUSES,
      store.CONTENT_KEYS, store.PLUMBING_OWNED_KEYS, store.LEDGER_OWNED_KEYS, store.DUE,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it('shape-gate anchors and observation ids', () => {
    expect(store.ANCHOR_ID_RE.test('ADR-001')).toBe(true);
    expect(store.ANCHOR_ID_RE.test('PF-1234')).toBe(true);
    expect(store.ANCHOR_ID_RE.test('PF-12')).toBe(false);
    expect(store.ANCHOR_ID_RE.test('PROJ-123')).toBe(false);
    expect(store.OBS_ID_RE.test('obs_abc')).toBe(true);
    expect(store.OBS_ID_RE.test('obs_ab')).toBe(false);
    expect(store.OBS_ID_RE.test('obs_' + 'a'.repeat(61))).toBe(false);
    expect(store.OBS_ID_RE.test('obs_Upper')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Status helpers and the shared status list
// ---------------------------------------------------------------------------

describe('status helpers', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['Accepted', true],
    ['Active', true],
    ['SomeFutureStatus', true],
    ['Encoded', false],
    ['Superseded', false],
    ['Retired', false],
    ['Deprecated', false],
  ])('isActive treats decisions_status=%s as active=%s', (status, active) => {
    const row: Row = { anchor_id: 'ADR-001' };
    if (status !== undefined) row.decisions_status = status;
    expect(store.isActive(row)).toBe(active);
  });

  it('activeStatusFor gives Accepted to decisions and Active to pitfalls', () => {
    expect(store.activeStatusFor('decision')).toBe('Accepted');
    expect(store.activeStatusFor('pitfall')).toBe('Active');
  });

  it('activeStatusFor refuses a type that is neither', () => {
    expect(() => store.activeStatusFor('workflow')).toThrow(/decision.*pitfall/);
  });

  it('isV2 is true only for schema 2 rows', () => {
    expect(store.isV2(makeV2LogRow())).toBe(true);
    expect(store.isV2(makeV2LedgerRow())).toBe(true);
    expect(store.isV2(makeV1LogRow())).toBe(false);
    expect(store.isV2({ schema: '2' })).toBe(false);
    expect(store.isV2(null)).toBe(false);
  });
});

describe('the status list is one list across the hooks and TypeScript', () => {
  it('the store and core/observations hold equal entry and inactive status sets', () => {
    expect([...store.ENTRY_STATUSES].sort()).toEqual([...DECISIONS_ENTRY_STATUSES].sort());
    expect([...store.INACTIVE_STATUSES].sort()).toEqual([...INACTIVE_DECISIONS_STATUSES].sort());
  });

  it('Encoded is inactive in both', () => {
    expect(store.isActive({ decisions_status: 'Encoded' })).toBe(false);
    expect(isActiveDecisionsStatus('Encoded')).toBe(false);
  });

  it.each([undefined, '', ...DECISIONS_ENTRY_STATUSES, 'SomeFutureStatus'])(
    'both agree on decisions_status=%s',
    (status) => {
      const row: Row = status === undefined ? {} : { decisions_status: status };
      expect(isActiveDecisionsStatus(status)).toBe(store.isActive(row));
    },
  );
});

// ---------------------------------------------------------------------------
// JSONL I/O
// ---------------------------------------------------------------------------

describe('readJsonl (D-QUARANTINE-MALFORMED)', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-jsonl-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('reports a missing file as missing with no rows', () => {
    expect(store.readJsonl(path.join(tmp, 'absent.jsonl'))).toEqual({ rows: [], rejected: [], missing: true });
  });

  it('returns object rows and every other non-blank line as rejected, with its 1-based line number', () => {
    const file = path.join(tmp, 'decisions-log.jsonl');
    fs.writeFileSync(file, '{"a":1}\nnot json\n\n[1,2]\nnull\n"text"\n{"b":2}');
    const result = store.readJsonl(file);
    expect(result.missing).toBe(false);
    expect(result.rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(result.rejected).toEqual([
      { line: 2, text: 'not json' },
      { line: 4, text: '[1,2]' },
      { line: 5, text: 'null' },
      { line: 6, text: '"text"' },
    ]);
  });

  it('parses a CRLF line', () => {
    const file = path.join(tmp, 'crlf.jsonl');
    fs.writeFileSync(file, '{"a":1}\r\n{"b":2}\r\n');
    expect(store.readJsonl(file).rows).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('throws on a read error other than a missing file', () => {
    expect(() => store.readJsonl(tmp)).toThrow();
  });

  it('refuses a path with a NUL byte', () => {
    expect(() => store.readJsonl(path.join(tmp, 'a\0b.jsonl'))).toThrow(/null byte/);
  });
});

describe('rejectedPathFor', () => {
  it('names the sibling .rejected.jsonl of each learning file', () => {
    const p = learningPaths('/repo');
    expect(store.rejectedPathFor(p.log)).toBe('/repo/.devflow/learning/decisions-log.rejected.jsonl');
    expect(store.rejectedPathFor(p.ledger)).toBe('/repo/.devflow/learning/decisions-ledger.rejected.jsonl');
    expect(store.rejectedPathFor(p.archive)).toBe('/repo/.devflow/learning/decisions-log.archive.rejected.jsonl');
    expect(store.rejectedPathFor(p.history)).toBe('/repo/.devflow/learning/decisions-history.rejected.jsonl');
  });
});

describe('quarantine', () => {
  let tmp: string;
  let file: string;
  beforeEach(() => {
    tmp = makeTmp('learning-store-quarantine-');
    file = path.join(tmp, 'decisions-log.jsonl');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('quarantineRejected appends one record per rejected line and returns the count', () => {
    const n = store.quarantineRejected(file, [{ line: 3, text: 'oops' }, { line: 7, text: '{' }], { now: FIXTURE_NOW });
    expect(n).toBe(2);
    const records = store.readJsonl(store.rejectedPathFor(file)).rows;
    expect(records).toEqual([
      { rejected_at: '2026-10-03T12:00:00.000Z', source: 'decisions-log.jsonl', line: 3, text: 'oops' },
      { rejected_at: '2026-10-03T12:00:00.000Z', source: 'decisions-log.jsonl', line: 7, text: '{' },
    ]);
  });

  it('quarantineRejected only ever appends', () => {
    store.quarantineRejected(file, [{ line: 1, text: 'first' }], { now: FIXTURE_NOW });
    store.quarantineRejected(file, [{ line: 1, text: 'second' }], { now: FIXTURE_NOW });
    const texts = store.readJsonl(store.rejectedPathFor(file)).rows.map(r => r.text);
    expect(texts).toEqual(['first', 'second']);
  });

  it('quarantineRejected writes nothing when nothing was rejected', () => {
    expect(store.quarantineRejected(file, [], { now: FIXTURE_NOW })).toBe(0);
    expect(fs.existsSync(store.rejectedPathFor(file))).toBe(false);
  });

  it('readJsonlForWrite quarantines the malformed lines and returns only the rows', () => {
    fs.writeFileSync(file, '{"id":"obs_one"}\n{broken\n{"id":"obs_two"}\n');
    const rows = store.readJsonlForWrite(file, { now: FIXTURE_NOW });
    expect(rows).toEqual([{ id: 'obs_one' }, { id: 'obs_two' }]);
    const records = store.readJsonl(store.rejectedPathFor(file)).rows;
    expect(records).toEqual([
      { rejected_at: '2026-10-03T12:00:00.000Z', source: 'decisions-log.jsonl', line: 2, text: '{broken' },
    ]);
  });

  it('readJsonlForWrite creates no rejected file for a clean file', () => {
    fs.writeFileSync(file, '{"id":"obs_one"}\n');
    expect(store.readJsonlForWrite(file, { now: FIXTURE_NOW })).toEqual([{ id: 'obs_one' }]);
    expect(fs.existsSync(store.rejectedPathFor(file))).toBe(false);
  });

  it('quarantine does not follow a symlink planted at the rejected path', () => {
    const sentinel = path.join(tmp, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'untouched');
    fs.symlinkSync(sentinel, store.rejectedPathFor(file));
    expect(() => store.quarantineRejected(file, [{ line: 1, text: 'x' }], { now: FIXTURE_NOW })).toThrow();
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('untouched');
  });
});

describe('atomic writers', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-writers-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('writeFileAtomic writes and overwrites the target and leaves no temp file', () => {
    const target = path.join(tmp, 'out.txt');
    store.writeFileAtomic(target, 'one');
    store.writeFileAtomic(target, 'two');
    expect(fs.readFileSync(target, 'utf8')).toBe('two');
    expect(fs.readdirSync(tmp)).toEqual(['out.txt']);
  });

  it('writeFileAtomic does not follow a symlink planted at its PID-scoped temp path', () => {
    const target = path.join(tmp, 'target.jsonl');
    const sentinel = path.join(tmp, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'original');
    fs.symlinkSync(sentinel, `${target}.tmp.${process.pid}`);
    store.writeFileAtomic(target, 'written');
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('original');
    expect(fs.readFileSync(target, 'utf8')).toBe('written');
  });

  it('writeExclusive replaces a stale temp file once', () => {
    const tmpFile = path.join(tmp, 'x.tmp');
    fs.writeFileSync(tmpFile, 'stale');
    store.writeExclusive(tmpFile, 'fresh');
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe('fresh');
  });

  it('writeJsonlAtomic writes one row per line with a trailing newline, and empty for no rows', () => {
    const target = path.join(tmp, 'rows.jsonl');
    store.writeJsonlAtomic(target, [{ a: 1 }, { b: 'x' }]);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"a":1}\n{"b":"x"}\n');
    store.writeJsonlAtomic(target, []);
    expect(fs.readFileSync(target, 'utf8')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

describe('hasLearningDir', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-hasdir-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('is true only when .devflow/learning is a directory', () => {
    expect(store.hasLearningDir(tmp)).toBe(false);
    fs.mkdirSync(path.join(tmp, '.devflow'));
    fs.writeFileSync(path.join(tmp, '.devflow', 'learning'), 'a file, not a directory');
    expect(store.hasLearningDir(tmp)).toBe(false);
    fs.rmSync(path.join(tmp, '.devflow', 'learning'));
    fs.mkdirSync(path.join(tmp, '.devflow', 'learning'));
    expect(store.hasLearningDir(tmp)).toBe(true);
  });
});

describe('withDecisionsLock (D-ONE-LEARNING-LOCK, D-NO-STRAY-TREE)', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-lock-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('refuses with no-learning-dir and creates nothing in a bare directory', () => {
    let ran = false;
    const result = store.withDecisionsLock('put-observation', tmp, () => { ran = true; return { ok: true, value: 1 }; });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'no-learning-dir',
        message: `put-observation: no .devflow/learning/ under ${tmp} — run from the project root`,
      },
    });
    expect(ran).toBe(false);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('creates nothing under an existing .devflow that has no learning directory', () => {
    fs.mkdirSync(path.join(tmp, '.devflow'));
    const result = store.withDecisionsLock('list', tmp, () => ({ ok: true, value: 1 }));
    expect(result.ok).toBe(false);
    expect(fs.readdirSync(path.join(tmp, '.devflow'))).toEqual([]);
  });

  it('reports busy when another holder keeps the lock, and leaves that lock in place', () => {
    const { lockDir } = seedLearningTree(tmp);
    fs.mkdirSync(lockDir);
    let ran = false;
    const result = store.withDecisionsLock('claim-due', tmp, () => { ran = true; return { ok: true, value: 1 }; }, { timeoutMs: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('busy');
      expect(result.error.message).toBe(`claim-due: timeout acquiring lock at ${lockDir}`);
    }
    expect(ran).toBe(false);
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it('runs fn while holding the lock and returns its Result unchanged', () => {
    const { lockDir } = seedLearningTree(tmp);
    const value = { written: true };
    const result = store.withDecisionsLock('list', tmp, () => {
      expect(fs.existsSync(lockDir)).toBe(true);
      return { ok: true, value };
    });
    expect(result).toEqual({ ok: true, value });
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('passes an error Result from fn through and releases the lock', () => {
    const { lockDir } = seedLearningTree(tmp);
    const failure = { ok: false as const, error: { kind: 'not-found', message: 'show: no such entry' } };
    expect(store.withDecisionsLock('show', tmp, () => failure)).toEqual(failure);
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it('releases the lock when fn throws, and the throw reaches the caller', () => {
    const { lockDir } = seedLearningTree(tmp);
    expect(() => store.withDecisionsLock('refresh-anchor', tmp, () => { throw new Error('boom'); })).toThrow('boom');
    expect(fs.existsSync(lockDir)).toBe(false);
    expect(store.withDecisionsLock('refresh-anchor', tmp, () => ({ ok: true, value: 'again' }))).toEqual({ ok: true, value: 'again' });
  });

  it('rejects a fn that returns something other than a Result, and still releases the lock', () => {
    const { lockDir } = seedLearningTree(tmp);
    const notAResult = (() => 42) as unknown as () => { ok: true; value: number };
    expect(() => store.withDecisionsLock('list', tmp, notAResult)).toThrow(/Result/);
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reading state and the ledger registry
// ---------------------------------------------------------------------------

describe('readLearningState', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-state-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns both files\' rows and their malformed lines, and writes nothing', () => {
    const paths = seedLearningTree(tmp, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    fs.appendFileSync(paths.ledger, '{not a row\n');
    const before = snapshotTree(tmp);

    const state = store.readLearningState(tmp);

    expect(state.ledgerRows).toEqual([makeV2LedgerRow()]);
    expect(state.logRows).toEqual([makeV2LogRow()]);
    expect(state.rejected).toEqual({ ledger: [{ line: 2, text: '{not a row' }], log: [] });
    expect(snapshotTree(tmp)).toEqual(before);
  });

  it('reads an absent tree as empty without creating it', () => {
    expect(store.readLearningState(tmp)).toEqual({ ledgerRows: [], logRows: [], rejected: { ledger: [], log: [] } });
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});

describe('ledgerRegistry (D-LEDGER-REGISTRY)', () => {
  it('maps each anchor to its row and each observation id to every ledger row carrying it', () => {
    const adr = makeV2LedgerRow({ anchor_id: 'ADR-001', id: 'obs_alpha' });
    const older = makeV1LedgerRow({ anchor_id: 'PF-001', id: 'obs_shared' });
    const newer = makeV1LedgerRow({ anchor_id: 'PF-002', id: 'obs_shared', decisions_status: 'Retired' });
    const noAnchor = makeV1LedgerRow({ anchor_id: undefined, id: 'obs_loose' });
    const noId = makeV1LedgerRow({ anchor_id: 'PF-003', id: undefined });

    const { byAnchor, byObsId } = store.ledgerRegistry([adr, older, newer, noAnchor, noId]);

    expect([...byAnchor.keys()]).toEqual(['ADR-001', 'PF-001', 'PF-002', 'PF-003']);
    expect(byAnchor.get('PF-002')).toBe(newer);
    expect(byObsId.get('obs_shared')).toEqual([older, newer]);
    expect(byObsId.get('obs_loose')).toEqual([noAnchor]);
    expect(byObsId.has('obs_alpha')).toBe(true);
  });

  it('keeps the first row when two rows claim one anchor', () => {
    const first = makeV1LedgerRow({ anchor_id: 'PF-001', id: 'obs_first' });
    const second = makeV1LedgerRow({ anchor_id: 'PF-001', id: 'obs_second' });
    expect(store.ledgerRegistry([first, second]).byAnchor.get('PF-001')).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Observation validation (D-PUT-NOT-MERGE)
// ---------------------------------------------------------------------------

const LEDGER_IDS = new Set(['ADR-001', 'PF-002']);

function createInput(overrides: Row = {}): Row {
  const base: Row = {
    id: 'obs_new_entry',
    type: 'pitfall',
    title: 'Writers refuse a missing learning tree',
    rule: 'A learning writer refuses when the learning directory is absent and never creates it.',
    why: 'Run from the wrong directory, a writer that creates the tree writes a ledger nobody reads.',
    scope: ['area:learning', 'src/**'],
    provenance: 'learning v2 design review',
    evidence: ['an empty nested learning tree appeared in the main checkout'],
  };
  const row: Row = { ...base, ...overrides };
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete row[key];
  return row;
}

interface ValidateOpts {
  mode?: 'create' | 'update' | 'reinforce';
  existing?: Row | null;
  scopeMatches?: (glob: string) => boolean;
}

function validate(input: unknown, opts: ValidateOpts = {}): ValidationResult {
  return store.validateObservationInput(input, {
    mode: opts.mode ?? 'create',
    existing: opts.existing ?? null,
    ledgerIds: LEDGER_IDS,
    scopeMatches: opts.scopeMatches ?? (glob => glob !== 'nomatch/**'),
  });
}

function errorFields(result: ValidationResult): string[] {
  return result.ok ? [] : result.errors.map(e => e.field);
}

describe('validateObservationInput: a valid input', () => {
  it('passes, with exactly the content in canonical key order', () => {
    const input = createInput();
    const result = validate(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(input);
    expect(Object.keys(result.value)).toEqual(['id', 'type', 'title', 'rule', 'why', 'scope', 'provenance', 'evidence']);
  });

  it('copies the arrays rather than sharing them with the input', () => {
    const input = createInput();
    const result = validate(input);
    if (!result.ok) throw new Error('expected a valid input');
    expect(result.value.scope).not.toBe(input.scope);
    expect(result.value.evidence).not.toBe(input.evidence);
  });

  it('accepts a missing evidence list', () => {
    const result = validate(createInput({ evidence: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) expect('evidence' in result.value).toBe(false);
  });
});

describe('validateObservationInput: field limits', () => {
  it.each([
    ['title', 120],
    ['rule', 400],
    ['why', 300],
    ['provenance', 120],
  ])('%s passes at %i characters and fails one over', (field, limit) => {
    expect(validate(createInput({ [field]: 'x'.repeat(limit) })).ok).toBe(true);
    expect(errorFields(validate(createInput({ [field]: 'x'.repeat(limit + 1) })))).toEqual([field]);
  });

  it('counts characters, not UTF-16 code units', () => {
    expect(validate(createInput({ title: '\u{1F600}'.repeat(120) })).ok).toBe(true);
    expect(errorFields(validate(createInput({ title: '\u{1F600}'.repeat(121) })))).toEqual(['title']);
  });

  it('a scope entry passes at 200 characters and fails one over', () => {
    expect(validate(createInput({ scope: ['src/' + 'a'.repeat(196)] })).ok).toBe(true);
    expect(errorFields(validate(createInput({ scope: ['src/' + 'a'.repeat(197)] })))).toEqual(['scope[0]']);
  });

  it('an evidence item passes at 300 characters and fails one over', () => {
    expect(validate(createInput({ evidence: ['e'.repeat(300)] })).ok).toBe(true);
    expect(errorFields(validate(createInput({ evidence: ['e'.repeat(301)] })))).toEqual(['evidence[0]']);
  });

  it('scope needs one to five entries', () => {
    expect(errorFields(validate(createInput({ scope: [] })))).toEqual(['scope']);
    expect(validate(createInput({ scope: ['area:a'] })).ok).toBe(true);
    expect(validate(createInput({ scope: ['area:a', 'area:b', 'area:c', 'area:d', 'area:e'] })).ok).toBe(true);
    expect(errorFields(validate(createInput({ scope: ['area:a', 'area:b', 'area:c', 'area:d', 'area:e', 'area:f'] })))).toEqual(['scope']);
  });

  it('evidence holds at most five items', () => {
    expect(validate(createInput({ evidence: ['1', '2', '3', '4', '5'] })).ok).toBe(true);
    expect(errorFields(validate(createInput({ evidence: ['1', '2', '3', '4', '5', '6'] })))).toEqual(['evidence']);
  });

  it('refuses blank required text and a blank evidence item', () => {
    expect(errorFields(validate(createInput({ title: '   ' })))).toEqual(['title']);
    expect(errorFields(validate(createInput({ evidence: [''] })))).toEqual(['evidence[0]']);
  });

  it('refuses a non-string text field and a non-array list', () => {
    expect(errorFields(validate(createInput({ rule: 42 })))).toEqual(['rule']);
    expect(errorFields(validate(createInput({ scope: 'src/**' })))).toEqual(['scope']);
    expect(errorFields(validate(createInput({ evidence: 'one quote' })))).toEqual(['evidence']);
    expect(errorFields(validate(createInput({ scope: [42] })))).toEqual(['scope[0]']);
  });
});

describe('validateObservationInput: keys', () => {
  it('refuses an unknown key', () => {
    const result = validate(createInput({ color: 'blue' }));
    expect(errorFields(result)).toEqual(['color']);
  });

  it.each(['schema', 'observations', 'first_seen', 'last_seen', 'status', 'anchor_id'])(
    'refuses the plumbing-owned key %s',
    (key) => {
      const result = validate(createInput({ [key]: 'set by the caller' }));
      expect(errorFields(result)).toEqual([key]);
      if (!result.ok) expect(result.errors[0].message).toMatch(/plumbing/);
    },
  );

  it.each(['date', 'last_verified', 'last_attempt', 'status_note', 'superseded_by', 'encoded_at', 'retired_on'])(
    'refuses the ledger-owned key %s',
    (key) => {
      const result = validate(createInput({ [key]: 'set by the caller' }));
      expect(errorFields(result)).toEqual([key]);
      if (!result.ok) expect(result.errors[0].message).toMatch(/ledger/);
    },
  );

  it.each(['id', 'type', 'title', 'rule', 'why', 'scope', 'provenance'])(
    'requires %s',
    (key) => {
      expect(errorFields(validate(createInput({ [key]: undefined })))).toEqual([key]);
    },
  );

  it('refuses an id that is not an observation id', () => {
    for (const id of ['OBS_UPPER', 'obs_ab', 'note_abc', 'obs_has space']) {
      expect(errorFields(validate(createInput({ id })))).toEqual(['id']);
    }
  });

  it('refuses a type other than decision or pitfall', () => {
    expect(errorFields(validate(createInput({ type: 'workflow' })))).toEqual(['type']);
  });

  it.each([[[]], [null], ['a string'], [42]])('refuses %j as the whole input', (input) => {
    expect(errorFields(validate(input))).toEqual(['(input)']);
  });
});

describe('validateObservationInput: banned characters', () => {
  it.each([
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
    ['tab', '\t'],
    ['NUL', '\u0000'],
    ['bell', '\u0007'],
    ['DEL', '\u007f'],
    ['next line', '\u0085'],
    ['right-to-left override', '\u202e'],
  ])('refuses a %s in the title', (_name, ch) => {
    expect(errorFields(validate(createInput({ title: `two${ch}lines` })))).toEqual(['title']);
  });

  it('refuses a line terminator in every string field', () => {
    const result = validate(createInput({
      rule: 'a\nb',
      why: 'a\nb',
      provenance: 'a\nb',
      scope: ['area:x', 'src/\n**'],
      evidence: ['a\nb'],
    }));
    expect(errorFields(result)).toEqual(['rule', 'why', 'scope[1]', 'provenance', 'evidence[0]']);
  });
});

describe('validateObservationInput: ledger IDs, issue references and file-and-line references', () => {
  it('refuses an ID that is in the ledger in the title, the rule or the why', () => {
    expect(errorFields(validate(createInput({ title: 'Follow ADR-001 when rendering' })))).toEqual(['title']);
    expect(errorFields(validate(createInput({ rule: 'The rule restates PF-002 in full.' })))).toEqual(['rule']);
    expect(errorFields(validate(createInput({ why: 'Because ADR-001 says so.' })))).toEqual(['why']);
  });

  it('passes a Jira-style key and an ID that is not in the ledger', () => {
    expect(validate(createInput({ title: 'Tracked as PROJ-123 upstream' })).ok).toBe(true);
    expect(validate(createInput({ rule: 'Number ADR-999 is reserved for the next decision.' })).ok).toBe(true);
  });

  it('leaves the provenance free to name a ledger ID', () => {
    expect(validate(createInput({ provenance: 'raised while reviewing ADR-001' })).ok).toBe(true);
  });

  it('refuses an issue reference in the title, the rule or the why', () => {
    expect(errorFields(validate(createInput({ title: 'Fixed in #123' })))).toEqual(['title']);
    expect(errorFields(validate(createInput({ rule: 'Merged as part of (#45) last week.' })))).toEqual(['rule']);
    expect(errorFields(validate(createInput({ why: '#7 broke the release.' })))).toEqual(['why']);
  });

  it('allows an issue reference in the provenance', () => {
    expect(validate(createInput({ provenance: 'PR #412 review' })).ok).toBe(true);
  });

  it('passes a hash after a word character or an ampersand', () => {
    expect(validate(createInput({ title: 'Escape &#123; and keep C#10 interop' })).ok).toBe(true);
  });

  it('refuses a file-and-line reference in the title, the rule or the why', () => {
    expect(errorFields(validate(createInput({ title: 'Broken at render-decisions.cjs#L42' })))).toEqual(['title']);
    expect(errorFields(validate(createInput({ rule: 'The guard at json-helper.cjs:781 reads the log row.' })))).toEqual(['rule']);
    expect(errorFields(validate(createInput({ why: 'See src/core/a.ts:12:5 for the call.' })))).toEqual(['why']);
  });

  it('allows a file-and-line reference in the provenance and the evidence', () => {
    expect(validate(createInput({ provenance: 'found in README.md:3' })).ok).toBe(true);
    expect(validate(createInput({ evidence: ['quoted from lib/x.py:10', 'see render-decisions.cjs#L42'] })).ok).toBe(true);
  });

  it('passes a host and port', () => {
    expect(validate(createInput({ rule: 'The relay listens on localhost:8080 and reaches example.com:443.' })).ok).toBe(true);
  });
});

describe('validateObservationInput: scope', () => {
  it('accepts area tags and globs that match a tracked file', () => {
    expect(validate(createInput({ scope: ['area:learning', 'area:hud-2', 'src/**/*.cjs'] })).ok).toBe(true);
  });

  it.each(['area:', 'area:Bad_Name', 'area:-lead', 'area:' + 'a'.repeat(41)])('refuses the malformed area tag %s', (entry) => {
    expect(errorFields(validate(createInput({ scope: [entry] })))).toEqual(['scope[0]']);
  });

  it('refuses a glob that matches no tracked file', () => {
    const result = validate(createInput({ scope: ['area:x', 'nomatch/**'] }));
    expect(errorFields(result)).toEqual(['scope[1]']);
    if (!result.ok) expect(result.errors[0].message).toMatch(/tracked file/);
  });

  it.each(['/etc/**', ':(top)src', '../outside/**', 'src/../etc', '..', 'src/a b', 'src/`x`', 'src/a|b'])(
    'refuses the unsafe glob %s without asking git about it',
    (glob) => {
      const asked: string[] = [];
      const result = validate(createInput({ scope: [glob] }), { scopeMatches: g => { asked.push(g); return true; } });
      expect(errorFields(result)).toEqual(['scope[0]']);
      expect(asked).toEqual([]);
    },
  );
});

describe('validateObservationInput: modes', () => {
  const existing = makeV2LogRow({ id: 'obs_new_entry', type: 'pitfall' });

  it('a create refuses an id that is already in the log', () => {
    expect(errorFields(validate(createInput(), { existing }))).toEqual(['id']);
  });

  it('an update needs the row to exist, and accepts the same type', () => {
    expect(errorFields(validate(createInput(), { mode: 'update' }))).toEqual(['id']);
    expect(validate(createInput(), { mode: 'update', existing }).ok).toBe(true);
  });

  it('an update cannot change the type', () => {
    const result = validate(createInput({ type: 'decision' }), { mode: 'update', existing });
    expect(errorFields(result)).toEqual(['type']);
  });

  it('an update replaces the whole content, so every required key must be present', () => {
    expect(errorFields(validate(createInput({ why: undefined }), { mode: 'update', existing }))).toEqual(['why']);
  });

  it('a reinforce takes the id alone', () => {
    const ok = validate({ id: 'obs_new_entry' }, { mode: 'reinforce', existing });
    expect(ok).toEqual({ ok: true, value: { id: 'obs_new_entry' } });
    expect(errorFields(validate({ id: 'obs_new_entry', title: 'x' }, { mode: 'reinforce', existing }))).toEqual(['title']);
    expect(errorFields(validate({ id: 'obs_new_entry' }, { mode: 'reinforce' }))).toEqual(['id']);
  });

  it('an unknown mode is a caller error', () => {
    expect(() => store.validateObservationInput(createInput(), { mode: 'merge' as 'create', scopeMatches: () => true })).toThrow(/mode/);
  });

  it('a create or an update without a scope matcher is a caller error', () => {
    expect(() => store.validateObservationInput(createInput(), { mode: 'create' })).toThrow(/scopeMatches/);
  });
});

describe('validateObservationInput: every violation at once', () => {
  it('lists each problem of a bad input in one result', () => {
    const result = validate(createInput({ title: 'x'.repeat(121), color: 'blue', scope: [], rule: 'see #9' }));
    expect(result.ok).toBe(false);
    expect(errorFields(result)).toEqual(expect.arrayContaining(['color', 'title', 'rule', 'scope']));
    expect(errorFields(result).length).toBeGreaterThanOrEqual(3);
  });

  it('names every kind of reference one field holds: a ledger entry, an issue and a file and line', () => {
    expect(validate(createInput({ title: 'Follow ADR-001 until #12 lands at store.cjs:88' }))).toEqual({
      ok: false,
      errors: [
        { field: 'title', message: 'names ledger entry ADR-001; state the rule in words' },
        { field: 'title', message: 'carries an issue reference; state what it established instead' },
        { field: 'title', message: 'carries a file-and-line reference; name the function or quote the line instead' },
      ],
    });
  });

  it('reports a field over its limit together with the references it holds', () => {
    const rule = `Settled in #12. ${'x'.repeat(400)}`;
    expect(validate(createInput({ rule }))).toEqual({
      ok: false,
      errors: [
        { field: 'rule', message: `is ${Array.from(rule).length} characters, over the limit of 400` },
        { field: 'rule', message: 'carries an issue reference; state what it established instead' },
      ],
    });
  });

  it('judges a field that is not one line of text no further', () => {
    expect(validate(createInput({ why: 'Follow ADR-001\nuntil #12 lands at store.cjs:88' }))).toEqual({
      ok: false,
      errors: [{ field: 'why', message: 'must be one line with no control characters' }],
    });
    expect(validate(createInput({ why: 42 }))).toEqual({ ok: false, errors: [{ field: 'why', message: 'must be a string' }] });
    expect(validate(createInput({ why: '   ' }))).toEqual({ ok: false, errors: [{ field: 'why', message: 'must not be blank' }] });
  });
});

// ---------------------------------------------------------------------------
// gitScopeMatcher
// ---------------------------------------------------------------------------

describe('gitScopeMatcher', { timeout: 30_000 }, () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmp('learning-store-scope-');
    initGitRepo(tmp, {
      '.gitignore': 'ignored/\n',
      'src/a.ts': 'export {};\n',
      'src/lib/b.cjs': 'module.exports = {};\n',
      'docs/guide.md': '# Guide\n',
    });
    fs.mkdirSync(path.join(tmp, 'ignored'));
    fs.writeFileSync(path.join(tmp, 'ignored', 'scratch.ts'), 'untracked\n');
    fs.writeFileSync(path.join(tmp, 'untracked.ts'), 'untracked\n');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('matches globs against tracked files only', () => {
    const matches = store.gitScopeMatcher(tmp);
    expect(matches('src/**')).toBe(true);
    expect(matches('src/*.ts')).toBe(true);
    expect(matches('src/**/*.cjs')).toBe(true);
    expect(matches('docs/guide.md')).toBe(true);
    expect(matches('docs/*.ts')).toBe(false);
    expect(matches('nomatch/**')).toBe(false);
    expect(matches('untracked.ts')).toBe(false);
    expect(matches('ignored/**')).toBe(false);
  });

  it('answers each glob once per matcher', () => {
    const matches = store.gitScopeMatcher(tmp);
    expect(matches('src/a.ts')).toBe(true);
    git(tmp, ['rm', '-q', '--cached', 'src/a.ts']);
    git(tmp, ['commit', '-q', '-m', 'untrack']);
    expect(matches('src/a.ts')).toBe(true);
    expect(store.gitScopeMatcher(tmp)('src/a.ts')).toBe(false);
  });

  it('matches nothing outside a git repository', () => {
    const plain = makeTmp('learning-store-scope-plain-');
    try {
      fs.writeFileSync(path.join(plain, 'a.ts'), 'x\n');
      expect(store.gitScopeMatcher(plain)('*.ts')).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('lists tracked files without running the repository\'s core.fsmonitor hook (D-NO-FSMONITOR)', () => {
    const outside = makeTmp('learning-store-fsmonitor-');
    try {
      const marker = path.join(outside, 'fsmonitor-ran');
      const hook = path.join(outside, 'fsmonitor-hook.sh');
      fs.writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`);
      fs.chmodSync(hook, 0o755);
      git(tmp, ['config', 'core.fsmonitor', hook]);

      expect(store.gitScopeMatcher(tmp)('src/**')).toBe(true);
      expect(fs.existsSync(marker), 'the scope matcher ran the fsmonitor hook').toBe(false);

      // Known-bad probe: the same index read without the override runs the hook.
      execFileSync('git', ['ls-files', '-z'], { cwd: tmp, env: GIT_ENV, stdio: 'ignore' });
      expect(fs.existsSync(marker)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Projection (D-LOG-CONTENT-AUTHORITY) and counters
// ---------------------------------------------------------------------------

describe('toLedgerRowV2 (D-LOG-CONTENT-AUTHORITY)', () => {
  it('projects the log content under the given anchor, status and date, in the fixed key order', () => {
    const log = makeV2LogRow({ id: 'obs_alpha', type: 'decision', extra: 'not projected' });
    const row = store.toLedgerRowV2(log, null, { anchorId: 'ADR-004', status: 'Accepted', date: '2026-10-03' });
    expect(row).toEqual({
      schema: 2,
      id: 'obs_alpha',
      type: 'decision',
      anchor_id: 'ADR-004',
      decisions_status: 'Accepted',
      title: log.title,
      rule: log.rule,
      why: log.why,
      scope: log.scope,
      provenance: log.provenance,
      date: '2026-10-03',
    });
    expect(Object.keys(row)).toEqual([
      'schema', 'id', 'type', 'anchor_id', 'decisions_status', 'title', 'rule', 'why', 'scope', 'provenance', 'date',
    ]);
  });

  it('carries every ledger-owned key over from the prior row and drops its old content', () => {
    const prior = {
      ...makeV1LedgerRow({ id: 'obs_alpha', type: 'pitfall', anchor_id: 'PF-007', decisions_status: 'Superseded' }),
      amendments: [{ date: '2026-01-01', note: 'sharpened' }],
      raw_body: '\n## PF-007: old\n',
      confidence: 0.9,
      date: '2026-01-02',
      last_verified: '2026-09-01',
      last_attempt: '2026-10-01T00:00:00.000Z',
      status_note: 'kept for the record',
      superseded_by: 'PF-009',
      encoded_at: { path: 'src/a.ts', quote: 'a quoted line', ref: 'HEAD', commit: 'f'.repeat(40) },
      retired_on: '2026-09-30',
    };
    const log = makeV2LogRow({ id: 'obs_alpha', type: 'pitfall' });
    const row = store.toLedgerRowV2(log, prior);
    expect(Object.keys(row)).toEqual([
      'schema', 'id', 'type', 'anchor_id', 'decisions_status', 'title', 'rule', 'why', 'scope', 'provenance',
      'date', 'last_verified', 'last_attempt', 'status_note', 'superseded_by', 'encoded_at', 'retired_on',
    ]);
    expect(row.anchor_id).toBe('PF-007');
    expect(row.decisions_status).toBe('Superseded');
    expect(row.encoded_at).toEqual(prior.encoded_at);
    expect(row.encoded_at).not.toBe(prior.encoded_at);
    expect(row).not.toHaveProperty('pattern');
    expect(row).not.toHaveProperty('details');
    expect(row).not.toHaveProperty('amendments');
    expect(row).not.toHaveProperty('raw_body');
    expect(row).not.toHaveProperty('confidence');
    expect(row).not.toHaveProperty('evidence');
    expect(row).not.toHaveProperty('observations');
  });

  it('lets the caller override the prior status and date', () => {
    const prior = makeV2LedgerRow({ anchor_id: 'ADR-002', decisions_status: 'Retired', date: '2026-01-01' });
    const row = store.toLedgerRowV2(makeV2LogRow(), prior, { status: 'Accepted', date: '2026-10-03' });
    expect(row.decisions_status).toBe('Accepted');
    expect(row.date).toBe('2026-10-03');
  });

  it('leaves its inputs untouched', () => {
    const log = makeV2LogRow();
    const prior = makeV2LedgerRow();
    const logBefore = JSON.stringify(log);
    const priorBefore = JSON.stringify(prior);
    const row = store.toLedgerRowV2(log, prior);
    expect(row.scope).not.toBe(log.scope);
    expect(JSON.stringify(log)).toBe(logBefore);
    expect(JSON.stringify(prior)).toBe(priorBefore);
  });

  it('throws on a type mismatch with the expected type', () => {
    expect(() => store.toLedgerRowV2(makeV2LogRow({ type: 'pitfall' }), null, {
      anchorId: 'PF-001', status: 'Active', expectType: 'decision',
    })).toThrow(/type mismatch/);
  });

  it('throws when the anchor prefix does not belong to the row type', () => {
    expect(() => store.toLedgerRowV2(makeV2LogRow({ type: 'pitfall' }), null, {
      anchorId: 'ADR-001', status: 'Active',
    })).toThrow(/anchor/);
  });

  it('throws on a v1 log row', () => {
    expect(() => store.toLedgerRowV2(makeV1LogRow(), null, { anchorId: 'PF-001', status: 'Active' })).toThrow(/v2/);
  });

  it('throws without an anchor or a valid status', () => {
    expect(() => store.toLedgerRowV2(makeV2LogRow(), null, { status: 'Accepted' })).toThrow(/anchor/);
    expect(() => store.toLedgerRowV2(makeV2LogRow(), null, { anchorId: 'ADR-001', status: 'Pending' })).toThrow(/status/);
  });
});

describe('toV2Counters', () => {
  it('keeps the counters of a row that has them', () => {
    const row = makeV1LogRow({ observations: 4, first_seen: '2026-05-01T00:00:00.000Z', last_seen: '2026-06-01T00:00:00.000Z' });
    expect(store.toV2Counters(row, { now: FIXTURE_NOW })).toEqual({
      observations: 4, first_seen: '2026-05-01T00:00:00.000Z', last_seen: '2026-06-01T00:00:00.000Z',
    });
  });

  it('falls back from observations to count, and from first_seen to created', () => {
    const row = makeV1LogRow({ observations: undefined, count: 3, first_seen: undefined, created: '2026-04-01T00:00:00.000Z' });
    expect(store.toV2Counters(row, { now: FIXTURE_NOW })).toEqual({
      observations: 3, first_seen: '2026-04-01T00:00:00.000Z', last_seen: '2026-07-01T00:00:00.000Z',
    });
  });

  it('falls back to one observation and first_seen from last_seen', () => {
    const row = makeV1LogRow({ observations: undefined, first_seen: undefined });
    expect(store.toV2Counters(row, { now: FIXTURE_NOW })).toEqual({
      observations: 1, first_seen: '2026-07-01T00:00:00.000Z', last_seen: '2026-07-01T00:00:00.000Z',
    });
  });

  it('falls back to now when the row has no usable timestamp', () => {
    const row = makeV1LogRow({ observations: 'many', first_seen: undefined, last_seen: 'not a date' });
    expect(store.toV2Counters(row, { now: FIXTURE_NOW })).toEqual({
      observations: 1, first_seen: '2026-10-03T12:00:00.000Z', last_seen: '2026-10-03T12:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------
// History (D-CONTENT-HISTORY) and the pre-v2 backup (D-V1-BACKUP-ONCE)
// ---------------------------------------------------------------------------

describe('content history (D-CONTENT-HISTORY)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmp('learning-store-history-');
    seedLearningTree(tmp);
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('keeps the last three prior versions of an entry after four rewrites', () => {
    for (let version = 1; version <= 4; version++) {
      store.appendHistory(
        tmp,
        { id: 'obs_alpha', ledger: [makeV2LedgerRow({ id: 'obs_alpha', rule: `rule v${version}` })], log: makeV2LogRow({ id: 'obs_alpha', rule: `rule v${version}` }) },
        { now: FIXTURE_NOW + version },
      );
    }
    const versions = store.historyVersions(tmp, 'obs_alpha');
    expect(versions).toHaveLength(3);
    expect(versions.map(v => (v.log as Row).rule)).toEqual(['rule v2', 'rule v3', 'rule v4']);
    expect(versions[2]).toEqual({
      id: 'obs_alpha',
      at: new Date(FIXTURE_NOW + 4).toISOString(),
      ledger: [makeV2LedgerRow({ id: 'obs_alpha', rule: 'rule v4' })],
      log: makeV2LogRow({ id: 'obs_alpha', rule: 'rule v4' }),
    });
  });

  it('trims each entry on its own', () => {
    store.appendHistory(tmp, { id: 'obs_beta', ledger: [], log: makeV2LogRow({ id: 'obs_beta' }) }, { now: FIXTURE_NOW });
    for (let version = 1; version <= 4; version++) {
      store.appendHistory(tmp, { id: 'obs_alpha', ledger: [], log: makeV2LogRow({ id: 'obs_alpha' }) }, { now: FIXTURE_NOW });
    }
    expect(store.historyVersions(tmp, 'obs_beta')).toHaveLength(1);
    expect(store.historyVersions(tmp, 'obs_alpha')).toHaveLength(3);
  });

  it('returns the number of versions the entry now has', () => {
    const counts = [1, 2, 3, 4].map(() => store.appendHistory(tmp, { id: 'obs_alpha', ledger: [], log: null }, { now: FIXTURE_NOW }));
    expect(counts).toEqual([1, 2, 3, 3]);
  });

  it('reports no versions for an entry that was never rewritten', () => {
    expect(store.historyVersions(tmp, 'obs_never')).toEqual([]);
  });

  it('quarantines a malformed history line before rewriting the file', () => {
    const { history } = learningPaths(tmp);
    fs.writeFileSync(history, '{torn line\n');
    store.appendHistory(tmp, { id: 'obs_alpha', ledger: [], log: null }, { now: FIXTURE_NOW });
    expect(store.readJsonl(history).rejected).toEqual([]);
    expect(store.readJsonl(store.rejectedPathFor(history)).rows.map(r => r.text)).toEqual(['{torn line']);
  });
});

describe('ensurePreV2Backup (D-V1-BACKUP-ONCE)', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-backup-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function preV2(file: string): string {
    return file.replace(/\.jsonl$/, '.pre-v2.jsonl');
  }

  it('copies the log, the ledger and the archive once, and never overwrites a copy', () => {
    const p = seedLearningTree(tmp, { log: [makeV1LogRow()], ledger: [makeV1LedgerRow()], archive: [makeV1LogRow({ id: 'obs_old' })] });
    const originals = [p.log, p.ledger, p.archive].map(f => fs.readFileSync(f, 'utf8'));
    const state = store.readLearningState(tmp);

    const written = store.ensurePreV2Backup(tmp, state);
    expect(written).toEqual([preV2(p.log), preV2(p.ledger), preV2(p.archive)]);
    expect([p.log, p.ledger, p.archive].map(f => fs.readFileSync(preV2(f), 'utf8'))).toEqual(originals);

    fs.writeFileSync(p.log, toJsonl([makeV2LogRow()]));
    expect(store.ensurePreV2Backup(tmp, { logRows: [makeV1LogRow()], ledgerRows: [] })).toEqual([]);
    expect(fs.readFileSync(preV2(p.log), 'utf8')).toBe(originals[0]);
  });

  it('writes no backup for an all-v2 tree', () => {
    const p = seedLearningTree(tmp, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()], archive: [] });
    expect(store.ensurePreV2Backup(tmp, store.readLearningState(tmp))).toEqual([]);
    for (const f of [p.log, p.ledger, p.archive]) expect(fs.existsSync(preV2(f))).toBe(false);
  });

  it('backs up only the files that exist', () => {
    const p = seedLearningTree(tmp, { log: [makeV1LogRow()] });
    expect(store.ensurePreV2Backup(tmp, { logRows: [makeV1LogRow()], ledgerRows: [] })).toEqual([preV2(p.log)]);
  });

  it('a v1 ledger row alone is enough to trigger the backup', () => {
    const p = seedLearningTree(tmp, { log: [makeV2LogRow()], ledger: [makeV1LedgerRow()] });
    expect(store.ensurePreV2Backup(tmp, store.readLearningState(tmp))).toEqual([preV2(p.log), preV2(p.ledger)]);
  });
});

// ---------------------------------------------------------------------------
// Clearing the observations no entry uses (devflow learning --clear)
// ---------------------------------------------------------------------------

describe('clearUnreferenced (D-CLEAR-UNREFERENCED)', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-clear-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  /** A log row no ledger row carries, a v2 one an active entry carries, and a v1 one a retired entry carries. */
  const unreferenced = makeV2LogRow({ id: 'obs_waiting', last_seen: daysAgoIso(1) });
  const carriedActive = makeV2LogRow({ id: 'obs_carried_active' });
  const carriedRetired = makeV1LogRow({ id: 'obs_carried_retired' });
  const ledger = [
    makeV2LedgerRow({ id: 'obs_carried_active', anchor_id: 'ADR-001' }),
    makeV1LedgerRow({ id: 'obs_carried_retired', anchor_id: 'PF-001', decisions_status: 'Retired', status_note: 'one-off' }),
  ];

  it('drops every log row no ledger row carries, a fresh one and one with no id included, and keeps every carried row in order', () => {
    const idless = makeV1LogRow({ id: undefined, last_seen: daysAgoIso(2) });
    const p = seedLearningTree(tmp, { log: [unreferenced, carriedActive, idless, carriedRetired], ledger });

    expect(store.clearUnreferenced(tmp, { now: FIXTURE_NOW })).toEqual({ ok: true, value: { cleared: 2, kept: 2 } });
    expect(store.readJsonl(p.log).rows).toEqual([carriedActive, carriedRetired]);
  });

  it('leaves the ledger, the archive and the rendered files byte for byte as they were', () => {
    const archived = makeV1LogRow({ id: 'obs_archived_before', last_seen: daysAgoIso(90) });
    const p = seedLearningTree(tmp, { log: [unreferenced, carriedActive, carriedRetired], ledger, archive: [archived] });
    fs.writeFileSync(path.join(p.learningDir, 'decisions.md'), 'rendered decisions\n');
    const untouched = [p.ledger, p.archive, path.join(p.learningDir, 'decisions.md')];
    const before = untouched.map(file => fs.readFileSync(file, 'utf8'));

    expect(store.clearUnreferenced(tmp, { now: FIXTURE_NOW }).ok).toBe(true);
    expect(untouched.map(file => fs.readFileSync(file, 'utf8'))).toEqual(before);
  });

  it('writes nothing at all when every log row is carried', () => {
    seedLearningTree(tmp, { log: [carriedActive, carriedRetired], ledger });
    const before = snapshotTree(tmp);

    expect(store.clearUnreferenced(tmp, { now: FIXTURE_NOW })).toEqual({ ok: true, value: { cleared: 0, kept: 2 } });
    expect(snapshotTree(tmp)).toEqual(before);
  });

  it('backs up a v1 tree once and quarantines the log\'s malformed lines before it rewrites the log (D-V1-BACKUP-ONCE, D-QUARANTINE-MALFORMED)', () => {
    const p = seedLearningTree(tmp, { log: [unreferenced, carriedRetired], ledger });
    fs.appendFileSync(p.log, '{torn line\n');
    const original = fs.readFileSync(p.log, 'utf8');

    expect(store.clearUnreferenced(tmp, { now: FIXTURE_NOW })).toEqual({ ok: true, value: { cleared: 1, kept: 1 } });

    expect(fs.readFileSync(p.log.replace(/\.jsonl$/, '.pre-v2.jsonl'), 'utf8')).toBe(original);
    expect(store.readJsonl(store.rejectedPathFor(p.log)).rows.map(r => r.text)).toEqual(['{torn line']);
    expect(fs.readFileSync(p.log, 'utf8')).toBe(toJsonl([carriedRetired]));
  });

  it('refuses while the ledger holds a malformed line, which may carry a row it would drop, and writes nothing', () => {
    const p = seedLearningTree(tmp, { log: [unreferenced, carriedActive], ledger: [ledger[0]] });
    fs.appendFileSync(p.ledger, '{"id":"obs_waiting","anchor_id":"ADR-002"\n');
    const before = snapshotTree(tmp);

    const result = store.clearUnreferenced(tmp, { now: FIXTURE_NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('ledger-malformed');
      expect(result.error.message).toBe(
        'clear: the ledger has 1 malformed line, which may carry an observation this would drop; nothing was cleared',
      );
    }
    expect(snapshotTree(tmp)).toEqual(before);
  });

  it('refuses without .devflow/learning/ and creates nothing (D-NO-STRAY-TREE)', () => {
    fs.mkdirSync(path.join(tmp, '.devflow'));
    const result = store.clearUnreferenced(tmp, { now: FIXTURE_NOW });
    expect(result).toEqual({
      ok: false,
      error: { kind: 'no-learning-dir', message: `clear: no .devflow/learning/ under ${tmp} — run from the project root` },
    });
    expect(fs.readdirSync(path.join(tmp, '.devflow'))).toEqual([]);
  });

  it('reports busy while another holder keeps the learning lock, and writes nothing (D-ONE-LEARNING-LOCK)', () => {
    const p = seedLearningTree(tmp, { log: [unreferenced, carriedActive], ledger: [ledger[0]] });
    fs.mkdirSync(p.lockDir);
    const before = snapshotTree(tmp);

    const result = store.clearUnreferenced(tmp, { now: FIXTURE_NOW, timeoutMs: 0 });

    expect(result).toEqual({ ok: false, error: { kind: 'busy', message: `clear: timeout acquiring lock at ${p.lockDir}` } });
    expect(snapshotTree(tmp)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Resetting the learning tree (devflow learning --reset)
// ---------------------------------------------------------------------------

describe('resetLearning (D-RESET-UNDER-LOCK)', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-reset-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  /** Every kind of learning file, fourteen entries in all, beside the rest of a .devflow/. */
  function seedFullTree(): ReturnType<typeof learningPaths> {
    const p = seedLearningTree(tmp, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()], archive: [makeV1LogRow()] });
    for (const file of [
      p.history, store.rejectedPathFor(p.log), p.log.replace(/\.jsonl$/, '.pre-v2.jsonl'),
      path.join(p.learningDir, 'decisions.md'), path.join(p.learningDir, 'pitfalls.md'), path.join(p.learningDir, 'index.md'),
      path.join(p.learningDir, 'learning.json'),
      path.join(p.learningDir, '.pending-turns.jsonl'), path.join(p.learningDir, '.pending-turns.processing'),
      path.join(p.learningDir, '.pending-turns.owner'),
    ]) {
      fs.writeFileSync(file, `${path.basename(file)}\n`);
    }
    fs.mkdirSync(path.join(p.learningDir, '.decisions-usage.lock'));
    fs.writeFileSync(path.join(tmp, '.devflow', 'config.json'), '{"features":{}}\n');
    fs.mkdirSync(path.join(tmp, '.devflow', 'memory'));
    fs.writeFileSync(path.join(tmp, '.devflow', 'memory', '.pending-turns.jsonl'), '{"role":"user"}\n');
    return p;
  }

  it('removes every learning file and the directory itself, and leaves the rest of .devflow/ byte for byte', () => {
    const p = seedFullTree();
    const memory = snapshotTree(path.join(tmp, '.devflow', 'memory'));

    expect(store.resetLearning(tmp)).toEqual({ ok: true, value: { removed: 14 } });

    expect(fs.existsSync(p.learningDir)).toBe(false);
    expect(fs.readdirSync(path.join(tmp, '.devflow')).sort()).toEqual(['config.json', 'memory']);
    expect(fs.readFileSync(path.join(tmp, '.devflow', 'config.json'), 'utf8')).toBe('{"features":{}}\n');
    expect(snapshotTree(path.join(tmp, '.devflow', 'memory'))).toEqual(memory);
  });

  it('refuses without .devflow/learning/ and creates nothing, in a bare directory or under an existing .devflow/ (D-NO-STRAY-TREE)', () => {
    const refusal = {
      ok: false,
      error: { kind: 'no-learning-dir', message: `reset: no .devflow/learning/ under ${tmp} — run from the project root` },
    };
    expect(store.resetLearning(tmp)).toEqual(refusal);
    expect(fs.readdirSync(tmp)).toEqual([]);

    fs.mkdirSync(path.join(tmp, '.devflow'));
    expect(store.resetLearning(tmp)).toEqual(refusal);
    expect(fs.readdirSync(path.join(tmp, '.devflow'))).toEqual([]);
  });

  it('reports busy while another run holds the learning lock, and removes nothing (D-ONE-LEARNING-LOCK)', () => {
    const p = seedFullTree();
    fs.mkdirSync(p.lockDir);
    const before = snapshotTree(tmp);

    expect(store.resetLearning(tmp, { timeoutMs: 0 })).toEqual({
      ok: false,
      error: { kind: 'busy', message: `reset: timeout acquiring lock at ${p.lockDir}` },
    });
    expect(snapshotTree(tmp)).toEqual(before);
  });

  it('breaks a lock a crashed run left behind, then resets', () => {
    const p = seedFullTree();
    fs.mkdirSync(p.lockDir);
    const abandoned = new Date(Date.now() - store.LOCK_STALE_MS - 60_000);
    fs.utimesSync(p.lockDir, abandoned, abandoned);

    expect(store.resetLearning(tmp, { timeoutMs: 0 })).toEqual({ ok: true, value: { removed: 14 } });
    expect(fs.existsSync(p.learningDir)).toBe(false);
  });

  it('removes a symbolic link in the learning directory, never what it points to', () => {
    const p = seedLearningTree(tmp, { ledger: [makeV2LedgerRow()] });
    const outsideFile = path.join(tmp, 'outside.jsonl');
    const outsideDir = path.join(tmp, 'outside-dir');
    fs.writeFileSync(outsideFile, 'kept\n');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'kept.txt'), 'kept\n');
    fs.symlinkSync(outsideFile, p.log);
    fs.symlinkSync(outsideDir, path.join(p.learningDir, 'linked-dir'));

    expect(store.resetLearning(tmp)).toEqual({ ok: true, value: { removed: 3 } });

    expect(fs.existsSync(p.learningDir)).toBe(false);
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('kept\n');
    expect(fs.readFileSync(path.join(outsideDir, 'kept.txt'), 'utf8')).toBe('kept\n');
  });

  it('refuses a learning directory that is itself a symbolic link, and removes nothing it leads to', () => {
    const p = learningPaths(tmp);
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(path.join(elsewhere, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'notes.txt'), 'kept\n');
    fs.writeFileSync(path.join(elsewhere, 'sub', 'deep.txt'), 'kept\n');
    fs.mkdirSync(path.join(tmp, '.devflow'));
    fs.symlinkSync(elsewhere, p.learningDir);
    const before = snapshotTree(elsewhere);

    expect(store.resetLearning(tmp, { timeoutMs: 0 })).toEqual({
      ok: false,
      error: { kind: 'not-a-directory', message: `reset: ${p.learningDir} is a symbolic link, not a directory; nothing was removed` },
    });
    expect(snapshotTree(elsewhere)).toEqual(before);
    expect(fs.lstatSync(p.learningDir).isSymbolicLink()).toBe(true);
  });

  it('keeps what arrives once the lock is released, and leaves no lock behind', () => {
    const p = seedFullTree();
    const arrived = path.join(p.learningDir, '.pending-turns.jsonl');
    // The lock is released by removing its directory; a capture hook appends a
    // turn at that moment, after the reset and before the directory is removed.
    const nodeFs = createRequire(import.meta.url)('fs') as { rmdirSync: (target: fs.PathLike) => void };
    const rmdirSync = nodeFs.rmdirSync;
    nodeFs.rmdirSync = (target) => {
      rmdirSync(target);
      if (target === p.lockDir) fs.writeFileSync(arrived, '{"role":"user"}\n');
    };
    try {
      expect(store.resetLearning(tmp)).toEqual({ ok: true, value: { removed: 14 } });
    } finally {
      nodeFs.rmdirSync = rmdirSync;
    }
    expect(fs.readdirSync(p.learningDir)).toEqual(['.pending-turns.jsonl']);
  });
});

// ---------------------------------------------------------------------------
// Integrity, listing, due selection and show
// ---------------------------------------------------------------------------

const scopeMatchesSrc = (glob: string): boolean => glob.startsWith('src/');

describe('integrityFlags', () => {
  it('flags duplicate observation ids, ledger rows without a log row and scopes that match nothing, over active rows only', () => {
    const ledger = [
      makeV2LedgerRow({ anchor_id: 'ADR-001', id: 'obs_alpha', scope: ['area:x', 'src/**'] }),
      makeV1LedgerRow({ anchor_id: 'PF-003', id: 'obs_shared' }),
      makeV1LedgerRow({ anchor_id: 'PF-001', id: 'obs_shared' }),
      makeV1LedgerRow({ anchor_id: 'PF-002', id: 'obs_gone' }),
      makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta', scope: ['docs/**'] }),
      makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_retired', decisions_status: 'Retired', scope: ['docs/**'] }),
    ];
    const log = [
      makeV2LogRow({ id: 'obs_alpha' }),
      makeV1LogRow({ id: 'obs_shared' }),
      makeV2LogRow({ id: 'obs_beta' }),
    ];
    expect(store.integrityFlags(ledger, log, { scopeMatches: scopeMatchesSrc })).toEqual([
      { anchor_id: 'ADR-002', id: 'obs_beta', flags: ['scope-matches-nothing'] },
      { anchor_id: 'PF-001', id: 'obs_shared', flags: ['duplicate-obs-id'] },
      { anchor_id: 'PF-002', id: 'obs_gone', flags: ['ledger-without-log'] },
      { anchor_id: 'PF-003', id: 'obs_shared', flags: ['duplicate-obs-id'] },
    ]);
  });

  it('does not count an inactive row as a duplicate of an active one', () => {
    const ledger = [
      makeV1LedgerRow({ anchor_id: 'PF-001', id: 'obs_shared', decisions_status: 'Superseded' }),
      makeV1LedgerRow({ anchor_id: 'PF-002', id: 'obs_shared' }),
    ];
    expect(store.integrityFlags(ledger, [makeV1LogRow({ id: 'obs_shared' })])).toEqual([]);
  });

  it('skips the scope check without a matcher', () => {
    const ledger = [makeV2LedgerRow({ anchor_id: 'ADR-001', id: 'obs_alpha', scope: ['nomatch/**'] })];
    expect(store.integrityFlags(ledger, [makeV2LogRow({ id: 'obs_alpha' })])).toEqual([]);
  });
});

describe('buildListing', () => {
  const longPattern = 'p'.repeat(200);
  const ledger = [
    makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta', title: 'Second decision', last_verified: '2026-09-20' }),
    makeV1LedgerRow({ anchor_id: 'PF-001', id: 'obs_legacy', pattern: longPattern }),
    makeV2LedgerRow({ anchor_id: 'ADR-001', id: 'obs_alpha', title: 'First decision' }),
    makeV1LedgerRow({ anchor_id: 'PF-002', id: 'obs_old', pattern: 'Old\nlesson', decisions_status: 'Retired', status_note: 'one-off' }),
    makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_enc', decisions_status: 'Encoded', encoded_at: { path: 'src/a.ts', quote: 'q', ref: 'HEAD', commit: 'a'.repeat(40) } }),
    makeV2LedgerRow({ anchor_id: 'ADR-004', id: 'obs_sup', decisions_status: 'Superseded', superseded_by: 'ADR-001' }),
  ];
  const log = [
    makeV2LogRow({ id: 'obs_alpha' }),
    makeV2LogRow({ id: 'obs_beta' }),
    makeV1LogRow({ id: 'obs_legacy' }),
    makeV2LogRow({ id: 'obs_zeta', title: 'Unpromoted lesson', observations: 2, last_seen: '2026-09-29T00:00:00.000Z' }),
    makeV1LogRow({ id: 'obs_eta', pattern: 'Legacy\nunpromoted', count: 5, observations: undefined }),
  ];

  it('lists active entries in anchor order, with a v1 title cut to 120 characters', () => {
    const listing = store.buildListing(ledger, log);
    expect(listing.active.map(r => r.anchor_id)).toEqual(['ADR-001', 'ADR-002', 'PF-001']);
    expect(listing.active[1]).toEqual({
      anchor_id: 'ADR-002', id: 'obs_beta', type: 'decision', status: 'Accepted',
      title: 'Second decision', schema: 2, last_verified: '2026-09-20',
    });
    const legacy = listing.active[2];
    expect(legacy.schema).toBe(1);
    expect(Array.from(legacy.title)).toHaveLength(120);
    expect(legacy.title.endsWith('…')).toBe(true);
  });

  it('lists inactive entries with the note that says why', () => {
    const listing = store.buildListing(ledger, log);
    expect(listing.inactive.map(r => [r.anchor_id, r.status, r.note])).toEqual([
      ['ADR-003', 'Encoded', 'encoded in src/a.ts'],
      ['ADR-004', 'Superseded', 'superseded by ADR-001'],
      ['PF-002', 'Retired', 'one-off'],
    ]);
    expect(listing.inactive[2].title).toBe('Old lesson');
  });

  it('lists the observations no ledger row carries', () => {
    expect(store.buildListing(ledger, log).observations).toEqual([
      { id: 'obs_eta', type: 'pitfall', title: 'Legacy unpromoted', schema: 1, observations: 5, last_seen: '2026-07-01T00:00:00.000Z' },
      { id: 'obs_zeta', type: 'decision', title: 'Unpromoted lesson', schema: 2, observations: 2, last_seen: '2026-09-29T00:00:00.000Z' },
    ]);
  });

  it('carries the integrity flags and the malformed line counts', () => {
    const listing = store.buildListing(
      [...ledger, makeV2LedgerRow({ anchor_id: 'ADR-005', id: 'obs_alpha' })],
      log,
      { rejected: { ledger: [{ line: 9, text: 'x' }], log: [] } },
    );
    expect(listing.integrity.map(e => e.anchor_id)).toEqual(['ADR-001', 'ADR-005']);
    expect(listing.malformed).toEqual({ ledger: 1, log: 0 });
  });
});

describe('entrySize', () => {
  it('is the byte length of the ledger row plus its log row', () => {
    const ledgerRow = makeV2LedgerRow({ title: 'é' });
    const logRow = makeV2LogRow();
    expect(store.entrySize(ledgerRow, logRow)).toBe(
      Buffer.byteLength(JSON.stringify(ledgerRow)) + Buffer.byteLength(JSON.stringify(logRow)),
    );
    expect(store.entrySize(ledgerRow, null)).toBe(Buffer.byteLength(JSON.stringify(ledgerRow)));
  });
});

describe('selectDue (D-DUE-ORDER)', () => {
  function v2(anchor: string, id: string, extra: Row = {}): Row {
    const type = anchor.startsWith('ADR') ? 'decision' : 'pitfall';
    return makeV2LedgerRow({ anchor_id: anchor, id, type, decisions_status: type === 'decision' ? 'Accepted' : 'Active', ...extra });
  }

  const ledger = [
    v2('ADR-005', 'obs_fresh', { last_verified: daysAgoDate(10) }),
    v2('PF-010', 'obs_old40', { last_verified: daysAgoDate(40) }),
    v2('ADR-006', 'obs_never', { last_verified: undefined }),
    v2('PF-011', 'obs_old90', { last_verified: daysAgoDate(90) }),
    makeV1LedgerRow({ anchor_id: 'PF-002', id: 'obs_legacy_b' }),
    makeV1LedgerRow({ anchor_id: 'ADR-003', id: 'obs_legacy_a', type: 'decision', decisions_status: 'Accepted' }),
    makeV1LedgerRow({ anchor_id: 'PF-020', id: 'obs_dup' }),
    makeV1LedgerRow({ anchor_id: 'PF-004', id: 'obs_dup' }),
    v2('ADR-009', 'obs_retired', { decisions_status: 'Retired', last_verified: undefined }),
  ];
  const log = [
    'obs_fresh', 'obs_old40', 'obs_never', 'obs_old90', 'obs_legacy_b', 'obs_legacy_a', 'obs_dup',
  ].map(id => makeV2LogRow({ id }));

  function due(rows: Row[], opts: { maxEntries?: number; budgetBytes?: number } = {}) {
    const integrity = store.integrityFlags(rows, log);
    return store.selectDue(rows, log, { now: FIXTURE_NOW, integrity, ...opts });
  }

  it('orders integrity, then legacy v1 decisions before pitfalls, then the oldest verification, never-verified first', () => {
    expect(due(ledger, { maxEntries: 10, budgetBytes: 1_000_000 }).map(e => [e.anchor_id, e.reason])).toEqual([
      ['PF-004', 'duplicate-obs-id'],
      ['PF-020', 'duplicate-obs-id'],
      ['ADR-003', 'legacy-v1'],
      ['PF-002', 'legacy-v1'],
      ['ADR-006', 'verify-age'],
      ['PF-011', 'verify-age'],
      ['PF-010', 'verify-age'],
    ]);
  });

  it('caps the hand-out at five entries by default', () => {
    expect(due(ledger)).toHaveLength(5);
  });

  it('reports each entry\'s size', () => {
    const [first] = due(ledger);
    expect(first.bytes).toBe(store.entrySize(ledger[7], log[6]));
  });

  it('skips an entry attempted in the last 24 hours and offers it again after', () => {
    const leased = ledger.map(r => (r.anchor_id === 'PF-004' ? { ...r, last_attempt: new Date(FIXTURE_NOW - 2 * HOUR_MS).toISOString() } : r));
    expect(due(leased).map(e => e.anchor_id)).not.toContain('PF-004');
    const expired = ledger.map(r => (r.anchor_id === 'PF-004' ? { ...r, last_attempt: new Date(FIXTURE_NOW - 25 * HOUR_MS).toISOString() } : r));
    expect(due(expired)[0].anchor_id).toBe('PF-004');
  });

  it('stops at the first entry that would exceed the byte budget', () => {
    const big = (anchor: string, id: string): Row => v2(anchor, id, { last_verified: undefined, rule: 'r'.repeat(25_000) });
    const rows = [big('ADR-001', 'obs_one'), big('ADR-002', 'obs_two'), big('ADR-003', 'obs_three')];
    const selected = store.selectDue(rows, [], { now: FIXTURE_NOW, integrity: [] });
    expect(selected.map(e => e.anchor_id)).toEqual(['ADR-001', 'ADR-002']);
    expect(selected.reduce((n, e) => n + e.bytes, 0)).toBeLessThanOrEqual(store.DUE.byteBudget);
  });

  it('always hands out at least one entry, however large', () => {
    const huge = v2('ADR-001', 'obs_huge', { last_verified: undefined, rule: 'r'.repeat(70_000) });
    expect(store.selectDue([huge], [], { now: FIXTURE_NOW, integrity: [] }).map(e => e.anchor_id)).toEqual(['ADR-001']);
  });

  it('hands out nothing when every active entry is fresh', () => {
    expect(store.selectDue([v2('ADR-001', 'obs_ok', { last_verified: daysAgoDate(1) })], [], { now: FIXTURE_NOW, integrity: [] })).toEqual([]);
  });

  it('never hands out an inactive entry', () => {
    expect(due(ledger, { maxEntries: 20, budgetBytes: 1_000_000 }).map(e => e.anchor_id)).not.toContain('ADR-009');
  });
});

describe('showEntry', () => {
  const older = makeV1LedgerRow({ anchor_id: 'PF-011', id: 'obs_shared', details: 'area: a; issue: curated only in the ledger' });
  const newer = makeV1LedgerRow({ anchor_id: 'PF-012', id: 'obs_shared', details: 'area: a; issue: b' });
  const logRow = makeV1LogRow({ id: 'obs_shared', details: 'area: a;   issue: b; impact: c' });
  const v2Ledger = makeV2LedgerRow({ anchor_id: 'ADR-001', id: 'obs_alpha', rule: 'An older rule kept only in the ledger.' });
  const v2Log = makeV2LogRow({ id: 'obs_alpha' });
  const ledger = [newer, v2Ledger, older];
  const log = [logRow, v2Log];

  it('shows every ledger row of a shared id, its log row and a flag on ledger-only details', () => {
    const result = store.showEntry('PF-011', ledger, log);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe('PF-011');
    expect(result.value.ledger).toEqual([older, newer]);
    expect(result.value.log).toEqual(logRow);
    expect(result.value.flags).toEqual([{ anchor_id: 'PF-011', flag: 'ledger-only-content', fields: ['details'] }]);
  });

  it('finds the same entry by its observation id', () => {
    const result = store.showEntry('obs_shared', ledger, log);
    expect(result.ok && result.value.ledger.map(r => r.anchor_id)).toEqual(['PF-011', 'PF-012']);
  });

  it('flags each v2 field the ledger holds differently from the log', () => {
    const result = store.showEntry('ADR-001', ledger, log);
    expect(result.ok && result.value.flags).toEqual([{ anchor_id: 'ADR-001', flag: 'ledger-only-content', fields: ['rule'] }]);
  });

  it('raises no flag when the ledger row is the projection of its log row', () => {
    const projected = store.toLedgerRowV2(v2Log, v2Ledger);
    const result = store.showEntry('ADR-001', [projected], [v2Log]);
    expect(result.ok && result.value.flags).toEqual([]);
  });

  it('includes the stored history versions', () => {
    const versions = [{ id: 'obs_alpha', at: '2026-10-01T00:00:00.000Z', ledger: [], log: null }];
    const result = store.showEntry('ADR-001', ledger, log, { historyVersions: id => (id === 'obs_alpha' ? versions : []) });
    expect(result.ok && result.value.history_versions).toEqual(versions);
  });

  it('shows an unpromoted observation by its id', () => {
    const result = store.showEntry('obs_alpha', [], log);
    expect(result.ok && result.value).toEqual({ key: 'obs_alpha', ledger: [], log: v2Log, history_versions: [], flags: [] });
  });

  it('refuses an unknown anchor or id, and a key of neither shape', () => {
    expect(store.showEntry('ADR-777', ledger, log)).toEqual({
      ok: false, error: { kind: 'not-found', message: "show: no entry 'ADR-777' in the ledger or the log" },
    });
    expect(store.showEntry('obs_missing', ledger, log)).toMatchObject({ ok: false, error: { kind: 'not-found' } });
    expect(store.showEntry('../etc/passwd', ledger, log)).toMatchObject({ ok: false, error: { kind: 'invalid-key' } });
  });
});

// ---------------------------------------------------------------------------
// resolveVerifyRef (D-VERIFY-REF)
// ---------------------------------------------------------------------------

describe('resolveVerifyRef (D-VERIFY-REF)', { timeout: 30_000 }, () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-ref-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('resolves origin/HEAD when the repository has one, ahead of a newer HEAD', () => {
    const fetched = initGitRepo(tmp, { 'a.txt': 'one\n' });
    git(tmp, ['update-ref', 'refs/remotes/origin/main', fetched]);
    git(tmp, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    git(tmp, ['commit', '-q', '--allow-empty', '-m', 'local work']);
    expect(git(tmp, ['rev-parse', 'HEAD'])).not.toBe(fetched);
    expect(store.resolveVerifyRef(tmp)).toEqual({ ref: 'origin/HEAD', commit: fetched });
  });

  it('falls back to HEAD without origin/HEAD', () => {
    const head = initGitRepo(tmp, { 'a.txt': 'one\n' });
    expect(store.resolveVerifyRef(tmp)).toEqual({ ref: 'HEAD', commit: head });
  });

  it('falls back to HEAD when origin/HEAD points at a missing branch', () => {
    const head = initGitRepo(tmp, { 'a.txt': 'one\n' });
    fs.mkdirSync(path.join(tmp, '.git', 'refs', 'remotes', 'origin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.git', 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/gone\n');
    expect(store.resolveVerifyRef(tmp)).toEqual({ ref: 'HEAD', commit: head });
  });

  it('is null in a repository with no commit, and outside a repository', () => {
    git(tmp, ['-c', 'init.defaultBranch=main', 'init', '-q']);
    expect(store.resolveVerifyRef(tmp)).toBeNull();
    const plain = makeTmp('learning-store-ref-plain-');
    try {
      expect(store.resolveVerifyRef(plain)).toBeNull();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('learning fixtures', { timeout: 30_000 }, () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp('learning-store-fixtures-'); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('runJsonHelper reports the exit code and both streams of an op', () => {
    expect(runJsonHelper(tmp, ['get-field', 'a'], '{"a":"value"}')).toEqual({ code: 0, stdout: 'value\n', stderr: '' });
    const unknown = runJsonHelper(tmp, ['no-such-op']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('unknown operation');
  });

  it('seedLearningTree writes only the files it is given', () => {
    const p = seedLearningTree(tmp, { log: [makeV2LogRow()] });
    expect(fs.readdirSync(p.learningDir)).toEqual(['decisions-log.jsonl']);
    expect(store.readJsonl(p.log).rows).toEqual([makeV2LogRow()]);
  });

  it('daysAgoIso and daysAgoDate count back from the fixed clock', () => {
    expect(daysAgoIso(1)).toBe('2026-10-02T12:00:00.000Z');
    expect(daysAgoDate(31)).toBe('2026-09-02');
  });
});
