#!/usr/bin/env node
// src/assets/scripts/verify-evidence.cjs
//
// The I/O half of PR test-plan evidence. pr-evidence.cjs (a sibling under
// ~/.devflow/scripts/) owns every grammar, marker, state rule and rendering; this
// script only gathers the facts its `classify` needs — through gh and git, behind
// one injected exec — and prints a closed-vocabulary answer. A verdict here is
// never a Test or Validate claim taken on trust: a claim becomes a state only
// through SHA ancestry, the diff since the claim, and `gh run view --attempt`.
//
// Usage:
//   node verify-evidence.cjs check tp|block|exceptions <file>
//   node verify-evidence.cjs render --plan <file>
//   node verify-evidence.cjs verify --pr <n> [--publication <mode>] [--evidence <file>]
//        [--state <dir>] [--block-out <file>] [--comment-out <file>] [--stale-out <file>] [--approval]
//   node verify-evidence.cjs splice --pr <n> --state <dir> --block <file> --out <file>
//   node verify-evidence.cjs readback --pr <n> --expect <file>
//
// stdout (D-VERIFY-STDOUT) is empty or exactly one of these, each a closed-vocabulary
// line (the render block's TP lines come from the caller's own plan file):
//   check     nothing — the exit code is the answer; the diagnostic is on stderr
//   render    the creation block: markers, `## Test Plan`, every TP unticked
//   verify    EVIDENCE pr:<n> head:<sha> total:<n> VERIFIED-CI:<n> ATTESTED-LOCAL:<n>
//             UNVERIFIED:<n> STALE:<n> FAILED:<n> INDETERMINATE:<n> stale:<ids|none>
//             exceptions:<kinds|none> approval:<yes|no|unchecked> key:<hex>
//             posted:<yes|no|n/a> body:<same|changed>          (one line; wrapped here)
//   splice    SPLICE ok|resplice (exit 0) or SPLICE conflict|malformed|oversize (exit 5)
//   readback  READBACK ok (exit 0) or READBACK mismatch (exit 5)
// No byte of a PR body, a comment, a review or a gh/git answer is ever printed: the
// boundary re-checks every stdout line against these shapes before writing it.
//
// Exit codes:
//   0  ok
//   1  usage error — stdout entirely empty, usage on stderr
//   2  input unusable — a file could not be read (missing, not a regular file,
//      oversize, not UTF-8), the evidence file or the state directory is
//      malformed, or the PR body's test-plan block cannot serve as the plan
//   3  output write failed — no stdout line is printed
//   4  remote or internal failure before any verdict — `gh pr view` failed or
//      answered something unusable, or an unexpected internal error
//   5  output gate refused — `check` found the file invalid, the EVIDENCE line
//      failed its grammar or its consistency checks, the compare-and-swap refused
//      (conflict, malformed, oversize), or the read-back differs
//
// Design constraints (binding):
//   - main() returns {code, stdout} and never calls process.exit; the single
//     `require.main === module` boundary is the only stdout write and the only
//     exitCode assignment
//   - every subprocess is spawned with an argv array (never a shell), stdin
//     ignored, a timeout and a maxBuffer; every loop and every API fan-out has a
//     fixed bound, and the whole run has a wall-clock deadline
//   - a revision reaches git only after SHA_RE, so none can start with `-`; `--`
//     ends the revision list of the one command that takes a pathspec (diff)
//   - every `gh` answer, git answer, PR body and comment is hostile: parsed into a
//     typed value at the boundary, bounded, and never echoed

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const PE = require(path.join(__dirname, 'pr-evidence.cjs'));

// ---------------------------------------------------------------------------
// Closed vocabularies and bounds
// ---------------------------------------------------------------------------

/** Exit codes by meaning (see the header). */
const EXIT_CODES = Object.freeze({
  OK: 0,
  USAGE: 1,
  INPUT_UNUSABLE: 2,
  WRITE_FAILED: 3,
  REMOTE_FAILURE: 4,
  OUTPUT_GATE_REFUSED: 5,
});

/**
 * D-VERIFY-CAPS: the per-spawn API bounds. A call past a cap is REFUSED, never
 * made, and a refused call is an unresolved fact — INDETERMINATE, never a pass.
 *   GH_CALLS            every gh call this spawn makes, the PR read included
 *   RUN_VIEWS           `gh run view` calls (memoised per run and attempt)
 *   PERMISSION_LOOKUPS  logins looked up for the trust rule (pr-evidence caps it)
 *   TPS                 test-plan lines (pr-evidence's parsers cap it)
 *   COMMENTS / REVIEWS  the newest entries of each list that are read at all
 */
const CAPS = Object.freeze({
  GH_CALLS: 40,
  RUN_VIEWS: 10,
  PERMISSION_LOOKUPS: PE.LIMITS.TRUST_LOOKUPS,
  TPS: PE.LIMITS.TP_MAX,
  COMMENTS: 1000,
  REVIEWS: 1000,
});

/**
 * D-VERIFY-DEADLINE: the whole run's wall-clock budget. The Git agent runs this
 * script inside a tool call with its own timeout; past the deadline every further
 * call is refused, so the script still prints a (more INDETERMINATE) line in time
 * instead of being killed mid-run.
 */
const DEADLINE_MS = 90000;

const GH_TIMEOUT_MS = 20000;
const GIT_FETCH_TIMEOUT_MS = 60000;
const GIT_LOCAL_TIMEOUT_MS = 20000;

/** A PR's JSON: 1,000 comments of 65,536 characters, JSON-escaped, still fits. */
const PR_VIEW_MAX_BUFFER = 64 * 1024 * 1024;
const RUN_LIST_MAX_BUFFER = 1024 * 1024;
const RUN_VIEW_MAX_BUFFER = 65536;
const LINE_MAX_BUFFER = 4096;
/** 5,000 paths of 4,096 bytes overflow this; an overflow reads as an unresolved diff. */
const DIFF_MAX_BUFFER = 16 * 1024 * 1024;
const FETCH_MAX_BUFFER = 1024 * 1024;

/** The largest file read, in bytes: INPUT_CHARS characters of 4-byte UTF-8. */
const MAX_FILE_BYTES = 4 * PE.LIMITS.INPUT_CHARS;
/** The longest command-line value accepted. */
const MAX_ARG_CHARS = 4096;
/** The longest html_url, run URL, status or conclusion string kept from gh. */
const MAX_URL_CHARS = 400;
const MAX_TOKEN_CHARS = 40;

/** The fields of the one `gh pr view` read. */
const PR_FIELDS = 'body,comments,reviews,author,headRefOid,baseRefOid,isCrossRepository,number';

/** A PR number: no leading zero, at most 10 digits (the EVIDENCE line's bound). */
const PR_RE = /^[1-9][0-9]{0,9}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;

/** A review state that decides a login's position on the PR (D6). */
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/** The stdout shapes of splice and readback (D-VERIFY-STDOUT). */
const SPLICE_LINE_RE = /^SPLICE (?<outcome>ok|resplice|conflict|malformed|oversize)$/;
const READBACK_LINE_RE = /^READBACK (?<outcome>ok|mismatch)$/;

const USAGE = [
  'Usage: node verify-evidence.cjs check tp|block|exceptions <file>',
  '       node verify-evidence.cjs render --plan <file>',
  '       node verify-evidence.cjs verify --pr <n> [--publication <mode>] [--evidence <file>]',
  '            [--state <dir>] [--block-out <file>] [--comment-out <file>] [--stale-out <file>] [--approval]',
  '       node verify-evidence.cjs splice --pr <n> --state <dir> --block <file> --out <file>',
  '       node verify-evidence.cjs readback --pr <n> --expect <file>',
].join('\n');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {{ status: number | null, stdout?: Buffer | string, stderr?: Buffer | string, error?: { code?: string } }} ExecResult
 *   The spawnSync subset this script reads.
 * @typedef {(file: string, args: string[], opts: object) => ExecResult} ExecFn
 *   Called exactly like child_process.spawnSync(file, args, opts).
 *
 * @typedef {{ ok: boolean, status: number | null, errorCode: string | null, stdout: Buffer,
 *   stderr: string, refused: null | 'cap' | 'throttled' | 'deadline' }} CallResult
 *   `refused` is set when the call was never made.
 *
 * @typedef {{ ghCalls: number, runViews: number, throttled: boolean }} Budget
 *
 * @typedef {{ exec: ExecFn, env: NodeJS.ProcessEnv, cwd: string, now: () => number,
 *   deadline: number, budget: Budget, notes: Set<string>, stderr: (text: string) => void }} Io
 *   The imperative shell's one context: every call goes through it, so every
 *   bound is counted in one place. `notes` holds closed tokens for the stderr
 *   summary, never input bytes.
 *
 * @typedef {{ login: string, association: string, body: string, viewerDidAuthor: boolean }} PrComment
 * @typedef {{ login: string, association: string, state: string }} PrReview
 * @typedef {{ number: number, head: string, base: string, body: string, author: string,
 *   isCrossRepository: boolean | undefined, comments: readonly PrComment[],
 *   reviews: readonly PrReview[] }} PrFacts
 *   The one `gh pr view` answer, parsed. Lists are chronological, newest last.
 *
 * @typedef {{ exec?: ExecFn, cwd?: string, now?: () => number, stderr?: (text: string) => void,
 *   formatLine?: (fields: object) => unknown }} MainDeps
 *   Injected by tests only; `formatLine` reaches the output gate.
 *
 * @typedef {{ code: number, stdout: string }} Outcome
 */

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: 'usage' }
 *   | { kind: 'check', what: 'tp' | 'block' | 'exceptions', file: string }
 *   | { kind: 'render', plan: string }
 *   | { kind: 'verify', pr: number, publication: string, evidence: string | null, state: string | null,
 *       blockOut: string | null, commentOut: string | null, staleOut: string | null, approval: boolean }
 *   | { kind: 'splice', pr: number, state: string, block: string, out: string }
 *   | { kind: 'readback', pr: number, expect: string }} ParsedArgs
 */

/** @type {ParsedArgs} */
const USAGE_ARGS = Object.freeze({ kind: 'usage' });

/**
 * Parse `--flag value` pairs and bare switches. Unknown, duplicated or
 * value-less flags, `--flag=value`, positionals and oversize values are all
 * usage errors — never ignored.
 *
 * @param {readonly string[]} tail
 * @param {Readonly<Record<string, 'value' | 'switch'>>} spec
 * @returns {Map<string, string | true> | null}
 */
function parseFlags(tail, spec) {
  /** @type {Map<string, string | true>} */
  const out = new Map();
  for (let i = 0; i < tail.length; i++) {
    const flag = tail[i];
    if (typeof flag !== 'string' || !Object.prototype.hasOwnProperty.call(spec, flag) || out.has(flag)) return null;
    if (spec[flag] === 'switch') {
      out.set(flag, true);
      continue;
    }
    const value = tail[i + 1];
    if (typeof value !== 'string' || value === '' || value.length > MAX_ARG_CHARS || value.includes('\0')) return null;
    if (Object.prototype.hasOwnProperty.call(spec, value)) return null;
    out.set(flag, value);
    i++;
  }
  return out;
}

/**
 * @param {Map<string, string | true>} flags
 * @param {string} name
 * @returns {string | null}
 */
function flagValue(flags, name) {
  const v = flags.get(name);
  return typeof v === 'string' ? v : null;
}

/**
 * @param {string | null} value
 * @returns {number | null}
 */
function parsePr(value) {
  return value !== null && PR_RE.test(value) ? Number(value) : null;
}

/**
 * @param {readonly string[]} argv  process.argv
 * @returns {ParsedArgs}
 */
function parseArgs(argv) {
  const rest = Array.isArray(argv) ? argv.slice(2) : [];
  const sub = rest[0];
  const tail = rest.slice(1);
  if (sub === 'check') {
    if (tail.length !== 2 || !['tp', 'block', 'exceptions'].includes(tail[0])) return USAGE_ARGS;
    const file = tail[1];
    if (typeof file !== 'string' || file === '' || file.startsWith('-') || file.length > MAX_ARG_CHARS) return USAGE_ARGS;
    return { kind: 'check', what: /** @type {'tp' | 'block' | 'exceptions'} */ (tail[0]), file };
  }
  if (sub === 'render') {
    const f = parseFlags(tail, { '--plan': 'value' });
    const plan = f === null ? null : flagValue(f, '--plan');
    return plan === null ? USAGE_ARGS : { kind: 'render', plan };
  }
  if (sub === 'verify') {
    const f = parseFlags(tail, {
      '--pr': 'value', '--publication': 'value', '--evidence': 'value', '--state': 'value',
      '--block-out': 'value', '--comment-out': 'value', '--stale-out': 'value', '--approval': 'switch',
    });
    const pr = f === null ? null : parsePr(flagValue(f, '--pr'));
    if (f === null || pr === null) return USAGE_ARGS;
    return {
      kind: 'verify',
      pr,
      publication: flagValue(f, '--publication') || '',
      evidence: flagValue(f, '--evidence'),
      state: flagValue(f, '--state'),
      blockOut: flagValue(f, '--block-out'),
      commentOut: flagValue(f, '--comment-out'),
      staleOut: flagValue(f, '--stale-out'),
      approval: f.get('--approval') === true,
    };
  }
  if (sub === 'splice') {
    const f = parseFlags(tail, { '--pr': 'value', '--state': 'value', '--block': 'value', '--out': 'value' });
    const pr = f === null ? null : parsePr(flagValue(f, '--pr'));
    if (f === null || pr === null) return USAGE_ARGS;
    const state = flagValue(f, '--state');
    const block = flagValue(f, '--block');
    const out = flagValue(f, '--out');
    return state === null || block === null || out === null ? USAGE_ARGS : { kind: 'splice', pr, state, block, out };
  }
  if (sub === 'readback') {
    const f = parseFlags(tail, { '--pr': 'value', '--expect': 'value' });
    const pr = f === null ? null : parsePr(flagValue(f, '--pr'));
    const expect = f === null ? null : flagValue(f, '--expect');
    return pr === null || expect === null ? USAGE_ARGS : { kind: 'readback', pr, expect };
  }
  return USAGE_ARGS;
}

// ---------------------------------------------------------------------------
// Bounded file I/O
// ---------------------------------------------------------------------------

/**
 * Read a regular file of at most MAX_FILE_BYTES as strict UTF-8, or null. The
 * open adds O_NONBLOCK, so a FIFO put in a file's place cannot block, and the
 * fstat re-checks the opened object. Malformed UTF-8 is refused, not replaced.
 *
 * @param {string} filePath
 * @returns {string | null}
 */
function readTextFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  } catch (_) {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const buf = Buffer.alloc(st.size + 1);
    let total = 0;
    for (let i = 0; i < buf.length; i++) {
      const n = fs.readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
      if (total === buf.length) break;
    }
    if (total > st.size) return null;
    const bytes = buf.subarray(0, total);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes) || text.length > PE.LIMITS.INPUT_CHARS) return null;
    return text;
  } catch (_) {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* the read already decided */ }
  }
}

/**
 * Write `text` to `filePath`, refusing anything that already exists and is not a
 * regular file (a directory, a FIFO, a symlink). Returns whether it was written.
 *
 * @param {string} filePath
 * @param {string} text
 * @returns {boolean}
 */
function writeTextFile(filePath, text) {
  try {
    const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (st !== undefined && !st.isFile()) return false;
    fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isRealDirectory(dir) {
  try {
    const st = fs.lstatSync(dir, { throwIfNoEntry: false });
    return st !== undefined && st.isDirectory();
  } catch (_) {
    return false;
  }
}

/** @param {string} text @returns {string} */
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The first line of `text`, without its line ending.
 *
 * @param {string} text
 * @returns {string}
 */
function firstLine(text) {
  const nl = text.indexOf('\n');
  const line = nl === -1 ? text : text.slice(0, nl);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Strip one trailing line break (`\n` or `\r\n`).
 *
 * @param {string} text
 * @returns {string}
 */
function stripOneNewline(text) {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

// ---------------------------------------------------------------------------
// Subprocess calls (D-VERIFY-IO)
// ---------------------------------------------------------------------------

/** @param {unknown} value @returns {Buffer} */
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.alloc(0);
}

/**
 * @param {'cap' | 'throttled' | 'deadline'} reason
 * @returns {CallResult}
 */
function refusedCall(reason) {
  return { ok: false, status: null, errorCode: null, stdout: Buffer.alloc(0), stderr: '', refused: reason };
}

/**
 * One bounded subprocess call, normalized. The argv array is a fresh copy.
 *
 * @param {Io} io
 * @param {string} file
 * @param {readonly string[]} args
 * @param {number} timeout
 * @param {number} maxBuffer
 * @returns {CallResult}
 */
function runCall(io, file, args, timeout, maxBuffer) {
  const res = io.exec(file, [...args], {
    cwd: io.cwd,
    env: io.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer,
    windowsHide: true,
    shell: false,
  });
  const errorCode = res && res.error ? String(res.error.code || 'EUNKNOWN') : null;
  const status = res && typeof res.status === 'number' ? res.status : null;
  return {
    ok: errorCode === null && status === 0,
    status,
    errorCode,
    stdout: asBuffer(res && res.stdout),
    stderr: asBuffer(res && res.stderr).toString('utf8').slice(0, 4096),
    refused: null,
  };
}

/**
 * Whether a call ran to completion and exited on its own. Only an answered exit
 * is a real "no"; a call that never started, timed out, overflowed or was refused
 * is NOT KNOWING, and never reads as the permissive answer (avoids PF-075).
 *
 * @param {CallResult} r
 * @returns {boolean}
 */
function answered(r) {
  return r.refused === null && r.errorCode === null && r.status !== null;
}

/**
 * D-VERIFY-THROTTLE: a primary or secondary rate limit — HTTP 429, or HTTP 403
 * whose message names a rate limit. A plain 403 (no push access to read a
 * collaborator's permission) is an ordinary refusal, not a throttle.
 *
 * @param {CallResult} r
 * @returns {boolean}
 */
function isThrottle(r) {
  if (r.refused !== null || r.status === 0) return false;
  return /HTTP 429\b/.test(r.stderr) || (/HTTP 403\b/.test(r.stderr) && /rate limit/i.test(r.stderr));
}

/**
 * The time left before the deadline, or 0.
 *
 * @param {Io} io
 * @returns {number}
 */
function remaining(io) {
  return Math.max(0, io.deadline - io.now());
}

/**
 * D-VERIFY-CAPS / D-VERIFY-THROTTLE: every gh call. After a throttle every later
 * gh call is refused (the rate limit stops all calls); past GH_CALLS or the
 * deadline, likewise. A refusal is recorded as a closed note.
 *
 * @param {Io} io
 * @param {readonly string[]} args
 * @param {number} maxBuffer
 * @returns {CallResult}
 */
function gh(io, args, maxBuffer) {
  if (io.budget.throttled) { io.notes.add('throttled'); return refusedCall('throttled'); }
  if (io.budget.ghCalls >= CAPS.GH_CALLS) { io.notes.add('gh-call-cap'); return refusedCall('cap'); }
  const left = remaining(io);
  if (left === 0) { io.notes.add('deadline'); return refusedCall('deadline'); }
  io.budget.ghCalls++;
  const r = runCall(io, 'gh', args, Math.min(GH_TIMEOUT_MS, left), maxBuffer);
  if (isThrottle(r)) {
    io.budget.throttled = true;
    io.notes.add('throttled');
  }
  return r;
}

/**
 * Every git call: `-c core.fsmonitor=false` first, so no repository-configured
 * hook runs, and bounded by the deadline.
 *
 * @param {Io} io
 * @param {readonly string[]} args
 * @param {number} timeout
 * @param {number} maxBuffer
 * @returns {CallResult}
 */
function git(io, args, timeout, maxBuffer) {
  const left = remaining(io);
  if (left === 0) { io.notes.add('deadline'); return refusedCall('deadline'); }
  return runCall(io, 'git', ['-c', 'core.fsmonitor=false', ...args], Math.min(timeout, left), maxBuffer);
}

/**
 * Assert a revision before it reaches git's argv: exactly 40 lowercase hex, so it
 * can never be read as an option. Every caller has already parsed it; this is the
 * precondition held at the sink.
 *
 * @param {string} sha
 * @returns {string}
 */
function rev(sha) {
  if (!PE.SHA_RE.test(sha) || !SHA40_RE.test(sha)) throw new Error('verify-evidence: unchecked revision');
  return sha;
}

/**
 * Assert a login before it reaches gh's argv (an API path segment): LOGIN_RE, so
 * no `/`, `..`, `?` or option can ride on PR data. permissionLookups only ever
 * names such logins; this is that precondition held at the sink.
 *
 * @param {string} login
 * @returns {string}
 */
function loginArg(login) {
  if (typeof login !== 'string' || !PE.LOGIN_RE.test(login)) throw new Error('verify-evidence: unchecked login');
  return login;
}

// ---------------------------------------------------------------------------
// The PR (one gh pr view)
// ---------------------------------------------------------------------------

/**
 * @param {unknown} v
 * @returns {Record<string, unknown>}
 */
function obj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
}

/**
 * @param {unknown} author
 * @returns {string}
 */
function loginOf(author) {
  const login = obj(author).login;
  return typeof login === 'string' && login.length <= 100 ? login : '';
}

/**
 * Parse the `gh pr view --json` answer into PrFacts, or null when it is not the
 * PR that was asked for or a field has the wrong shape. Malformed list entries
 * are kept with empty fields (they then match nothing), so one bad comment cannot
 * hide the rest; each list keeps only its newest CAPS entries.
 *
 * @param {unknown} json
 * @param {number} pr
 * @returns {PrFacts | null}
 */
function parsePrJson(json, pr) {
  const o = obj(json);
  if (o.number !== pr) return null;
  if (typeof o.headRefOid !== 'string' || !SHA40_RE.test(o.headRefOid)) return null;
  if (typeof o.baseRefOid !== 'string' || !SHA40_RE.test(o.baseRefOid)) return null;
  if (typeof o.body !== 'string' || o.body.length > PE.LIMITS.INPUT_CHARS) return null;
  const author = loginOf(o.author);
  if (author === '' || !Array.isArray(o.comments) || !Array.isArray(o.reviews)) return null;
  const comments = o.comments.slice(-CAPS.COMMENTS).map(c => {
    const x = obj(c);
    return Object.freeze({
      login: loginOf(x.author),
      association: typeof x.authorAssociation === 'string' ? x.authorAssociation : '',
      body: typeof x.body === 'string' ? x.body : '',
      viewerDidAuthor: x.viewerDidAuthor === true,
    });
  });
  const reviews = o.reviews.slice(-CAPS.REVIEWS).map(r => {
    const x = obj(r);
    return Object.freeze({
      login: loginOf(x.author),
      association: typeof x.authorAssociation === 'string' ? x.authorAssociation : '',
      state: typeof x.state === 'string' ? x.state : '',
    });
  });
  return Object.freeze({
    number: pr,
    head: o.headRefOid,
    base: o.baseRefOid,
    body: o.body,
    author,
    isCrossRepository: typeof o.isCrossRepository === 'boolean' ? o.isCrossRepository : undefined,
    comments: Object.freeze(comments),
    reviews: Object.freeze(reviews),
  });
}

/**
 * @param {Io} io
 * @param {number} pr
 * @param {string} fields
 * @returns {unknown | null}  the parsed JSON, or null when the call or the parse failed
 */
function prView(io, pr, fields) {
  const r = gh(io, ['pr', 'view', String(pr), '--json', fields], PR_VIEW_MAX_BUFFER);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout.toString('utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * The PR body alone (splice and readback), or null.
 *
 * @param {Io} io
 * @param {number} pr
 * @returns {string | null}
 */
function readBody(io, pr) {
  const body = obj(prView(io, pr, 'body')).body;
  return typeof body === 'string' && body.length <= PE.LIMITS.INPUT_CHARS ? body : null;
}

// ---------------------------------------------------------------------------
// The trust rule's inputs (pr-evidence `trust` / `permissionLookups` decide)
// ---------------------------------------------------------------------------

/**
 * D-VERIFY-VIEWER: VIEWER_LOGIN is the login of the comments GitHub marks
 * `viewerDidAuthor` — asserted server-side, so no extra `gh api user` call. When
 * the viewer has not commented on this PR the viewer arm matches no comment at all
 * (true) and a viewer's review falls back to the association arm, which only
 * narrows trust. Two different logins so marked is impossible, and reads as no
 * viewer.
 *
 * @param {PrFacts} pr
 * @returns {string}
 */
function viewerLogin(pr) {
  const logins = new Set(pr.comments.filter(c => c.viewerDidAuthor && c.login !== '').map(c => c.login));
  return logins.size === 1 ? [...logins][0] : '';
}

/**
 * The comments whose first line is an evidence marker, newest first.
 *
 * @param {PrFacts} pr
 * @returns {PrComment[]}
 */
function markerComments(pr) {
  return pr.comments.filter(c => PE.MARKERS.EVIDENCE_RE.test(firstLine(c.body))).reverse();
}

/**
 * D-VERIFY-APPROVAL (D6): each login's LATEST decisive review — APPROVED,
 * CHANGES_REQUESTED or DISMISSED — in chronological order.
 *
 * @param {PrFacts} pr
 * @returns {Map<string, PrReview>}
 */
function latestDecisiveReviews(pr) {
  /** @type {Map<string, PrReview>} */
  const latest = new Map();
  for (const r of pr.reviews) {
    if (r.login !== '' && DECISIVE_REVIEW_STATES.has(r.state)) {
      latest.delete(r.login);
      latest.set(r.login, r);
    }
  }
  return latest;
}

/**
 * The approvers whose trust decides `approval`: logins other than the PR author
 * whose latest decisive review is APPROVED, most recent first.
 *
 * @param {PrFacts} pr
 * @returns {PrReview[]}
 */
function approvalCandidates(pr) {
  const author = pr.author.toLowerCase();
  return [...latestDecisiveReviews(pr).values()]
    .filter(r => r.state === 'APPROVED' && r.login.toLowerCase() !== author)
    .reverse();
}

/**
 * @typedef {{ ctx: { viewer: string, prAuthor: string, isCrossRepository: boolean | undefined,
 *   permissions: Map<string, string | null> }, refused: Set<string> }} TrustState
 *   `refused` holds logins that permissionLookups named but whose lookup was
 *   refused (throttle, cap, deadline): their trust is UNKNOWN, not "untrusted".
 */

/**
 * Look up the permissions the trust rule needs — ONCE per spawn, for exactly the
 * logins pr-evidence `permissionLookups` names (≤ PERMISSION_LOOKUPS). Only the
 * authors whose trust can matter are offered: evidence-marker comment authors,
 * newest first, then (with --approval) the approval candidates. A 404, a plain 403
 * or an error stores null — untrusted, per the rule.
 *
 * @param {Io} io
 * @param {PrFacts} pr
 * @param {boolean} approval
 * @returns {TrustState}
 */
function resolveTrust(io, pr, approval) {
  /** @type {Map<string, string | null>} */
  const permissions = new Map();
  const ctx = { viewer: viewerLogin(pr), prAuthor: pr.author, isCrossRepository: pr.isCrossRepository, permissions };
  const actors = [
    ...markerComments(pr).map(c => ({ login: c.login, association: c.association })),
    ...(approval ? approvalCandidates(pr).map(r => ({ login: r.login, association: r.association })) : []),
  ];
  /** @type {Set<string>} */
  const refused = new Set();
  for (const login of PE.permissionLookups(actors, ctx)) {
    const r = gh(io, ['api', 'repos/{owner}/{repo}/collaborators/' + loginArg(login) + '/permission', '--jq', '.permission'],
      LINE_MAX_BUFFER);
    if (r.refused !== null || isThrottle(r)) {
      refused.add(login);
      continue;
    }
    const value = r.ok ? r.stdout.toString('utf8').replace(/\n$/, '') : '';
    permissions.set(login, /^[a-z]{1,20}$/.test(value) ? value : null);
  }
  return { ctx, refused };
}

/**
 * @typedef {{ kind: 'none' } | { kind: 'unknown' }
 *   | { kind: 'record', head: string, records: readonly any[], exceptions: readonly any[] }} TrustedRecord
 */

/**
 * D-VERIFY-RECORD: the trusted record is the NEWEST evidence-marker comment whose
 * author passes `trust()`. When that newest trusted comment does not parse there
 * is no record — an older one is never used in its place, because it may carry a
 * pass the newer one withdrew. When a newer marker comment's author could not be
 * looked up (refused), whether IT is the record is unknown, and so is the record.
 *
 * @param {PrFacts} pr
 * @param {TrustState} t
 * @returns {TrustedRecord}
 */
function findTrustedRecord(pr, t) {
  for (const c of markerComments(pr)) {
    const actor = { login: c.login, association: c.association };
    const isViewer = t.ctx.viewer !== '' && c.login === t.ctx.viewer;
    if (!isViewer && t.refused.has(c.login)) return { kind: 'unknown' };
    if (!PE.trust(actor, t.ctx)) continue;
    const parsed = PE.parseEvidenceComment(c.body);
    return parsed.ok
      ? { kind: 'record', head: parsed.value.head, records: parsed.value.records, exceptions: parsed.value.exceptions }
      : { kind: 'none' };
  }
  return { kind: 'none' };
}

/**
 * D-VERIFY-APPROVAL (D6): `yes` when a trusted login other than the PR author has
 * APPROVED as its latest decisive review; otherwise `no` — including when a
 * lookup was refused, which can only withhold a yes.
 *
 * @param {PrFacts} pr
 * @param {TrustState} t
 * @returns {'yes' | 'no'}
 */
function approvalOf(pr, t) {
  for (const r of approvalCandidates(pr)) {
    if (PE.trust({ login: r.login, association: r.association }, t.ctx)) return 'yes';
  }
  return 'no';
}

// ---------------------------------------------------------------------------
// git facts — the head, ancestry, the diff
// ---------------------------------------------------------------------------

/**
 * @typedef {{ head: string, base: string, headResolved: boolean, ancestryUsable: boolean,
 *   ancestry: Map<string, boolean | null>, diffs: Map<string, readonly string[] | null> }} Repo
 */

/**
 * @param {Io} io
 * @param {string} sha
 * @returns {boolean}
 */
function commitResolves(io, sha) {
  const r = git(io, ['rev-parse', '--verify', '--quiet', rev(sha) + '^{commit}'], GIT_LOCAL_TIMEOUT_MS, LINE_MAX_BUFFER);
  return r.ok && r.stdout.toString('utf8').replace(/\n$/, '') === sha;
}

/**
 * @param {Io} io
 * @param {string} refspec  `refs/pull/<n>/head`, or a 40-hex commit
 * @returns {void}
 */
function fetchOrigin(io, refspec) {
  git(io, ['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', 'origin', refspec],
    GIT_FETCH_TIMEOUT_MS, FETCH_MAX_BUFFER);
}

/**
 * Make the PR's commits local and say what can be decided from them.
 *
 * The fetch of refs/pull/<n>/head only adds objects (no ref is written); what it
 * decides is whether headRefOid then RESOLVES — objects are content-addressed, so
 * a head that was already local serves as well as a fetched one.
 *
 * D-VERIFY-BASE-FETCH: the base commit must be local too (see inPr). When it is
 * not — the base branch moved since this clone last fetched — it is fetched by
 * its SHA, once. Unresolvable, it leaves ancestry undecidable (INDETERMINATE).
 *
 * A shallow repository cannot answer ancestry — a truncated history reads "not an
 * ancestor" where the truth is unknown — so ancestry is undecidable there too.
 *
 * @param {Io} io
 * @param {PrFacts} pr
 * @returns {Repo}
 */
function prepareRepo(io, pr) {
  fetchOrigin(io, 'refs/pull/' + pr.number + '/head');
  const headResolved = commitResolves(io, pr.head);
  let ancestryUsable = false;
  if (headResolved) {
    const shallow = git(io, ['rev-parse', '--is-shallow-repository'], GIT_LOCAL_TIMEOUT_MS, LINE_MAX_BUFFER);
    const complete = shallow.ok && shallow.stdout.toString('utf8') === 'false\n';
    let baseResolved = complete && commitResolves(io, pr.base);
    if (complete && !baseResolved) {
      fetchOrigin(io, rev(pr.base));
      baseResolved = commitResolves(io, pr.base);
    }
    ancestryUsable = complete && baseResolved;
  }
  if (!headResolved) io.notes.add('head-unresolved');
  else if (!ancestryUsable) io.notes.add('ancestry-unavailable');
  return { head: pr.head, base: pr.base, headResolved, ancestryUsable, ancestry: new Map(), diffs: new Map() };
}

/**
 * `git merge-base --is-ancestor a b`: true (exit 0), false (exit 1), or null for
 * anything else — an unknown object, a timeout, a refusal.
 *
 * @param {Io} io
 * @param {string} a
 * @param {string} b
 * @returns {boolean | null}
 */
function isAncestor(io, a, b) {
  const r = git(io, ['merge-base', '--is-ancestor', rev(a), rev(b)], GIT_LOCAL_TIMEOUT_MS, LINE_MAX_BUFFER);
  if (!answered(r)) return null;
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

/**
 * D-VERIFY-IN-PR: whether a claim SHA is in the PR — an ancestor-or-equal of the
 * head, and NOT an ancestor-or-equal of merge-base(head, base). Computed as "not
 * an ancestor-or-equal of the BASE", which is the same set: a commit reachable
 * from both head and base is a common ancestor, and every common ancestor is an
 * ancestor-or-equal of some merge base (and each merge base of the base). This
 * form needs no merge-base call and stays exact when there are several merge
 * bases. Memoised per SHA.
 *
 * @param {Io} io
 * @param {Repo} repo
 * @param {string} sha
 * @returns {boolean | null}
 */
function inPr(io, repo, sha) {
  if (!repo.ancestryUsable) return null;
  const memo = repo.ancestry.get(sha);
  if (memo !== undefined) return memo;
  let answer = null;
  const inHead = isAncestor(io, sha, repo.head);
  if (inHead === false) answer = false;
  else if (inHead === true) {
    const inBase = isAncestor(io, sha, repo.base);
    answer = inBase === null ? null : !inBase;
  }
  repo.ancestry.set(sha, answer);
  return answer;
}

/**
 * The paths changed between the claim and the head:
 * `git diff --no-renames --name-only <claim> <head> --`, NUL-separated (`-z`, so
 * no path is C-quoted and missed by a glob), without external diff drivers and
 * with `--no-relative` (a configured `diff.relative` would hide paths outside the
 * cwd). --no-renames reports a rename as its deletion AND its addition, so a file
 * moved into or out of a TP's globs touches it. Memoised per (claim, head); null
 * when git could not answer.
 *
 * @param {Io} io
 * @param {Repo} repo
 * @param {string} claim
 * @returns {readonly string[] | null}
 */
function diffPaths(io, repo, claim) {
  const key = claim + '..' + repo.head;
  const memo = repo.diffs.get(key);
  if (memo !== undefined) return memo;
  const r = git(io, ['diff', '--no-renames', '--no-ext-diff', '--no-relative', '--name-only', '-z',
    rev(claim), rev(repo.head), '--'], GIT_LOCAL_TIMEOUT_MS, DIFF_MAX_BUFFER);
  const paths = r.ok ? Object.freeze(r.stdout.toString('utf8').split('\0').filter(p => p !== '')) : null;
  repo.diffs.set(key, paths);
  return paths;
}

// ---------------------------------------------------------------------------
// CI runs — gh run list, then gh run view --attempt per run
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: number, attempt: number }} RunId
 * @typedef {{ lists: Map<string, readonly RunId[] | null>, views: Map<string, object | null>,
 *   htmlUrl: string | null | undefined }} RunMemo
 */

/** The largest run id kept (15 digits: exact as a JS number, pr-evidence's bound). */
const MAX_RUN_ID = 999999999999999;

/**
 * @param {unknown} v
 * @param {number} lo
 * @param {number} hi
 * @returns {boolean}
 */
function isIntIn(v, lo, hi) {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * D-VERIFY-HTML-URL: the repository's html_url, read once and only when first
 * needed (a ci TP's runs, or a FULL comment). A run's VERIFIED-CI depends on its
 * URL lying under this value, so while it is unresolved no run can be verified:
 * ci TPs then read their runs as unresolved (INDETERMINATE), not as a pass.
 *
 * @param {Io} io
 * @param {RunMemo} memo
 * @returns {string | null}
 */
function htmlUrl(io, memo) {
  if (memo.htmlUrl !== undefined) return memo.htmlUrl;
  const r = gh(io, ['api', 'repos/{owner}/{repo}', '--jq', '.html_url'], LINE_MAX_BUFFER);
  const value = r.ok ? r.stdout.toString('utf8').replace(/\n$/, '') : '';
  memo.htmlUrl = /^\S{1,400}$/.test(value) ? value : null;
  return memo.htmlUrl;
}

/**
 * The runs at a commit: `gh run list --commit <sha> --limit 20`, as run ids and
 * latest attempts. A list of exactly 20 may have been cut, so it is unresolved.
 * Memoised per SHA.
 *
 * @param {Io} io
 * @param {RunMemo} memo
 * @param {string} sha
 * @returns {readonly RunId[] | null}
 */
function listRuns(io, memo, sha) {
  const cached = memo.lists.get(sha);
  if (cached !== undefined) return cached;
  const r = gh(io, ['run', 'list', '--commit', rev(sha), '--json', 'databaseId,attempt,workflowName',
    '--limit', String(PE.LIMITS.RUNS_PER_SHA)], RUN_LIST_MAX_BUFFER);
  /** @type {readonly RunId[] | null} */
  let runs = null;
  if (r.ok) {
    let json = null;
    try { json = JSON.parse(r.stdout.toString('utf8')); } catch (_) { json = null; }
    if (Array.isArray(json) && json.length < PE.LIMITS.RUNS_PER_SHA) {
      const parsed = json.map(e => ({ id: obj(e).databaseId, attempt: obj(e).attempt }));
      const ids = new Set(parsed.map(p => p.id));
      if (parsed.every(p => isIntIn(p.id, 1, MAX_RUN_ID) && isIntIn(p.attempt, 1, 999)) && ids.size === parsed.length) {
        runs = Object.freeze(parsed.map(p => Object.freeze({ id: /** @type {number} */ (p.id), attempt: /** @type {number} */ (p.attempt) }))
          .sort((a, b) => a.id - b.id));
      }
    }
  }
  memo.lists.set(sha, runs);
  return runs;
}

/**
 * One attempt of one run: `gh run view <id> --attempt <n>`. A 404 is an expired
 * run (`expired: true` — INDETERMINATE, never a silent pass). The URL is kept only
 * when it names THIS run (…/actions/runs/<id>, optionally /attempts/<n>);
 * whether it lies under the repository is `classify`'s isRepoLink. The head SHA
 * is kept only as 40 hex. Memoised per (id, attempt); null when unresolved.
 *
 * @param {Io} io
 * @param {RunMemo} memo
 * @param {RunId} run
 * @returns {object | null}
 */
function viewRun(io, memo, run) {
  const key = run.id + '/' + run.attempt;
  if (memo.views.has(key)) return /** @type {object | null} */ (memo.views.get(key));
  if (io.budget.runViews >= CAPS.RUN_VIEWS) {
    io.notes.add('run-view-cap');
    return null;
  }
  io.budget.runViews++;
  const r = gh(io, ['run', 'view', String(run.id), '--attempt', String(run.attempt), '--json',
    'headSha,conclusion,status,url'], RUN_VIEW_MAX_BUFFER);
  /** @type {object | null} */
  let view = null;
  if (r.ok) {
    let json = null;
    try { json = JSON.parse(r.stdout.toString('utf8')); } catch (_) { json = null; }
    const o = obj(json);
    const status = typeof o.status === 'string' && o.status.length <= MAX_TOKEN_CHARS ? o.status : null;
    const conclusion = o.conclusion === null ? null
      : typeof o.conclusion === 'string' && o.conclusion.length <= MAX_TOKEN_CHARS ? o.conclusion : undefined;
    if (status !== null && conclusion !== undefined) {
      const url = typeof o.url === 'string' && o.url.length <= MAX_URL_CHARS
        && (o.url.endsWith('/actions/runs/' + run.id) || o.url.endsWith('/actions/runs/' + run.id + '/attempts/' + run.attempt))
        ? o.url : '';
      const headSha = typeof o.headSha === 'string' && SHA40_RE.test(o.headSha) ? o.headSha : '';
      view = Object.freeze({ id: run.id, attempt: run.attempt, status, conclusion, headSha, url });
    }
  } else if (answered(r) && /HTTP 404\b/.test(r.stderr)) {
    view = Object.freeze({ id: run.id, attempt: run.attempt, expired: true });
  }
  if (r.refused === null) memo.views.set(key, view);
  return view;
}

/**
 * The latest attempt of every run at `sha`, or null when any part is unresolved —
 * the list, any view, or a view budget too small for the whole list (a partial
 * set could hide the one failing run).
 *
 * @param {Io} io
 * @param {RunMemo} memo
 * @param {string} sha
 * @returns {readonly object[] | null}
 */
function runsAt(io, memo, sha) {
  const list = listRuns(io, memo, sha);
  if (list === null) return null;
  const unseen = list.filter(r => !memo.views.has(r.id + '/' + r.attempt)).length;
  if (unseen > CAPS.RUN_VIEWS - io.budget.runViews) {
    io.notes.add('run-view-cap');
    return null;
  }
  const views = [];
  for (const run of list) {
    const v = viewRun(io, memo, run);
    if (v === null) return null;
    views.push(v);
  }
  return Object.freeze(views);
}

// ---------------------------------------------------------------------------
// Plan, claims and exceptions
// ---------------------------------------------------------------------------

/**
 * @typedef {{ plan: { tps: readonly any[] } | null, claims: Map<number, object>, exceptions: readonly any[] | null,
 *   malformed: number }} EvidenceInput
 */

/**
 * Read `--evidence <file>`: its `## Test Plan` (optional; a heading with no TP line
 * is an empty plan — "this change has no test plan" — not an error), `## Claims`
 * (optional; the last valid claim per TP wins) and `## Evidence Exceptions`
 * (optional).
 *
 * @param {string} file
 * @returns {EvidenceInput | null}  null when unusable
 */
function loadEvidence(file) {
  const text = readTextFile(file);
  if (text === null) return null;
  const sections = PE.evidenceSections(text);
  if (!sections.ok) return null;
  let plan = null;
  if (sections.value.testPlan !== null) {
    const p = PE.parsePlan(sections.value.testPlan);
    if (p.ok) plan = p.value;
    else if (p.error.code === 'empty') plan = { tps: [] };
    else return null;
  }
  const claims = PE.parseClaims(sections.value.claims === null ? '' : sections.value.claims);
  if (!claims.ok) return null;
  let exceptions = null;
  if (sections.value.exceptions !== null) {
    const e = PE.parseExceptions(sections.value.exceptions);
    if (!e.ok) return null;
    exceptions = e.value;
  }
  return { plan, claims: claims.value.tp, exceptions, malformed: claims.value.malformed };
}

/**
 * The plan when it comes from the PR body: the test-plan block's TP lines.
 * No block is an empty plan; a malformed or counts-only block cannot serve as a
 * plan (its TP text is not there) — null, input unusable.
 *
 * @param {string} body
 * @returns {{ tps: readonly any[] } | null}
 */
function bodyPlan(body) {
  const found = PE.findBlock(body);
  if (!found.ok) return null;
  if (found.value === null) return { tps: [] };
  const parsed = PE.parseBlock(found.value);
  if (!parsed.ok || parsed.value.kind !== 'lines') return null;
  return parsed.value.plan;
}

/**
 * D-VERIFY-RECORD: a trusted record's line as a claim. A record is a VERDICT, and
 * only some verdicts fix the claim's outcome:
 *   VERIFIED-CI, ATTESTED-LOCAL ⇒ PASS        FAILED ⇒ FAIL
 *   sha:none                    ⇒ no claim
 *   anything else (STALE, INDETERMINATE, UNVERIFIED with a SHA) ⇒ an outcome the
 *     record cannot tell. It is classified with a FAIL placeholder — which can
 *     never reach a verified state — and the verdict is kept only when it is
 *     UNVERIFIED, INDETERMINATE or STALE; anything the placeholder alone decided
 *     reads UNVERIFIED. So such a TP can go STALE (and be re-verified) or wait on
 *     an unresolved fact, but only a NEW claim can make it pass or fail.
 *
 * @param {any} record  a parseEvidenceComment TpRecord
 * @returns {{ claim: object, unknownOutcome: boolean } | null}
 */
function recordClaim(record) {
  if (record.sha === null) return null;
  const known = record.state === 'VERIFIED-CI' || record.state === 'ATTESTED-LOCAL' ? 'PASS'
    : record.state === 'FAILED' ? 'FAIL' : null;
  return {
    claim: Object.freeze({
      target: 'TP-' + record.id,
      tp: record.id,
      gate: null,
      outcome: known === null ? 'FAIL' : known,
      sha: record.sha,
      by: 'test',
      exit: record.exit,
    }),
    unknownOutcome: known === null,
  };
}

// ---------------------------------------------------------------------------
// Classification — gather lazily, in ladder order; `classify` decides
// ---------------------------------------------------------------------------

/**
 * @typedef {{ tp: any, hash: string, recorded: boolean, claim: object | null, unknownOutcome: boolean,
 *   textMatches: boolean | undefined, forceIndeterminate: boolean }} TpInput
 *   `recorded`: the trusted record carries this TP with the same text hash.
 */

/**
 * The facts for one TP, gathered in the order `classify` consults them and no
 * further than the first arm that can already decide: nothing past a missing or
 * SKIP claim, a text mismatch or an unresolved head; nothing past an ancestry
 * answer other than "in the PR". Stopping early can only leave a fact absent,
 * and an absent fact reads unresolved — never a pass.
 *
 * @param {Io} io
 * @param {Repo} repo
 * @param {RunMemo} memo
 * @param {TpInput} x
 * @returns {object}
 */
function gatherFacts(io, repo, memo, x) {
  const claim = /** @type {any} */ (x.claim);
  /** @type {Record<string, unknown>} */
  const facts = { claim, head: repo.headResolved ? repo.head : null, inPr: null };
  if (x.textMatches !== undefined) facts.textMatches = x.textMatches;
  if (claim === null || claim.outcome === 'SKIP' || x.textMatches === false || !repo.headResolved) return facts;
  facts.inPr = inPr(io, repo, claim.sha);
  if (facts.inPr !== true) return facts;
  if (claim.sha !== repo.head && x.tp.files.length > 0) facts.diff = diffPaths(io, repo, claim.sha);
  if (x.tp.method === 'ci') {
    const url = htmlUrl(io, memo);
    facts.verifyingSha = claim.sha;
    if (url === null) facts.runs = null;
    else {
      facts.htmlUrl = url;
      facts.runs = runsAt(io, memo, claim.sha);
    }
  }
  return facts;
}

/**
 * D-VERIFY-VERIFYING-SHA: a ci claim is verified by the runs at its own SHA. When
 * that SHA has no runs at all — a commit that was never a pushed tip — and the
 * change since does not touch the TP (so `classify` answered ATTESTED-LOCAL with
 * run:none), the head's runs are consulted instead, as §3.3 allows. The head's
 * answer replaces the first only when the head's runs resolved.
 *
 * @param {Io} io
 * @param {Repo} repo
 * @param {RunMemo} memo
 * @param {TpInput} x
 * @returns {{ state: string, sha: string | null, run: any, exit: number | null }}
 */
function classifyTp(io, repo, memo, x) {
  if (x.forceIndeterminate) {
    const claim = /** @type {any} */ (x.claim);
    return { state: 'INDETERMINATE', sha: claim === null ? null : claim.sha, run: null, exit: claim === null ? null : claim.exit };
  }
  const facts = gatherFacts(io, repo, memo, x);
  let verdict = PE.classify(x.tp, facts);
  const claim = /** @type {any} */ (x.claim);
  if (x.tp.method === 'ci' && verdict.state === 'ATTESTED-LOCAL' && verdict.run === 'none' && claim.sha !== repo.head) {
    const headRuns = runsAt(io, memo, repo.head);
    if (headRuns !== null) verdict = PE.classify(x.tp, { ...facts, verifyingSha: repo.head, runs: headRuns });
  }
  if (x.unknownOutcome && !['UNVERIFIED', 'INDETERMINATE', 'STALE'].includes(verdict.state)) {
    return { state: 'UNVERIFIED', sha: verdict.sha, run: null, exit: verdict.exit };
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/**
 * @param {string} publication
 * @returns {'full' | 'off' | 'stub'}
 */
function publicationMode(publication) {
  // D-VERIFY-PUBLICATION (D4): `full` ⇒ FULL, `off` ⇒ no comment, anything else —
  // `auto` included — ⇒ STUB. No second visibility probe is made here.
  if (publication === 'full') return 'full';
  if (publication === 'off') return 'off';
  return 'stub';
}

/**
 * The claims, hashes and text checks for every TP of the plan (D-VERIFY-RECORD):
 * a file claim wins; else the trusted record's, when the record's `h:` equals the
 * TP's hash. A body-sourced TP's text counts only when that hash matches. Null when
 * a TP line fails its grammar (the hash is refused).
 *
 * @param {{ tps: readonly any[] }} plan
 * @param {EvidenceInput | null} evidence
 * @param {TrustedRecord} record
 * @param {boolean} fromFile
 * @returns {TpInput[] | null}
 */
function tpInputs(plan, evidence, record, fromFile) {
  const recordById = recordsById(record);
  /** @type {TpInput[]} */
  const inputs = [];
  for (const tp of plan.tps) {
    const hash = PE.tpHash(tp, sha256);
    if (!hash.ok) return null;
    const rec = recordById.get(tp.id);
    const recordApplies = rec !== undefined && rec.hash === hash.value;
    const fileClaim = evidence === null ? undefined : evidence.claims.get(tp.id);
    const fromRecord = recordApplies ? recordClaim(rec) : null;
    inputs.push({
      tp,
      hash: hash.value,
      recorded: recordApplies,
      claim: fileClaim !== undefined ? fileClaim : fromRecord === null ? null : fromRecord.claim,
      unknownOutcome: fileClaim === undefined && fromRecord !== null && fromRecord.unknownOutcome,
      textMatches: fromFile ? undefined : recordApplies,
      // D-VERIFY-THROTTLE: when the record itself is unknown, so is every claim or
      // text check that would have come from it.
      forceIndeterminate: record.kind === 'unknown' && (!fromFile || fileClaim === undefined),
    });
  }
  return inputs;
}

/**
 * @param {TrustedRecord} record
 * @returns {Map<number, any>}
 */
function recordsById(record) {
  return new Map(record.kind === 'record' ? record.records.map(r => [r.id, r]) : []);
}

/**
 * The body update: the block (or its counts-only form, D-SPLICE) spliced into the
 * body. When it cannot be spliced — malformed markers, oversize even as counts —
 * the body reads `changed`, so the caller runs `splice`, which names the refusal.
 * Null when a block fails to render.
 *
 * @param {Io} io
 * @param {{ tps: readonly any[] }} plan
 * @param {any} ev
 * @param {string} body
 * @returns {{ blockText: string, changed: boolean } | null}
 */
function bodyUpdate(io, plan, ev, body) {
  if (plan.tps.length === 0) return { blockText: '', changed: false };
  const full = PE.render(plan, ev, 'block');
  const counts = PE.render(plan, ev, 'counts');
  if (!full.ok || !counts.ok) return null;
  const fit = PE.spliceFit(body, [full.value.text, counts.value.text]);
  if (fit.ok) {
    return { blockText: fit.value.index === 0 ? full.value.text : counts.value.text, changed: fit.value.body !== body };
  }
  io.notes.add('body-' + fit.error.code);
  return { blockText: fit.error.code === 'oversize' ? counts.value.text : full.value.text, changed: true };
}

/**
 * The comment (D-VERIFY-PUBLICATION) and whether it is already posted: only the
 * viewer's own comment whose first line is this exact marker (head and key)
 * counts, so a spoofed marker never suppresses a post. `off`, or nothing to
 * record, is no comment (`n/a`). Null when it fails to render.
 *
 * @param {{ tps: readonly any[] }} plan
 * @param {any} ev
 * @param {'full' | 'off' | 'stub'} mode
 * @param {PrFacts} pr
 * @returns {{ text: string, posted: 'yes' | 'no' | 'n/a' } | null}
 */
function commentUpdate(plan, ev, mode, pr) {
  if (mode === 'off' || (ev.records.length === 0 && ev.exceptions.length === 0)) return { text: '', posted: 'n/a' };
  const rendered = PE.render(plan, ev, mode);
  if (!rendered.ok) return null;
  const marker = firstLine(rendered.value.text);
  const posted = pr.comments.some(c => c.viewerDidAuthor && firstLine(c.body) === marker) ? 'yes' : 'no';
  return { text: rendered.value.text, posted };
}

/**
 * --stale-out: only STALE TPs whose text hash equals the trusted record's — text a
 * trusted author already published, never unrecorded PR text (containment).
 *
 * @param {readonly TpInput[]} inputs
 * @param {readonly { state: string }[]} records
 * @returns {string}
 */
function staleOutText(inputs, records) {
  const lines = inputs.filter((x, i) => records[i].state === 'STALE' && x.recorded).map(x => x.tp.line);
  return lines.length === 0 ? '' : ['## Test Plan', ...lines].join('\n') + '\n';
}

/**
 * Write every requested output, or report that one failed (nothing is printed then).
 *
 * @param {Extract<ParsedArgs, { kind: 'verify' }>} args
 * @param {string} body
 * @param {string} blockText
 * @param {string} commentText
 * @param {string} staleText
 * @returns {boolean}
 */
function writeOutputs(args, body, blockText, commentText, staleText) {
  /** @type {Array<[string | null, string]>} */
  const writes = [
    [args.state === null ? null : path.join(args.state, 'base'), body],
    [args.state === null ? null : path.join(args.state, 'base.sha256'), sha256(body) + '\n'],
    [args.blockOut, blockText === '' ? '' : blockText + '\n'],
    [args.commentOut, commentText === '' ? '' : commentText + '\n'],
    [args.staleOut, staleText],
  ];
  return writes.every(([file, text]) => file === null || writeTextFile(file, text));
}

/**
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'verify' }>} args
 * @param {MainDeps} deps
 * @returns {Outcome}
 */
function runVerify(io, args, deps) {
  // Inputs first: an unusable evidence file or state directory decides before any call.
  /** @type {EvidenceInput | null} */
  let evidence = null;
  if (args.evidence !== null) {
    evidence = loadEvidence(args.evidence);
    if (evidence === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'evidence file unusable');
    if (evidence.malformed > 0) io.notes.add('malformed-claims');
  }
  if (args.state !== null && !isRealDirectory(args.state)) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'state directory unusable');

  const pr = parsePrJson(prView(io, args.pr, PR_FIELDS), args.pr);
  if (pr === null) return refuse(io, EXIT_CODES.REMOTE_FAILURE, 'the PR could not be read');

  const trust = resolveTrust(io, pr, args.approval);
  const record = findTrustedRecord(pr, trust);
  if (record.kind === 'unknown') io.notes.add('record-unknown');

  // D-VERIFY-RECORD: the plan is the evidence file's when it has one (local text),
  // else the PR body's block — whose TP text counts only where its hash equals the
  // trusted record's.
  const fromFile = evidence !== null && evidence.plan !== null;
  const plan = fromFile ? /** @type {any} */ (evidence).plan : bodyPlan(pr.body);
  if (plan === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'the PR body test-plan block cannot serve as the plan');
  const inputs = tpInputs(plan, evidence, record, fromFile);
  if (inputs === null) return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'a TP line failed its grammar');

  const repo = prepareRepo(io, pr);
  /** @type {RunMemo} */
  const memo = { lists: new Map(), views: new Map(), htmlUrl: undefined };
  const records = inputs.map(x => {
    const v = classifyTp(io, repo, memo, x);
    return Object.freeze({ id: x.tp.id, state: v.state, sha: v.sha, run: v.run, exit: v.exit, hash: x.hash });
  });

  const exceptions = evidence !== null && evidence.exceptions !== null ? evidence.exceptions
    : record.kind === 'record' ? record.exceptions : [];
  const key = PE.dedupeKey({ records, exceptions }, sha256);
  const tally = PE.tally(records.map(r => r.state));
  if (!key.ok || !tally.ok) return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the records failed their grammar');

  const mode = publicationMode(args.publication);
  const ev = {
    head: pr.head,
    key: key.value,
    htmlUrl: mode === 'full' && records.length > 0 ? htmlUrl(io, memo) || '' : '',
    records,
    exceptions,
  };
  const body = bodyUpdate(io, plan, ev, pr.body);
  const comment = commentUpdate(plan, ev, mode, pr);
  if (body === null || comment === null) return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the block or the comment failed to render');

  const line = gateEvidenceLine(deps, {
    pr: pr.number,
    head: pr.head,
    total: tally.value.total,
    counts: { ...tally.value.counts },
    stale: records.filter(r => r.state === 'STALE').map(r => r.id),
    exceptions: PE.EXCEPTION_KINDS.filter(k => exceptions.some(e => e.kind === k)),
    approval: args.approval ? approvalOf(pr, trust) : 'unchecked',
    key: key.value,
    posted: comment.posted,
    body: body.changed ? 'changed' : 'same',
  }, plan.tps.length);
  if (line === null) return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the EVIDENCE line failed its gate');

  if (!writeOutputs(args, pr.body, body.blockText, comment.text, staleOutText(inputs, records))) {
    return refuse(io, EXIT_CODES.WRITE_FAILED, 'an output file could not be written');
  }
  return { code: EXIT_CODES.OK, stdout: line + '\n' };
}

/**
 * THE GATE on the EVIDENCE line: it must format (counts sum to total, `stale`
 * lists exactly the STALE ids ascending, kinds in vocabulary order), re-parse to
 * the identical line, and carry the plan's TP count as its total.
 *
 * @param {MainDeps} deps
 * @param {object} fields
 * @param {number} total
 * @returns {string | null}
 */
function gateEvidenceLine(deps, fields, total) {
  let formatted;
  try {
    formatted = typeof deps.formatLine === 'function' ? deps.formatLine(fields) : PE.formatEvidenceLine(fields);
  } catch (_) {
    return null;
  }
  const f = /** @type {any} */ (formatted);
  const line = typeof f === 'string' ? f : f !== null && typeof f === 'object' && f.ok === true ? f.value : null;
  if (typeof line !== 'string') return null;
  const parsed = PE.parseEvidenceLine(line);
  return parsed.ok && parsed.value.total === total ? line : null;
}

// ---------------------------------------------------------------------------
// splice — the compare-and-swap (D-VERIFY-CAS, applies ADR-023 and ADR-024)
// ---------------------------------------------------------------------------

/**
 * D-VERIFY-CAS: re-read the body. Equal to verify's snapshot ⇒ splice the block
 * into it (`ok`). Different ⇒ splice once onto the fresh body and re-read: still
 * the same ⇒ `resplice`; changed again ⇒ `conflict` and no output. Only the bytes
 * between the markers are devflow's. GitHub has no conditional body edit, so an
 * edit landing between the last read and `gh pr edit` is still overwritten (it
 * stays in the PR's edit history); the read-back proves only our bytes landed.
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'splice' }>} args
 * @returns {Outcome}
 */
function runSplice(io, args) {
  if (!isRealDirectory(args.state)) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'state directory unusable');
  const base = readTextFile(path.join(args.state, 'base'));
  const recorded = readTextFile(path.join(args.state, 'base.sha256'));
  if (base === null || recorded === null || recorded !== sha256(base) + '\n') {
    return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'the body snapshot is missing or does not match its hash');
  }
  const blockFile = readTextFile(args.block);
  if (blockFile === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'block file unusable');
  const block = stripOneNewline(blockFile);

  const first = readBody(io, args.pr);
  if (first === null) return refuse(io, EXIT_CODES.REMOTE_FAILURE, 'the PR body could not be read');
  const spliced = PE.splice(first, block);
  if (!spliced.ok) return spliceOutcome(spliced.error.code === 'oversize' ? 'oversize' : 'malformed');
  if (spliced.value.length > PE.LIMITS.BODY_CHARS) return spliceOutcome('oversize');
  let outcome = 'ok';
  if (first !== base) {
    const second = readBody(io, args.pr);
    if (second === null) return refuse(io, EXIT_CODES.REMOTE_FAILURE, 'the PR body could not be re-read');
    if (second !== first) return spliceOutcome('conflict');
    outcome = 'resplice';
  }
  if (!writeTextFile(args.out, spliced.value)) return refuse(io, EXIT_CODES.WRITE_FAILED, 'the body file could not be written');
  return spliceOutcome(outcome);
}

/**
 * @param {string} outcome
 * @returns {Outcome}
 */
function spliceOutcome(outcome) {
  const code = outcome === 'ok' || outcome === 'resplice' ? EXIT_CODES.OK : EXIT_CODES.OUTPUT_GATE_REFUSED;
  return { code, stdout: 'SPLICE ' + outcome + '\n' };
}

/**
 * readback: the body equals the expected file after normalising one trailing
 * newline on each side.
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'readback' }>} args
 * @returns {Outcome}
 */
function runReadback(io, args) {
  const expected = readTextFile(args.expect);
  if (expected === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'expected-body file unusable');
  const body = readBody(io, args.pr);
  if (body === null) return refuse(io, EXIT_CODES.REMOTE_FAILURE, 'the PR body could not be read');
  return stripOneNewline(body) === stripOneNewline(expected)
    ? { code: EXIT_CODES.OK, stdout: 'READBACK ok\n' }
    : { code: EXIT_CODES.OUTPUT_GATE_REFUSED, stdout: 'READBACK mismatch\n' };
}

// ---------------------------------------------------------------------------
// check and render — no subprocess at all
// ---------------------------------------------------------------------------

/**
 * The text a plan or exceptions check reads: the named section of an evidence
 * file, or the whole file when it has no such section.
 *
 * @param {string} text
 * @param {'testPlan' | 'exceptions'} section
 * @returns {string}
 */
function sectionOrWhole(text, section) {
  const s = PE.evidenceSections(text);
  return s.ok && s.value[section] !== null ? /** @type {string} */ (s.value[section]) : text;
}

/**
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'check' }>} args
 * @returns {Outcome}
 */
function runCheck(io, args) {
  const text = readTextFile(args.file);
  if (text === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'file unusable');
  let result;
  if (args.what === 'tp') result = PE.parsePlan(sectionOrWhole(text, 'testPlan'));
  else if (args.what === 'exceptions') result = PE.parseExceptions(sectionOrWhole(text, 'exceptions'));
  else {
    const b = PE.parseBlock(text);
    // R7 pastes only the creation form: TP lines, none ticked.
    result = b.ok && (b.value.kind !== 'lines' || b.value.ticked.length > 0) ? { ok: false, error: { code: 'invalid', line: 0 } } : b;
  }
  if (result.ok) return { code: EXIT_CODES.OK, stdout: '' };
  io.stderr('verify-evidence: check ' + args.what + ': ' + result.error.code
    + (result.error.line > 0 ? ' at line ' + result.error.line : '') + '\n');
  return { code: EXIT_CODES.OUTPUT_GATE_REFUSED, stdout: '' };
}

/**
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'render' }>} args
 * @returns {Outcome}
 */
function runRender(io, args) {
  const text = readTextFile(args.plan);
  if (text === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'plan file unusable');
  const plan = PE.parsePlan(sectionOrWhole(text, 'testPlan'));
  if (!plan.ok) {
    return refuse(io, EXIT_CODES.INPUT_UNUSABLE, 'the plan failed its grammar (' + plan.error.code
      + (plan.error.line > 0 ? ' at line ' + plan.error.line : '') + ')');
  }
  const block = PE.render(plan.value, null, 'create');
  if (!block.ok) return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the block failed to render');
  return { code: EXIT_CODES.OK, stdout: block.value.text + '\n' };
}

// ---------------------------------------------------------------------------
// main — returns {code, stdout}; never calls process.exit
// ---------------------------------------------------------------------------

/**
 * A refusal: a closed diagnostic on stderr, nothing on stdout.
 *
 * @param {Io} io
 * @param {number} code
 * @param {string} reason  a fixed phrase from this file, never input bytes
 * @returns {Outcome}
 */
function refuse(io, code, reason) {
  io.stderr('verify-evidence: ' + reason + '\n');
  return { code, stdout: '' };
}

/**
 * The environment every subprocess gets: the caller's, with prompts disabled and
 * the variables that would colour or reshape gh/git output removed.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv() {
  const env = Object.assign({}, process.env, {
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    NO_COLOR: '1',
  });
  delete env.GH_FORCE_TTY;
  delete env.CLICOLOR_FORCE;
  return env;
}

/**
 * The production exec: spawnSync, read off the module object at call time.
 *
 * @type {ExecFn}
 */
function defaultExec(file, args, opts) {
  return childProcess.spawnSync(file, args, /** @type {any} */ (opts));
}

/**
 * @param {readonly string[]} argv  process.argv
 * @param {MainDeps} [deps]
 * @returns {Outcome}
 */
function main(argv, deps) {
  const d = deps || {};
  const now = typeof d.now === 'function' ? d.now : Date.now;
  /** @type {Io} */
  const io = {
    exec: typeof d.exec === 'function' ? d.exec : defaultExec,
    env: childEnv(),
    cwd: typeof d.cwd === 'string' ? d.cwd : process.cwd(),
    now,
    deadline: now() + DEADLINE_MS,
    budget: { ghCalls: 0, runViews: 0, throttled: false },
    notes: new Set(),
    stderr: typeof d.stderr === 'function' ? d.stderr : (text => { process.stderr.write(text); }),
  };
  const args = parseArgs(argv);
  if (args.kind === 'usage') {
    io.stderr(USAGE + '\n');
    return { code: EXIT_CODES.USAGE, stdout: '' };
  }
  /** @type {Outcome} */
  let outcome;
  try {
    if (args.kind === 'check') outcome = runCheck(io, args);
    else if (args.kind === 'render') outcome = runRender(io, args);
    else if (args.kind === 'verify') outcome = runVerify(io, args, d);
    else if (args.kind === 'splice') outcome = runSplice(io, args);
    else outcome = runReadback(io, args);
  } catch (err) {
    // An injected exec that throws, or a broken invariant (rev): no verdict.
    outcome = refuse(io, EXIT_CODES.REMOTE_FAILURE, 'internal error (' + errorLabel(err) + ')');
  }
  if (io.notes.size > 0) io.stderr('verify-evidence: notes: ' + [...io.notes].sort().join(',') + '\n');
  return outcome;
}

/**
 * A short, safe label for a thrown value — its class name, never its message (a
 * message can quote input bytes).
 *
 * @param {unknown} err
 * @returns {string}
 */
function errorLabel(err) {
  const e = /** @type {any} */ (err);
  return (e && typeof e.name === 'string' ? e.name : 'unknown').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
}

/**
 * D-VERIFY-STDOUT: settle whatever main() returned into what the boundary may
 * print. The code must be a known exit code and stdout must be empty or one of
 * the closed shapes for that code; anything else prints nothing and exits 4.
 *
 * @param {unknown} outcome
 * @returns {Outcome}
 */
function settleOutcome(outcome) {
  const o = /** @type {any} */ (outcome);
  const failed = { code: EXIT_CODES.REMOTE_FAILURE, stdout: '' };
  if (o === null || typeof o !== 'object' || typeof o.stdout !== 'string') return failed;
  if (!Object.values(EXIT_CODES).includes(o.code)) return failed;
  if (o.code === EXIT_CODES.USAGE || o.stdout === '') return { code: o.code, stdout: '' };
  if (!o.stdout.endsWith('\n')) return failed;
  const text = o.stdout.slice(0, -1);
  const splice = SPLICE_LINE_RE.exec(text);
  if (splice !== null && splice.groups !== undefined) {
    const passing = splice.groups.outcome === 'ok' || splice.groups.outcome === 'resplice';
    return o.code === (passing ? EXIT_CODES.OK : EXIT_CODES.OUTPUT_GATE_REFUSED) ? { code: o.code, stdout: o.stdout } : failed;
  }
  const readback = READBACK_LINE_RE.exec(text);
  if (readback !== null && readback.groups !== undefined) {
    const passing = readback.groups.outcome === 'ok';
    return o.code === (passing ? EXIT_CODES.OK : EXIT_CODES.OUTPUT_GATE_REFUSED) ? { code: o.code, stdout: o.stdout } : failed;
  }
  if (o.code !== EXIT_CODES.OK) return failed;
  if (PE.parseEvidenceLine(text).ok) return { code: o.code, stdout: o.stdout };
  const block = PE.parseBlock(text);
  if (block.ok && block.value.kind === 'lines' && block.value.ticked.length === 0 && !text.includes('\r')) {
    return { code: o.code, stdout: o.stdout };
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Top-level boundary — the ONLY stdout write and exitCode assignment
// ---------------------------------------------------------------------------

if (require.main === module) {
  let outcome;
  try {
    outcome = main(process.argv);
  } catch (err) {
    process.stderr.write('verify-evidence: internal error (' + errorLabel(err) + ')\n');
    outcome = { code: EXIT_CODES.REMOTE_FAILURE, stdout: '' };
  }
  const settled = settleOutcome(outcome);
  if (settled.stdout !== '') process.stdout.write(settled.stdout);
  process.exitCode = settled.code;
}

// ---------------------------------------------------------------------------
// Exports — the unit tests are the consumers
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  EXIT_CODES,
  CAPS,
  PR_FIELDS,
  main,
  settleOutcome,
});
