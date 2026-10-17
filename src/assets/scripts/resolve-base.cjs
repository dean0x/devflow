#!/usr/bin/env node
// src/assets/scripts/resolve-base.cjs
//
// The base for a branch diff (#495: use a fresh base for branch diffs). A branch diff
// that reads the local base branch lists the files of every commit the local branch is
// missing from the remote. This script fetches the base once, picks the tip to diff
// against by one stated rule, and prints the fork point of that tip and HEAD. Installed
// beside ci-wait.cjs under ~/.devflow/scripts/.
//
// Usage, from the worktree (the caller changes into it first):
//   node resolve-base.cjs <local|pr> <name> [--cross <true|false>]
//     local    the pre-PR rule: origin's tip is chosen only when the local fork point
//              is an ancestor of origin's fork point
//     pr       the PR rule: origin's tip whenever it resolves (fresh, or cached after a
//              failed fetch), otherwise the local tip
//     <name>   the base branch, passed in double quotes
//     --cross  true for a cross-repository PR: no fetch, the local tip, REASON fork-origin
//
// stdout is exactly one line, ending in a newline, exit 0 on every handled path:
//   BASE_REF=<40hex|64hex|none> TIP=<origin|local|none> FETCH=<ok|failed|skipped> REASON=<code> NOTE=<none|info|degraded|stop>
//   BASE_REF  the merge base of the chosen tip and HEAD, verified as a commit; none when
//             there is no usable base
//   TIP       the tip that won; none when no tip was used
//   FETCH     ok only when the fetch exited 0; failed when it ran and failed; skipped
//             when it did not run. A ref that resolves proves the ref exists, not that
//             it is fresh, so FETCH is taken from the fetch exit status alone.
//   REASON    one code from REASON_NOTES; NOTE is derived from it (none, info, degraded,
//             stop). The output is checked against LINE_RE and against that table before
//             it is written. Anything that fails the check prints FALLBACK_LINE.
// stderr stays empty. The name is never written to stdout or stderr. When stdout cannot
// be written, the script exits 3 with nothing on stderr; every other path exits 0 with
// one line.
//
// Check order: the strict name class (STRICT_NAME_RE), then `git check-ref-format`, then
// the origin URL, then the cross-repository flag, then the fetch (after the read of
// core.sshCommand), then the tip of each ref, then the merge base of each tip with HEAD,
// then the ancestry check (the pre-PR rule only), then the choice of tip, then the
// verification of BASE_REF. A name that fails either name check makes no further git call.
//
// Design constraints (binding):
//   - Plumbing: every decision here is a fixed comparison of git answers. The ancestry
//     checks are deterministic, and the keep-local policy is a rule, not a judgement.
//   - Keep-local policy: in the pre-PR rule a local base that holds commits origin lacks
//     (local-ahead or diverged) stays the base. The branch was cut from it, so those
//     commits are the branch's own context. Only a local fork point that is an ancestor
//     of origin's moves the base to origin.
//   - Tri-state ancestry (`merge-base --is-ancestor`): exit 0 is true, exit 1 is false,
//     any other exit is unknown. Unknown is never read as false. It gives no-merge-base.
//     A call that ends with no exit of its own is covered by the next point.
//   - A local git call that gives no answer (a timeout, a signal kill, a git that does not
//     start) gives resolver-unavailable, at every call site: the format check, the origin
//     URL, the core.sshCommand read, the tip of each ref, the merge base of each tip, the
//     ancestry check and the verification. A call that exits on its own is an answer, and
//     its result maps by its own rule: a merge base that exits non-zero or is not a commit
//     ID is no merge base for that tip, and the choice gives no-merge-base when it needs the
//     tip; an exit that the call site does not accept gives resolver-unavailable, except at
//     the core.sshCommand read, where an exit other than 0 or 1 counts as configured, so a
//     command is never replaced on a guess.
//   - The fetch is one call with a fixed argv: it writes only refs/remotes/origin/<name>
//     (an empty --refmap= keeps the configured fetch refspecs out of the update), writes no
//     FETCH_HEAD, follows no tags, and carries no --filter or --depth. The
//     repository's hook, fsmonitor and upload-pack settings do not apply to it. Credential
//     prompts are off: GIT_TERMINAL_PROMPT is 0, GIT_ASKPASS and SSH_ASKPASS are empty, so
//     git runs no askpass program, and the default SSH command carries BatchMode=yes.
//     BatchMode and ConnectTimeout are added only when no SSH command is configured
//     (GIT_SSH_COMMAND, GIT_SSH or core.sshCommand); a configured command is never
//     replaced, and host-key checks are never weakened.
//   - The fetch is bounded at FETCH_TIMEOUT_MS. A fetch that does not exit on its own is
//     followed by a kill of its whole process group (POSIX), so no helper survives. The kill
//     is SIGKILL, so git cannot remove the lock of the ref it was updating. A lock file
//     left at refs/remotes/origin/<name>.lock is read by every later run as fetch-failed,
//     until the user deletes it. This is rare: git holds the lock only for the short ref
//     update at the end of the fetch.
//   - One run budget, RUN_BUDGET_MS, stays below the 120 s Bash tool limit. Each call takes
//     the smaller of its own bound and the time left in the budget. A local call with no
//     time left is not started and gives resolver-unavailable; the fetch with no time left
//     gives timeout.
//   - No retry, including on a held ref lock. A failed fetch with a cached origin ref
//     applies the rule to the cached ref (REASON fetch-failed or timeout, unverified).
//   - Git floor: 2.29 (the flag set) is asserted, not probed. An unknown option exits
//     non-zero and reads as fetch-failed.
//   - Every subprocess is `git`, started with an argv array and `shell: false`, stdin
//     ignored, a timeout and a maxBuffer. Every git call carries `-c core.fsmonitor=false`.
//   - Nothing here calls process.exit(); the boundary sets process.exitCode.
//   - Helpers (the fetch, the ancestry check, the commit check, the child environment)
//     follow verify-evidence.cjs and resolve-evidence-policy.cjs. They are copied, not
//     imported, so those scripts stay untouched.

'use strict';

const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// Closed vocabularies and bounds
// ---------------------------------------------------------------------------

/**
 * The strict base-name class, one literal. Every prompt that checks a base name copies its
 * `source` exactly, and a test holds each copy equal to this export. The one deliberate
 * variant is the dynamic-build helper's BRANCH_NAME: a ticket branch is local, so the helper
 * holds this class less the `origin/` refusal, and a test holds that relation. In words: 1 to
 * 200 ASCII letters, digits and `._/+@,#-`; not starting with `-`, `#` or `origin/`; no `..`;
 * not the whole name `@`, `HEAD`, `FETCH_HEAD`, `ORIG_HEAD` or `MERGE_HEAD`.
 */
const STRICT_NAME_RE = /^(?![-#]|origin\/|(?:@|(?:FETCH_|ORIG_|MERGE_)?HEAD)$)(?!.*\.\.)[A-Za-z0-9._\/+@,#-]{1,200}$/;

/** REASON to NOTE: the only written copy of the table. */
const REASON_NOTES = Object.freeze({
  'fresh': 'none',
  'kept-local-ahead': 'none',
  'no-remote-branch': 'none',
  'fork-origin': 'info',
  'no-origin': 'info',
  'fetch-failed': 'degraded',
  'timeout': 'degraded',
  'invalid-name': 'stop',
  'no-merge-base': 'stop',
  'no-ref': 'stop',
  'usage': 'stop',
  'resolver-unavailable': 'stop',
});

/**
 * The output grammar: anchored, closed alternations only, named groups for readers.
 * Prompts never copy it; the script re-checks its own line against it before printing.
 */
const LINE_RE = /^BASE_REF=(?<baseRef>[0-9a-f]{40}|[0-9a-f]{64}|none) TIP=(?<tip>origin|local|none) FETCH=(?<fetch>ok|failed|skipped) REASON=(?<reason>fresh|kept-local-ahead|no-remote-branch|fork-origin|no-origin|fetch-failed|timeout|invalid-name|no-merge-base|no-ref|usage|resolver-unavailable) NOTE=(?<note>none|info|degraded|stop)$/;

/** The line every unhandled failure prints. A constant, so the boundary can always compose it. */
const FALLBACK_LINE = 'BASE_REF=none TIP=none FETCH=skipped REASON=resolver-unavailable NOTE=stop';

/** The FETCH value a reason implies, where it implies one. A freshness claim needs an ok fetch. */
const FETCH_IMPLIED = Object.freeze({
  'fresh': 'ok',
  'kept-local-ahead': 'ok',
  'no-remote-branch': 'failed',
  'fetch-failed': 'failed',
  'timeout': 'failed',
  'fork-origin': 'skipped',
  'no-origin': 'skipped',
  'invalid-name': 'skipped',
  'usage': 'skipped',
});

const HEX_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The wall-clock backstop for the one fetch. */
const FETCH_TIMEOUT_MS = 45000;
/**
 * The bound of every other git call, which is local and short. The bound counts the launch
 * of git. The launch of node stalled 14 to 16 s on a loaded macOS machine, and git launches
 * did not stall. 30 s keeps about twice that stall and stays below FETCH_TIMEOUT_MS.
 */
const LOCAL_TIMEOUT_MS = 30000;
/**
 * The budget of one whole run. The prompts call this script under the 120 s Bash tool
 * limit, and 100 s leaves the rest for the launch of node.
 */
const RUN_BUDGET_MS = 100000;
/** rev-parse, merge-base and config print one short line. */
const LINE_MAX_BUFFER = 4096;
/** The fetch's stderr is read for one phrase and discarded. */
const FETCH_MAX_BUFFER = 1048576;

/** Added to the fetch child only when no SSH command is configured. */
const SSH_DEFAULT_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=5';
/** git's message (LC_ALL=C) when the remote has no such branch; exit 128. */
const MISSING_BRANCH_TEXT = "couldn't find remote ref";

// ---------------------------------------------------------------------------
// The name, the arguments
// ---------------------------------------------------------------------------

/**
 * @param {unknown} name
 * @returns {boolean}
 */
function isStrictName(name) {
  return typeof name === 'string' && STRICT_NAME_RE.test(name);
}

/**
 * @typedef {{ kind: 'ok', mode: 'local' | 'pr', name: string, cross: boolean } | { kind: 'usage' }} ParsedArgs
 */

/**
 * `<local|pr> <name> [--cross <true|false>]`. The name is any string here: the later
 * checks decide about it, and a usage result never carries it.
 *
 * @param {readonly string[]} args  argv without the node binary and the script path
 * @returns {ParsedArgs}
 */
function parseArgs(args) {
  if (!Array.isArray(args) || (args.length !== 2 && args.length !== 4)) return { kind: 'usage' };
  const mode = args[0];
  if (mode !== 'local' && mode !== 'pr') return { kind: 'usage' };
  let cross = false;
  if (args.length === 4) {
    if (args[2] !== '--cross' || (args[3] !== 'true' && args[3] !== 'false')) return { kind: 'usage' };
    cross = args[3] === 'true';
  }
  return { kind: 'ok', mode, name: String(args[1]), cross };
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

/**
 * @typedef {{ baseRef: string, tip: 'origin' | 'local' | 'none', fetch: 'ok' | 'failed' | 'skipped', reason: string }} Selection
 */

/**
 * @param {Selection} r
 * @returns {string}
 */
function formatLine(r) {
  return 'BASE_REF=' + r.baseRef + ' TIP=' + r.tip + ' FETCH=' + r.fetch + ' REASON=' + r.reason
    + ' NOTE=' + REASON_NOTES[r.reason];
}

/**
 * The gate on a composed line: the grammar, then the facts the grammar cannot see. NOTE
 * follows REASON; BASE_REF and TIP are none together and exactly when NOTE is stop; a
 * reason that implies a fetch state is printed with that state.
 *
 * @param {unknown} line
 * @returns {boolean}
 */
function checkLine(line) {
  if (typeof line !== 'string') return false;
  const m = line.match(LINE_RE);
  if (m === null || m.groups === undefined) return false;
  const { baseRef, tip, fetch, reason, note } = m.groups;
  if (REASON_NOTES[reason] !== note) return false;
  if ((baseRef === 'none') !== (note === 'stop')) return false;
  if ((tip === 'none') !== (baseRef === 'none')) return false;
  const implied = FETCH_IMPLIED[reason];
  return implied === undefined || implied === fetch;
}

/**
 * @param {string} reason
 * @param {'ok' | 'failed' | 'skipped'} [fetch]
 * @returns {Selection}
 */
function stopWith(reason, fetch = 'skipped') {
  return { baseRef: 'none', tip: 'none', fetch, reason };
}

// ---------------------------------------------------------------------------
// The choice of tip (pure)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ base: string | null }} Side  the fork point of one tip and HEAD; null when none
 * @typedef {{
 *   mode: 'local' | 'pr',
 *   skip: null | 'no-origin' | 'fork-origin',
 *   fetch: { state: 'ok' | 'failed' | 'skipped', reason: null | 'fetch-failed' | 'timeout' | 'no-remote-branch' },
 *   local: Side | null,
 *   remote: Side | null,
 *   localBehind: boolean | null,
 * }} Facts
 *   local / remote: null when that ref is absent. localBehind: whether the local fork point
 *   is an ancestor of origin's (true, false, or null when it cannot be told).
 */

/**
 * Whether both refs are present and each has a fork point with HEAD. Both the ancestry
 * question and the pre-PR choice need this.
 *
 * @param {Side | null} local
 * @param {Side | null} remote
 * @returns {boolean}
 */
function bothForkPoints(local, remote) {
  return local !== null && remote !== null && local.base !== null && remote.base !== null;
}

/**
 * Whether the remote reported that it has no such branch. A cached origin ref is then
 * ignored: it is not read, and the choice does not use it.
 *
 * @param {FetchOutcome} fetch
 * @returns {boolean}
 */
function remoteLacksBranch(fetch) {
  return fetch.reason === 'no-remote-branch';
}

/**
 * Choose the tip from observed facts. No I/O.
 *
 * pr: origin whenever it resolves, otherwise local. local: origin only when the local fork
 * point is an ancestor of origin's; a local ref alone or an origin ref alone is used as is.
 * When the remote reported no such branch, a cached origin ref is ignored.
 *
 * @param {Facts} f
 * @returns {Selection}
 */
function select(f) {
  const fetch = f.fetch.state;
  const remote = remoteLacksBranch(f.fetch) ? null : f.remote;
  const local = f.local;
  if (local === null && remote === null) return stopWith('no-ref', fetch);

  /** @type {'origin' | 'local'} */
  let tip;
  if (local === null) tip = 'origin';
  else if (remote === null) tip = 'local';
  else if (f.mode === 'pr') tip = 'origin';
  else {
    if (!bothForkPoints(local, remote) || f.localBehind === null) return stopWith('no-merge-base', fetch);
    tip = f.localBehind ? 'origin' : 'local';
  }

  // The branches above leave the chosen side present.
  const side = /** @type {Side} */ (tip === 'origin' ? remote : local);
  if (side.base === null) return stopWith('no-merge-base', fetch);
  return { baseRef: side.base, tip, fetch, reason: successReason(f, tip) };
}

/**
 * @param {Facts} f
 * @param {'origin' | 'local'} tip
 * @returns {string}
 */
function successReason(f, tip) {
  if (f.skip !== null) return f.skip;
  if (f.fetch.state === 'failed' && f.fetch.reason !== null) return f.fetch.reason;
  return tip === 'origin' ? 'fresh' : 'kept-local-ahead';
}

// ---------------------------------------------------------------------------
// Subprocesses: argv arrays, no shell, every call bounded
// ---------------------------------------------------------------------------

/**
 * @typedef {{ status: number | null, stdout?: unknown, stderr?: unknown, error?: { code?: unknown } | null, pid?: number }} RawResult
 * @typedef {(file: string, args: string[], opts: Record<string, unknown>) => RawResult} SpawnFn
 * @typedef {{ spawn: SpawnFn, env: NodeJS.ProcessEnv, parentEnv: NodeJS.ProcessEnv, cwd: string, fetchTimeoutMs: number, platform: string,
 *   now: () => number, deadline: number }} Context
 *   fetchTimeoutMs: the bound of the fetch. now: a monotonic clock in ms. deadline: the end of the run budget on that clock.
 * @typedef {{ ok: boolean, answered: boolean, status: number | null, errorCode: string | null, stdout: string, stderr: string, pid: number }} CallResult
 * @typedef {{ env: NodeJS.ProcessEnv, timeoutMs: number, maxBuffer: number, grouped: boolean }} CallOptions
 *   grouped: run as the leader of its own process group, killed with SIGKILL on a timeout
 */

/**
 * The production spawn. The shell is off whatever the options say.
 *
 * @type {SpawnFn}
 */
function defaultSpawn(file, args, opts) {
  return childProcess.spawnSync(file, [...args], Object.assign({}, opts, { shell: false }));
}

/** @param {unknown} value @returns {string} */
function asText(value) {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/**
 * The environment every git call gets: the caller's, with every credential prompt off and
 * the message language fixed. An empty GIT_ASKPASS makes git skip core.askPass and
 * SSH_ASKPASS too, so it runs no askpass program, and the terminal prompt is off.
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(base) {
  return Object.assign({}, base, {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    LC_ALL: 'C',
  });
}

/** @returns {number} milliseconds on a clock that never goes back */
function monotonicMs() {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds * 1e3 + nanoseconds / 1e6;
}

/**
 * @param {{ spawn?: unknown, env?: unknown, cwd?: unknown, fetchTimeoutMs?: unknown, platform?: unknown, now?: unknown }} [deps]
 * @returns {Context}
 */
function makeContext(deps) {
  const d = deps || {};
  const now = typeof d.now === 'function' ? /** @type {() => number} */ (d.now) : monotonicMs;
  const parentEnv = d.env !== null && typeof d.env === 'object' ? /** @type {NodeJS.ProcessEnv} */ (d.env) : process.env;
  const injected = typeof d.fetchTimeoutMs === 'number' && Number.isInteger(d.fetchTimeoutMs) && d.fetchTimeoutMs > 0 ? d.fetchTimeoutMs : FETCH_TIMEOUT_MS;
  return {
    spawn: typeof d.spawn === 'function' ? /** @type {SpawnFn} */ (d.spawn) : defaultSpawn,
    env: childEnv(parentEnv),
    parentEnv,
    cwd: typeof d.cwd === 'string' && d.cwd !== '' ? d.cwd : process.cwd(),
    fetchTimeoutMs: Math.min(injected, FETCH_TIMEOUT_MS),
    platform: typeof d.platform === 'string' ? d.platform : process.platform,
    now,
    deadline: now() + RUN_BUDGET_MS,
  };
}

/**
 * One bounded subprocess call, normalized. `answered` is true when the process ran to
 * an exit of its own: a call that never started, timed out, was killed by a signal or
 * overflowed did not answer. The timeout is the smaller of the call's own bound and the time
 * left in the run budget; with no time left the call is not started and counts as timed out.
 * The argv array is a fresh copy, so a spawn cannot mutate a caller's constant.
 *
 * @param {Context} ctx
 * @param {string} file
 * @param {readonly string[]} args
 * @param {CallOptions} opts
 * @returns {CallResult}
 */
function runCall(ctx, file, args, opts) {
  const left = ctx.deadline - ctx.now();
  if (!(left > 0)) {
    return { ok: false, answered: false, status: null, errorCode: 'ETIMEDOUT', stdout: '', stderr: '', pid: 0 };
  }
  const res = ctx.spawn(file, [...args], Object.assign({
    cwd: ctx.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Math.max(1, Math.min(opts.timeoutMs, Math.floor(left))),
    maxBuffer: opts.maxBuffer,
    windowsHide: true,
    shell: false,
  }, opts.grouped ? { detached: ctx.platform !== 'win32', killSignal: 'SIGKILL' } : {}));
  const raw = res !== null && typeof res === 'object' ? res : /** @type {RawResult} */ ({ status: null });
  const errorCode = raw.error ? String(raw.error.code || 'EUNKNOWN') : null;
  const status = typeof raw.status === 'number' ? raw.status : null;
  return {
    ok: errorCode === null && status === 0,
    answered: errorCode === null && status !== null,
    status,
    errorCode,
    stdout: asText(raw.stdout),
    stderr: asText(raw.stderr),
    pid: typeof raw.pid === 'number' && Number.isInteger(raw.pid) ? raw.pid : 0,
  };
}

/**
 * A local git call. The override keeps a repository's fsmonitor command from running.
 *
 * @param {Context} ctx
 * @param {readonly string[]} args
 * @returns {CallResult}
 */
function git(ctx, args) {
  return runCall(ctx, 'git', ['-c', 'core.fsmonitor=false', ...args], {
    env: ctx.env, timeoutMs: LOCAL_TIMEOUT_MS, maxBuffer: LINE_MAX_BUFFER, grouped: false,
  });
}

/**
 * Kill every process of a group. ESRCH (nothing left) and any other refusal are ignored.
 * A pid of 0 or 1 would reach the caller's own group or init, so it is never signalled.
 *
 * @param {number} pid  the group leader
 * @param {string} platform
 * @returns {void}
 */
function killGroup(pid, platform) {
  if (platform === 'win32' || !Number.isInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (_) {
    // the group is already gone
  }
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

/**
 * The exact fetch argv. The null device switches off the repository's hooks, fsmonitor is
 * off, and `--upload-pack` replaces the repository's configured program. The empty `--refmap=`
 * keeps the configured remote.origin.fetch refspecs out of the update, so the one refspec
 * given is the only ref written. Never --filter, never --depth. The name has passed the
 * strict class; this sink holds that precondition.
 *
 * @param {string} name
 * @param {string} [platform]
 * @returns {string[]}
 */
function fetchArgv(name, platform) {
  if (!isStrictName(name)) throw new Error('resolve-base: unchecked name');
  const nullDevice = (platform === undefined ? process.platform : platform) === 'win32' ? 'NUL' : '/dev/null';
  return [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=' + nullDevice,
    'fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--no-auto-maintenance',
    '--no-show-forced-updates', '--quiet', '--refmap=', '--upload-pack=git-upload-pack',
    'origin', '+refs/heads/' + name + ':refs/remotes/origin/' + name,
  ];
}

/**
 * Whether any SSH command is configured: GIT_SSH_COMMAND or GIT_SSH in the caller's
 * environment, or core.sshCommand in the repository's configuration. An answer that cannot
 * be read counts as configured, so a command is never replaced on a guess. No command
 * string is parsed. null when the configuration read gave no answer at all.
 *
 * @param {Context} ctx
 * @returns {boolean | null}
 */
function sshCommandConfigured(ctx) {
  if (ctx.parentEnv.GIT_SSH_COMMAND !== undefined || ctx.parentEnv.GIT_SSH !== undefined) return true;
  const r = git(ctx, ['config', '--get', 'core.sshCommand']);
  if (!r.answered) return null;
  return r.status !== 1;
}

/**
 * @typedef {{ state: 'ok' | 'failed' | 'skipped', reason: null | 'fetch-failed' | 'timeout' | 'no-remote-branch' }} FetchOutcome
 */

/**
 * Fetch the base branch once. Exit 0 is ok. A timeout is `timeout`. Exit 128 with git's
 * missing-ref text (LC_ALL=C) is `no-remote-branch`. Any other failure is `fetch-failed`.
 * The captured stderr is read for that one phrase and dropped. A fetch that did not exit
 * on its own is followed by a kill of its process group.
 *
 * @param {Context} ctx
 * @param {string} name
 * @param {boolean} sshConfigured  whether an SSH command is configured, so none is added
 * @returns {FetchOutcome}
 */
function fetchBase(ctx, name, sshConfigured) {
  const env = Object.assign({}, ctx.env);
  if (!sshConfigured) env.GIT_SSH_COMMAND = SSH_DEFAULT_COMMAND;
  const r = runCall(ctx, 'git', fetchArgv(name, ctx.platform), {
    env, timeoutMs: ctx.fetchTimeoutMs, maxBuffer: FETCH_MAX_BUFFER, grouped: true,
  });
  if (!r.answered) killGroup(r.pid, ctx.platform);
  if (r.ok) return { state: 'ok', reason: null };
  if (r.errorCode === 'ETIMEDOUT') return { state: 'failed', reason: 'timeout' };
  if (r.status === 128 && r.stderr.includes(MISSING_BRANCH_TEXT)) return { state: 'failed', reason: 'no-remote-branch' };
  return { state: 'failed', reason: 'fetch-failed' };
}

// ---------------------------------------------------------------------------
// Git facts
// ---------------------------------------------------------------------------

/** @param {string} text @returns {string} */
function lineOf(text) {
  return text.replace(/\r?\n$/, '');
}

/**
 * @typedef {{ kind: 'sha', sha: string } | { kind: 'absent' } | { kind: 'unknown' }} Tip
 */

/**
 * `rev-parse --verify --quiet <ref>^{commit}`: the commit a full ref names (exit 0), an
 * absent ref (exit 1), or unknown for anything else. Full refs only, so a tag or a
 * pseudo-ref of the same name is never read.
 *
 * @param {Context} ctx
 * @param {string} fullRef
 * @returns {Tip}
 */
function tipOf(ctx, fullRef) {
  const r = git(ctx, ['rev-parse', '--verify', '--quiet', fullRef + '^{commit}']);
  if (!r.answered) return { kind: 'unknown' };
  if (r.status === 1) return { kind: 'absent' };
  const sha = r.status === 0 ? lineOf(r.stdout) : '';
  return HEX_RE.test(sha) ? { kind: 'sha', sha } : { kind: 'unknown' };
}

/**
 * The merge base of a commit and HEAD. It must exit 0 with 40 or 64 hex on stdout;
 * any other answer, such as unrelated or truncated history, is no merge base. A call that
 * gives no answer is unknown.
 *
 * @param {Context} ctx
 * @param {string} sha
 * @returns {{ kind: 'ok', base: string | null } | { kind: 'unknown' }}
 */
function mergeBaseOf(ctx, sha) {
  const r = git(ctx, ['merge-base', sha, 'HEAD']);
  if (!r.answered) return { kind: 'unknown' };
  const out = r.status === 0 ? lineOf(r.stdout) : '';
  return { kind: 'ok', base: HEX_RE.test(out) ? out : null };
}

/**
 * Tri-state ancestry: true (exit 0), false (exit 1), null for any other exit. A call that
 * gives no answer is unknown.
 *
 * @param {Context} ctx
 * @param {string} older
 * @param {string} newer
 * @returns {{ kind: 'ok', ancestor: boolean | null } | { kind: 'unknown' }}
 */
function isAncestor(ctx, older, newer) {
  const r = git(ctx, ['merge-base', '--is-ancestor', older, newer]);
  if (!r.answered) return { kind: 'unknown' };
  if (r.status === 0) return { kind: 'ok', ancestor: true };
  if (r.status === 1) return { kind: 'ok', ancestor: false };
  return { kind: 'ok', ancestor: null };
}

/**
 * `rev-parse --verify --quiet <sha>^{commit}` names the same commit back.
 *
 * @param {Context} ctx
 * @param {string} sha
 * @returns {boolean}
 */
function commitResolves(ctx, sha) {
  const r = git(ctx, ['rev-parse', '--verify', '--quiet', sha + '^{commit}']);
  return r.ok && lineOf(r.stdout) === sha;
}

/**
 * The two name checks: the strict class, then `git check-ref-format`. A name that fails the
 * class makes no git call.
 *
 * @param {Context} ctx
 * @param {string} name
 * @returns {string | null}  the stop reason, or null when the name passes both
 */
function checkName(ctx, name) {
  if (!isStrictName(name)) return 'invalid-name';
  const format = git(ctx, ['check-ref-format', 'refs/heads/' + name]);
  if (!format.answered) return 'resolver-unavailable';
  if (format.status === 1) return 'invalid-name';
  return format.status === 0 ? null : 'resolver-unavailable';
}

/**
 * Whether the fetch is skipped: no origin URL (a missing key or an empty value), or a
 * cross-repository PR. An unanswered call, or an exit other than 0 or 1, is unknown.
 *
 * @param {Context} ctx
 * @param {boolean} cross
 * @returns {{ kind: 'ok', skip: null | 'no-origin' | 'fork-origin' } | { kind: 'unknown' }}
 */
function originSkip(ctx, cross) {
  const origin = git(ctx, ['config', '--get', 'remote.origin.url']);
  if (!origin.answered) return { kind: 'unknown' };
  if (origin.status === 1 || (origin.status === 0 && lineOf(origin.stdout) === '')) return { kind: 'ok', skip: 'no-origin' };
  if (origin.status !== 0) return { kind: 'unknown' };
  return { kind: 'ok', skip: cross ? 'fork-origin' : null };
}

/**
 * The fork point of one tip and HEAD: no side for an absent ref, otherwise the merge base.
 *
 * @param {Context} ctx
 * @param {Tip} tip  a tip that is not unknown
 * @returns {{ kind: 'ok', side: Side | null } | { kind: 'unknown' }}
 */
function sideOf(ctx, tip) {
  if (tip.kind !== 'sha') return { kind: 'ok', side: null };
  const m = mergeBaseOf(ctx, tip.sha);
  return m.kind === 'unknown' ? m : { kind: 'ok', side: { base: m.base } };
}

/**
 * The fork point of each ref and HEAD: the tip of each ref first, then the merge base of
 * each tip. The origin ref is read only when `readRemote`. A side is null when its ref is
 * absent.
 *
 * @param {Context} ctx
 * @param {string} name
 * @param {boolean} readRemote
 * @returns {{ kind: 'ok', local: Side | null, remote: Side | null } | { kind: 'unknown' }}
 */
function sidesOf(ctx, name, readRemote) {
  const localTip = tipOf(ctx, 'refs/heads/' + name);
  if (localTip.kind === 'unknown') return { kind: 'unknown' };
  /** @type {Tip} */
  let remoteTip = { kind: 'absent' };
  if (readRemote) {
    remoteTip = tipOf(ctx, 'refs/remotes/origin/' + name);
    if (remoteTip.kind === 'unknown') return { kind: 'unknown' };
  }
  const local = sideOf(ctx, localTip);
  if (local.kind === 'unknown') return local;
  const remote = sideOf(ctx, remoteTip);
  if (remote.kind === 'unknown') return remote;
  return { kind: 'ok', local: local.side, remote: remote.side };
}

/**
 * Whether the local fork point is an ancestor of origin's. Asked only in the pre-PR rule,
 * and only when both sides have a fork point; null otherwise.
 *
 * @param {Context} ctx
 * @param {'local' | 'pr'} mode
 * @param {Side | null} local
 * @param {Side | null} remote
 * @returns {{ kind: 'ok', behind: boolean | null } | { kind: 'unknown' }}
 */
function localBehindOf(ctx, mode, local, remote) {
  if (mode !== 'local' || !bothForkPoints(local, remote)) return { kind: 'ok', behind: null };
  // bothForkPoints leaves both fork points present.
  const older = /** @type {string} */ (/** @type {Side} */ (local).base);
  const newer = /** @type {string} */ (/** @type {Side} */ (remote).base);
  if (older === newer) return { kind: 'ok', behind: true };
  const ancestry = isAncestor(ctx, older, newer);
  return ancestry.kind === 'unknown' ? ancestry : { kind: 'ok', behind: ancestry.ancestor };
}

// ---------------------------------------------------------------------------
// resolveBase
// ---------------------------------------------------------------------------

/**
 * @typedef {{ mode: 'local' | 'pr', name: string, cross: boolean }} Request
 */

/**
 * Run the checks, the fetch, the choice and the verification for one request, in the order
 * the header states. Every path returns a Selection. A local git call that gives no answer is
 * resolver-unavailable at every call site; the fetch has its own outcomes (fetch-failed,
 * timeout, no-remote-branch). An answered call that cannot be used maps by its call site, as
 * the header states. The ancestry check runs only in the pre-PR rule.
 *
 * @param {Request} req
 * @param {Context} ctx
 * @returns {Selection}
 */
function resolveBase(req, ctx) {
  const name = req.name;
  /** @type {'ok' | 'failed' | 'skipped'} */
  let fetchState = 'skipped';
  /** @param {string} reason @returns {Selection} */
  const stop = reason => stopWith(reason, fetchState);

  const refused = checkName(ctx, name);
  if (refused !== null) return stop(refused);

  const origin = originSkip(ctx, req.cross);
  if (origin.kind === 'unknown') return stop('resolver-unavailable');
  const skip = origin.skip;

  /** @type {FetchOutcome} */
  let fetch = { state: 'skipped', reason: null };
  if (skip === null) {
    const sshConfigured = sshCommandConfigured(ctx);
    if (sshConfigured === null) return stop('resolver-unavailable');
    fetch = fetchBase(ctx, name, sshConfigured);
    fetchState = fetch.state;
  }

  const sides = sidesOf(ctx, name, skip === null && !remoteLacksBranch(fetch));
  if (sides.kind === 'unknown') return stop('resolver-unavailable');
  const behind = localBehindOf(ctx, req.mode, sides.local, sides.remote);
  if (behind.kind === 'unknown') return stop('resolver-unavailable');

  const chosen = select({ mode: req.mode, skip, fetch, local: sides.local, remote: sides.remote, localBehind: behind.behind });
  if (chosen.baseRef !== 'none' && !commitResolves(ctx, chosen.baseRef)) return stop('resolver-unavailable');
  return chosen;
}

// ---------------------------------------------------------------------------
// main and the top-level boundary
// ---------------------------------------------------------------------------

/**
 * @typedef {{ spawn?: SpawnFn, env?: NodeJS.ProcessEnv, cwd?: string, fetchTimeoutMs?: number, platform?: string,
 *   now?: () => number, formatLine?: (r: Selection) => string }} MainDeps  injected by tests only
 */

/**
 * @param {readonly string[]} argv  process.argv
 * @param {MainDeps} [deps]
 * @returns {{ code: number, line: string }}
 */
function main(argv, deps) {
  const d = deps || {};
  let line = FALLBACK_LINE;
  try {
    const parsed = parseArgs(Array.isArray(argv) ? argv.slice(2) : []);
    const selection = parsed.kind === 'usage'
      ? stopWith('usage')
      : resolveBase({ mode: parsed.mode, name: parsed.name, cross: parsed.cross }, makeContext(d));
    const compose = typeof d.formatLine === 'function' ? d.formatLine : formatLine;
    const composed = compose(selection);
    if (checkLine(composed)) line = composed;
  } catch (_) {
    line = FALLBACK_LINE;
  }
  return { code: 0, line };
}

/**
 * The ONLY stdout write and exit-code assignment. A write that fails (a closed pipe, an
 * unwritable descriptor, a stdout that cannot be opened) sets exit 3, whether it fails
 * synchronously, through the write callback, or as a stream 'error' event. Nothing is
 * written to stderr on any of these paths.
 *
 * @param {{ code: number, line: string }} outcome
 * @returns {void}
 */
function emit(outcome) {
  process.exitCode = outcome.code;
  const writeFailed = () => { process.exitCode = 3; };
  try {
    process.stdout.on('error', writeFailed);
    process.stdout.write(outcome.line + '\n', err => { if (err) writeFailed(); });
  } catch (_) {
    writeFailed();
  }
}

if (require.main === module) {
  emit(main(process.argv));
}

// ---------------------------------------------------------------------------
// Exports: the tests and the prompt-copy checks are the consumers
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  STRICT_NAME_RE,
  LINE_RE,
  FALLBACK_LINE,
  REASON_NOTES,
  FETCH_TIMEOUT_MS,
  LOCAL_TIMEOUT_MS,
  RUN_BUDGET_MS,
  isStrictName,
  parseArgs,
  select,
  formatLine,
  checkLine,
  fetchArgv,
  main,
});
