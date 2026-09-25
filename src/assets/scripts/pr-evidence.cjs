// src/assets/scripts/pr-evidence.cjs
//
// The PURE core of PR test-plan evidence: the TP-line, claim, exception and
// EVIDENCE-line grammars, the marker literals, the state ladder, rendering, the
// CRLF-aware body splice, the tally, the link check and the one implementation of
// the trust rule. Installed as a top-level sibling of redact-secrets.cjs under
// ~/.devflow/scripts/ and required by verify-evidence.cjs, which performs every
// read and every write; this module has no command line of its own.
//
// Design constraints (binding):
//   - D-EVIDENCE-PURE: nothing is required and `process` is never named. No file,
//     network, subprocess, clock or environment is reached; the one hash this
//     module needs (sha256) is injected by the caller. A source guard and a
//     sandboxed load in the test suite hold this.
//   - Every fallible function returns a Result — {ok: true, value} or {ok: false,
//     error: {code, line}} — and never throws. An error carries a code from
//     ERROR_CODES and a 1-based line number only, never a byte of its input, so a
//     caller can print it without echoing hostile text.
//   - Every loop is bounded by an input already capped in LIMITS.
//   - Every exported RegExp is frozen and non-global, so no caller can share or
//     corrupt lastIndex state.

'use strict';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** @typedef {'VERIFIED-CI' | 'ATTESTED-LOCAL' | 'UNVERIFIED' | 'STALE' | 'FAILED' | 'INDETERMINATE'} State */
/** @typedef {'ci' | 'local' | 'manual'} Method */
/** @typedef {'PASS' | 'FAIL' | 'SKIP'} Outcome */
/** @typedef {'ticket-link' | 'test-plan'} ExceptionKind */
/** @typedef {'oversize' | 'malformed' | 'empty' | 'order' | 'duplicate' | 'mismatch' | 'invalid'} ErrorCode */

/** The six TP states, closed. The contract's `States (closed)` list is pinned to this order. */
const STATES = Object.freeze(/** @type {State[]} */ ([
  'VERIFIED-CI', 'ATTESTED-LOCAL', 'UNVERIFIED', 'STALE', 'FAILED', 'INDETERMINATE',
]));

/** The only states that count as verified. */
const VERIFIED_STATES = Object.freeze(/** @type {State[]} */ (['VERIFIED-CI', 'ATTESTED-LOCAL']));

/** How a TP is verified: the CI suite, a local command's exit code, or observed manual steps. */
const METHODS = Object.freeze(/** @type {Method[]} */ (['ci', 'local', 'manual']));

/** Every evidence-exception kind, in the order the EVIDENCE line lists them. */
const EXCEPTION_KINDS = Object.freeze(/** @type {ExceptionKind[]} */ (['ticket-link', 'test-plan']));

/**
 * D-CAPS: every bound, by name.
 *   TP_MAX / AC_MAX         highest TP number and AC number a line may cite
 *   SCENARIO_MAX            scenario length, in code points
 *   GLOB_MAX / GLOBS_PER_LINE  one glob's length; globs on one TP line
 *   CLAIM_LINES             claim lines read — the LAST ones (append-only, newest wins)
 *   COMMENT_LINES           lines read from an evidence comment
 *   BODY_CHARS              a PR body after the splice; over it the block becomes counts only
 *   FULL_COMMENT_CHARS      a FULL evidence comment; over it the comment is a STUB
 *   INPUT_CHARS             any text a parser accepts at all
 *   PATH_CHARS / DIFF_FILES a diff path, and the diff paths, a glob is matched against
 *   RUNS_PER_SHA            runs at one SHA (`gh run list --limit 20`)
 *   TRUST_LOOKUPS           permission lookups per spawn
 */
const LIMITS = Object.freeze({
  TP_MAX: 200,
  AC_MAX: 999,
  SCENARIO_MAX: 200,
  GLOB_MAX: 120,
  GLOBS_PER_LINE: 10,
  CLAIM_LINES: 400,
  COMMENT_LINES: 1000,
  BODY_CHARS: 60000,
  FULL_COMMENT_CHARS: 55000,
  INPUT_CHARS: 1048576,
  PATH_CHARS: 4096,
  DIFF_FILES: 5000,
  RUNS_PER_SHA: 20,
  TRUST_LOOKUPS: 20,
});

/**
 * D-MARKERS: the ONLY home of the marker literals. Every other site builds a
 * marker from these fields, and a source guard holds that no literal appears
 * outside this object. The block markers bracket the PR body's test-plan block;
 * the evidence marker is the first line of an evidence comment.
 */
const MARKERS = Object.freeze({
  BLOCK_START: '<!-- devflow:test-plan -->',
  BLOCK_END: '<!-- /devflow:test-plan -->',
  EVIDENCE_OPEN: '<!-- devflow:evidence',
  EVIDENCE_RE: Object.freeze(/^<!-- devflow:evidence head:(?<head>[0-9a-f]{40}) key:(?<key>[0-9a-f]{12}) -->$/),
});

// ---------------------------------------------------------------------------
// Grammars
// ---------------------------------------------------------------------------

/** A git object name as this module accepts one: 7–40 lowercase hex, so never an option. */
const SHA_RE = Object.freeze(/^[0-9a-f]{7,40}$/);

/** A full 40-hex SHA. */
const SHA40_RE = /^[0-9a-f]{40}$/;

/** One `files:` glob: the class and bound the contract states. */
const GLOB_RE = Object.freeze(/^[A-Za-z0-9._/*?-]{1,120}$/);

/** A GitHub login: an alphanumeric, then up to 38 alphanumerics or hyphens. */
const LOGIN_RE = Object.freeze(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/);

/**
 * D-TP-LINE: one test-plan line, as `_plan_contract.mds` define `test_plan_line()`
 * states it (parity-pinned by tests/evidence/contract-parity.test.ts):
 *   - [ ] TP-<n> (AC-<m>) <scenario> — method:<ci|local|manual>[ [files: <glob>[, <glob>…]]]
 * <n> 1–200, <m> 1–999, no leading zeros. The scenario is 1–200 printable code
 * points (no Unicode control, format, surrogate, private-use, unassigned or
 * line/paragraph-separator character) with no leading or trailing space, no `<`,
 * `>`, backtick, `[`, `]`, `#`, `@` or `/`, and never the text ` — method:`. The
 * per-character lookahead keeps the scan linear.
 *
 * D-TP-SCENARIO: the scenario is pasted into the PR body, so it admits none of
 * the characters an issue reference (`#12`, `o/r#12`, a full issue URL), a closing
 * keyword's target, an @-mention, markup or a code span needs — the same exclusions
 * the exception reason carries. A path belongs in `files:`, whose glob class keeps
 * `/` and admits no `#` or `@`.
 */
const TP_LINE_RE = Object.freeze(/^- \[ \] TP-(?<n>200|1[0-9]{2}|[1-9][0-9]?) \(AC-(?<ac>[1-9][0-9]{0,2})\) (?<scenario>(?! )(?:(?! — method:)[^\p{C}\p{Zl}\p{Zp}<>`[\]#@\/]){1,200}(?<! )) — method:(?<method>ci|local|manual)(?: \[files: (?<files>[A-Za-z0-9._/*?-]{1,120}(?:, [A-Za-z0-9._/*?-]{1,120}){0,9})\])?$/u);

/**
 * One claim line of the evidence file's `## Claims` section:
 *   - (TP-<n>|gate:(validate|qa)) (PASS|FAIL|SKIP) sha:<40-hex> by:(test|validate)[ exit:<0-255>]
 */
const CLAIM_LINE_RE = Object.freeze(/^- (?<target>TP-(?<tp>200|1[0-9]{2}|[1-9][0-9]?)|gate:(?<gate>validate|qa)) (?<outcome>PASS|FAIL|SKIP) sha:(?<sha>[0-9a-f]{40}) by:(?<by>test|validate)(?: exit:(?<exit>25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))?$/);

/**
 * One evidence-exception line. Identical to the Code agent's paste gate for
 * `PR_EXCEPTIONS` except for the kind set (parity-pinned), so no capture is named:
 * the source must stay byte-comparable with that gate.
 */
const EXCEPTION_LINE_RE = Object.freeze(/^- `(ticket-link|test-plan)` self-attested by (@[A-Za-z0-9][A-Za-z0-9-]{0,38}|\(login unavailable\)) at [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z: [!"%'()*+,.0-9:;=?A-Z^_a-z{|}~-][ !"%'()*+,.0-9:;=?A-Z^_a-z{|}~-]{0,199}$/);

/**
 * D-EVIDENCE-LINE: the one line verify-evidence.cjs prints on stdout. Every field
 * is a closed-vocabulary token or a bounded number, so no byte of a PR body or
 * comment can ride on it. Consistency the pattern cannot express (the counts sum
 * to total; `stale:` lists exactly STALE ascending ids) is held by
 * formatEvidenceLine and parseEvidenceLine.
 */
const EVIDENCE_LINE_RE = Object.freeze(/^EVIDENCE pr:(?<pr>[1-9][0-9]{0,9}) head:(?<head>[0-9a-f]{40}) total:(?<total>0|200|1[0-9]{2}|[1-9][0-9]?) VERIFIED-CI:(?<verifiedCi>0|200|1[0-9]{2}|[1-9][0-9]?) ATTESTED-LOCAL:(?<attestedLocal>0|200|1[0-9]{2}|[1-9][0-9]?) UNVERIFIED:(?<unverified>0|200|1[0-9]{2}|[1-9][0-9]?) STALE:(?<staleCount>0|200|1[0-9]{2}|[1-9][0-9]?) FAILED:(?<failed>0|200|1[0-9]{2}|[1-9][0-9]?) INDETERMINATE:(?<indeterminate>0|200|1[0-9]{2}|[1-9][0-9]?) stale:(?<stale>none|TP-(?:200|1[0-9]{2}|[1-9][0-9]?)(?:,TP-(?:200|1[0-9]{2}|[1-9][0-9]?)){0,199}) exceptions:(?<exceptions>none|ticket-link(?:,test-plan)?|test-plan) approval:(?<approval>yes|no|unchecked) key:(?<key>[0-9a-f]{12}) posted:(?<posted>yes|no|n\/a) body:(?<body>same|changed)$/);

/**
 * One TP record of an evidence comment:
 *   - TP-n STATE sha:<40|none> out:<PASS|FAIL|SKIP|none>[ run:<id>/<n>| run:none][ exit:<k>] h:<12hex>
 * `sha:`, `out:` and `exit:` are the claim the verdict rests on; RECORD_STATES
 * holds which states each `out:` may carry.
 */
const TP_RECORD_RE = /^- TP-(?<id>200|1[0-9]{2}|[1-9][0-9]?) (?<state>VERIFIED-CI|ATTESTED-LOCAL|UNVERIFIED|STALE|FAILED|INDETERMINATE) sha:(?<sha>[0-9a-f]{40}|none) out:(?<outcome>PASS|FAIL|SKIP|none)(?: run:(?:(?<runId>[1-9][0-9]{0,14})\/(?<attempt>[1-9][0-9]{0,2})|(?<noRuns>none)))?(?: exit:(?<exit>25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))? h:(?<hash>[0-9a-f]{12})$/;

/** One exception record of an evidence comment. */
const EXCEPTION_RECORD_RE = /^- exception:(?<kind>ticket-link|test-plan) by:(?:@(?<login>[A-Za-z0-9][A-Za-z0-9-]{0,38})|unavailable) at:(?<at>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z) status:self-attested$/;

/** An exception reason as the exception grammar admits it. */
const REASON_RE = /^[!"%'()*+,.0-9:;=?A-Z^_a-z{|}~-][ !"%'()*+,.0-9:;=?A-Z^_a-z{|}~-]{0,199}$/;

/** A UTC timestamp as the exception grammar admits it. */
const UTC_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;

/** The counts-only block line (see tallyLine). */
const COUNTS_LINE_RE = /^Verified (?<verified>0|200|1[0-9]{2}|[1-9][0-9]?)\/(?<total>0|200|1[0-9]{2}|[1-9][0-9]?): VERIFIED-CI (?:0|200|1[0-9]{2}|[1-9][0-9]?), ATTESTED-LOCAL (?:0|200|1[0-9]{2}|[1-9][0-9]?), UNVERIFIED (?:0|200|1[0-9]{2}|[1-9][0-9]?), STALE (?:0|200|1[0-9]{2}|[1-9][0-9]?), FAILED (?:0|200|1[0-9]{2}|[1-9][0-9]?), INDETERMINATE (?:0|200|1[0-9]{2}|[1-9][0-9]?) \(counts only: the TP lines exceed the PR body limit\)$/;

/**
 * D-LINK: a repository html_url — https only, a lowercase host (optionally a
 * port), an owner login and a repository name that is not `.` or `..`. No
 * userinfo, query, fragment, trailing slash or percent-escape can match.
 */
const HTML_URL_RE = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::[1-9][0-9]{0,4})?\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/**
 * D-LINK: the only paths a link may add under html_url — a workflow run (and one
 * attempt of it), a commit, or a PR's head ref. `refs/pull/N/merge`, leading
 * zeros, `..` and every percent-escape are outside the grammar.
 */
const LINK_SUFFIX_RE = /^(?:actions\/runs\/[1-9][0-9]{0,14}(?:\/attempts\/[1-9][0-9]{0,2})?|commit\/[0-9a-f]{40}|tree\/refs\/pull\/[1-9][0-9]{0,9}\/head)$/;

/** The longest html_url or link considered at all. */
const MAX_URL_CHARS = 400;

/** The largest run id a record, a link or a run fact may carry (15 digits: exact as a JS number). */
const MAX_RUN_ID = 999999999999999;

/** The most actors permissionLookups reads — far above any real PR's comment and review count. */
const MAX_ACTORS = 10000;

const PLAN_HEADING = '## Test Plan';
const CLAIMS_HEADING = '## Claims';
const EXCEPTIONS_HEADING = '## Evidence Exceptions';
const EVIDENCE_HEADING = '## Test Plan Evidence';
const EM_DASH = '—';
const UNTICKED = '- [ ] ';
const TICKED = '- [x] ';

/** The three evidence-file sections, by heading. A Map, so no prototype key can match. */
const SECTION_KEYS = new Map([
  [PLAN_HEADING, 'testPlan'],
  [CLAIMS_HEADING, 'claims'],
  [EXCEPTIONS_HEADING, 'exceptions'],
]);

/** Run conclusions by the ladder arm they feed. Anything outside all three is unclassifiable. */
const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const UNSETTLED_CONCLUSIONS = new Set(['cancelled', 'action_required', 'stale']);

/** A claim's outcome, as CLAIM_LINE_RE admits it. */
const CLAIM_OUTCOMES = Object.freeze(/** @type {Outcome[]} */ (['PASS', 'FAIL', 'SKIP']));

/**
 * D-RECORD-OUTCOME: a record carries the claim's outcome (`out:`) beside the
 * verdict, because the verdict alone cannot tell it — an INDETERMINATE, STALE or
 * UNVERIFIED record may rest on a PASS or a FAIL. With the outcome, a later
 * refresh re-derives the state from the facts as they are then (a pending run now
 * green ⇒ VERIFIED-CI) instead of needing a new claim.
 *
 * The states each outcome may carry — exactly what the ladder can produce: a
 * verified state needs a PASS; a FAIL can be anything but verified; a SKIP is
 * decided by the first arm, so it is only ever UNVERIFIED; no claim (null, printed
 * `out:none` beside `sha:none`) is UNVERIFIED, or INDETERMINATE when the record
 * that might have held the claim could not be read. A record outside this table
 * is refused — `malformed` by the parser, `invalid` by render and dedupeKey — so
 * no contradictory record is ever printed or read back.
 *
 * @type {ReadonlyMap<Outcome | null, readonly State[]>}
 */
const RECORD_STATES = new Map(/** @type {Array<[Outcome | null, readonly State[]]>} */ ([
  ['PASS', STATES],
  ['FAIL', Object.freeze(/** @type {State[]} */ (['UNVERIFIED', 'INDETERMINATE', 'STALE', 'FAILED']))],
  ['SKIP', Object.freeze(/** @type {State[]} */ (['UNVERIFIED']))],
  [null, Object.freeze(/** @type {State[]} */ (['UNVERIFIED', 'INDETERMINATE']))],
]));

/** D-TRUST: the associations the association arm considers, and the permissions that satisfy it. */
const TRUSTED_ASSOCIATIONS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);
const TRUSTED_PERMISSIONS = Object.freeze(['admin', 'write']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: { code: ErrorCode, line: number } }} Result
 *
 * @typedef {{ id: number, ac: number, scenario: string, method: Method, files: readonly string[], line: string }} Tp
 *   `line` is the canonical (unticked) text — the text hashed for `h:`.
 * @typedef {{ tps: readonly Tp[] }} Plan
 *
 * @typedef {{ target: string, tp: number | null, gate: 'validate' | 'qa' | null,
 *   outcome: Outcome, sha: string, by: 'test' | 'validate', exit: number | null }} Claim
 * @typedef {{ tp: Map<number, Claim>, gates: { validate: Claim | null, qa: Claim | null },
 *   malformed: number, truncated: boolean }} Claims
 *
 * @typedef {{ id: number, attempt: number, status?: string, conclusion?: string | null,
 *   headSha?: string, url?: string, expired?: boolean }} Run
 *   The LATEST attempt of one run, as `gh run view <id> --attempt <n>` reported it,
 *   or `{id, attempt, expired: true}` for a 404 (runs expire after ~90 days).
 *
 * @typedef {{ claim: Claim | null, head: string | null, inPr: boolean | null,
 *   textMatches?: boolean, diff?: readonly string[] | null, verifyingSha?: string,
 *   runs?: readonly Run[] | null, htmlUrl?: string }} Facts
 *   Everything `classify` knows about one TP, gathered by the caller:
 *     claim         the last valid claim for this TP, or null
 *     head          the PR head, 40-hex; null when it could not be resolved
 *     inPr          the claim SHA is an ancestor-or-equal of head AND not an
 *                   ancestor-or-equal of merge-base(head, base); null = unresolved
 *     textMatches   refresh mode: the TP text hash equals the trusted record's
 *                   (omit outside refresh mode)
 *     diff          `git diff --no-renames --name-only <claim> <head> --`, paths
 *                   unquoted; needed when claim ≠ head and the TP has files;
 *                   null = unresolved
 *     verifyingSha  ci TPs: the SHA the runs were listed at — the claim SHA
 *                   (default) or head; any other SHA is refused
 *     runs          ci TPs: the latest attempt of every run at verifyingSha;
 *                   null or absent = unresolved (error, timeout, cap, rate limit)
 *     htmlUrl       ci TPs: the repository's html_url
 *
 * @typedef {{ id: number, attempt: number } | 'none' | null} RunRef
 *   The run a verdict rests on; 'none' labels a ci PASS whose SHA has no runs at all.
 * @typedef {{ state: State, sha: string | null, outcome: Outcome | null, run: RunRef, exit: number | null }} Verdict
 *   `sha`, `outcome` and `exit` are the valid claim's (all null without one).
 * @typedef {{ id: number, state: State, sha: string | null, outcome: Outcome | null, run: RunRef,
 *   exit: number | null, hash: string }} TpRecord
 *   One record line; `outcome` null prints `out:none` (see D-RECORD-OUTCOME).
 * @typedef {{ kind: ExceptionKind, login: string | null, at: string, reason: string | null }} ExceptionRecord
 *   `reason` is null when read back from an evidence comment (reasons are not records).
 * @typedef {{ head: string, key: string, htmlUrl: string, records: readonly TpRecord[],
 *   exceptions: readonly ExceptionRecord[] }} Evidence
 * @typedef {{ total: number, verified: number, counts: Readonly<Record<State, number>> }} Tally
 *
 * @typedef {{ login: string, association: string }} Actor
 * @typedef {{ viewer: string, prAuthor: string, isCrossRepository: boolean | undefined,
 *   permissions?: { get(login: string): string | null | undefined, size: number } }} TrustContext
 *   `permissions` is a Map from each looked-up login to what the permission API
 *   printed (null for a 404 or an error). A login absent from it was never looked up.
 *
 * @typedef {{ pr: number, head: string, total: number, counts: Record<State, number>,
 *   stale: readonly number[], exceptions: readonly ExceptionKind[],
 *   approval: 'yes' | 'no' | 'unchecked', key: string, posted: 'yes' | 'no' | 'n/a',
 *   body: 'same' | 'changed' }} EvidenceFields
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * @template T
 * @param {T} value
 * @returns {Result<T>}
 */
function ok(value) {
  return Object.freeze({ ok: /** @type {true} */ (true), value });
}

/**
 * @param {ErrorCode} code
 * @param {number} [line]
 * @returns {{ ok: false, error: { code: ErrorCode, line: number } }}
 */
function fail(code, line) {
  return Object.freeze({ ok: /** @type {false} */ (false), error: Object.freeze({ code, line: line || 0 }) });
}

/** @param {unknown} v @returns {v is object} */
function isObject(v) {
  return typeof v === 'object' && v !== null;
}

/** @param {unknown} v @returns {boolean} */
function isSha40(v) {
  return typeof v === 'string' && SHA40_RE.test(v);
}

/** @param {unknown} v @param {number} lo @param {number} hi @returns {boolean} */
function isIntIn(v, lo, hi) {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * Split text into lines for the parsers: `\n` ends a line and one `\r` before it
 * is part of that ending; any other `\r` stays in the line, where every grammar
 * refuses it. A final empty line from a trailing newline is dropped.
 *
 * @param {string} text
 * @returns {string[]}
 */
function textLines(text) {
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].endsWith('\r')) rows[i] = rows[i].slice(0, -1);
  }
  if (rows.length > 0 && rows[rows.length - 1] === '' && text.endsWith('\n')) rows.pop();
  return rows;
}

/**
 * The line ending a block takes in `body`: CRLF when the body's first line break
 * is CRLF — or, with no line break at all, when the body ends in a lone `\r`, so
 * that appending keeps the result's first break CRLF too — otherwise LF.
 *
 * @param {string} body
 * @returns {string}
 */
function detectEol(body) {
  const nl = body.indexOf('\n');
  if (nl === -1) return body.endsWith('\r') ? '\r\n' : '\n';
  return nl > 0 && body.charCodeAt(nl - 1) === 13 ? '\r\n' : '\n';
}

/**
 * Non-overlapping occurrences of `needle` in `text`. Bounded by text.length.
 *
 * @param {string} text
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(text, needle) {
  let count = 0;
  let from = 0;
  for (let guard = 0; guard <= text.length; guard++) {
    const at = text.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * A CommonMark fence opener: up to three spaces, then three or more backticks
 * (whose info string holds no backtick) or tildes.
 *
 * @param {string} line
 * @returns {{ ch: string, len: number } | null}
 */
function fenceOpen(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (m === null) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { ch: m[1][0], len: m[1].length };
}

/**
 * @param {string} line
 * @param {{ ch: string, len: number }} fence
 * @returns {boolean}
 */
function fenceCloses(line, fence) {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1][0] === fence.ch && m[1].length >= fence.len;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * @param {string} line
 * @returns {Tp | null}
 */
function parseTpLine(line) {
  const m = TP_LINE_RE.exec(line);
  if (m === null || m.groups === undefined) return null;
  const g = m.groups;
  return Object.freeze({
    id: Number(g.n),
    ac: Number(g.ac),
    scenario: g.scenario,
    method: /** @type {Method} */ (g.method),
    files: Object.freeze(g.files === undefined ? [] : g.files.split(', ')),
    line,
  });
}

/**
 * Parse a test plan: TP lines only, ids unique and ascending, blank lines ignored,
 * and an optional `## Test Plan` heading as the first non-blank line. At least one
 * TP. Any other line is refused with its line number.
 *
 * @param {unknown} text
 * @returns {Result<Plan>}
 */
function parsePlan(text) {
  if (typeof text !== 'string') return fail('invalid');
  if (text.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const rows = textLines(text);
  /** @type {Tp[]} */
  const tps = [];
  let first = true;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (line === '') continue;
    if (first && line === PLAN_HEADING) { first = false; continue; }
    first = false;
    const tp = parseTpLine(line);
    if (tp === null) return fail('malformed', i + 1);
    const last = tps.length > 0 ? tps[tps.length - 1].id : 0;
    if (tp.id === last) return fail('duplicate', i + 1);
    if (tp.id < last) return fail('order', i + 1);
    tps.push(tp);
  }
  if (tps.length === 0) return fail('empty');
  return ok(Object.freeze({ tps: Object.freeze(tps) }));
}

/**
 * @param {string} line
 * @returns {Claim | null}
 */
function parseClaimLine(line) {
  const m = CLAIM_LINE_RE.exec(line);
  if (m === null || m.groups === undefined) return null;
  const g = m.groups;
  return Object.freeze({
    target: g.target,
    tp: g.tp === undefined ? null : Number(g.tp),
    gate: g.gate === undefined ? null : /** @type {'validate' | 'qa'} */ (g.gate),
    outcome: /** @type {Outcome} */ (g.outcome),
    sha: g.sha,
    by: /** @type {'test' | 'validate'} */ (g.by),
    exit: g.exit === undefined ? null : Number(g.exit),
  });
}

/**
 * Parse the `## Claims` section. Only the LAST CLAIM_LINES lines are read: the
 * section is append-only and the last valid claim per target wins, so the newest
 * lines are the ones that matter. Malformed lines are counted, never echoed.
 *
 * @param {unknown} text
 * @returns {Result<Claims>}
 */
function parseClaims(text) {
  if (typeof text !== 'string') return fail('invalid');
  if (text.length > LIMITS.INPUT_CHARS) return fail('oversize');
  let rows = textLines(text);
  const firstContent = rows.findIndex(l => l !== '');
  if (firstContent !== -1 && rows[firstContent] === CLAIMS_HEADING) rows = rows.slice(firstContent + 1);
  const truncated = rows.length > LIMITS.CLAIM_LINES;
  const window = truncated ? rows.slice(rows.length - LIMITS.CLAIM_LINES) : rows;
  /** @type {Map<number, Claim>} */
  const tp = new Map();
  /** @type {{ validate: Claim | null, qa: Claim | null }} */
  const gates = { validate: null, qa: null };
  let malformed = 0;
  for (const line of window) {
    if (line === '') continue;
    const claim = parseClaimLine(line);
    if (claim === null) { malformed++; continue; }
    if (claim.tp !== null) tp.set(claim.tp, claim);
    else if (claim.gate !== null) gates[claim.gate] = claim;
  }
  return ok(Object.freeze({ tp, gates: Object.freeze(gates), malformed, truncated }));
}

/**
 * Parse one evidence-exception line.
 *
 * @param {unknown} line
 * @returns {Result<ExceptionRecord>}
 */
function exception(line) {
  if (typeof line !== 'string' || line.length > 400) return fail('invalid');
  const m = EXCEPTION_LINE_RE.exec(line);
  if (m === null) return fail('malformed', 1);
  const kind = /** @type {ExceptionKind} */ (m[1]);
  const who = m[2];
  const prefix = '- `' + kind + '` self-attested by ' + who + ' at ';
  const at = line.slice(prefix.length, prefix.length + 20);
  const reason = line.slice(prefix.length + 22);
  return ok(Object.freeze({ kind, login: who.startsWith('@') ? who.slice(1) : null, at, reason }));
}

/**
 * Parse an `## Evidence Exceptions` section: the heading, then one or more
 * exception lines — no blank line, no free text — each kind at most once.
 *
 * @param {unknown} text
 * @returns {Result<readonly ExceptionRecord[]>}
 */
function parseExceptions(text) {
  if (typeof text !== 'string') return fail('invalid');
  if (text.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const rows = textLines(text);
  if (rows[0] !== EXCEPTIONS_HEADING) return fail('malformed', 1);
  if (rows.length < 2) return fail('empty');
  /** @type {ExceptionRecord[]} */
  const out = [];
  const kinds = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = exception(rows[i]);
    if (!r.ok) return fail('malformed', i + 1);
    if (kinds.has(r.value.kind)) return fail('duplicate', i + 1);
    kinds.add(r.value.kind);
    out.push(r.value);
  }
  return ok(Object.freeze(out));
}

/**
 * Split the evidence file into its three sections, each returned with its heading
 * line and without trailing blank lines (null when absent). Text before the first
 * level-2 heading is a preamble and ignored; any other level-2 heading, or a
 * repeated one, is refused.
 *
 * @param {unknown} text
 * @returns {Result<{ testPlan: string | null, claims: string | null, exceptions: string | null }>}
 */
function evidenceSections(text) {
  if (typeof text !== 'string') return fail('invalid');
  if (text.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const rows = textLines(text);
  /** @type {Map<string, string[]>} */
  const buffers = new Map();
  /** @type {string[] | null} */
  let current = null;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (line === '##' || line.startsWith('## ')) {
      const key = SECTION_KEYS.get(line);
      if (key === undefined) return fail('malformed', i + 1);
      if (buffers.has(key)) return fail('duplicate', i + 1);
      current = [line];
      buffers.set(key, current);
      continue;
    }
    if (current !== null) current.push(line);
  }
  /** @param {string} key @returns {string | null} */
  const section = key => {
    const lines = buffers.get(key);
    if (lines === undefined) return null;
    let end = lines.length;
    while (end > 1 && lines[end - 1] === '') end--;
    return lines.slice(0, end).join('\n');
  };
  return ok(Object.freeze({ testPlan: section('testPlan'), claims: section('claims'), exceptions: section('exceptions') }));
}

// ---------------------------------------------------------------------------
// Globs — `**` crosses `/`, `**/` may match no directory, `*` and `?` do not
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: 'lit', ch: string } | { kind: 'one' } | { kind: 'star' } | { kind: 'globstar' } | { kind: 'globstar-slash' }} GlobToken
 */

/**
 * @param {string} glob
 * @returns {GlobToken[]}
 */
function globTokens(glob) {
  /** @type {GlobToken[]} */
  const tokens = [];
  for (let i = 0; i < glob.length;) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { tokens.push({ kind: 'globstar-slash' }); i += 3; }
      else { tokens.push({ kind: 'globstar' }); i += 2; }
    } else if (ch === '*') { tokens.push({ kind: 'star' }); i++; }
    else if (ch === '?') { tokens.push({ kind: 'one' }); i++; }
    else { tokens.push({ kind: 'lit', ch }); i++; }
  }
  return tokens;
}

/**
 * Whether `glob` matches the whole of `filePath`. A position-set simulation, so
 * the cost is O(|glob| × |path|) whatever the glob — no regex is built from input
 * and no backtracking exists.
 *
 * FAILS CLOSED toward overlap: an invalid glob, an empty path or a path over
 * PATH_CHARS answers `true`, because the only question this answers is "could this
 * change touch the TP?" and an unanswerable one must read STALE, never verified.
 *
 * @param {unknown} glob
 * @param {unknown} filePath
 * @returns {boolean}
 */
function matchGlob(glob, filePath) {
  if (typeof glob !== 'string' || !GLOB_RE.test(glob)) return true;
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > LIMITS.PATH_CHARS) return true;
  const n = filePath.length;
  let cur = new Uint8Array(n + 1);
  let next = new Uint8Array(n + 1);
  cur[0] = 1;
  for (const t of globTokens(glob)) {
    next.fill(0);
    let alive = false;
    if (t.kind === 'lit' || t.kind === 'one') {
      for (let i = 0; i < n; i++) {
        if (cur[i] === 1 && (t.kind === 'one' ? filePath[i] !== '/' : filePath[i] === t.ch)) {
          next[i + 1] = 1;
          alive = true;
        }
      }
    } else if (t.kind === 'star') {
      let carry = 0;
      for (let i = 0; i <= n; i++) {
        carry = cur[i] === 1 || (carry === 1 && i > 0 && filePath[i - 1] !== '/') ? 1 : 0;
        next[i] = carry;
        if (carry === 1) alive = true;
      }
    } else if (t.kind === 'globstar') {
      let carry = 0;
      for (let i = 0; i <= n; i++) {
        if (cur[i] === 1) carry = 1;
        next[i] = carry;
        if (carry === 1) alive = true;
      }
    } else {
      // `**/`: nothing, or anything that ends in `/`.
      let before = 0;
      for (let i = 0; i <= n; i++) {
        next[i] = cur[i] === 1 || (before === 1 && filePath[i - 1] === '/') ? 1 : 0;
        if (next[i] === 1) alive = true;
        if (cur[i] === 1) before = 1;
      }
    }
    if (!alive) return false;
    const swap = cur;
    cur = next;
    next = swap;
  }
  return cur[n] === 1;
}

/**
 * Whether any diff path could touch any of the TP's globs. Over DIFF_FILES paths,
 * or any non-string path, it answers `true` (fail closed toward STALE).
 *
 * @param {readonly unknown[]} diff
 * @param {readonly string[]} globs
 * @returns {boolean}
 */
function overlaps(diff, globs) {
  if (diff.length > LIMITS.DIFF_FILES) return true;
  for (const file of diff) {
    for (const glob of globs) {
      if (matchGlob(glob, file)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * D-LINK: whether `url` lies under the repository's `htmlUrl`: `htmlUrl` must be a
 * repository URL (HTML_URL_RE), and `url` must be exactly `htmlUrl + '/' + suffix`
 * with the suffix in the closed LINK_SUFFIX_RE grammar. Case-sensitive, so a case
 * variant of the owner or host is refused.
 *
 * @param {unknown} url
 * @param {unknown} htmlUrl
 * @returns {boolean}
 */
function isRepoLink(url, htmlUrl) {
  if (typeof url !== 'string' || typeof htmlUrl !== 'string') return false;
  if (url.length > MAX_URL_CHARS || htmlUrl.length > MAX_URL_CHARS) return false;
  if (!HTML_URL_RE.test(htmlUrl)) return false;
  const prefix = htmlUrl + '/';
  if (!url.startsWith(prefix)) return false;
  return LINK_SUFFIX_RE.test(url.slice(prefix.length));
}

// ---------------------------------------------------------------------------
// classify — the state ladder
// ---------------------------------------------------------------------------

/**
 * @param {unknown} tp
 * @returns {tp is Tp}
 */
function isTp(tp) {
  if (!isObject(tp)) return false;
  const t = /** @type {Record<string, unknown>} */ (tp);
  return isIntIn(t.id, 1, LIMITS.TP_MAX)
    && typeof t.method === 'string' && METHODS.includes(/** @type {Method} */ (t.method))
    && Array.isArray(t.files) && t.files.length <= LIMITS.GLOBS_PER_LINE
    && t.files.every(f => typeof f === 'string');
}

/**
 * @param {unknown} run
 * @returns {boolean}  true when the record is a well-formed completed-or-not run or an expiry
 */
function isRunShape(run) {
  if (!isObject(run)) return false;
  const r = /** @type {Record<string, unknown>} */ (run);
  if (!isIntIn(r.id, 1, MAX_RUN_ID) || !isIntIn(r.attempt, 1, 999)) return false;
  if (r.expired === true) return true;
  return typeof r.status === 'string'
    && (r.conclusion === null || typeof r.conclusion === 'string')
    && typeof r.headSha === 'string'
    && typeof r.url === 'string';
}

/**
 * The lowest-id run matching `pred`, as a RunRef.
 *
 * @param {readonly Run[]} runs
 * @param {(r: Run) => boolean} pred
 * @returns {RunRef}
 */
function firstRun(runs, pred) {
  /** @type {Run | null} */
  let best = null;
  for (const r of runs) {
    if (pred(r) && (best === null || r.id < best.id)) best = r;
  }
  return best === null ? null : Object.freeze({ id: best.id, attempt: best.attempt });
}

/**
 * @typedef {{ tp: Tp, claim: Claim | null, facts: Facts, head: string, runs: readonly Run[],
 *   verifyingSha: string }} LadderInput
 *   Normalised once, before the arms run. `runs` is [] for non-ci TPs.
 * @typedef {{ state: State, test: (x: LadderInput) => boolean, run?: (x: LadderInput) => RunRef }} Arm
 */

/** @param {Run} r @returns {boolean} */
const runUnsettled = r => !isRunShape(r)
  || r.expired === true
  || r.status !== 'completed'
  || typeof r.conclusion !== 'string'
  || UNSETTLED_CONCLUSIONS.has(r.conclusion)
  || !(PASSING_CONCLUSIONS.has(r.conclusion) || FAILING_CONCLUSIONS.has(r.conclusion));

/** @param {Run} r @returns {boolean} */
const runFailed = r => typeof r.conclusion === 'string' && FAILING_CONCLUSIONS.has(r.conclusion);

/** @param {LadderInput} x @returns {boolean} */
const isCi = x => x.tp.method === 'ci';

/** @param {LadderInput} x @returns {boolean} */
function needsDiff(x) {
  return x.claim !== null && x.claim.sha !== x.head && x.tp.files.length > 0;
}

/**
 * D-LADDER: the arms, in the order they are tried. PRECEDENCE is derived from
 * this table. Every arm but the last is a POSITIVE match; the last is the
 * conservative default (applies PF-075: a verified state is only ever reached by
 * a positive conjunction, never because nothing else matched).
 *
 * @type {readonly Arm[]}
 */
const ARMS = Object.freeze([
  {
    // No usable claim, a SKIP, a claim SHA outside the PR, or (refresh mode) TP
    // text that no longer matches the trusted record.
    state: 'UNVERIFIED',
    test: x => x.claim === null
      || x.claim.outcome === 'SKIP'
      || x.facts.inPr === false
      || x.facts.textMatches === false,
  },
  {
    // Something needed to decide could not be resolved — never a silent pass.
    state: 'INDETERMINATE',
    test: x => !isSha40(x.facts.head)
      || x.facts.inPr !== true
      || (needsDiff(x) && !Array.isArray(x.facts.diff))
      || (isCi(x) && (
        !Array.isArray(x.facts.runs)
        || x.facts.runs.length > LIMITS.RUNS_PER_SHA
        || (x.verifyingSha !== /** @type {Claim} */ (x.claim).sha && x.verifyingSha !== x.head)
        || x.runs.some(runUnsettled))),
    run: x => (isCi(x) && Array.isArray(x.facts.runs) ? firstRun(x.runs, r => isRunShape(r) && runUnsettled(r)) : null),
  },
  {
    // The claim is at an older commit, and the change since may touch the TP.
    state: 'STALE',
    test: x => /** @type {Claim} */ (x.claim).sha !== x.head
      && (x.tp.files.length === 0 || overlaps(/** @type {readonly unknown[]} */ (x.facts.diff), x.tp.files)),
  },
  {
    state: 'FAILED',
    test: x => {
      const claim = /** @type {Claim} */ (x.claim);
      return claim.outcome === 'FAIL'
        || (x.tp.method === 'local' && claim.exit !== null && claim.exit !== 0)
        || (isCi(x) && x.runs.some(runFailed));
    },
    run: x => (isCi(x) ? firstRun(x.runs, runFailed) : null),
  },
  {
    // A positive conjunction: a ci PASS, at least one run, every latest attempt
    // passing with at least one success, each at exactly the verifying SHA and
    // each linked under this repository.
    state: 'VERIFIED-CI',
    test: x => isCi(x)
      && /** @type {Claim} */ (x.claim).outcome === 'PASS'
      && x.runs.length >= 1
      && x.runs.every(r => typeof r.conclusion === 'string' && PASSING_CONCLUSIONS.has(r.conclusion)
        && r.headSha === x.verifyingSha
        && isRepoLink(r.url, x.facts.htmlUrl))
      && x.runs.some(r => r.conclusion === 'success'),
    run: x => firstRun(x.runs, r => r.conclusion === 'success'),
  },
  {
    // A local PASS with exit 0, a manual PASS, or a ci PASS whose SHA has no runs
    // at all (labelled run:none, and never counted as VERIFIED-CI).
    state: 'ATTESTED-LOCAL',
    test: x => {
      const claim = /** @type {Claim} */ (x.claim);
      if (claim.outcome !== 'PASS') return false;
      if (x.tp.method === 'local') return claim.exit === 0;
      if (x.tp.method === 'manual') return true;
      return x.runs.length === 0;
    },
    run: x => (isCi(x) ? 'none' : null),
  },
  {
    state: 'UNVERIFIED',
    test: () => true,
  },
].map(arm => Object.freeze(arm)));

/**
 * D-LADDER: the order `classify` tries its arms in — first match wins, and the
 * terminal arm is the conservative UNVERIFIED, so no state is ever reached by
 * exhaustion (applies PF-075). DERIVED from ARMS, so the order the contract states
 * (parity-pinned to this list) and the order the code runs cannot drift apart.
 */
const PRECEDENCE = Object.freeze(/** @type {State[]} */ (ARMS.map(arm => arm.state)));

/** The verdict for a TP that is not a TP: UNVERIFIED, resting on no claim. */
const NO_VERDICT = Object.freeze(/** @type {Verdict} */ ({ state: 'UNVERIFIED', sha: null, outcome: null, run: null, exit: null }));

/**
 * Classify one TP from the facts the caller gathered (see the Facts typedef).
 * Pure and total: any malformed fact reads as unresolved, never as a pass.
 *
 * @param {Tp} tp
 * @param {Facts} facts
 * @returns {Verdict}
 */
function classify(tp, facts) {
  const f = /** @type {Facts} */ (isObject(facts) ? facts : {});
  if (!isTp(tp)) return NO_VERDICT;
  const raw = /** @type {unknown} */ (f.claim);
  const claim = isObject(raw)
    && /** @type {Claim} */ (raw).tp === tp.id
    && isSha40(/** @type {Claim} */ (raw).sha)
    && CLAIM_OUTCOMES.includes(/** @type {Claim} */ (raw).outcome)
    && (/** @type {Claim} */ (raw).exit === null || isIntIn(/** @type {Claim} */ (raw).exit, 0, 255))
    ? /** @type {Claim} */ (raw)
    : null;
  /** @type {LadderInput} */
  const input = {
    tp,
    claim,
    facts: f,
    head: typeof f.head === 'string' ? f.head : '',
    runs: tp.method === 'ci' && Array.isArray(f.runs) ? f.runs.slice(0, LIMITS.RUNS_PER_SHA + 1) : [],
    verifyingSha: typeof f.verifyingSha === 'string' ? f.verifyingSha : (claim === null ? '' : claim.sha),
  };
  for (const arm of ARMS) {
    if (arm.test(input)) {
      return Object.freeze({
        state: arm.state,
        sha: claim === null ? null : claim.sha,
        outcome: claim === null ? null : claim.outcome,
        run: arm.run === undefined ? null : arm.run(input),
        exit: claim === null ? null : claim.exit,
      });
    }
  }
  // Unreachable: the last arm always matches. Kept total for the type.
  return NO_VERDICT;
}

// ---------------------------------------------------------------------------
// tally
// ---------------------------------------------------------------------------

/**
 * Count states. `verified` is VERIFIED-CI + ATTESTED-LOCAL; the counts always sum
 * to `total`, and any state outside STATES is refused.
 *
 * @param {readonly unknown[]} states
 * @returns {Result<Tally>}
 */
function tally(states) {
  if (!Array.isArray(states) || states.length > LIMITS.TP_MAX) return fail('invalid');
  /** @type {Record<State, number>} */
  const counts = { 'VERIFIED-CI': 0, 'ATTESTED-LOCAL': 0, UNVERIFIED: 0, STALE: 0, FAILED: 0, INDETERMINATE: 0 };
  for (const s of states) {
    if (typeof s !== 'string' || !STATES.includes(/** @type {State} */ (s))) return fail('invalid');
    counts[/** @type {State} */ (s)]++;
  }
  return ok(Object.freeze({
    total: states.length,
    verified: counts['VERIFIED-CI'] + counts['ATTESTED-LOCAL'],
    counts: Object.freeze(counts),
  }));
}

/**
 * @param {Tally} t
 * @returns {string}
 */
function tallyLine(t) {
  return 'Verified ' + t.verified + '/' + t.total + ': '
    + STATES.map(s => s + ' ' + t.counts[s]).join(', ');
}

// ---------------------------------------------------------------------------
// Records, hashing
// ---------------------------------------------------------------------------

/**
 * D-RECORD-OUTCOME: whether a record's claim and verdict agree — a SHA exactly
 * when there is an outcome, and a state RECORD_STATES admits for that outcome. An
 * outcome outside the vocabulary (a missing one included) admits no state.
 *
 * @param {unknown} state
 * @param {unknown} sha
 * @param {unknown} outcome
 * @returns {boolean}
 */
function recordConsistent(state, sha, outcome) {
  if ((sha === null) !== (outcome === null)) return false;
  const states = RECORD_STATES.get(/** @type {Outcome | null} */ (outcome));
  return states !== undefined && states.includes(/** @type {State} */ (state));
}

/**
 * @param {unknown} rec
 * @returns {rec is TpRecord}
 */
function isRecord(rec) {
  if (!isObject(rec)) return false;
  const r = /** @type {Record<string, unknown>} */ (rec);
  const run = r.run;
  const runOk = run === null || run === 'none'
    || (isObject(run)
      && isIntIn(/** @type {Record<string, unknown>} */ (run).id, 1, MAX_RUN_ID)
      && isIntIn(/** @type {Record<string, unknown>} */ (run).attempt, 1, 999));
  return isIntIn(r.id, 1, LIMITS.TP_MAX)
    && typeof r.state === 'string' && STATES.includes(/** @type {State} */ (r.state))
    && (r.sha === null || isSha40(r.sha))
    && recordConsistent(r.state, r.sha, r.outcome)
    && runOk
    && (r.exit === null || isIntIn(r.exit, 0, 255))
    && typeof r.hash === 'string' && /^[0-9a-f]{12}$/.test(r.hash);
}

/**
 * @param {unknown} e
 * @returns {e is ExceptionRecord}
 */
function isExceptionRecord(e) {
  if (!isObject(e)) return false;
  const x = /** @type {Record<string, unknown>} */ (e);
  return typeof x.kind === 'string' && EXCEPTION_KINDS.includes(/** @type {ExceptionKind} */ (x.kind))
    && (x.login === null || (typeof x.login === 'string' && LOGIN_RE.test(x.login)))
    && typeof x.at === 'string' && UTC_RE.test(x.at)
    && (x.reason === null || (typeof x.reason === 'string' && REASON_RE.test(x.reason)));
}

/**
 * @param {TpRecord} r
 * @returns {string}
 */
function recordLine(r) {
  const run = r.run === 'none' ? ' run:none' : r.run === null ? '' : ' run:' + r.run.id + '/' + r.run.attempt;
  const exit = r.exit === null ? '' : ' exit:' + r.exit;
  return '- TP-' + r.id + ' ' + r.state + ' sha:' + (r.sha === null ? 'none' : r.sha)
    + ' out:' + (r.outcome === null ? 'none' : r.outcome) + run + exit + ' h:' + r.hash;
}

/**
 * @param {ExceptionRecord} e
 * @returns {string}
 */
function exceptionRecordLine(e) {
  return '- exception:' + e.kind + ' by:' + (e.login === null ? 'unavailable' : '@' + e.login)
    + ' at:' + e.at + ' status:self-attested';
}

/**
 * The first 12 hex of the injected sha256 over `text`. A hash function that
 * throws, or returns anything but 64 lowercase hex, is refused.
 *
 * @param {unknown} sha256
 * @param {string} text
 * @returns {Result<string>}
 */
function hex12(sha256, text) {
  if (typeof sha256 !== 'function') return fail('invalid');
  let digest;
  try {
    digest = sha256(text);
  } catch (_) {
    return fail('invalid');
  }
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return fail('invalid');
  return ok(digest.slice(0, 12));
}

/**
 * The `h:` hash of a TP: the first 12 hex of sha256 over its canonical line.
 *
 * @param {Tp} tp
 * @param {unknown} sha256  (text: string) => 64 lowercase hex
 * @returns {Result<string>}
 */
function tpHash(tp, sha256) {
  if (!isObject(tp) || typeof tp.line !== 'string' || parseTpLine(tp.line) === null) return fail('invalid');
  return hex12(sha256, tp.line);
}

/**
 * The evidence comment's dedupe key: the first 12 hex of sha256 over the record
 * lines exactly as a STUB prints them, so a comment's key can be recomputed from
 * the records it carries.
 *
 * @param {{ records: readonly TpRecord[], exceptions: readonly ExceptionRecord[] }} records
 * @param {unknown} sha256
 * @returns {Result<string>}
 */
function dedupeKey(records, sha256) {
  if (!isObject(records) || !Array.isArray(records.records) || !Array.isArray(records.exceptions)) return fail('invalid');
  if (records.records.length > LIMITS.TP_MAX || records.exceptions.length > EXCEPTION_KINDS.length) return fail('invalid');
  if (!records.records.every(isRecord) || !records.exceptions.every(isExceptionRecord)) return fail('invalid');
  const lines = [...records.records.map(recordLine), ...records.exceptions.map(exceptionRecordLine)];
  return hex12(sha256, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * @param {unknown} plan
 * @returns {plan is Plan}
 */
function isPlan(plan) {
  if (!isObject(plan) || !Array.isArray(/** @type {Plan} */ (plan).tps)) return false;
  const tps = /** @type {Plan} */ (plan).tps;
  if (tps.length > LIMITS.TP_MAX) return false;
  let last = 0;
  for (const tp of tps) {
    if (!isObject(tp) || typeof tp.line !== 'string') return false;
    const parsed = parseTpLine(tp.line);
    if (parsed === null || parsed.id !== tp.id || parsed.id <= last) return false;
    last = parsed.id;
  }
  return true;
}

/**
 * @param {unknown} ev
 * @returns {ev is Evidence}
 */
function isEvidence(ev) {
  if (!isObject(ev)) return false;
  const e = /** @type {Evidence} */ (ev);
  if (!Array.isArray(e.records) || e.records.length > LIMITS.TP_MAX || !e.records.every(isRecord)) return false;
  for (let i = 1; i < e.records.length; i++) {
    if (e.records[i].id <= e.records[i - 1].id) return false;
  }
  if (!Array.isArray(e.exceptions) || !e.exceptions.every(isExceptionRecord)) return false;
  const kinds = new Set(e.exceptions.map(x => x.kind));
  return kinds.size === e.exceptions.length;
}

/**
 * @param {readonly string[]} inner
 * @returns {string}
 */
function wrapBlock(inner) {
  return [MARKERS.BLOCK_START, PLAN_HEADING, ...inner, MARKERS.BLOCK_END].join('\n');
}

/**
 * Escape a table cell: a backslash, then a pipe.
 *
 * @param {string} text
 * @returns {string}
 */
function cell(text) {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * @param {Evidence} ev
 * @param {Tally} t
 * @returns {string[]}
 */
function stubLines(ev, t) {
  return [
    MARKERS.EVIDENCE_OPEN + ' head:' + ev.head + ' key:' + ev.key + ' -->',
    EVIDENCE_HEADING + ' ' + EM_DASH + ' ' + ev.head.slice(0, 7),
    tallyLine(t),
    '',
    ...ev.records.map(recordLine),
    ...ev.exceptions.map(exceptionRecordLine),
  ];
}

/**
 * The FULL additions: the scenario table (links under html_url) and the exception
 * reasons. Null when a link would fall outside the repository.
 *
 * @param {Plan} plan
 * @param {Evidence} ev
 * @returns {string[] | null}
 */
function fullLines(plan, ev) {
  /** @type {Map<number, Tp>} */
  const byId = new Map(plan.tps.map(tp => [tp.id, tp]));
  const rows = ['', '| TP | AC | Method | State | Run | Scenario |', '|---|---|---|---|---|---|'];
  for (const r of ev.records) {
    const tp = byId.get(r.id);
    let run = EM_DASH;
    if (r.run === 'none') run = 'no runs';
    else if (r.run !== null) {
      const link = ev.htmlUrl + '/actions/runs/' + r.run.id + '/attempts/' + r.run.attempt;
      if (!isRepoLink(link, ev.htmlUrl)) return null;
      run = '[' + r.run.id + '/' + r.run.attempt + '](' + link + ')';
    }
    rows.push('| TP-' + r.id + ' | ' + (tp ? 'AC-' + tp.ac : EM_DASH) + ' | ' + (tp ? tp.method : EM_DASH)
      + ' | ' + r.state + ' | ' + run + ' | ' + (tp ? cell(tp.scenario) : EM_DASH) + ' |');
  }
  if (ev.exceptions.length > 0) {
    rows.push('', '| Exception | By | At | Reason |', '|---|---|---|---|');
    for (const e of ev.exceptions) {
      rows.push('| ' + e.kind + ' | ' + (e.login === null ? 'unavailable' : '@' + e.login) + ' | ' + e.at
        + ' | ' + (e.reason === null ? EM_DASH : cell(e.reason)) + ' |');
    }
  }
  return rows;
}

/**
 * Render a test-plan block or an evidence comment.
 *
 *   create  the PR-creation block: markers, `## Test Plan`, every TP unticked, no state
 *   block   the same TPs, ticked when their record's state is verified
 *   counts  the block reduced to one tally line (the body-cap fallback)
 *   stub    the evidence comment: marker, heading, tally, machine records (D5)
 *   full    the stub plus the scenario table and exception reasons; falls back to
 *           the stub over FULL_COMMENT_CHARS, or when html_url is not a repo URL
 *
 * `block` and `counts` need records aligned one-to-one with the plan's TPs; the
 * comment modes are driven by the records, and read scenario text from the plan
 * by id. Every emitted TP line is re-checked against TP_LINE_RE.
 *
 * @param {Plan} plan
 * @param {Evidence | null} evidence  ignored by `create`
 * @param {'create' | 'block' | 'counts' | 'stub' | 'full'} mode
 * @returns {Result<{ text: string, mode: string }>}
 */
function render(plan, evidence, mode) {
  if (!isPlan(plan)) return fail('invalid');
  if ((mode === 'create' || mode === 'block') && plan.tps.length === 0) return fail('empty');
  if (mode === 'create') {
    return ok(Object.freeze({ text: wrapBlock(plan.tps.map(tp => tp.line)), mode }));
  }
  if (!['block', 'counts', 'stub', 'full'].includes(mode) || !isEvidence(evidence)) return fail('invalid');
  const t = tally(evidence.records.map(r => r.state));
  if (!t.ok) return t;
  if (mode === 'block' || mode === 'counts') {
    if (evidence.records.length !== plan.tps.length
      || evidence.records.some((r, i) => r.id !== plan.tps[i].id)) return fail('mismatch');
    if (mode === 'counts') {
      return ok(Object.freeze({ text: wrapBlock([tallyLine(t.value) + ' (counts only: the TP lines exceed the PR body limit)']), mode }));
    }
    const lines = plan.tps.map((tp, i) => (VERIFIED_STATES.includes(evidence.records[i].state)
      ? TICKED + tp.line.slice(UNTICKED.length)
      : tp.line));
    return ok(Object.freeze({ text: wrapBlock(lines), mode }));
  }
  if (!isSha40(evidence.head) || typeof evidence.key !== 'string' || !/^[0-9a-f]{12}$/.test(evidence.key)) return fail('invalid');
  const stub = stubLines(evidence, t.value).join('\n');
  if (mode === 'stub' || !HTML_URL_RE.test(String(evidence.htmlUrl))) return ok(Object.freeze({ text: stub, mode: 'stub' }));
  const extra = fullLines(plan, evidence);
  if (extra === null) return ok(Object.freeze({ text: stub, mode: 'stub' }));
  const full = stub + '\n' + extra.join('\n');
  if (full.length > LIMITS.FULL_COMMENT_CHARS) return ok(Object.freeze({ text: stub, mode: 'stub' }));
  return ok(Object.freeze({ text: full, mode: 'full' }));
}

/**
 * Parse a test-plan block (markers inclusive; LF or CRLF): either TP lines, each
 * `- [ ] ` or `- [x] `, or one counts-only line.
 *
 * @param {unknown} text
 * @returns {Result<{ kind: 'lines', plan: Plan, ticked: readonly number[] } | { kind: 'counts', total: number, verified: number }>}
 */
function parseBlock(text) {
  if (typeof text !== 'string') return fail('invalid');
  if (text.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const rows = textLines(text);
  if (rows[0] !== MARKERS.BLOCK_START) return fail('malformed', 1);
  if (rows[1] !== PLAN_HEADING) return fail('malformed', 2);
  if (rows.length < 3 || rows[rows.length - 1] !== MARKERS.BLOCK_END) return fail('malformed', rows.length);
  const inner = rows.slice(2, rows.length - 1);
  if (inner.length === 0) return fail('empty');
  if (inner.length === 1) {
    const counts = COUNTS_LINE_RE.exec(inner[0]);
    if (counts !== null && counts.groups !== undefined) {
      return ok(Object.freeze({ kind: /** @type {'counts'} */ ('counts'), total: Number(counts.groups.total), verified: Number(counts.groups.verified) }));
    }
  }
  /** @type {number[]} */
  const ticked = [];
  const canonical = [];
  for (let i = 0; i < inner.length; i++) {
    const line = inner[i];
    const isTicked = line.startsWith(TICKED);
    const tp = parseTpLine(isTicked ? UNTICKED + line.slice(TICKED.length) : line);
    if (tp === null) return fail('malformed', i + 3);
    if (isTicked) ticked.push(tp.id);
    canonical.push(tp.line);
  }
  const plan = parsePlan(canonical.join('\n'));
  if (!plan.ok) return fail(plan.error.code, plan.error.line + 2);
  return ok(Object.freeze({ kind: /** @type {'lines'} */ ('lines'), plan: plan.value, ticked: Object.freeze(ticked) }));
}

/**
 * Parse an evidence comment: the marker on the first line, then any TP and
 * exception records (other lines — prose, headings, table rows, and any line
 * outside the record grammar — are skipped, so such a TP simply has no record).
 * TP ids ascend strictly; each exception kind appears at most once; a TP record
 * whose claim contradicts its state (D-RECORD-OUTCOME) makes the whole comment
 * `malformed`, since no ladder wrote it.
 *
 * @param {unknown} text
 * @returns {Result<{ head: string, key: string, records: readonly TpRecord[], exceptions: readonly ExceptionRecord[] }>}
 */
function parseEvidenceComment(text) {
  if (typeof text !== 'string') return fail('invalid');
  if (text.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const rows = textLines(text);
  if (rows.length > LIMITS.COMMENT_LINES) return fail('oversize');
  const marker = MARKERS.EVIDENCE_RE.exec(rows[0]);
  if (marker === null || marker.groups === undefined) return fail('malformed', 1);
  /** @type {TpRecord[]} */
  const records = [];
  /** @type {ExceptionRecord[]} */
  const exceptions = [];
  const kinds = new Set();
  for (let i = 1; i < rows.length; i++) {
    const rec = TP_RECORD_RE.exec(rows[i]);
    if (rec !== null && rec.groups !== undefined) {
      const g = rec.groups;
      const id = Number(g.id);
      const last = records.length > 0 ? records[records.length - 1].id : 0;
      if (id === last) return fail('duplicate', i + 1);
      if (id < last) return fail('order', i + 1);
      const sha = g.sha === 'none' ? null : g.sha;
      const outcome = g.outcome === 'none' ? null : /** @type {Outcome} */ (g.outcome);
      if (!recordConsistent(g.state, sha, outcome)) return fail('malformed', i + 1);
      /** @type {RunRef} */
      let run = null;
      if (g.noRuns !== undefined) run = 'none';
      else if (g.runId !== undefined) run = Object.freeze({ id: Number(g.runId), attempt: Number(g.attempt) });
      records.push(Object.freeze({
        id,
        state: /** @type {State} */ (g.state),
        sha,
        outcome,
        run,
        exit: g.exit === undefined ? null : Number(g.exit),
        hash: g.hash,
      }));
      continue;
    }
    const ex = EXCEPTION_RECORD_RE.exec(rows[i]);
    if (ex !== null && ex.groups !== undefined) {
      const kind = /** @type {ExceptionKind} */ (ex.groups.kind);
      if (kinds.has(kind)) return fail('duplicate', i + 1);
      kinds.add(kind);
      exceptions.push(Object.freeze({ kind, login: ex.groups.login === undefined ? null : ex.groups.login, at: ex.groups.at, reason: null }));
    }
  }
  return ok(Object.freeze({
    head: marker.groups.head,
    key: marker.groups.key,
    records: Object.freeze(records),
    exceptions: Object.freeze(exceptions),
  }));
}

// ---------------------------------------------------------------------------
// splice — only the bytes between the markers are devflow's (applies ADR-024)
// ---------------------------------------------------------------------------

/**
 * D-SPLICE: locate the one test-plan block in a PR body.
 *
 * A marker counts only as a whole line at column 0 — `\n` or `\r\n` ends it,
 * nothing else — outside any fenced code block. Every occurrence of either marker
 * text anywhere in the body must be such a line, or the body is `malformed`: an
 * indented, quoted, mid-line, fenced or CR-garbled marker is text devflow cannot
 * cleanly own, so it edits nothing rather than guess. Exactly one start line
 * before exactly one end line is a block; neither is "no block"; anything else
 * (duplicates, one without the other, reversed) is malformed.
 *
 * A lone `\r` is not a line break here, though CommonMark treats it as one. A
 * marker next to a lone `\r` is therefore non-canonical and refused, so byte
 * integrity holds; what a lone `\r` can mislead is only the fence tracking, whose
 * worst case is a block rendered as code — never an edit outside the markers.
 *
 * @param {string} body
 * @returns {Result<{ found: false, openFence: boolean } | { found: true, start: number, end: number }>}
 *   `start` is the start line's first index; `end` is just past the end marker's
 *   text, before its line ending.
 */
function locateBlock(body) {
  const startCount = countOccurrences(body, MARKERS.BLOCK_START);
  const endCount = countOccurrences(body, MARKERS.BLOCK_END);
  /** @type {number[]} */
  const starts = [];
  /** @type {number[]} */
  const ends = [];
  /** @type {{ ch: string, len: number } | null} */
  let fence = null;
  let pos = 0;
  for (let guard = 0; guard <= body.length; guard++) {
    const nl = body.indexOf('\n', pos);
    const lineEnd = nl === -1 ? body.length : nl;
    const contentEnd = nl !== -1 && lineEnd > pos && body.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    const content = body.slice(pos, contentEnd);
    if (fence !== null) {
      // A marker line inside a fence is not collected, so the occurrence check
      // below refuses it.
      if (fenceCloses(content, fence)) fence = null;
    } else if (content === MARKERS.BLOCK_START) {
      starts.push(pos);
    } else if (content === MARKERS.BLOCK_END) {
      ends.push(pos);
    } else {
      fence = fenceOpen(content);
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (starts.length !== startCount || ends.length !== endCount) return fail('malformed');
  if (starts.length === 0 && ends.length === 0) return ok({ found: /** @type {false} */ (false), openFence: fence !== null });
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) return fail('malformed');
  return ok({ found: /** @type {true} */ (true), start: starts[0], end: ends[0] + MARKERS.BLOCK_END.length });
}

/**
 * The block's lines, when it is a well-formed block: LF only, the start marker
 * first and the end marker last, and between them no marker text, no HTML
 * comment and no fence. Null otherwise.
 *
 * @param {string} block
 * @returns {string[] | null}
 */
function blockLines(block) {
  if (block.includes('\r')) return null;
  const lines = block.split('\n');
  if (lines.length < 2 || lines[0] !== MARKERS.BLOCK_START || lines[lines.length - 1] !== MARKERS.BLOCK_END) return null;
  for (let i = 1; i < lines.length - 1; i++) {
    const l = lines[i];
    if (l.includes(MARKERS.BLOCK_START) || l.includes(MARKERS.BLOCK_END)
      || l.includes('<!--') || l.includes('-->') || fenceOpen(l) !== null) return null;
  }
  return lines;
}

/**
 * The raw text of the body's test-plan block (markers inclusive, original line
 * endings), null when the body has none, or `malformed`.
 *
 * @param {unknown} body
 * @returns {Result<string | null>}
 */
function findBlock(body) {
  if (typeof body !== 'string') return fail('invalid');
  if (body.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const loc = locateBlock(body);
  if (!loc.ok) return loc;
  return ok(loc.value.found ? body.slice(loc.value.start, loc.value.end) : null);
}

/**
 * D-SPLICE: put `block` into `body`, changing nothing else.
 *
 * With a block present, only the bytes from the start marker to the end of the end
 * marker's text are replaced; every byte before and after — the end marker's own
 * line ending included — is the body's own and stays identical. The block takes
 * the body's line ending (detectEol). With no block, it is appended after one
 * blank line — refused as `malformed` when the body ends inside an open fence,
 * where it would render as code. Idempotent: splicing the result again yields the
 * same bytes.
 *
 * @param {unknown} body   the PR body (hostile)
 * @param {unknown} block  a rendered block (render's create/block/counts output)
 * @returns {Result<string>}
 */
function splice(body, block) {
  if (typeof body !== 'string' || typeof block !== 'string') return fail('invalid');
  if (body.length > LIMITS.INPUT_CHARS) return fail('oversize');
  const lines = blockLines(block);
  if (lines === null) return fail('invalid');
  const loc = locateBlock(body);
  if (!loc.ok) return loc;
  const eol = detectEol(body);
  const rendered = lines.join(eol);
  if (loc.value.found) {
    return ok(body.slice(0, loc.value.start) + rendered + body.slice(loc.value.end));
  }
  if (loc.value.openFence) return fail('malformed');
  if (body === '') return ok(rendered);
  return ok(body + (body.endsWith('\n') ? eol : eol + eol) + rendered);
}

/**
 * Splice the first of `blocks` whose result fits BODY_CHARS — pass the full block
 * first and the counts-only block second. `oversize` when none fits.
 *
 * @param {unknown} body
 * @param {readonly string[]} blocks
 * @returns {Result<{ body: string, index: number }>}
 */
function spliceFit(body, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 4) return fail('invalid');
  for (let i = 0; i < blocks.length; i++) {
    const r = splice(body, blocks[i]);
    if (!r.ok) return r;
    if (r.value.length <= LIMITS.BODY_CHARS) return ok(Object.freeze({ body: r.value, index: i }));
  }
  return fail('oversize');
}

// ---------------------------------------------------------------------------
// trust — the one implementation of the trust rule
// ---------------------------------------------------------------------------

/**
 * @param {unknown} ctx
 * @returns {{ viewer: string, prAuthor: string, crossRepo: boolean, permissions: TrustContext['permissions'] | null }}
 */
function trustContext(ctx) {
  const c = /** @type {Record<string, unknown>} */ (isObject(ctx) ? ctx : {});
  const perms = /** @type {{ get?: unknown, size?: unknown } | null} */ (isObject(c.permissions) ? c.permissions : null);
  const usable = perms !== null && typeof perms.get === 'function' && typeof perms.size === 'number';
  return {
    viewer: typeof c.viewer === 'string' ? c.viewer : '',
    prAuthor: typeof c.prAuthor === 'string' ? c.prAuthor : '',
    // Unknown is treated as a fork: the exclusion only narrows trust.
    crossRepo: c.isCrossRepository !== false,
    permissions: usable ? /** @type {TrustContext['permissions']} */ (perms) : null,
  };
}

/**
 * Whether the association arm may consider `actor` at all — before any lookup.
 *
 * @param {Actor} actor
 * @param {ReturnType<typeof trustContext>} c
 * @returns {boolean}
 */
function associationEligible(actor, c) {
  const login = actor.login;
  if (!TRUSTED_ASSOCIATIONS.includes(actor.association)) return false;
  if (!LOGIN_RE.test(login) || login.endsWith('[bot]')) return false;
  if (c.crossRepo && login.toLowerCase() === c.prAuthor.toLowerCase()) return false;
  return true;
}

/**
 * @param {unknown} actor
 * @returns {actor is Actor}
 */
function isActor(actor) {
  return isObject(actor)
    && typeof /** @type {Actor} */ (actor).login === 'string'
    && typeof /** @type {Actor} */ (actor).association === 'string';
}

/**
 * D-TRUST: whether the author of a PR comment, review thread or review is
 * trusted. The rule's one prose statement lives in the git skill's generated
 * `references/trust-rule.md`; this function is its one implementation, and the
 * two are parity-pinned. It reads only the constants above and the lookups the
 * caller made for exactly the logins permissionLookups named. A permissions map
 * larger than TRUST_LOOKUPS is evidence the cap was bypassed, so it trusts no
 * lookup at all.
 *
 * @param {Actor} actor
 * @param {TrustContext} ctx
 * @returns {boolean}
 */
function trust(actor, ctx) {
  if (!isActor(actor)) return false;
  const c = trustContext(ctx);
  if (c.viewer.length > 0 && actor.login === c.viewer) return true;
  if (!associationEligible(actor, c)) return false;
  if (c.permissions === null || c.permissions.size > LIMITS.TRUST_LOOKUPS) return false;
  const permission = c.permissions.get(actor.login);
  return typeof permission === 'string' && TRUSTED_PERMISSIONS.includes(permission);
}

/**
 * The logins the caller must look up for `trust`, in first-seen order: each
 * association-eligible login once, never the viewer, and at most TRUST_LOOKUPS.
 * Call it ONCE per spawn with every actor, so the cap is per spawn; a login past
 * the cap is never looked up and so never trusted.
 *
 * @param {readonly Actor[]} actors
 * @param {TrustContext} ctx
 * @returns {readonly string[]}
 */
function permissionLookups(actors, ctx) {
  if (!Array.isArray(actors)) return Object.freeze([]);
  const c = trustContext(ctx);
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const bound = Math.min(actors.length, MAX_ACTORS);
  for (let i = 0; i < bound && out.length < LIMITS.TRUST_LOOKUPS; i++) {
    const actor = actors[i];
    if (!isActor(actor)) continue;
    if (c.viewer.length > 0 && actor.login === c.viewer) continue;
    if (seen.has(actor.login) || !associationEligible(actor, c)) continue;
    seen.add(actor.login);
    out.push(actor.login);
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// The EVIDENCE line
// ---------------------------------------------------------------------------

/**
 * @param {unknown} fields
 * @returns {string | null}  null when any field is out of its vocabulary or the fields disagree
 */
function checkEvidenceFields(fields) {
  if (!isObject(fields)) return null;
  const f = /** @type {EvidenceFields} */ (fields);
  if (!isIntIn(f.pr, 1, 9999999999) || !isSha40(f.head) || !isIntIn(f.total, 0, LIMITS.TP_MAX)) return null;
  if (!isObject(f.counts)) return null;
  let sum = 0;
  for (const s of STATES) {
    if (!isIntIn(f.counts[s], 0, LIMITS.TP_MAX)) return null;
    sum += f.counts[s];
  }
  if (sum !== f.total) return null;
  if (!Array.isArray(f.stale) || f.stale.length !== f.counts.STALE) return null;
  for (let i = 0; i < f.stale.length; i++) {
    if (!isIntIn(f.stale[i], 1, LIMITS.TP_MAX) || (i > 0 && f.stale[i] <= f.stale[i - 1])) return null;
  }
  if (!Array.isArray(f.exceptions)) return null;
  const kinds = EXCEPTION_KINDS.filter(k => f.exceptions.includes(k));
  if (kinds.length !== f.exceptions.length || kinds.some((k, i) => f.exceptions[i] !== k)) return null;
  if (!['yes', 'no', 'unchecked'].includes(f.approval)) return null;
  if (typeof f.key !== 'string' || !/^[0-9a-f]{12}$/.test(f.key)) return null;
  if (!['yes', 'no', 'n/a'].includes(f.posted) || !['same', 'changed'].includes(f.body)) return null;
  return 'EVIDENCE pr:' + f.pr + ' head:' + f.head + ' total:' + f.total + ' '
    + STATES.map(s => s + ':' + f.counts[s]).join(' ')
    + ' stale:' + (f.stale.length === 0 ? 'none' : f.stale.map(id => 'TP-' + id).join(','))
    + ' exceptions:' + (kinds.length === 0 ? 'none' : kinds.join(','))
    + ' approval:' + f.approval + ' key:' + f.key + ' posted:' + f.posted + ' body:' + f.body;
}

/**
 * Compose the EVIDENCE line — refusing, rather than printing, fields that are out
 * of vocabulary or inconsistent (counts that do not sum to total; a `stale` list
 * that is not STALE ascending ids).
 *
 * @param {EvidenceFields} fields
 * @returns {Result<string>}
 */
function formatEvidenceLine(fields) {
  const line = checkEvidenceFields(fields);
  if (line === null || !EVIDENCE_LINE_RE.test(line)) return fail('invalid');
  return ok(line);
}

/**
 * Parse an EVIDENCE line, holding the same consistency formatEvidenceLine does:
 * a line is accepted only when re-formatting its fields reproduces it byte for byte.
 *
 * @param {unknown} line
 * @returns {Result<EvidenceFields>}
 */
function parseEvidenceLine(line) {
  if (typeof line !== 'string' || line.length > 4096) return fail('invalid');
  const m = EVIDENCE_LINE_RE.exec(line);
  if (m === null || m.groups === undefined) return fail('malformed', 1);
  const g = m.groups;
  /** @type {EvidenceFields} */
  const fields = {
    pr: Number(g.pr),
    head: g.head,
    total: Number(g.total),
    counts: {
      'VERIFIED-CI': Number(g.verifiedCi),
      'ATTESTED-LOCAL': Number(g.attestedLocal),
      UNVERIFIED: Number(g.unverified),
      STALE: Number(g.staleCount),
      FAILED: Number(g.failed),
      INDETERMINATE: Number(g.indeterminate),
    },
    stale: g.stale === 'none' ? [] : g.stale.split(',').map(id => Number(id.slice(3))),
    exceptions: g.exceptions === 'none' ? [] : /** @type {ExceptionKind[]} */ (g.exceptions.split(',')),
    approval: /** @type {EvidenceFields['approval']} */ (g.approval),
    key: g.key,
    posted: /** @type {EvidenceFields['posted']} */ (g.posted),
    body: /** @type {EvidenceFields['body']} */ (g.body),
  };
  if (checkEvidenceFields(fields) !== line) return fail('invalid', 1);
  return ok(Object.freeze({
    ...fields,
    counts: Object.freeze(fields.counts),
    stale: Object.freeze(fields.stale),
    exceptions: Object.freeze(fields.exceptions),
  }));
}

// ---------------------------------------------------------------------------
// Exports — frozen; verify-evidence.cjs and the unit tests are the consumers
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  STATES,
  VERIFIED_STATES,
  METHODS,
  EXCEPTION_KINDS,
  PRECEDENCE,
  LIMITS,
  TRUSTED_ASSOCIATIONS,
  TRUSTED_PERMISSIONS,
  MARKERS,
  TP_LINE_RE,
  CLAIM_LINE_RE,
  EXCEPTION_LINE_RE,
  EVIDENCE_LINE_RE,
  SHA_RE,
  GLOB_RE,
  LOGIN_RE,
  parsePlan,
  parseClaims,
  parseExceptions,
  parseBlock,
  parseEvidenceComment,
  evidenceSections,
  exception,
  matchGlob,
  classify,
  tally,
  render,
  findBlock,
  splice,
  spliceFit,
  tpHash,
  dedupeKey,
  trust,
  permissionLookups,
  isRepoLink,
  formatEvidenceLine,
  parseEvidenceLine,
});
