// tests/decisions/learning-fixtures.ts
//
// Shared fixtures for the v2 learning tests: row factories for the v2 and v1
// shapes, a learning-tree seeder, a git repository builder and a json-helper
// runner. Every learning test that seeds a `.devflow/learning/` tree, builds a
// repository or spawns json-helper.cjs takes them from here, so the row shapes
// the store, the ops and the renderer are tested on stay one definition.
//
// Rows are plain objects in the key order the store writes them; each factory
// takes overrides that replace or add keys, and an override set to `undefined`
// removes that key, so a test can seed a row that lacks a field.

import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const JSON_HELPER = path.join(ROOT, 'src/assets/scripts/hooks/json-helper.cjs');
export const LEARNING_STORE = path.join(ROOT, 'src/assets/scripts/hooks/lib/learning-store.cjs');

export type Row = Record<string, unknown>;

/** A fixed clock for tests that need one: 2026-10-03 12:00 UTC, in epoch milliseconds. */
export const FIXTURE_NOW = Date.parse('2026-10-03T12:00:00.000Z');

const DAY_MS = 24 * 60 * 60 * 1000;

/** `FIXTURE_NOW` minus `days`, as an ISO timestamp. */
export function daysAgoIso(days: number, now: number = FIXTURE_NOW): string {
  return new Date(now - days * DAY_MS).toISOString();
}

/** `FIXTURE_NOW` minus `days`, as a YYYY-MM-DD date. */
export function daysAgoDate(days: number, now: number = FIXTURE_NOW): string {
  return daysAgoIso(days, now).slice(0, 10);
}

/** Apply overrides in place of the base keys; an `undefined` override deletes the key. */
function withOverrides(base: Row, overrides: Row): Row {
  const row: Row = { ...base, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete row[key];
  }
  return row;
}

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

/** A v2 log row: schema, id, the content keys, then the counters plumbing owns. */
export function makeV2LogRow(overrides: Row = {}): Row {
  return withOverrides(
    {
      schema: 2,
      id: 'obs_store_one',
      type: 'decision',
      title: 'Store functions return a Result',
      rule: 'Every learning store function returns a Result and never exits or prints.',
      why: 'An exit inside the lock skips its release, and printing ties the store to one caller.',
      scope: ['area:learning'],
      provenance: 'learning v2 design review',
      evidence: ['the old wrapper exited while it held the lock'],
      observations: 1,
      first_seen: '2026-09-01T00:00:00.000Z',
      last_seen: '2026-09-01T00:00:00.000Z',
    },
    overrides,
  );
}

/** A v2 ledger row in the projection's key order: identity, status, content, then ledger-owned keys. */
export function makeV2LedgerRow(overrides: Row = {}): Row {
  return withOverrides(
    {
      schema: 2,
      id: 'obs_store_one',
      type: 'decision',
      anchor_id: 'ADR-001',
      decisions_status: 'Accepted',
      title: 'Store functions return a Result',
      rule: 'Every learning store function returns a Result and never exits or prints.',
      why: 'An exit inside the lock skips its release, and printing ties the store to one caller.',
      scope: ['area:learning'],
      provenance: 'learning v2 design review',
      date: '2026-09-01',
      last_verified: '2026-09-01',
    },
    overrides,
  );
}

/** A v1 log row in the shape the live corpus holds: pattern and details, no schema. */
export function makeV1LogRow(overrides: Row = {}): Row {
  return withOverrides(
    {
      id: 'obs_legacy_one',
      type: 'pitfall',
      pattern: 'Editing installed hook scripts instead of their source',
      details: 'area: scripts/hooks; issue: edits are overwritten on reinstall; impact: lost work; resolution: edit src/assets and rebuild',
      evidence: ['the reinstall replaced a hand edit'],
      confidence: 0.9,
      observations: 2,
      first_seen: '2026-06-01T00:00:00.000Z',
      last_seen: '2026-07-01T00:00:00.000Z',
      status: 'created',
      quality_ok: true,
    },
    overrides,
  );
}

/** A v1 ledger row as v1 assign-anchor projected it. */
export function makeV1LedgerRow(overrides: Row = {}): Row {
  return withOverrides(
    {
      id: 'obs_legacy_one',
      type: 'pitfall',
      pattern: 'Editing installed hook scripts instead of their source',
      details: 'area: scripts/hooks; issue: edits are overwritten on reinstall; impact: lost work; resolution: edit src/assets and rebuild',
      anchor_id: 'PF-001',
      decisions_status: 'Active',
    },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// Learning tree
// ---------------------------------------------------------------------------

export interface LearningTreePaths {
  learningDir: string;
  log: string;
  ledger: string;
  archive: string;
  history: string;
  lockDir: string;
}

/** The learning-tree paths under project root `dir` (nothing is created). */
export function learningPaths(dir: string): LearningTreePaths {
  const learningDir = path.join(dir, '.devflow', 'learning');
  return {
    learningDir,
    log: path.join(learningDir, 'decisions-log.jsonl'),
    ledger: path.join(learningDir, 'decisions-ledger.jsonl'),
    archive: path.join(learningDir, 'decisions-log.archive.jsonl'),
    history: path.join(learningDir, 'decisions-history.jsonl'),
    lockDir: path.join(learningDir, '.decisions.lock'),
  };
}

/** Serialize rows as JSONL, one row per line with a trailing newline ('' for none). */
export function toJsonl(rows: readonly Row[]): string {
  return rows.length === 0 ? '' : rows.map(r => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * Create `<dir>/.devflow/learning/` and write each given file as JSONL. A file
 * left out is not created, so a test can seed a tree with no ledger or no archive.
 */
export function seedLearningTree(
  dir: string,
  { log, ledger, archive }: { log?: readonly Row[]; ledger?: readonly Row[]; archive?: readonly Row[] } = {},
): LearningTreePaths {
  const paths = learningPaths(dir);
  fs.mkdirSync(paths.learningDir, { recursive: true });
  if (log !== undefined) fs.writeFileSync(paths.log, toJsonl(log), 'utf8');
  if (ledger !== undefined) fs.writeFileSync(paths.ledger, toJsonl(ledger), 'utf8');
  if (archive !== undefined) fs.writeFileSync(paths.archive, toJsonl(archive), 'utf8');
  return paths;
}

/** Every file under `dir`, relative to it, with its bytes — for "this call wrote nothing" assertions. */
export function snapshotTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        files.set(child + path.sep, '');
        walk(child);
      } else {
        files.set(child, fs.readFileSync(path.join(dir, child), 'latin1'));
      }
    }
  };
  walk('');
  return files;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Child env for git: a fixed identity and no system or global config. */
export const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

/** Run git in `dir` and return its trimmed stdout. Throws on a non-zero exit. */
export function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: dir, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Make `dir` a git repository on branch `main` holding `files` (path relative to
 * `dir` → content) in one commit, and return that commit's SHA.
 */
export function initGitRepo(dir: string, files: Readonly<Record<string, string>> = {}): string {
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return git(dir, ['rev-parse', 'HEAD']);
}

// ---------------------------------------------------------------------------
// json-helper.cjs
// ---------------------------------------------------------------------------

export interface HelperRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `json-helper.cjs <args…>` in `cwd` with `input` on stdin (argv, never a
 * shell string) and return its exit code and both streams.
 */
export function runJsonHelper(cwd: string, args: readonly string[], input?: string): HelperRun {
  const run = spawnSync(process.execPath, [JSON_HELPER, ...args], {
    cwd,
    env: GIT_ENV,
    input: input ?? '',
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.error) throw run.error;
  return { code: run.status ?? 1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// The store module
// ---------------------------------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; error: { kind: string; message: string } };

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult = { ok: true; value: Row } | { ok: false; errors: ValidationError[] };

export interface IntegrityEntry {
  anchor_id: string;
  id: unknown;
  flags: string[];
}

export interface DueEntry {
  anchor_id: string;
  reason: string;
  bytes: number;
}

export interface ShowFlag {
  anchor_id: string;
  flag: string;
  fields: string[];
}

export interface ShownEntry {
  key: string;
  ledger: Row[];
  log: Row | null;
  history_versions: Row[];
  flags: ShowFlag[];
}

export interface ListingRow {
  anchor_id: string;
  id: unknown;
  type: unknown;
  status: string | null;
  title: string;
  schema: 1 | 2;
  last_verified?: string;
  note?: string;
}

export interface ObservationListingRow {
  id: string;
  type: unknown;
  title: string;
  schema: 1 | 2;
  observations: number | null;
  last_seen: string | null;
}

export interface Listing {
  active: ListingRow[];
  inactive: ListingRow[];
  observations: ObservationListingRow[];
  integrity: IntegrityEntry[];
  malformed: { ledger: number; log: number };
}

/** What claim-queue answers. */
export type ClaimAnswer = { state: 'claimed'; token: string; takeover: boolean } | { state: 'busy' } | { state: 'none' };

/** What release-claim answers. */
export interface ReleaseAnswer {
  state: 'released' | 'not-owner' | 'gone';
}

/** What put-observation answers: the outcome, the observation count it left and the anchors it re-projected. */
export interface PutAnswer {
  outcome: 'created' | 'updated' | 'unchanged' | 'reinforced';
  id: string;
  observations: number;
  reprojected: string[];
}

/** A put's Result; a refused input carries every problem. */
export type PutResult =
  | { ok: true; value: PutAnswer }
  | { ok: false; error: { kind: string; message: string; problems?: ValidationError[] } };

/** What show answers: the shown entry, plus the skipped-line counts when lines were skipped. */
export type ShowAnswer = ShownEntry & { malformed?: { ledger: number; log: number } };

/** What claim-due answers: the ref claims are checked at, and the entries handed out. */
export interface DueClaim {
  ref: { ref: 'origin/HEAD' | 'HEAD'; commit: string } | null;
  due: DueEntry[];
}

/** Where a tracked file first cites an anchor: its path from the project root and its 1-based line. */
export interface Citation {
  file: string;
  line: number;
}

/** What assign-anchor answers: the anchor it minted, and each cited number it skipped on the way. */
export interface AssignAnswer {
  anchor_id: string;
  skipped: Array<{ anchor_id: string } & Citation>;
}

/** What refresh-anchor answers: each anchor once, in the order given, with what happened to it. */
export interface RefreshAnswer {
  refreshed: Array<{ anchor_id: string; state: 'verified' | 'reprojected' | 'unchanged' }>;
}

/** A refresh refusal: every anchor that blocked the batch, with why. */
export type RefreshResult =
  | { ok: true; value: RefreshAnswer }
  | { ok: false; error: { kind: string; message: string; problems?: Array<{ anchor_id: string; message: string }> } };

/** The ref and commit a claim about the code is checked at. */
export interface VerifyRef {
  ref: 'origin/HEAD' | 'HEAD';
  commit: string;
}

/** Where an Encoded entry's lesson now lives: a path, a quote from it, and the ref and commit it was checked at. */
export interface EncodedAt {
  path: string;
  quote: string;
  ref: string;
  commit: string;
}

/** What retire-anchor answers: the entry, its new status, and the entries re-pointed to its successor. */
export interface RetireAnswer {
  anchor_id: string;
  status: string;
  repointed: string[];
}

/** A Result whose refusal of an input lists every problem. */
export type InputResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { kind: string; message: string; problems?: ValidationError[] } };

/** The learning store's surface as the tests use it. */
export interface LearningStoreApi {
  SCHEMA_VERSION: number;
  FIELD_LIMITS: Readonly<Record<string, number>>;
  ACTIVE_STATUSES: readonly string[];
  INACTIVE_STATUSES: readonly string[];
  ENTRY_STATUSES: readonly string[];
  CONTENT_KEYS: readonly string[];
  PLUMBING_OWNED_KEYS: readonly string[];
  LEDGER_OWNED_KEYS: readonly string[];
  DUE: Readonly<{ verifyAgeDays: number; leaseHours: number; maxEntries: number; byteBudget: number }>;
  HISTORY_DEPTH: number;
  LOCK_ACQUIRE_TIMEOUT_MS: number;
  LOCK_STALE_MS: number;
  ANCHOR_ID_RE: RegExp;
  OBS_ID_RE: RegExp;
  isActive(row: Row): boolean;
  activeStatusFor(type: string): string;
  isV2(row: unknown): boolean;
  readJsonl(file: string): { rows: Row[]; rejected: Array<{ line: number; text: string }>; missing: boolean };
  rejectedPathFor(file: string): string;
  quarantineRejected(file: string, rejected: Array<{ line: number; text: string }>, opts?: { now?: number }): number;
  readJsonlForWrite(file: string, opts?: { now?: number }): Row[];
  writeExclusive(tmp: string, content: string): void;
  writeFileAtomic(file: string, content: string): void;
  writeJsonlAtomic(file: string, rows: readonly Row[]): void;
  hasLearningDir(root: string): boolean;
  withDecisionsLock<T>(
    opName: string,
    root: string,
    fn: () => Result<T>,
    opts?: { timeoutMs?: number; staleMs?: number },
  ): Result<T>;
  readLearningState(root: string): {
    ledgerRows: Row[];
    logRows: Row[];
    rejected: { ledger: Array<{ line: number; text: string }>; log: Array<{ line: number; text: string }> };
  };
  ledgerRegistry(ledgerRows: readonly Row[]): { byAnchor: Map<string, Row>; byObsId: Map<string, Row[]> };
  validateObservationInput(
    input: unknown,
    opts: {
      mode: 'create' | 'update' | 'reinforce';
      existing?: Row | null;
      ledgerIds?: Iterable<string>;
      scopeMatches?: (glob: string) => boolean;
    },
  ): ValidationResult;
  gitScopeMatcher(root: string): (glob: string) => boolean;
  toLedgerRowV2(
    logRow: Row,
    priorLedgerRow?: Row | null,
    opts?: { anchorId?: string; status?: string; date?: string; expectType?: string },
  ): Row;
  toV2Counters(row: Row, opts?: { now?: number }): { observations: number; first_seen: string; last_seen: string };
  appendHistory(root: string, entry: { id: string; ledger?: Row[]; log?: Row | null }, opts?: { now?: number }): number;
  historyVersions(root: string, id: string): Row[];
  ensurePreV2Backup(root: string, rows: { logRows?: readonly Row[]; ledgerRows?: readonly Row[] }): string[];
  integrityFlags(ledger: readonly Row[], log: readonly Row[], opts?: { scopeMatches?: (glob: string) => boolean }): IntegrityEntry[];
  buildListing(
    ledger: readonly Row[],
    log: readonly Row[],
    opts?: {
      scopeMatches?: (glob: string) => boolean;
      rejected?: { ledger?: readonly unknown[]; log?: readonly unknown[] };
    },
  ): Listing;
  entrySize(ledgerRow: Row, logRow?: Row | null): number;
  selectDue(
    ledger: readonly Row[],
    log: readonly Row[],
    opts?: { now?: number; integrity?: readonly IntegrityEntry[]; maxEntries?: number; budgetBytes?: number },
  ): DueEntry[];
  showEntry(
    key: string,
    ledger: readonly Row[],
    log: readonly Row[],
    opts?: { historyVersions?: (id: string) => Row[] },
  ): Result<ShownEntry>;
  resolveVerifyRef(root: string): { ref: 'origin/HEAD' | 'HEAD'; commit: string } | null;
  rotateObservations(root: string, opts?: { now?: number; timeoutMs?: number }): Result<{ rotated: number; appended: number }>;
  CLAIM_STALE_SECS: number;
  CLAIM_TOKEN_RE: RegExp;
  newClaimToken(): string;
  claimQueue(root: string, opts?: { now?: number; token?: string; timeoutMs?: number }): Result<ClaimAnswer>;
  releaseClaim(root: string, token: string, opts?: { timeoutMs?: number }): Result<ReleaseAnswer>;
  touchClaim(root: string, opts?: { now?: number }): Result<{ touched: boolean }>;
  putObservation(
    root: string,
    mode: 'create' | 'update' | 'reinforce',
    input: unknown,
    opts?: { now?: number; timeoutMs?: number; scopeMatches?: (glob: string) => boolean },
  ): PutResult;
  readListing(root: string, opts?: { scopeMatches?: (glob: string) => boolean }): Result<Listing>;
  formatListing(listing: Listing): string;
  showByKey(root: string, key: string): Result<ShowAnswer>;
  claimDue(
    root: string,
    opts?: { now?: number; timeoutMs?: number; scopeMatches?: (glob: string) => boolean },
  ): Result<DueClaim>;
  E4_MAX_SKIPS: number;
  nextAnchorFromLedger(rows: readonly Row[], type: 'decision' | 'pitfall'): { anchorId: string; nextN: string };
  collectCitedAnchorIds(root: string): Map<string, Citation>;
  assignAnchor(
    root: string,
    type: 'decision' | 'pitfall',
    obsId: string,
    opts?: { now?: number; timeoutMs?: number; citedAnchors?: ReadonlyMap<string, Citation> },
  ): Result<AssignAnswer>;
  refreshAnchors(
    root: string,
    anchorIds: readonly string[],
    opts?: { verified?: boolean; now?: number; timeoutMs?: number },
  ): RefreshResult;
  quoteAtRef(root: string, at: string, quote: string, opts?: { verifyRef?: VerifyRef | null }): Result<EncodedAt>;
  retireAnchor(
    root: string,
    anchorId: string,
    status: string,
    input: unknown,
    opts?: { now?: number; timeoutMs?: number; verifyRef?: VerifyRef | null },
  ): InputResult<RetireAnswer>;
  restoreAnchor(root: string, anchorId: string, opts?: { now?: number; timeoutMs?: number }): Result<{ anchor_id: string; status: string }>;
  clearUnreferenced(root: string, opts?: { now?: number; timeoutMs?: number }): Result<{ cleared: number; kept: number }>;
}

/** Load the learning store CommonJS module. */
export function requireLearningStore(): LearningStoreApi {
  return createRequire(import.meta.url)(LEARNING_STORE) as LearningStoreApi;
}
