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
//   node verify-evidence.cjs check tp|block|exceptions|wave <file>
//   node verify-evidence.cjs check wave --links-only <file>
//   node verify-evidence.cjs render --plan <file>
//   node verify-evidence.cjs verify --pr <n> [--publication <mode>] [--evidence <file>]
//        [--state <dir>] [--block-out <file>] [--comment-out <file>] [--stale-out <file>] [--approval]
//   node verify-evidence.cjs splice --pr <n> --state <dir> --block <file> --out <file>
//   node verify-evidence.cjs readback --pr <n> --expect <file>
//   node verify-evidence.cjs publish --pr <n> [--publication auto|full|off|stub] [--evidence <file>]
//   node verify-evidence.cjs readiness --pr <n> [--require-non-author-approval true|false]
//        [--evidence <file>] [--out <file>]
//   node verify-evidence.cjs claim --evidence <file> --head <sha> [--plan <file>]
//        gate | TP-<n>=<PASS|FAIL|SKIP>[:<exit>] ...
//
// stdout (D-VERIFY-STDOUT) is empty or exactly one of these shapes, each closed-vocabulary
// (the render block's TP lines come from the caller's own plan file):
//   check     nothing — the exit code is the answer; the diagnostic is on stderr.
//             `check wave --links-only` also admits the links-only wave block (the
//             `## Related Issues` heading and `Refs #<n>` or `Refs <KEY-N>` lines, no
//             evidence section); plain `check wave` refuses that block as malformed
//   render   the creation block: markers, `## Test Plan`, every TP unticked
//   verify    EVIDENCE pr:<n> head:<sha> total:<n> VERIFIED-CI:<n> ATTESTED-LOCAL:<n>
//             UNVERIFIED:<n> STALE:<n> FAILED:<n> INDETERMINATE:<n> stale:<ids|none>
//             exceptions:<kinds|none> approval:<yes|no|unchecked> key:<hex>
//             posted:<yes|no|n/a> body:<same|changed>          (one line; wrapped here)
//   splice    SPLICE ok|resplice (exit 0) or SPLICE conflict|malformed|oversize (exit 5)
//   readback  READBACK ok (exit 0) or READBACK mismatch (exit 5)
//   publish   the `## PR Evidence` block — the heading, the EVIDENCE line, the line
//             `Test plan: <v>/<total> verified (VERIFIED-CI <a>, ATTESTED-LOCAL <b>)`
//             (v is a + b, all three read from the EVIDENCE line), one
//             `**Body**: … · **Comment**: …` line — then one `TRACEABILITY: DEGRADED
//             (<reason>)` line per degraded part (exit 0), or exit 2 with one line:
//             `TRACEABILITY: DEGRADED (evidence unavailable)` when it could not run (a
//             usage error, an internal error, a failed read and a block the output gate
//             refuses all end this way, so a `publish` never ends with empty stdout),
//             `TRACEABILITY: DEGRADED (compliance off)` when the machine manifest does not
//             say compliance is enabled, or `TRACEABILITY: DEGRADED (compliance state
//             unreadable)` when that manifest cannot be read. The last two come before
//             any gh call, from the machine manifest alone
//   readiness the `## Merge Readiness` block (exit 0), or the same block with
//             `**Status**: DEGRADED (<reason>)` and one `TRACEABILITY: DEGRADED
//             (<reason>)` line after it (exit 2). `--evidence <file>` reads the test
//             plan and the claims from a local evidence file, as `verify --evidence`
//             does. `--out <file>` also writes the file `READINESS pr:<n>
//             head:<40hex|none> status:<READY|NOT_READY|DEGRADED> source=<local|pr>`
//             (one line; wrapped here), then that same block. `source=local` names
//             the `--evidence` file as the plan's source and `source=pr` names the
//             PR's own record. Stdout does not change, and the command makes no
//             remote write.
//             A file an earlier run left at the out path never outlives this run: it
//             is removed before the first read, and a block that does not parse or a
//             write that fails leaves no out file. The one exception is a path that
//             git tracks (below), which is left as it is
//   claim     D-CLAIM-APPEND: appends claim lines to the `## Claims` section of the
//             `--evidence` file. `gate` writes `- gate:validate PASS sha:<head>
//             by:validate`. Each `TP-<n>=<outcome>[:<exit>]` writes `- TP-<n> <outcome>
//             sha:<head> by:test[ exit:<exit>]`. `--head` is one 40-hex SHA, else
//             nothing is written. The `exit:` part is written only for a number from 0
//             to 255. A TP that the plan does not list gets no line. The plan is the
//             `## Test Plan` of the `--plan` file, or of the evidence file when `--plan`
//             is absent. The `## Claims` section is created when absent, at the end
//             of the file; when it is not the last section the lines go at its end
//             (D-CLAIM-INSERT). A missing folder inside the working directory is
//             created, and so is the file (D-CLAIM-FOLDER). The write is one append of
//             every line, or, for a Claims section that is not last, one whole-file
//             replace through a sibling temporary file that keeps the file's mode. The
//             parser of pr-evidence.cjs accepts each line before it. It prints one
//             line, exit 0:
//             `CLAIM appended:<n> PASS:<n> FAIL:<n> SKIP:<n> skipped:<n>`
//             (`skipped` counts the TPs that got no line), or exit 2 with
//             `CLAIM refused (<reason>)`, the reason being `head not one sha`,
//             `evidence file tracked` (git tracks it, or cannot say it does not),
//             `evidence file unusable` (a file that does not parse, or a folder that is
//             missing outside the working directory) or `plan file unusable`. A refusal
//             writes nothing. A folder the run made is removed again when the run
//             leaves no file in it
// A git-tracked file counts as absent, like a tracked `.devflow/config.json`
// (D-TRACKED-RESULT). `verify`, `publish` and `readiness` ask git about an `--evidence`
// file before they read it, and about `--block-out`, `--comment-out`, `--stale-out` and
// `--out` before they write or remove one. `claim` asks about its `--evidence` and
// `--plan` files, and refuses both when either is not clearly untracked. Only a clear "not tracked" answer lets the
// file be read or written. A tracked `--evidence` file, or one git cannot answer for, is
// dropped: the run goes on exactly as if `--evidence` was not given, and the stderr
// summary carries the note `evidence-ignored`. A tracked out path, or one git cannot
// answer for, is refused as a write failure (exit 3, empty stdout) and left untouched.
// No byte of a PR body, a comment, a review or a gh/git answer is ever printed: the
// boundary re-checks every stdout line against these shapes before writing it.
//
// Exit codes:
//   0  ok
//   1  usage error — stdout entirely empty, usage on stderr (a `publish` usage error is
//      exit 2 with the evidence unavailable line instead)
//   2  input unusable — a file could not be read (missing, not a regular file,
//      oversize, not UTF-8), the evidence file or the state directory is
//      malformed, or the PR body's test-plan block cannot serve as the plan.
//      For `publish` and `readiness` (D-OP-SCRIPT-POINTER) it is the DEGRADED
//      result: the operation could not read what it needs, and the stdout above
//      says so. For `claim` it is the refusal line above
//   3  output write failed — no stdout line is printed (a `claim` write leaves the
//      evidence file as it was)
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
//     ignored and a maxBuffer, and every one but the local tracked-file check
//     (D-TRACKED-RESULT) has a timeout; every loop and every API fan-out has a
//     fixed bound, and the whole run has a wall-clock deadline
//   - a revision reaches git only after SHA_RE, so none can start with `-`; `--`
//     ends the revision list of the one command that takes a pathspec (diff)
//   - every `gh` answer, git answer, PR body and comment is hostile: parsed into a
//     typed value at the boundary, bounded, and never echoed

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');

const PE = require(path.join(__dirname, 'pr-evidence.cjs'));
// D-READINESS-CLASSIFIER: the CI classifier, the merge gate and the workflow-list probe
// are ci-wait's own, so the two scripts cannot disagree; only ci-wait polls until its
// deadline, since readiness makes one read. Its main is guarded by
// `require.main === module`: requiring it starts nothing.
const CW = require(path.join(__dirname, 'ci-wait.cjs'));

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

/**
 * D-PUBLISH-BOUNDS: `publish` runs `verify` under the deadline above, then its writes
 * under a deadline of their own and a gh budget of their own. The writes are at most
 * eight calls: two body reads (the compare-and-swap), a body edit and one retry, one
 * read-back, then the comment. A new comment is a post and one retry (seven in all).
 * An edit of the viewer's own comment is the edit, one retry and one read of the
 * comment (eight in all). A scrub is bounded by its own timeout, not by the deadline,
 * so one that starts just before the writes' deadline can end up to REDACT_TIMEOUT_MS
 * after it. The worst case is 90 s + 60 s + 20 s; the caller's 180 s Bash timeout
 * covers it with room for node's startup.
 */
const PUBLISH_DEADLINE_MS = 60000;
const PUBLISH_GH_CALLS = 8;
/** The scrubber is a short local script; a longer run is a failed one. */
const REDACT_TIMEOUT_MS = 20000;
/** A comment is re-measured after the scrub (redaction can grow it); GitHub rejects 65,536. */
const COMMENT_POST_MAX_CHARS = PE.LIMITS.BODY_CHARS;
/** The scrubber, a sibling of this script under ~/.devflow/scripts/. */
const REDACT_SCRIPT = path.join(__dirname, 'redact-secrets.cjs');
/** What a `publish` `--evidence` value may spell: the relative paths the commands build. */
const EVIDENCE_PATH_RE = /^[A-Za-z0-9._/-]{1,255}$/;
/** The `--publication` values a caller may pass (REVIEW_PUBLICATION, resolved). */
const PUBLICATION_VALUES = Object.freeze(['auto', 'full', 'off', 'stub']);

const GH_TIMEOUT_MS = 20000;
const GIT_FETCH_TIMEOUT_MS = 60000;
const GIT_LOCAL_TIMEOUT_MS = 20000;

/** A PR's JSON: 1,000 comments of 65,536 characters, JSON-escaped, still fits. */
const PR_VIEW_MAX_BUFFER = 64 * 1024 * 1024;
const RUN_LIST_MAX_BUFFER = 1024 * 1024;
const RUN_VIEW_MAX_BUFFER = 65536;
const LINE_MAX_BUFFER = 4096;
/** A comment read back as a JSON string: 65,536 characters, each escaped to six, fit. */
const COMMENT_READ_MAX_BUFFER = 8 * 65536;
/** `gh pr checks` and the thread-count GraphQL answer: a thousand rows of names fit. */
const READINESS_MAX_BUFFER = 4 * 1024 * 1024;
/** Where line 1 of the readiness out file says the test plan came from: the `--evidence` file, or the PR's own record. */
const READINESS_SOURCES = Object.freeze(['local', 'pr']);
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

/**
 * A pull-request comment's url, anchored: the pull number, then the numeric id in the
 * fragment. The host is not pinned (GitHub Enterprise Server hosts work). There is no
 * `m` flag, so `$` is the end of the string and a trailing newline is refused.
 */
const COMMENT_URL_RE = /^https:\/\/[^/\s?#]+\/[^/\s?#]+\/[^/\s?#]+\/pull\/([1-9][0-9]{0,9})#issuecomment-([1-9][0-9]{0,19})$/;
/** A comment id as a string of digits: up to 20, so an id beyond 2^53 stays exact. */
const COMMENT_ID_RE = /^[1-9][0-9]{0,19}$/;
/** A review state that decides a login's position on the PR (D6). */
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/** The stdout shapes of splice and readback (D-VERIFY-STDOUT). */
const SPLICE_LINE_RE = /^SPLICE (?<outcome>ok|resplice|conflict|malformed|oversize)$/;
const READBACK_LINE_RE = /^READBACK (?<outcome>ok|mismatch)$/;

/** D-CLAIM-APPEND: the stdout shapes of `claim`, and the closed set of its refusal reasons. */
const CLAIM_APPENDED_RE = /^CLAIM appended:(?<n>[0-9]{1,3}) PASS:(?<pass>[0-9]{1,3}) FAIL:(?<fail>[0-9]{1,3}) SKIP:(?<skip>[0-9]{1,3}) skipped:(?<skipped>[0-9]{1,3})$/;
const CLAIM_REFUSAL_RE = /^CLAIM refused \((?<reason>head not one sha|evidence file tracked|evidence file unusable|plan file unusable)\)$/;
/** One `claim` argument: the TP, its outcome, and an exit the script keeps only as a number from 0 to 255. */
const CLAIM_ARG_RE = /^TP-(?<n>[1-9][0-9]{0,2})=(?<outcome>PASS|FAIL|SKIP)(?::(?<exit>[^\s]{1,12}))?$/;

const USAGE = [
  'Usage: node verify-evidence.cjs check tp|block|exceptions|wave <file>',
  '       node verify-evidence.cjs check wave --links-only <file>',
  '       node verify-evidence.cjs render --plan <file>',
  '       node verify-evidence.cjs verify --pr <n> [--publication <mode>] [--evidence <file>]',
  '            [--state <dir>] [--block-out <file>] [--comment-out <file>] [--stale-out <file>] [--approval]',
  '       node verify-evidence.cjs splice --pr <n> --state <dir> --block <file> --out <file>',
  '       node verify-evidence.cjs readback --pr <n> --expect <file>',
  '       node verify-evidence.cjs publish --pr <n> [--publication auto|full|off|stub] [--evidence <file>]',
  '       node verify-evidence.cjs readiness --pr <n> [--require-non-author-approval true|false]',
  '            [--evidence <file>] [--out <file>]',
  '       node verify-evidence.cjs claim --evidence <file> --head <sha> [--plan <file>]',
  '            gate | TP-<n>=<PASS|FAIL|SKIP>[:<exit>] ...',
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
 *   deadline: number, budget: Budget, notes: Set<string>, made: string[],
 *   stderr: (text: string) => void, ghCap?: number }} Io
 *   The imperative shell's one context: every call goes through it, so every
 *   bound is counted in one place. `notes` holds closed tokens for the stderr
 *   summary, never input bytes. `made` holds the folders a `claim` run created, deepest
 *   first (D-CLAIM-FOLDER). `ghCap` replaces CAPS.GH_CALLS for a stage that
 *   carries a budget of its own (`publish`'s writes).
 *
 * @typedef {{ login: string, association: string, body: string, viewerDidAuthor: boolean, commentId: string }} PrComment
 *   `commentId` is the comment's numeric id as digits, or '' when its url did not parse.
 * @typedef {{ login: string, association: string, state: string }} PrReview
 * @typedef {{ number: number, head: string, base: string, body: string, author: string,
 *   isCrossRepository: boolean | undefined, comments: readonly PrComment[],
 *   reviews: readonly PrReview[] }} PrFacts
 *   The one `gh pr view` answer, parsed. Lists are chronological, newest last.
 *
 * @typedef {{ exec?: ExecFn, cwd?: string, now?: () => number, stderr?: (text: string) => void,
 *   formatLine?: (fields: object) => unknown, manifestPath?: string }} MainDeps
 *   Injected by tests only; `formatLine` reaches the output gate. `manifestPath` replaces
 *   the machine manifest that `publish` reads; production always reads ~/.devflow/manifest.json.
 *
 * @typedef {{ code: number, stdout: string }} Outcome
 */

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: 'usage' }
 *   | { kind: 'check', what: 'tp' | 'block' | 'exceptions' | 'wave', file: string, linksOnly: boolean }
 *   | { kind: 'render', plan: string }
 *   | { kind: 'verify', pr: number, publication: string, evidence: string | null, state: string | null,
 *       blockOut: string | null, commentOut: string | null, staleOut: string | null, approval: boolean }
 *   | { kind: 'splice', pr: number, state: string, block: string, out: string }
 *   | { kind: 'readback', pr: number, expect: string }
 *   | { kind: 'publish', pr: number, publication: string, evidence: string | null }
 *   | { kind: 'readiness', pr: number, requireNonAuthor: 'true' | 'false' | 'unrecognised',
 *       evidence: string | null, out: string | null }
 *   | { kind: 'claim', evidence: string, head: string, plan: string | null, gate: boolean,
 *       tps: readonly { id: number, outcome: 'PASS' | 'FAIL' | 'SKIP', exit: string | null }[] }} ParsedArgs
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
    // `check wave --links-only <file>` is the one three-argument form: the links-only wave block is opt-in.
    const linksOnly = tail.length === 3 && tail[0] === 'wave' && tail[1] === '--links-only';
    if ((tail.length !== 2 && !linksOnly) || !['tp', 'block', 'exceptions', 'wave'].includes(tail[0])) return USAGE_ARGS;
    const file = tail[tail.length - 1];
    if (typeof file !== 'string' || file === '' || file.startsWith('-') || file.length > MAX_ARG_CHARS) return USAGE_ARGS;
    return { kind: 'check', what: /** @type {'tp' | 'block' | 'exceptions' | 'wave'} */ (tail[0]), file, linksOnly };
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
  if (sub === 'publish') {
    const f = parseFlags(tail, { '--pr': 'value', '--publication': 'value', '--evidence': 'value' });
    const pr = f === null ? null : parsePr(flagValue(f, '--pr'));
    if (f === null || pr === null) return USAGE_ARGS;
    const publication = flagValue(f, '--publication') || '';
    const evidence = flagValue(f, '--evidence');
    if (publication !== '' && !PUBLICATION_VALUES.includes(publication)) return USAGE_ARGS;
    if (evidence !== null && !EVIDENCE_PATH_RE.test(evidence)) return USAGE_ARGS;
    return { kind: 'publish', pr, publication, evidence };
  }
  if (sub === 'readiness') {
    const f = parseFlags(tail, {
      '--pr': 'value', '--require-non-author-approval': 'value', '--evidence': 'value', '--out': 'value',
    });
    const pr = f === null ? null : parsePr(flagValue(f, '--pr'));
    if (f === null || pr === null) return USAGE_ARGS;
    const needed = flagValue(f, '--require-non-author-approval');
    if (needed !== null && needed !== 'true' && needed !== 'false') return USAGE_ARGS;
    const evidence = flagValue(f, '--evidence');
    const out = flagValue(f, '--out');
    // The out file is never the evidence file: two spellings of one path (`./a.md` and `a.md`)
    // and two names of one file (a hard link or a symlink) are both refused before any read.
    if (evidence !== null && out !== null && (path.resolve(evidence) === path.resolve(out) || sameFile(evidence, out))) return USAGE_ARGS;
    // An absent flag is the ladder's "unrecognised": it can never read READY.
    return { kind: 'readiness', pr, requireNonAuthor: needed === null ? 'unrecognised' : needed, evidence, out };
  }
  if (sub === 'claim') return parseClaimArgs(tail);
  return USAGE_ARGS;
}

/**
 * D-CLAIM-APPEND: `claim` takes its flags first, then either the one word `gate` or
 * one to CAPS.TPS `TP-<n>=<outcome>[:<exit>]` arguments, each TP at most once. A bad
 * flag or argument is a usage error. `--head` is not checked here: a value that is not
 * one SHA is a refusal with a line, since the caller passes what its report shows.
 *
 * @param {readonly string[]} tail
 * @returns {ParsedArgs}
 */
function parseClaimArgs(tail) {
  let flagCount = 0;
  while (flagCount < tail.length && tail[flagCount].startsWith('--')) flagCount += 2;
  const f = parseFlags(tail.slice(0, flagCount), { '--evidence': 'value', '--head': 'value', '--plan': 'value' });
  const evidence = f === null ? null : flagValue(f, '--evidence');
  const head = f === null ? null : flagValue(f, '--head');
  const plan = f === null ? null : flagValue(f, '--plan');
  const items = tail.slice(flagCount);
  if (evidence === null || head === null || items.length === 0 || items.length > CAPS.TPS) return USAGE_ARGS;
  if (items.length === 1 && items[0] === 'gate') {
    return plan === null ? { kind: 'claim', evidence, head, plan, gate: true, tps: [] } : USAGE_ARGS;
  }
  const tps = [];
  for (const item of items) {
    const m = CLAIM_ARG_RE.exec(item);
    if (m === null || m.groups === undefined) return USAGE_ARGS;
    tps.push({
      id: Number(m.groups.n),
      outcome: /** @type {'PASS' | 'FAIL' | 'SKIP'} */ (m.groups.outcome),
      exit: m.groups.exit === undefined ? null : m.groups.exit,
    });
  }
  if (new Set(tps.map(tp => tp.id)).size !== tps.length) return USAGE_ARGS;
  return { kind: 'claim', evidence, head, plan, gate: false, tps };
}

// ---------------------------------------------------------------------------
// Bounded file I/O
// ---------------------------------------------------------------------------

/**
 * Whether two paths name one file: the same device and inode, links followed. A path
 * that does not exist, or cannot be inspected, names no file.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameFile(a, b) {
  try {
    const first = fs.statSync(a, { bigint: true, throwIfNoEntry: false });
    const second = fs.statSync(b, { bigint: true, throwIfNoEntry: false });
    return first !== undefined && second !== undefined && first.dev === second.dev && first.ino === second.ino;
  } catch (_) {
    return false;
  }
}

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
 * The lstat refuses first. The open adds O_NOFOLLOW, so a link put in the file's
 * place after the lstat is refused, never followed, and O_NONBLOCK, so a FIFO put
 * there cannot block; the fstat re-checks the opened object.
 *
 * @param {string} filePath
 * @param {string} text
 * @returns {boolean}
 */
function writeTextFile(filePath, text) {
  let fd;
  try {
    const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (st !== undefined && !st.isFile()) return false;
    const c = fs.constants;
    fd = fs.openSync(filePath, c.O_WRONLY | c.O_CREAT | c.O_TRUNC | (c.O_NOFOLLOW || 0) | (c.O_NONBLOCK || 0), 0o600);
    if (!fs.fstatSync(fd).isFile()) return false;
    fs.writeFileSync(fd, text, 'utf8');
    return true;
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* the write already decided */ }
    }
  }
}

/**
 * Append `text` to `filePath` in one write, creating the file when it is absent. The same
 * refusals as writeTextFile apply: a path that exists and is not a regular file, a link
 * put in its place (O_NOFOLLOW), a FIFO (O_NONBLOCK). A write that does not complete
 * cuts the file back to its length before the append, or removes the file when this call
 * created it, so a failed append leaves no part of `text`. Returns whether it was written.
 *
 * @param {string} filePath
 * @param {string} text
 * @returns {boolean}
 */
function appendTextFile(filePath, text) {
  let fd;
  let created = false;
  try {
    const st = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (st !== undefined && !st.isFile()) return false;
    created = st === undefined;
    const c = fs.constants;
    fd = fs.openSync(filePath, c.O_WRONLY | c.O_APPEND | c.O_CREAT | (c.O_NOFOLLOW || 0) | (c.O_NONBLOCK || 0), 0o600);
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return false;
    const bytes = Buffer.from(text, 'utf8');
    try {
      if (fs.writeSync(fd, bytes) === bytes.length) return true;
    } catch (_) { /* cut back below */ }
    try { fs.ftruncateSync(fd, before.size); } catch (_) { /* the write already failed */ }
    if (created) fs.unlinkSync(filePath);
    return false;
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* the write already decided */ }
    }
  }
}

/**
 * Replace the regular file `filePath` with `text` and keep its `mode`: the text goes to a
 * sibling temporary file, in the same folder, which a rename then puts in the file's place.
 * It refuses first what appendTextFile refuses, so the two writes of a claim agree: a file
 * this process may not write, a link put in its place (O_NOFOLLOW), a FIFO (O_NONBLOCK) or
 * any other object that is not a regular file. The probe opens the file for an append and
 * writes nothing. A write that fails leaves the file as it was and the temporary file
 * removed, so a failed replace never truncates it. The temporary file is created new
 * (O_EXCL) and never through a link (O_NOFOLLOW), and takes the old mode on its own
 * descriptor, since the umask would otherwise set the new file's mode. Returns whether the
 * file was replaced.
 *
 * @param {string} filePath
 * @param {string} text
 * @param {number} mode  the permission bits of the file it replaces
 * @returns {boolean}
 */
function replaceTextFile(filePath, text, mode) {
  const c = fs.constants;
  let probe;
  try {
    probe = fs.openSync(filePath, c.O_WRONLY | c.O_APPEND | (c.O_NOFOLLOW || 0) | (c.O_NONBLOCK || 0));
    if (!fs.fstatSync(probe).isFile()) return false;
  } catch (_) {
    return false;
  } finally {
    if (probe !== undefined) {
      try { fs.closeSync(probe); } catch (_) { /* the probe wrote nothing */ }
    }
  }
  const temp = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.claim-' + process.pid);
  let fd;
  try {
    fd = fs.openSync(temp, c.O_WRONLY | c.O_CREAT | c.O_EXCL | (c.O_NOFOLLOW || 0), 0o600);
  } catch (_) {
    return false;
  }
  try {
    fs.fchmodSync(fd, mode);
    fs.writeFileSync(fd, text, 'utf8');
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, filePath);
    return true;
  } catch (_) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* the write already failed */ }
    }
    try { fs.unlinkSync(temp); } catch (_) { /* the temporary file is already gone */ }
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
 * One bounded subprocess call, normalized. The argv array is a fresh copy. A null
 * `timeout` sets no time limit on the call.
 *
 * @param {Io} io
 * @param {string} file
 * @param {readonly string[]} args
 * @param {number | null} timeout
 * @param {number} maxBuffer
 * @returns {CallResult}
 */
function runCall(io, file, args, timeout, maxBuffer) {
  const res = io.exec(file, [...args], {
    cwd: io.cwd,
    env: io.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(timeout === null ? {} : { timeout }),
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
 * is NOT KNOWING, and never reads as the permissive answer.
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
  const cap = typeof io.ghCap === 'number' ? io.ghCap : CAPS.GH_CALLS;
  if (io.budget.ghCalls >= cap) { io.notes.add('gh-call-cap'); return refusedCall('cap'); }
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
 * hook runs (D-NO-FSMONITOR), and refused once the deadline has passed. A null
 * `timeout` sets no time limit on the call itself.
 *
 * @param {Io} io
 * @param {readonly string[]} args
 * @param {number | null} timeout
 * @param {number} maxBuffer
 * @returns {CallResult}
 */
function git(io, args, timeout, maxBuffer) {
  const left = remaining(io);
  if (left === 0) { io.notes.add('deadline'); return refusedCall('deadline'); }
  return runCall(io, 'git', ['-c', 'core.fsmonitor=false', ...args], timeout === null ? null : Math.min(timeout, left), maxBuffer);
}

// ---------------------------------------------------------------------------
// Tracked files — D-TRACKED-RESULT
// ---------------------------------------------------------------------------

/** What git says, asked with LC_ALL=C, of a path that sits in no repository. */
const NOT_A_REPOSITORY_RE = /\bnot a git repository\b/;

/**
 * D-TRACKED-RESULT: whether git tracks one absolute path, asked of the repository the
 * path sits in (`-C` its directory, the name taken literally). `untracked` is a clear
 * answer only: git exits 0 and lists nothing, or says the directory is in no
 * repository. A listed path is `tracked`. A git that could not run or answered
 * anything else, and a call refused past the deadline, is `unknown`. The call sets no
 * time limit.
 *
 * @param {Io} io
 * @param {string} abs
 * @returns {'untracked' | 'tracked' | 'unknown'}
 */
function trackedStateOf(io, abs) {
  const probe = Object.assign({}, io, { env: Object.assign({}, io.env, { LC_ALL: 'C' }) });
  const r = git(probe, ['-C', path.dirname(abs), '--literal-pathspecs', 'ls-files', '-z', '--', path.basename(abs)], null, LINE_MAX_BUFFER);
  if (!answered(r)) return 'unknown';
  if (r.status === 0) return r.stdout.length === 0 ? 'untracked' : 'tracked';
  return r.status === 128 && NOT_A_REPOSITORY_RE.test(r.stderr) ? 'untracked' : 'unknown';
}

/**
 * D-TRACKED-RESULT: a git-tracked file counts as absent, like a tracked
 * `.devflow/config.json`. A path is `untracked` only when git says so for the path as
 * spelled and for the file it resolves to (a link is judged by both names); one tracked
 * name makes it `tracked`, and one name git could not answer for makes it `unknown`.
 * It never throws.
 *
 * @param {Io} io
 * @param {string} file
 * @returns {'untracked' | 'tracked' | 'unknown'}
 */
function trackedState(io, file) {
  try {
    const abs = path.resolve(file);
    const names = [abs];
    try {
      const real = fs.realpathSync(abs);
      if (real !== abs) names.push(real);
    } catch (_) { /* a path that names nothing has no other name */ }
    /** @type {'untracked' | 'tracked' | 'unknown'} */
    let state = 'untracked';
    for (const name of names) {
      const one = trackedStateOf(io, name);
      if (one === 'tracked') return 'tracked';
      if (one === 'unknown') state = 'unknown';
    }
    return state;
  } catch (_) {
    return 'unknown';
  }
}

/**
 * D-TRACKED-RESULT: the paths a `verify`, `publish` or `readiness` run reads or writes
 * as a result file. An out path (`--block-out`, `--comment-out`, `--stale-out`,
 * `--out`) that is not clearly untracked is refused before any read or removal, with
 * the write failure (exit 3): no file is written. An `--evidence` file that is not
 * clearly untracked is dropped, so the run goes on exactly as if `--evidence` was not
 * given; the stderr summary then carries the closed note `evidence-ignored`. Stdout
 * keeps its grammar. A `claim` run has its own refusal line for each of these cases
 * (claimRefusalReason).
 *
 * @param {Io} io
 * @param {ParsedArgs} args
 * @returns {{ args: ParsedArgs } | { outcome: Outcome }}
 */
function admitPaths(io, args) {
  if (args.kind === 'claim') {
    const reason = claimRefusalReason(io, args);
    return reason === null ? { args } : { outcome: claimRefusal(reason) };
  }
  if (args.kind !== 'verify' && args.kind !== 'publish' && args.kind !== 'readiness') return { args };
  const outs = args.kind === 'verify' ? [args.blockOut, args.commentOut, args.staleOut]
    : args.kind === 'readiness' ? [args.out] : [];
  if (outs.some(file => file !== null && trackedState(io, file) !== 'untracked')) {
    return { outcome: refuse(io, EXIT_CODES.WRITE_FAILED, 'an output file could not be written') };
  }
  if (args.evidence === null || trackedState(io, args.evidence) === 'untracked') return { args };
  io.notes.add('evidence-ignored');
  return { args: Object.assign({}, args, { evidence: null }) };
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

/**
 * Assert a comment id before it reaches gh's argv (an API path segment):
 * COMMENT_ID_RE, so no `/`, `..`, `?` or option can ride on PR data. commentIdOf
 * only ever yields such ids; this is that precondition held at the sink.
 *
 * @param {string} id
 * @returns {string}
 */
function commentIdArg(id) {
  if (typeof id !== 'string' || !COMMENT_ID_RE.test(id)) throw new Error('verify-evidence: unchecked comment id');
  return id;
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
 * The numeric id of a PR comment, read from its url, as the digits themselves:
 * never Number(), so an id beyond 2^53 stays exact. '' unless the url is a bounded
 * string of the anchored pull-comment form AND names the PR that was read.
 *
 * @param {unknown} url
 * @param {number} pr
 * @returns {string}
 */
function commentIdOf(url, pr) {
  if (typeof url !== 'string' || url.length > MAX_URL_CHARS) return '';
  const m = COMMENT_URL_RE.exec(url);
  return m !== null && m[1] === String(pr) ? m[2] : '';
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
      commentId: commentIdOf(x.url, pr),
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
 * @typedef {{ id: string, marker: string, editable: boolean }} EditTarget
 *   `id` is the comment's id ('' when unreadable); `marker` is its first line;
 *   `editable` is false when a later comment from another login is itself an
 *   evidence marker.
 */

/**
 * The comment a publish would edit in place: the viewer's NEWEST comment whose first
 * line starts with the evidence head prefix, whatever its key. "The viewer's" is the
 * server-asserted `viewerDidAuthor` flag, so only an own comment is ever a target
 * (never another login's comment, such as a maintainer's or a bot's). A malformed own
 * comment (the prefix alone) is a valid target, so an edit repairs it.
 *
 * `editable` guards the trust order: verify trusts the newest evidence comment by
 * list position, and an edit keeps its old position, so editing is safe only when
 * no strict marker comment from another login comes after the target. A later
 * prefix-only comment from another login is not a record and does not block. The
 * strict trust functions (markerComments, resolveTrust, findTrustedRecord) stay as
 * they are.
 *
 * @param {{ comments: readonly PrComment[] }} pr  chronological, newest last
 * @returns {EditTarget | null}
 */
function editTarget(pr) {
  const at = pr.comments.findLastIndex(c => c.viewerDidAuthor && firstLine(c.body).startsWith(PE.MARKERS.EVIDENCE_HEAD_PREFIX));
  if (at === -1) return null;
  const c = pr.comments[at];
  const editable = !pr.comments.slice(at + 1).some(x => !x.viewerDidAuthor && PE.MARKERS.EVIDENCE_RE.test(firstLine(x.body)));
  return Object.freeze({ id: c.commentId, marker: firstLine(c.body), editable });
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
 *   `refused` holds logins that permissionLookups named but whose lookup gave no
 *   ANSWER (a refusal — throttle, cap, deadline — or a timeout, a spawn error, a
 *   5xx, a network failure): trust() still reads them untrusted, as the rule says of
 *   an error, but whether such a login's comment is the NEWEST trusted record is
 *   unknown, so findTrustedRecord never falls back past it to an older record.
 */

/**
 * Whether a permission lookup that did not print a permission was nevertheless an
 * ANSWER: GitHub said 404 (not a collaborator) or a plain 403 (the viewer may not
 * read it). Everything else that failed is not knowing.
 *
 * @param {CallResult} r
 * @returns {boolean}
 */
function lookupDenied(r) {
  return answered(r) && /HTTP 40[34]\b/.test(r.stderr) && !isThrottle(r);
}

/**
 * Look up the permissions the trust rule needs — ONCE per spawn, for exactly the
 * logins pr-evidence `permissionLookups` names (≤ PERMISSION_LOOKUPS). Only the
 * authors whose trust can matter are offered: evidence-marker comment authors,
 * newest first, then (with --approval) the approval candidates. A printed
 * permission is stored as printed; a 404 or a plain 403 stores null — untrusted,
 * per the rule; any other failure leaves the login `refused` (see TrustState).
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
    if (r.refused !== null || isThrottle(r) || !(r.ok || lookupDenied(r))) {
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
  return text === null ? null : parseEvidenceText(text);
}

/**
 * The sections of an evidence file's text, parsed (see loadEvidence).
 *
 * @param {string} text
 * @returns {EvidenceInput | null}  null when unusable
 */
function parseEvidenceText(text) {
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
 * D-VERIFY-RECORD: a trusted record's line as the claim it rests on — its SHA, its
 * outcome (`out:`, D-RECORD-OUTCOME) and its exit code; `sha:none` is no claim.
 * The recorded STATE is never carried forward: `classify` re-derives it from the
 * facts as they are now, exactly as for a new claim. So a record written while CI
 * was pending (INDETERMINATE) reads VERIFIED-CI once the run succeeds, or FAILED
 * once it fails; a STALE claim whose files the diff no longer touches is decided
 * again; and a recorded FAIL or SKIP never passes. The record reaches here only
 * from a trusted author (findTrustedRecord) and only for TP text whose hash it
 * carries (tpInputs), and the parser has refused any record whose outcome
 * contradicts its state.
 *
 * @param {any} record  a parseEvidenceComment TpRecord
 * @returns {object | null}  a Claim, or null for no claim
 */
function recordClaim(record) {
  if (record.sha === null) return null;
  return Object.freeze({
    target: 'TP-' + record.id,
    tp: record.id,
    gate: null,
    outcome: record.outcome,
    sha: record.sha,
    by: 'test',
    exit: record.exit,
  });
}

// ---------------------------------------------------------------------------
// Classification — gather lazily, in ladder order; `classify` decides
// ---------------------------------------------------------------------------

/**
 * @typedef {{ tp: any, hash: string, recorded: boolean, claim: object | null,
 *   textMatches: boolean | undefined, forceIndeterminate: boolean }} TpInput
 *   `recorded`: the trusted record carries this TP with the same text hash.
 */

/**
 * The facts for one TP, gathered in the order `classify` consults them and no
 * further than the first arm that can already decide: nothing past a missing or
 * SKIP claim (a text mismatch attaches none, see tpInputs) or an unresolved head;
 * nothing past an ancestry answer other than "in the PR". Stopping early can only
 * leave a fact absent, and an absent fact reads unresolved — never a pass.
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
  if (claim === null || claim.outcome === 'SKIP' || !repo.headResolved) return facts;
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
 * @returns {{ state: string, sha: string | null, outcome: string | null, run: any, exit: number | null }}
 */
function classifyTp(io, repo, memo, x) {
  // D-VERIFY-THROTTLE: the record that would decide this TP could not be read, so
  // no claim rests on it (tpInputs attaches none) — INDETERMINATE, sha:none.
  if (x.forceIndeterminate) return { state: 'INDETERMINATE', sha: null, outcome: null, run: null, exit: null };
  const facts = gatherFacts(io, repo, memo, x);
  const verdict = PE.classify(x.tp, facts);
  const claim = /** @type {any} */ (x.claim);
  if (x.tp.method === 'ci' && verdict.state === 'ATTESTED-LOCAL' && verdict.run === 'none' && claim.sha !== repo.head) {
    const headRuns = runsAt(io, memo, repo.head);
    if (headRuns !== null) return PE.classify(x.tp, { ...facts, verifyingSha: repo.head, runs: headRuns });
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
 * TP's hash. A body-sourced TP's text counts only when that hash matches — and a
 * claim attaches only to text that counts: body text that fails the check gets no
 * claim at all, not even the file's. The file's claim was made against the text
 * the record published, not this text, and a record binding the two would pass
 * the next refresh's hash check and launder the claim onto it. A TP whose record
 * is unknown (D-VERIFY-THROTTLE) gets no claim either. Null when a TP line fails
 * its grammar (the hash is refused).
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
    const textMatches = fromFile ? undefined : recordApplies;
    // D-VERIFY-THROTTLE: when the record itself is unknown, so is every claim or
    // text check that would have come from it.
    const forceIndeterminate = record.kind === 'unknown' && (!fromFile || fileClaim === undefined);
    const claim = textMatches === false || forceIndeterminate ? null
      : fileClaim !== undefined ? fileClaim
        : recordApplies ? recordClaim(rec) : null;
    inputs.push({ tp, hash: hash.value, recorded: recordApplies, claim, textMatches, forceIndeterminate });
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
 * D-VERIFY-RECORD: whether a PR-body plan still carries every TP the trusted record
 * does. The hash check guards the text of each TP the body shows, but not the TPs
 * it leaves out: anyone who can edit the body — a fork author, whom the trust rule
 * never trusts — could delete the failing lines so that the verified rest equals
 * the total. A body plan that drops a recorded TP therefore cannot serve as the
 * plan at all (input unusable), rather than yield a smaller total. A plan read from
 * the evidence file is local text and is not held to the record.
 *
 * @param {{ tps: readonly any[] }} plan
 * @param {TrustedRecord} record
 * @returns {boolean}
 */
function coversRecord(plan, record) {
  if (record.kind !== 'record') return true;
  const ids = new Set(plan.tps.map(tp => tp.id));
  return record.records.every(r => ids.has(r.id));
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
 * viewer's own NEWEST evidence comment (the edit target) whose first line is this
 * exact marker (head and key) counts, so a spoofed marker never suppresses a post
 * and an older exact match behind a newer own comment of another key reads `no`
 * (the newer one is what a publish edits). `off`, or nothing to record, is no
 * comment (`n/a`). Null when it fails to render.
 *
 * @param {{ tps: readonly any[] }} plan
 * @param {any} ev
 * @param {'full' | 'off' | 'stub'} mode
 * @param {EditTarget | null} target
 * @returns {{ text: string, posted: 'yes' | 'no' | 'n/a' } | null}
 */
function commentUpdate(plan, ev, mode, target) {
  if (mode === 'off' || (ev.records.length === 0 && ev.exceptions.length === 0)) return { text: '', posted: 'n/a' };
  const rendered = PE.render(plan, ev, mode);
  if (!rendered.ok) return null;
  const marker = firstLine(rendered.value.text);
  const posted = target !== null && target.marker === marker ? 'yes' : 'no';
  return { text: rendered.value.text, posted };
}

/**
 * --stale-out: the STALE TPs. A plan from the PR body lists only those whose text hash
 * equals the trusted record's — text a trusted author already published, never
 * unrecorded PR text (containment). A plan from the `--evidence` file is the caller's
 * own local text, so every STALE TP of it is listed.
 *
 * @param {readonly TpInput[]} inputs
 * @param {readonly { state: string }[]} records
 * @param {boolean} fromFile  whether the plan came from the evidence file
 * @returns {string}
 */
function staleOutText(inputs, records, fromFile) {
  const lines = inputs.filter((x, i) => records[i].state === 'STALE' && (fromFile || x.recorded)).map(x => x.tp.line);
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
 * @typedef {{ outcome: Outcome, target: EditTarget | null }} VerifyPass
 *   The verify result and the viewer's edit target from the same PR snapshot (null on
 *   every refusal). The target stays in memory: it never reaches stdout, a flag or a file.
 */

/**
 * @param {Io} io
 * @param {number} code
 * @param {string} reason  a fixed phrase from this file, never input bytes
 * @returns {VerifyPass}
 */
function refusedPass(io, code, reason) {
  return { outcome: refuse(io, code, reason), target: null };
}

/**
 * One verify pass: the Outcome the `verify` subcommand prints, and the edit target
 * the same snapshot gave. `posted` in the EVIDENCE line is taken from that target.
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'verify' }>} args
 * @param {MainDeps} deps
 * @returns {VerifyPass}
 */
function verifyPass(io, args, deps) {
  // Inputs first: an unusable evidence file or state directory decides before any call.
  /** @type {EvidenceInput | null} */
  let evidence = null;
  if (args.evidence !== null) {
    evidence = loadEvidence(args.evidence);
    if (evidence === null) return refusedPass(io, EXIT_CODES.INPUT_UNUSABLE, 'evidence file unusable');
    if (evidence.malformed > 0) io.notes.add('malformed-claims');
  }
  if (args.state !== null && !isRealDirectory(args.state)) return refusedPass(io, EXIT_CODES.INPUT_UNUSABLE, 'state directory unusable');

  const pr = parsePrJson(prView(io, args.pr, PR_FIELDS), args.pr);
  if (pr === null) return refusedPass(io, EXIT_CODES.REMOTE_FAILURE, 'the PR could not be read');

  const trust = resolveTrust(io, pr, args.approval);
  const record = findTrustedRecord(pr, trust);
  if (record.kind === 'unknown') io.notes.add('record-unknown');

  // D-VERIFY-RECORD: the plan is the evidence file's when it has one (local text),
  // else the PR body's block — whose TP text counts only where its hash equals the
  // trusted record's.
  const fromFile = evidence !== null && evidence.plan !== null;
  const plan = fromFile ? /** @type {any} */ (evidence).plan : bodyPlan(pr.body);
  if (plan === null) return refusedPass(io, EXIT_CODES.INPUT_UNUSABLE, 'the PR body test-plan block cannot serve as the plan');
  if (!fromFile && !coversRecord(plan, record)) {
    return refusedPass(io, EXIT_CODES.INPUT_UNUSABLE, 'the PR body test-plan block drops a TP the trusted record carries');
  }
  const inputs = tpInputs(plan, evidence, record, fromFile);
  if (inputs === null) return refusedPass(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'a TP line failed its grammar');

  const repo = prepareRepo(io, pr);
  /** @type {RunMemo} */
  const memo = { lists: new Map(), views: new Map(), htmlUrl: undefined };
  const records = inputs.map(x => {
    const v = classifyTp(io, repo, memo, x);
    return Object.freeze({ id: x.tp.id, state: v.state, sha: v.sha, outcome: v.outcome, run: v.run, exit: v.exit, hash: x.hash });
  });

  const exceptions = evidence !== null && evidence.exceptions !== null ? evidence.exceptions
    : record.kind === 'record' ? record.exceptions : [];
  const key = PE.dedupeKey({ records, exceptions }, sha256);
  const tally = PE.tally(records.map(r => r.state));
  if (!key.ok || !tally.ok) return refusedPass(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the records failed their grammar');

  const mode = publicationMode(args.publication);
  const ev = {
    head: pr.head,
    key: key.value,
    htmlUrl: mode === 'full' && records.length > 0 ? htmlUrl(io, memo) || '' : '',
    records,
    exceptions,
  };
  const body = bodyUpdate(io, plan, ev, pr.body);
  const target = editTarget(pr);
  const comment = commentUpdate(plan, ev, mode, target);
  if (body === null || comment === null) return refusedPass(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the block or the comment failed to render');

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
  if (line === null) return refusedPass(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the EVIDENCE line failed its gate');

  if (!writeOutputs(args, pr.body, body.blockText, comment.text, staleOutText(inputs, records, fromFile))) {
    return refusedPass(io, EXIT_CODES.WRITE_FAILED, 'an output file could not be written');
  }
  return { outcome: { code: EXIT_CODES.OK, stdout: line + '\n' }, target };
}

/**
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'verify' }>} args
 * @param {MainDeps} deps
 * @returns {Outcome}
 */
function runVerify(io, args, deps) {
  return verifyPass(io, args, deps).outcome;
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
// splice — the compare-and-swap (D-VERIFY-CAS)
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
 * `check wave` reads the whole file: a wave block is a PR-body section of its
 * own, never a section of an evidence file.
 *
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
  else if (args.what === 'wave') result = PE.parseWaveBlock(text, { linksOnly: args.linksOnly });
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
// The two scripted operations (D-OP-SCRIPT-POINTER)
// ---------------------------------------------------------------------------
//
// `update-pr-evidence` and `check-merge-readiness` stay defined Git operations, so a
// direct delegation still works, but each one's steps are "run this script and print
// its stdout": the two did only plumbing, and a Git spawn paid a model's turns for it.
// A command now runs `publish` or `readiness` through its own Bash tool. Both answer
// in one closed-vocabulary block, re-parsed and re-rendered at the boundary
// (D-OP-BLOCK-GATE), so a gh answer, a PR body or a check name never reaches stdout
// except as a sanitized token.

/**
 * A DEGRADED reason on stdout: lower-case words, digits, spaces and hyphens. Every
 * reason this file prints is a fixed phrase; the shape is the boundary's re-check.
 */
const REASON_RE = /^[a-z0-9][a-z0-9 -]{0,59}$/;

/** What a `publish` result prints when it could not run at all (exit 2). */
const EVIDENCE_UNAVAILABLE_LINE = 'TRACEABILITY: DEGRADED (evidence unavailable)';

/** What a `publish` result prints when the machine manifest does not say compliance is enabled (exit 2). */
const COMPLIANCE_OFF_LINE = 'TRACEABILITY: DEGRADED (compliance off)';

/** What a `publish` result prints when the machine manifest cannot be read (exit 2). */
const COMPLIANCE_UNREADABLE_LINE = 'TRACEABILITY: DEGRADED (compliance state unreadable)';

/** Every line a `publish` that did not run may print. The boundary admits each one with exit 2 only. */
const PUBLISH_REFUSAL_LINES = Object.freeze([EVIDENCE_UNAVAILABLE_LINE, COMPLIANCE_OFF_LINE, COMPLIANCE_UNREADABLE_LINE]);

/** The answer of every `publish` that could not give its block: the one line, exit 2. */
const PUBLISH_UNAVAILABLE = Object.freeze({ code: EXIT_CODES.INPUT_UNUSABLE, stdout: EVIDENCE_UNAVAILABLE_LINE + '\n' });

/**
 * Whether argv asks for `publish`. The boundary reads it after any failure, a usage
 * error and a throw included, so settleOutcome can answer a failed `publish` with
 * PUBLISH_UNAVAILABLE.
 *
 * @param {readonly string[]} argv  process.argv
 * @returns {boolean}
 */
function isPublishRun(argv) {
  return Array.isArray(argv) && argv[2] === 'publish';
}

/**
 * @typedef {{ status: string, reason: string | null }} Part
 *   One half of the `publish` answer: a closed status, or `DEGRADED` with its reason.
 */

const BODY_STATUSES = Object.freeze(['EDITED', 'UNCHANGED', 'SKIPPED']);
const COMMENT_STATUSES = Object.freeze(['POSTED', 'SKIPPED', 'OFF', 'EDITED']);

/**
 * @param {string} status
 * @returns {Part}
 */
function okPart(status) {
  return Object.freeze({ status, reason: null });
}

/**
 * @param {string} reason  a fixed phrase from this file
 * @returns {Part}
 */
function degradedPart(reason) {
  return Object.freeze({ status: 'DEGRADED', reason });
}

/**
 * @param {Part} part
 * @returns {string}
 */
function partText(part) {
  return part.status === 'DEGRADED' ? 'DEGRADED (' + part.reason + ')' : part.status;
}

/**
 * The reasons that earn a TRACEABILITY line, in print order and without repeats: a
 * degraded half names its reason, and a body edit skipped for a concurrent edit names
 * that (D4: the operation never blocks, and says what it could not do).
 *
 * @param {Part} body
 * @param {Part} comment
 * @returns {string[]}
 */
function traceReasons(body, comment) {
  /** @type {string[]} */
  const out = [];
  const add = reason => { if (reason !== null && !out.includes(reason)) out.push(reason); };
  add(body.status === 'DEGRADED' ? body.reason : body.status === 'SKIPPED' ? 'concurrent edit' : null);
  add(comment.status === 'DEGRADED' ? comment.reason : null);
  return out;
}

/**
 * The test-plan tally that both scripted blocks print: `<verified>/<total>`, the given
 * word, then the two counts that make up `verified`. The readiness block prints it with
 * no word and the publish block with ` verified`.
 *
 * @param {{ total: number, counts: Readonly<Record<string, number>> }} fields  the parsed EVIDENCE line
 * @param {'' | ' verified'} word
 * @returns {string}
 */
function planTally(fields, word) {
  const verifiedCi = fields.counts['VERIFIED-CI'];
  const attestedLocal = fields.counts['ATTESTED-LOCAL'];
  return (verifiedCi + attestedLocal) + '/' + fields.total + word
    + ' (VERIFIED-CI ' + verifiedCi + ', ATTESTED-LOCAL ' + attestedLocal + ')';
}

/**
 * The `## PR Evidence` block of the update-pr-evidence contract: the EVIDENCE line, the
 * `Test plan:` line read from it, the Body and Comment line, then its TRACEABILITY lines.
 * The caller holds the precondition that `evidenceLine` parses; a line that does not is a
 * broken invariant, which the catch in main turns into "evidence unavailable".
 *
 * @param {string} evidenceLine
 * @param {Part} body
 * @param {Part} comment
 * @returns {string}
 */
function renderPublishBlock(evidenceLine, body, comment) {
  const evidence = PE.parseEvidenceLine(evidenceLine);
  if (!evidence.ok) throw new Error('verify-evidence: unchecked evidence line');
  const lines = [
    '## PR Evidence',
    evidenceLine,
    'Test plan: ' + planTally(evidence.value, ' verified'),
    '**Body**: ' + partText(body) + ' · **Comment**: ' + partText(comment),
    ...traceReasons(body, comment).map(r => 'TRACEABILITY: DEGRADED (' + r + ')'),
  ];
  return lines.join('\n') + '\n';
}

const PUBLISH_PARTS_RE = /^\*\*Body\*\*: (?<body>[A-Z]+|DEGRADED \([a-z0-9][a-z0-9 -]{0,59}\)) · \*\*Comment\*\*: (?<comment>[A-Z]+|DEGRADED \([a-z0-9][a-z0-9 -]{0,59}\))$/;

/**
 * @param {string} text
 * @param {readonly string[]} statuses
 * @returns {Part | null}
 */
function parsePart(text, statuses) {
  if (statuses.includes(text)) return okPart(text);
  const m = /^DEGRADED \((.+)\)$/.exec(text);
  return m !== null && REASON_RE.test(m[1]) ? degradedPart(m[1]) : null;
}

/**
 * D-OP-BLOCK-GATE: read a `publish` block back into its parts, or null when it is not
 * exactly what renderPublishBlock prints, so a `Test plan:` line that disagrees with the
 * EVIDENCE line is refused. The boundary prints a block only when this accepts it.
 *
 * @param {string} text  the whole stdout, its final newline included
 * @returns {{ evidenceLine: string, body: Part, comment: Part } | null}
 */
function parsePublishBlock(text) {
  if (typeof text !== 'string' || !text.endsWith('\n') || text.length > 8192) return null;
  const lines = text.slice(0, -1).split('\n');
  if (lines.length < 4 || lines.length > 6 || lines[0] !== '## PR Evidence') return null;
  if (!PE.parseEvidenceLine(lines[1]).ok) return null;
  const m = PUBLISH_PARTS_RE.exec(lines[3]);
  if (m === null || m.groups === undefined) return null;
  const body = parsePart(m.groups.body, BODY_STATUSES);
  const comment = parsePart(m.groups.comment, COMMENT_STATUSES);
  if (body === null || comment === null) return null;
  return renderPublishBlock(lines[1], body, comment) === text ? { evidenceLine: lines[1], body, comment } : null;
}

/**
 * A `publish` that could not run: the one line, exit 2, and the reason on stderr.
 *
 * @param {Io} io
 * @param {string} reason  a fixed phrase from this file, for stderr
 * @returns {Outcome}
 */
function evidenceUnavailable(io, reason) {
  io.stderr('verify-evidence: publish: ' + reason + '\n');
  return PUBLISH_UNAVAILABLE;
}

/**
 * D-PUBLISH-SCRUB-GATE: the D11 scrub of a file bound for a PR, the file sink. True
 * only when the scrubber ran and exited 0; a missing script, a crash, a timeout and a
 * non-zero exit are all "do not post". The caller posts nothing after a false.
 *
 * @param {Io} io
 * @param {string} input
 * @param {string} output
 * @returns {boolean}
 */
function scrub(io, input, output) {
  return runCall(io, process.execPath, [REDACT_SCRIPT, input, output], REDACT_TIMEOUT_MS, LINE_MAX_BUFFER).ok;
}

/**
 * @param {CallResult} r
 * @returns {boolean}  true when the call failed with an HTTP 5xx answer
 */
function isServerError(r) {
  return !r.ok && answered(r) && /HTTP 5[0-9]{2}\b/.test(r.stderr);
}

/**
 * One gh write with the retry the operation allows: a 5xx answer is tried once more,
 * never a second time, and nothing else is retried.
 *
 * @param {Io} io
 * @param {readonly string[]} args
 * @returns {{ ok: boolean, serverError: boolean }}
 */
function ghWrite(io, args) {
  let r = gh(io, args, LINE_MAX_BUFFER);
  if (isServerError(r)) r = gh(io, args, LINE_MAX_BUFFER);
  return { ok: r.ok, serverError: isServerError(r) };
}

/**
 * The DEGRADED part for a gh write that failed: the 5xx phrase after a server error,
 * else the phrase of the failed step. It runs no gh call.
 *
 * @param {{ ok: boolean, serverError: boolean }} result  what ghWrite returned
 * @param {string} reason  a fixed phrase from this file
 * @returns {Part}
 */
function writeFailedPart(result, reason) {
  return degradedPart(result.serverError ? '5xx on update-pr-evidence' : reason);
}

/**
 * The context for the writes: a gh budget and a deadline of their own, the same
 * notes. The throttle flag carries over, so a rate limit that verify hit stops the
 * writes too.
 *
 * @param {Io} io
 * @returns {Io}
 */
function writeStageIo(io) {
  return Object.assign({}, io, {
    deadline: io.now() + PUBLISH_DEADLINE_MS,
    budget: { ghCalls: 0, runViews: 0, throttled: io.budget.throttled },
    ghCap: PUBLISH_GH_CALLS,
  });
}

/**
 * The body half of update-pr-evidence: scrub the composed block, splice it into the
 * body (the compare-and-swap), edit, read back. Each step runs only when the one
 * before it succeeded, so `gh pr edit` never runs after a failed scrub or a refused
 * splice.
 *
 * @param {Io} io  the write-stage context
 * @param {number} pr
 * @param {{ body: string }} fields  the EVIDENCE line's fields
 * @param {{ state: string, notesRaw: string, notes: string, body: string }} files
 * @returns {Part}
 */
function publishBody(io, pr, fields, files) {
  if (fields.body !== 'changed') return okPart('UNCHANGED');
  if (!scrub(io, files.notesRaw, files.notes)) return degradedPart('redaction unavailable');
  const spliced = runSplice(io, { kind: 'splice', pr, state: files.state, block: files.notes, out: files.body });
  const token = SPLICE_LINE_RE.exec(stripOneNewline(spliced.stdout));
  if (token === null || token.groups === undefined) return degradedPart('splice unavailable');
  const outcome = token.groups.outcome;
  if (outcome === 'conflict') return okPart('SKIPPED');
  if (outcome !== 'ok' && outcome !== 'resplice') return degradedPart('splice ' + outcome);
  const edit = ghWrite(io, ['pr', 'edit', String(pr), '--body-file', files.body]);
  if (!edit.ok) return writeFailedPart(edit, 'gh pr edit failed');
  const back = runReadback(io, { kind: 'readback', pr, expect: files.body });
  return back.code === EXIT_CODES.OK && back.stdout === 'READBACK ok\n' ? okPart('EDITED') : degradedPart('body read-back mismatch');
}

/**
 * Whether the comment just edited now reads back as the scrubbed text: one GET of it
 * as a JSON string, compared after one trailing newline is normalised on each side.
 * The edit itself runs silent, so this is the only read of the comment. Any failure
 * to read or parse is "no". Neither the comment nor gh's stderr is printed.
 *
 * @param {Io} io  the write-stage context
 * @param {string} id  a comment id commentIdOf produced
 * @param {string} expected  the scrubbed comment text (never the unscrubbed file)
 * @returns {boolean}
 */
function commentReadsBack(io, id, expected) {
  const r = gh(io, ['api', 'repos/{owner}/{repo}/issues/comments/' + commentIdArg(id), '--jq', '.body | @json'], COMMENT_READ_MAX_BUFFER);
  if (!r.ok) return false;
  try {
    const body = JSON.parse(stripOneNewline(r.stdout.toString('utf8')));
    return typeof body === 'string' && stripOneNewline(body) === stripOneNewline(expected);
  } catch (_) {
    return false;
  }
}

/**
 * The comment half: the evidence comment, scrubbed (D11) and re-measured after the
 * scrub. When the viewer's own evidence comment is a safe target (no strict marker
 * from another login follows it), that comment is edited in place (one PATCH of the
 * scrubbed file) and read back against it. Otherwise a new comment is posted once.
 * A comment that already carries this head and key is skipped. An own target with no
 * readable id is DEGRADED before the scrub, with no write. A failed edit or
 * read-back is a DEGRADED result and never falls back to a post. Nothing is deleted.
 *
 * @param {Io} io  the write-stage context
 * @param {number} pr
 * @param {{ posted: string }} fields  the EVIDENCE line's fields
 * @param {{ commentRaw: string, comment: string }} files
 * @param {EditTarget | null} target  the viewer's newest evidence comment in the snapshot
 *   verify read, or null when there is none
 * @returns {Part}
 */
function publishComment(io, pr, fields, files, target) {
  if (fields.posted === 'yes') return okPart('SKIPPED');
  if (fields.posted === 'n/a') return okPart('OFF');
  const edit = target !== null && target.editable;
  if (edit && target.id === '') return degradedPart('comment id unreadable');
  if (!scrub(io, files.commentRaw, files.comment)) return degradedPart('redaction unavailable');
  const text = readTextFile(files.comment);
  if (text === null || text === '') return degradedPart('redaction unavailable');
  if (text.length > COMMENT_POST_MAX_CHARS) return degradedPart('comment over size cap');
  if (edit) {
    const patch = ghWrite(io, ['api', '--method', 'PATCH',
      'repos/{owner}/{repo}/issues/comments/' + commentIdArg(target.id),
      '-F', 'body=@' + files.comment, '--silent']);
    if (!patch.ok) return writeFailedPart(patch, 'comment edit failed');
    return commentReadsBack(io, target.id, text) ? okPart('EDITED') : degradedPart('comment read-back mismatch');
  }
  const post = ghWrite(io, ['pr', 'comment', String(pr), '--body-file', files.comment]);
  return post.ok ? okPart('POSTED') : writeFailedPart(post, 'gh pr comment failed');
}

/**
 * The machine manifest, ~/.devflow/manifest.json, or null when the home directory is
 * not absolute (a relative one would resolve against the repository). No environment
 * variable relocates it, and no repository file stands in for it.
 *
 * @returns {string | null}
 */
function machineManifestPath() {
  let home;
  try {
    home = os.homedir();
  } catch (_) {
    return null;
  }
  return typeof home === 'string' && path.isAbsolute(home) ? path.join(home, '.devflow', 'manifest.json') : null;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The compliance switch of the machine manifest, read with this file's regular-file
 * rules (a link is followed, as every other reader of the machine manifest does). The
 * accepted shape is the one the CLI keeps, `features.compliance` as
 * `{ enabled: boolean, frameworks: string[] }`; a manifest from before compliance
 * existed has no such key and reads as off. A value in any other shape is `unreadable`,
 * where the CLI heals it to off: this guard only lets a publish through on a record it
 * can trust.
 *
 * @param {string | null} manifestPath
 * @returns {'enabled' | 'off' | 'unreadable'}
 */
function machineComplianceState(manifestPath) {
  if (manifestPath === null) return 'unreadable';
  const text = readTextFile(manifestPath);
  if (text === null) return 'unreadable';
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (_) {
    return 'unreadable';
  }
  if (!isRecord(manifest) || !isRecord(manifest.features)) return 'unreadable';
  const compliance = manifest.features.compliance;
  if (compliance === undefined) return 'off';
  if (!isRecord(compliance) || typeof compliance.enabled !== 'boolean') return 'unreadable';
  if (!Array.isArray(compliance.frameworks) || !compliance.frameworks.every(f => typeof f === 'string')) return 'unreadable';
  return compliance.enabled ? 'enabled' : 'off';
}

/**
 * The publish guard: with compliance off, or its state unreadable, `publish` ends here,
 * before a work directory is made and before any gh call. It reads the machine manifest
 * under the user's home folder and nothing else, so no repository file can switch it on.
 * It ignores the devflow folder override. It returns its outcome and never throws: the
 * catch in main turns a throw into "evidence unavailable", which would hide the reason.
 *
 * @param {Io} io
 * @param {MainDeps} deps
 * @returns {Outcome | null}  the refusal, or null when compliance is enabled
 */
function publishRefusal(io, deps) {
  const state = machineComplianceState(typeof deps.manifestPath === 'string' ? deps.manifestPath : machineManifestPath());
  if (state === 'enabled') return null;
  io.stderr('verify-evidence: publish: '
    + (state === 'off' ? 'compliance is off on this machine' : 'the machine compliance state could not be read') + '\n');
  return { code: EXIT_CODES.INPUT_UNUSABLE, stdout: (state === 'off' ? COMPLIANCE_OFF_LINE : COMPLIANCE_UNREADABLE_LINE) + '\n' };
}

/**
 * The whole update-pr-evidence operation, in the order the operation always had:
 * the compliance guard; verify; only on `body:changed` scrub, splice, `gh pr edit`,
 * read back; only on `posted:no` scrub, then edit the viewer's own evidence comment in
 * place and read it back, or post a new one when there is none to edit or a newer
 * evidence comment from another login follows it. The work files live in one private
 * directory this call makes and removes.
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'publish' }>} args
 * @param {MainDeps} deps
 * @returns {Outcome}
 */
function runPublish(io, args, deps) {
  const refused = publishRefusal(io, deps);
  if (refused !== null) return refused;
  /** @type {string} */
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-evidence-'));
  } catch (_) {
    return evidenceUnavailable(io, 'the work directory could not be made');
  }
  try {
    const file = name => path.join(dir, name);
    const state = file('state');
    try {
      fs.mkdirSync(state, { mode: 0o700 });
    } catch (_) {
      return evidenceUnavailable(io, 'the state directory could not be made');
    }
    const files = {
      state,
      notesRaw: file('notes.raw'),
      notes: file('notes'),
      body: file('body'),
      commentRaw: file('comment.raw'),
      comment: file('comment'),
    };
    const verified = verifyPass(io, {
      kind: 'verify', pr: args.pr, publication: args.publication, evidence: args.evidence, state,
      blockOut: files.notesRaw, commentOut: files.commentRaw, staleOut: null, approval: false,
    }, deps);
    if (verified.outcome.code !== EXIT_CODES.OK) return evidenceUnavailable(io, 'verify did not answer');
    const line = stripOneNewline(verified.outcome.stdout);
    const parsed = PE.parseEvidenceLine(line);
    if (!parsed.ok || parsed.value.pr !== args.pr) return evidenceUnavailable(io, 'verify answered something else');

    const stage = writeStageIo(io);
    const body = publishBody(stage, args.pr, parsed.value, files);
    const comment = publishComment(stage, args.pr, parsed.value, files, verified.target);
    return { code: EXIT_CODES.OK, stdout: renderPublishBlock(line, body, comment) };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* the OS clears its temp directory */ }
  }
}

// --- readiness ----------------------------------------------------------------

/**
 * @typedef {{ total: number, verifiedCi: number, attestedLocal: number,
 *   testPlanException: boolean, approval: string }} EvidenceFacts
 *   What the ladder reads of the EVIDENCE line. Null means the evidence is unknown.
 *
 * @typedef {{ unresolved: number, approximate: boolean, decision: string | null,
 *   ci: string, failing: string, evidence: EvidenceFacts | null, require: string }} ReadinessFacts
 *   `decision` is APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, null, or UNRECOGNISED;
 *   `failing` is ci-wait's formatted failing-check names; `require` is `true`, `false`
 *   or `unrecognised`.
 */

/**
 * D-READINESS-LADDER: check-merge-readiness step 5, first matching rule wins. READY is
 * a positive conjunction and the last arm is `status unknown`, so an input no arm
 * names can never read READY. tests/evidence/merge-readiness.test.ts holds this to
 * the reference's prose arms (same labels, same order) and to a model over the whole
 * fact domain.
 *
 * @param {ReadinessFacts} f
 * @returns {{ status: 'READY' | 'NOT_READY', reason: string | null }}
 */
function readinessVerdict(f) {
  /** @param {string} reason */
  const notReady = reason => ({ status: /** @type {const} */ ('NOT_READY'), reason });
  const ev = f.evidence;
  if (f.unresolved > 0) return notReady('unresolved threads: ' + (f.approximate ? '>' : '') + f.unresolved);
  if (f.decision === 'CHANGES_REQUESTED') return notReady('changes requested');
  if (f.ci === 'FAILING') return notReady('CI failing: ' + f.failing);
  if (f.ci === 'PENDING') return notReady('CI pending');
  if (f.decision === 'REVIEW_REQUIRED' || f.decision === null) return notReady('no approving review');
  if (ev === null) return notReady('test-plan evidence unavailable');
  if (f.require === 'true' && ev.approval !== 'yes') return notReady('no non-author approval');
  const verified = ev.verifiedCi + ev.attestedLocal;
  if (ev.total === 0 && !ev.testPlanException) return notReady('no test-plan evidence');
  if (verified < ev.total) return notReady('test plan: ' + verified + '/' + ev.total + ' verified');
  const planHolds = (ev.total >= 1 && verified === ev.total) || (ev.total === 0 && ev.testPlanException);
  const ready = f.unresolved === 0 && !f.approximate && f.decision === 'APPROVED'
    && (f.ci === 'PASSING' || f.ci === 'NO_CI') && (ev.approval === 'yes' || f.require === 'false') && planHolds;
  return ready ? { status: 'READY', reason: null } : notReady('status unknown');
}

/**
 * @typedef {{ pr: number, status: 'READY' | 'NOT_READY' | 'DEGRADED', reason: string | null,
 *   threads: string, decision: string, ci: string, plan: string, approval: string }} ReadinessBlock
 *   Every field after `reason` is the text of one Details line's value.
 */

/**
 * The `## Merge Readiness` block of the check-merge-readiness contract. A DEGRADED
 * block ends with its TRACEABILITY line.
 *
 * @param {ReadinessBlock} b
 * @returns {string}
 */
function renderReadinessBlock(b) {
  const status = b.status === 'READY' ? 'READY' : b.status + ' (' + b.reason + ')';
  const lines = [
    '## Merge Readiness',
    '**PR**: #' + b.pr,
    '**Status**: ' + status,
    '',
    '### Details',
    '- Unresolved threads: ' + b.threads,
    '- Review decision: ' + b.decision,
    '- CI status: ' + b.ci,
    '- Test plan: ' + b.plan + ' · non-author approval: ' + b.approval,
  ];
  if (b.status === 'DEGRADED') lines.push('TRACEABILITY: DEGRADED (' + b.reason + ')');
  return lines.join('\n') + '\n';
}

/** A NOT_READY reason: the ladder's fixed phrases, with numbers and sanitized check names. */
const NOT_READY_REASON_RE = /^(?:unresolved threads: >?[0-9]{1,4}|changes requested|CI failing: [A-Za-z0-9 ._()/:+,-]{1,200}|CI pending|no approving review|test-plan evidence unavailable|no non-author approval|no test-plan evidence|test plan: [0-9]{1,3}\/[0-9]{1,3} verified|status unknown)$/;
const READINESS_THREADS_RE = /^(?:[0-9]{1,4}|>[0-9]{1,4} \(count approximate — PR has more than 100 threads\)|unavailable)$/;
const READINESS_DECISIONS = Object.freeze(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'none', 'unrecognised', 'unavailable']);
const READINESS_CI = Object.freeze(['PASSING', 'FAILING', 'PENDING', 'NO_CI', 'NO_PR', 'INDETERMINATE', 'unavailable']);
const READINESS_PLAN_RE = /^(?:[0-9]{1,3}\/[0-9]{1,3} \(VERIFIED-CI [0-9]{1,3}, ATTESTED-LOCAL [0-9]{1,3}\)|unavailable)$/;
const READINESS_APPROVALS = Object.freeze(['yes', 'no', 'not required']);

/**
 * D-OP-BLOCK-GATE: read a `## Merge Readiness` block back into its fields, or null
 * when it is not exactly what renderReadinessBlock prints.
 *
 * @param {string} text  the whole stdout, its final newline included
 * @returns {ReadinessBlock | null}
 */
function parseReadinessBlock(text) {
  if (typeof text !== 'string' || !text.endsWith('\n') || text.length > 4096) return null;
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== 9 && lines.length !== 10) return null;
  const pr = /^\*\*PR\*\*: #([1-9][0-9]{0,9})$/.exec(lines[1]);
  const status = /^\*\*Status\*\*: (READY|(NOT_READY|DEGRADED) \((.+)\))$/.exec(lines[2]);
  const threads = /^- Unresolved threads: (.+)$/.exec(lines[5]);
  const decision = /^- Review decision: (.+)$/.exec(lines[6]);
  const ci = /^- CI status: (.+)$/.exec(lines[7]);
  const plan = /^- Test plan: (.+) · non-author approval: (.+)$/.exec(lines[8]);
  if (pr === null || status === null || threads === null || decision === null || ci === null || plan === null) return null;
  const kind = status[1] === 'READY' ? 'READY' : status[2];
  const reason = kind === 'READY' ? null : status[3];
  if (kind === 'NOT_READY' && !NOT_READY_REASON_RE.test(reason)) return null;
  if (kind === 'DEGRADED' && !REASON_RE.test(reason)) return null;
  if (!READINESS_THREADS_RE.test(threads[1]) || !READINESS_DECISIONS.includes(decision[1])) return null;
  if (!READINESS_CI.includes(ci[1]) || !READINESS_PLAN_RE.test(plan[1]) || !READINESS_APPROVALS.includes(plan[2])) return null;
  /** @type {ReadinessBlock} */
  const block = {
    pr: Number(pr[1]), status: /** @type {ReadinessBlock['status']} */ (kind), reason,
    threads: threads[1], decision: decision[1], ci: ci[1], plan: plan[1], approval: plan[2],
  };
  return renderReadinessBlock(block) === text ? block : null;
}

/**
 * A read of the PR: its value, or the fixed reason it could not be read.
 *
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, reason: string }} Read
 */

/**
 * @param {CallResult} r  a failed call
 * @returns {string}
 */
function readFailure(r) {
  if (r.refused === 'throttled') return 'rate limited';
  if (r.refused !== null) return 'gh budget spent';
  return /Could not resolve to a PullRequest/.test(r.stderr) ? 'no pr' : 'gh unavailable';
}

/**
 * @param {unknown} text
 * @returns {unknown | null}  the parsed JSON, or null
 */
function parseJsonOrNull(text) {
  try {
    return JSON.parse(String(text));
  } catch (_) {
    return null;
  }
}

/**
 * The PR's review decision, merge state and head, from one `gh pr view` read. The
 * decision answers `""` or null when no rule asks for a review; a string outside the
 * three documented values reads UNRECOGNISED, and the ladder never lets that reach READY.
 * `mergeable` is the string GitHub printed, or null when the key is absent or not a
 * string; `head` is the PR head when it is 40 lowercase hex, else null. Neither makes the
 * decision unreadable: the CI read treats them as unknown and never as a pass.
 *
 * @param {Io} io
 * @param {number} pr
 * @returns {Read<{ decision: string | null, mergeable: string | null, head: string | null }>}
 */
function readPrView(io, pr) {
  const r = gh(io, ['pr', 'view', String(pr), '--json', 'reviewDecision,mergeable,headRefOid'], LINE_MAX_BUFFER);
  if (!r.ok) return { ok: false, reason: readFailure(r) };
  const fields = obj(parseJsonOrNull(r.stdout.toString('utf8')));
  const value = fields.reviewDecision;
  const mergeable = typeof fields.mergeable === 'string' ? fields.mergeable : null;
  const head = typeof fields.headRefOid === 'string' && SHA40_RE.test(fields.headRefOid) ? fields.headRefOid : null;
  if (value === null || value === '') return { ok: true, value: { decision: null, mergeable, head } };
  if (typeof value !== 'string') return { ok: false, reason: 'review decision unreadable' };
  const decision = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(value) ? value : 'UNRECOGNISED';
  return { ok: true, value: { decision, mergeable, head } };
}

/**
 * D-READINESS-THREADS: the unresolved review threads among the first 100, with
 * `totalCount` deciding whether that count is approximate. The query is a constant;
 * the repository and the number are variables, never text in the query. A node whose
 * `isResolved` is not a boolean makes the whole read unreadable, since a thread that
 * cannot be told resolved must not read as resolved.
 */
const THREADS_QUERY = 'query($owner: String!, $repo: String!, $pr: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $pr) { reviewThreads(first: 100) { totalCount nodes { isResolved } } } } }';
const THREADS_PAGE = 100;

/**
 * @param {Io} io
 * @param {number} pr
 * @returns {Read<{ unresolved: number, approximate: boolean }>}
 */
function readThreads(io, pr) {
  const r = gh(io, [
    'api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', 'pr=' + pr, '-f', 'query=' + THREADS_QUERY,
  ], READINESS_MAX_BUFFER);
  if (!r.ok) return { ok: false, reason: readFailure(r) };
  const data = obj(obj(obj(obj(parseJsonOrNull(r.stdout.toString('utf8'))).data).repository).pullRequest);
  const threads = obj(data.reviewThreads);
  const nodes = threads.nodes;
  const total = threads.totalCount;
  if (!Array.isArray(nodes) || nodes.length > THREADS_PAGE || !Number.isInteger(total) || total < nodes.length) {
    return { ok: false, reason: 'review threads unreadable' };
  }
  let unresolved = 0;
  for (const node of nodes) {
    const resolved = obj(node).isResolved;
    if (typeof resolved !== 'boolean') return { ok: false, reason: 'review threads unreadable' };
    if (!resolved) unresolved++;
  }
  return { ok: true, value: { unresolved, approximate: total > THREADS_PAGE } };
}

/** CI that could not be established: the ladder reads it as `status unknown`, never READY. */
const CI_INDETERMINATE = Object.freeze({ status: 'INDETERMINATE', failing: '-' });

/**
 * D-READINESS-WORKFLOWS: whether the repository has an active workflow file, by ci-wait's
 * one read-only call and parser. A call that fails or is refused, and a reply the parser
 * cannot read, give null: not knowing, never "no workflow file".
 *
 * @param {Io} io
 * @returns {boolean | null}
 */
function probeWorkflows(io) {
  const r = gh(io, CW.WORKFLOWS_ARGS, READINESS_MAX_BUFFER);
  return r.ok ? CW.parseActiveWorkflows(r.stdout.toString('utf8')) : null;
}

/**
 * An empty check list: ci-wait's merge gate decides (D-CI-WORKFLOWS). The workflow list
 * is asked only when the gate asks for it, so a PR that cannot be NO_CI costs no call. A
 * gate answer other than keep is INDETERMINATE.
 *
 * @param {Io} io
 * @param {string | null} mergeable
 * @returns {{ status: string, failing: string }}
 */
function readEmptyCi(io, mergeable) {
  const first = CW.mergeGate('NO_CI', mergeable);
  const gate = first === 'probe' ? CW.mergeGate('NO_CI', mergeable, probeWorkflows(io)) : first;
  return gate === 'keep' ? { status: 'NO_CI', failing: '-' } : CI_INDETERMINATE;
}

/**
 * D-READINESS-CLASSIFIER: the CI status, read once. The checks come from `gh pr checks`
 * over name,state,bucket,workflow, with check-ci-status's exit rule (exit 0 or 8 is a
 * result; any other failure is INDETERMINATE). The rows come from ci-wait's parser, and the
 * status from ci-wait's classifier (D-CI-WORKFLOW-RULE) and merge gate (D-CI-MERGE-STATE,
 * D-CI-WORKFLOWS), where the rules are written, so the two scripts cannot disagree. A
 * conflicting PR reads INDETERMINATE before any checks call, and "no checks reported" or
 * `[]` goes to readEmptyCi. An unknown merge state, a failed workflow-list call and an
 * unreadable reply are INDETERMINATE, never DEGRADED. Failing names are sanitized and
 * bounded by ci-wait's own formatter. PASSING does not prove that the test workflow ran by
 * name.
 *
 * @param {Io} io
 * @param {number} pr
 * @param {string | null} mergeable  GitHub's merge state of the PR, from readPrView
 * @returns {{ status: string, failing: string }}
 */
function readCi(io, pr, mergeable) {
  if (CW.isConflicting(mergeable)) return CI_INDETERMINATE;
  const r = gh(io, ['pr', 'checks', String(pr), '--json', 'name,state,bucket,workflow'], READINESS_MAX_BUFFER);
  if (!answered(r)) return CI_INDETERMINATE;
  if (r.status !== 0 && r.status !== 8) {
    if (/Could not resolve to a PullRequest/.test(r.stderr)) return { status: 'NO_PR', failing: '-' };
    return /no checks reported/i.test(r.stderr) ? readEmptyCi(io, mergeable) : CI_INDETERMINATE;
  }
  const checks = CW.parseChecks(r.stdout.toString('utf8'));
  if (checks === null) return CI_INDETERMINATE;
  if (checks.length === 0) return readEmptyCi(io, mergeable);
  const c = CW.classifyChecks(checks);
  if (CW.mergeGate(c.status, mergeable, null) !== 'keep') return CI_INDETERMINATE;
  return { status: c.status, failing: CW.formatNames(c.failing) };
}

/**
 * D-READINESS-HEAD: CI counts for one head. `gh pr checks` answers for whatever head the
 * PR has when it is called, and the evidence is read after it, so a push in between would
 * pair a CI result with evidence of another head. PASSING and NO_CI stand only when the
 * head read with the review decision, before the checks call, and the head the evidence
 * was read at are both 40 lowercase hex and equal; otherwise CI is INDETERMINATE. FAILING,
 * PENDING and the rest stay: they hold the ladder back on their own.
 *
 * @param {{ status: string, failing: string }} ci
 * @param {unknown} viewHead  the head read before the checks call, or null
 * @param {unknown} evidenceHead  the head the evidence was read at, or null when it is unknown
 * @returns {{ status: string, failing: string }}
 */
function bindCiHead(ci, viewHead, evidenceHead) {
  if (ci.status !== 'PASSING' && ci.status !== 'NO_CI') return ci;
  /** @param {unknown} head */
  const isHead = head => typeof head === 'string' && SHA40_RE.test(head);
  const bound = isHead(viewHead) && isHead(evidenceHead) && viewHead === evidenceHead;
  return bound ? ci : CI_INDETERMINATE;
}

/**
 * The test-plan evidence at the head, by `verify --approval`: known only on exit 0
 * with one EVIDENCE line for this PR (the old step 4's rule). `evidence` is the local
 * evidence file `readiness --evidence` names, or null to read the PR's own record.
 *
 * @param {Io} io
 * @param {number} pr
 * @param {string | null} evidence
 * @param {MainDeps} deps
 * @returns {any | null}  the parsed EVIDENCE fields, or null when the evidence is unknown
 */
function readEvidence(io, pr, evidence, deps) {
  const verified = runVerify(io, {
    kind: 'verify', pr, publication: '', evidence, state: null,
    blockOut: null, commentOut: null, staleOut: null, approval: true,
  }, deps);
  if (verified.code !== EXIT_CODES.OK) return null;
  const parsed = PE.parseEvidenceLine(stripOneNewline(verified.stdout));
  return parsed.ok && parsed.value.pr === pr ? parsed.value : null;
}

/**
 * @param {string} require  `true`, `false` or `unrecognised`
 * @param {EvidenceFacts | null} evidence
 * @returns {string}
 */
function approvalText(require, evidence) {
  if (require === 'false') return 'not required';
  return evidence !== null && evidence.approval === 'yes' ? 'yes' : 'no';
}

/**
 * @param {string | null} decision  the review decision from readPrView
 * @returns {string}  the word the Details line prints for it
 */
function decisionLabel(decision) {
  if (decision === null) return 'none';
  return decision === 'UNRECOGNISED' ? 'unrecognised' : decision;
}

/**
 * A readiness answer that could not be reached: a DEGRADED block (exit 2) whose Details
 * say `unavailable` for what was never read.
 *
 * @param {number} pr
 * @param {string} reason
 * @param {Partial<ReadinessBlock>} known
 * @returns {Outcome}
 */
function readinessDegraded(pr, reason, known) {
  return {
    code: EXIT_CODES.INPUT_UNUSABLE,
    stdout: renderReadinessBlock({
      pr, status: 'DEGRADED', reason,
      threads: known.threads || 'unavailable', decision: known.decision || 'unavailable',
      ci: known.ci || 'unavailable', plan: 'unavailable', approval: known.approval || 'no',
    }),
  };
}

/**
 * The whole check-merge-readiness operation. Report-only: it reads, classifies and
 * prints; it never acts on the PR. A PR it cannot read, or a review decision or thread
 * count it cannot establish, is DEGRADED; an unreadable CI status or unknown evidence
 * is an input to the ladder, which never lets either reach READY.
 *
 * @typedef {{ outcome: Outcome, head: string | null }} ReadinessPass
 *   The answer, and the PR head its first read gave (null when that read gave none).
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'readiness' }>} args
 * @param {MainDeps} deps
 * @returns {ReadinessPass}
 */
function readinessPass(io, args, deps) {
  const unreadApproval = approvalText(args.requireNonAuthor, null);
  const view = readPrView(io, args.pr);
  if (!view.ok) return { outcome: readinessDegraded(args.pr, view.reason, { approval: unreadApproval }), head: null };
  const head = view.value.head;
  const reviewDecision = view.value.decision;
  const decisionText = decisionLabel(reviewDecision);
  const threads = readThreads(io, args.pr);
  if (!threads.ok) {
    return { outcome: readinessDegraded(args.pr, threads.reason, { decision: decisionText, approval: unreadApproval }), head };
  }
  const ciRead = readCi(io, args.pr, view.value.mergeable);
  const fields = readEvidence(io, args.pr, args.evidence, deps);
  const ci = bindCiHead(ciRead, view.value.head, fields === null ? null : fields.head);
  /** @type {EvidenceFacts | null} */
  const evidence = fields === null ? null : {
    total: fields.total,
    verifiedCi: fields.counts['VERIFIED-CI'],
    attestedLocal: fields.counts['ATTESTED-LOCAL'],
    testPlanException: fields.exceptions.includes('test-plan'),
    approval: fields.approval,
  };
  const verdict = readinessVerdict({
    unresolved: threads.value.unresolved,
    approximate: threads.value.approximate,
    decision: reviewDecision,
    ci: ci.status,
    failing: ci.failing,
    evidence,
    require: args.requireNonAuthor,
  });
  const block = {
    pr: args.pr,
    status: verdict.status,
    reason: verdict.reason,
    threads: threads.value.approximate
      ? '>' + threads.value.unresolved + ' (count approximate — PR has more than 100 threads)'
      : String(threads.value.unresolved),
    decision: decisionText,
    ci: ci.status,
    plan: fields === null ? 'unavailable' : planTally(fields, ''),
    approval: approvalText(args.requireNonAuthor, evidence),
  };
  return { outcome: { code: EXIT_CODES.OK, stdout: renderReadinessBlock(block) }, head };
}

/**
 * D-READINESS-OUT: `readiness --out <file>`. The file holds the READINESS line, then the
 * block exactly as it prints. The status in the line is the one the block's own parse
 * gives, so the line and the block cannot disagree. The head is the PR head the first
 * read gave, or `none`. The source is `local` when the plan was asked for from the
 * `--evidence` file and `pr` when it was asked for from the PR's own record; the line
 * ends with it as `source=<local|pr>`, and any other value is refused like a block that
 * does not parse. writeTextFile refuses a path that exists and is not a regular
 * file, a symlink included, so no link is followed. The command makes no gh write.
 *
 * One rule covers every outcome: a file from an earlier run never outlives this run.
 * runReadiness removes the earlier regular file before the first read; here, a block the
 * output gate would refuse is never written and is the gate's refusal, and a file that
 * cannot be written is the write refusal, with the regular file the write left removed.
 * Either way nothing is printed and no out file remains. A path that git tracks never
 * gets here: admitPaths refuses it first and leaves the file as it is.
 *
 * @param {Io} io
 * @param {string} file
 * @param {number} pr
 * @param {Outcome} outcome  the answer readinessPass or readinessDegraded gave
 * @param {string | null} head
 * @param {string | undefined} source  one of READINESS_SOURCES
 * @returns {Outcome}
 */
function writeReadinessOut(io, file, pr, outcome, head, source) {
  const block = parseReadinessBlock(outcome.stdout);
  if (block === null || !READINESS_SOURCES.includes(/** @type {string} */ (source))) {
    removeOutFile(file);
    return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, 'the readiness out file failed its grammar');
  }
  const line = [
    'READINESS', 'pr:' + pr, 'head:' + (head === null ? 'none' : head), 'status:' + block.status, 'source=' + source,
  ].join(' ');
  if (!writeTextFile(file, line + '\n' + outcome.stdout)) {
    removeOutFile(file);
    return refuse(io, EXIT_CODES.WRITE_FAILED, 'an output file could not be written');
  }
  return outcome;
}

/**
 * Remove the regular file an earlier run left at `file`. A path that names nothing, a
 * link, a FIFO or a directory is left as it is: writeTextFile creates the first and
 * refuses the rest. The lstat never follows a link. False when a regular file could not
 * be removed.
 *
 * @param {string} file
 * @returns {boolean}
 */
function removeOutFile(file) {
  try {
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (st !== undefined && st.isFile()) fs.unlinkSync(file);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Where the run asked for the test plan: the local evidence file `--evidence` names, or the
 * PR's own record. It follows the flag alone, so every status of one invocation names the
 * same source.
 *
 * @param {Extract<ParsedArgs, { kind: 'readiness' }>} args
 * @returns {'local' | 'pr'}
 */
function planSource(args) {
  return args.evidence === null ? 'pr' : 'local';
}

/**
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'readiness' }>} args
 * @param {MainDeps} deps
 * @returns {Outcome}
 */
function runReadiness(io, args, deps) {
  // A file an earlier run left at the out path goes before the first read, so a run that
  // stops anywhere after this leaves no earlier answer behind.
  if (args.out !== null && !removeOutFile(args.out)) {
    return refuse(io, EXIT_CODES.WRITE_FAILED, 'an output file could not be written');
  }
  const pass = readinessPass(io, args, deps);
  return args.out === null ? pass.outcome : writeReadinessOut(io, args.out, args.pr, pass.outcome, pass.head, planSource(args));
}

// ---------------------------------------------------------------------------
// claim — D-CLAIM-APPEND
// ---------------------------------------------------------------------------
//
// A Test or Validate report becomes claim lines in the evidence file. The caller passes
// only the facts of its report (the HEAD, the gate, one outcome per TP). This script owns
// the rest: the line shapes (the claim parser of pr-evidence.cjs accepts each one before
// it is written), the HEAD rule, the exit range, the `## Claims` section and the append.
// A claim is an input to `verify`, never a state: only pr-evidence.cjs and `verify`
// assign states.

/**
 * @param {string} reason  one of the CLAIM_REFUSAL_RE reasons
 * @returns {Outcome}
 */
function claimRefusal(reason) {
  return { code: EXIT_CODES.INPUT_UNUSABLE, stdout: 'CLAIM refused (' + reason + ')\n' };
}

/** The most folders one path can hold: the bound of the walk up to the nearest folder that exists. */
const FOLDER_DEPTH_MAX = 4096;

/**
 * Whether `child` lies below `parent`, by name alone. `parent` itself, and a path outside
 * it, are not below it.
 *
 * @param {string} parent  absolute
 * @param {string} child  absolute
 * @returns {boolean}
 */
function isBelow(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * D-CLAIM-FOLDER: the folder of the evidence file exists, or this run makes it. The Write
 * tool made the folders of a file in 3.11.0, so a first claim into a folder that is not
 * there yet worked. A run makes a folder only inside the working directory: the folder lies
 * below `io.cwd` by name, and the nearest folder that already exists resolves to `io.cwd` or
 * below it, so a link out of the working directory makes nothing. Each folder it makes goes
 * to `io.made`, deepest first, for removeMadeFolders. A path that holds a file where a folder
 * must be, or that the run may not make, is unusable. After each folder is made, its real path
 * must lie below the real working directory; if a link swapped in after the first check led the
 * folder out, the run is unusable and removeMadeFolders takes the folder away again. This check
 * narrows the window for such a swap; it does not close it, because the later open of the
 * evidence file resolves the path again.
 *
 * @param {Io} io
 * @param {string} dir  absolute
 * @returns {boolean}  whether the folder exists now
 */
function ensureClaimFolder(io, dir) {
  if (isRealDirectory(dir)) return true;
  try {
    const root = path.resolve(io.cwd);
    if (fs.lstatSync(dir, { throwIfNoEntry: false }) !== undefined || !isBelow(root, dir)) return false;
    let near = dir;
    for (let i = 0; i < FOLDER_DEPTH_MAX && fs.lstatSync(near, { throwIfNoEntry: false }) === undefined; i++) {
      near = path.dirname(near);
    }
    const real = fs.realpathSync(near);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !isBelow(realRoot, real)) return false;
    let at = near;
    for (const part of path.relative(near, dir).split(path.sep)) {
      at = path.join(at, part);
      fs.mkdirSync(at);
      io.made.unshift(at);
      if (!isBelow(realRoot, fs.realpathSync(at))) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Take away the folders a `claim` run made. Each goes through rmdir, which refuses a folder
 * that holds anything, so a folder that holds the evidence file, or a file another process
 * put there, stays. It is never a recursive delete.
 *
 * @param {Io} io
 * @returns {void}
 */
function removeMadeFolders(io) {
  for (const dir of io.made.splice(0)) {
    try { fs.rmdirSync(dir); } catch (_) { /* a folder that holds a file stays */ }
  }
}

/**
 * The reason a `claim` run must not start, or null. Nothing is read or written before
 * this, but the folder of the evidence file, when it is missing: the HEAD is one 40-hex
 * SHA, each path is a path the commands build, the evidence file sits in a folder that
 * exists or that the run makes inside the working directory (D-CLAIM-FOLDER), and git says
 * clearly that neither file is tracked (D-TRACKED-RESULT).
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'claim' }>} args
 * @returns {string | null}
 */
function claimRefusalReason(io, args) {
  if (!SHA40_RE.test(args.head)) return 'head not one sha';
  if (!EVIDENCE_PATH_RE.test(args.evidence) || !ensureClaimFolder(io, path.dirname(path.resolve(args.evidence)))) return 'evidence file unusable';
  if (args.plan !== null && !EVIDENCE_PATH_RE.test(args.plan)) return 'plan file unusable';
  if (trackedState(io, args.evidence) !== 'untracked') return 'evidence file tracked';
  if (args.plan !== null && trackedState(io, args.plan) !== 'untracked') return 'plan file unusable';
  return null;
}

/**
 * Whether one line is exactly one claim to the claim parser of pr-evidence.cjs.
 *
 * @param {string} line
 * @returns {boolean}
 */
function claimLineOk(line) {
  const r = PE.parseClaims(line);
  if (!r.ok) return false;
  const gates = r.value.gates;
  return r.value.malformed === 0 && r.value.tp.size + (gates.validate === null ? 0 : 1) + (gates.qa === null ? 0 : 1) === 1;
}

/**
 * Assert a line before it is written: one claim to the claim parser. Every caller builds
 * the line from parts that are already checked; this is that precondition held at the sink.
 *
 * @param {string} line
 * @returns {string}
 */
function claimLine(line) {
  if (!claimLineOk(line)) throw new Error('verify-evidence: unchecked claim line');
  return line;
}

/**
 * The text to append: the lines, behind the `## Claims` heading when the file has no such
 * section (a blank line first, when the file holds anything). The caller appends only when
 * the section is the last of the file, so the lines go at its end.
 *
 * @param {string} text  the evidence file as it is, '' when it is absent
 * @param {boolean} hasSection
 * @param {readonly string[]} lines
 * @returns {string}
 */
function claimAppendText(text, hasSection, lines) {
  const body = lines.join('\n') + '\n';
  if (text === '') return PE.CLAIMS_HEADING + '\n' + body;
  const lead = text.endsWith('\n') ? '' : '\n';
  return hasSection ? lead + body : lead + '\n' + PE.CLAIMS_HEADING + '\n' + body;
}

/**
 * D-CLAIM-INSERT: the whole text with the lines put at the end of a `## Claims` section that
 * another section follows: behind the last row of the section that is not blank, before the
 * blank rows that precede the next heading. A row is blank as the parser of pr-evidence.cjs
 * reads it, an empty row once its CR is gone. A text with no such section comes back as it was.
 *
 * @param {string} text
 * @param {readonly string[]} lines
 * @returns {string}
 */
function claimInsertText(text, lines) {
  const rows = text.split('\n');
  /** @param {string} row @returns {string} */
  const bare = row => row.replace(/\r$/, '');
  const start = rows.findIndex(row => bare(row) === PE.CLAIMS_HEADING);
  if (start === -1) return text;
  let end = rows.findIndex((row, i) => i > start && (bare(row) === '##' || bare(row).startsWith('## ')));
  if (end === -1) end = rows.length;
  let last = end - 1;
  while (last > start && bare(rows[last]) === '') last--;
  rows.splice(last + 1, 0, ...lines);
  return rows.join('\n');
}

/**
 * Whether `inserted` is `text` with the lines added at the end of its `## Claims` section and
 * nothing else changed, as the parser of pr-evidence.cjs reads both: the Claims section grew by
 * exactly the lines, its other sections are the same, and the result parses as an evidence file.
 * This is the check the replace is held to before it writes.
 *
 * @param {string} text
 * @param {string} inserted
 * @param {readonly string[]} lines
 * @returns {boolean}
 */
function claimInserted(text, inserted, lines) {
  const before = PE.evidenceSections(text);
  const after = PE.evidenceSections(inserted);
  if (!before.ok || !after.ok || before.value.claims === null) return false;
  return after.value.claims === before.value.claims + '\n' + lines.join('\n')
    && after.value.testPlan === before.value.testPlan
    && after.value.exceptions === before.value.exceptions
    && parseEvidenceText(inserted) !== null;
}

/**
 * The TP numbers the plan lists: the `## Test Plan` of the `--plan` file, else of the
 * evidence file. A plan with no TP line, or no plan section, lists none. Null when the
 * `--plan` file cannot serve as a plan.
 *
 * @param {Extract<ParsedArgs, { kind: 'claim' }>} args
 * @param {EvidenceInput} evidence
 * @returns {Set<number> | null}
 */
function claimPlanIds(args, evidence) {
  let plan = evidence.plan;
  if (args.plan !== null) {
    const text = readTextFile(args.plan);
    const parsed = text === null ? null : PE.parsePlan(sectionOrWhole(text, 'testPlan'));
    if (parsed === null || (!parsed.ok && parsed.error.code !== 'empty')) return null;
    plan = parsed.ok ? parsed.value : { tps: [] };
  }
  return new Set((plan === null ? [] : plan.tps).map(tp => tp.id));
}

/**
 * D-CLAIM-APPEND: `claim`. The checks of claimRefusalReason have passed (admitPaths).
 * The evidence file is read as `verify` reads it; a file that does not parse is refused, as
 * `verify` refuses it. Then every line is built and checked, and one write puts them all in.
 * That write is an append when the `## Claims` section is the last section or is absent. When
 * another section follows it, the write is a whole-file replace (D-CLAIM-INSERT) that adds the
 * lines at the end of the Claims section, held to claimInserted before it writes. One claim
 * run writes at a time, as the commands run it. A run that writes no line (every TP off the
 * plan) changes no file.
 *
 * @param {Io} io
 * @param {Extract<ParsedArgs, { kind: 'claim' }>} args
 * @returns {Outcome}
 */
function runClaim(io, args) {
  const file = path.resolve(args.evidence);
  /** @type {fs.Stats | undefined} */
  let st;
  try {
    st = fs.lstatSync(file, { throwIfNoEntry: false });
  } catch (_) {
    return claimRefusal('evidence file unusable');
  }
  if (st !== undefined && !st.isFile()) return claimRefusal('evidence file unusable');
  const text = st === undefined ? '' : readTextFile(file);
  const evidence = text === null ? null : parseEvidenceText(text);
  if (text === null || evidence === null) return claimRefusal('evidence file unusable');
  const headings = text.split('\n').map(row => row.replace(/\r$/, '')).filter(row => row === '##' || row.startsWith('## '));
  const hasSection = headings.includes(PE.CLAIMS_HEADING);
  const sectionFollowed = hasSection && headings[headings.length - 1] !== PE.CLAIMS_HEADING;
  const listed = args.gate ? new Set() : claimPlanIds(args, evidence);
  if (listed === null) return claimRefusal('plan file unusable');

  /** @type {string[]} */
  const lines = [];
  const tally = { PASS: 0, FAIL: 0, SKIP: 0 };
  if (args.gate) {
    lines.push(claimLine('- gate:validate PASS sha:' + args.head + ' by:validate'));
    tally.PASS++;
  }
  for (const tp of args.tps) {
    if (!listed.has(tp.id)) continue;
    const bare = '- TP-' + tp.id + ' ' + tp.outcome + ' sha:' + args.head + ' by:test';
    const withExit = tp.exit === null ? bare : bare + ' exit:' + tp.exit;
    lines.push(claimLine(claimLineOk(withExit) ? withExit : bare));
    tally[tp.outcome]++;
  }
  if (lines.length > 0) {
    let written;
    if (sectionFollowed) {
      const inserted = claimInsertText(text, lines);
      if (!claimInserted(text, inserted, lines)) return claimRefusal('evidence file unusable');
      written = replaceTextFile(file, inserted, st === undefined ? 0o600 : st.mode & 0o777);
    } else {
      written = appendTextFile(file, claimAppendText(text, hasSection, lines));
    }
    if (!written) return refuse(io, EXIT_CODES.WRITE_FAILED, 'an output file could not be written');
  }
  const skipped = args.gate ? 0 : args.tps.length - lines.length;
  return {
    code: EXIT_CODES.OK,
    stdout: 'CLAIM appended:' + lines.length + ' PASS:' + tally.PASS + ' FAIL:' + tally.FAIL + ' SKIP:' + tally.SKIP + ' skipped:' + skipped + '\n',
  };
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
    made: [],
    stderr: typeof d.stderr === 'function' ? d.stderr : (text => { process.stderr.write(text); }),
  };
  const parsed = parseArgs(argv);
  if (parsed.kind === 'usage') {
    io.stderr(USAGE + '\n');
    return { code: EXIT_CODES.USAGE, stdout: '' };
  }
  let args = parsed;
  /** @type {Outcome} */
  let outcome;
  try {
    const admitted = admitPaths(io, parsed);
    if ('outcome' in admitted) outcome = admitted.outcome;
    else {
      args = admitted.args;
      if (args.kind === 'check') outcome = runCheck(io, args);
      else if (args.kind === 'render') outcome = runRender(io, args);
      else if (args.kind === 'verify') outcome = runVerify(io, args, d);
      else if (args.kind === 'splice') outcome = runSplice(io, args);
      else if (args.kind === 'publish') outcome = runPublish(io, args, d);
      else if (args.kind === 'readiness') outcome = runReadiness(io, args, d);
      else if (args.kind === 'claim') outcome = runClaim(io, args);
      else outcome = runReadback(io, args);
    }
  } catch (err) {
    // An injected exec that throws, or a broken invariant (rev): no verdict. The two
    // scripted operations still answer in their own DEGRADED form, since a caller
    // prints whatever they print.
    const label = 'internal error (' + errorLabel(err) + ')';
    if (args.kind === 'publish') outcome = evidenceUnavailable(io, label);
    else if (args.kind === 'readiness') {
      // The earlier out file is already gone (runReadiness), so the DEGRADED answer is the one file this run leaves.
      outcome = readinessDegraded(args.pr, 'internal error', {});
      if (args.out !== null) outcome = writeReadinessOut(io, args.out, args.pr, outcome, null, planSource(args));
    } else outcome = refuse(io, EXIT_CODES.REMOTE_FAILURE, label);
  }
  removeMadeFolders(io);
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
 * the closed shapes for that code; anything else prints nothing and exits 4. A
 * `publish` run is the exception: it never settles to empty stdout, so what would
 * print nothing prints the evidence unavailable line with exit 2.
 *
 * @param {unknown} outcome
 * @param {boolean} [publish]  true when the run is a `publish`
 * @returns {Outcome}
 */
function settleOutcome(outcome, publish) {
  const settled = settleShape(outcome);
  return publish === true && settled.stdout === '' ? PUBLISH_UNAVAILABLE : settled;
}

/**
 * The shape check of settleOutcome, for every subcommand.
 *
 * @param {unknown} outcome
 * @returns {Outcome}
 */
function settleShape(outcome) {
  const o = /** @type {any} */ (outcome);
  const failed = { code: EXIT_CODES.REMOTE_FAILURE, stdout: '' };
  if (o === null || typeof o !== 'object' || typeof o.stdout !== 'string') return failed;
  if (!Object.values(EXIT_CODES).includes(o.code)) return failed;
  if (o.code === EXIT_CODES.USAGE || o.stdout === '') return { code: o.code, stdout: '' };
  if (!o.stdout.endsWith('\n')) return failed;
  const pass = { code: o.code, stdout: o.stdout };
  // The two scripted operations (D-OP-BLOCK-GATE): a block prints only when it parses
  // back to exactly itself.
  if (o.stdout.startsWith('## PR Evidence\n')) {
    return o.code === EXIT_CODES.OK && parsePublishBlock(o.stdout) !== null ? pass : failed;
  }
  if (PUBLISH_REFUSAL_LINES.some(line => o.stdout === line + '\n')) return o.code === EXIT_CODES.INPUT_UNUSABLE ? pass : failed;
  if (o.stdout.startsWith('## Merge Readiness\n')) {
    const block = parseReadinessBlock(o.stdout);
    if (block === null) return failed;
    return o.code === (block.status === 'DEGRADED' ? EXIT_CODES.INPUT_UNUSABLE : EXIT_CODES.OK) ? pass : failed;
  }
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
  const claimRefused = CLAIM_REFUSAL_RE.exec(text);
  if (claimRefused !== null) return o.code === EXIT_CODES.INPUT_UNUSABLE ? pass : failed;
  const claimed = CLAIM_APPENDED_RE.exec(text);
  if (claimed !== null && claimed.groups !== undefined) {
    const g = claimed.groups;
    const sums = Number(g.n) === Number(g.pass) + Number(g.fail) + Number(g.skip);
    return o.code === EXIT_CODES.OK && sums && Number(g.n) <= CAPS.TPS && Number(g.skipped) <= CAPS.TPS ? pass : failed;
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
  const settled = settleOutcome(outcome, isPublishRun(process.argv));
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
  BODY_STATUSES,
  COMMENT_STATUSES,
  readinessVerdict,
  bindCiHead,
  renderPublishBlock,
  parsePublishBlock,
  renderReadinessBlock,
  parseReadinessBlock,
  writeReadinessOut,
  commentIdOf,
  editTarget,
});
