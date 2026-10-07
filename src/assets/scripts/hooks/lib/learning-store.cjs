// src/assets/scripts/hooks/lib/learning-store.cjs
//
// The v2 learning store: the one place the learning plumbing reads, validates,
// projects and writes the decisions log, the ledger and their side files.
//
// DESIGN: plumbing only. No function here prints or calls process.exit. Work that
// can fail on its input or on the lock returns a Result — { ok: true, value } or
// { ok: false, error: { kind, message } } — and its caller prints it: json-helper.cjs
// for the ops, or the `devflow learning` CLI through src/core/learning-store.ts. A throw
// means a broken invariant or an I/O failure, never an expected outcome; a lock
// held by withDecisionsLock is released on every path, the throw included.
//
// Loading: node built-ins and three sibling libs only. This module never requires
// decisions-format.cjs or render-decisions.cjs at load time: both require it, for
// the status list and the one-line and inactive-note text they share with `list`.
//
// Files under <root>/.devflow/learning/:
//   decisions-log.jsonl          observation rows — the content authority
//   decisions-ledger.jsonl       anchored rows — projections of log rows
//   decisions-log.archive.jsonl  rotated-out observation rows (D-ROTATE-UNREFERENCED)
//   decisions-history.jsonl      prior content versions (D-CONTENT-HISTORY)
//   *.rejected.jsonl             quarantined malformed lines (D-QUARANTINE-MALFORMED)
//   *.pre-v2.jsonl               one-time copies of the v1 files (D-V1-BACKUP-ONCE)
//   .decisions.lock/             the one learning lock (D-ONE-LEARNING-LOCK)
//   .pending-turns.jsonl         the queue the capture hooks append to
//   .pending-turns.processing    the claimed batch, and .pending-turns.owner its
//                                owner's token (D-OWNED-CLAIM)
//
// TS COUNTERPARTS: src/core/observations.ts mirrors the status lists (D201), and
// src/core/learning-store.ts transcribes the functions the CLI calls from their
// JSDoc here (D-LEARNING-STORE-SEAM) — change both together.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  getLearningDir,
  getLearningPendingTurnsPath,
  getLearningPendingTurnsProcessingPath,
  getLearningClaimOwnerPath,
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

/**
 * An anchor id written as a whole word in free text: ADR-NNN or PF-NNN, three or
 * more digits. Title, rule and why may not name one the ledger holds, and the
 * cited-number scan collects the ones tracked files cite.
 */
const ANCHOR_WORD_RE = /\b(?:ADR|PF)-\d{3,}\b/g;

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

/**
 * `text` with each run of control characters collapsed to one space: listings and
 * the rendered files show every field on one line.
 *
 * @param {string} text
 * @returns {string}
 */
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
  if (!m) return [2, Infinity];
  return [m[1] === 'ADR' ? 0 : 1, parseInt(m[2], 10)];
}

/** Comparator for rows by anchor_id (see anchorOrder). */
function compareByAnchor(a, b) {
  const [rankA, numA] = anchorOrder(a.anchor_id);
  const [rankB, numB] = anchorOrder(b.anchor_id);
  if (rankA !== rankB) return rankA - rankB;
  if (numA !== numB) return numA < numB ? -1 : 1;
  return String(a.anchor_id).localeCompare(String(b.anchor_id));
}

/** Comparator for strings by UTF-16 code unit, the order `<` gives. */
function compareText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
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

/**
 * Run `git <args>` in `root` and return its stdout. The argv is a literal array,
 * never a shell string, and every call turns `core.fsmonitor` off (D-NO-FSMONITOR,
 * documented at listGitTrackedFiles): git runs the command a repository's config
 * names there whenever it reads the index. Each call is bounded by GIT_TIMEOUT_MS
 * and GIT_MAX_BUFFER, and stderr is discarded.
 *
 * @param {string} root - the directory to run in
 * @param {string[]} args - the git subcommand and its arguments
 * @returns {string}
 * @throws when git is missing or `root` is not a working tree, the call times out or
 *   overflows its buffer, or git exits non-zero (the error's `status` is its exit code)
 */
function git(root, args) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });
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

/**
 * The error Result of an op run where `<root>/.devflow/learning/` is absent
 * (D-NO-STRAY-TREE).
 *
 * @param {string} opName - operation name, for the message
 * @param {string} root - project root
 * @returns {{ ok: false, error: { kind: 'no-learning-dir', message: string } }}
 */
function noLearningDir(opName, root) {
  return {
    ok: false,
    error: { kind: 'no-learning-dir', message: `${opName}: no .devflow/learning/ under ${root} — run from the project root` },
  };
}

/** True when `file` is itself a symbolic link; false for anything else, or nothing, there. */
function isSymbolicLink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return false;
    throw err;
  }
}

/**
 * The first of `<root>/.devflow` and `<root>/.devflow/learning` that is itself a
 * symbolic link, or null when neither is (D-NO-LINKED-TREE).
 *
 * @param {string} root - project root
 * @returns {string|null}
 */
function linkedLearningFolder(root) {
  const learningDir = getLearningDir(root);
  for (const dir of [path.dirname(learningDir), learningDir]) {
    if (isSymbolicLink(dir)) return dir;
  }
  return null;
}

/**
 * The error Result of an op run where `.devflow` or `.devflow/learning` under its
 * root is a symbolic link (D-NO-LINKED-TREE).
 *
 * @param {string} opName - operation name, for the message
 * @param {string} dir - the folder that is a link
 * @returns {{ ok: false, error: { kind: 'not-a-directory', message: string } }}
 */
function linkedFolder(opName, dir) {
  return {
    ok: false,
    error: { kind: 'not-a-directory', message: `${opName}: ${dir} is a symbolic link, not a directory; nothing was changed` },
  };
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
 * D-NO-LINKED-TREE: a learning writer refuses with `not-a-directory`, changing
 * nothing, when `.devflow` or `.devflow/learning` under its root is a symbolic
 * link. Reason: a repository can commit either one as a link to a folder elsewhere
 * on the machine, and a writer that followed it would take its lock there and
 * rewrite, quarantine, archive, render or delete files in whatever folder the link
 * names. Refused here, before the lock is taken, so every writer refuses in one
 * place; the claim heartbeat makes the same check, and read-only paths still read.
 *
 * @param {string} opName - operation name, for messages
 * @param {string} root - project root
 * @param {() => { ok: boolean }} fn - the locked body; it must return a Result
 * @param {{ timeoutMs?: number, staleMs?: number }} [opts]
 * @returns {{ ok: true, value?: unknown } | { ok: false, error: { kind: string, message: string } }}
 *   fn's Result, or an error of kind `not-a-directory`, `no-learning-dir` or `busy`.
 */
function withDecisionsLock(opName, root, fn, { timeoutMs = LOCK_ACQUIRE_TIMEOUT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const linked = linkedLearningFolder(root);
  if (linked !== null) return linkedFolder(opName, linked);
  if (!hasLearningDir(root)) return noLearningDir(opName, root);
  const lockDir = getDecisionsLockDir(root);
  let acquired;
  try {
    acquired = acquireMkdirLock(lockDir, timeoutMs, staleMs);
  } catch (err) {
    // The learning directory went away between the check and the mkdir.
    if (err && err.code === 'ENOENT') return noLearningDir(opName, root);
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

/**
 * A predicate for the log rows some ledger row carries, whatever that row's status
 * (D-LEDGER-REGISTRY). A log row with no id is carried by none.
 *
 * @param {object[]} ledgerRows
 * @returns {(logRow: object) => boolean}
 */
function carriedBy(ledgerRows) {
  const { byObsId } = ledgerRegistry(ledgerRows);
  return logRow => isNonEmptyString(logRow.id) && byObsId.has(logRow.id);
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

/**
 * The problem that keeps a value from being one line of text, or null: not a
 * string, blank, or holding a control character. Such a value is judged no further.
 */
function lineTextProblem(value) {
  if (typeof value !== 'string') return 'must be a string';
  if (value.trim() === '') return 'must not be blank';
  if (CONTROL_CHAR_RE.test(value)) return 'must be one line with no control characters';
  return null;
}

/** The problem with a text value's length in characters, or null. */
function lengthProblem(value, limit) {
  const length = codePointLength(value);
  return length > limit ? `is ${length} characters, over the limit of ${limit}` : null;
}

/** The first problem with a text value, or null: lineTextProblem's, then its length. */
function textProblem(value, limit) {
  return lineTextProblem(value) || lengthProblem(value, limit);
}

/**
 * Every problem with title, rule or why prose that rots, one per kind found: an
 * anchor the ledger holds, an issue reference, a file-and-line reference.
 *
 * @param {string} value
 * @param {Set<string>} ledgerIds - every anchor in the ledger
 * @returns {string[]} in that order
 */
function proseProblems(value, ledgerIds) {
  const problems = [];
  const named = (value.match(ANCHOR_WORD_RE) || []).find(anchor => ledgerIds.has(anchor));
  if (named) problems.push(`names ledger entry ${named}; state the rule in words`);
  if (ISSUE_REF_RE.test(value)) problems.push('carries an issue reference; state what it established instead');
  if (FILE_LINE_REF_RE.test(value)) problems.push('carries a file-and-line reference; name the function or quote the line instead');
  return problems;
}

/**
 * Every problem with a title, rule or why: a value that is not one line of text
 * reports that alone; otherwise its length and each of its proseProblems.
 *
 * @param {unknown} value
 * @param {number} limit
 * @param {Set<string>} ledgerIds
 * @returns {string[]}
 */
function proseFieldProblems(value, limit, ledgerIds) {
  const notText = lineTextProblem(value);
  if (notText) return [notText];
  const tooLong = lengthProblem(value, limit);
  return [...(tooLong ? [tooLong] : []), ...proseProblems(value, ledgerIds)];
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
 * one tracked file. A title, rule or why that is one line of text reports its
 * length and every kind of reference it holds together, so one retry can fix them
 * all; any other field, and text that is not one line, reports its first problem.
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
 *   for a reinforce. Errors come key refusals first, then by field in that order;
 *   a title, rule or why gives its length first, then a named anchor, an issue
 *   reference and a file-and-line reference.
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
      const problems = present(field)
        ? proseFieldProblems(input[field], FIELD_LIMITS[field], ledgerIdSet)
        : [missing(field)];
      for (const problem of problems) fieldError(field, problem);
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
      out = git(root, ['ls-files', '-z', '--', ':(glob)' + glob]);
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

/**
 * `row` with the ledger-owned fields in `updates` set; a field set to undefined is
 * removed. The other keys keep their order, and the ledger-owned keys follow them
 * in LEDGER_OWNED_KEYS order, the order toLedgerRowV2 writes, so a row two
 * writers have changed serializes the same as the projection would and a
 * whole-row comparison still means "nothing changed".
 *
 * @param {object} row - a ledger row
 * @param {Record<string, unknown>} updates - ledger-owned fields only
 * @returns {object} a new row
 * @throws {TypeError} when `updates` names a key the ledger does not own
 */
function withLedgerFields(row, updates) {
  for (const key of Object.keys(updates)) {
    if (!LEDGER_OWNED_KEYS.includes(key)) throw new TypeError(`withLedgerFields: '${key}' is not a ledger-owned field`);
  }
  const next = {};
  for (const [key, value] of Object.entries(row)) {
    if (!LEDGER_OWNED_KEYS.includes(key)) next[key] = copyJson(value);
  }
  for (const key of LEDGER_OWNED_KEYS) {
    const value = Object.prototype.hasOwnProperty.call(updates, key) ? updates[key] : row[key];
    if (value !== undefined) next[key] = copyJson(value);
  }
  return next;
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
// Rotation
// ---------------------------------------------------------------------------

/** Days of inactivity after which an observation no ledger row carries leaves the log (D-ROTATE-UNREFERENCED). */
const ROTATE_AGE_DAYS = 30;

/** What an older install's usage telemetry left in the learning directory: a file and a lock directory. */
const USAGE_LEFTOVERS = Object.freeze(['.decisions-usage.json', '.decisions-usage.lock']);

/**
 * Epoch ms of a row's last activity — its `last_seen`, else `first_seen`, else
 * `created` — or null when that value is absent or does not parse.
 *
 * @param {object} row
 * @returns {number|null}
 */
function lastActivityMs(row) {
  const value = row.last_seen || row.first_seen || row.created;
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * Move the observations no ledger row carries out of the log once they have been
 * inactive for ROTATE_AGE_DAYS, and delete what the retired usage telemetry left.
 *
 * D-ROTATE-UNREFERENCED: rotation archives every log row that no ledger row
 * carries once its last activity — last_seen, else first_seen, else created — is
 * at least ROTATE_AGE_DAYS old, whatever its status; a row any ledger row carries
 * stays, however old and whatever that ledger row's status. An archived row is
 * appended to the archive unless a byte-identical copy (in its JSON form) is
 * already there, and the log is rewritten without it. Reason: only the ledger
 * records what is promoted (D-LEDGER-REGISTRY), so neither a log status nor an
 * anchor_id copied onto a log row can say what to keep, and a dedup by id dropped
 * the newer version of a row whose older version was already archived.
 *
 * Under the learning lock it first deletes the usage leftovers. When no row is
 * due it writes nothing else. When rows are due it backs up a v1 tree
 * (D-V1-BACKUP-ONCE) and quarantines the log's malformed lines
 * (D-QUARANTINE-MALFORMED) before it appends to the archive and rewrites the log;
 * an interrupted run is retried safely, because the identical copy it appended is
 * skipped.
 *
 * @param {string} root - project root
 * @param {{ now?: number, timeoutMs?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {{ ok: true, value: { rotated: number, appended: number } } | { ok: false, error: { kind: string, message: string } }}
 *   rotated: rows removed from the log; appended: rows added to the archive.
 *   Errors are withDecisionsLock's not-a-directory, no-learning-dir and busy.
 */
function rotateObservations(root, { now = Date.now(), timeoutMs } = {}) {
  return withDecisionsLock('rotate-observations', root, () => {
    for (const name of USAGE_LEFTOVERS) {
      fs.rmSync(path.join(getLearningDir(root), name), { recursive: true, force: true });
    }

    const logPath = getDecisionsLogPath(root);
    const log = readJsonl(logPath);
    const ledgerRows = readJsonl(getDecisionsLedgerPath(root)).rows;
    const isCarried = carriedBy(ledgerRows);
    const cutoff = now - ROTATE_AGE_DAYS * DAY_MS;
    const isDue = row => {
      if (isCarried(row)) return false;
      const at = lastActivityMs(row);
      return at !== null && at <= cutoff;
    };
    const due = log.rows.filter(isDue);
    if (due.length === 0) return { ok: true, value: { rotated: 0, appended: 0 } };

    ensurePreV2Backup(root, { logRows: log.rows, ledgerRows });
    quarantineRejected(logPath, log.rejected, { now });

    const archivePath = getDecisionsArchivePath(root);
    const archived = new Set(readJsonl(archivePath).rows.map(row => JSON.stringify(row)));
    const appended = [];
    for (const row of due) {
      const line = JSON.stringify(row);
      if (archived.has(line)) continue;
      archived.add(line);
      appended.push(line);
    }
    if (appended.length > 0) appendNoFollow(archivePath, appended.join('\n') + '\n');
    writeJsonlAtomic(logPath, log.rows.filter(row => !isDue(row)));
    return { ok: true, value: { rotated: due.length, appended: appended.length } };
  }, { timeoutMs });
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

/**
 * Drop the observations no entry uses — `devflow learning --clear`.
 *
 * D-CLEAR-UNREFERENCED: clearing removes from the log exactly the rows no ledger
 * row carries (D-LEDGER-REGISTRY), whatever their age or status, and keeps every
 * row an entry carries, active or not; it refuses while the ledger holds a
 * malformed line, and it never writes the ledger, the archive or the rendered
 * files. Reason: truncating the whole log orphaned every entry — each lost the log
 * row that is its content authority, and refresh then refused them all — and a
 * malformed ledger line may be the one carrying a row clearing would drop.
 *
 * It runs under the learning lock (D-ONE-LEARNING-LOCK). When a row is dropped it
 * backs up a v1 tree (D-V1-BACKUP-ONCE) and quarantines the log's malformed lines
 * (D-QUARANTINE-MALFORMED) before it rewrites the log; with nothing to drop it
 * writes nothing.
 *
 * @param {string} root - project root
 * @param {{ now?: number, timeoutMs?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {{ ok: true, value: { cleared: number, kept: number } } | { ok: false, error: { kind: string, message: string } }}
 *   cleared: rows removed from the log; kept: rows left in it. Error kinds:
 *   ledger-malformed, and withDecisionsLock's not-a-directory, no-learning-dir and busy.
 */
function clearUnreferenced(root, { now = Date.now(), timeoutMs } = {}) {
  return withDecisionsLock('clear', root, () => {
    const ledger = readJsonl(getDecisionsLedgerPath(root));
    if (ledger.rejected.length > 0) {
      const lines = ledger.rejected.length === 1 ? '1 malformed line' : `${ledger.rejected.length} malformed lines`;
      return {
        ok: false,
        error: {
          kind: 'ledger-malformed',
          message: `clear: the ledger has ${lines}, which may carry an observation this would drop; nothing was cleared`,
        },
      };
    }
    const logPath = getDecisionsLogPath(root);
    const log = readJsonl(logPath);
    const kept = log.rows.filter(carriedBy(ledger.rows));
    const cleared = log.rows.length - kept.length;
    if (cleared === 0) return { ok: true, value: { cleared: 0, kept: kept.length } };

    ensurePreV2Backup(root, { logRows: log.rows, ledgerRows: ledger.rows });
    quarantineRejected(logPath, log.rejected, { now });
    writeJsonlAtomic(logPath, kept);
    return { ok: true, value: { cleared, kept: kept.length } };
  }, { timeoutMs });
}

// ---------------------------------------------------------------------------
// Resetting
// ---------------------------------------------------------------------------

/** rmdir(2) errors meaning the path is not an empty directory: gone, holding something, or not a directory. */
const NOT_AN_EMPTY_DIR = Object.freeze(['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR']);

/** Remove `dir` when it is an empty directory; anything else at that path stays as it is. */
function removeEmptyDir(dir) {
  try {
    fs.rmdirSync(dir);
  } catch (err) {
    if (!err || !NOT_AN_EMPTY_DIR.includes(err.code)) throw err;
  }
}

/**
 * Remove every learning file — `devflow learning --reset`: the log, the ledger
 * and their side files, the rendered files, the tuning config, and the queue
 * with its claim and owner file — and then the learning directory itself.
 *
 * D-RESET-UNDER-LOCK: reset empties the learning directory under the learning
 * lock, sparing only the lock directory, and removes the emptied directory once
 * the lock is released, and only if nothing has arrived in it. Reason: the lock
 * is released by its path, so removing it with the directory would let this
 * run's release delete the lock of a writer that recreated the tree in between;
 * and what arrives once the lock is free — a captured turn, or the next writer's
 * lock — belongs to the next run.
 *
 * Like every learning writer it refuses without `.devflow/learning/` and creates
 * nothing (D-NO-STRAY-TREE), refuses a learning directory or a `.devflow` that is a
 * symbolic link and removes nothing (D-NO-LINKED-TREE), since emptying it would
 * empty whatever directory the link leads to, and waits at most `timeoutMs` for the
 * lock, breaking one a crashed run left behind (D-ONE-LEARNING-LOCK). A symbolic
 * link in the directory is removed, never what it points to.
 *
 * @param {string} root - project root
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {{ ok: true, value: { removed: number } } | { ok: false, error: { kind: string, message: string } }}
 *   removed: the entries removed from the learning directory. Errors are
 *   withDecisionsLock's not-a-directory, no-learning-dir and busy.
 */
function resetLearning(root, { timeoutMs } = {}) {
  const learningDir = getLearningDir(root);
  const lockName = path.basename(getDecisionsLockDir(root));
  const reset = withDecisionsLock('reset', root, () => {
    const entries = fs.readdirSync(learningDir).filter(name => name !== lockName);
    for (const name of entries) fs.rmSync(path.join(learningDir, name), { recursive: true, force: true });
    return { ok: true, value: { removed: entries.length } };
  }, { timeoutMs });
  if (reset.ok) removeEmptyDir(learningDir);
  return reset;
}

// ---------------------------------------------------------------------------
// The queue claim
// ---------------------------------------------------------------------------

/**
 * Seconds without a heartbeat after which a claim is stale and the next claim
 * takes it over (D-OWNED-CLAIM). session-start-context's PROCESSING_STALE_SECS
 * holds the same value; a lockstep test pins the two together.
 */
const CLAIM_STALE_SECS = 900;

/** How long a claim waits for the queue's own lock (ms): the wait of queue-append's overflow truncation. */
const QUEUE_LOCK_TIMEOUT_MS = 2000;

/** Age after which the queue's own lock counts as abandoned (ms): learning-lock's threshold. */
const QUEUE_LOCK_STALE_MS = 30000;

/** A claim token: 16 lowercase hex characters. */
const CLAIM_TOKEN_RE = /^[0-9a-f]{16}$/;

/** link(2) errors of a filesystem without hard links; the claim renames instead. */
const NO_HARD_LINK_CODES = Object.freeze(['EPERM', 'ENOTSUP']);

/**
 * A fresh claim token: 8 random bytes as 16 hex characters.
 *
 * @returns {string}
 */
function newClaimToken() {
  return crypto.randomBytes(8).toString('hex');
}

/** Throw a TypeError unless `token` is a claim token: a malformed one is a caller error. */
function assertClaimToken(opName, token) {
  if (typeof token !== 'string' || !CLAIM_TOKEN_RE.test(token)) {
    throw new TypeError(`${opName}: a claim token is 16 lowercase hex characters`);
  }
}

/**
 * The Stats of `file` when it is a regular file, null when nothing is there, and
 * false for anything else — a directory or a symlink — which the claim ops
 * refuse rather than follow or replace.
 *
 * @param {string} file
 * @returns {fs.Stats|null|false}
 */
function regularFileStat(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
  return stat.isFile() ? stat : false;
}

/** The error Result for a claim path holding something other than a regular file. */
function notRegularFile(opName, file) {
  return { ok: false, error: { kind: 'not-a-file', message: `${opName}: ${file} is not a regular file; remove it by hand` } };
}

/** Delete `file`; one that is already gone is fine. */
function removeIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}

/** The token the owner file records, or null when it is absent or holds no token. */
function readClaimOwner(root) {
  let text;
  try {
    text = fs.readFileSync(getLearningClaimOwnerPath(root), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  const token = text.trim();
  return CLAIM_TOKEN_RE.test(token) ? token : null;
}

/**
 * Move the queue to the claim path under the queue's own lock, the lock
 * queue-append's overflow truncation takes, so a truncation can never rewrite the
 * queue from rows already claimed. link(2) refuses an existing claim; on a
 * filesystem without hard links a rename stands in, which is safe because the
 * caller found the claim path empty under the learning lock. A row a capture hook
 * appends meanwhile lands in the claimed batch or in the queue formed after it,
 * never in neither.
 *
 * @param {string} queuePath
 * @param {string} claimPath
 * @returns {'moved'|'busy'|'none'} busy when the queue lock is held or a claim
 *   appeared; none when the queue vanished first
 */
function moveQueueToClaim(queuePath, claimPath) {
  const queueLock = `${queuePath}.lock`;
  if (!acquireMkdirLock(queueLock, QUEUE_LOCK_TIMEOUT_MS, QUEUE_LOCK_STALE_MS)) return 'busy';
  try {
    try {
      fs.linkSync(queuePath, claimPath);
    } catch (err) {
      if (err && err.code === 'EEXIST') return 'busy';
      if (err && err.code === 'ENOENT') return 'none';
      if (!err || !NO_HARD_LINK_CODES.includes(err.code)) throw err;
      try {
        fs.renameSync(queuePath, claimPath);
      } catch (renameErr) {
        if (renameErr && renameErr.code === 'ENOENT') return 'none';
        throw renameErr;
      }
      return 'moved';
    }
    try {
      removeIfPresent(queuePath);
    } catch (err) {
      // Undo the link, so the rows stay queued once rather than claimed and queued.
      // The unlink error is the one to report; a failed undo leaves the claim to
      // go stale and be taken over.
      try { fs.unlinkSync(claimPath); } catch { /* reported through err */ }
      throw err;
    }
    return 'moved';
  } finally {
    releaseLock(queueLock);
  }
}

/**
 * Claim the learning queue for one Learning run.
 *
 * D-OWNED-CLAIM: the learning queue is claimed and released only through the
 * claim-queue and release-claim ops, under the learning lock. A claim moves the
 * queue to .pending-turns.processing by link(2), under the queue's own lock (a
 * rename stands in only where the filesystem has no hard links), sets the claim's
 * mtime to now and records a fresh random token in .pending-turns.owner. A claim
 * younger than CLAIM_STALE_SECS is busy to every other claimant; an older one is
 * taken over with a new token, and the waiting queue is left for the next claim.
 * Release deletes the claim only for the token that owns it, and every json-helper
 * learning op refreshes an existing claim's mtime before it runs, without ever
 * creating one. Reason: a check-then-mv claim let two runs claim at once and
 * clobber a batch, mv kept the queue's old mtime so a fresh claim could look stale
 * at once, and an unconditional final unlink deleted another run's claim.
 *
 * Without .devflow/learning/ it answers none and creates nothing.
 *
 * @param {string} root - project root
 * @param {{ now?: number, token?: string, timeoutMs?: number }} [opts]
 *   now: epoch ms (default Date.now()); token: the token to record (default a fresh one)
 * @returns {{ ok: true, value: { state: 'claimed', token: string, takeover: boolean } | { state: 'busy' } | { state: 'none' } }
 *   | { ok: false, error: { kind: string, message: string } }}
 * @throws {TypeError} when `token` is not a claim token
 */
function claimQueue(root, { now = Date.now(), token = newClaimToken(), timeoutMs } = {}) {
  assertClaimToken('claimQueue', token);
  if (!hasLearningDir(root)) return { ok: true, value: { state: 'none' } };
  return withDecisionsLock('claim-queue', root, () => {
    const claimPath = getLearningPendingTurnsProcessingPath(root);
    const queuePath = getLearningPendingTurnsPath(root);
    const at = new Date(now);

    const claim = regularFileStat(claimPath);
    if (claim === false) return notRegularFile('claim-queue', claimPath);
    if (claim !== null) {
      if (now - claim.mtimeMs < CLAIM_STALE_SECS * 1000) return { ok: true, value: { state: 'busy' } };
      writeFileAtomic(getLearningClaimOwnerPath(root), `${token}\n`);
      fs.utimesSync(claimPath, at, at);
      return { ok: true, value: { state: 'claimed', token, takeover: true } };
    }

    const queue = regularFileStat(queuePath);
    if (queue === false) return notRegularFile('claim-queue', queuePath);
    if (queue === null || queue.size === 0) return { ok: true, value: { state: 'none' } };

    const moved = moveQueueToClaim(queuePath, claimPath);
    if (moved !== 'moved') return { ok: true, value: { state: moved } };
    fs.utimesSync(claimPath, at, at);
    writeFileAtomic(getLearningClaimOwnerPath(root), `${token}\n`);
    return { ok: true, value: { state: 'claimed', token, takeover: false } };
  }, { timeoutMs });
}

/**
 * Release the claim `token` owns (D-OWNED-CLAIM): delete the claim and the owner
 * file when the token owns it (released); refuse when another token does
 * (not-owner); report a claim that is already gone (gone), deleting the owner
 * file only when it names this token.
 *
 * @param {string} root - project root
 * @param {string} token
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {{ ok: true, value: { state: 'released'|'not-owner'|'gone' } } | { ok: false, error: { kind: string, message: string } }}
 *   errors include withDecisionsLock's not-a-directory, no-learning-dir and busy
 * @throws {TypeError} when `token` is not a claim token
 */
function releaseClaim(root, token, { timeoutMs } = {}) {
  assertClaimToken('releaseClaim', token);
  return withDecisionsLock('release-claim', root, () => {
    const claimPath = getLearningPendingTurnsProcessingPath(root);
    const ownerPath = getLearningClaimOwnerPath(root);
    const owned = readClaimOwner(root) === token;

    const claim = regularFileStat(claimPath);
    if (claim === false) return notRegularFile('release-claim', claimPath);
    if (claim === null) {
      if (owned) removeIfPresent(ownerPath);
      return { ok: true, value: { state: 'gone' } };
    }
    if (!owned) return { ok: true, value: { state: 'not-owner' } };
    removeIfPresent(claimPath);
    removeIfPresent(ownerPath);
    return { ok: true, value: { state: 'released' } };
  }, { timeoutMs });
}

/**
 * The claim heartbeat (D-OWNED-CLAIM): set an existing claim's mtime to now. It
 * never creates a claim and never follows a symlink at the claim path, and it
 * takes no lock — json-helper sends it before each learning op runs. A claim in a
 * learning tree reached through a symbolic link is left alone (D-NO-LINKED-TREE):
 * `lutimes` follows a linked folder above the claim, and the op that follows
 * refuses that tree anyway.
 *
 * @param {string} root - project root
 * @param {{ now?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {{ ok: true, value: { touched: boolean } } | { ok: false, error: { kind: 'heartbeat-failed', message: string } }}
 */
function touchClaim(root, { now = Date.now() } = {}) {
  if (linkedLearningFolder(root) !== null) return { ok: true, value: { touched: false } };
  const claimPath = getLearningPendingTurnsProcessingPath(root);
  const at = new Date(now);
  try {
    fs.lutimesSync(claimPath, at, at);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { ok: true, value: { touched: false } };
    return {
      ok: false,
      error: { kind: 'heartbeat-failed', message: `heartbeat: could not refresh ${claimPath}: ${err && err.message}` },
    };
  }
  return { ok: true, value: { touched: true } };
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

/**
 * Why an inactive entry is inactive, in a few words, or '' when it records nothing:
 * `encoded in <path>`, else `superseded by <anchor>`, else the status note. `list`
 * and the rendered Inactive table both show it.
 *
 * @param {object} row - a ledger row
 * @returns {string}
 */
function inactiveNote(row) {
  if (isPlainObject(row.encoded_at) && isNonEmptyString(row.encoded_at.path)) return `encoded in ${row.encoded_at.path}`;
  if (isNonEmptyString(row.superseded_by)) return `superseded by ${row.superseded_by}`;
  if (isNonEmptyString(row.status_note)) return row.status_note;
  return '';
}

/** The first log row carrying each observation id; a row with no id is left out. */
function firstLogRowById(log) {
  const byId = new Map();
  for (const row of log) {
    if (isNonEmptyString(row.id) && !byId.has(row.id)) byId.set(row.id, row);
  }
  return byId;
}

/** A log row's observation count (a v1 row's count) and last sighting; each is null when the row records none or there is no row. */
function sightingsOf(logRow) {
  return {
    observations: (logRow && (positiveInteger(logRow.observations) || positiveInteger(logRow.count))) || null,
    last_seen: logRow && isNonEmptyString(logRow.last_seen) ? logRow.last_seen : null,
  };
}

/** One ledger row as a listing line, with the sightings of `logRow`, the log row carrying its id. */
function listingRow(row, logRow) {
  const entry = {
    anchor_id: row.anchor_id,
    id: row.id,
    type: row.type,
    status: isNonEmptyString(row.decisions_status) ? row.decisions_status : null,
    title: listingTitle(row),
    schema: isV2(row) ? 2 : 1,
  };
  if (isNonEmptyString(row.last_verified)) entry.last_verified = row.last_verified;
  return { ...entry, ...sightingsOf(logRow), scope: Array.isArray(row.scope) ? copyJson(row.scope) : null };
}

/** One unpromoted log row as a listing line. */
function observationListingRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: listingTitle(row),
    schema: isV2(row) ? 2 : 1,
    ...sightingsOf(row),
  };
}

/**
 * The data behind `list`: active and inactive entries in anchor order, the
 * observations no ledger row carries (by id), the integrity flags and the
 * malformed-line counts. A v1 title is its pattern cut to the title limit. Each
 * entry carries its ledger row's last_verified (when set) and scope (null when it
 * has none, as a v1 row does), and the observation count and last sighting of the
 * log row carrying its id — the first such row — or null for each without one.
 *
 * @param {object[]} ledger
 * @param {object[]} log
 * @param {{ scopeMatches?: (glob: string) => boolean, rejected?: { ledger?: unknown[], log?: unknown[] } }} [opts]
 * @returns {{ active: object[], inactive: object[], observations: object[], integrity: object[], malformed: { ledger: number, log: number } }}
 */
function buildListing(ledger, log, { scopeMatches, rejected = {} } = {}) {
  const anchored = ledger.filter(row => isNonEmptyString(row.anchor_id));
  const isCarried = carriedBy(ledger);
  const logById = firstLogRowById(log);
  const entryRow = row => listingRow(row, logById.get(row.id));
  return {
    active: sortedByAnchor(anchored.filter(row => isActive(row))).map(entryRow),
    inactive: sortedByAnchor(anchored.filter(row => !isActive(row)))
      .map(row => ({ ...entryRow(row), note: singleLine(inactiveNote(row)) })),
    observations: log
      .filter(row => isNonEmptyString(row.id) && !isCarried(row))
      .sort((a, b) => compareText(a.id, b.id))
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

  const logById = firstLogRowById(log);
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
    out = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render decisions.md, pitfalls.md and index.md from `ledgerRows` and write each
 * atomically, the index last. The caller holds .decisions.lock
 * (D-ONE-LEARNING-LOCK), so the learning directory exists. render-decisions.cjs
 * requires this module at load time, so it is required here, on first use. Prints
 * nothing.
 *
 * @param {string} root - project root
 * @param {object[]} ledgerRows - every ledger row
 */
function renderAll(root, ledgerRows) {
  const { renderLearningFiles } = require('./render-decisions.cjs');
  for (const file of renderLearningFiles(root, ledgerRows)) writeFileAtomic(file.path, file.content);
}

// ---------------------------------------------------------------------------
// put-observation
// ---------------------------------------------------------------------------

/** The counter keys of a v1 row that the v2 counters replace: count becomes observations, created first_seen. */
const LEGACY_COUNTER_KEYS = Object.freeze(['count', 'created']);

/** A validation field that prints as it is; any other prints as JSON, on one line. */
const PLAIN_FIELD_RE = /^[\w.()[\]-]{1,64}$/;

/**
 * The anchored ledger rows carrying observation `id`, in anchor order: the
 * entries the observation backs (D-LEDGER-REGISTRY).
 *
 * @param {{ byObsId: Map<string, object[]> }} registry
 * @param {string|null} id
 * @returns {object[]}
 */
function anchoredCarriers(registry, id) {
  const carriers = id === null ? [] : registry.byObsId.get(id) || [];
  return sortedByAnchor(carriers.filter(row => isNonEmptyString(row.anchor_id)));
}

/** True when two rows differ in any CONTENT_KEYS value. */
function contentDiffers(a, b) {
  return CONTENT_KEYS.some(key => !sameJson(a[key], b[key]));
}

/** The log row a create stores: the content after the schema, then one observation, first and last seen now. */
function createdRow(content, now) {
  const at = new Date(now).toISOString();
  return { schema: SCHEMA_VERSION, ...content, observations: 1, first_seen: at, last_seen: at };
}

/** The log row an update stores: the new content, then `existing`'s counters (a v1 row's converted). */
function updatedRow(content, existing, now) {
  return { schema: SCHEMA_VERSION, ...content, ...toV2Counters(existing, { now }) };
}

/**
 * `existing` with one more observation, last seen now. Every other key stays,
 * so a v1 row stays v1; its legacy counters give way to the v2 ones.
 */
function reinforcedRow(existing, now) {
  const counters = toV2Counters(existing, { now });
  const kept = Object.fromEntries(Object.entries(existing).filter(([key]) => !LEGACY_COUNTER_KEYS.includes(key)));
  return {
    ...kept,
    observations: counters.observations + 1,
    first_seen: counters.first_seen,
    last_seen: new Date(now).toISOString(),
  };
}

/**
 * The log row a put stores and the outcome it reports, or null for an update
 * whose content a v2 row already holds. A v1 row is never unchanged: an update
 * converts it.
 */
function plannedLogRow(mode, content, existing, now) {
  if (mode === 'reinforce') return { outcome: 'reinforced', logRow: reinforcedRow(existing, now) };
  if (mode === 'create') return { outcome: 'created', logRow: createdRow(content, now) };
  if (isV2(existing) && !contentDiffers(existing, content)) return null;
  return { outcome: 'updated', logRow: updatedRow(content, existing, now) };
}

/** Why active entry `row` cannot take a log row of `type`, or null when it can. */
function reprojectionProblem(row, type) {
  if (row.type !== type) return `it is a ${row.type} entry and the observation is a ${type}`;
  if (!ANCHOR_ID_RE.test(row.anchor_id) || !row.anchor_id.startsWith(`${anchorPrefixFor(type)}-`)) {
    return `its anchor does not name a ${type} entry`;
  }
  return null;
}

/**
 * Active entry `prior` re-projected from `logRow` (D-PUT-REPROJECTS). A status
 * outside ENTRY_STATUSES — absent or unknown, which still counts as active —
 * becomes the type's active status; every other ledger-owned key carries over.
 */
function reprojectedRow(logRow, prior) {
  const status = ENTRY_STATUSES.includes(prior.decisions_status) ? undefined : activeStatusFor(logRow.type);
  return toLedgerRowV2(logRow, prior, { status, expectType: prior.type });
}

/** A put's refusal: `message` follows the op name, and `extra` joins the error. */
function putRefusal(kind, message, extra = {}) {
  return { ok: false, error: { kind, message: `put-observation: ${message}`, ...extra } };
}

/** How a validation field prints: a plain name as it is, anything else as JSON on one line. */
function fieldLabel(field) {
  return PLAIN_FIELD_RE.test(field) ? field : cutTo(singleLine(JSON.stringify(field)), 80);
}

/** The refusal of an op's stdin input: every problem, one per line, after the op name. */
function invalidInput(opName, problems) {
  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`;
  const lines = problems.map(problem => `  ${fieldLabel(problem.field)}: ${singleLine(problem.message)}`);
  const message = [`${opName}: the input has ${count}; nothing was written`, ...lines].join('\n');
  return { ok: false, error: { kind: 'invalid-input', message, problems } };
}

/** The refusal of a put on an observation whose entries are all inactive. */
function restoreFirst(id, carriers) {
  const entries = carriers.map(row => `${row.anchor_id} ${row.decisions_status}`).join(', ');
  return putRefusal('restore-first', `'${id}' belongs only to inactive entries (${singleLine(entries)}); restore first`);
}

/**
 * Store one observation from the put-observation op: create it, replace its
 * content, or count one more sighting of it.
 *
 * D-PUT-REPROJECTS: when a put stores new content for an observation, every
 * active ledger row carrying the observation's id is re-projected from the new
 * log row through toLedgerRowV2, and decisions.md, pitfalls.md and index.md are
 * re-rendered, all under the .decisions.lock the log was written under; a ledger
 * row carrying the id with an inactive status is written back unchanged.
 * Reason: an entry's ledger row and rendered text must follow its log row at
 * once — a separate refresh step can be skipped or interleaved with another
 * writer, and leaves every reader on the old wording until it runs — while a
 * retired entry keeps the wording it was retired with.
 *
 * Modes, each taking content under D-PUT-NOT-MERGE:
 *   create     an id the log does not hold, stored with one observation, first
 *              and last seen now. An active entry already carrying the id is
 *              re-projected: the repair for an entry that lost its log row.
 *   update     the whole new content of an id the log holds, never merged with
 *              the old, of the same type. A v1 row becomes a v2 row, its
 *              counters converted by toV2Counters; what only v1 held (pattern,
 *              details, amendments, evidence over the limits) stays in the
 *              history and the pre-v2 backup. Content equal to a v2 row's is
 *              `unchanged` and writes nothing.
 *   reinforce  `{ id }` alone: one more observation, last seen now — no
 *              history, no re-projection and no render. A v1 row stays v1, its
 *              counters converted.
 *
 * Every mode refuses, writing nothing: an input validation rejects (every
 * problem at once), an id the log holds twice, an observation whose entries are
 * all inactive ("restore first"), and an active entry that cannot take the
 * observation's type. A put that writes backs up a v1 tree first
 * (D-V1-BACKUP-ONCE), quarantines the malformed lines of each file it rewrites
 * (D-QUARANTINE-MALFORMED) and records the content it replaces
 * (D-CONTENT-HISTORY). Entries are found through the ledger alone
 * (D-LEDGER-REGISTRY).
 *
 * @param {string} root - project root
 * @param {'create'|'update'|'reinforce'} mode
 * @param {unknown} input - the parsed stdin object
 * @param {{ now?: number, timeoutMs?: number, scopeMatches?: (glob: string) => boolean }} [opts]
 *   now: epoch ms (default Date.now()); scopeMatches: default gitScopeMatcher(root)
 * @returns {{ ok: true, value: { outcome: 'created'|'updated'|'unchanged'|'reinforced', id: string, observations: number, reprojected: string[] } }
 *   | { ok: false, error: { kind: string, message: string, problems?: Array<{ field: string, message: string }> } }}
 *   observations: the count the log row holds afterwards; reprojected: the
 *   anchors re-projected, in anchor order. Error kinds: invalid-input (with
 *   problems), duplicate-log-id, restore-first, cannot-reproject, and
 *   withDecisionsLock's not-a-directory, no-learning-dir and busy.
 * @throws {TypeError} when `mode` is not a put mode
 */
function putObservation(root, mode, input, { now = Date.now(), timeoutMs, scopeMatches } = {}) {
  if (!VALIDATION_MODES.includes(mode)) {
    throw new TypeError(`putObservation: mode must be one of ${VALIDATION_MODES.join(', ')}, got '${mode}'`);
  }
  const matches = scopeMatches || gitScopeMatcher(root);
  return withDecisionsLock('put-observation', root, () => putUnderLock(root, mode, input, { now, scopeMatches: matches }), { timeoutMs });
}

/** putObservation's locked body. */
function putUnderLock(root, mode, input, { now, scopeMatches }) {
  const logPath = getDecisionsLogPath(root);
  const ledgerPath = getDecisionsLedgerPath(root);
  const log = readJsonl(logPath);
  const ledger = readJsonl(ledgerPath);
  const registry = ledgerRegistry(ledger.rows);

  const id = isPlainObject(input) && typeof input.id === 'string' ? input.id : null;
  const sameId = id === null ? [] : log.rows.filter(row => row.id === id);
  const existing = sameId[0] || null;
  const checked = validateObservationInput(input, { mode, existing, ledgerIds: registry.byAnchor.keys(), scopeMatches });
  if (!checked.ok) return invalidInput('put-observation', checked.errors);
  if (sameId.length > 1) {
    return putRefusal('duplicate-log-id', `the log holds ${sameId.length} rows with id '${id}'; nothing was written`);
  }
  const carriers = anchoredCarriers(registry, id);
  const active = carriers.filter(row => isActive(row));
  if (carriers.length > 0 && active.length === 0) return restoreFirst(id, carriers);

  const planned = plannedLogRow(mode, checked.value, existing, now);
  if (planned === null) {
    const observations = toV2Counters(existing, { now }).observations;
    return { ok: true, value: { outcome: 'unchanged', id, observations, reprojected: [] } };
  }
  const { outcome, logRow } = planned;

  const reprojecting = mode === 'reinforce' ? [] : active;
  for (const row of reprojecting) {
    const problem = reprojectionProblem(row, logRow.type);
    if (problem) {
      return putRefusal('cannot-reproject', `${singleLine(String(row.anchor_id))} cannot take this observation: ${problem}; nothing was written`);
    }
  }
  const projected = new Map(reprojecting.map(row => [row, reprojectedRow(logRow, row)]));
  const replacesContent = mode === 'update' || [...projected].some(([prior, row]) => !sameJson(prior, row));

  ensurePreV2Backup(root, { logRows: log.rows, ledgerRows: ledger.rows });
  quarantineRejected(logPath, log.rejected, { now });
  if (replacesContent) appendHistory(root, { id, ledger: registry.byObsId.get(id) || [], log: existing }, { now });
  writeJsonlAtomic(logPath, existing === null ? [...log.rows, logRow] : log.rows.map(row => (row === existing ? logRow : row)));
  if (projected.size > 0) {
    quarantineRejected(ledgerPath, ledger.rejected, { now });
    const ledgerRows = ledger.rows.map(row => projected.get(row) || row);
    writeJsonlAtomic(ledgerPath, ledgerRows);
    renderAll(root, ledgerRows);
  }
  return {
    ok: true,
    value: { outcome, id, observations: logRow.observations, reprojected: reprojecting.map(row => row.anchor_id) },
  };
}

// ---------------------------------------------------------------------------
// list, show and claim-due
// ---------------------------------------------------------------------------

/**
 * The data behind `list`, read-only: buildListing over the ledger and the log as
 * they are, every glob scope checked against the files git tracks. Malformed
 * lines are counted, never quarantined (D-QUARANTINE-MALFORMED). Refuses without
 * .devflow/learning/ (D-NO-STRAY-TREE).
 *
 * @param {string} root - project root
 * @param {{ scopeMatches?: (glob: string) => boolean }} [opts] - default gitScopeMatcher(root)
 * @returns {{ ok: true, value: { active: object[], inactive: object[], observations: object[], integrity: object[], malformed: { ledger: number, log: number } } }
 *   | { ok: false, error: { kind: 'no-learning-dir', message: string } }}
 */
function readListing(root, { scopeMatches } = {}) {
  if (!hasLearningDir(root)) return noLearningDir('list', root);
  const { ledgerRows, logRows, rejected } = readLearningState(root);
  return {
    ok: true,
    value: buildListing(ledgerRows, logRows, { scopeMatches: scopeMatches || gitScopeMatcher(root), rejected }),
  };
}

/** A listing token as it prints: itself when it is one word, else `-`. */
function listingToken(value) {
  return isNonEmptyString(value) && !/\s/.test(value) && !CONTROL_CHAR_RE.test(value) ? value : '-';
}

/** A listing's scope token: its entries joined by `,`, each as listingToken prints it, or `-` for none. */
function scopeToken(scope) {
  return Array.isArray(scope) && scope.length > 0 ? scope.map(listingToken).join(',') : '-';
}

/**
 * The text `list` prints. Each section opens with its name and count, and each
 * item is a line indented two spaces whose tokens are separated by one space,
 * the title last and taking the rest of the line:
 *
 *   ACTIVE <n>
 *     <anchor> <obs_id> v<schema> verified <date|never> observed <count|?> last-seen <last_seen|-> scope <scope|-> <title>
 *   INACTIVE <n>
 *     <anchor> <obs_id> v<schema> <status> <title>
 *       note: <note>                    only when the entry records one
 *   OBSERVATIONS <n>                    the log rows no ledger row carries
 *     <obs_id> <type> v<schema> observed <count|?> <title>
 *   INTEGRITY <n>
 *     <anchor> <obs_id> <flag>[,<flag>…]
 *   MALFORMED <n>                       only when lines were skipped
 *     ledger <k>                        each file with skipped lines
 *     log <k>
 *
 * An ACTIVE line's `verified` is the entry's last_verified date, or `never`;
 * `observed` and `last-seen` are its log row's observation count and last
 * sighting; `scope` is its scope entries joined by `,`, or `-` when it has none,
 * as a v1 entry does. A token that is missing or not one word prints as `-` (a
 * missing count as `?`), and so does an empty title; titles and notes are
 * already one line (buildListing).
 *
 * @param {{ active: object[], inactive: object[], observations: object[], integrity: object[], malformed: { ledger: number, log: number } }} listing - buildListing's result
 * @returns {string} the lines, with no final newline
 */
function formatListing(listing) {
  const title = text => (text === '' ? '-' : text);
  const verified = row => (isNonEmptyString(row.last_verified) ? listingToken(row.last_verified) : 'never');
  const section = (name, items, toLines) => [`${name} ${items.length}`, ...items.flatMap(toLines)];
  const lines = [
    ...section('ACTIVE', listing.active, row => [
      `  ${listingToken(row.anchor_id)} ${listingToken(row.id)} v${row.schema} verified ${verified(row)}`
        + ` observed ${row.observations ?? '?'} last-seen ${listingToken(row.last_seen)} scope ${scopeToken(row.scope)}`
        + ` ${title(row.title)}`,
    ]),
    ...section('INACTIVE', listing.inactive, row => [
      `  ${listingToken(row.anchor_id)} ${listingToken(row.id)} v${row.schema} ${listingToken(row.status)} ${title(row.title)}`,
      ...(row.note ? [`    note: ${row.note}`] : []),
    ]),
    ...section('OBSERVATIONS', listing.observations, row => [
      `  ${listingToken(row.id)} ${listingToken(row.type)} v${row.schema} observed ${row.observations ?? '?'} ${title(row.title)}`,
    ]),
    ...section('INTEGRITY', listing.integrity, entry => [
      `  ${listingToken(entry.anchor_id)} ${listingToken(entry.id)} ${entry.flags.join(',')}`,
    ]),
  ];
  const skipped = ['ledger', 'log'].filter(file => listing.malformed[file] > 0);
  if (skipped.length > 0) {
    lines.push(
      `MALFORMED ${listing.malformed.ledger + listing.malformed.log}`,
      ...skipped.map(file => `  ${file} ${listing.malformed[file]}`),
    );
  }
  return lines.join('\n');
}

/**
 * The data behind `show <anchor|obs_id>`, read-only: showEntry over the ledger,
 * the log and the history as they are. When lines were skipped as malformed
 * (D-QUARANTINE-MALFORMED), a found entry gains `malformed: { ledger, log }` and
 * a not-found message says a skipped line may hold it. Refuses without
 * .devflow/learning/ (D-NO-STRAY-TREE).
 *
 * @param {string} root - project root
 * @param {string} key - an anchor id or an observation id
 * @returns {{ ok: true, value: { key: string, ledger: object[], log: object|null, history_versions: object[], flags: object[], malformed?: { ledger: number, log: number } } }
 *   | { ok: false, error: { kind: 'no-learning-dir'|'invalid-key'|'not-found', message: string } }}
 */
function showByKey(root, key) {
  if (!hasLearningDir(root)) return noLearningDir('show', root);
  const { ledgerRows, logRows, rejected } = readLearningState(root);
  const shown = showEntry(key, ledgerRows, logRows, { historyVersions: id => historyVersions(root, id) });
  const malformed = { ledger: rejected.ledger.length, log: rejected.log.length };
  const skipped = malformed.ledger + malformed.log;
  if (skipped === 0) return shown;
  if (shown.ok) return { ok: true, value: { ...shown.value, malformed } };
  if (shown.error.kind !== 'not-found') return shown;
  const note = `MALFORMED ${skipped} (ledger ${malformed.ledger}, log ${malformed.log}): a skipped line may hold it`;
  return { ok: false, error: { ...shown.error, message: `${shown.error.message}; ${note}` } };
}

/**
 * Ask `scopeMatches` about each glob integrityFlags will ask about for these rows
 * — the glob scopes of the active v2 entries — so that a memoized matcher answers
 * from memory, with no git call, once the lock is held.
 *
 * @param {object[]} ledgerRows
 * @param {(glob: string) => boolean} scopeMatches
 */
function warmScopeMatcher(ledgerRows, scopeMatches) {
  for (const row of activeAnchoredRows(ledgerRows)) {
    if (!isV2(row) || !Array.isArray(row.scope)) continue;
    for (const entry of row.scope) {
      if (isNonEmptyString(entry) && !entry.startsWith('area:')) scopeMatches(entry);
    }
  }
}

/**
 * Hand out the entries maintenance works on next, and lease them.
 *
 * Under the learning lock it flags integrity problems and selects the due
 * entries (D-DUE-ORDER), then stamps each entry it hands out with
 * `last_attempt` = now: claim-due is the one writer of the field the lease
 * reads. A hand-out backs up a v1 tree first (D-V1-BACKUP-ONCE) and quarantines
 * the ledger's malformed lines before it rewrites the ledger
 * (D-QUARANTINE-MALFORMED); with nothing due it writes nothing. It answers the
 * ref claims are checked at as well (D-VERIFY-REF). The scope checks' git calls
 * run before the lock is taken, on the ledger as it stood then; a glob that
 * appears meanwhile is checked under the lock.
 *
 * @param {string} root - project root
 * @param {{ now?: number, timeoutMs?: number, scopeMatches?: (glob: string) => boolean }} [opts]
 *   now: epoch ms (default Date.now()); scopeMatches: default gitScopeMatcher(root)
 * @returns {{ ok: true, value: { ref: { ref: 'origin/HEAD'|'HEAD', commit: string } | null, due: Array<{ anchor_id: string, reason: string, bytes: number }> } }
 *   | { ok: false, error: { kind: string, message: string } }}
 *   due is selectDue's answer; errors are withDecisionsLock's not-a-directory,
 *   no-learning-dir and busy
 */
function claimDue(root, { now = Date.now(), timeoutMs, scopeMatches } = {}) {
  if (!hasLearningDir(root)) return noLearningDir('claim-due', root);
  const matches = scopeMatches || gitScopeMatcher(root);
  const ref = resolveVerifyRef(root);
  warmScopeMatcher(readJsonl(getDecisionsLedgerPath(root)).rows, matches);
  return withDecisionsLock('claim-due', root, () => {
    const ledgerPath = getDecisionsLedgerPath(root);
    const ledger = readJsonl(ledgerPath);
    const logRows = readJsonl(getDecisionsLogPath(root)).rows;
    const integrity = integrityFlags(ledger.rows, logRows, { scopeMatches: matches });
    const due = selectDue(ledger.rows, logRows, { now, integrity });
    if (due.length > 0) {
      ensurePreV2Backup(root, { logRows, ledgerRows: ledger.rows });
      quarantineRejected(ledgerPath, ledger.rejected, { now });
      const handedOut = new Set(due.map(entry => entry.anchor_id));
      const attemptedAt = new Date(now).toISOString();
      writeJsonlAtomic(ledgerPath, ledger.rows.map(row => (
        handedOut.has(row.anchor_id) && isActive(row) ? { ...row, last_attempt: attemptedAt } : row
      )));
    }
    return { ok: true, value: { ref, due } };
  }, { timeoutMs });
}

// ---------------------------------------------------------------------------
// assign-anchor: numbering and the cited-number scan
// ---------------------------------------------------------------------------

/** The most cited numbers assign-anchor skips before it refuses (D-E4-SKIP). */
const E4_MAX_SKIPS = 100;

/** Directory names the cited-number scan never reads, at any depth (D-E4-SKIP). */
const CITED_SCAN_EXCLUDED_SEGMENTS = Object.freeze(['.git', 'node_modules', 'target', 'dist']);

/** The largest file the cited-number scan reads (bytes); a larger one is skipped. */
const CITED_SCAN_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The most directory entries the fallback walk examines; the walk stops there. */
const CITED_SCAN_MAX_ENTRIES = 200000;

/** Anchor `n` of `prefix`, its number zero-padded to three digits. */
function formatAnchorId(prefix, n) {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/** The highest number any ledger row's anchor of `prefix` carries, whatever its status, or 0. */
function highestAnchorNumber(ledgerRows, prefix) {
  const anchorRe = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const row of ledgerRows) {
    const m = isNonEmptyString(row.anchor_id) ? anchorRe.exec(row.anchor_id) : null;
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return highest;
}

/**
 * The next anchor of `type`: one past the highest number any anchored ledger row
 * of that type carries, inactive rows included, so a retired number is never
 * reused. Decisions and pitfalls number separately. One pass over the rows.
 *
 * @param {object[]} ledgerRows
 * @param {'decision'|'pitfall'} type
 * @returns {{ anchorId: string, nextN: string }} nextN is the number, zero-padded to three digits
 * @throws {TypeError} for any other type
 */
function nextAnchorFromLedger(ledgerRows, type) {
  const prefix = anchorPrefixFor(type);
  if (prefix === null) throw new TypeError(`nextAnchorFromLedger: type must be 'decision' or 'pitfall', got '${type}'`);
  const anchorId = formatAnchorId(prefix, highestAnchorNumber(ledgerRows, prefix) + 1);
  return { anchorId, nextN: anchorId.slice(prefix.length + 1) };
}

/**
 * True when a project-relative path is one the cited-number scan never reads: the
 * learning tree, where every entry cites itself, or anything under an excluded
 * directory segment.
 *
 * @param {string} relPath - relative to the project root, either separator style
 * @returns {boolean}
 */
function isCitedScanExcluded(relPath) {
  const norm = relPath.split(path.sep).join('/');
  if (norm === '.devflow/learning' || norm.startsWith('.devflow/learning/')) return true;
  return norm.split('/').some(segment => CITED_SCAN_EXCLUDED_SEGMENTS.includes(segment));
}

/**
 * The files git tracks under `root`, relative to it.
 *
 * D-NO-FSMONITOR: `ls-files` reads the index, and reading the index runs the
 * command a repository's config names in `core.fsmonitor` — code chosen by the
 * repository this hook runs inside. The call turns it off for itself
 * (`-c core.fsmonitor=false`), so the listing stays a pure read. Reason: the
 * learning ops run inside any repository a session opens, and a read that ran
 * the repository's command would execute it with the user's privileges.
 *
 * @param {string} root - project root
 * @returns {string[]}
 * @throws when `root` is not in a git working tree, git is missing, or the call
 *   times out or overflows its buffer; the caller then walks the tree instead
 */
function listGitTrackedFiles(root) {
  return git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
}

/**
 * The files under `root` a directory walk finds, relative to it and sorted — the
 * scan's fallback outside a git working tree. It never descends into an excluded
 * directory, follows no symbolic link (the directory entry of a link is neither a
 * file nor a directory) and stops after CITED_SCAN_MAX_ENTRIES entries. A
 * directory it cannot read is skipped.
 *
 * @param {string} root - project root
 * @returns {string[]}
 */
function listFsWalkFiles(root) {
  const results = [];
  const stack = [''];
  let budget = CITED_SCAN_MAX_ENTRIES;
  while (stack.length > 0 && budget > 0) {
    const relDir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(relDir ? path.join(root, relDir) : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (budget === 0) break;
      budget -= 1;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isCitedScanExcluded(relPath)) continue;
      if (entry.isDirectory()) stack.push(relPath);
      else if (entry.isFile()) results.push(relPath);
    }
  }
  return results.sort();
}

/**
 * The text of a file the cited-number scan reads, or null for one it skips: a
 * file it cannot open or read, anything but a regular file — a symbolic link
 * included, since it opens with O_NOFOLLOW — a file over
 * CITED_SCAN_MAX_FILE_BYTES, and a binary file (one holding a NUL byte).
 * O_NONBLOCK keeps a FIFO from blocking the open, and the read never takes more
 * bytes than the size checked.
 *
 * @param {string} file
 * @returns {string|null}
 */
function readScannedText(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > CITED_SCAN_MAX_FILE_BYTES) return null;
    const buf = Buffer.alloc(stat.size);
    let total = 0;
    while (total < buf.length) {
      const read = fs.readSync(fd, buf, total, buf.length - total, total);
      if (read === 0) break;
      total += read;
    }
    const text = buf.toString('utf8', 0, total);
    return text.includes('\u0000') ? null : text;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Every anchor the project's files cite as a whole word, each mapped to its first
 * citation: the scan behind D-E4-SKIP. It reads the files git tracks under `root`
 * (D-NO-FSMONITOR) or, outside a git working tree, the files a directory walk
 * finds — never the learning tree, an excluded directory, a symbolic link, a
 * binary file or a file over the size cap. A file it cannot read is passed over.
 * It writes nothing and takes no lock.
 *
 * @param {string} root - project root
 * @returns {Map<string, { file: string, line: number }>} the file relative to
 *   `root`, the line 1-based; citations in listing order
 */
function collectCitedAnchorIds(root) {
  let files;
  try {
    files = listGitTrackedFiles(root);
  } catch {
    files = listFsWalkFiles(root);
  }
  const cited = new Map();
  for (const relPath of files) {
    if (isCitedScanExcluded(relPath)) continue;
    const text = readScannedText(path.join(root, relPath));
    if (text === null || !(text.includes('ADR-') || text.includes('PF-'))) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(ANCHOR_WORD_RE)) {
        if (!cited.has(m[0])) cited.set(m[0], { file: relPath, line: i + 1 });
      }
    }
  }
  return cited;
}

/** Today on the clock `now`, as the ledger's date fields hold it: YYYY-MM-DD, UTC. */
function isoDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** An assign-anchor refusal: `message` follows the op name. */
function assignRefusal(kind, message) {
  return { ok: false, error: { kind, message: `assign-anchor: ${message}` } };
}

/**
 * The anchor assign-anchor mints for `type` (D-E4-SKIP): nextAnchorFromLedger's,
 * or the first number after it that `citedAnchors` does not hold, skipping at most
 * E4_MAX_SKIPS numbers.
 *
 * @param {object[]} ledgerRows
 * @param {'decision'|'pitfall'} type
 * @param {ReadonlyMap<string, { file: string, line: number }>} citedAnchors
 * @returns {{ ok: true, value: { anchor_id: string, skipped: Array<{ anchor_id: string, file: string, line: number }> } }
 *   | { ok: false, error: { kind: 'cited-numbers-exhausted', message: string } }}
 */
function mintAnchor(ledgerRows, type, citedAnchors) {
  const prefix = anchorPrefixFor(type);
  const first = highestAnchorNumber(ledgerRows, prefix) + 1;
  const skipped = [];
  for (let n = first; n <= first + E4_MAX_SKIPS; n++) {
    const anchorId = formatAnchorId(prefix, n);
    const citation = citedAnchors.get(anchorId);
    if (!citation) return { ok: true, value: { anchor_id: anchorId, skipped } };
    skipped.push({ anchor_id: anchorId, file: citation.file, line: citation.line });
  }
  const last = formatAnchorId(prefix, first + E4_MAX_SKIPS);
  return assignRefusal(
    'cited-numbers-exhausted',
    `${formatAnchorId(prefix, first)} to ${last} are all cited in tracked files; nothing was written`,
  );
}

/**
 * Promote a v2 observation to a new ledger entry of `type` — the assign-anchor op.
 *
 * D-E4-SKIP: assign-anchor scans the project's tracked files once, before it takes
 * the learning lock, for every anchor they cite as a whole word, and mints the
 * first number past the type's highest anchored number that no file cites; it
 * reports each number it skips, skips at most E4_MAX_SKIPS of them and refuses
 * when the next one is cited too. The scan reads neither the learning tree nor
 * .git or a vendored or build directory (node_modules, target, dist), nor a
 * symbolic link, a binary file or a file over 5 MB. Reason: a document can cite a
 * number the ledger has not minted yet, and minting over it silently binds that
 * citation to an unrelated entry; refusing stopped the run until a person
 * renamed the citation, while a skipped number costs only a gap.
 *
 * The observation must be one v2 log row of `type` that no ledger row carries,
 * whatever its status (D-LEDGER-REGISTRY). The new row is its projection
 * (toLedgerRowV2) with the type's active status and today as both date and
 * last_verified; it is appended to the ledger and the files are re-rendered, all
 * under the learning lock. The log is never written. Like every writer it backs
 * up a v1 tree first (D-V1-BACKUP-ONCE) and quarantines the ledger's malformed
 * lines before it rewrites the ledger (D-QUARANTINE-MALFORMED); a refusal writes
 * nothing.
 *
 * @param {string} root - project root
 * @param {'decision'|'pitfall'} type
 * @param {string} obsId - an observation id
 * @param {{ now?: number, timeoutMs?: number, citedAnchors?: ReadonlyMap<string, { file: string, line: number }> }} [opts]
 *   now: epoch ms (default Date.now()); citedAnchors: default collectCitedAnchorIds(root)
 * @returns {{ ok: true, value: { anchor_id: string, skipped: Array<{ anchor_id: string, file: string, line: number }> } }
 *   | { ok: false, error: { kind: string, message: string } }}
 *   Error kinds: not-in-log, duplicate-log-id, already-promoted, v1-observation,
 *   type-mismatch, cited-numbers-exhausted, and withDecisionsLock's
 *   not-a-directory, no-learning-dir and busy.
 * @throws {TypeError} for a type other than decision or pitfall, or a malformed obsId
 */
function assignAnchor(root, type, obsId, { now = Date.now(), timeoutMs, citedAnchors } = {}) {
  if (anchorPrefixFor(type) === null) throw new TypeError(`assignAnchor: type must be 'decision' or 'pitfall', got '${type}'`);
  if (typeof obsId !== 'string' || !OBS_ID_RE.test(obsId)) throw new TypeError('assignAnchor: obsId must be an observation id');
  if (!hasLearningDir(root)) return noLearningDir('assign-anchor', root);
  const cited = citedAnchors || collectCitedAnchorIds(root);
  return withDecisionsLock('assign-anchor', root, () => assignUnderLock(root, type, obsId, { now, cited }), { timeoutMs });
}

/** assignAnchor's locked body. */
function assignUnderLock(root, type, obsId, { now, cited }) {
  const ledgerPath = getDecisionsLedgerPath(root);
  const ledger = readJsonl(ledgerPath);
  const log = readJsonl(getDecisionsLogPath(root));

  const sameId = log.rows.filter(row => row.id === obsId);
  if (sameId.length === 0) {
    return assignRefusal('not-in-log', `'${obsId}' is not in the log; store it with put-observation --create first`);
  }
  if (sameId.length > 1) {
    return assignRefusal('duplicate-log-id', `the log holds ${sameId.length} rows with id '${obsId}'; nothing was written`);
  }
  const carriers = ledgerRegistry(ledger.rows).byObsId.get(obsId) || [];
  if (carriers.length > 0) {
    const entries = sortedByAnchor(carriers).map(row => `${listingToken(row.anchor_id)} ${listingToken(row.decisions_status)}`);
    return assignRefusal('already-promoted', `'${obsId}' is already promoted (${entries.join(', ')}); nothing was written`);
  }
  const [logRow] = sameId;
  if (!isV2(logRow)) {
    return assignRefusal('v1-observation', `'${obsId}' is a v1 observation; rewrite it with put-observation --update first`);
  }
  if (logRow.type !== type) {
    return assignRefusal('type-mismatch', `'${obsId}' is a ${listingToken(logRow.type)} observation, not a ${type}; nothing was written`);
  }
  const minted = mintAnchor(ledger.rows, type, cited);
  if (!minted.ok) return minted;

  const today = isoDate(now);
  const row = toLedgerRowV2(logRow, { last_verified: today }, {
    anchorId: minted.value.anchor_id,
    status: activeStatusFor(type),
    date: today,
    expectType: type,
  });
  ensurePreV2Backup(root, { logRows: log.rows, ledgerRows: ledger.rows });
  quarantineRejected(ledgerPath, ledger.rejected, { now });
  const ledgerRows = [...ledger.rows, row];
  writeJsonlAtomic(ledgerPath, ledgerRows);
  renderAll(root, ledgerRows);
  return minted;
}

// ---------------------------------------------------------------------------
// refresh-anchor
// ---------------------------------------------------------------------------

/**
 * The one ledger row carrying `anchorId`, or why there is not exactly one: the
 * anchor is `not in the ledger`, or `held by <n> ledger rows`.
 *
 * @param {object[]} ledgerRows
 * @param {string} anchorId
 * @returns {{ row: object } | { kind: 'not-found'|'duplicate-anchor', reason: string }}
 */
function rowCarrying(ledgerRows, anchorId) {
  const rows = ledgerRows.filter(row => row.anchor_id === anchorId);
  if (rows.length === 1) return { row: rows[0] };
  return rows.length === 0
    ? { kind: 'not-found', reason: 'not in the ledger' }
    : { kind: 'duplicate-anchor', reason: `held by ${rows.length} ledger rows` };
}

/**
 * Why ledger row `row` is not an active v2 entry, or null: it is inactive, or v1.
 *
 * @param {object} row
 * @returns {string|null}
 */
function activeV2EntryProblem(row) {
  if (!isActive(row)) return `${listingToken(row.decisions_status)}; restore it with restore-anchor first`;
  if (!isV2(row)) return 'a v1 entry; rewrite it with put-observation --update';
  return null;
}

/**
 * The log row active entry `row` re-projects from, or why it cannot: it has no
 * observation id, or the log holds no row, two rows or a v1 row with that id, or
 * one of a type the entry cannot take.
 *
 * @param {object} row - an active v2 ledger row
 * @param {object[]} logRows
 * @returns {{ logRow: object } | { problem: string }}
 */
function reprojectionSource(row, logRows) {
  if (!isNonEmptyString(row.id)) return { problem: 'has no observation id' };
  const sameId = logRows.filter(logRow => logRow.id === row.id);
  if (sameId.length === 0) return { problem: `no log row has id '${row.id}'; write it back with put-observation --create` };
  if (sameId.length > 1) return { problem: `the log holds ${sameId.length} rows with id '${row.id}'` };
  const [logRow] = sameId;
  if (!isV2(logRow)) return { problem: 'its log row is v1; rewrite it with put-observation --update' };
  const problem = reprojectionProblem(row, logRow.type);
  return problem ? { problem: `cannot take its log row: ${problem}` } : { logRow };
}

/** The refusal of a refresh batch: every refused anchor, one per line, each problem on one line. */
function refreshRefusal(problems, total) {
  const listed = problems.map(({ anchor_id, message }) => ({ anchor_id, message: singleLine(message) }));
  const head = `refresh-anchor: ${listed.length} of ${total} anchor${total === 1 ? '' : 's'} refused; nothing was written`;
  const lines = listed.map(({ anchor_id, message }) => `  ${anchor_id}: ${message}`);
  return { ok: false, error: { kind: 'refused', message: [head, ...lines].join('\n'), problems: listed } };
}

/** True when two ledger rows differ in any projected content field. */
function projectedContentDiffers(a, b) {
  return PROJECTED_CONTENT_KEYS.some(key => !sameJson(a[key], b[key]));
}

/**
 * Record in history, once per observation, the prior ledger rows and the log row
 * of each re-projection that changes an entry's content (D-CONTENT-HISTORY).
 */
function recordRefreshHistory(root, plans, ledgerRows, { now }) {
  const carriers = ledgerRegistry(ledgerRows).byObsId;
  const recorded = new Set();
  for (const { prior, next, logRow } of plans) {
    if (recorded.has(logRow.id) || !projectedContentDiffers(prior, next)) continue;
    recorded.add(logRow.id);
    appendHistory(root, { id: logRow.id, ledger: carriers.get(logRow.id) || [], log: logRow }, { now });
  }
}

/**
 * Re-project active v2 entries from their log rows, or stamp them verified — the
 * refresh-anchor op.
 *
 * Without `verified`, each entry is re-projected from its log row through
 * toLedgerRowV2 (D-LOG-CONTENT-AUTHORITY): it takes the log row's content
 * whatever the ledger held, so a rewrite replaces the old text in place, and the
 * prior ledger rows go to history first whenever an entry's content changes
 * (D-CONTENT-HISTORY). With `verified`, each entry's last_verified becomes today
 * and nothing else changes; no log row is needed.
 *
 * The batch is all or nothing: an anchor the ledger does not hold or holds twice,
 * an inactive entry or a v1 one, and — when re-projecting — an entry with no
 * observation id or whose log row is missing, doubled, v1 or of a type it cannot
 * take refuses the whole batch, every refused anchor listed, nothing written. A
 * batch that changes no row writes nothing. Otherwise, under the learning lock,
 * it backs up a v1 tree (D-V1-BACKUP-ONCE), quarantines the ledger's malformed
 * lines (D-QUARANTINE-MALFORMED), then writes the ledger once and renders once.
 *
 * @param {string} root - project root
 * @param {string[]} anchorIds - one or more anchor ids; a repeated one counts once
 * @param {{ verified?: boolean, now?: number, timeoutMs?: number }} [opts]
 *   now: epoch ms (default Date.now())
 * @returns {{ ok: true, value: { refreshed: Array<{ anchor_id: string, state: 'verified'|'reprojected'|'unchanged' }> } }
 *   | { ok: false, error: { kind: string, message: string, problems?: Array<{ anchor_id: string, message: string }> } }}
 *   refreshed: each anchor once, in the order given. Error kinds: refused (with
 *   problems), and withDecisionsLock's not-a-directory, no-learning-dir and busy.
 * @throws {TypeError} when anchorIds is empty or holds anything but anchor ids
 */
function refreshAnchors(root, anchorIds, { verified = false, now = Date.now(), timeoutMs } = {}) {
  const valid = Array.isArray(anchorIds) && anchorIds.length > 0
    && anchorIds.every(id => typeof id === 'string' && ANCHOR_ID_RE.test(id));
  if (!valid) throw new TypeError('refreshAnchors: anchorIds must hold one or more anchor ids');
  const anchors = [...new Set(anchorIds)];
  return withDecisionsLock('refresh-anchor', root, () => refreshUnderLock(root, anchors, { verified, now }), { timeoutMs });
}

/** refreshAnchors' locked body. */
function refreshUnderLock(root, anchors, { verified, now }) {
  const ledgerPath = getDecisionsLedgerPath(root);
  const ledger = readJsonl(ledgerPath);
  const log = readJsonl(getDecisionsLogPath(root));
  const today = isoDate(now);

  const problems = [];
  const plans = [];
  for (const anchorId of anchors) {
    const found = rowCarrying(ledger.rows, anchorId);
    const entryProblem = found.row ? activeV2EntryProblem(found.row) : found.reason;
    if (entryProblem) {
      problems.push({ anchor_id: anchorId, message: entryProblem });
      continue;
    }
    const prior = found.row;
    if (verified) {
      plans.push({ anchor_id: anchorId, prior, next: withLedgerFields(prior, { last_verified: today }) });
      continue;
    }
    const source = reprojectionSource(prior, log.rows);
    if (source.problem) problems.push({ anchor_id: anchorId, message: source.problem });
    else plans.push({ anchor_id: anchorId, prior, next: reprojectedRow(source.logRow, prior), logRow: source.logRow });
  }
  if (problems.length > 0) return refreshRefusal(problems, anchors.length);

  const changed = plans.filter(plan => !sameJson(plan.prior, plan.next));
  const stateOf = plan => {
    if (verified) return 'verified';
    return changed.includes(plan) ? 'reprojected' : 'unchanged';
  };
  const refreshed = plans.map(plan => ({ anchor_id: plan.anchor_id, state: stateOf(plan) }));
  if (changed.length === 0) return { ok: true, value: { refreshed } };

  ensurePreV2Backup(root, { logRows: log.rows, ledgerRows: ledger.rows });
  quarantineRejected(ledgerPath, ledger.rejected, { now });
  if (!verified) recordRefreshHistory(root, changed, ledger.rows, { now });
  const replaced = new Map(changed.map(plan => [plan.prior, plan.next]));
  const ledgerRows = ledger.rows.map(row => replaced.get(row) || row);
  writeJsonlAtomic(ledgerPath, ledgerRows);
  renderAll(root, ledgerRows);
  return { ok: true, value: { refreshed } };
}

// ---------------------------------------------------------------------------
// retire-anchor and restore-anchor
// ---------------------------------------------------------------------------

/** The stdin keys each inactive status takes. */
const RETIRE_INPUT_KEYS = Object.freeze({
  Encoded: Object.freeze(['at', 'quote']),
  Superseded: Object.freeze(['by']),
  Retired: Object.freeze(['reason']),
  Deprecated: Object.freeze(['reason']),
});

/** The ledger-owned fields that say why an entry is inactive: a retirement sets one and retired_on; restore clears them. */
const RETIREMENT_FIELDS = Object.freeze(['status_note', 'superseded_by', 'encoded_at', 'retired_on']);

/** `keys` mapped to undefined: the withLedgerFields updates that remove them. */
function removing(keys) {
  return Object.fromEntries(keys.map(key => [key, undefined]));
}

/**
 * `row` with decisions_status `status` and the ledger-owned fields in `updates`
 * (withLedgerFields). A status key the row has keeps its place; a row without one
 * takes it after anchor_id, where the projection puts it.
 *
 * @param {object} row - a ledger row that has an anchor_id: its caller found it by anchor
 * @param {string} status
 * @param {Record<string, unknown>} updates - ledger-owned fields only
 * @returns {object} a new row
 */
function withEntryStatus(row, status, updates) {
  const next = withLedgerFields(row, updates);
  if (Object.prototype.hasOwnProperty.call(next, 'decisions_status')) {
    next.decisions_status = status;
    return next;
  }
  const placed = {};
  for (const [key, value] of Object.entries(next)) {
    placed[key] = value;
    if (key === 'anchor_id') placed.decisions_status = status;
  }
  return placed;
}

/** The problem with an Encoded path, or null: it names a file from the repository root. */
function encodedPathProblem(at) {
  if (at.startsWith('/')) return 'must be relative to the repository root';
  if (at.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    return 'must not hold an empty, . or .. segment';
  }
  return null;
}

/** The problem with an Encoded quote too short once its whitespace collapses, or null. */
function quoteLengthProblem(quote) {
  const length = codePointLength(normalizeWhitespace(quote));
  return length < FIELD_LIMITS.quoteMin
    ? `is ${length} characters once its whitespace is collapsed, under the minimum of ${FIELD_LIMITS.quoteMin}`
    : null;
}

/** The problem with a Superseded successor's shape, or null. */
function successorShapeProblem(anchorId, by) {
  if (typeof by !== 'string' || !ANCHOR_ID_RE.test(by)) return 'must be an anchor id';
  if (by === anchorId) return 'names this entry; an entry cannot supersede itself';
  return null;
}

/**
 * Every problem with a retire-anchor input for `status`: the keys it does not
 * take, in input order, then its own fields, each with at most one problem.
 *
 * @param {string} anchorId - the entry being retired
 * @param {string} status - an inactive status
 * @param {unknown} input - the parsed stdin object
 * @returns {Array<{ field: string, message: string }>}
 */
function retireInputProblems(anchorId, status, input) {
  if (!isPlainObject(input)) return [{ field: '(input)', message: 'must be one JSON object' }];
  const accepted = RETIRE_INPUT_KEYS[status];
  const problems = Object.keys(input)
    .filter(key => !accepted.includes(key))
    .map(key => ({ field: key, message: `is not taken by ${status}, which takes ${accepted.join(' and ')}` }));
  const check = (field, problem) => {
    if (problem) problems.push({ field, message: problem });
  };
  const absent = key => (input[key] === undefined ? 'is required' : null);
  if (status === 'Encoded') {
    check('at', absent('at') || textProblem(input.at, FIELD_LIMITS.path) || encodedPathProblem(input.at));
    check('quote', absent('quote') || textProblem(input.quote, FIELD_LIMITS.quoteMax) || quoteLengthProblem(input.quote));
  } else if (status === 'Superseded') {
    check('by', absent('by') || successorShapeProblem(anchorId, input.by));
  } else {
    check('reason', absent('reason') || textProblem(input.reason, FIELD_LIMITS.note));
  }
  return problems;
}

/** A retire-anchor refusal: `message` follows the op name. */
function retireRefusal(kind, message) {
  return { ok: false, error: { kind, message: `retire-anchor: ${message}` } };
}

/** A restore-anchor refusal: `message` follows the op name. */
function restoreRefusal(kind, message) {
  return { ok: false, error: { kind, message: `restore-anchor: ${message}` } };
}

/**
 * Check that `quote` appears in file `at` as committed at the verify ref, and
 * answer the encoded_at record retire-anchor keeps for it.
 *
 * D-ENCODED-QUOTE: an entry is retired as Encoded only with a path and a quote
 * from that file, and only when the quote, every run of whitespace collapsed to
 * one space on both sides, appears in the file as committed at the verify ref
 * (D-VERIFY-REF), read with `git cat-file blob <commit>:<path>`; the entry keeps
 * the path, the quote, the ref and the commit as encoded_at. Reason: a citation is
 * a claim that nothing else checks — a path alone can point anywhere — so only a
 * quote found at a ref every checkout shares shows that the lesson now lives in
 * that file, and the commit lets a later run look at what was checked.
 *
 * @param {string} root - project root
 * @param {string} at - a path from the repository root
 * @param {string} quote
 * @param {{ verifyRef?: { ref: 'origin/HEAD'|'HEAD', commit: string } | null }} [opts]
 *   verifyRef: default resolveVerifyRef(root); null when there is no commit to check
 * @returns {{ ok: true, value: { path: string, quote: string, ref: string, commit: string } }
 *   | { ok: false, error: { kind: 'no-verify-ref'|'not-at-ref'|'git-failed'|'quote-not-found', message: string } }}
 */
function quoteAtRef(root, at, quote, { verifyRef } = {}) {
  const checkedAt = verifyRef === undefined ? resolveVerifyRef(root) : verifyRef;
  if (checkedAt === null) {
    return retireRefusal('no-verify-ref', 'there is no commit to check the quote at (not a git repository, or no commit yet); nothing was written');
  }
  const where = `${checkedAt.ref} ${checkedAt.commit.slice(0, 12)}`;
  const shown = singleLine(at);
  let blob;
  try {
    blob = git(root, ['cat-file', 'blob', `${checkedAt.commit}:${at}`]);
  } catch (err) {
    if (err && typeof err.status === 'number') {
      return retireRefusal('not-at-ref', `'${shown}' is not a file at ${where}; nothing was written`);
    }
    return retireRefusal('git-failed', `could not read '${shown}' at ${where}: ${singleLine(String(err && err.message))}; nothing was written`);
  }
  if (!normalizeWhitespace(blob).includes(normalizeWhitespace(quote))) {
    return retireRefusal('quote-not-found', `the quote is not in '${shown}' at ${where}; nothing was written`);
  }
  return { ok: true, value: { path: at, quote, ref: checkedAt.ref, commit: checkedAt.commit } };
}

/**
 * Make an active entry inactive — the retire-anchor op — with the stdin its new
 * status takes, every problem with that input reported at once:
 *   Retired, Deprecated  { reason }     at most 120 characters, kept as status_note
 *   Superseded           { by }         an active entry other than this one, of
 *                                       either type, kept as superseded_by; every
 *                                       inactive entry this one superseded is
 *                                       re-pointed to it
 *   Encoded              { at, quote }  checked at the verify ref and kept as
 *                                       encoded_at (D-ENCODED-QUOTE)
 * Each also sets retired_on to today and clears the other notes; the rest of the
 * row stays as it is, so a v1 entry stays v1. An entry already inactive, an
 * anchor the ledger does not hold or holds twice, and a successor absent or
 * inactive are refused. The input and the quote are checked before the learning
 * lock is taken; under it the ledger is written once and the files are rendered,
 * after a v1 tree is backed up (D-V1-BACKUP-ONCE) and malformed ledger lines are
 * quarantined (D-QUARANTINE-MALFORMED). A refusal writes nothing.
 *
 * @param {string} root - project root
 * @param {string} anchorId
 * @param {'Encoded'|'Superseded'|'Retired'|'Deprecated'} status
 * @param {unknown} input - the parsed stdin object
 * @param {{ now?: number, timeoutMs?: number, verifyRef?: { ref: 'origin/HEAD'|'HEAD', commit: string } | null }} [opts]
 *   now: epoch ms (default Date.now()); verifyRef: see quoteAtRef
 * @returns {{ ok: true, value: { anchor_id: string, status: string, repointed: string[] } }
 *   | { ok: false, error: { kind: string, message: string, problems?: Array<{ field: string, message: string }> } }}
 *   repointed: the entries re-pointed to the successor, in anchor order. Error
 *   kinds: invalid-input (with problems), quoteAtRef's, not-found,
 *   duplicate-anchor, already-inactive, successor-not-found,
 *   successor-duplicate-anchor, successor-inactive, and withDecisionsLock's
 *   not-a-directory, no-learning-dir and busy.
 * @throws {TypeError} for a malformed anchorId or a status that is not inactive
 */
function retireAnchor(root, anchorId, status, input, { now = Date.now(), timeoutMs, verifyRef } = {}) {
  if (typeof anchorId !== 'string' || !ANCHOR_ID_RE.test(anchorId)) throw new TypeError('retireAnchor: anchorId must be an anchor id');
  if (!INACTIVE_STATUSES.includes(status)) {
    throw new TypeError(`retireAnchor: status must be one of ${INACTIVE_STATUSES.join(', ')}, got '${status}'`);
  }
  if (!hasLearningDir(root)) return noLearningDir('retire-anchor', root);
  const problems = retireInputProblems(anchorId, status, input);
  if (problems.length > 0) return invalidInput('retire-anchor', problems);
  let note;
  if (status === 'Encoded') {
    const encoded = quoteAtRef(root, input.at, input.quote, { verifyRef });
    if (!encoded.ok) return encoded;
    note = { encoded_at: encoded.value };
  } else if (status === 'Superseded') {
    note = { superseded_by: input.by };
  } else {
    note = { status_note: input.reason };
  }
  return withDecisionsLock('retire-anchor', root, () => retireUnderLock(root, anchorId, status, note, { now }), { timeoutMs });
}

/** retireAnchor's locked body. */
function retireUnderLock(root, anchorId, status, note, { now }) {
  const ledgerPath = getDecisionsLedgerPath(root);
  const ledger = readJsonl(ledgerPath);
  const found = rowCarrying(ledger.rows, anchorId);
  if (!found.row) return retireRefusal(found.kind, `${anchorId} is ${found.reason}; nothing was written`);
  const prior = found.row;
  if (!isActive(prior)) {
    return retireRefusal('already-inactive', `${anchorId} is already ${listingToken(prior.decisions_status)}; nothing was written`);
  }
  if (status === 'Superseded') {
    const successor = rowCarrying(ledger.rows, note.superseded_by);
    if (!successor.row) {
      return retireRefusal(`successor-${successor.kind}`, `${note.superseded_by}, the successor, is ${successor.reason}; nothing was written`);
    }
    if (!isActive(successor.row)) {
      return retireRefusal(
        'successor-inactive',
        `${note.superseded_by}, the successor, is ${listingToken(successor.row.decisions_status)}; nothing was written`,
      );
    }
  }

  const retired = withEntryStatus(prior, status, { ...removing(RETIREMENT_FIELDS), ...note, retired_on: isoDate(now) });
  const repointed = status === 'Superseded'
    ? sortedByAnchor(ledger.rows.filter(row => row !== prior && !isActive(row) && row.superseded_by === anchorId))
    : [];
  const replaced = new Map([
    [prior, retired],
    ...repointed.map(row => [row, withLedgerFields(row, { superseded_by: note.superseded_by })]),
  ]);
  ensurePreV2Backup(root, { logRows: readJsonl(getDecisionsLogPath(root)).rows, ledgerRows: ledger.rows });
  quarantineRejected(ledgerPath, ledger.rejected, { now });
  const ledgerRows = ledger.rows.map(row => replaced.get(row) || row);
  writeJsonlAtomic(ledgerPath, ledgerRows);
  renderAll(root, ledgerRows);
  return { ok: true, value: { anchor_id: anchorId, status, repointed: repointed.map(row => row.anchor_id) } };
}

/**
 * Make an inactive entry active again — the restore-anchor op. The entry takes
 * its type's active status (Accepted for a decision, Active for a pitfall) and
 * loses its retirement notes, its last_verified and its last_attempt, so the next
 * claim-due hands it out ahead of every verified entry (D-DUE-ORDER); its content
 * and its date stay, and the files are re-rendered. An entry already active, an
 * anchor the ledger does not hold or holds twice, and a row whose type its anchor
 * does not name are refused. It writes as retireAnchor does, under the learning
 * lock; a refusal writes nothing.
 *
 * @param {string} root - project root
 * @param {string} anchorId
 * @param {{ now?: number, timeoutMs?: number }} [opts] - now: epoch ms (default Date.now())
 * @returns {{ ok: true, value: { anchor_id: string, status: 'Accepted'|'Active' } }
 *   | { ok: false, error: { kind: string, message: string } }}
 *   Error kinds: not-found, duplicate-anchor, already-active, type-mismatch, and
 *   withDecisionsLock's not-a-directory, no-learning-dir and busy.
 * @throws {TypeError} for a malformed anchorId
 */
function restoreAnchor(root, anchorId, { now = Date.now(), timeoutMs } = {}) {
  if (typeof anchorId !== 'string' || !ANCHOR_ID_RE.test(anchorId)) throw new TypeError('restoreAnchor: anchorId must be an anchor id');
  return withDecisionsLock('restore-anchor', root, () => restoreUnderLock(root, anchorId, { now }), { timeoutMs });
}

/** restoreAnchor's locked body. */
function restoreUnderLock(root, anchorId, { now }) {
  const ledgerPath = getDecisionsLedgerPath(root);
  const ledger = readJsonl(ledgerPath);
  const found = rowCarrying(ledger.rows, anchorId);
  if (!found.row) return restoreRefusal(found.kind, `${anchorId} is ${found.reason}; nothing was written`);
  const prior = found.row;
  if (isActive(prior)) return restoreRefusal('already-active', `${anchorId} is already active; nothing was written`);
  const prefix = anchorPrefixFor(prior.type);
  if (prefix === null || !anchorId.startsWith(`${prefix}-`)) {
    return restoreRefusal(
      'type-mismatch',
      `${anchorId} holds a row of type ${listingToken(prior.type)}, which its anchor does not name; nothing was written`,
    );
  }

  const status = activeStatusFor(prior.type);
  const restored = withEntryStatus(prior, status, removing([...RETIREMENT_FIELDS, 'last_verified', 'last_attempt']));
  ensurePreV2Backup(root, { logRows: readJsonl(getDecisionsLogPath(root)).rows, ledgerRows: ledger.rows });
  quarantineRejected(ledgerPath, ledger.rejected, { now });
  const ledgerRows = ledger.rows.map(row => (row === prior ? restored : row));
  writeJsonlAtomic(ledgerPath, ledgerRows);
  renderAll(root, ledgerRows);
  return { ok: true, value: { anchor_id: anchorId, status } };
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
  // Text shared with the renderer
  singleLine,
  inactiveNote,
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
  // Rotation, clearing and resetting
  rotateObservations,
  clearUnreferenced,
  resetLearning,
  // The queue claim
  CLAIM_STALE_SECS,
  CLAIM_TOKEN_RE,
  newClaimToken,
  claimQueue,
  releaseClaim,
  touchClaim,
  // Integrity, listing, due selection and show
  integrityFlags,
  buildListing,
  entrySize,
  selectDue,
  showEntry,
  resolveVerifyRef,
  // Entry ops
  putObservation,
  readListing,
  formatListing,
  showByKey,
  claimDue,
  // assign-anchor
  E4_MAX_SKIPS,
  nextAnchorFromLedger,
  collectCitedAnchorIds,
  assignAnchor,
  // refresh-anchor
  refreshAnchors,
  // retire-anchor and restore-anchor
  quoteAtRef,
  retireAnchor,
  restoreAnchor,
};
