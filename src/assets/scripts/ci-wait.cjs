#!/usr/bin/env node
// src/assets/scripts/ci-wait.cjs
//
// The CI wait for one pushed head (Token Diet wave 2, #421). /implement Phase 9 and
// /resolve Phase 8 call it inline, through the Bash tool, instead of re-spawning the
// Git agent once a minute: a poll costs no model tokens, so the wait happens here.
// It reads CI with `gh pr view` and `gh pr checks`, plus a read-only `gh api` probe of
// the repository's workflow list when the check list is empty or holds external checks
// only (D-CI-WORKFLOWS): at most one answered probe per run, and its answer is kept for
// the run; a failed probe is a failed poll, and the next poll probes again. It waits for
// CI to start until CI_WAIT_MAX_SECONDS, classifies the head it was told about, and
// prints exactly one line.
// Installed beside hud.sh and redact-secrets.cjs under ~/.devflow/scripts/.
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
// Design constraints (binding). The text of each verdict rule is written once, at the
// marker named below; this list points to it. The workflow-probe rule has two readers,
// mergeGate and matchedStep, and one reading of the probe value, probeAnswer.
//   - D-CI-WAIT-INLINE: this is plumbing. The only judgment in it is the classifier
//     (D-CI-CLASSIFIER, D-CI-WORKFLOW-RULE) and the merge gate (D-CI-MERGE-STATE,
//     D-CI-WORKFLOWS, D-CI-PR-STATE). Every subprocess is `gh`, spawned through exec()
//     with an argv array and `shell: false`, stdin ignored, a timeout and a maxBuffer.
//     gh output never reaches stdout raw: a check name passes sanitizeName() first.
//   - D-CI-WORKFLOW-RULE: see classifyChecks. PASSING does not prove that the test
//     workflow ran by name.
//   - D-CI-MERGE-STATE, D-CI-WORKFLOWS: see mergeGate (an empty check list) and matchedStep
//     (rows that are all external checks, which read the probe answer themselves). The
//     workflow files are listed, never opened: no workflow YAML is parsed, so which events
//     a workflow reacts to is not judged.
//   - D-CI-PR-STATE, D-CI-HEAD-BINDING: see waitForCi.
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
//   - `gh pr view 999999999 --json headRefOid,mergeable,state` exits 1 with stderr
//     `GraphQL: Could not resolve to a PullRequest with the number of 999999999.
//     (repository.pullRequest)` and an empty stdout (re-probed with `mergeable` and
//     `state` in the field list on 2026-10-22: the same text). Only that text on exit 1
//     is NO_PR; any other non-zero exit is a gh failure and never PASSING.
//   - `gh pr checks <n> --json` offers exactly bucket, completedAt, description,
//     event, link, name, startedAt, state and workflow. There is no SHA field, and it
//     reports only the PR's current head. So the head is bound by comparing
//     `gh pr view --json headRefOid` with `--head` (D-CI-HEAD-BINDING).
//   - `workflow` names the GitHub Actions workflow of a check, and is "" for a commit
//     status and for a third-party app's check run (probed on public PRs, gh 2.88.1,
//     2026-10-22).
//   - `gh pr view --json mergeable` is MERGEABLE, CONFLICTING or UNKNOWN. GitHub
//     computes it lazily, so UNKNOWN is common right after a push or a base move. A
//     merged PR reads `state` MERGED with `mergeable` UNKNOWN (probed on gh 2.88.1,
//     2026-10-22), which is why the poll asks `state` (D-CI-PR-STATE).
//   - `gh api` fills the placeholders `{owner}` and `{repo}` from the repository of the
//     current directory (`gh api --help`), and a call with no field flag is a GET.
//     `repos/{owner}/{repo}/actions/workflows?per_page=100` answers `{ total_count,
//     workflows: [{ path, state, ... }] }`, one row per workflow, with `state` active
//     for a live one and a `path` such as `.github/workflows/ci.yml` (probed on gh
//     2.88.1, 2026-10-22). It is used rather than `gh workflow list` because
//     `total_count` tells a whole list from a cut one. A row whose path is not under
//     `.github/workflows/`, such as a `dynamic/...` path that GitHub gives its own
//     apps, is not a workflow file of the repository.

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
 * could call neither a pass nor a failure. The other rule reasons are defined at their
 * markers: `no-workflow-check` (D-CI-WORKFLOW-RULE, D-CI-WORKFLOWS), `merge-conflict`
 * (D-CI-MERGE-STATE) and `not-open` (D-CI-PR-STATE).
 */
const REASONS = Object.freeze([
  'gh-failed', 'unparseable', 'unrecognised-bucket', 'head-mismatch', 'deadline', 'usage',
  'no-workflow-check', 'merge-conflict', 'not-open',
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
 *   WORKFLOWS_PAGE_ROWS          the rows asked of the workflow list in its one page
 *   GH_CALL_CAP_SECONDS          one gh call's timeout is min(this, time remaining),
 *                                so the last call ends before the deadline
 *   MAX_POLLS                    the loop bound when the clock does not move
 *   MAX_CONSECUTIVE_GH_FAILURES  failed polls in a row before gh-failed
 */
const CI_WAIT_MAX_SECONDS = 570;
const POLL_INTERVAL_SECONDS = 20;
const GH_CALL_CAP_SECONDS = 30;
const MAX_POLLS = 40;
const MAX_CONSECUTIVE_GH_FAILURES = 3;
const WORKFLOWS_PAGE_ROWS = 100;

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

/**
 * D-CI-WORKFLOWS: the probe, a GET of the repository's workflow list. It is a fixed
 * argv with no field flag, no method flag and no input, and it names neither the PR nor
 * the head; gh fills `{owner}/{repo}` from the working directory.
 */
const WORKFLOWS_ARGS = Object.freeze(['api', 'repos/{owner}/{repo}/actions/workflows?per_page=' + WORKFLOWS_PAGE_ROWS]);
/** A workflow file lives here; the `dynamic/...` paths GitHub adds for its own apps do not. */
const WORKFLOWS_DIR = '.github/workflows/';

/** The fields every `gh pr view` call of a poll asks for. */
const VIEW_FIELDS = 'headRefOid,mergeable,state';

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
 * @typedef {{ name: string, bucket: string, workflow?: string }} Check
 *   `workflow` is the GitHub Actions workflow name; "" or absent marks an external check.
 * @typedef {{ status: string, reason: string | null, failing: string[], pending: string[] }} Classification
 * @typedef {{ status: string, pr: string, head: string, failing: string[], pending: string[],
 *   waited: number, reason: string | null }} CiResult
 *   `head` is the first 7 hex characters.
 * @typedef {{ pr: string, head: string, exec: ExecFn, clock: Clock, env?: NodeJS.ProcessEnv }} WaitInput
 * @typedef {{ state: 'deadline', rowsRead: boolean } | { state: 'failed' } | { state: 'pending', pending: string[] }
 *   | { state: 'open' }
 *   | { state: 'stall', status: string, reason: string | null }
 *   | { state: 'done', result: CiResult }} PollStep
 *   A `stall` keeps the wait going and names the line to give if the deadline comes first. A
 *   `deadline` is a poll that the deadline cut short, so it is no counted poll; `rowsRead` is
 *   true when the poll had read check rows, or a reply it could not read, before the cut.
 * @typedef {{ status: string, reason: string | null, pending: string[] }} Last
 *   The line the last counted poll gives at the deadline.
 * @typedef {{ exec?: ExecFn, clock?: Clock, env?: NodeJS.ProcessEnv }} MainDeps
 * @typedef {{ code: number, stdout: string }} Outcome
 */

/**
 * The line of a wait that has no verdict at the deadline: the start of the loop, an open or a
 * failed poll, and a loop that ran out of MAX_POLLS. It is shared, so it is frozen.
 *
 * @type {Readonly<Last>}
 */
const DEADLINE_LAST = Object.freeze({ status: 'INDETERMINATE', reason: 'deadline', pending: Object.freeze([]) });

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
 * D-CI-CLASSIFIER: check-ci-status step 5 over `bucket`, plus the stricter workflow
 * rule. In priority order: any `pending` is PENDING; else any `fail` or `cancel` is
 * FAILING; else every check `pass` or `skipping` with at least one `pass` is PASSING;
 * else INDETERMINATE. PASSING is a positive conjunction, so an undocumented bucket, an
 * all-`skipping` set or an empty set never reaches it.
 *
 * D-CI-WORKFLOW-RULE: a set that passes by step 5 is PASSING only when at least one
 * passing check is a GitHub Actions job (a non-empty string `workflow`). A set with
 * passes from external checks alone, a commit status or a third-party app, is
 * INDETERMINATE (no-workflow-check): the repository's workflow may not have run. So
 * PASSING proves that a GitHub Actions check passed and nothing is pending or failing;
 * it does not prove that the test workflow ran by name. merge-readiness.test.ts runs
 * every multiset of 1 to 3 checks through this and through the prose clauses and
 * requires the statuses to agree, or this to be stricter only by no-workflow-check.
 * (The empty set is not classified here: an empty list is "no checks", which
 * waitForCi reads as no classification at all.)
 *
 * @param {readonly Check[]} checks
 * @returns {Classification}
 */
function classifyChecks(checks) {
  const failing = [];
  const pending = [];
  let pass = 0;
  let actionsPass = 0;
  let unrecognised = 0;
  const count = Math.min(Array.isArray(checks) ? checks.length : 0, MAX_CHECKS);
  for (let i = 0; i < count; i++) {
    const check = checks[i];
    switch (check.bucket) {
      case 'pending': pending.push(check.name); break;
      case 'fail':
      case 'cancel': failing.push(check.name); break;
      case 'pass':
        pass++;
        if (typeof check.workflow === 'string' && check.workflow !== '') actionsPass++;
        break;
      case 'skipping': break;
      default: unrecognised++;
    }
  }
  if (pending.length > 0) return { status: 'PENDING', reason: null, failing, pending };
  if (failing.length > 0) return { status: 'FAILING', reason: null, failing, pending };
  if (unrecognised === 0 && pass > 0) {
    return actionsPass > 0
      ? { status: 'PASSING', reason: null, failing, pending }
      : { status: 'INDETERMINATE', reason: 'no-workflow-check', failing, pending };
  }
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

/**
 * Whether a gh call ran out its timeout: spawnSync then reports the error code ETIMEDOUT.
 * A call that failed in any other way, fast or slow, did not.
 *
 * @param {ExecResult | null} res
 * @returns {boolean}
 */
function timedOut(res) {
  return res !== null && typeof res === 'object' && Boolean(res.error) && res.error.code === 'ETIMEDOUT';
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
 * The `gh pr view --json headRefOid,mergeable,state` reply. `headRefOid` and `state` are
 * strict: a head that is not 40 lowercase hex, or a `state` that is not a string, makes the
 * reply unparseable. A `mergeable` that is absent or not a string is read as null, the same
 * as UNKNOWN, and never makes the reply unparseable.
 *
 * @param {string} stdout
 * @returns {{ oid: string, mergeable: string | null, state: string } | null}  null for any other shape
 */
function parseView(stdout) {
  const value = parseJson(stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.headRefOid !== 'string' || !HEAD_RE.test(value.headRefOid)) return null;
  if (typeof value.state !== 'string') return null;
  return { oid: value.headRefOid, mergeable: typeof value.mergeable === 'string' ? value.mergeable : null, state: value.state };
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
    checks.push({ name: row.name, bucket: row.bucket, workflow: typeof row.workflow === 'string' ? row.workflow : '' });
  }
  return checks;
}

/**
 * D-CI-WORKFLOWS: whether the workflow list holds an active workflow file. A row is a
 * workflow file when its `state` is exactly `active` and its `path` starts with
 * `.github/workflows/`; the `dynamic/...` paths of GitHub's own apps and every
 * disabled or deleted row are not. The reply is read whole before it is judged, so a
 * row without a string `path` and `state` makes the reply unreadable even beside an
 * active one. The list is one page: no match is a "no" only when the rows read equal
 * `total_count` (and fit the page), and a page that is not all of the list proves
 * nothing about the rest. The workflow files themselves are never opened.
 *
 * @param {string} stdout  the `gh api` reply
 * @returns {boolean | null}  true: some active workflow file. false: none, and the
 *   list is complete. null: bad JSON, a bad row, or an incomplete page.
 */
function parseActiveWorkflows(stdout) {
  const value = parseJson(stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const listed = value.workflows;
  const total = value.total_count;
  if (!Array.isArray(listed) || listed.length > WORKFLOWS_PAGE_ROWS) return null;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null;
  let active = false;
  for (const row of listed) {
    if (row === null || typeof row !== 'object' || typeof row.path !== 'string' || typeof row.state !== 'string') return null;
    if (row.state === 'active' && row.path.startsWith(WORKFLOWS_DIR)) active = true;
  }
  if (active) return true;
  return listed.length === total ? false : null;
}

// ---------------------------------------------------------------------------
// The wait
// ---------------------------------------------------------------------------

/**
 * D-CI-MERGE-STATE: whether GitHub reports the PR as conflicting. It is the one rule for a
 * conflict. mergeGate answers 'conflict' by it, and a caller that has read only the merge
 * state asks it before it reads any check.
 *
 * @param {unknown} mergeable  the `gh pr view` value in any shape
 * @returns {boolean}
 */
function isConflicting(mergeable) {
  return mergeable === 'CONFLICTING';
}

/**
 * D-CI-WORKFLOWS: what the workflow probe has said, as one answer. It is the one reading
 * of the probe's value, used by mergeGate and by matchedStep alike. Only the booleans
 * true and false are answers; null, left out and any other value ask for the probe.
 *
 * @param {unknown} workflowsActive
 * @returns {'active' | 'none' | 'ask'}
 */
function probeAnswer(workflowsActive) {
  if (workflowsActive === true) return 'active';
  return workflowsActive === false ? 'none' : 'ask';
}

/**
 * D-CI-MERGE-STATE, D-CI-WORKFLOWS: the one merge rule. GitHub computes `mergeable`
 * lazily, and runs no pull request workflow on a conflicting PR, so the checks of a head
 * say nothing about the PR unless GitHub reports it MERGEABLE. An empty check list says
 * nothing either unless the repository has no workflow that could still start.
 * `status` is a classifier status ('NO_CI' for an empty list), or null before any check
 * is read; `mergeable` is the `gh pr view` value in any shape; `workflowsActive` is what
 * the workflow probe found: true (an active workflow file), false (none), or null or
 * left out when it was not made or gave no answer. Each case has its own answer, so a
 * caller never reads `mergeable` again. The probe value has two readers, both through
 * probeAnswer: mergeGate, for an empty list, and matchedStep, for rows that are all external
 * checks:
 *   'conflict'           isConflicting(mergeable), whatever the status.
 *   'await-merge-state'  PASSING or NO_CI while mergeable is anything but MERGEABLE
 *                        (UNKNOWN, absent or odd). It is neither a verdict nor a conflict:
 *                        waitForCi keeps the wait open for another read, and a single read
 *                        takes it as unknown.
 *   'probe'              NO_CI on MERGEABLE with no usable probe answer (null, left out or
 *                        not a boolean): the workflow list has to be asked.
 *   'workflow-active'    NO_CI on MERGEABLE, and the probe found an active workflow file:
 *                        a run may still start.
 *   'keep'               the status stands: PASSING on MERGEABLE, NO_CI on MERGEABLE with a
 *                        probe that found no workflow file (waitForCi holds that NO_CI until
 *                        the deadline, so checks that appear later decide), and FAILING,
 *                        PENDING and INDETERMINATE, which do not depend on the merge state
 *                        or the probe.
 *
 * @param {string | null} status
 * @param {unknown} mergeable
 * @param {boolean | null} [workflowsActive]
 * @returns {'conflict' | 'await-merge-state' | 'probe' | 'workflow-active' | 'keep'}
 */
function mergeGate(status, mergeable, workflowsActive) {
  if (isConflicting(mergeable)) return 'conflict';
  const mergeableNow = mergeable === 'MERGEABLE';
  if (status === 'PASSING') return mergeableNow ? 'keep' : 'await-merge-state';
  if (status !== 'NO_CI') return 'keep';
  if (!mergeableNow) return 'await-merge-state';
  const answer = probeAnswer(workflowsActive);
  if (answer === 'active') return 'workflow-active';
  return answer === 'none' ? 'keep' : 'probe';
}

/**
 * @param {string} status
 * @param {string | null} reason
 * @param {string[]} [failing]
 * @param {string[]} [pending]
 * @returns {{ state: 'done', status: string, reason: string | null, failing: string[], pending: string[] }}
 */
function done(status, reason, failing = [], pending = []) {
  return { state: 'done', status, reason, failing, pending };
}

/**
 * A step that keeps the wait going and names the line to give if the deadline comes first.
 *
 * @param {string} status
 * @param {string | null} reason
 * @returns {{ state: 'stall', status: string, reason: string | null }}
 */
function stall(status, reason) {
  return { state: 'stall', status, reason };
}

/**
 * The outcome of one poll on the named head, as a pure function of what the poll read
 * (the rules are classifyChecks's and mergeGate's). `verdict` is the classification
 * of the rows, or null for an empty list. `workflowsActive` is the probe's answer (see
 * mergeGate). An empty list reads it through mergeGate, and each answer of mergeGate maps
 * to one step. This function reads it itself (probeAnswer) on the external-only path only:
 * rows that are all external checks (no-workflow-check), where a workflow run that has not
 * started yet could still change the verdict. It never reads `mergeable` itself. The
 * outcome is one of:
 *   pending  keep waiting: a pending check
 *   open     a pass or an empty list while the gate awaits the merge state
 *   probe    an empty list on MERGEABLE, or external-only rows, and the probe has no
 *            answer yet: the caller makes the workflow probe, then asks again with its
 *            answer
 *   stall    keep waiting, with a line for the deadline: NO_CI for an empty list when the
 *            repository has no workflow file; INDETERMINATE (no-workflow-check) for an empty
 *            list or external-only rows when it has an active one, since a run may still
 *            start. A later poll that reads checks decides instead.
 *   done     a final status and reason, with the failing and pending names
 *
 * @param {Classification | null} verdict
 * @param {unknown} mergeable
 * @param {boolean | null} [workflowsActive]
 * @returns {{ state: 'pending', pending: string[] } | { state: 'open' } | { state: 'probe' }
 *   | { state: 'stall', status: 'INDETERMINATE', reason: 'no-workflow-check' }
 *   | { state: 'stall', status: 'NO_CI', reason: null }
 *   | ReturnType<typeof done>}
 */
function matchedStep(verdict, mergeable, workflowsActive) {
  const gate = mergeGate(verdict === null ? 'NO_CI' : verdict.status, mergeable, workflowsActive);
  if (gate === 'conflict') return done('INDETERMINATE', 'merge-conflict');
  if (verdict === null) {
    if (gate === 'keep') return stall('NO_CI', null);
    if (gate === 'workflow-active') return stall('INDETERMINATE', 'no-workflow-check');
    return gate === 'probe' ? { state: 'probe' } : { state: 'open' };
  }
  if (verdict.reason === 'no-workflow-check') {
    const answer = probeAnswer(workflowsActive);
    if (answer === 'ask') return { state: 'probe' };
    return answer === 'none' ? done('INDETERMINATE', 'no-workflow-check') : stall('INDETERMINATE', 'no-workflow-check');
  }
  if (verdict.status === 'PENDING') return { state: 'pending', pending: verdict.pending };
  if (gate !== 'keep') return { state: 'open' };
  return done(verdict.status, verdict.reason, verdict.failing, verdict.pending);
}

/**
 * The line a counted poll leaves for the deadline: PENDING with its names, a stall with its
 * status and reason, and INDETERMINATE (deadline) for an open or a failed poll, which
 * clears an earlier stall. A step that is not a counted poll never gets here.
 *
 * @param {PollStep} step
 * @returns {Last}
 */
function lastOf(step) {
  if (step.state === 'pending') return { status: 'PENDING', reason: null, pending: step.pending };
  if (step.state === 'stall') return { status: step.status, reason: step.reason, pending: [] };
  return DEADLINE_LAST;
}

/**
 * The line at the end of the loop. NO_CI stands only when the deadline ended the loop:
 * a loop that ran out of MAX_POLLS before the deadline has not waited out CI, so it reads
 * INDETERMINATE (deadline).
 *
 * @param {Last} last
 * @param {boolean} reachedDeadline
 * @returns {Last}
 */
function tailOf(last, reachedDeadline) {
  return last.status === 'NO_CI' && !reachedDeadline ? DEADLINE_LAST : last;
}

/**
 * D-CI-WORKFLOWS: the workflow probe, as one result. `gh` is waitForCi's bounded gh
 * call, so the probe gets its timeout and, with no time left, no call at all. The result is
 * one of:
 *   deadline     no time was left, so no call was made
 *   failed       the call was not answered or exited non-zero: a failed poll
 *   unparseable  the reply cannot be read, or is one page of many (parseActiveWorkflows)
 *   answer       `active`: true for some active workflow file, false for none
 *
 * @param {(args: readonly string[]) => Promise<GhAnswer | null>} gh
 * @returns {Promise<{ kind: 'deadline' } | { kind: 'failed' } | { kind: 'unparseable' }
 *   | { kind: 'answer', active: boolean }>}
 */
async function askWorkflows(gh) {
  const probe = await gh(WORKFLOWS_ARGS);
  if (probe === null) return { kind: 'deadline' };
  if (!probe.answered || probe.status !== 0) return { kind: 'failed' };
  const active = parseActiveWorkflows(probe.stdout);
  return active === null ? { kind: 'unparseable' } : { kind: 'answer', active };
}

/**
 * D-CI-HEAD-BINDING: wait for the CI verdict of `head`, and of nothing else. `gh pr
 * checks` has no SHA field and reports the PR's current head, so each poll reads
 * `headRefOid` first. A different value means the checks on offer belong to another
 * head: they are not read, the merge state is not used, and the poll is a stall
 * (INDETERMINATE, head-mismatch) that the wait polls through until the deadline (GitHub
 * moves the head and creates checks after a push, and CI can start much later). A poll
 * that sees `head` again is decided by its checks. The poll reads `headRefOid` once more
 * after the checks call: the checks count only when it is still `head`. A head that moved
 * leaves the poll open (no verdict); a second read that fails or cannot be read is a failed
 * poll. A PASSING needs a poll that saw this head before and after its checks and passed
 * the rules of classifyChecks (D-CI-WORKFLOW-RULE) and mergeGate (D-CI-MERGE-STATE).
 *
 * D-CI-PR-STATE: GitHub reports `mergeable` UNKNOWN for a merged PR for good (gh 2.88.1,
 * probed on 2026-10-22), so a PR that is no longer open would wait to the deadline for a
 * merge state that never comes. The first read of a poll also asks `state`: anything but
 * the exact string OPEN ends the run at once as INDETERMINATE (not-open), before the head
 * is compared, and a `state` that is not a string is unparseable. Never PASSING.
 *
 * D-CI-MERGE-STATE, D-CI-WORKFLOWS: the rules are mergeGate's and matchedStep's; this loop
 * acts on their answers. On a matching head, `mergeable` CONFLICTING is INDETERMINATE
 * (merge-conflict) at once, before the checks are read. An open step (the gate awaits the
 * merge state) is not PENDING, so a head that never reads MERGEABLE ends INDETERMINATE
 * (deadline). An empty list on MERGEABLE, and rows that are all external checks, need the
 * workflow probe. Rows that are all external checks end INDETERMINATE (no-workflow-check) at
 * once when the repository has no active workflow file. In the other cases a workflow run
 * may still start, so the step is a stall that keeps the wait going: an empty list with no
 * workflow file stalls as NO_CI, and an empty list or external-only rows with an active
 * workflow file stall as INDETERMINATE (no-workflow-check). Checks that appear decide.
 * A step that asks for the probe gets it from askWorkflows, `gh api` over WORKFLOWS_ARGS,
 * through the same bounded gh call (timeout min(GH_CALL_CAP_SECONDS, time left), none when
 * no time is left, which ends the loop as for any call). At most one probe is answered per
 * run: the first answer is kept and goes to every later poll, so no later poll asks again.
 * A probe whose gh call fails is a failed poll, and the next poll probes again; a reply
 * parseActiveWorkflows cannot read is INDETERMINATE (unparseable) at once. No other path
 * makes the probe.
 *
 * Per poll: `gh pr view <n> --json headRefOid,mergeable,state`, then `gh pr checks <n>
 * --json name,state,bucket,workflow` (exit 0 or 8 are results, as in check-ci-status
 * step 3), then the same view call again (a bounded gh call like the others, not made
 * when no time is left), then, on the paths that need it and only while the probe has no
 * answer, the workflow probe. A PENDING, open or stall poll sleeps min(POLL_INTERVAL_SECONDS,
 * remaining) and polls again; any other result returns. A poll whose gh call fails is not a
 * result: three failed polls in a row are INDETERMINATE (gh-failed), fewer are retried; a
 * pending, open or stall poll in between clears the count. A gh call that the time left cut
 * below GH_CALL_CAP_SECONDS and that ran out that timeout is the deadline, not a failed poll:
 * that poll does not count. Any other failure of that call is a failed poll.
 *
 * The loop stops at the deadline or after MAX_POLLS. The last counted poll gives the line:
 * PENDING stays PENDING, a stall gives its status and reason, and an open or a failed poll,
 * which clears an earlier stall, gives INDETERMINATE (deadline). NO_CI stands only when the
 * deadline ended the loop; a loop that ran out of MAX_POLLS first is INDETERMINATE
 * (deadline). One cut poll changes the line: when the deadline cuts the second head read or
 * the workflow probe after the checks call gave rows (or a reply that cannot be read), those
 * rows contradict an earlier stall, so the stall does not survive and the line is
 * INDETERMINATE (deadline). An earlier PENDING stands. A cut before any row came back (the
 * first head read, the checks call, or a later call after an empty list) leaves the line of
 * the last counted poll.
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
   * One gh call, its timeout min(GH_CALL_CAP_SECONDS, time left). It is null, with no
   * call made, when no time is left. It is also null for a call that the time left held
   * below GH_CALL_CAP_SECONDS and that ran out that timeout: the deadline cut it short, so
   * it is no failed poll. A call that fails in any other way is a failed poll.
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
    const cutShort = left < GH_CALL_CAP_SECONDS * 1000 && timedOut(res);
    return cutShort ? null : normalize(res);
  };

  /** The probe's first answer, kept for the run; null until a probe answers. */
  let workflowsActive = null;

  /**
   * A step that ends the run with a result.
   *
   * @param {string} status
   * @param {string | null} reason
   * @param {string[]} failing
   * @param {string[]} pending
   * @returns {PollStep}
   */
  const resultStep = (status, reason, failing, pending) => ({ state: 'done', result: finish(status, reason, failing, pending) });

  /**
   * The step for what matchedStep decided. A probe request cannot be a final step: it is
   * no verdict, and the wait stays open.
   *
   * @param {ReturnType<typeof matchedStep>} next
   * @returns {PollStep}
   */
  const stepOf = next => {
    if (next.state === 'done') return resultStep(next.status, next.reason, next.failing, next.pending);
    return next.state === 'probe' ? { state: 'open' } : next;
  };

  const viewArgs = ['pr', 'view', pr, '--json', VIEW_FIELDS];

  /**
   * One poll: the view, then, on a matching head that does not conflict, the checks, then
   * the view again, then, on the paths that need it while the probe has no answer, the
   * workflow probe.
   *
   * @returns {Promise<PollStep>}
   */
  const readPoll = async () => {
    const view = await gh(viewArgs);
    if (view === null) return { state: 'deadline', rowsRead: false };
    if (view.answered && view.status === 1 && NO_PR_RE.test(view.stderr)) return resultStep('NO_PR', null, [], []);
    if (!view.answered || view.status !== 0) return { state: 'failed' };
    const parsed = parseView(view.stdout);
    if (parsed === null) return resultStep('INDETERMINATE', 'unparseable', [], []);
    if (parsed.state !== 'OPEN') return resultStep('INDETERMINATE', 'not-open', [], []);
    if (parsed.oid !== head) return stall('INDETERMINATE', 'head-mismatch');
    if (isConflicting(parsed.mergeable)) return resultStep('INDETERMINATE', 'merge-conflict', [], []);

    const checks = await gh(['pr', 'checks', pr, '--json', 'name,state,bucket,workflow']);
    if (checks === null) return { state: 'deadline', rowsRead: false };
    const isResult = checks.answered && (checks.status === 0 || checks.status === 8);
    const isEmpty = checks.answered && checks.status === 1 && NO_CHECKS_RE.test(checks.stderr);
    if (!isResult && !isEmpty) return { state: 'failed' };
    const rows = isResult ? parseChecks(checks.stdout) : [];
    const second = await gh(viewArgs);
    if (second === null) return { state: 'deadline', rowsRead: rows === null || rows.length > 0 };
    const after = second.answered && second.status === 0 ? parseView(second.stdout) : null;
    if (after === null) return { state: 'failed' };
    if (after.oid !== head) return { state: 'open' };
    if (rows === null) return resultStep('INDETERMINATE', 'unparseable', [], []);
    const verdict = rows.length > 0 ? classifyChecks(rows) : null;

    const next = matchedStep(verdict, parsed.mergeable, workflowsActive);
    if (next.state !== 'probe') return stepOf(next);
    const asked = await askWorkflows(gh);
    if (asked.kind === 'deadline') return { state: 'deadline', rowsRead: verdict !== null };
    if (asked.kind === 'failed') return { state: 'failed' };
    if (asked.kind === 'unparseable') return resultStep('INDETERMINATE', 'unparseable', [], []);
    workflowsActive = asked.active;
    return stepOf(matchedStep(verdict, parsed.mergeable, workflowsActive));
  };

  let failedPolls = 0;
  let reachedDeadline = false;
  /** @type {Readonly<Last>} */
  let last = DEADLINE_LAST;

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (clock.now() >= deadline) {
      reachedDeadline = true;
      break;
    }

    const step = await readPoll();
    if (step.state === 'deadline') {
      reachedDeadline = true;
      if (step.rowsRead && last.status !== 'PENDING') last = DEADLINE_LAST;
      break;
    }
    if (step.state === 'done') return step.result;
    if (step.state === 'failed') {
      failedPolls++;
      if (failedPolls >= MAX_CONSECUTIVE_GH_FAILURES) return finish('INDETERMINATE', 'gh-failed', [], []);
    } else {
      failedPolls = 0;
    }
    last = lastOf(step);

    const left = deadline - clock.now();
    if (left <= 0) {
      reachedDeadline = true;
      break;
    }
    await clock.sleep(Math.min(POLL_INTERVAL_SECONDS * 1000, left));
  }

  const tail = tailOf(last, reachedDeadline);
  return finish(tail.status, tail.reason, [], tail.pending);
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
  GH_CALL_CAP_SECONDS,
  MAX_POLLS,
  MAX_CONSECUTIVE_GH_FAILURES,
  LINE_MAX,
  NAME_MAX,
  NAMES_LISTED,
  LINE_RE,
  USAGE_LINE,
  WORKFLOWS_ARGS,
  parseArgs,
  sanitizeName,
  formatNames,
  classifyChecks,
  isConflicting,
  mergeGate,
  matchedStep,
  parseChecks,
  parseActiveWorkflows,
  askWorkflows,
  renderLine,
  checkLine,
  waitForCi,
  main,
});
