// src/assets/scripts/hooks/lib/learning-store.cjs
//
// The v2 learning store: the one place the learning plumbing reads, validates,
// projects and writes the decisions log, the ledger and their side files.
//
// DESIGN: plumbing only. No function here prints or calls process.exit. Work that
// can fail on its input or on the lock returns a Result — { ok: true, value } or
// { ok: false, error: { kind, message } } — and json-helper.cjs prints it. A throw
// means a broken invariant or an I/O failure, never an expected outcome; a lock
// held by withDecisionsLock is released on every path, the throw included.
//
// Loading: node built-ins and three sibling libs only. This module never requires
// decisions-format.cjs or render-decisions.cjs at load time: render-decisions.cjs
// requires it for the status list.
//
// Files under <root>/.devflow/learning/:
//   decisions-log.jsonl          observation rows — the content authority
//   decisions-ledger.jsonl       anchored rows — projections of log rows
//   decisions-log.archive.jsonl  rotated-out observation rows
//   decisions-history.jsonl      prior content versions (D-CONTENT-HISTORY)
//   *.rejected.jsonl             quarantined malformed lines (D-QUARANTINE-MALFORMED)
//   *.pre-v2.jsonl               one-time copies of the v1 files (D-V1-BACKUP-ONCE)
//   .decisions.lock/             the one learning lock (D-ONE-LEARNING-LOCK)
//
// TS COUNTERPART: src/core/observations.ts mirrors the status lists (D201).

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  getLearningDir,
  getDecisionsLedgerPath,
  getDecisionsLogPath,
  getDecisionsArchivePath,
  getDecisionsHistoryPath,
  getDecisionsLockDir,
} = require('./project-paths.cjs');
const { acquireMkdirLock, releaseLock } = require('./mkdir-lock.cjs');
const { safePath } = require('./safe-path.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Schema version stamped on every v2 log and ledger row. */
const SCHEMA_VERSION = 2;

/**
 * Field limits. Text limits count characters (code points); `scopeMin`/`scopeMax`
 * and `evidenceMax` count entries. `note`, `quoteMin`, `quoteMax` and `path` bound
 * the status-change inputs.
 */
const FIELD_LIMITS = Object.freeze({
  title: 120,
  rule: 400,
  why: 300,
  provenance: 120,
  scopeMin: 1,
  scopeMax: 5,
  scopeEntry: 200,
  evidenceMax: 5,
  evidenceItem: 300,
  note: 120,
  quoteMin: 12,
  quoteMax: 200,
  path: 300,
});

/** Statuses of an entry that renders: decisions are Accepted, pitfalls Active. */
const ACTIVE_STATUSES = Object.freeze(['Accepted', 'Active']);

/** Statuses of an entry the ledger keeps but every rendered file and count leaves out. */
const INACTIVE_STATUSES = Object.freeze(['Encoded', 'Superseded', 'Retired', 'Deprecated']);

/** Every status a ledger entry may carry. src/core/observations.ts mirrors it (D201). */
const ENTRY_STATUSES = Object.freeze([...ACTIVE_STATUSES, ...INACTIVE_STATUSES]);

/** An observation's content keys, in the order they are stored (after `id`). */
const CONTENT_KEYS = Object.freeze(['type', 'title', 'rule', 'why', 'scope', 'provenance', 'evidence']);

/** Keys plumbing sets on a log row; an input carrying one is refused (D-PUT-NOT-MERGE). */
const PLUMBING_OWNED_KEYS = Object.freeze(['schema', 'observations', 'first_seen', 'last_seen', 'status', 'anchor_id']);

/** Keys only the ledger holds, carried across every re-projection (D-LOG-CONTENT-AUTHORITY). */
const LEDGER_OWNED_KEYS = Object.freeze([
  'date', 'last_verified', 'last_attempt', 'status_note', 'superseded_by', 'encoded_at', 'retired_on',
]);

/** Maintenance hand-out parameters (D-DUE-ORDER). */
const DUE = Object.freeze({ verifyAgeDays: 30, leaseHours: 24, maxEntries: 5, byteBudget: 61440 });

/** Prior content versions kept per observation id (D-CONTENT-HISTORY). */
const HISTORY_DEPTH = 3;

/** How long a writer waits for .decisions.lock before reporting busy (ms). */
const LOCK_ACQUIRE_TIMEOUT_MS = 30000;

/** Age after which a held .decisions.lock is treated as abandoned and broken (ms). */
const LOCK_STALE_MS = 60000;

/** An anchor id: ADR-NNN or PF-NNN, three or more digits. */
const ANCHOR_ID_RE = /^(ADR|PF)-\d{3,}$/;

/** An observation id. */
const OBS_ID_RE = /^obs_[a-z0-9_]{3,60}$/;

/** Bound on each git call (ms) and on its output (bytes). */
const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** A full commit id, SHA-1 or SHA-256. */
const COMMIT_ID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The content keys a ledger row projects from its log row (evidence stays in the log). */
const PROJECTED_CONTENT_KEYS = Object.freeze(['type', 'title', 'rule', 'why', 'scope', 'provenance']);

/** Keys a create or an update must carry (D-PUT-NOT-MERGE). */
const REQUIRED_KEYS = Object.freeze(['id', 'type', 'title', 'rule', 'why', 'scope', 'provenance']);

const VALIDATION_MODES = Object.freeze(['create', 'update', 'reinforce']);

/**
 * C0 and C1 control characters, DEL, the JS line terminators U+2028/U+2029 and the
 * bidirectional formatting controls — none may appear in an input string, and
 * listings collapse them to a space.
 */
const CONTROL_CHARS_CLASS = '[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]';
const CONTROL_CHAR_RE = new RegExp(CONTROL_CHARS_CLASS);
const CONTROL_RUN_RE = new RegExp(`${CONTROL_CHARS_CLASS}+`, 'g');

/** An anchor named in prose; refused in title, rule and why when the ledger holds it. */
const PROSE_ANCHOR_RE = /\b(?:ADR|PF)-\d{3,}\b/g;

/** An issue or PR reference: `#` and digits after the start or a non-word character other than `&`. */
const ISSUE_REF_RE = /(?:^|[^\w&])#\d+/;

/**
 * Source and text file extensions whose `name.ext:line` or `name.ext#Lline` form is
 * a file-and-line reference. A host:port carries none of them, so it passes.
 */
const LINE_REF_EXTENSIONS = Object.freeze([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'cjs', 'mjs', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'sh', 'bash', 'zsh', 'md', 'mds', 'mdx', 'json', 'jsonl',
  'ya?ml', 'toml', 'txt', 'html', 'css', 'scss', 'sql', 'xml',
]);
const FILE_LINE_REF_RE = new RegExp(`[\\w-]\\.(?:${LINE_REF_EXTENSIONS.join('|')})(?::\\d+|#L\\d+)`, 'i');

/** A scope area tag. */
const AREA_TAG_RE = /^area:[a-z0-9][a-z0-9-]{0,39}$/;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Length in characters (code points), not UTF-16 code units. */
function codePointLength(text) {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

/** A deep copy of a JSON value, so a returned row never shares structure with its inputs. */
function copyJson(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/** True when both values serialize to the same JSON. */
function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `text` with each run of control characters collapsed to one space. */
function singleLine(text) {
  return text.replace(CONTROL_RUN_RE, ' ');
}

/** `text` cut to at most `max` characters, the last one `…` when it was cut. */
function cutTo(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…';
}

/** The anchor prefix rows of `type` take, or null for any other type. */
function anchorPrefixFor(type) {
  if (type === 'decision') return 'ADR';
  if (type === 'pitfall') return 'PF';
  return null;
}

/** Sort key of an anchor id: decisions before pitfalls, then by number; anything else last. */
function anchorOrder(anchorId) {
  const m = typeof anchorId === 'string' ? /^(ADR|PF)-(\d+)$/.exec(anchorId) : null;
  return m ? [m[1] === 'ADR' ? 0 : 1, parseInt(m[2], 10)] : [2, Infinity];
}

/** Comparator for rows by anchor_id (see anchorOrder). */
function compareByAnchor(a, b) {
  const [rankA, numA] = anchorOrder(a.anchor_id);
  const [rankB, numB] = anchorOrder(b.anchor_id);
  if (rankA !== rankB) return rankA - rankB;
  if (numA !== numB) return numA < numB ? -1 : 1;
  return String(a.anchor_id).localeCompare(String(b.anchor_id));
}

/** A sorted copy of `rows`, by anchor. */
function sortedByAnchor(rows) {
  return [...rows].sort(compareByAnchor);
}

/** Ledger rows that carry an anchor and an active status. */
function activeAnchoredRows(ledger) {
  return ledger.filter(row => isNonEmptyString(row.anchor_id) && isActive(row));
}

/** `file` with its `.jsonl` extension replaced by `suffix` (appended when it has none). */
function withJsonlSuffix(file, suffix) {
  return /\.jsonl$/.test(file) ? file.replace(/\.jsonl$/, suffix) : file + suffix;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * True when a ledger row renders: its decisions_status is absent, or is anything
 * outside INACTIVE_STATUSES (an unknown status counts as active).
 *
 * @param {{ decisions_status?: unknown }} row
 * @returns {boolean}
 */
function isActive(row) {
  const status = row.decisions_status;
  return !status || !INACTIVE_STATUSES.includes(status);
}

/**
 * The active status of an entry of `type`: Accepted for a decision, Active for a
 * pitfall. Any other type is a caller error.
 *
 * @param {string} type
 * @returns {'Accepted'|'Active'}
 */
function activeStatusFor(type) {
  if (type === 'decision') return 'Accepted';
  if (type === 'pitfall') return 'Active';
  throw new Error(`activeStatusFor: type must be 'decision' or 'pitfall', got '${type}'`);
}

/**
 * True for a v2 row (schema 2).
 *
 * @param {unknown} row
 * @returns {boolean}
 */
function isV2(row) {
  return isPlainObject(row) && row.schema === SCHEMA_VERSION;
}

// ---------------------------------------------------------------------------
// JSONL I/O
// ---------------------------------------------------------------------------

/** One JSONL line as a row, or undefined when it is not exactly one JSON object. */
function parseRow(text) {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a JSONL file strictly: every non-blank line is either one JSON object (a
 * row) or rejected, with its 1-based line number and its text.
 *
 * D-QUARANTINE-MALFORMED: a line that is not one JSON object is never read as a
 * row and never silently dropped. readJsonl returns it among `rejected`; a writer
 * appends it to the file's `.rejected.jsonl` sibling before rewriting the file
 * (readJsonlForWrite), and a read-only path only reports it and writes nothing.
 * Reason: a reader that skips malformed lines lets the next whole-file rewrite
 * delete them without a trace, and a reader that quarantined would make list,
 * show and the HUD write files.
 *
 * @param {string} file
 * @returns {{ rows: object[], rejected: Array<{ line: number, text: string }>, missing: boolean }}
 *   `missing` is true when the file does not exist. Any read error other than a
 *   missing file is thrown.
 */
function readJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(safePath(file), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { rows: [], rejected: [], missing: true };
    throw err;
  }
  const rows = [];
  const rejected = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.trim() === '') continue;
    const row = parseRow(text);
    if (row === undefined) rejected.push({ line: i + 1, text });
    else rows.push(row);
  }
  return { rows, rejected, missing: false };
}

/**
 * The quarantine file for `file`: `decisions-log.jsonl` → `decisions-log.rejected.jsonl`.
 *
 * @param {string} file
 * @returns {string}
 */
function rejectedPathFor(file) {
  return withJsonlSuffix(file, '.rejected.jsonl');
}

/**
 * Append to `file`, creating it when absent. O_NOFOLLOW refuses a symlink planted
 * at `file` (ELOOP) instead of writing through it.
 */
function appendNoFollow(file, content) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o666);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Append each rejected line of `file` to its quarantine file as one record
 * `{ rejected_at, source, line, text }` (D-QUARANTINE-MALFORMED). Append-only;
 * writes nothing when nothing was rejected.
 *
 * @param {string} file - the file the lines were read from
 * @param {Array<{ line: number, text: string }>} rejected
 * @param {{ now?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {number} the number of records appended
 */
function quarantineRejected(file, rejected, { now = Date.now() } = {}) {
  if (rejected.length === 0) return 0;
  const rejectedAt = new Date(now).toISOString();
  const source = path.basename(file);
  const content = rejected
    .map(r => JSON.stringify({ rejected_at: rejectedAt, source, line: r.line, text: r.text }))
    .join('\n') + '\n';
  appendNoFollow(rejectedPathFor(file), content);
  return rejected.length;
}

/**
 * Read `file` for a rewrite: quarantine its malformed lines first, then return
 * its rows (D-QUARANTINE-MALFORMED). Call it only on a path that rewrites the
 * file — a read-only path uses readJsonl.
 *
 * @param {string} file
 * @param {{ now?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {object[]}
 */
function readJsonlForWrite(file, { now = Date.now() } = {}) {
  const { rows, rejected } = readJsonl(file);
  quarantineRejected(file, rejected, { now });
  return rows;
}

/**
 * Write `tmp` with O_EXCL (wx flag) so the kernel rejects the open if a file or
 * symlink already exists at that path, preventing TOCTOU symlink-follow attacks.
 * On EEXIST (stale or attacker-placed .tmp) it unlinks and retries once.
 *
 * @param {string} tmp - Path to the temporary file.
 * @param {string} content - Content to write.
 */
function writeExclusive(tmp, content) {
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Stale or attacker-placed .tmp — remove it and retry once.
    try { fs.unlinkSync(tmp); } catch { /* race — already removed */ }
    fs.writeFileSync(tmp, content, { flag: 'wx' });
  }
}

/**
 * Atomically write a text file via a PID-scoped .tmp sibling and rename, so
 * concurrent writers from different processes never collide on one .tmp path.
 *
 * @param {string} file
 * @param {string} content
 */
function writeFileAtomic(file, content) {
  const tmp = file + '.tmp.' + process.pid;
  writeExclusive(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * Atomically write rows as JSONL: one row per line with a trailing newline, or an
 * empty file for no rows.
 *
 * @param {string} file
 * @param {object[]} rows
 */
function writeJsonlAtomic(file, rows) {
  const content = rows.length > 0 ? rows.map(r => JSON.stringify(r)).join('\n') + '\n' : '';
  writeFileAtomic(file, content);
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

/**
 * True when `<root>/.devflow/learning` exists and is a directory.
 *
 * @param {string} root - project root
 * @returns {boolean}
 */
function hasLearningDir(root) {
  try {
    return fs.statSync(getLearningDir(root)).isDirectory();
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return false;
    throw err;
  }
}

/** True for a Result: `{ ok: true, … }` or `{ ok: false, error: { … } }`. */
function isResult(value) {
  return isPlainObject(value) && (value.ok === true || (value.ok === false && isPlainObject(value.error)));
}

/**
 * Run `fn` under `.decisions.lock` and return the Result it returns, unchanged.
 * The lock is released on every path, a throw from `fn` included; the throw then
 * reaches the caller.
 *
 * D-ONE-LEARNING-LOCK: learning writers take one lock, `.decisions.lock`, through
 * this wrapper — every write to the log, the ledger, their side files and the
 * rendered files happens under it. Reason: two writers under two locks can each
 * read one file, change it and rename their copy over it, and the second rename
 * silently discards the first one's change.
 *
 * D-NO-STRAY-TREE: a learning writer refuses with `no-learning-dir` when
 * `.devflow/learning/` is absent under its root, and the store never creates that
 * directory or its parent — the lock directory is the only thing made inside it.
 * Reason: a writer run from the wrong directory would otherwise create a learning
 * tree there and write a ledger that no session ever reads.
 *
 * @param {string} opName - operation name, for messages
 * @param {string} root - project root
 * @param {() => { ok: boolean }} fn - the locked body; it must return a Result
 * @param {{ timeoutMs?: number, staleMs?: number }} [opts]
 * @returns {{ ok: true, value?: unknown } | { ok: false, error: { kind: string, message: string } }}
 *   fn's Result, or an error of kind `no-learning-dir` or `busy`.
 */
function withDecisionsLock(opName, root, fn, { timeoutMs = LOCK_ACQUIRE_TIMEOUT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const noLearningDir = {
    ok: false,
    error: { kind: 'no-learning-dir', message: `${opName}: no .devflow/learning/ under ${root} — run from the project root` },
  };
  if (!hasLearningDir(root)) return noLearningDir;
  const lockDir = getDecisionsLockDir(root);
  let acquired;
  try {
    acquired = acquireMkdirLock(lockDir, timeoutMs, staleMs);
  } catch (err) {
    // The learning directory went away between the check and the mkdir.
    if (err && err.code === 'ENOENT') return noLearningDir;
    throw err;
  }
  if (!acquired) {
    return { ok: false, error: { kind: 'busy', message: `${opName}: timeout acquiring lock at ${lockDir}` } };
  }
  try {
    const result = fn();
    if (!isResult(result)) {
      throw new TypeError(`${opName}: the locked body must return a Result ({ ok: true, value } or { ok: false, error })`);
    }
    return result;
  } finally {
    releaseLock(lockDir);
  }
}

// ---------------------------------------------------------------------------
// State and the ledger registry
// ---------------------------------------------------------------------------

/**
 * Read the ledger and the log, read-only: malformed lines are reported, never
 * quarantined (D-QUARANTINE-MALFORMED). An absent file reads as empty.
 *
 * @param {string} root - project root
 * @returns {{ ledgerRows: object[], logRows: object[], rejected: { ledger: Array<{ line: number, text: string }>, log: Array<{ line: number, text: string }> } }}
 */
function readLearningState(root) {
  const ledger = readJsonl(getDecisionsLedgerPath(root));
  const log = readJsonl(getDecisionsLogPath(root));
  return {
    ledgerRows: ledger.rows,
    logRows: log.rows,
    rejected: { ledger: ledger.rejected, log: log.rejected },
  };
}

/**
 * Index ledger rows by anchor and by observation id.
 *
 * D-LEDGER-REGISTRY: the ledger alone records what is promoted. An observation is
 * anchored when any ledger row carries its id, and an anchor is taken when any
 * ledger row carries it, whatever the log row says; lookups go through this
 * registry, never through an anchor_id copied onto a log row. Reason: a guard that
 * read the log row's anchor_id had no writer for most anchored rows, so one
 * observation was promoted twice under two numbers.
 *
 * @param {object[]} ledgerRows
 * @returns {{ byAnchor: Map<string, object>, byObsId: Map<string, object[]> }}
 *   byAnchor keeps the first row of a repeated anchor; byObsId lists every row
 *   carrying the id, in ledger order.
 */
function ledgerRegistry(ledgerRows) {
  const byAnchor = new Map();
  const byObsId = new Map();
  for (const row of ledgerRows) {
    if (isNonEmptyString(row.anchor_id) && !byAnchor.has(row.anchor_id)) byAnchor.set(row.anchor_id, row);
    if (isNonEmptyString(row.id)) {
      const carriers = byObsId.get(row.id);
      if (carriers) carriers.push(row);
      else byObsId.set(row.id, [row]);
    }
  }
  return { byAnchor, byObsId };
}

// ---------------------------------------------------------------------------
// Observation validation
// ---------------------------------------------------------------------------

/** Why a key outside the accepted set is refused. */
function keyRefusal(key, mode) {
  if (PLUMBING_OWNED_KEYS.includes(key)) return 'is set by plumbing, never by the caller';
  if (LEDGER_OWNED_KEYS.includes(key)) return 'is held by the ledger, never by an observation';
  if (mode === 'reinforce' && CONTENT_KEYS.includes(key)) return 'is not taken by a reinforce, which carries the id alone';
  return 'is not a known key';
}

/** The problem with a text value, or null: type, blank, control characters, length. */
function textProblem(value, limit) {
  if (typeof value !== 'string') return 'must be a string';
  if (value.trim() === '') return 'must not be blank';
  if (CONTROL_CHAR_RE.test(value)) return 'must be one line with no control characters';
  const length = codePointLength(value);
  if (length > limit) return `is ${length} characters, over the limit of ${limit}`;
  return null;
}

/**
 * The problem with title, rule or why prose that rots, or null: an anchor the
 * ledger holds, an issue reference or a file-and-line reference.
 *
 * @param {string} value
 * @param {Set<string>} ledgerIds - every anchor in the ledger
 * @returns {string|null}
 */
function proseProblem(value, ledgerIds) {
  const named = (value.match(PROSE_ANCHOR_RE) || []).find(anchor => ledgerIds.has(anchor));
  if (named) return `names ledger entry ${named}; state the rule in words`;
  if (ISSUE_REF_RE.test(value)) return 'carries an issue reference; state what it established instead';
  if (FILE_LINE_REF_RE.test(value)) return 'carries a file-and-line reference; name the function or quote the line instead';
  return null;
}

/** The problem with a glob's shape, or null. */
function globShapeProblem(glob) {
  if (glob.startsWith('/') || glob.startsWith(':')) return 'must be relative to the repository root, with no pathspec magic';
  if (/[\s`|]/.test(glob)) return 'must not contain whitespace, a backtick or |';
  if (glob.split('/').includes('..')) return 'must not contain a .. segment';
  return null;
}

/** The problem with one scope entry, or null. git is asked only about a well-shaped glob. */
function scopeEntryProblem(entry, scopeMatches) {
  const text = textProblem(entry, FIELD_LIMITS.scopeEntry);
  if (text) return text;
  if (entry.startsWith('area:')) {
    return AREA_TAG_RE.test(entry)
      ? null
      : 'is not an area tag: area: then a lowercase letter or digit and up to 39 lowercase letters, digits or hyphens';
  }
  return globShapeProblem(entry) || (scopeMatches(entry) ? null : 'matches no tracked file');
}

/** Errors for the scope list. */
function scopeErrors(scope, scopeMatches) {
  if (!Array.isArray(scope)) return [{ field: 'scope', message: 'must be an array of area tags and globs' }];
  const { scopeMin, scopeMax } = FIELD_LIMITS;
  if (scope.length < scopeMin || scope.length > scopeMax) {
    return [{ field: 'scope', message: `holds ${scope.length} entries; it takes ${scopeMin} to ${scopeMax}` }];
  }
  const errors = [];
  scope.forEach((entry, i) => {
    const problem = scopeEntryProblem(entry, scopeMatches);
    if (problem) errors.push({ field: `scope[${i}]`, message: problem });
  });
  return errors;
}

/** Errors for the optional evidence list. */
function evidenceErrors(evidence) {
  if (evidence === undefined) return [];
  if (!Array.isArray(evidence)) return [{ field: 'evidence', message: 'must be an array of quotes' }];
  if (evidence.length > FIELD_LIMITS.evidenceMax) {
    return [{ field: 'evidence', message: `holds ${evidence.length} items, over the limit of ${FIELD_LIMITS.evidenceMax}` }];
  }
  const errors = [];
  evidence.forEach((item, i) => {
    const problem = textProblem(item, FIELD_LIMITS.evidenceItem);
    if (problem) errors.push({ field: `evidence[${i}]`, message: problem });
  });
  return errors;
}

/**
 * Validate one put-observation input and report every problem at once.
 *
 * D-PUT-NOT-MERGE: a create or an update carries the whole content — the id and
 * every CONTENT_KEYS key it needs — and the stored row is exactly that content
 * plus the counters plumbing keeps; an update replaces the content and never
 * merges with the prior row. A key plumbing owns (PLUMBING_OWNED_KEYS), a key the
 * ledger owns (LEDGER_OWNED_KEYS) or any other unknown key is refused, and a
 * reinforce carries the id alone. Reason: a merge keeps whatever the new content
 * no longer says, so a stale clause outlives every rewrite, and an input that sets
 * a counter, a status or an anchor would let the writer forge plumbing state.
 *
 * Field rules: text is one line with no control characters, not blank, and within
 * FIELD_LIMITS. Title, rule and why may not name an anchor the ledger holds, carry
 * an issue reference (`#` and digits after a non-word character other than `&`) or
 * carry a file-and-line reference; provenance and evidence record where a lesson
 * came from and may cite all three. A scope entry is an area tag or a glob that is
 * relative, has no `..` segment, whitespace, backtick or `|`, and matches at least
 * one tracked file.
 *
 * @param {unknown} input - the parsed stdin object
 * @param {{
 *   mode: 'create'|'update'|'reinforce',
 *   existing?: object|null,
 *   ledgerIds?: Iterable<string>,
 *   scopeMatches?: (glob: string) => boolean,
 * }} opts
 *   existing — the log row with the input's id, or null; ledgerIds — every anchor
 *   in the ledger; scopeMatches — required for create and update.
 * @returns {{ ok: true, value: object } | { ok: false, errors: Array<{ field: string, message: string }> }}
 *   value is the content in canonical key order (id, then CONTENT_KEYS), or `{ id }`
 *   for a reinforce. Errors come key refusals first, then by field in that order.
 */
function validateObservationInput(input, { mode, existing = null, ledgerIds = [], scopeMatches } = {}) {
  if (!VALIDATION_MODES.includes(mode)) {
    throw new TypeError(`validateObservationInput: mode must be one of ${VALIDATION_MODES.join(', ')}, got '${mode}'`);
  }
  if (mode !== 'reinforce' && typeof scopeMatches !== 'function') {
    throw new TypeError('validateObservationInput: a create or an update needs scopeMatches');
  }
  if (!isPlainObject(input)) return { ok: false, errors: [{ field: '(input)', message: 'must be one JSON object' }] };

  const errors = [];
  const accepted = mode === 'reinforce' ? ['id'] : ['id', ...CONTENT_KEYS];
  for (const key of Object.keys(input)) {
    if (!accepted.includes(key)) errors.push({ field: key, message: keyRefusal(key, mode) });
  }

  const present = key => input[key] !== undefined;
  const required = mode === 'reinforce' ? ['id'] : REQUIRED_KEYS;
  const fieldError = (field, problem) => { if (problem) errors.push({ field, message: problem }); };
  const missing = key => (required.includes(key) && !present(key) ? 'is required' : null);

  const idValid = typeof input.id === 'string' && OBS_ID_RE.test(input.id);
  fieldError('id', missing('id') || (idValid ? null : 'must be obs_ and then 3 to 60 lowercase letters, digits or underscores'));
  if (idValid && mode === 'create' && existing) fieldError('id', 'is already in the log; update it instead');
  if (idValid && mode !== 'create' && !existing) fieldError('id', 'is not in the log');

  if (mode !== 'reinforce') {
    const typeValid = input.type === 'decision' || input.type === 'pitfall';
    fieldError('type', missing('type') || (typeValid ? null : "must be 'decision' or 'pitfall'"));
    if (typeValid && mode === 'update' && existing && existing.type !== input.type) {
      fieldError('type', `cannot change from '${existing.type}' to '${input.type}'`);
    }

    const ledgerIdSet = new Set(ledgerIds);
    for (const field of ['title', 'rule', 'why']) {
      fieldError(field, missing(field) || (present(field)
        ? textProblem(input[field], FIELD_LIMITS[field]) || proseProblem(input[field], ledgerIdSet)
        : null));
    }
    const scopeMissing = missing('scope');
    if (scopeMissing) fieldError('scope', scopeMissing);
    else errors.push(...scopeErrors(input.scope, scopeMatches));
    fieldError('provenance', missing('provenance') || (present('provenance')
      ? textProblem(input.provenance, FIELD_LIMITS.provenance)
      : null));
    errors.push(...evidenceErrors(input.evidence));
  }

  if (errors.length > 0) return { ok: false, errors };
  const value = { id: input.id };
  if (mode !== 'reinforce') {
    for (const key of CONTENT_KEYS) {
      if (present(key)) value[key] = copyJson(input[key]);
    }
  }
  return { ok: true, value };
}

/**
 * A memoized `(glob) => boolean` answering whether `glob` matches at least one
 * file git tracks under `root` (`git ls-files -- ':(glob)<glob>'`). Each glob is
 * asked once per matcher. Any git failure — not a repository, a timeout — answers
 * false, so a scope that cannot be checked is refused, never accepted.
 *
 * @param {string} root - project root
 * @returns {(glob: string) => boolean}
 */
function gitScopeMatcher(root) {
  const answers = new Map();
  const tracks = glob => {
    if (!isNonEmptyString(glob)) return false;
    let out;
    try {
      // D-NO-FSMONITOR
      out = execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ':(glob)' + glob], {
        cwd: root,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
    } catch {
      return false;
    }
    return out.split('\0').some(name => name !== '');
  };
  return glob => {
    if (!answers.has(glob)) answers.set(glob, tracks(glob));
    return answers.get(glob);
  };
}

// ---------------------------------------------------------------------------
// Projection and counters
// ---------------------------------------------------------------------------

/**
 * Project a v2 log row into its ledger row.
 *
 * D-LOG-CONTENT-AUTHORITY: the observation log is the one home of an entry's
 * content — its type, title, rule, why, scope and provenance. A ledger row is a
 * projection of its log row, built by this function alone, at promotion and at
 * every re-projection; nothing else writes entry content into the ledger. The
 * ledger owns what is about the entry rather than in it: the anchor number,
 * decisions_status and the LEDGER_OWNED_KEYS (the promotion date, last_verified,
 * last_attempt, the status note, superseded_by, encoded_at and retired_on), which
 * carry over from the prior ledger row unless the caller sets them. Reason: a
 * ledger row copied once at promotion silently lost every later sharpening of its
 * entry, and content kept in two places leaves two authorities that disagree.
 *
 * Key order: schema, id, type, anchor_id, decisions_status, title, rule, why,
 * scope, provenance, then the LEDGER_OWNED_KEYS present. Evidence and the
 * counters stay in the log; a prior v1 row's pattern, details, amendments and any
 * other key are dropped.
 *
 * @param {object} logRow - a v2 log row
 * @param {object|null|undefined} priorLedgerRow - the entry's current ledger row, or none at promotion
 * @param {{ anchorId?: string, status?: string, date?: string, expectType?: string }} [opts]
 *   anchorId and status default to the prior row's; date, when given, replaces it.
 * @returns {object} a new ledger row
 * @throws when the log row is not v2, its type differs from expectType, the anchor
 *   is malformed or belongs to the other type, or the status is not an entry status
 */
function toLedgerRowV2(logRow, priorLedgerRow, { anchorId, status, date, expectType } = {}) {
  if (!isV2(logRow)) throw new Error(`toLedgerRowV2: log row '${logRow && logRow.id}' is not a v2 row`);
  const prior = priorLedgerRow || {};
  const anchor = anchorId !== undefined ? anchorId : prior.anchor_id;
  if (expectType !== undefined && logRow.type !== expectType) {
    throw new Error(`toLedgerRowV2: type mismatch for ${anchor} — ledger has '${expectType}', log has '${logRow.type}'`);
  }
  if (typeof anchor !== 'string' || !ANCHOR_ID_RE.test(anchor)) {
    throw new Error(`toLedgerRowV2: '${anchor}' is not an anchor id`);
  }
  if (!anchor.startsWith(`${anchorPrefixFor(logRow.type)}-`)) {
    throw new Error(`toLedgerRowV2: anchor ${anchor} does not belong to a ${logRow.type} row`);
  }
  const entryStatus = status !== undefined ? status : prior.decisions_status;
  if (!ENTRY_STATUSES.includes(entryStatus)) {
    throw new Error(`toLedgerRowV2: '${entryStatus}' is not an entry status`);
  }

  const row = {
    schema: SCHEMA_VERSION,
    id: logRow.id,
    type: logRow.type,
    anchor_id: anchor,
    decisions_status: entryStatus,
  };
  for (const key of PROJECTED_CONTENT_KEYS) {
    if (key !== 'type' && logRow[key] !== undefined) row[key] = copyJson(logRow[key]);
  }
  for (const key of LEDGER_OWNED_KEYS) {
    const value = key === 'date' && date !== undefined ? date : prior[key];
    if (value !== undefined) row[key] = copyJson(value);
  }
  return row;
}

/** `value` when it is a positive integer, else undefined. */
function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** `value` when it is a string that parses as a date, else undefined. */
function timestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/**
 * The counters a v2 log row carries, derived from any row: `observations` falls
 * back to `count`, then 1; `first_seen` falls back to `created`, then `last_seen`,
 * then now; `last_seen` falls back to the resolved `first_seen`. A value that is
 * not a positive integer or a parseable date counts as absent.
 *
 * @param {object} row
 * @param {{ now?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {{ observations: number, first_seen: string, last_seen: string }}
 */
function toV2Counters(row, { now = Date.now() } = {}) {
  const firstSeen = timestamp(row.first_seen) || timestamp(row.created) || timestamp(row.last_seen)
    || new Date(now).toISOString();
  return {
    observations: positiveInteger(row.observations) || positiveInteger(row.count) || 1,
    first_seen: firstSeen,
    last_seen: timestamp(row.last_seen) || firstSeen,
  };
}

// ---------------------------------------------------------------------------
// History and the pre-v2 backup
// ---------------------------------------------------------------------------

/**
 * Record an entry's prior content in decisions-history.jsonl and trim that entry
 * to its last HISTORY_DEPTH versions. A writer under the lock calls it before it
 * replaces the content; malformed history lines are quarantined first.
 *
 * D-CONTENT-HISTORY: before a write replaces an entry's content, the writer
 * appends the prior log row and ledger rows to decisions-history.jsonl, which
 * keeps the last HISTORY_DEPTH versions per observation id; a write that leaves
 * the content as it was appends nothing. Reason: rewrites replace content in place
 * rather than appending to it, so without a history the first bad rewrite would
 * lose the wording it replaced.
 *
 * @param {string} root - project root
 * @param {{ id: string, ledger?: object[], log?: object|null }} entry - the prior versions
 * @param {{ now?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {number} the versions the entry now has (at most HISTORY_DEPTH)
 */
function appendHistory(root, { id, ledger = [], log = null }, { now = Date.now() } = {}) {
  if (!isNonEmptyString(id)) throw new TypeError('appendHistory: id must be a non-empty string');
  if (!Array.isArray(ledger)) throw new TypeError('appendHistory: ledger must be an array of rows');
  const file = getDecisionsHistoryPath(root);
  const prior = readJsonlForWrite(file, { now });
  const versions = prior.filter(r => r.id === id).length;
  let toDrop = Math.max(0, versions + 1 - HISTORY_DEPTH);
  const kept = prior.filter(r => {
    if (r.id !== id || toDrop === 0) return true;
    toDrop -= 1;
    return false;
  });
  const record = { id, at: new Date(now).toISOString(), ledger: copyJson(ledger), log: copyJson(log) };
  writeJsonlAtomic(file, [...kept, record]);
  return Math.min(versions + 1, HISTORY_DEPTH);
}

/**
 * The stored prior versions of observation `id`, oldest first. Read-only.
 *
 * @param {string} root - project root
 * @param {string} id
 * @returns {object[]} records `{ id, at, ledger, log }`
 */
function historyVersions(root, id) {
  return readJsonl(getDecisionsHistoryPath(root)).rows.filter(r => r.id === id);
}

/**
 * Copy the v1 files aside before the first v2 write.
 *
 * D-V1-BACKUP-ONCE: the first write to a tree that still holds a v1 row copies the
 * log, the ledger and the archive, as they are on disk, to `*.pre-v2.jsonl` with
 * an exclusive create, before anything rewrites them; an existing copy is never
 * overwritten. Reason: v2 writes convert and rewrite v1 rows, and these copies are
 * the only record of the corpus as it was before the conversion.
 *
 * @param {string} root - project root
 * @param {{ logRows?: object[], ledgerRows?: object[] }} rows - the rows just read
 * @returns {string[]} the backup paths written by this call (none when every row
 *   is v2, a file is absent or its copy already exists)
 */
function ensurePreV2Backup(root, { logRows = [], ledgerRows = [] } = {}) {
  if ([...logRows, ...ledgerRows].every(row => isV2(row))) return [];
  const written = [];
  for (const file of [getDecisionsLogPath(root), getDecisionsLedgerPath(root), getDecisionsArchivePath(root)]) {
    const copy = withJsonlSuffix(file, '.pre-v2.jsonl');
    try {
      fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
      written.push(copy);
    } catch (err) {
      if (err && (err.code === 'EEXIST' || err.code === 'ENOENT')) continue;
      throw err;
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Integrity, listing, due selection and show — all read-only
// ---------------------------------------------------------------------------

/** True when a v2 row lists a glob scope entry that matches no tracked file. */
function hasUnmatchedScope(row, scopeMatches) {
  if (!isV2(row) || !Array.isArray(row.scope)) return false;
  return row.scope.some(entry => !(isNonEmptyString(entry) && (entry.startsWith('area:') || scopeMatches(entry))));
}

/**
 * Integrity problems of the active ledger rows, in anchor order:
 *   duplicate-obs-id       another active row carries the same observation id
 *   ledger-without-log     no log row carries the row's id
 *   scope-matches-nothing  a glob in a v2 row's scope matches no tracked file
 *                          (checked only when scopeMatches is given)
 *
 * @param {object[]} ledger
 * @param {object[]} log
 * @param {{ scopeMatches?: (glob: string) => boolean }} [opts]
 * @returns {Array<{ anchor_id: string, id: unknown, flags: string[] }>} only rows with a flag
 */
function integrityFlags(ledger, log, { scopeMatches } = {}) {
  const active = activeAnchoredRows(ledger);
  const logIds = new Set(log.map(row => row.id).filter(isNonEmptyString));
  const carriers = new Map();
  for (const row of active) {
    if (isNonEmptyString(row.id)) carriers.set(row.id, (carriers.get(row.id) || 0) + 1);
  }
  const flagged = [];
  for (const row of sortedByAnchor(active)) {
    const flags = [];
    if (isNonEmptyString(row.id) && carriers.get(row.id) > 1) flags.push('duplicate-obs-id');
    if (!isNonEmptyString(row.id) || !logIds.has(row.id)) flags.push('ledger-without-log');
    if (scopeMatches && hasUnmatchedScope(row, scopeMatches)) flags.push('scope-matches-nothing');
    if (flags.length > 0) flagged.push({ anchor_id: row.anchor_id, id: row.id, flags });
  }
  return flagged;
}

/** A row's title for a listing: the v2 title or the v1 pattern, on one line, cut to the title limit. */
function listingTitle(row) {
  const raw = isV2(row) ? row.title : row.pattern;
  return typeof raw === 'string' ? cutTo(singleLine(raw), FIELD_LIMITS.title) : '';
}

/** Why an inactive entry is inactive, in a few words, or '' when it records nothing. */
function inactiveNote(row) {
  if (isPlainObject(row.encoded_at) && isNonEmptyString(row.encoded_at.path)) return `encoded in ${row.encoded_at.path}`;
  if (isNonEmptyString(row.superseded_by)) return `superseded by ${row.superseded_by}`;
  if (isNonEmptyString(row.status_note)) return row.status_note;
  return '';
}

/** One ledger row as a listing line. */
function listingRow(row) {
  const entry = {
    anchor_id: row.anchor_id,
    id: row.id,
    type: row.type,
    status: isNonEmptyString(row.decisions_status) ? row.decisions_status : null,
    title: listingTitle(row),
    schema: isV2(row) ? 2 : 1,
  };
  if (isNonEmptyString(row.last_verified)) entry.last_verified = row.last_verified;
  return entry;
}

/** One unpromoted log row as a listing line. */
function observationListingRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: listingTitle(row),
    schema: isV2(row) ? 2 : 1,
    observations: positiveInteger(row.observations) || positiveInteger(row.count) || null,
    last_seen: isNonEmptyString(row.last_seen) ? row.last_seen : null,
  };
}

/**
 * The data behind `list`: active and inactive entries in anchor order, the
 * observations no ledger row carries (by id), the integrity flags and the
 * malformed-line counts. A v1 title is its pattern cut to the title limit.
 *
 * @param {object[]} ledger
 * @param {object[]} log
 * @param {{ scopeMatches?: (glob: string) => boolean, rejected?: { ledger?: unknown[], log?: unknown[] } }} [opts]
 * @returns {{ active: object[], inactive: object[], observations: object[], integrity: object[], malformed: { ledger: number, log: number } }}
 */
function buildListing(ledger, log, { scopeMatches, rejected = {} } = {}) {
  const anchored = ledger.filter(row => isNonEmptyString(row.anchor_id));
  const carried = new Set(ledger.map(row => row.id).filter(isNonEmptyString));
  return {
    active: sortedByAnchor(anchored.filter(row => isActive(row))).map(listingRow),
    inactive: sortedByAnchor(anchored.filter(row => !isActive(row)))
      .map(row => ({ ...listingRow(row), note: singleLine(inactiveNote(row)) })),
    observations: log
      .filter(row => isNonEmptyString(row.id) && !carried.has(row.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(observationListingRow),
    integrity: integrityFlags(ledger, log, { scopeMatches }),
    malformed: { ledger: (rejected.ledger || []).length, log: (rejected.log || []).length },
  };
}

/**
 * An entry's size for the maintenance budget: the UTF-8 bytes of its ledger row
 * plus those of its log row, both as compact JSON.
 *
 * @param {object} ledgerRow
 * @param {object|null|undefined} logRow
 * @returns {number}
 */
function entrySize(ledgerRow, logRow) {
  const ledgerBytes = Buffer.byteLength(JSON.stringify(ledgerRow), 'utf8');
  return logRow ? ledgerBytes + Buffer.byteLength(JSON.stringify(logRow), 'utf8') : ledgerBytes;
}

/**
 * Pick the entries maintenance works on next.
 *
 * D-DUE-ORDER: maintenance hands out active entries in three classes, in order:
 * entries with an integrity flag (by anchor), legacy v1 entries (decisions before
 * pitfalls, then by number), then v2 entries last verified more than
 * DUE.verifyAgeDays ago (oldest first, never verified counting as oldest). An
 * entry attempted within DUE.leaseHours is skipped. At most DUE.maxEntries are
 * handed out, stopping at the first entry that would take the total past
 * DUE.byteBudget, and always at least one. Reason: a broken entry misleads every
 * reader until it is fixed, a v1 entry stays outside the v2 ops until it is
 * rewritten, the lease stops a run that died mid-entry from having the same entry
 * handed out again at once, and the cap and budget keep one run's reading bounded.
 *
 * @param {object[]} ledger
 * @param {object[]} log
 * @param {{ now?: number, integrity?: Array<{ anchor_id: string, flags: string[] }>, maxEntries?: number, budgetBytes?: number }} [opts]
 *   now: epoch ms; integrity: integrityFlags' result.
 * @returns {Array<{ anchor_id: string, reason: string, bytes: number }>} reason is
 *   the integrity flags joined by commas, `legacy-v1` or `verify-age`
 */
function selectDue(ledger, log, { now = Date.now(), integrity = [], maxEntries = DUE.maxEntries, budgetBytes = DUE.byteBudget } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('selectDue: maxEntries must be a positive integer');
  if (!Number.isFinite(budgetBytes) || budgetBytes < 1) throw new TypeError('selectDue: budgetBytes must be positive');
  const leaseMs = DUE.leaseHours * HOUR_MS;
  const verifyAgeMs = DUE.verifyAgeDays * DAY_MS;

  const logById = new Map();
  for (const row of log) {
    if (isNonEmptyString(row.id) && !logById.has(row.id)) logById.set(row.id, row);
  }
  const flagsByAnchor = new Map(integrity.map(entry => [entry.anchor_id, entry.flags]));
  const leased = row => {
    const attemptedAt = Date.parse(row.last_attempt);
    return Number.isFinite(attemptedAt) && now >= attemptedAt && now - attemptedAt < leaseMs;
  };
  const verifiedAt = row => {
    const at = Date.parse(row.last_verified);
    return Number.isFinite(at) ? at : -Infinity;
  };

  const candidates = activeAnchoredRows(ledger).filter(row => !leased(row));
  const flagged = candidates.filter(row => flagsByAnchor.has(row.anchor_id));
  const unflagged = candidates.filter(row => !flagsByAnchor.has(row.anchor_id));
  const ordered = [
    ...sortedByAnchor(flagged).map(row => ({ row, reason: flagsByAnchor.get(row.anchor_id).join(',') })),
    ...sortedByAnchor(unflagged.filter(row => !isV2(row))).map(row => ({ row, reason: 'legacy-v1' })),
    ...unflagged
      .filter(row => isV2(row) && now - verifiedAt(row) > verifyAgeMs)
      .sort((a, b) => (verifiedAt(a) - verifiedAt(b)) || compareByAnchor(a, b))
      .map(row => ({ row, reason: 'verify-age' })),
  ];

  const due = [];
  let total = 0;
  for (const { row, reason } of ordered) {
    if (due.length >= maxEntries) break;
    const bytes = entrySize(row, logById.get(row.id));
    if (due.length > 0 && total + bytes > budgetBytes) break;
    due.push({ anchor_id: row.anchor_id, reason, bytes });
    total += bytes;
  }
  return due;
}

/** Whitespace-normalized text, or '' for a non-string. */
function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The ledger-only-content flag of one ledger row, as a one-element list, or none.
 * A v1 row is flagged when its whitespace-normalized details are non-empty and not
 * contained in its log row's; a v2 row when any projected content field differs
 * from its log row's.
 */
function ledgerOnlyContentFlags(ledgerRow, logRow) {
  let fields;
  if (isV2(ledgerRow)) {
    fields = PROJECTED_CONTENT_KEYS.filter(key => !sameJson(ledgerRow[key], logRow ? logRow[key] : undefined));
  } else {
    const ledgerDetails = normalizeWhitespace(ledgerRow.details);
    const logDetails = normalizeWhitespace(logRow ? logRow.details : undefined);
    fields = ledgerDetails !== '' && !logDetails.includes(ledgerDetails) ? ['details'] : [];
  }
  return fields.length > 0 ? [{ anchor_id: ledgerRow.anchor_id, flag: 'ledger-only-content', fields }] : [];
}

/**
 * The data behind `show <anchor|obs_id>`: every ledger row carrying the entry's
 * observation id (in anchor order), its log row, its stored history versions,
 * and a `ledger-only-content` flag for each ledger row holding content its log
 * row does not.
 *
 * @param {string} key - an anchor id or an observation id
 * @param {object[]} ledger
 * @param {object[]} log
 * @param {{ historyVersions?: (id: string) => object[] }} [opts]
 * @returns {{ ok: true, value: { key: string, ledger: object[], log: object|null, history_versions: object[], flags: object[] } }
 *   | { ok: false, error: { kind: 'invalid-key'|'not-found', message: string } }}
 */
function showEntry(key, ledger, log, { historyVersions: versionsOf } = {}) {
  const notFound = { ok: false, error: { kind: 'not-found', message: `show: no entry '${key}' in the ledger or the log` } };
  let id;
  let rows;
  if (typeof key === 'string' && ANCHOR_ID_RE.test(key)) {
    const anchored = ledger.find(row => row.anchor_id === key);
    if (!anchored) return notFound;
    id = isNonEmptyString(anchored.id) ? anchored.id : null;
    rows = id === null ? [anchored] : ledger.filter(row => row.id === id);
  } else if (typeof key === 'string' && OBS_ID_RE.test(key)) {
    id = key;
    rows = ledger.filter(row => row.id === key);
  } else {
    return {
      ok: false,
      error: { kind: 'invalid-key', message: `show: ${JSON.stringify(key)} is neither an anchor id nor an observation id` },
    };
  }
  const logRow = id === null ? null : log.find(row => row.id === id) || null;
  if (rows.length === 0 && logRow === null) return notFound;
  const shown = sortedByAnchor(rows);
  return {
    ok: true,
    value: {
      key,
      ledger: shown,
      log: logRow,
      history_versions: id !== null && versionsOf ? versionsOf(id) : [],
      flags: shown.flatMap(row => ledgerOnlyContentFlags(row, logRow)),
    },
  };
}

/** The full commit id `ref` resolves to under `root`, or null. */
function commitAt(root, ref) {
  let out;
  try {
    out = execFileSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
  } catch {
    return null;
  }
  const commit = out.trim();
  return COMMIT_ID_RE.test(commit) ? commit : null;
}

/**
 * The ref and commit claims about the code are checked at.
 *
 * D-VERIFY-REF: a claim about the code is checked at the default branch as last
 * fetched — origin/HEAD — and at HEAD only when the repository has no usable
 * origin/HEAD; never at the working tree or the index. Reason: the ledger serves
 * every checkout of the repository, so a claim that holds only on one branch or in
 * uncommitted edits would mislead every other one, and a ref read needs no network
 * and runs no repository hook.
 *
 * @param {string} root - project root
 * @returns {{ ref: 'origin/HEAD'|'HEAD', commit: string } | null} null outside a
 *   repository or before its first commit
 */
function resolveVerifyRef(root) {
  const fetched = commitAt(root, 'refs/remotes/origin/HEAD');
  if (fetched !== null) return { ref: 'origin/HEAD', commit: fetched };
  const head = commitAt(root, 'HEAD');
  return head === null ? null : { ref: 'HEAD', commit: head };
}

module.exports = {
  // Constants
  SCHEMA_VERSION,
  FIELD_LIMITS,
  ACTIVE_STATUSES,
  INACTIVE_STATUSES,
  ENTRY_STATUSES,
  CONTENT_KEYS,
  PLUMBING_OWNED_KEYS,
  LEDGER_OWNED_KEYS,
  DUE,
  HISTORY_DEPTH,
  LOCK_ACQUIRE_TIMEOUT_MS,
  LOCK_STALE_MS,
  ANCHOR_ID_RE,
  OBS_ID_RE,
  // Status helpers
  isActive,
  activeStatusFor,
  isV2,
  // JSONL I/O
  readJsonl,
  rejectedPathFor,
  quarantineRejected,
  readJsonlForWrite,
  writeExclusive,
  writeFileAtomic,
  writeJsonlAtomic,
  // Locking
  hasLearningDir,
  withDecisionsLock,
  // State and the ledger registry
  readLearningState,
  ledgerRegistry,
  // Validation
  validateObservationInput,
  gitScopeMatcher,
  // Projection and counters
  toLedgerRowV2,
  toV2Counters,
  // History and the pre-v2 backup
  appendHistory,
  historyVersions,
  ensurePreV2Backup,
  // Integrity, listing, due selection and show
  integrityFlags,
  buildListing,
  entrySize,
  selectDue,
  showEntry,
  resolveVerifyRef,
};
