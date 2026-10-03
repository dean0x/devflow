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
  initGitRepo,
  makeV1LedgerRow,
  makeV1LogRow,
  makeV2LedgerRow,
  makeV2LogRow,
  requireLearningStore,
  runJsonHelper,
  seedLearningTree,
  snapshotTree,
  type HelperRun,
  type LearningTreePaths,
  type Row,
} from './learning-fixtures.js';

const store = requireLearningStore();

const { renderDecisionsFile } = createRequire(import.meta.url)(
  path.join(ROOT, 'src/assets/scripts/hooks/lib/render-decisions.cjs'),
) as { renderDecisionsFile: (rows: Row[], kind: 'decisions' | 'pitfalls') => string };

const NOW_ISO = new Date(FIXTURE_NOW).toISOString();

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
