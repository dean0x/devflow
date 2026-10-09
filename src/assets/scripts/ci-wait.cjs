#!/usr/bin/env node
// src/assets/scripts/ci-wait.cjs
//
// The CI wait for one pushed head (Token Diet wave 2, #421). /implement Phase 9 and
// /resolve Phase 8 call it inline, through the Bash tool, instead of re-spawning the
// Git agent once a minute: a poll costs no model tokens, so the wait happens here.
// It reads CI with `gh pr view` and `gh pr checks` only, classifies the head it was
// told about, and prints exactly one line. Installed beside hud.sh and
// redact-secrets.cjs under ~/.devflow/scripts/.
//
// Usage:
//   node ci-wait.cjs --pr <n> --head <sha>
//     <n>    the pull request number: digits, no leading zero, at most 9
//     <sha>  the pushed head: 40 lowercase hex
//
// Run it from the worktree, so gh finds the repository from the working directory.
//
// stdout (D-CI-LINE) is exactly one line, ending in a newline:
//   CI <STATUS> pr=<n> head=<first 7 hex> failing=<names|-> pending=<names|-> waited=<seconds>
// with ` reason=<code>` appended to INDETERMINATE only. STATUS is one of STATUSES,
// the check-ci-status Output enum. An argv that fails its gate prints the short form
// `CI INDETERMINATE pr=- head=- waited=0 reason=usage` and makes no gh call. The
// boundary re-checks the line against LINE_RE and the 400-character bound before it
// writes it. Exit 0 whenever a line was printed; a reader treats a missing or
// unparseable line, an unlisted status or a non-zero exit as INDETERMINATE.
//
// Design constraints (binding):
//   - D-CI-WAIT-INLINE: this is plumbing. The only judgment in it is the bucket
//     classifier, which mirrors check-ci-status step 5 clause for clause. Every
//     subprocess is `gh`, spawned through exec() with an argv array and
//     `shell: false`, stdin ignored, a timeout and a maxBuffer. gh output never
//     reaches stdout raw: a check name passes sanitizeName() first.
//   - D-CI-NO-LITERAL-SLEEP: the wait happens inside node, through clock.sleep(),
//     never through a shell `sleep`. Claude Code 2.1.294 blocks any Bash command
//     that starts with a literal `sleep N`, so no prompt and no script may wait that
//     way. A silent foreground node call of about 570 s under a Bash timeout of
//     600000 ms completed in a main-thread `claude -p` probe on 2026-10-09.
//   - D-CI-NO-EXIT: nothing here calls process.exit(). An explicit exit can
//     truncate stdout when it is a pipe, and the one line is the whole result. The
//     boundary sets process.exitCode and lets the event loop drain.
//   - D-CI-WAIT-BOUNDS: every loop has a fixed bound (MAX_POLLS, the deadline, the
//     name lists), and every wait is capped at CI_WAIT_MAX_SECONDS.
//
// gh facts this file rests on, probed on gh 2.88.1 on 2026-10-09:
//   - `gh pr view 999999999 --json headRefOid` exits 1 with stderr `GraphQL: Could
//     not resolve to a PullRequest with the number of 999999999.
//     (repository.pullRequest)` and an empty stdout. Only that text on exit 1 is
//     NO_PR; any other non-zero exit is a gh failure and never PASSING.
//   - `gh pr checks <n> --json` offers exactly bucket, completedAt, description,
//     event, link, name, startedAt, state and workflow. There is no SHA field, and it
//     reports only the PR's current head. So the head is bound by comparing
//     `gh pr view --json headRefOid` with `--head` (D-CI-HEAD-BINDING).

'use strict';

const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// Closed vocabularies and bounds
// ---------------------------------------------------------------------------

/**
 * D-CI-STATUSES: the check-ci-status Output enum, in its order. A guard in
 * merge-readiness.test.ts holds this list equal to that op's declared one, and
 * reads the arm names of both CI gate blocks against it.
 */
const STATUSES = Object.freeze(['PASSING', 'FAILING', 'PENDING', 'NO_CI', 'NO_PR', 'INDETERMINATE']);

/**
 * D-CI-REASONS: why an INDETERMINATE was returned. `unrecognised-bucket` also covers
 * a set of buckets that gives no verdict (every check `skipping`): the classifier
 * could call neither a pass nor a failure.
 */
const REASONS = Object.freeze([
  'gh-failed', 'unparseable', 'unrecognised-bucket', 'head-mismatch', 'deadline', 'usage',
]);

/** `gh pr checks` categorises `state` into these buckets (gh 2.88.1, `--help`). */
const BUCKETS = Object.freeze(['pass', 'fail', 'pending', 'skipping', 'cancel']);

/**
 * D-CI-WAIT-BOUNDS:
 *   CI_WAIT_MAX_SECONDS          one invocation never runs past this, every gh
 *                                timeout and every sleep counted; it sits under the
 *                                Bash timeout of 600000 ms the callers pass
 *   POLL_INTERVAL_SECONDS        the sleep between polls; polls cost no model tokens,
 *                                so the cadence is set by gh latency and rate limits
 *   SETTLE_WINDOW_SECONDS        how long a head mismatch or an empty check list may
 *                                persist before it is a verdict (GitHub creates
 *                                checks and moves the PR head a few seconds after a
 *                                push)
 *   GH_CALL_CAP_SECONDS          one gh call's timeout is min(this, time remaining),
 *                                so the last call ends before the deadline
 *   MAX_POLLS                    the loop bound when the clock does not move
 *   MAX_CONSECUTIVE_GH_FAILURES  failed polls in a row before gh-failed
 */
const CI_WAIT_MAX_SECONDS = 570;
const POLL_INTERVAL_SECONDS = 20;
const SETTLE_WINDOW_SECONDS = 90;
const GH_CALL_CAP_SECONDS = 30;
const MAX_POLLS = 40;
const MAX_CONSECUTIVE_GH_FAILURES = 3;

/** A PR with more check rows than this is read as an unparseable reply. */
const MAX_CHECKS = 1000;
/** `gh pr checks --json` for 1,000 rows is far under this. An overflow is a gh failure. */
const GH_MAX_BUFFER = 4 * 1024 * 1024;
/** Kept of a gh stderr; only a fixed phrase is ever matched against it. */
const STDERR_KEEP = 4096;

/**
 * D-CI-SANITIZE: the shape of a name on stdout. Names come from a third party's
 * workflow files, so the line carries only an allowlist, 40 characters per name, 4
 * names per list and a `+N` for the rest. Neither a newline, an ANSI escape, a
 * backtick, a comma nor `=` survives, so a name can neither start a second line nor
 * forge a `key=value` field. A name that would read as one of the list's own tokens,
 * `-` (no names) or `+N` (the count of the rest), has its first character turned
 * to `_`, so a FAILING line never reads as naming nothing and a fourth name never
 * reads as a count. Two lists of 4 names at 40 characters, the longest
 * prefix and a three-digit tail come to under 400 characters by construction, and the
 * boundary asserts it.
 */
const NAME_MAX = 40;
const NAMES_LISTED = 4;
const MORE_MAX = 999;
const LINE_MAX = 400;
const NAME_UNSAFE_RE = /[^A-Za-z0-9 ._()\/:+-]/gu;
/** A sanitized name that spells a list token: `-` (no names) or `+N` (the rest). */
const NAME_TOKEN_RE = /^(?:-|\+[0-9]+)$/;

const PR_RE = /^[1-9][0-9]{0,8}$/;
const HEAD_RE = /^[0-9a-f]{40}$/;
const NO_PR_RE = /Could not resolve to a PullRequest/;
const NO_CHECKS_RE = /no checks reported/i;

const NAME_LIST = '(?:-|[A-Za-z0-9 ._()/:+-]{1,40}(?:,[A-Za-z0-9 ._()/:+-]{1,40}){0,3}(?:,\\+[0-9]{1,3})?)';
/** The one stdout line: the full form, or the usage form without the two name lists. */
const LINE_RE = new RegExp(
  '^CI (PASSING|FAILING|PENDING|NO_CI|NO_PR|INDETERMINATE) pr=([1-9][0-9]{0,8}|-) head=([0-9a-f]{7}|-)'
  + '(?: failing=' + NAME_LIST + ' pending=' + NAME_LIST + ')?'
  + ' waited=[0-9]{1,3}(?: reason=(' + REASONS.join('|') + '))?$',
);

const USAGE_LINE = 'CI INDETERMINATE pr=- head=- waited=0 reason=usage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {{ status: number | null, stdout?: Buffer | string, stderr?: Buffer | string,
 *   error?: { code?: string } }} ExecResult
 *   The spawnSync subset this script reads.
 * @typedef {(file: string, args: string[], opts: object) => ExecResult | Promise<ExecResult>} ExecFn
 *   Called like child_process.spawnSync(file, args, opts); a promise is awaited.
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} Clock
 *   `now` is in milliseconds. Tests inject a clock whose sleep and exec advance it.
 *
 * @typedef {{ name: string, bucket: string }} Check
 * @typedef {{ status: string, reason: string | null, failing: string[], pending: string[] }} Classification
 * @typedef {{ status: string, pr: string, head: string, failing: string[], pending: string[],
 *   waited: number, reason: string | null }} CiResult
 *   `head` is the first 7 hex characters.
 * @typedef {{ pr: string, head: string, exec: ExecFn, clock: Clock, env?: NodeJS.ProcessEnv }} WaitInput
 * @typedef {{ exec?: ExecFn, clock?: Clock, env?: NodeJS.ProcessEnv }} MainDeps
 * @typedef {{ code: number, stdout: string }} Outcome
 */

// ---------------------------------------------------------------------------
// Argument gate
// ---------------------------------------------------------------------------

/**
 * D-CI-ARGV: exactly `--pr <digits> --head <40 lowercase hex>`, each once, in either
 * order, and nothing else. Anything that fails is refused before any gh call, so a
 * value never reaches gh's argv unless it is a plain number or a plain SHA.
 *
 * @param {readonly string[]} args  the arguments after the script path
 * @returns {{ pr: string, head: string } | null}
 */
function parseArgs(args) {
  if (!Array.isArray(args) || args.length !== 4) return null;
  let pr = null;
  let head = null;
  for (let i = 0; i < 4; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (typeof value !== 'string') return null;
    if (flag === '--pr' && pr === null && PR_RE.test(value)) pr = value;
    else if (flag === '--head' && head === null && HEAD_RE.test(value)) head = value;
    else return null;
  }
  return pr !== null && head !== null ? { pr, head } : null;
}

// ---------------------------------------------------------------------------
// Sanitizer, classifier and line
// ---------------------------------------------------------------------------

/**
 * D-CI-SANITIZE: one check name as it may appear on stdout.
 *
 * @param {unknown} name
 * @returns {string}  1 to 40 characters from the allowlist
 */
function sanitizeName(name) {
  const text = typeof name === 'string' ? name.slice(0, 4 * NAME_MAX) : '';
  const safe = text.replace(NAME_UNSAFE_RE, '_').slice(0, NAME_MAX);
  if (safe === '') return '_';
  return NAME_TOKEN_RE.test(safe) ? '_' + safe.slice(1) : safe;
}

/**
 * One list on the line: at most NAMES_LISTED sanitized names, then `+N` for the rest.
 *
 * @param {readonly string[]} names
 * @returns {string}  `-` for an empty list
 */
function formatNames(names) {
  if (!Array.isArray(names) || names.length === 0) return '-';
  const shown = names.slice(0, NAMES_LISTED).map(sanitizeName);
  const more = names.length - shown.length;
  return more > 0 ? shown.join(',') + ',+' + Math.min(more, MORE_MAX) : shown.join(',');
}

/**
 * D-CI-CLASSIFIER: check-ci-status step 5, clause for clause, over `bucket`. In
 * priority order: any `pending` is PENDING; else any `fail` or `cancel` is FAILING;
 * else every check `pass` or `skipping` with at least one `pass` is PASSING; else
 * INDETERMINATE. PASSING is a positive conjunction, so an undocumented bucket, an
 * all-`skipping` set or an empty set never reaches it. merge-readiness.test.ts runs
 * every bucket multiset of 1 to 3 checks through this and through the prose clauses
 * and requires the statuses to agree. (The empty set is not classified here: an empty
 * list is "no checks", which waitForCi settles before it classifies.)
 *
 * @param {readonly Check[]} checks
 * @returns {Classification}
 */
function classifyChecks(checks) {
  const failing = [];
  const pending = [];
  let pass = 0;
  let unrecognised = 0;
  const count = Math.min(Array.isArray(checks) ? checks.length : 0, MAX_CHECKS);
  for (let i = 0; i < count; i++) {
    const check = checks[i];
    switch (check.bucket) {
      case 'pending': pending.push(check.name); break;
      case 'fail':
      case 'cancel': failing.push(check.name); break;
      case 'pass': pass++; break;
      case 'skipping': break;
      default: unrecognised++;
    }
  }
  if (pending.length > 0) return { status: 'PENDING', reason: null, failing, pending };
  if (failing.length > 0) return { status: 'FAILING', reason: null, failing, pending };
  if (unrecognised === 0 && pass > 0) return { status: 'PASSING', reason: null, failing, pending };
  return { status: 'INDETERMINATE', reason: 'unrecognised-bucket', failing, pending };
}

/**
 * D-CI-LINE: the result as its one line. Only the list a status is about is filled
 * (`failing` on FAILING, `pending` on PENDING), which keeps the line far under the
 * bound; `reason` rides on INDETERMINATE only.
 *
 * @param {CiResult} result
 * @returns {string}
 */
function renderLine(result) {
  const failing = result.status === 'FAILING' ? formatNames(result.failing) : '-';
  const pending = result.status === 'PENDING' ? formatNames(result.pending) : '-';
  const reason = result.status === 'INDETERMINATE' && result.reason !== null ? ' reason=' + result.reason : '';
  return 'CI ' + result.status + ' pr=' + result.pr + ' head=' + result.head
    + ' failing=' + failing + ' pending=' + pending + ' waited=' + result.waited + reason;
}

/**
 * Whether a line is one this script may print: the grammar, the length bound, and
 * `reason=` on INDETERMINATE only.
 *
 * @param {string} line
 * @returns {boolean}
 */
function checkLine(line) {
  if (typeof line !== 'string' || line.length > LINE_MAX) return false;
  const m = LINE_RE.exec(line);
  return m !== null && (m[1] === 'INDETERMINATE') === (m[4] !== undefined);
}

// ---------------------------------------------------------------------------
// One bounded gh call
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/**
 * The environment gh gets: the caller's, with prompts off and colour removed.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv() {
  const env = Object.assign({}, process.env, {
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
  });
  delete env.GH_FORCE_TTY;
  delete env.CLICOLOR_FORCE;
  return env;
}

/**
 * A normalized gh answer. `answered` is true only when gh ran to completion and
 * exited on its own; a call that never started, timed out or overflowed is NOT
 * KNOWING, and never reads as a permissive answer.
 *
 * @typedef {{ answered: boolean, status: number | null, stdout: string, stderr: string }} GhAnswer
 *
 * @param {ExecResult | null} res
 * @returns {GhAnswer}
 */
function normalize(res) {
  const errored = res === null || typeof res !== 'object' || Boolean(res.error);
  const status = !errored && typeof res.status === 'number' ? res.status : null;
  return {
    answered: !errored && status !== null,
    status,
    stdout: errored ? '' : asText(res.stdout),
    stderr: errored ? '' : asText(res.stderr).slice(0, STDERR_KEEP),
  };
}

// ---------------------------------------------------------------------------
// Reply parsers
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {unknown}  the parsed value, or undefined when the text is not JSON
 */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return undefined;
  }
}

/**
 * @param {string} stdout
 * @returns {string | null}  the 40-hex headRefOid, or null for any other shape
 */
function parseHeadRefOid(stdout) {
  const value = parseJson(stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value.headRefOid === 'string' && HEAD_RE.test(value.headRefOid) ? value.headRefOid : null;
}

/**
 * @param {string} stdout
 * @returns {Check[] | null}  the rows, or null for any other shape
 */
function parseChecks(stdout) {
  const value = parseJson(stdout);
  if (!Array.isArray(value) || value.length > MAX_CHECKS) return null;
  const checks = [];
  for (const row of value) {
    if (row === null || typeof row !== 'object' || typeof row.name !== 'string' || typeof row.bucket !== 'string') return null;
    checks.push({ name: row.name, bucket: row.bucket });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// The wait
// ---------------------------------------------------------------------------

/**
 * D-CI-HEAD-BINDING: wait for the CI verdict of `head`, and of nothing else. `gh pr
 * checks` has no SHA field and reports the PR's current head, so each poll reads
 * `headRefOid` first. A different value means the checks on offer belong to another
 * head: they are not read, and the poll is PENDING until SETTLE_WINDOW_SECONDS have
 * passed since the first mismatch (GitHub moves the head and creates checks a few
 * seconds after a push), then INDETERMINATE (head-mismatch). A matching head clears
 * the mismatch clock. An empty check list settles the same way into NO_CI. Nothing
 * here is PASSING unless a poll saw this head and every check a pass.
 *
 * Per poll: `gh pr view <n> --json headRefOid`, then `gh pr checks <n> --json
 * name,state,bucket` (exit 0 or 8 are results, as in check-ci-status step 3). A
 * PENDING poll sleeps min(POLL_INTERVAL_SECONDS, remaining) and polls again; any
 * other result returns. A poll whose gh call fails is not a result: three failed
 * polls in a row are INDETERMINATE (gh-failed), fewer are retried. The loop stops at
 * the deadline or after MAX_POLLS with its last state: PENDING stays PENDING, and
 * anything unknown becomes INDETERMINATE (deadline).
 *
 * It never throws: an exec that throws is a gh failure.
 *
 * @param {WaitInput} input
 * @returns {Promise<CiResult>}
 */
async function waitForCi(input) {
  const { pr, head, exec, clock } = input;
  const env = input.env || childEnv();
  const startedAt = clock.now();
  const deadline = startedAt + CI_WAIT_MAX_SECONDS * 1000;
  const settleMs = SETTLE_WINDOW_SECONDS * 1000;

  /** @returns {CiResult} */
  const finish = (status, reason, failing, pending) => ({
    status,
    pr,
    head: head.slice(0, 7),
    failing,
    pending,
    waited: Math.min(CI_WAIT_MAX_SECONDS, Math.max(0, Math.round((clock.now() - startedAt) / 1000))),
    reason,
  });

  /**
   * One gh call, its timeout min(GH_CALL_CAP_SECONDS, time left); null when no time
   * is left, in which case no call is made.
   *
   * @param {string[]} args
   * @returns {Promise<GhAnswer | null>}
   */
  const gh = async args => {
    const left = Math.floor(deadline - clock.now());
    if (left < 1) return null;
    let res = null;
    try {
      res = await exec('gh', [...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: Math.min(GH_CALL_CAP_SECONDS * 1000, left),
        maxBuffer: GH_MAX_BUFFER,
        windowsHide: true,
        shell: false,
      });
    } catch (_) {
      res = null;
    }
    return normalize(res);
  };

  let failedPolls = 0;
  let firstMismatchAt = null;
  let firstEmptyAt = null;
  /** @type {{ status: string, pending: string[] }} */
  let last = { status: 'INDETERMINATE', pending: [] };

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (clock.now() >= deadline) break;

    const view = await gh(['pr', 'view', pr, '--json', 'headRefOid']);
    if (view === null) break;
    if (view.answered && view.status === 1 && NO_PR_RE.test(view.stderr)) return finish('NO_PR', null, [], []);

    /** @type {{ state: 'failed' } | { state: 'pending', pending: string[] } | { state: 'done', result: CiResult }} */
    let step;
    if (!view.answered || view.status !== 0) {
      step = { state: 'failed' };
    } else {
      const oid = parseHeadRefOid(view.stdout);
      if (oid === null) return finish('INDETERMINATE', 'unparseable', [], []);
      if (oid !== head) {
        firstMismatchAt = firstMismatchAt === null ? clock.now() : firstMismatchAt;
        step = clock.now() - firstMismatchAt >= settleMs
          ? { state: 'done', result: finish('INDETERMINATE', 'head-mismatch', [], []) }
          : { state: 'pending', pending: [] };
      } else {
        firstMismatchAt = null;
        const checks = await gh(['pr', 'checks', pr, '--json', 'name,state,bucket']);
        if (checks === null) break;
        const isResult = checks.answered && (checks.status === 0 || checks.status === 8);
        const isEmpty = checks.answered && checks.status === 1 && NO_CHECKS_RE.test(checks.stderr);
        if (!isResult && !isEmpty) {
          step = { state: 'failed' };
        } else {
          const rows = isResult ? parseChecks(checks.stdout) : [];
          if (rows === null) return finish('INDETERMINATE', 'unparseable', [], []);
          if (rows.length === 0) {
            firstEmptyAt = firstEmptyAt === null ? clock.now() : firstEmptyAt;
            step = clock.now() - firstEmptyAt >= settleMs
              ? { state: 'done', result: finish('NO_CI', null, [], []) }
              : { state: 'pending', pending: [] };
          } else {
            firstEmptyAt = null;
            const verdict = classifyChecks(rows);
            step = verdict.status === 'PENDING'
              ? { state: 'pending', pending: verdict.pending }
              : { state: 'done', result: finish(verdict.status, verdict.reason, verdict.failing, verdict.pending) };
          }
        }
      }
    }

    if (step.state === 'done') return step.result;
    if (step.state === 'failed') {
      failedPolls++;
      if (failedPolls >= MAX_CONSECUTIVE_GH_FAILURES) return finish('INDETERMINATE', 'gh-failed', [], []);
      last = { status: 'INDETERMINATE', pending: [] };
    } else {
      failedPolls = 0;
      last = { status: 'PENDING', pending: step.pending };
    }

    const left = deadline - clock.now();
    if (left <= 0) break;
    await clock.sleep(Math.min(POLL_INTERVAL_SECONDS * 1000, left));
  }

  return last.status === 'PENDING'
    ? finish('PENDING', null, [], last.pending)
    : finish('INDETERMINATE', 'deadline', [], []);
}

// ---------------------------------------------------------------------------
// main — returns {code, stdout}; never calls process.exit (D-CI-NO-EXIT)
// ---------------------------------------------------------------------------

/**
 * The production exec: spawnSync, read off the module object at call time.
 *
 * @type {ExecFn}
 */
function defaultExec(file, args, opts) {
  return childProcess.spawnSync(file, args, /** @type {any} */ (opts));
}

/**
 * The production clock: wall time and a timer. The timer is what keeps the process
 * alive between polls, in place of a shell `sleep` (D-CI-NO-LITERAL-SLEEP).
 *
 * @returns {Clock}
 */
function realClock() {
  return {
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => { setTimeout(resolve, ms); }),
  };
}

/**
 * @param {readonly string[]} argv  process.argv
 * @param {MainDeps} [deps]  injected by tests only
 * @returns {Promise<Outcome>}
 */
async function main(argv, deps) {
  const injected = deps || {};
  const parsed = parseArgs(Array.isArray(argv) ? argv.slice(2) : []);
  if (parsed === null) return { code: 0, stdout: USAGE_LINE + '\n' };
  /** @param {string} reason */
  const indeterminate = reason =>
    'CI INDETERMINATE pr=' + parsed.pr + ' head=' + parsed.head.slice(0, 7) + ' waited=0 reason=' + reason;
  let line;
  try {
    const result = await waitForCi({
      pr: parsed.pr,
      head: parsed.head,
      exec: injected.exec || defaultExec,
      clock: injected.clock || realClock(),
      env: injected.env,
    });
    line = renderLine(result);
  } catch (_) {
    line = indeterminate('gh-failed');
  }
  if (!checkLine(line)) line = indeterminate('unparseable');
  return { code: 0, stdout: line + '\n' };
}

// ---------------------------------------------------------------------------
// Top-level boundary — the ONLY stdout write and exitCode assignment
//
// A write that fails (a closed pipe, an unwritable descriptor) sets exit 3,
// whether it fails synchronously, through the write callback, or as a stream
// 'error' event.
// ---------------------------------------------------------------------------

/**
 * @param {Outcome} outcome
 * @returns {void}
 */
function emit(outcome) {
  process.exitCode = outcome.code;
  const writeFailed = () => { process.exitCode = 3; };
  process.stdout.on('error', writeFailed);
  try {
    process.stdout.write(outcome.stdout, err => { if (err) writeFailed(); });
  } catch (_) {
    writeFailed();
  }
}

if (require.main === module) {
  main(process.argv).then(emit, () => {
    emit({ code: 0, stdout: 'CI INDETERMINATE pr=- head=- waited=0 reason=unparseable\n' });
  });
}

// ---------------------------------------------------------------------------
// Exports — the unit tests and the parity test are the consumers
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  STATUSES,
  REASONS,
  BUCKETS,
  CI_WAIT_MAX_SECONDS,
  POLL_INTERVAL_SECONDS,
  SETTLE_WINDOW_SECONDS,
  GH_CALL_CAP_SECONDS,
  MAX_POLLS,
  MAX_CONSECUTIVE_GH_FAILURES,
  LINE_MAX,
  NAME_MAX,
  NAMES_LISTED,
  LINE_RE,
  USAGE_LINE,
  parseArgs,
  sanitizeName,
  formatNames,
  classifyChecks,
  renderLine,
  checkLine,
  waitForCi,
  main,
});
