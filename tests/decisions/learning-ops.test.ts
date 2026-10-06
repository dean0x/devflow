// tests/decisions/learning-ops.test.ts
//
// The entry ops the Learning agent runs through json-helper.cjs, tested through
// their store functions and their stdout grammar.
//
// put-observation (--create, --update, --reinforce) stores exactly the content it
// is given and owns the counters; it re-projects and re-renders the active
// entries an observation backs under the same lock, keeps prior content in
// history, copies a v1 tree aside once and quarantines malformed lines before a
// rewrite — and an input it refuses writes nothing at all.
//
// list and show print the ledger and the log and write nothing. claim-due names
// the ref claims are checked at, hands out the due entries in order within a
// count and a byte budget, and leases each one for a day.
//
// assign-anchor promotes a v2 observation the ledger does not carry yet: it mints
// the next number of its type, skipping any number a tracked file cites, stamps
// the entry verified today and never writes the log. refresh-anchor re-projects
// active v2 entries from the log, or stamps them verified, all or nothing.
//
// retire-anchor takes each inactive status's stdin contract — a reason, an active
// successor, or a path and a quote checked at the verify ref — and restore-anchor
// makes an inactive entry active again, its notes cleared and due for checking.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  FIXTURE_NOW,
  GIT_ENV,
  JSON_HELPER,
  ROOT,
  daysAgoDate,
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
  type Citation,
  type HelperRun,
  type LearningTreePaths,
  type Row,
} from './learning-fixtures.js';

const store = requireLearningStore();

const { renderDecisionsFile } = createRequire(import.meta.url)(
  path.join(ROOT, 'src/assets/scripts/hooks/lib/render-decisions.cjs'),
) as { renderDecisionsFile: (rows: Row[], kind: 'decisions' | 'pitfalls') => string };

const NOW_ISO = new Date(FIXTURE_NOW).toISOString();

const HOUR_MS = 60 * 60 * 1000;

type PutMode = 'create' | 'update' | 'reinforce';

/** A scope matcher for store calls: every glob matches a tracked file. */
const everyGlobMatches = (): boolean => true;

function makeTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A put input: the fixture observation's content with no plumbing-owned key, then the overrides. */
function putInput(overrides: Row = {}): Row {
  return makeV2LogRow({ schema: undefined, observations: undefined, first_seen: undefined, last_seen: undefined, ...overrides });
}

/** A store put at `now` (the fixture clock by default), with every scope glob matching. */
function put(dir: string, mode: PutMode, input: unknown, now: number = FIXTURE_NOW) {
  return store.putObservation(dir, mode, input, { now, scopeMatches: everyGlobMatches });
}

/** Run the put-observation op with `input` serialized as its stdin. */
function putOp(dir: string, mode: PutMode, input: unknown): HelperRun {
  return runJsonHelper(dir, ['put-observation', `--${mode}`], JSON.stringify(input));
}

/**
 * Run json-helper with `file` as its stdin, as a shell redirect or a heredoc hands
 * it over: the op may stop reading early without the writer seeing a broken pipe.
 */
function runWithStdinFile(cwd: string, args: readonly string[], file: string): HelperRun {
  const fd = fs.openSync(file, 'r');
  try {
    const run = spawnSync(process.execPath, [JSON_HELPER, ...args], {
      cwd,
      env: GIT_ENV,
      stdio: [fd, 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (run.error) throw run.error;
    return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  } finally {
    fs.closeSync(fd);
  }
}

/** The rows of a JSONL file. */
function rowsOf(file: string): Row[] {
  return store.readJsonl(file).rows;
}

/** The non-blank lines of a file, or none when it is absent. */
function linesOf(file: string): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

/** A rendered file under the learning directory. */
function rendered(paths: LearningTreePaths, name: 'decisions.md' | 'pitfalls.md' | 'index.md'): string {
  return fs.readFileSync(path.join(paths.learningDir, name), 'utf8');
}

// ---------------------------------------------------------------------------
// putObservation: create
// ---------------------------------------------------------------------------

describe('putObservation: create', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-create-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stores exactly the given content after the schema, with the counters plumbing owns', () => {
    const input = putInput({ id: 'obs_new_one' });
    expect(put(dir, 'create', input)).toEqual({
      ok: true,
      value: { outcome: 'created', id: 'obs_new_one', observations: 1, reprojected: [] },
    });
    const [row] = rowsOf(paths.log);
    expect(row).toEqual({ schema: 2, ...input, observations: 1, first_seen: NOW_ISO, last_seen: NOW_ISO });
    expect(Object.keys(row)).toEqual([
      'schema', 'id', 'type', 'title', 'rule', 'why', 'scope', 'provenance', 'evidence',
      'observations', 'first_seen', 'last_seen',
    ]);
  });

  it('appends to the log and leaves the rows already there byte for byte', () => {
    seedLearningTree(dir, { log: [makeV2LogRow(), makeV1LogRow()] });
    const before = linesOf(paths.log);
    put(dir, 'create', putInput({ id: 'obs_new_one' }));
    const after = linesOf(paths.log);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after.map(line => JSON.parse(line).id)).toEqual(['obs_store_one', 'obs_legacy_one', 'obs_new_one']);
  });

  it('refuses an id the log already holds and writes nothing', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const before = snapshotTree(dir);
    expect(put(dir, 'create', putInput())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', problems: [{ field: 'id', message: 'is already in the log; update it instead' }] },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('repairs an active entry that has no log row: it projects the new row onto the entry and re-renders', () => {
    const prior = makeV1LedgerRow({ id: 'obs_orphan' });
    seedLearningTree(dir, { ledger: [prior] });
    const input = putInput({ id: 'obs_orphan', type: 'pitfall', title: 'Edit hook sources, not their installed copies' });

    expect(put(dir, 'create', input)).toEqual({
      ok: true,
      value: { outcome: 'created', id: 'obs_orphan', observations: 1, reprojected: ['PF-001'] },
    });
    const [logRow] = rowsOf(paths.log);
    const ledgerRows = rowsOf(paths.ledger);
    expect(ledgerRows).toEqual([store.toLedgerRowV2(logRow, prior)]);
    expect(rendered(paths, 'pitfalls.md')).toBe(renderDecisionsFile(ledgerRows, 'pitfalls'));
    expect(rendered(paths, 'pitfalls.md')).toContain('Edit hook sources, not their installed copies');
  });

  it('refuses a type the entry it would re-project does not have, and writes nothing', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow({ id: 'obs_orphan' })] });
    const before = snapshotTree(dir);
    expect(put(dir, 'create', putInput({ id: 'obs_orphan', type: 'decision' }))).toEqual({
      ok: false,
      error: {
        kind: 'cannot-reproject',
        message: 'put-observation: PF-001 cannot take this observation: it is a pitfall entry and the observation is a decision; nothing was written',
      },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses an entry whose anchor does not name the type it holds, and writes nothing', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow({ id: 'obs_orphan', anchor_id: 'ADR-004' })] });
    const before = snapshotTree(dir);
    expect(put(dir, 'create', putInput({ id: 'obs_orphan', type: 'pitfall' }))).toMatchObject({
      ok: false,
      error: { kind: 'cannot-reproject', message: expect.stringContaining('its anchor does not name a pitfall entry') },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// putObservation: update (D-PUT-NOT-MERGE)
// ---------------------------------------------------------------------------

describe('putObservation: update (D-PUT-NOT-MERGE)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-update-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the whole content and never merges: a key the new content leaves out is gone', () => {
    seedLearningTree(dir, { log: [makeV2LogRow({ observations: 4 })] });
    const input = putInput({ rule: 'Every store function returns a Result; none throws.', evidence: undefined });
    expect(put(dir, 'update', input)).toEqual({
      ok: true,
      value: { outcome: 'updated', id: 'obs_store_one', observations: 4, reprojected: [] },
    });
    expect(rowsOf(paths.log)).toEqual([{
      schema: 2, ...input, observations: 4, first_seen: '2026-09-01T00:00:00.000Z', last_seen: '2026-09-01T00:00:00.000Z',
    }]);
  });

  it('converts a v1 row: count becomes observations, created becomes first_seen, and nothing else of it stays', () => {
    const v1 = makeV1LogRow({
      observations: undefined,
      first_seen: undefined,
      count: 4,
      created: '2026-05-01T00:00:00.000Z',
      amendments: [{ date: '2026-06-01', note: 'kept by the history and the backup, not by the live row' }],
      evidence: Array.from({ length: 7 }, (_, i) => `quote number ${i}`),
    });
    seedLearningTree(dir, { log: [v1] });
    const input = putInput({ id: 'obs_legacy_one', type: 'pitfall' });

    expect(put(dir, 'update', input)).toMatchObject({ ok: true, value: { outcome: 'updated', observations: 4 } });
    expect(rowsOf(paths.log)).toEqual([{
      schema: 2, ...input, observations: 4, first_seen: '2026-05-01T00:00:00.000Z', last_seen: '2026-07-01T00:00:00.000Z',
    }]);
  });

  it('refuses a type change and writes nothing', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const before = snapshotTree(dir);
    expect(put(dir, 'update', putInput({ type: 'pitfall' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', problems: [{ field: 'type', message: "cannot change from 'decision' to 'pitfall'" }] },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses an id the log does not hold', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    expect(put(dir, 'update', putInput({ id: 'obs_absent' }))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', problems: [{ field: 'id', message: 'is not in the log' }] },
    });
  });

  it('answers unchanged and writes nothing when the content is what the log already holds', () => {
    seedLearningTree(dir, { log: [makeV2LogRow({ observations: 2 })], ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    expect(put(dir, 'update', putInput())).toEqual({
      ok: true,
      value: { outcome: 'unchanged', id: 'obs_store_one', observations: 2, reprojected: [] },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('converts a v1 row even when its content keys already match', () => {
    const input = putInput({ id: 'obs_legacy_one', type: 'pitfall' });
    seedLearningTree(dir, { log: [{ ...makeV1LogRow(), ...input }] });
    expect(put(dir, 'update', input)).toMatchObject({ ok: true, value: { outcome: 'updated' } });
    expect(rowsOf(paths.log)[0].schema).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// putObservation: reinforce
// ---------------------------------------------------------------------------

describe('putObservation: reinforce', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-reinforce-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds one observation and moves last_seen to now, touching nothing else', () => {
    seedLearningTree(dir, { log: [makeV2LogRow({ observations: 2 })], ledger: [makeV2LedgerRow()] });
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    expect(put(dir, 'reinforce', { id: 'obs_store_one' })).toEqual({
      ok: true,
      value: { outcome: 'reinforced', id: 'obs_store_one', observations: 3, reprojected: [] },
    });
    expect(rowsOf(paths.log)).toEqual([makeV2LogRow({ observations: 3, last_seen: NOW_ISO })]);
    expect(fs.readFileSync(paths.ledger, 'utf8')).toBe(ledgerBefore);
    // No history, no render: the learning directory holds just the two files it held.
    expect(fs.readdirSync(paths.learningDir).sort()).toEqual(['decisions-ledger.jsonl', 'decisions-log.jsonl']);
  });

  it('works on a v1 row: its legacy counters convert and every other key stays', () => {
    const v1 = makeV1LogRow({ observations: undefined, first_seen: undefined, count: 4, created: '2026-05-01T00:00:00.000Z' });
    seedLearningTree(dir, { log: [v1] });

    expect(put(dir, 'reinforce', { id: 'obs_legacy_one' })).toMatchObject({
      ok: true,
      value: { outcome: 'reinforced', observations: 5 },
    });
    const { count: _count, created: _created, ...kept } = v1;
    expect(rowsOf(paths.log)).toEqual([{
      ...kept, observations: 5, first_seen: '2026-05-01T00:00:00.000Z', last_seen: NOW_ISO,
    }]);
  });

  it('takes the id alone', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    expect(put(dir, 'reinforce', { id: 'obs_store_one', title: 'A new title' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid-input', problems: [{ field: 'title' }] },
    });
  });
});

// ---------------------------------------------------------------------------
// putObservation: the entries an observation backs (D-PUT-REPROJECTS)
// ---------------------------------------------------------------------------

describe('putObservation: the entries an observation backs (D-PUT-REPROJECTS)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-reproject-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an update re-projects each active entry carrying the id and re-renders; an inactive one stays byte for byte', () => {
    const active = makeV2LedgerRow();
    const retired = makeV2LedgerRow({
      anchor_id: 'ADR-002', decisions_status: 'Superseded', superseded_by: 'ADR-001', title: 'The wording it was retired with',
    });
    const unrelated = makeV1LedgerRow();
    seedLearningTree(dir, { log: [makeV2LogRow(), makeV1LogRow()], ledger: [active, retired, unrelated] });
    const [, retiredLine, unrelatedLine] = linesOf(paths.ledger);

    const input = putInput({ title: 'Store functions return a Result and never throw', rule: 'A sharper rule.' });
    expect(put(dir, 'update', input)).toEqual({
      ok: true,
      value: { outcome: 'updated', id: 'obs_store_one', observations: 1, reprojected: ['ADR-001'] },
    });

    const [logRow] = rowsOf(paths.log);
    const ledgerLines = linesOf(paths.ledger);
    expect(JSON.parse(ledgerLines[0])).toEqual(store.toLedgerRowV2(logRow, active));
    expect(ledgerLines.slice(1)).toEqual([retiredLine, unrelatedLine]);

    const ledgerRows = rowsOf(paths.ledger);
    expect(rendered(paths, 'decisions.md')).toBe(renderDecisionsFile(ledgerRows, 'decisions'));
    expect(rendered(paths, 'pitfalls.md')).toBe(renderDecisionsFile(ledgerRows, 'pitfalls'));
    expect(rendered(paths, 'decisions.md')).toContain(': Store functions return a Result and never throw\n');
    expect(rendered(paths, 'index.md')).toContain('Store functions return a Result and never throw');
  });

  it('re-projects every active entry when two carry the same id', () => {
    const first = makeV1LedgerRow({ anchor_id: 'PF-002' });
    const second = makeV1LedgerRow({ anchor_id: 'PF-007', date: '2026-08-01' });
    seedLearningTree(dir, { log: [makeV1LogRow()], ledger: [second, first] });
    const input = putInput({ id: 'obs_legacy_one', type: 'pitfall' });

    expect(put(dir, 'update', input)).toMatchObject({ ok: true, value: { reprojected: ['PF-002', 'PF-007'] } });
    const [logRow] = rowsOf(paths.log);
    expect(rowsOf(paths.ledger)).toEqual([store.toLedgerRowV2(logRow, second), store.toLedgerRowV2(logRow, first)]);
  });

  it('rewriting a v1 entry through its observation makes it a v2 entry with its anchor, status and date', () => {
    seedLearningTree(dir, { log: [makeV1LogRow()], ledger: [makeV1LedgerRow({ date: '2026-06-15' })] });
    const input = putInput({ id: 'obs_legacy_one', type: 'pitfall', title: 'Edit hook sources, not their installed copies' });

    expect(put(dir, 'update', input)).toMatchObject({ ok: true, value: { reprojected: ['PF-001'] } });
    expect(rowsOf(paths.ledger)).toEqual([{
      schema: 2,
      id: 'obs_legacy_one',
      type: 'pitfall',
      anchor_id: 'PF-001',
      decisions_status: 'Active',
      title: input.title,
      rule: input.rule,
      why: input.why,
      scope: input.scope,
      provenance: input.provenance,
      date: '2026-06-15',
    }]);
    expect(rendered(paths, 'pitfalls.md')).toContain(': Edit hook sources, not their installed copies\n');
  });

  it('gives an active entry with no status its type\'s active status', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow({ decisions_status: undefined })] });
    expect(put(dir, 'update', putInput({ rule: 'A sharper rule.' })).ok).toBe(true);
    expect(rowsOf(paths.ledger)[0].decisions_status).toBe('Accepted');
  });

  it('refuses with restore first, writing nothing, when every entry carrying the id is inactive', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow()],
      ledger: [makeV2LedgerRow({ decisions_status: 'Retired', status_note: 'a one-off' })],
    });
    const before = snapshotTree(dir);
    const restoreFirst = {
      ok: false,
      error: { kind: 'restore-first', message: "put-observation: 'obs_store_one' belongs only to inactive entries (ADR-001 Retired); restore first" },
    };
    expect(put(dir, 'update', putInput({ rule: 'A sharper rule.' }))).toEqual(restoreFirst);
    expect(put(dir, 'reinforce', { id: 'obs_store_one' })).toEqual(restoreFirst);
    expect(snapshotTree(dir)).toEqual(before);

    seedLearningTree(dir, { log: [] });
    const beforeCreate = snapshotTree(dir);
    expect(put(dir, 'create', putInput())).toEqual(restoreFirst);
    expect(snapshotTree(dir)).toEqual(beforeCreate);
  });
});

// ---------------------------------------------------------------------------
// putObservation: content history (D-CONTENT-HISTORY)
// ---------------------------------------------------------------------------

describe('putObservation: content history (D-CONTENT-HISTORY)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-history-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records the prior log row and ledger rows before an update', () => {
    const ledgerRow = makeV2LedgerRow();
    const logRow = makeV2LogRow();
    seedLearningTree(dir, { log: [logRow], ledger: [ledgerRow] });
    put(dir, 'update', putInput({ rule: 'A sharper rule.' }));
    expect(store.historyVersions(dir, 'obs_store_one')).toEqual([{ id: 'obs_store_one', at: NOW_ISO, ledger: [ledgerRow], log: logRow }]);
  });

  it('keeps the last three prior versions of an entry, oldest first', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    const priorLogs: Row[] = [];
    const priorLedgers: Row[][] = [];
    ['Rule one.', 'Rule two.', 'Rule three.', 'Rule four.'].forEach((rule, i) => {
      priorLogs.push(rowsOf(paths.log)[0]);
      priorLedgers.push(rowsOf(paths.ledger));
      expect(put(dir, 'update', putInput({ rule }), FIXTURE_NOW + i * 1000)).toMatchObject({ ok: true, value: { outcome: 'updated' } });
    });

    const versions = store.historyVersions(dir, 'obs_store_one');
    expect(versions.map(v => v.log)).toEqual(priorLogs.slice(1));
    expect(versions.map(v => v.ledger)).toEqual(priorLedgers.slice(1));
    expect(versions.map(v => v.at)).toEqual([1, 2, 3].map(i => new Date(FIXTURE_NOW + i * 1000).toISOString()));
  });

  it('keeps what a v1 rewrite drops — the old log and ledger rows, amendments and over-limit evidence included — in history and the pre-v2 backup', () => {
    const v1Log = makeV1LogRow({
      amendments: [{ date: '2026-06-01', note: 'a correction only the log row holds' }],
      evidence: Array.from({ length: 7 }, (_, i) => `quote number ${i}`),
    });
    const v1Ledger = makeV1LedgerRow({
      details: 'area: hooks; issue: a detail only the ledger row holds',
      amendments: [{ date: '2026-06-02', note: 'a correction only the ledger row holds' }],
    });
    seedLearningTree(dir, { log: [v1Log], ledger: [v1Ledger] });

    expect(put(dir, 'update', putInput({ id: 'obs_legacy_one', type: 'pitfall' }))).toMatchObject({
      ok: true, value: { outcome: 'updated', reprojected: ['PF-001'] },
    });
    expect(rowsOf(paths.log)[0]).not.toHaveProperty('amendments');
    expect(rowsOf(paths.ledger)[0]).not.toHaveProperty('details');
    expect(store.historyVersions(dir, 'obs_legacy_one')).toEqual([{ id: 'obs_legacy_one', at: NOW_ISO, ledger: [v1Ledger], log: v1Log }]);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-log.pre-v2.jsonl'))).toEqual([v1Log]);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-ledger.pre-v2.jsonl'))).toEqual([v1Ledger]);
  });

  it('records the entries a create repairs, with no prior log row', () => {
    const prior = makeV1LedgerRow({ id: 'obs_orphan' });
    seedLearningTree(dir, { ledger: [prior] });
    put(dir, 'create', putInput({ id: 'obs_orphan', type: 'pitfall' }));
    expect(store.historyVersions(dir, 'obs_orphan')).toEqual([{ id: 'obs_orphan', at: NOW_ISO, ledger: [prior], log: null }]);
  });

  it('records nothing for a reinforce, an unchanged update or a create no entry carries', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    expect(put(dir, 'reinforce', { id: 'obs_store_one' })).toMatchObject({ ok: true, value: { outcome: 'reinforced' } });
    expect(put(dir, 'update', putInput())).toMatchObject({ ok: true, value: { outcome: 'unchanged' } });
    expect(put(dir, 'create', putInput({ id: 'obs_new_one' }))).toMatchObject({ ok: true, value: { outcome: 'created' } });
    expect(fs.existsSync(paths.history)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// putObservation: the pre-v2 backup (D-V1-BACKUP-ONCE)
// ---------------------------------------------------------------------------

describe('putObservation: the pre-v2 backup (D-V1-BACKUP-ONCE)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-backup-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the first write to a tree holding v1 rows copies the log, the ledger and the archive aside, once', () => {
    seedLearningTree(dir, {
      log: [makeV1LogRow()],
      ledger: [makeV1LedgerRow()],
      archive: [makeV1LogRow({ id: 'obs_archived' })],
    });
    const originals = [paths.log, paths.ledger, paths.archive].map(file => fs.readFileSync(file, 'utf8'));
    const copies = ['decisions-log.pre-v2.jsonl', 'decisions-ledger.pre-v2.jsonl', 'decisions-log.archive.pre-v2.jsonl']
      .map(name => path.join(paths.learningDir, name));

    expect(put(dir, 'reinforce', { id: 'obs_legacy_one' }).ok).toBe(true);
    expect(copies.map(file => fs.readFileSync(file, 'utf8'))).toEqual(originals);

    expect(put(dir, 'create', putInput({ id: 'obs_new_one' })).ok).toBe(true);
    expect(put(dir, 'update', putInput({ id: 'obs_legacy_one', type: 'pitfall' })).ok).toBe(true);
    expect(fs.readFileSync(paths.log, 'utf8')).not.toBe(originals[0]);
    expect(copies.map(file => fs.readFileSync(file, 'utf8'))).toEqual(originals);
  });

  it('a tree holding only v2 rows gets no copy', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    expect(put(dir, 'update', putInput({ rule: 'A sharper rule.' })).ok).toBe(true);
    expect(fs.readdirSync(paths.learningDir).filter(name => name.includes('pre-v2'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// putObservation: malformed lines (D-QUARANTINE-MALFORMED)
// ---------------------------------------------------------------------------

describe('putObservation: malformed lines (D-QUARANTINE-MALFORMED)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-malformed-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('quarantines the log\'s malformed lines before it rewrites the log', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    fs.appendFileSync(paths.log, '{"id": "obs_cut_off"\n');
    put(dir, 'create', putInput({ id: 'obs_new_one' }));
    expect(linesOf(paths.log).map(line => JSON.parse(line).id)).toEqual(['obs_store_one', 'obs_new_one']);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-log.rejected.jsonl'))).toEqual([
      { rejected_at: NOW_ISO, source: 'decisions-log.jsonl', line: 2, text: '{"id": "obs_cut_off"' },
    ]);
  });

  it('quarantines the ledger\'s malformed lines before it re-projects into the ledger', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    fs.appendFileSync(paths.ledger, 'not json\n');
    put(dir, 'update', putInput({ rule: 'A sharper rule.' }));
    expect(linesOf(paths.ledger)).toHaveLength(1);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-ledger.rejected.jsonl')).map(r => r.text)).toEqual(['not json']);
  });

  it('leaves the ledger and its malformed lines alone when it does not rewrite the ledger', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow({ id: 'obs_other' })] });
    fs.appendFileSync(paths.ledger, 'not json\n');
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');
    expect(put(dir, 'reinforce', { id: 'obs_store_one' }).ok).toBe(true);
    expect(fs.readFileSync(paths.ledger, 'utf8')).toBe(ledgerBefore);
    expect(fs.existsSync(path.join(paths.learningDir, 'decisions-ledger.rejected.jsonl'))).toBe(false);
  });

  it('refuses an id the log holds twice, and writes nothing', () => {
    seedLearningTree(dir, { log: [makeV2LogRow(), makeV2LogRow({ rule: 'A second copy of the same observation.' })] });
    const before = snapshotTree(dir);
    expect(put(dir, 'reinforce', { id: 'obs_store_one' })).toEqual({
      ok: false,
      error: { kind: 'duplicate-log-id', message: "put-observation: the log holds 2 rows with id 'obs_store_one'; nothing was written" },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The put-observation op: argv, stdin and the stdout grammar
// ---------------------------------------------------------------------------

describe('put-observation op', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-put-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints created, updated, unchanged and reinforced, then each anchor it re-projected', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    expect(putOp(dir, 'create', putInput())).toEqual({ code: 0, stdout: 'created obs_store_one\nreprojected ADR-001\n', stderr: '' });
    expect(putOp(dir, 'update', putInput({ rule: 'A sharper rule.' }))).toEqual({
      code: 0, stdout: 'updated obs_store_one\nreprojected ADR-001\n', stderr: '',
    });
    expect(putOp(dir, 'update', putInput({ rule: 'A sharper rule.' }))).toEqual({ code: 0, stdout: 'unchanged obs_store_one\n', stderr: '' });
    expect(putOp(dir, 'reinforce', { id: 'obs_store_one' })).toEqual({ code: 0, stdout: 'reinforced obs_store_one 2\n', stderr: '' });
    expect(putOp(dir, 'create', putInput({ id: 'obs_unanchored' }))).toEqual({ code: 0, stdout: 'created obs_unanchored\n', stderr: '' });
  });

  it('refuses every violation of an input in one error and writes nothing', () => {
    initGitRepo(dir, { 'src/app.ts': 'export {};\n' });
    seedLearningTree(dir, { log: [makeV1LogRow()], ledger: [makeV2LedgerRow()] });
    // A writer would back this v1 tree up and quarantine this line: neither may happen.
    fs.appendFileSync(paths.log, 'not json\n');
    const before = snapshotTree(paths.learningDir);

    const run = putOp(dir, 'create', {
      id: 'obs_bad_input',
      type: 'decision',
      title: 'Fixed for good in #123',
      rule: 'Always follow ADR-001 here.',
      why: 'The guard lives at json-helper.cjs:42.',
      scope: ['nomatch/**'],
      provenance: 'p'.repeat(121),
      color: 'blue',
      observations: 3,
    });
    expect(run).toEqual({
      code: 1,
      stdout: '',
      stderr: [
        'put-observation: the input has 7 problems; nothing was written',
        '  color: is not a known key',
        '  observations: is set by plumbing, never by the caller',
        '  title: carries an issue reference; state what it established instead',
        '  rule: names ledger entry ADR-001; state the rule in words',
        '  why: carries a file-and-line reference; name the function or quote the line instead',
        '  scope[0]: matches no tracked file',
        '  provenance: is 121 characters, over the limit of 120',
        '',
      ].join('\n'),
    });
    expect(snapshotTree(paths.learningDir)).toEqual(before);
  });

  it('names a ledger entry, an issue and a file and line in one title as three problems of one refusal, and writes nothing', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(paths.learningDir);
    expect(putOp(dir, 'create', putInput({ id: 'obs_three_refs', title: 'Follow ADR-001 until #12 lands at store.cjs:88' }))).toEqual({
      code: 1,
      stdout: '',
      stderr: [
        'put-observation: the input has 3 problems; nothing was written',
        '  title: names ledger entry ADR-001; state the rule in words',
        '  title: carries an issue reference; state what it established instead',
        '  title: carries a file-and-line reference; name the function or quote the line instead',
        '',
      ].join('\n'),
    });
    expect(snapshotTree(paths.learningDir)).toEqual(before);
  });

  it('accepts a key from another tracker, an anchor number the ledger does not hold and area scopes', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ id: 'obs_other' })] });
    expect(putOp(dir, 'create', putInput({
      id: 'obs_cross_ref',
      title: 'Settled upstream under PROJ-123',
      rule: 'A number such as ADR-777, which the ledger does not hold, is plain text.',
      scope: ['area:learning', 'area:hooks'],
    }))).toEqual({ code: 0, stdout: 'created obs_cross_ref\n', stderr: '' });
  });

  it('checks a glob scope against the files git tracks', () => {
    initGitRepo(dir, { 'src/app.ts': 'export {};\n' });
    expect(putOp(dir, 'create', putInput({ id: 'obs_globbed', scope: ['src/**/*.ts'] }))).toEqual({
      code: 0, stdout: 'created obs_globbed\n', stderr: '',
    });
  });

  it('names a one-problem refusal in the singular', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    expect(putOp(dir, 'reinforce', { id: 'obs_store_one', title: 'A new title' }).stderr).toBe(
      'put-observation: the input has 1 problem; nothing was written\n'
      + '  title: is not taken by a reinforce, which carries the id alone\n',
    );
  });

  it('shows an unknown key that is not a plain name as JSON, on one line', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    expect(putOp(dir, 'reinforce', { id: 'obs_store_one', 'two\nlines': 1 }).stderr).toBe(
      'put-observation: the input has 1 problem; nothing was written\n'
      + '  "two\\nlines": is not a known key\n',
    );
  });

  it('names restore first for an observation whose entries are all inactive', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow({ decisions_status: 'Retired' })] });
    expect(putOp(dir, 'reinforce', { id: 'obs_store_one' })).toEqual({
      code: 1,
      stdout: '',
      stderr: "put-observation: 'obs_store_one' belongs only to inactive entries (ADR-001 Retired); restore first\n",
    });
  });

  it('takes exactly one of --create, --update and --reinforce, and nothing else', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const before = snapshotTree(dir);
    for (const args of [
      ['put-observation'],
      ['put-observation', '--create', '--update'],
      ['put-observation', '--merge'],
      ['put-observation', 'obs_store_one'],
      ['put-observation', '__proto__'],
      ['put-observation', 'create'],
    ]) {
      expect(runJsonHelper(dir, args, JSON.stringify(putInput())), args.join(' ')).toEqual({
        code: 1,
        stdout: '',
        stderr: 'put-observation: usage: put-observation --create|--update|--reinforce (one JSON object on stdin; run from the project root)\n',
      });
    }
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses stdin that is not exactly one JSON object', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const before = snapshotTree(dir);
    for (const stdin of ['', 'not json', '[{"id":"obs_store_one"}]', '"obs_store_one"', 'null', '{"id":"obs_store_one"} {"id":"obs_other"}']) {
      expect(runJsonHelper(dir, ['put-observation', '--reinforce'], stdin), JSON.stringify(stdin)).toEqual({
        code: 1, stdout: '', stderr: 'put-observation: stdin must hold one JSON object\n',
      });
    }
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses stdin over 64 KiB without parsing it', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const stdinFile = path.join(dir, 'oversized.json');
    fs.writeFileSync(stdinFile, JSON.stringify({ id: 'obs_store_one', padding: 'x'.repeat(70_000) }));
    const before = snapshotTree(paths.learningDir);
    expect(runWithStdinFile(dir, ['put-observation', '--reinforce'], stdinFile)).toEqual({
      code: 1, stdout: '', stderr: 'put-observation: stdin holds more than 65536 bytes; it must hold one JSON object\n',
    });
    expect(snapshotTree(paths.learningDir)).toEqual(before);
  });

  it('takes stdin at exactly 64 KiB', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const body = JSON.stringify({ id: 'obs_store_one' });
    const stdinFile = path.join(dir, 'at-bound.json');
    fs.writeFileSync(stdinFile, body + ' '.repeat(65_536 - body.length));
    expect(runWithStdinFile(dir, ['put-observation', '--reinforce'], stdinFile)).toEqual({
      code: 0, stdout: 'reinforced obs_store_one 2\n', stderr: '',
    });
  });

  it('accepts the trailing newline a heredoc leaves', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    expect(runJsonHelper(dir, ['put-observation', '--reinforce'], '{"id": "obs_store_one"}\n')).toEqual({
      code: 0, stdout: 'reinforced obs_store_one 2\n', stderr: '',
    });
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/** A tree with each kind of row list shows: active and inactive entries of both schemas, unpromoted observations and an entry with no log row. */
const LIST_LEDGER: Row[] = [
  makeV2LedgerRow({
    anchor_id: 'ADR-002', id: 'obs_beta', title: 'Second decision', scope: ['area:learning', 'area:hooks'], last_verified: '2026-09-20',
  }),
  makeV2LedgerRow(),
  makeV1LedgerRow(),
  makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_gamma', decisions_status: 'Superseded', superseded_by: 'ADR-001', title: 'Old decision' }),
  makeV1LedgerRow({ anchor_id: 'PF-002', id: 'obs_old', pattern: 'Old lesson', decisions_status: 'Retired' }),
  makeV2LedgerRow({
    anchor_id: 'PF-003', id: 'obs_orphan', type: 'pitfall', decisions_status: 'Active', title: 'Orphan entry', last_verified: undefined,
  }),
];

const LIST_LOG: Row[] = [
  makeV2LogRow(),
  makeV2LogRow({
    id: 'obs_beta', title: 'Second decision', scope: ['area:learning', 'area:hooks'], observations: 3, last_seen: '2026-09-28T10:30:00.000Z',
  }),
  makeV1LogRow(),
  makeV2LogRow({ id: 'obs_gamma', title: 'Old decision' }),
  makeV2LogRow({ id: 'obs_zeta', type: 'pitfall', title: 'Unpromoted lesson', observations: 3 }),
  makeV1LogRow({ id: 'obs_eta', pattern: 'Legacy\nunpromoted', observations: undefined }),
];

/** What list prints for LIST_LEDGER and LIST_LOG. */
const LISTING: readonly string[] = [
  'ACTIVE 4',
  '  ADR-001 obs_store_one v2 verified 2026-09-01 observed 1 last-seen 2026-09-01T00:00:00.000Z scope area:learning Store functions return a Result',
  '  ADR-002 obs_beta v2 verified 2026-09-20 observed 3 last-seen 2026-09-28T10:30:00.000Z scope area:learning,area:hooks Second decision',
  '  PF-001 obs_legacy_one v1 verified never observed 2 last-seen 2026-07-01T00:00:00.000Z scope - Editing installed hook scripts instead of their source',
  '  PF-003 obs_orphan v2 verified never observed ? last-seen - scope area:learning Orphan entry',
  'INACTIVE 2',
  '  ADR-003 obs_gamma v2 Superseded Old decision',
  '    note: superseded by ADR-001',
  '  PF-002 obs_old v1 Retired Old lesson',
  'OBSERVATIONS 2',
  '  obs_eta pitfall v1 observed ? Legacy unpromoted',
  '  obs_zeta pitfall v2 observed 3 Unpromoted lesson',
  'INTEGRITY 1',
  '  PF-003 obs_orphan ledger-without-log',
];

describe('list', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-list-');
    paths = learningPaths(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints the active, inactive, observation and integrity sections', () => {
    seedLearningTree(dir, { ledger: LIST_LEDGER, log: LIST_LOG });
    expect(runJsonHelper(dir, ['list'])).toEqual({ code: 0, stdout: `${LISTING.join('\n')}\n`, stderr: '' });
  });

  it('adds a MALFORMED section only when lines were skipped, and writes nothing', () => {
    seedLearningTree(dir, { ledger: LIST_LEDGER, log: LIST_LOG });
    // A writer would back this v1 tree up and quarantine these lines: list may do neither.
    fs.appendFileSync(paths.ledger, 'not json\n');
    fs.appendFileSync(paths.log, '[1]\n{"cut":\n');
    const before = snapshotTree(dir);
    expect(runJsonHelper(dir, ['list'])).toEqual({
      code: 0,
      stdout: `${[...LISTING, 'MALFORMED 3', '  ledger 1', '  log 2'].join('\n')}\n`,
      stderr: '',
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('flags an entry whose scope matches no file git tracks', () => {
    initGitRepo(dir, { 'src/app.ts': 'export {};\n' });
    seedLearningTree(dir, {
      ledger: [makeV2LedgerRow({ scope: ['src/**', 'gone/**'] })],
      log: [makeV2LogRow({ scope: ['src/**', 'gone/**'] })],
    });
    expect(runJsonHelper(dir, ['list']).stdout).toContain('\nINTEGRITY 1\n  ADR-001 obs_store_one scope-matches-nothing\n');
  });

  it('prints every section empty for an empty learning tree', () => {
    seedLearningTree(dir);
    expect(runJsonHelper(dir, ['list'])).toEqual({
      code: 0, stdout: 'ACTIVE 0\nINACTIVE 0\nOBSERVATIONS 0\nINTEGRITY 0\n', stderr: '',
    });
  });

  it('takes no argument', () => {
    seedLearningTree(dir);
    expect(runJsonHelper(dir, ['list', 'ADR-001'])).toEqual({
      code: 1, stdout: '', stderr: 'list: usage: list (no arguments; run from the project root)\n',
    });
  });

  it('refuses without a learning directory and creates nothing', () => {
    expect(runJsonHelper(dir, ['list'])).toEqual({
      code: 1, stdout: '', stderr: `list: no .devflow/learning/ under ${dir} — run from the project root\n`,
    });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('formatListing', () => {
  it('prints a missing or spaced token as -, so every line keeps its fields before the title', () => {
    const listing = store.buildListing([
      makeV2LedgerRow({ id: undefined }),
      makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs with spaces', title: '' }),
      makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_odd', last_verified: 'last week', scope: ['area:a', 'src/a b'], title: 'Odd row' }),
      makeV2LedgerRow({ anchor_id: 'ADR-004', id: 'obs_bare', scope: [], title: 'Bare row' }),
    ], []);
    expect(store.formatListing(listing).split('\n').slice(0, 5)).toEqual([
      'ACTIVE 4',
      '  ADR-001 - v2 verified 2026-09-01 observed ? last-seen - scope area:learning Store functions return a Result',
      '  ADR-002 - v2 verified 2026-09-01 observed ? last-seen - scope area:learning -',
      '  ADR-003 obs_odd v2 verified - observed ? last-seen - scope area:a,- Odd row',
      '  ADR-004 obs_bare v2 verified 2026-09-01 observed ? last-seen - scope - Bare row',
    ]);
  });
});

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

describe('show', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-show-');
    paths = learningPaths(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints the entry as pretty JSON: its ledger rows, its log row, its history and its flags', () => {
    const ledgerRow = makeV2LedgerRow({ rule: 'An older rule kept only in the ledger.' });
    const logRow = makeV2LogRow();
    seedLearningTree(dir, { ledger: [ledgerRow], log: [logRow] });
    store.appendHistory(dir, { id: 'obs_store_one', ledger: [], log: logRow }, { now: FIXTURE_NOW });

    expect(runJsonHelper(dir, ['show', 'ADR-001'])).toEqual({
      code: 0,
      stderr: '',
      stdout: `${JSON.stringify({
        key: 'ADR-001',
        ledger: [ledgerRow],
        log: logRow,
        history_versions: [{ id: 'obs_store_one', at: NOW_ISO, ledger: [], log: logRow }],
        flags: [{ anchor_id: 'ADR-001', flag: 'ledger-only-content', fields: ['rule'] }],
      }, null, 2)}\n`,
    });
  });

  it('finds an entry by its observation id, with every entry that carries it', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow({ anchor_id: 'PF-009' }), makeV1LedgerRow()], log: [makeV1LogRow()] });
    const shown = JSON.parse(runJsonHelper(dir, ['show', 'obs_legacy_one']).stdout) as { key: string; ledger: Row[] };
    expect(shown.key).toBe('obs_legacy_one');
    expect(shown.ledger.map(row => row.anchor_id)).toEqual(['PF-001', 'PF-009']);
  });

  it('adds the skipped-line counts only when lines were skipped, and writes nothing', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow()], log: [makeV1LogRow()] });
    expect(JSON.parse(runJsonHelper(dir, ['show', 'PF-001']).stdout)).not.toHaveProperty('malformed');

    // A writer would back this v1 tree up and quarantine this line: show may do neither.
    fs.appendFileSync(paths.ledger, 'not json\n');
    const before = snapshotTree(dir);
    const shown = JSON.parse(runJsonHelper(dir, ['show', 'PF-001']).stdout) as Row;
    expect(Object.keys(shown)).toEqual(['key', 'ledger', 'log', 'history_versions', 'flags', 'malformed']);
    expect(shown.malformed).toEqual({ ledger: 1, log: 0 });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('exits 1 for an entry neither file holds, and says when skipped lines might hold it', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()], log: [makeV2LogRow()] });
    expect(runJsonHelper(dir, ['show', 'ADR-777'])).toEqual({
      code: 1, stdout: '', stderr: "show: no entry 'ADR-777' in the ledger or the log\n",
    });
    fs.appendFileSync(paths.log, 'not json\n');
    expect(runJsonHelper(dir, ['show', 'obs_missing'])).toEqual({
      code: 1,
      stdout: '',
      stderr: "show: no entry 'obs_missing' in the ledger or the log; MALFORMED 1 (ledger 0, log 1): a skipped line may hold it\n",
    });
  });

  it('takes exactly one anchor or observation id', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()], log: [makeV2LogRow()] });
    for (const args of [['show'], ['show', 'ADR-001', 'ADR-001'], ['show', '../etc/passwd'], ['show', 'adr-001'], ['show', '--all']]) {
      expect(runJsonHelper(dir, args), args.join(' ')).toEqual({
        code: 1, stdout: '', stderr: 'show: usage: show <anchor|obs_id> (run from the project root)\n',
      });
    }
  });

  it('refuses without a learning directory and creates nothing', () => {
    expect(runJsonHelper(dir, ['show', 'ADR-001'])).toEqual({
      code: 1, stdout: '', stderr: `show: no .devflow/learning/ under ${dir} — run from the project root\n`,
    });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// claim-due (D-DUE-ORDER)
// ---------------------------------------------------------------------------

describe('claim-due (D-DUE-ORDER)', { timeout: 30_000 }, () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-due-');
    paths = learningPaths(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** The size claim-due reports for an entry: its ledger row and its log row, as compact JSON. */
  function sizeOf(ledger: Row[], log: Row[], anchor: string): number {
    const row = ledger.find(r => r.anchor_id === anchor);
    if (!row) throw new Error(`no ledger row ${anchor} in the fixture`);
    return store.entrySize(row, log.find(l => l.id === row.id));
  }

  /** The anchors a store claim-due hands out at `now`. */
  function dueAt(now: number, opts: { scopeMatches?: (glob: string) => boolean } = {}): string[] {
    const result = store.claimDue(dir, { now, ...opts });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.due.map(entry => entry.anchor_id);
  }

  it('prints the verify ref, then each due entry with its reason and size: integrity, legacy, then the oldest verification', () => {
    const head = initGitRepo(dir, { 'src/app.ts': 'export {};\n' });
    const now = Date.now();
    const ledger = [
      makeV2LedgerRow({ anchor_id: 'ADR-005', id: 'obs_old40', last_verified: daysAgoDate(40, now) }),
      makeV1LedgerRow({ anchor_id: 'ADR-003', id: 'obs_legacy_a', type: 'decision', decisions_status: 'Accepted' }),
      makeV2LedgerRow({ anchor_id: 'ADR-006', id: 'obs_never', last_verified: undefined }),
      makeV1LedgerRow({ anchor_id: 'PF-020', id: 'obs_dup' }),
      makeV1LedgerRow({ anchor_id: 'PF-004', id: 'obs_dup' }),
      makeV2LedgerRow({ anchor_id: 'ADR-007', id: 'obs_fresh', last_verified: daysAgoDate(1, now) }),
    ];
    const log = ['obs_old40', 'obs_legacy_a', 'obs_never', 'obs_dup', 'obs_fresh'].map(id => makeV2LogRow({ id }));
    seedLearningTree(dir, { ledger, log });

    expect(runJsonHelper(dir, ['claim-due'])).toEqual({
      code: 0,
      stderr: '',
      stdout: [
        `ref HEAD ${head.slice(0, 12)}`,
        `PF-004 duplicate-obs-id ${sizeOf(ledger, log, 'PF-004')}`,
        `PF-020 duplicate-obs-id ${sizeOf(ledger, log, 'PF-020')}`,
        `ADR-003 legacy-v1 ${sizeOf(ledger, log, 'ADR-003')}`,
        `ADR-006 verify-age ${sizeOf(ledger, log, 'ADR-006')}`,
        `ADR-005 verify-age ${sizeOf(ledger, log, 'ADR-005')}`,
        '',
      ].join('\n'),
    });
  });

  it('names origin/HEAD when the repository has one, and none outside a repository', () => {
    seedLearningTree(dir, { ledger: [] });
    expect(runJsonHelper(dir, ['claim-due'])).toEqual({ code: 0, stdout: 'ref none\ndue none\n', stderr: '' });

    const fetched = initGitRepo(dir, { 'a.txt': 'one\n' });
    git(dir, ['update-ref', 'refs/remotes/origin/main', fetched]);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    git(dir, ['commit', '-q', '--allow-empty', '-m', 'local work']);
    expect(runJsonHelper(dir, ['claim-due'])).toEqual({ code: 0, stdout: `ref origin/HEAD ${fetched.slice(0, 12)}\ndue none\n`, stderr: '' });
  });

  it('stamps last_attempt on the entries it hands out and leaves every other row as it was', () => {
    const due = makeV1LedgerRow();
    const fresh = makeV2LedgerRow({ last_verified: daysAgoDate(1) });
    const retired = makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_retired', decisions_status: 'Retired' });
    seedLearningTree(dir, { ledger: [fresh, due, retired], log: [makeV2LogRow(), makeV1LogRow()] });
    const [freshLine, , retiredLine] = linesOf(paths.ledger);

    expect(store.claimDue(dir, { now: FIXTURE_NOW })).toEqual({
      ok: true,
      value: { ref: null, due: [{ anchor_id: 'PF-001', reason: 'legacy-v1', bytes: store.entrySize(due, makeV1LogRow()) }] },
    });
    const lines = linesOf(paths.ledger);
    expect(JSON.parse(lines[1])).toEqual({ ...due, last_attempt: NOW_ISO });
    expect([lines[0], lines[2]]).toEqual([freshLine, retiredLine]);
  });

  it('skips an entry handed out in the last 24 hours and hands it out again after', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow()], log: [makeV1LogRow()] });
    expect(dueAt(FIXTURE_NOW)).toEqual(['PF-001']);
    expect(dueAt(FIXTURE_NOW + 23 * HOUR_MS)).toEqual([]);
    expect(dueAt(FIXTURE_NOW + 25 * HOUR_MS)).toEqual(['PF-001']);
  });

  it('hands out at most five entries, and the next run within the day hands out the rest', () => {
    const ledger = Array.from({ length: 7 }, (_, i) => makeV1LedgerRow({ anchor_id: `PF-01${i}`, id: `obs_legacy_${i}` }));
    seedLearningTree(dir, { ledger, log: ledger.map(row => makeV1LogRow({ id: row.id })) });

    const first = runJsonHelper(dir, ['claim-due']).stdout.split('\n').filter(Boolean).slice(1);
    expect(first.map(line => line.split(' ')[0])).toEqual(['PF-010', 'PF-011', 'PF-012', 'PF-013', 'PF-014']);
    const second = runJsonHelper(dir, ['claim-due']).stdout.split('\n').filter(Boolean).slice(1);
    expect(second.map(line => line.split(' ')[0])).toEqual(['PF-015', 'PF-016']);
    expect(runJsonHelper(dir, ['claim-due']).stdout).toBe('ref none\ndue none\n');
  });

  it('stops before the byte budget, and always hands out at least one entry', () => {
    const big = (anchor: string, id: string, ruleBytes: number): Row =>
      makeV2LedgerRow({ anchor_id: anchor, id, last_verified: undefined, rule: 'r'.repeat(ruleBytes) });
    seedLearningTree(dir, { ledger: [big('ADR-001', 'obs_one', 25_000), big('ADR-002', 'obs_two', 25_000), big('ADR-003', 'obs_three', 25_000)] });
    expect(dueAt(FIXTURE_NOW)).toEqual(['ADR-001', 'ADR-002']);

    seedLearningTree(dir, { ledger: [big('ADR-004', 'obs_huge', 70_000)] });
    expect(dueAt(FIXTURE_NOW)).toEqual(['ADR-004']);
  });

  it('puts an entry whose scope matches no tracked file ahead of every other reason', () => {
    seedLearningTree(dir, {
      ledger: [makeV1LedgerRow(), makeV2LedgerRow({ last_verified: daysAgoDate(1), scope: ['gone/**'] })],
      log: [makeV1LogRow(), makeV2LogRow({ scope: ['gone/**'] })],
    });
    const result = store.claimDue(dir, { now: FIXTURE_NOW, scopeMatches: glob => glob !== 'gone/**' });
    expect(result.ok && result.value.due.map(entry => [entry.anchor_id, entry.reason])).toEqual([
      ['ADR-001', 'scope-matches-nothing'],
      ['PF-001', 'legacy-v1'],
    ]);
  });

  it('prints due none and writes nothing when no entry is due', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ last_verified: daysAgoDate(1, Date.now()) })], log: [makeV2LogRow()] });
    // A writer would quarantine this line: with nothing to hand out, claim-due may not.
    fs.appendFileSync(paths.ledger, 'not json\n');
    const before = snapshotTree(dir);
    expect(runJsonHelper(dir, ['claim-due'])).toEqual({ code: 0, stdout: 'ref none\ndue none\n', stderr: '' });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('copies a v1 tree aside and quarantines the ledger\'s malformed lines before it stamps', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow()], log: [makeV1LogRow()] });
    fs.appendFileSync(paths.ledger, 'not json\n');
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    expect(dueAt(FIXTURE_NOW)).toEqual(['PF-001']);
    expect(fs.readFileSync(path.join(paths.learningDir, 'decisions-ledger.pre-v2.jsonl'), 'utf8')).toBe(ledgerBefore);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-ledger.rejected.jsonl')).map(row => row.text)).toEqual(['not json']);
    expect(linesOf(paths.ledger)).toHaveLength(1);
  });

  it('takes no argument', () => {
    seedLearningTree(dir);
    expect(runJsonHelper(dir, ['claim-due', '--all'])).toEqual({
      code: 1, stdout: '', stderr: 'claim-due: usage: claim-due (no arguments; run from the project root)\n',
    });
  });
});

// ---------------------------------------------------------------------------
// assignAnchor (D-LEDGER-REGISTRY)
// ---------------------------------------------------------------------------

/** The fixture clock's date, as the ledger's date fields hold it. */
const TODAY = daysAgoDate(0);

/** The cited-anchor scan's answer for a tree that cites no number. */
const NOTHING_CITED: ReadonlyMap<string, Citation> = new Map();

/** The key order of a minted ledger row: the projection's, then the two dates assign stamps. */
const MINTED_KEYS: readonly string[] = [
  'schema', 'id', 'type', 'anchor_id', 'decisions_status', 'title', 'rule', 'why', 'scope', 'provenance',
  'date', 'last_verified',
];

describe('assignAnchor (D-LEDGER-REGISTRY)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-assign-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A store assign on the fixture clock; `cited` stands in for the tracked-file scan. */
  function assign(type: 'decision' | 'pitfall', id: string, cited: ReadonlyMap<string, Citation> = NOTHING_CITED) {
    return store.assignAnchor(dir, type, id, { now: FIXTURE_NOW, citedAnchors: cited });
  }

  it('mints the number after the highest of its type, inactive entries included, and projects the v2 row stamped today', () => {
    const logRow = makeV2LogRow({ id: 'obs_new_one' });
    seedLearningTree(dir, {
      log: [logRow],
      ledger: [
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' }),
        makeV2LedgerRow({ anchor_id: 'ADR-004', id: 'obs_gone', decisions_status: 'Retired', retired_on: '2026-09-02' }),
        makeV2LedgerRow({ anchor_id: 'PF-009', id: 'obs_lesson', type: 'pitfall', decisions_status: 'Active' }),
      ],
    });

    expect(assign('decision', 'obs_new_one')).toEqual({ ok: true, value: { anchor_id: 'ADR-005', skipped: [] } });
    const minted = rowsOf(paths.ledger)[3];
    expect(minted).toEqual({
      schema: 2,
      id: 'obs_new_one',
      type: 'decision',
      anchor_id: 'ADR-005',
      decisions_status: 'Accepted',
      title: logRow.title,
      rule: logRow.rule,
      why: logRow.why,
      scope: logRow.scope,
      provenance: logRow.provenance,
      date: TODAY,
      last_verified: TODAY,
    });
    expect(Object.keys(minted)).toEqual(MINTED_KEYS);
  });

  it('numbers pitfalls on their own sequence and gives them the Active status', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow({ id: 'obs_lesson', type: 'pitfall' })],
      ledger: [makeV2LedgerRow({ anchor_id: 'ADR-010', id: 'obs_beta' })],
    });
    expect(assign('pitfall', 'obs_lesson')).toEqual({ ok: true, value: { anchor_id: 'PF-001', skipped: [] } });
    expect(rowsOf(paths.ledger)[1]).toMatchObject({ anchor_id: 'PF-001', type: 'pitfall', decisions_status: 'Active' });
  });

  it('never writes the log, and renders the new entry', () => {
    seedLearningTree(dir, { log: [makeV2LogRow(), makeV2LogRow({ id: 'obs_other' })] });
    const logBefore = fs.readFileSync(paths.log, 'utf8');

    expect(assign('decision', 'obs_store_one').ok).toBe(true);
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(logBefore);
    const ledgerRows = rowsOf(paths.ledger);
    expect(rendered(paths, 'decisions.md')).toBe(renderDecisionsFile(ledgerRows, 'decisions'));
    expect(rendered(paths, 'decisions.md')).toContain('\n## ADR-001: Store functions return a Result\n');
    expect(rendered(paths, 'index.md')).toContain('  ADR-001  Store functions return a Result');
  });

  it('refuses an observation any ledger row carries, active or retired, and writes nothing', () => {
    for (const carrier of [makeV2LedgerRow(), makeV2LedgerRow({ anchor_id: 'ADR-003', decisions_status: 'Retired' })]) {
      seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [carrier] });
      const before = snapshotTree(dir);
      expect(assign('decision', 'obs_store_one')).toEqual({
        ok: false,
        error: {
          kind: 'already-promoted',
          message: `assign-anchor: 'obs_store_one' is already promoted (${carrier.anchor_id} ${carrier.decisions_status}); nothing was written`,
        },
      });
      expect(snapshotTree(dir)).toEqual(before);
    }
  });

  it('promoting one observation twice mints one number: the second call finds the first in the ledger', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    expect(assign('decision', 'obs_store_one')).toMatchObject({ ok: true, value: { anchor_id: 'ADR-001' } });
    expect(assign('decision', 'obs_store_one')).toMatchObject({ ok: false, error: { kind: 'already-promoted' } });
    expect(rowsOf(paths.ledger).map(row => row.anchor_id)).toEqual(['ADR-001']);
  });

  it('an anchor copied onto the log row does not make it promoted: only a ledger row does', () => {
    seedLearningTree(dir, { log: [makeV2LogRow({ anchor_id: 'ADR-007' })] });
    expect(assign('decision', 'obs_store_one')).toEqual({ ok: true, value: { anchor_id: 'ADR-001', skipped: [] } });
  });

  it('refuses a v1 observation, a type the observation does not have, an id the log lacks and one it holds twice, writing nothing', () => {
    seedLearningTree(dir, {
      log: [makeV1LogRow(), makeV2LogRow(), makeV2LogRow({ id: 'obs_twice' }), makeV2LogRow({ id: 'obs_twice', rule: 'A second copy.' })],
    });
    const before = snapshotTree(dir);

    expect(assign('pitfall', 'obs_legacy_one')).toEqual({
      ok: false,
      error: { kind: 'v1-observation', message: "assign-anchor: 'obs_legacy_one' is a v1 observation; rewrite it with put-observation --update first" },
    });
    expect(assign('pitfall', 'obs_store_one')).toEqual({
      ok: false,
      error: { kind: 'type-mismatch', message: "assign-anchor: 'obs_store_one' is a decision observation, not a pitfall; nothing was written" },
    });
    expect(assign('decision', 'obs_absent')).toEqual({
      ok: false,
      error: { kind: 'not-in-log', message: "assign-anchor: 'obs_absent' is not in the log; store it with put-observation --create first" },
    });
    expect(assign('decision', 'obs_twice')).toEqual({
      ok: false,
      error: { kind: 'duplicate-log-id', message: "assign-anchor: the log holds 2 rows with id 'obs_twice'; nothing was written" },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('copies a v1 tree aside and quarantines the ledger\'s malformed lines before it appends', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV1LedgerRow()] });
    fs.appendFileSync(paths.ledger, 'not json\n');
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    expect(assign('decision', 'obs_store_one')).toMatchObject({ ok: true, value: { anchor_id: 'ADR-001' } });
    expect(fs.readFileSync(path.join(paths.learningDir, 'decisions-ledger.pre-v2.jsonl'), 'utf8')).toBe(ledgerBefore);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-ledger.rejected.jsonl')).map(row => row.text)).toEqual(['not json']);
    expect(rowsOf(paths.ledger).map(row => row.anchor_id)).toEqual(['PF-001', 'ADR-001']);
  });

  it('refuses without a learning directory and creates nothing', () => {
    fs.rmSync(paths.learningDir, { recursive: true });
    expect(store.assignAnchor(dir, 'decision', 'obs_store_one', { now: FIXTURE_NOW })).toEqual({
      ok: false,
      error: { kind: 'no-learning-dir', message: `assign-anchor: no .devflow/learning/ under ${dir} — run from the project root` },
    });
    expect(fs.readdirSync(path.join(dir, '.devflow'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assignAnchor: numbers a tracked file cites (D-E4-SKIP)
// ---------------------------------------------------------------------------

describe('assignAnchor: numbers a tracked file cites (D-E4-SKIP)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-skip-');
    paths = seedLearningTree(dir, { log: [makeV2LogRow()] });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A citation map naming the first `count` decision numbers, one per line of one file. */
  function citingDecisions(count: number): Map<string, Citation> {
    return new Map(Array.from({ length: count }, (_, i) => [
      `ADR-${String(i + 1).padStart(3, '0')}`,
      { file: 'docs/numbers.md', line: i + 1 },
    ]));
  }

  it('skips each cited number past the highest anchor, in order, and reports where each is cited', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ id: 'obs_beta' })] });
    const cited = new Map([
      ['ADR-001', { file: 'docs/old.md', line: 1 }],
      ['ADR-002', { file: 'docs/design.md', line: 3 }],
      ['ADR-003', { file: 'docs/plan.md', line: 12 }],
      ['ADR-005', { file: 'docs/plan.md', line: 40 }],
      ['PF-002', { file: 'docs/plan.md', line: 41 }],
    ]);
    expect(store.assignAnchor(dir, 'decision', 'obs_store_one', { now: FIXTURE_NOW, citedAnchors: cited })).toEqual({
      ok: true,
      value: {
        anchor_id: 'ADR-004',
        skipped: [
          { anchor_id: 'ADR-002', file: 'docs/design.md', line: 3 },
          { anchor_id: 'ADR-003', file: 'docs/plan.md', line: 12 },
        ],
      },
    });
    expect(rowsOf(paths.ledger).map(row => row.anchor_id)).toEqual(['ADR-001', 'ADR-004']);
  });

  it('skips at most E4_MAX_SKIPS (100) numbers, and refuses when the one after them is cited too', () => {
    expect(store.E4_MAX_SKIPS).toBe(100);
    const before = snapshotTree(dir);
    expect(store.assignAnchor(dir, 'decision', 'obs_store_one', { now: FIXTURE_NOW, citedAnchors: citingDecisions(101) })).toEqual({
      ok: false,
      error: {
        kind: 'cited-numbers-exhausted',
        message: 'assign-anchor: ADR-001 to ADR-101 are all cited in tracked files; nothing was written',
      },
    });
    expect(snapshotTree(dir)).toEqual(before);

    const minted = store.assignAnchor(dir, 'decision', 'obs_store_one', { now: FIXTURE_NOW, citedAnchors: citingDecisions(100) });
    expect(minted.ok && minted.value.anchor_id).toBe('ADR-101');
    expect(minted.ok && minted.value.skipped.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// collectCitedAnchorIds (D-E4-SKIP)
// ---------------------------------------------------------------------------

describe('collectCitedAnchorIds (D-E4-SKIP)', { timeout: 30_000 }, () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmp('learning-ops-cited-');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('maps each anchor the tracked files cite as a whole word to its first citation', () => {
    initGitRepo(dir, {
      'docs/a.md': 'Intro.\nSee ADR-007 and PF-012 here.\n',
      'src/b.ts': '// ADR-007 again\nconst wide = "PF-1234";\nconst glued = "XADR-008";\nconst cut = "PF-01";\n',
    });
    expect(store.collectCitedAnchorIds(dir)).toEqual(new Map([
      ['ADR-007', { file: 'docs/a.md', line: 2 }],
      ['PF-012', { file: 'docs/a.md', line: 2 }],
      ['PF-1234', { file: 'src/b.ts', line: 2 }],
    ]));
  });

  it('reads what git tracks, outside the learning tree and the vendored and build directories', () => {
    initGitRepo(dir, {
      '.gitignore': 'ignored/\n',
      'ignored/scratch.md': 'ADR-003\n',
      '.devflow/learning/decisions.md': '## ADR-004: an entry\n',
      'node_modules/pkg/readme.md': 'ADR-005\n',
      'dist/app.js': '// ADR-006\n',
      'crates/target/notes.md': 'ADR-008\n',
      'docs/kept.md': 'ADR-010\n',
    });
    expect([...store.collectCitedAnchorIds(dir).keys()]).toEqual(['ADR-010']);
  });

  it('walks the directory tree, with the same exclusions, outside a git repository', () => {
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), 'Design number ADR-001 was reserved earlier.\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'readme.md'), 'ADR-002\n');
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ anchor_id: 'ADR-003' })] });
    expect(store.collectCitedAnchorIds(dir)).toEqual(new Map([['ADR-001', { file: 'docs/notes.md', line: 1 }]]));
  });

  it('reads no binary file, no symbolic link and no file over 5 MB', () => {
    const outside = makeTmp('learning-ops-cited-outside-');
    try {
      fs.writeFileSync(path.join(outside, 'target.md'), 'ADR-002\n');
      fs.mkdirSync(path.join(dir, 'docs'));
      fs.writeFileSync(path.join(dir, 'docs', 'binary.dat'), Buffer.from('ADR-001\n\u0000\n', 'utf8'));
      fs.symlinkSync(path.join(outside, 'target.md'), path.join(dir, 'docs', 'link.md'));
      fs.writeFileSync(path.join(dir, 'docs', 'big.md'), `ADR-003\n${'x'.repeat(5 * 1024 * 1024)}`);
      fs.writeFileSync(path.join(dir, 'docs', 'kept.md'), 'ADR-004\n');
      initGitRepo(dir);
      expect([...store.collectCitedAnchorIds(dir).keys()]).toEqual(['ADR-004']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The assign-anchor op: argv and the stdout grammar
// ---------------------------------------------------------------------------

describe('assign-anchor op', { timeout: 30_000 }, () => {
  const USAGE = 'assign-anchor: usage: assign-anchor <decision|pitfall> <obs_id> (run from the project root)\n';
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-assign-op-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints the minted anchor on stdout and each number it skipped on stderr', () => {
    initGitRepo(dir, { 'docs/design.md': 'See ADR-002 for the rationale.\n' });
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow({ id: 'obs_beta' })] });
    expect(runJsonHelper(dir, ['assign-anchor', 'decision', 'obs_store_one'])).toEqual({
      code: 0,
      stdout: 'ADR-003\n',
      stderr: 'assign-anchor: skipped ADR-002, cited in docs/design.md:1\n',
    });
  });

  it('prints only the anchor when no number is skipped', () => {
    seedLearningTree(dir, { log: [makeV2LogRow({ id: 'obs_lesson', type: 'pitfall' })] });
    expect(runJsonHelper(dir, ['assign-anchor', 'pitfall', 'obs_lesson'])).toEqual({ code: 0, stdout: 'PF-001\n', stderr: '' });
  });

  it('prints a refusal on stderr and exits 1', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    expect(runJsonHelper(dir, ['assign-anchor', 'decision', 'obs_store_one'])).toEqual({
      code: 1,
      stdout: '',
      stderr: "assign-anchor: 'obs_store_one' is already promoted (ADR-001 Accepted); nothing was written\n",
    });
  });

  it('takes exactly a type and an observation id: --allow-collision and every other flag are usage errors', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()] });
    const before = snapshotTree(dir);
    for (const args of [
      ['assign-anchor'],
      ['assign-anchor', 'decision'],
      ['assign-anchor', 'decision', 'obs_store_one', '--allow-collision'],
      ['assign-anchor', '--allow-collision', 'decision', 'obs_store_one'],
      ['assign-anchor', 'workflow', 'obs_store_one'],
      ['assign-anchor', 'decision', 'not_an_observation'],
      ['assign-anchor', 'decision', '../obs_store_one'],
    ]) {
      expect(runJsonHelper(dir, args), args.join(' ')).toEqual({ code: 1, stdout: '', stderr: USAGE });
    }
    expect(snapshotTree(dir)).toEqual(before);
    expect(fs.existsSync(paths.ledger)).toBe(false);
  });

  it('next-anchor is not an op', () => {
    expect(runJsonHelper(dir, ['next-anchor', 'decision'])).toEqual({
      code: 1, stdout: '', stderr: 'json-helper: unknown operation "next-anchor"\n',
    });
  });
});

// ---------------------------------------------------------------------------
// refreshAnchors: re-projection from the log (D-LOG-CONTENT-AUTHORITY)
// ---------------------------------------------------------------------------

describe('refreshAnchors: re-projection from the log (D-LOG-CONTENT-AUTHORITY)', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-refresh-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A store refresh on the fixture clock. */
  function refresh(anchors: readonly string[], verified = false) {
    return store.refreshAnchors(dir, anchors, { verified, now: FIXTURE_NOW });
  }

  it('rewrites an entry in place: a shorter rule that does not contain the old one replaces it, and history keeps the prior row', () => {
    const prior = makeV2LedgerRow({
      rule: 'Every learning store function returns a Result, never exits, never prints, and every caller checks ok before it reads the value.',
      last_attempt: '2026-10-02T09:00:00.000Z',
    });
    const logRow = makeV2LogRow({ rule: 'Store functions return a Result.' });
    seedLearningTree(dir, { log: [logRow], ledger: [prior] });

    expect(refresh(['ADR-001'])).toEqual({ ok: true, value: { refreshed: [{ anchor_id: 'ADR-001', state: 'reprojected' }] } });
    const [row] = rowsOf(paths.ledger);
    expect(row).toEqual(store.toLedgerRowV2(logRow, prior));
    expect(row).toMatchObject({ rule: 'Store functions return a Result.', date: '2026-09-01', last_verified: '2026-09-01', last_attempt: '2026-10-02T09:00:00.000Z' });
    expect(store.historyVersions(dir, 'obs_store_one')).toEqual([{ id: 'obs_store_one', at: NOW_ISO, ledger: [prior], log: logRow }]);
    expect(rendered(paths, 'decisions.md')).toBe(renderDecisionsFile(rowsOf(paths.ledger), 'decisions'));
    expect(rendered(paths, 'decisions.md')).toContain('- **Decision**: Store functions return a Result.\n');
  });

  it('answers unchanged and writes nothing when the entry already holds its log row\'s content', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    expect(refresh(['ADR-001'])).toEqual({ ok: true, value: { refreshed: [{ anchor_id: 'ADR-001', state: 'unchanged' }] } });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('re-projects each anchor of a batch once, in the order given', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow({ title: 'A sharper title' }), makeV2LogRow({ id: 'obs_lesson', type: 'pitfall', title: 'A sharper lesson' })],
      ledger: [makeV2LedgerRow(), makeV2LedgerRow({ anchor_id: 'PF-002', id: 'obs_lesson', type: 'pitfall', decisions_status: 'Active' })],
    });
    expect(refresh(['PF-002', 'ADR-001', 'PF-002'])).toEqual({
      ok: true,
      value: { refreshed: [{ anchor_id: 'PF-002', state: 'reprojected' }, { anchor_id: 'ADR-001', state: 'reprojected' }] },
    });
    expect(rowsOf(paths.ledger).map(row => row.title)).toEqual(['A sharper title', 'A sharper lesson']);
    expect(rendered(paths, 'pitfalls.md')).toContain(': A sharper lesson\n');
    expect(rendered(paths, 'index.md')).toContain('  PF-002  A sharper lesson');
  });

  it('drops a key the projection does not hold, and gives an entry with no status its type\'s active status', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow()],
      ledger: [makeV2LedgerRow({ decisions_status: undefined, confidence: 0.9, observations: 4 })],
    });
    expect(refresh(['ADR-001'])).toMatchObject({ ok: true, value: { refreshed: [{ state: 'reprojected' }] } });
    expect(rowsOf(paths.ledger)).toEqual([makeV2LedgerRow()]);
  });

  it('refuses v1, inactive and absent entries, all or nothing, listing every problem', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow({ title: 'A sharper title' }), makeV1LogRow()],
      ledger: [
        makeV2LedgerRow(),
        makeV1LedgerRow(),
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_gone', decisions_status: 'Superseded', superseded_by: 'ADR-001' }),
      ],
    });
    const before = snapshotTree(dir);
    expect(refresh(['ADR-001', 'PF-001', 'ADR-002', 'ADR-009'])).toEqual({
      ok: false,
      error: {
        kind: 'refused',
        message: [
          'refresh-anchor: 3 of 4 anchors refused; nothing was written',
          '  PF-001: a v1 entry; rewrite it with put-observation --update',
          '  ADR-002: Superseded; restore it with restore-anchor first',
          '  ADR-009: not in the ledger',
        ].join('\n'),
        problems: [
          { anchor_id: 'PF-001', message: 'a v1 entry; rewrite it with put-observation --update' },
          { anchor_id: 'ADR-002', message: 'Superseded; restore it with restore-anchor first' },
          { anchor_id: 'ADR-009', message: 'not in the ledger' },
        ],
      },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses an entry whose log row is missing, doubled, v1 or of the other type, writing nothing', () => {
    seedLearningTree(dir, {
      log: [
        makeV2LogRow({ id: 'obs_twice' }),
        makeV2LogRow({ id: 'obs_twice', rule: 'A second copy.' }),
        makeV1LogRow({ id: 'obs_old_row', type: 'decision' }),
        makeV2LogRow({ id: 'obs_switched', type: 'pitfall' }),
      ],
      ledger: [
        makeV2LedgerRow({ anchor_id: 'ADR-001', id: 'obs_missing' }),
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_twice' }),
        makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_old_row' }),
        makeV2LedgerRow({ anchor_id: 'ADR-004', id: 'obs_switched' }),
        makeV2LedgerRow({ anchor_id: 'ADR-005', id: undefined }),
      ],
    });
    const before = snapshotTree(dir);
    const result = refresh(['ADR-001', 'ADR-002', 'ADR-003', 'ADR-004', 'ADR-005']);
    expect(result.ok === false && result.error.problems).toEqual([
      { anchor_id: 'ADR-001', message: "no log row has id 'obs_missing'; write it back with put-observation --create" },
      { anchor_id: 'ADR-002', message: "the log holds 2 rows with id 'obs_twice'" },
      { anchor_id: 'ADR-003', message: 'its log row is v1; rewrite it with put-observation --update' },
      { anchor_id: 'ADR-004', message: 'cannot take its log row: it is a decision entry and the observation is a pitfall' },
      { anchor_id: 'ADR-005', message: 'has no observation id' },
    ]);
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses an anchor two ledger rows hold', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow(), makeV2LedgerRow({ id: 'obs_other' })] });
    const result = refresh(['ADR-001']);
    expect(result.ok === false && result.error.problems).toEqual([{ anchor_id: 'ADR-001', message: 'held by 2 ledger rows' }]);
  });

  it('copies a v1 tree aside and quarantines the ledger\'s malformed lines before it rewrites the ledger', () => {
    seedLearningTree(dir, { log: [makeV2LogRow({ title: 'A sharper title' })], ledger: [makeV2LedgerRow(), makeV1LedgerRow()] });
    fs.appendFileSync(paths.ledger, 'not json\n');
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    expect(refresh(['ADR-001']).ok).toBe(true);
    expect(fs.readFileSync(path.join(paths.learningDir, 'decisions-ledger.pre-v2.jsonl'), 'utf8')).toBe(ledgerBefore);
    expect(rowsOf(path.join(paths.learningDir, 'decisions-ledger.rejected.jsonl')).map(row => row.text)).toEqual(['not json']);
    expect(linesOf(paths.ledger)).toHaveLength(2);
  });

  it('refuses without a learning directory and creates nothing', () => {
    fs.rmSync(paths.learningDir, { recursive: true });
    expect(refresh(['ADR-001'])).toEqual({
      ok: false,
      error: { kind: 'no-learning-dir', message: `refresh-anchor: no .devflow/learning/ under ${dir} — run from the project root` },
    });
    expect(fs.readdirSync(path.join(dir, '.devflow'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refreshAnchors --verified
// ---------------------------------------------------------------------------

describe('refreshAnchors --verified', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-verified-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A store refresh --verified on the fixture clock. */
  function verify(anchors: readonly string[]) {
    return store.refreshAnchors(dir, anchors, { verified: true, now: FIXTURE_NOW });
  }

  it('stamps last_verified with today and changes nothing else, not even content the log has moved past', () => {
    const prior = makeV2LedgerRow({ rule: 'A rule the log has since sharpened.', last_attempt: '2026-10-02T09:00:00.000Z' });
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [prior] });
    const logBefore = fs.readFileSync(paths.log, 'utf8');

    expect(verify(['ADR-001'])).toEqual({ ok: true, value: { refreshed: [{ anchor_id: 'ADR-001', state: 'verified' }] } });
    const [row] = rowsOf(paths.ledger);
    expect(row).toEqual({ ...prior, last_verified: TODAY });
    expect(Object.keys(row)).toEqual(Object.keys(prior));
    expect(fs.readFileSync(paths.log, 'utf8')).toBe(logBefore);
    expect(fs.existsSync(paths.history)).toBe(false);
    expect(rendered(paths, 'decisions.md')).toContain(`- **Status**: Accepted · verified ${TODAY}\n`);
  });

  it('puts a first last_verified in its place among the ledger fields, and needs no log row', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ last_verified: undefined, last_attempt: '2026-10-02T09:00:00.000Z' })] });
    expect(verify(['ADR-001']).ok).toBe(true);
    expect(Object.keys(rowsOf(paths.ledger)[0]).slice(-3)).toEqual(['date', 'last_verified', 'last_attempt']);
  });

  it('writes nothing for an entry already verified today', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ last_verified: TODAY })] });
    const before = snapshotTree(dir);
    expect(verify(['ADR-001'])).toEqual({ ok: true, value: { refreshed: [{ anchor_id: 'ADR-001', state: 'verified' }] } });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses v1 and inactive entries, all or nothing', () => {
    seedLearningTree(dir, {
      ledger: [makeV2LedgerRow(), makeV1LedgerRow(), makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_gone', decisions_status: 'Retired' })],
    });
    const before = snapshotTree(dir);
    const result = verify(['ADR-001', 'PF-001', 'ADR-002']);
    expect(result.ok === false && result.error.problems).toEqual([
      { anchor_id: 'PF-001', message: 'a v1 entry; rewrite it with put-observation --update' },
      { anchor_id: 'ADR-002', message: 'Retired; restore it with restore-anchor first' },
    ]);
    expect(snapshotTree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The refresh-anchor op: argv and the stdout grammar
// ---------------------------------------------------------------------------

describe('refresh-anchor op', { timeout: 30_000 }, () => {
  const USAGE = 'refresh-anchor: usage: refresh-anchor <anchor> [<anchor>...] [--verified] (run from the project root)\n';
  let dir: string;

  beforeEach(() => {
    dir = makeTmp('learning-ops-refresh-op-');
    seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('prints one line per anchor: reprojected or unchanged, or verified under --verified', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow({ title: 'A sharper title' }), makeV2LogRow({ id: 'obs_lesson', type: 'pitfall' })],
      ledger: [makeV2LedgerRow(), makeV2LedgerRow({ anchor_id: 'PF-002', id: 'obs_lesson', type: 'pitfall', decisions_status: 'Active' })],
    });
    expect(runJsonHelper(dir, ['refresh-anchor', 'ADR-001', 'PF-002'])).toEqual({
      code: 0, stdout: 'reprojected ADR-001\nunchanged PF-002\n', stderr: '',
    });
    expect(runJsonHelper(dir, ['refresh-anchor', '--verified', 'PF-002', 'ADR-001'])).toEqual({
      code: 0, stdout: 'verified PF-002\nverified ADR-001\n', stderr: '',
    });
  });

  it('prints every refused anchor on stderr and exits 1', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow()] });
    expect(runJsonHelper(dir, ['refresh-anchor', 'PF-001', 'ADR-004'])).toEqual({
      code: 1,
      stdout: '',
      stderr: [
        'refresh-anchor: 2 of 2 anchors refused; nothing was written',
        '  PF-001: a v1 entry; rewrite it with put-observation --update',
        '  ADR-004: not in the ledger',
        '',
      ].join('\n'),
    });
  });

  it('takes one or more anchors and --verified at most once, and nothing else', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    for (const args of [
      ['refresh-anchor'],
      ['refresh-anchor', '--verified'],
      ['refresh-anchor', 'ADR-001', '--verified', '--verified'],
      ['refresh-anchor', 'ADR-001', '--all'],
      ['refresh-anchor', 'adr-001'],
      ['refresh-anchor', 'obs_store_one'],
      ['refresh-anchor', 'ADR-1'],
    ]) {
      expect(runJsonHelper(dir, args), args.join(' ')).toEqual({ code: 1, stdout: '', stderr: USAGE });
    }
    expect(snapshotTree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// retireAnchor: Retired and Deprecated take a reason
// ---------------------------------------------------------------------------

describe('retireAnchor: Retired and Deprecated take a reason', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-retire-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A store retire on the fixture clock. */
  function retire(anchor: string, status: string, input: unknown) {
    return store.retireAnchor(dir, anchor, status, input, { now: FIXTURE_NOW });
  }

  it('sets the status, keeps the reason as the note, stamps retired_on today and lists the entry under Inactive', () => {
    const prior = makeV2LedgerRow({ last_attempt: '2026-10-02T09:00:00.000Z' });
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [prior, makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' })] });

    expect(retire('ADR-001', 'Retired', { reason: 'A one-off, never seen again' })).toEqual({
      ok: true,
      value: { anchor_id: 'ADR-001', status: 'Retired', repointed: [] },
    });
    const [row] = rowsOf(paths.ledger);
    expect(row).toEqual({ ...prior, decisions_status: 'Retired', status_note: 'A one-off, never seen again', retired_on: TODAY });
    expect(Object.keys(row)).toEqual([...MINTED_KEYS, 'last_attempt', 'status_note', 'retired_on']);
    const decisionsMd = rendered(paths, 'decisions.md');
    expect(decisionsMd).toBe(renderDecisionsFile(rowsOf(paths.ledger), 'decisions'));
    expect(decisionsMd).not.toMatch(/^## ADR-001:/m);
    expect(decisionsMd).toContain('| ADR-001 | Retired | A one-off, never seen again |\n');
  });

  it('takes a reason for Deprecated the same way', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    expect(retire('ADR-001', 'Deprecated', { reason: 'The store moved to Results everywhere' }).ok).toBe(true);
    expect(rowsOf(paths.ledger)[0]).toMatchObject({
      decisions_status: 'Deprecated', status_note: 'The store moved to Results everywhere', retired_on: TODAY,
    });
  });

  it('gives an entry that holds no status key its status right after anchor_id, where the projection puts it', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow({ decisions_status: undefined })] });

    expect(retire('ADR-001', 'Retired', { reason: 'A one-off' }).ok).toBe(true);
    const [row] = rowsOf(paths.ledger);
    expect(row).toEqual({ ...makeV2LedgerRow(), decisions_status: 'Retired', status_note: 'A one-off', retired_on: TODAY });
    expect(Object.keys(row)).toEqual([...MINTED_KEYS, 'status_note', 'retired_on']);
  });

  it('retires a v1 entry, its content untouched, after copying a v1 tree aside', () => {
    const prior = makeV1LedgerRow();
    seedLearningTree(dir, { log: [makeV1LogRow()], ledger: [prior] });
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');

    expect(retire('PF-001', 'Deprecated', { reason: 'The hooks moved' }).ok).toBe(true);
    expect(rowsOf(paths.ledger)).toEqual([{ ...prior, decisions_status: 'Deprecated', status_note: 'The hooks moved', retired_on: TODAY }]);
    expect(fs.readFileSync(path.join(paths.learningDir, 'decisions-ledger.pre-v2.jsonl'), 'utf8')).toBe(ledgerBefore);
    expect(rendered(paths, 'pitfalls.md')).toContain('| PF-001 | Deprecated | The hooks moved |\n');
  });

  it('refuses a missing or over-long reason, another status\'s keys and unknown keys, listing every problem and writing nothing', () => {
    seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);

    expect(retire('ADR-001', 'Retired', { reason: 'r'.repeat(121), by: 'ADR-002', colour: 'red' })).toEqual({
      ok: false,
      error: {
        kind: 'invalid-input',
        message: [
          'retire-anchor: the input has 3 problems; nothing was written',
          '  by: is not taken by Retired, which takes reason',
          '  colour: is not taken by Retired, which takes reason',
          '  reason: is 121 characters, over the limit of 120',
        ].join('\n'),
        problems: [
          { field: 'by', message: 'is not taken by Retired, which takes reason' },
          { field: 'colour', message: 'is not taken by Retired, which takes reason' },
          { field: 'reason', message: 'is 121 characters, over the limit of 120' },
        ],
      },
    });
    expect(retire('ADR-001', 'Deprecated', {})).toMatchObject({
      ok: false, error: { problems: [{ field: 'reason', message: 'is required' }] },
    });
    expect(retire('ADR-001', 'Retired', { reason: 'two\nlines' })).toMatchObject({
      ok: false, error: { problems: [{ field: 'reason', message: 'must be one line with no control characters' }] },
    });
    expect(retire('ADR-001', 'Retired', ['a reason'])).toMatchObject({
      ok: false, error: { problems: [{ field: '(input)', message: 'must be one JSON object' }] },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses an entry the ledger does not hold, and one already inactive, writing nothing', () => {
    seedLearningTree(dir, {
      ledger: [makeV2LedgerRow({ decisions_status: 'Superseded', superseded_by: 'ADR-002' }), makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' })],
    });
    const before = snapshotTree(dir);
    expect(retire('ADR-009', 'Retired', { reason: 'gone' })).toEqual({
      ok: false, error: { kind: 'not-found', message: 'retire-anchor: ADR-009 is not in the ledger; nothing was written' },
    });
    expect(retire('ADR-001', 'Retired', { reason: 'gone' })).toEqual({
      ok: false, error: { kind: 'already-inactive', message: 'retire-anchor: ADR-001 is already Superseded; nothing was written' },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses without a learning directory and creates nothing', () => {
    fs.rmSync(paths.learningDir, { recursive: true });
    expect(retire('ADR-001', 'Retired', { reason: 'gone' })).toEqual({
      ok: false,
      error: { kind: 'no-learning-dir', message: `retire-anchor: no .devflow/learning/ under ${dir} — run from the project root` },
    });
    expect(fs.readdirSync(path.join(dir, '.devflow'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// retireAnchor: Superseded takes an active successor
// ---------------------------------------------------------------------------

describe('retireAnchor: Superseded takes an active successor', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-supersede-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A store retire as Superseded on the fixture clock. */
  function supersede(anchor: string, input: unknown) {
    return store.retireAnchor(dir, anchor, 'Superseded', input, { now: FIXTURE_NOW });
  }

  it('points the entry at its successor and re-points every entry it had superseded', () => {
    const successor = makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_gamma' });
    seedLearningTree(dir, {
      ledger: [
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' }),
        successor,
        makeV2LedgerRow({ anchor_id: 'PF-004', id: 'obs_delta', type: 'pitfall', decisions_status: 'Superseded', superseded_by: 'ADR-002', retired_on: '2026-08-02' }),
        makeV2LedgerRow({ id: 'obs_alpha', decisions_status: 'Superseded', superseded_by: 'ADR-002', retired_on: '2026-08-01' }),
        makeV2LedgerRow({ anchor_id: 'ADR-005', id: 'obs_epsilon', decisions_status: 'Superseded', superseded_by: 'ADR-003' }),
      ],
    });

    expect(supersede('ADR-002', { by: 'ADR-003' })).toEqual({
      ok: true,
      value: { anchor_id: 'ADR-002', status: 'Superseded', repointed: ['ADR-001', 'PF-004'] },
    });
    const byAnchor = new Map(rowsOf(paths.ledger).map(row => [row.anchor_id, row]));
    expect(byAnchor.get('ADR-002')).toMatchObject({ decisions_status: 'Superseded', superseded_by: 'ADR-003', retired_on: TODAY });
    expect(byAnchor.get('ADR-001')).toMatchObject({ decisions_status: 'Superseded', superseded_by: 'ADR-003', retired_on: '2026-08-01' });
    expect(byAnchor.get('PF-004')).toMatchObject({ superseded_by: 'ADR-003', retired_on: '2026-08-02' });
    expect(byAnchor.get('ADR-003')).toEqual(successor);
    expect(rendered(paths, 'decisions.md')).toContain('| ADR-002 | Superseded | superseded by ADR-003 |\n');
    expect(rendered(paths, 'pitfalls.md')).toContain('| PF-004 | Superseded | superseded by ADR-003 |\n');
  });

  it('takes a successor of the other type', () => {
    seedLearningTree(dir, {
      ledger: [makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' }), makeV2LedgerRow({ anchor_id: 'PF-001', id: 'obs_lesson', type: 'pitfall', decisions_status: 'Active' })],
    });
    expect(supersede('ADR-002', { by: 'PF-001' })).toMatchObject({ ok: true, value: { repointed: [] } });
    expect(rowsOf(paths.ledger)[0]).toMatchObject({ decisions_status: 'Superseded', superseded_by: 'PF-001' });
  });

  it('refuses the entry itself, a successor that is not an anchor, and one absent or inactive, writing nothing', () => {
    seedLearningTree(dir, {
      ledger: [makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' }), makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_gamma', decisions_status: 'Retired' })],
    });
    const before = snapshotTree(dir);
    expect(supersede('ADR-002', { by: 'ADR-002' })).toMatchObject({
      ok: false, error: { kind: 'invalid-input', problems: [{ field: 'by', message: 'names this entry; an entry cannot supersede itself' }] },
    });
    expect(supersede('ADR-002', { by: 'adr-3' })).toMatchObject({
      ok: false, error: { kind: 'invalid-input', problems: [{ field: 'by', message: 'must be an anchor id' }] },
    });
    expect(supersede('ADR-002', { by: 'ADR-009' })).toEqual({
      ok: false, error: { kind: 'successor-not-found', message: 'retire-anchor: ADR-009, the successor, is not in the ledger; nothing was written' },
    });
    expect(supersede('ADR-002', { by: 'ADR-003' })).toEqual({
      ok: false, error: { kind: 'successor-inactive', message: 'retire-anchor: ADR-003, the successor, is Retired; nothing was written' },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// retireAnchor: Encoded takes a path and a quote checked at the verify ref
// (D-ENCODED-QUOTE)
// ---------------------------------------------------------------------------

describe('retireAnchor: Encoded takes a path and a quote checked at the verify ref (D-ENCODED-QUOTE)', { timeout: 30_000 }, () => {
  const SOURCE = [
    'export function put(row) {',
    '  // Every store function returns a Result',
    '  // and never throws.',
    '  return ok(row);',
    '}',
    '',
  ].join('\n');
  const QUOTE = 'Every store function returns a Result';
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-encoded-');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** One active entry, in a repository whose one commit holds src/store.ts; answers that commit. */
  function seedRepository(): string {
    const head = initGitRepo(dir, { 'src/store.ts': SOURCE });
    paths = seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    return head;
  }

  /** A store retire as Encoded on the fixture clock. */
  function encode(input: unknown) {
    return store.retireAnchor(dir, 'ADR-001', 'Encoded', input, { now: FIXTURE_NOW });
  }

  it('stores the path, the quote, the ref and the commit, and notes where the lesson now lives', () => {
    const head = seedRepository();
    expect(encode({ at: 'src/store.ts', quote: QUOTE })).toEqual({
      ok: true, value: { anchor_id: 'ADR-001', status: 'Encoded', repointed: [] },
    });
    expect(rowsOf(paths.ledger)[0]).toMatchObject({
      decisions_status: 'Encoded',
      encoded_at: { path: 'src/store.ts', quote: QUOTE, ref: 'HEAD', commit: head },
      retired_on: TODAY,
    });
    expect(rendered(paths, 'decisions.md')).toContain('| ADR-001 | Encoded | encoded in src/store.ts |\n');
  });

  it('compares with every run of whitespace collapsed, so a quote may cross a line break', () => {
    const head = seedRepository();
    expect(store.quoteAtRef(dir, 'src/store.ts', 'returns  a Result // and never throws.')).toEqual({
      ok: true,
      value: { path: 'src/store.ts', quote: 'returns  a Result // and never throws.', ref: 'HEAD', commit: head },
    });
  });

  it('checks the quote at origin/HEAD when the repository has one, never at a later local commit or the working tree', () => {
    const fetched = initGitRepo(dir, { 'src/store.ts': SOURCE });
    git(dir, ['update-ref', 'refs/remotes/origin/main', fetched]);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    fs.writeFileSync(path.join(dir, 'src', 'store.ts'), `${SOURCE}// A line only the local branch has\n`);
    git(dir, ['commit', '-q', '-am', 'local work']);
    fs.writeFileSync(path.join(dir, 'src', 'store.ts'), `${SOURCE}// A line only the working tree has\n`);

    expect(store.quoteAtRef(dir, 'src/store.ts', 'A line only the local branch has')).toEqual({
      ok: false,
      error: {
        kind: 'quote-not-found',
        message: `retire-anchor: the quote is not in 'src/store.ts' at origin/HEAD ${fetched.slice(0, 12)}; nothing was written`,
      },
    });
    expect(store.quoteAtRef(dir, 'src/store.ts', 'A line only the working tree has')).toMatchObject({ ok: false, error: { kind: 'quote-not-found' } });
    expect(store.quoteAtRef(dir, 'src/store.ts', QUOTE)).toEqual({
      ok: true, value: { path: 'src/store.ts', quote: QUOTE, ref: 'origin/HEAD', commit: fetched },
    });
  });

  it('refuses a path that is no file at the ref, and a tree with no commit to check, writing nothing', () => {
    const head = seedRepository();
    const before = snapshotTree(paths.learningDir);
    expect(encode({ at: 'src/missing.ts', quote: QUOTE })).toEqual({
      ok: false,
      error: {
        kind: 'not-at-ref',
        message: `retire-anchor: 'src/missing.ts' is not a file at HEAD ${head.slice(0, 12)}; nothing was written`,
      },
    });
    expect(encode({ at: 'src', quote: QUOTE })).toMatchObject({ ok: false, error: { kind: 'not-at-ref' } });
    expect(encode({ at: 'src/store.ts', quote: 'A sentence the file never held' })).toMatchObject({ ok: false, error: { kind: 'quote-not-found' } });
    expect(snapshotTree(paths.learningDir)).toEqual(before);

    expect(store.quoteAtRef(dir, 'src/store.ts', QUOTE, { verifyRef: null })).toEqual({
      ok: false,
      error: {
        kind: 'no-verify-ref',
        message: 'retire-anchor: there is no commit to check the quote at (not a git repository, or no commit yet); nothing was written',
      },
    });
  });

  it('refuses a malformed path or quote before it asks git, listing every problem', () => {
    paths = seedLearningTree(dir, { log: [makeV2LogRow()], ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    const problemsOf = (input: unknown) => {
      const result = encode(input);
      return result.ok ? [] : result.error.problems;
    };

    expect(problemsOf({ at: '/etc/passwd', quote: 'a   b   c   d' })).toEqual([
      { field: 'at', message: 'must be relative to the repository root' },
      { field: 'quote', message: 'is 7 characters once its whitespace is collapsed, under the minimum of 12' },
    ]);
    expect(problemsOf({ at: 'src/../etc/passwd', quote: 'q'.repeat(201) })).toEqual([
      { field: 'at', message: 'must not hold an empty, . or .. segment' },
      { field: 'quote', message: 'is 201 characters, over the limit of 200' },
    ]);
    expect(problemsOf({ at: `src/${'d'.repeat(300)}.ts`, quote: QUOTE })).toEqual([
      { field: 'at', message: 'is 307 characters, over the limit of 300' },
    ]);
    expect(problemsOf({ reason: 'it is in the code now' })).toEqual([
      { field: 'reason', message: 'is not taken by Encoded, which takes at and quote' },
      { field: 'at', message: 'is required' },
      { field: 'quote', message: 'is required' },
    ]);
    expect(snapshotTree(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// restoreAnchor
// ---------------------------------------------------------------------------

describe('restoreAnchor', () => {
  let dir: string;
  let paths: LearningTreePaths;

  beforeEach(() => {
    dir = makeTmp('learning-ops-restore-');
    paths = seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A store restore on the fixture clock. */
  function restore(anchor: string) {
    return store.restoreAnchor(dir, anchor, { now: FIXTURE_NOW });
  }

  it('gives the entry its type\'s active status, clears its notes, last_verified and last_attempt, and renders it again', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow()],
      ledger: [makeV2LedgerRow({
        decisions_status: 'Retired', last_attempt: '2026-10-03T11:00:00.000Z', status_note: 'A one-off', retired_on: '2026-09-20',
      })],
    });
    expect(restore('ADR-001')).toEqual({ ok: true, value: { anchor_id: 'ADR-001', status: 'Accepted' } });
    expect(rowsOf(paths.ledger)).toEqual([makeV2LedgerRow({ last_verified: undefined })]);
    expect(Object.keys(rowsOf(paths.ledger)[0])).toEqual(MINTED_KEYS.filter(key => key !== 'last_verified'));
    expect(rendered(paths, 'decisions.md')).toContain('\n## ADR-001: Store functions return a Result\n');
    expect(rendered(paths, 'decisions.md')).not.toContain('## Inactive');
  });

  it('clears superseded_by and encoded_at as well, and restores a pitfall as Active', () => {
    seedLearningTree(dir, {
      ledger: [
        makeV2LedgerRow({ decisions_status: 'Superseded', superseded_by: 'ADR-002', retired_on: '2026-09-20' }),
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' }),
        makeV2LedgerRow({
          anchor_id: 'PF-003', id: 'obs_lesson', type: 'pitfall', decisions_status: 'Encoded', retired_on: '2026-09-21',
          encoded_at: { path: 'src/store.ts', quote: 'Every store function returns a Result', ref: 'HEAD', commit: 'a'.repeat(40) },
        }),
      ],
    });
    expect(restore('ADR-001').ok).toBe(true);
    expect(restore('PF-003')).toEqual({ ok: true, value: { anchor_id: 'PF-003', status: 'Active' } });
    const [decision, , pitfall] = rowsOf(paths.ledger);
    expect(decision).toEqual(makeV2LedgerRow({ last_verified: undefined }));
    expect(pitfall).toEqual(makeV2LedgerRow({ anchor_id: 'PF-003', id: 'obs_lesson', type: 'pitfall', decisions_status: 'Active', last_verified: undefined }));
  });

  it('makes the entry due next: claim-due hands it out before every verified entry, whatever lease it had', () => {
    seedLearningTree(dir, {
      log: [makeV2LogRow(), makeV2LogRow({ id: 'obs_beta' })],
      ledger: [
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta', last_verified: daysAgoDate(40) }),
        makeV2LedgerRow({ decisions_status: 'Retired', status_note: 'A one-off', last_attempt: new Date(FIXTURE_NOW - HOUR_MS).toISOString() }),
      ],
    });
    expect(restore('ADR-001').ok).toBe(true);
    const due = store.claimDue(dir, { now: FIXTURE_NOW, scopeMatches: everyGlobMatches });
    expect(due.ok && due.value.due.map(entry => [entry.anchor_id, entry.reason])).toEqual([
      ['ADR-001', 'verify-age'],
      ['ADR-002', 'verify-age'],
    ]);
  });

  it('restores a v1 entry after copying a v1 tree aside, and it renders through the v1 formatter again', () => {
    seedLearningTree(dir, { ledger: [makeV1LedgerRow({ decisions_status: 'Retired', status_note: 'The hooks moved', retired_on: '2026-09-01' })] });
    const ledgerBefore = fs.readFileSync(paths.ledger, 'utf8');
    expect(restore('PF-001')).toEqual({ ok: true, value: { anchor_id: 'PF-001', status: 'Active' } });
    expect(rowsOf(paths.ledger)).toEqual([makeV1LedgerRow()]);
    expect(fs.readFileSync(path.join(paths.learningDir, 'decisions-ledger.pre-v2.jsonl'), 'utf8')).toBe(ledgerBefore);
    expect(rendered(paths, 'pitfalls.md')).toBe(renderDecisionsFile([makeV1LedgerRow()], 'pitfalls'));
  });

  it('refuses an active entry and one the ledger does not hold, writing nothing', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    expect(restore('ADR-001')).toEqual({
      ok: false, error: { kind: 'already-active', message: 'restore-anchor: ADR-001 is already active; nothing was written' },
    });
    expect(restore('ADR-004')).toEqual({
      ok: false, error: { kind: 'not-found', message: 'restore-anchor: ADR-004 is not in the ledger; nothing was written' },
    });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('refuses without a learning directory and creates nothing', () => {
    fs.rmSync(paths.learningDir, { recursive: true });
    expect(restore('ADR-001')).toEqual({
      ok: false,
      error: { kind: 'no-learning-dir', message: `restore-anchor: no .devflow/learning/ under ${dir} — run from the project root` },
    });
    expect(fs.readdirSync(path.join(dir, '.devflow'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The retire-anchor and restore-anchor ops: argv, stdin and the stdout grammar
// ---------------------------------------------------------------------------

describe('retire-anchor and restore-anchor ops', { timeout: 30_000 }, () => {
  const RETIRE_USAGE =
    'retire-anchor: usage: retire-anchor <anchor> <Encoded|Superseded|Retired|Deprecated> (one JSON object on stdin; run from the project root)\n';
  const RESTORE_USAGE = 'restore-anchor: usage: restore-anchor <anchor> (run from the project root)\n';
  let dir: string;

  beforeEach(() => {
    dir = makeTmp('learning-ops-retire-op-');
    seedLearningTree(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('retire prints the new status and the entry, then each entry re-pointed to the successor', () => {
    seedLearningTree(dir, {
      ledger: [
        makeV2LedgerRow({ anchor_id: 'ADR-002', id: 'obs_beta' }),
        makeV2LedgerRow({ anchor_id: 'ADR-003', id: 'obs_gamma' }),
        makeV2LedgerRow({ decisions_status: 'Superseded', superseded_by: 'ADR-002' }),
      ],
    });
    expect(runJsonHelper(dir, ['retire-anchor', 'ADR-002', 'Superseded'], '{"by": "ADR-003"}\n')).toEqual({
      code: 0, stdout: 'superseded ADR-002\nrepointed ADR-001\n', stderr: '',
    });
    expect(runJsonHelper(dir, ['retire-anchor', 'ADR-003', 'Retired'], '{"reason": "A one-off"}')).toEqual({
      code: 0, stdout: 'retired ADR-003\n', stderr: '',
    });
  });

  it('restore prints the entry it restored', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ decisions_status: 'Deprecated', status_note: 'Moved' })] });
    expect(runJsonHelper(dir, ['restore-anchor', 'ADR-001'])).toEqual({ code: 0, stdout: 'restored ADR-001\n', stderr: '' });
    expect(runJsonHelper(dir, ['restore-anchor', 'ADR-001'])).toEqual({
      code: 1, stdout: '', stderr: 'restore-anchor: ADR-001 is already active; nothing was written\n',
    });
  });

  it('retire prints every input problem on stderr and exits 1', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    expect(runJsonHelper(dir, ['retire-anchor', 'ADR-001', 'Deprecated'], '{"because": "x"}')).toEqual({
      code: 1,
      stdout: '',
      stderr: 'retire-anchor: the input has 2 problems; nothing was written\n'
        + '  because: is not taken by Deprecated, which takes reason\n'
        + '  reason: is required\n',
    });
  });

  it('retire refuses stdin that is not one JSON object, writing nothing', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    for (const stdin of ['', 'not json', '["a reason"]', '"a reason"']) {
      expect(runJsonHelper(dir, ['retire-anchor', 'ADR-001', 'Retired'], stdin), JSON.stringify(stdin)).toEqual({
        code: 1, stdout: '', stderr: 'retire-anchor: stdin must hold one JSON object\n',
      });
    }
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('retire takes an anchor and an inactive status, and nothing else', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow()] });
    const before = snapshotTree(dir);
    for (const args of [
      ['retire-anchor'],
      ['retire-anchor', 'ADR-001'],
      ['retire-anchor', 'ADR-001', 'Invalid'],
      ['retire-anchor', 'ADR-001', 'retired'],
      ['retire-anchor', 'ADR-001', 'Accepted'],
      ['retire-anchor', 'ADR-001', 'Retired', 'extra'],
      ['retire-anchor', 'obs_store_one', 'Retired'],
    ]) {
      expect(runJsonHelper(dir, args, '{"reason": "test"}'), args.join(' ')).toEqual({ code: 1, stdout: '', stderr: RETIRE_USAGE });
    }
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('restore takes exactly one anchor', () => {
    seedLearningTree(dir, { ledger: [makeV2LedgerRow({ decisions_status: 'Retired' })] });
    const before = snapshotTree(dir);
    for (const args of [['restore-anchor'], ['restore-anchor', 'ADR-001', 'ADR-002'], ['restore-anchor', 'obs_store_one'], ['restore-anchor', '--all']]) {
      expect(runJsonHelper(dir, args), args.join(' ')).toEqual({ code: 1, stdout: '', stderr: RESTORE_USAGE });
    }
    expect(snapshotTree(dir)).toEqual(before);
  });
});
