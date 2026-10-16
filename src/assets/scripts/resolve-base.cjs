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
// the origin URL, then the cross-repository flag, then the fetch, then the choice of tip,
// then the merge base, then the verification of BASE_REF. A name that fails either name
// check makes no further git call.
//
// Design constraints (binding):
//   - Plumbing: every decision here is a fixed comparison of git answers. The ancestry
//     checks are deterministic, and the keep-local policy is a rule, not a judgement.
//   - Keep-local policy: in the pre-PR rule a local base that holds commits origin lacks
//     (local-ahead or diverged) stays the base. The branch was cut from it, so those
//     commits are the branch's own context. Only a local fork point that is an ancestor
//     of origin's moves the base to origin.
//   - Tri-state ancestry (`merge-base --is-ancestor`): exit 0 is true, exit 1 is false,
//     anything else is unknown. Unknown is never read as false. It gives no-merge-base.
//   - The fetch is one call with a fixed argv: it writes only refs/remotes/origin/<name>,
//     writes no FETCH_HEAD, follows no tags, and carries no --filter or --depth. The
//     repository's hook, fsmonitor and upload-pack settings do not apply to it. Prompts
//     are off. BatchMode and ConnectTimeout are added only when no SSH command is
//     configured (GIT_SSH_COMMAND, GIT_SSH or core.sshCommand); a configured command is
//     never replaced, and host-key checks are never weakened.
//   - The fetch is bounded at FETCH_TIMEOUT_MS. A fetch that does not exit on its own is
//     followed by a kill of its whole process group (POSIX), so no helper survives.
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
 * The strict base-name class, one literal. Prompts that check a name copy its `source`
 * exactly, and a test holds each copy equal to this export. In words: 1 to 200 ASCII
 * letters, digits and `._/+@,#-`; not starting with `-`, `#` or `origin/`; no `..`; not
 * the whole name `@`, `HEAD`, `FETCH_HEAD`, `ORIG_HEAD` or `MERGE_HEAD`.
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
/** Every other git call is local and short. */
const LOCAL_TIMEOUT_MS = 15000;
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
function stopWith(reason, fetch) {
  return { baseRef: 'none', tip: 'none', fetch: fetch === undefined ? 'skipped' : fetch, reason };
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
  const remote = f.fetch.reason === 'no-remote-branch' ? null : f.remote;
  const local = f.local;
  if (local === null && remote === null) return stopWith('no-ref', fetch);

  /** @type {'origin' | 'local'} */
  let tip;
  if (local === null) tip = 'origin';
  else if (remote === null) tip = 'local';
  else if (f.mode === 'pr') tip = 'origin';
  else {
    if (local.base === null || remote.base === null || f.localBehind === null) return stopWith('no-merge-base', fetch);
    tip = f.localBehind ? 'origin' : 'local';
  }

  const side = tip === 'origin' ? remote : local;
  const base = side === null ? null : side.base;
  if (base === null) return stopWith('no-merge-base', fetch);
  return { baseRef: base, tip, fetch, reason: successReason(f, tip) };
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
 * @typedef {{ spawn: SpawnFn, env: NodeJS.ProcessEnv, parentEnv: NodeJS.ProcessEnv, cwd: string, timeoutMs: number, platform: string }} Context
 * @typedef {{ ok: boolean, answered: boolean, status: number | null, errorCode: string | null, stdout: string, stderr: string, pid: number }} CallResult
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
 * The environment every git call gets: the caller's, with prompts off and the message
 * language fixed.
 *
 * @param {NodeJS.ProcessEnv} base
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(base) {
  return Object.assign({}, base, {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    SSH_ASKPASS_REQUIRE: 'never',
    LC_ALL: 'C',
  });
}

/**
 * @param {{ spawn?: unknown, env?: unknown, cwd?: unknown, timeoutMs?: unknown, platform?: unknown }} [deps]
 * @returns {Context}
 */
function makeContext(deps) {
  const d = deps || {};
  const parentEnv = d.env !== null && typeof d.env === 'object' ? /** @type {NodeJS.ProcessEnv} */ (d.env) : process.env;
  const injected = typeof d.timeoutMs === 'number' && Number.isInteger(d.timeoutMs) && d.timeoutMs > 0 ? d.timeoutMs : FETCH_TIMEOUT_MS;
  return {
    spawn: typeof d.spawn === 'function' ? /** @type {SpawnFn} */ (d.spawn) : defaultSpawn,
    env: childEnv(parentEnv),
    parentEnv,
    cwd: typeof d.cwd === 'string' && d.cwd !== '' ? d.cwd : process.cwd(),
    timeoutMs: Math.min(injected, FETCH_TIMEOUT_MS),
    platform: typeof d.platform === 'string' ? d.platform : process.platform,
  };
}

/**
 * One bounded subprocess call, normalized. `answered` is true when the process ran to
 * an exit of its own: a call that never started, timed out or overflowed did not answer.
 * The argv array is a fresh copy, so a spawn cannot mutate a caller's constant.
 *
 * @param {Context} ctx
 * @param {string} file
 * @param {readonly string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @param {number} timeout
 * @param {number} maxBuffer
 * @param {boolean} grouped  run as the leader of its own process group, killed with SIGKILL on a timeout
 * @returns {CallResult}
 */
function runCall(ctx, file, args, env, timeout, maxBuffer, grouped) {
  const res = ctx.spawn(file, [...args], Object.assign({
    cwd: ctx.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer,
    windowsHide: true,
    shell: false,
  }, grouped ? { detached: ctx.platform !== 'win32', killSignal: 'SIGKILL' } : {}));
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
  return runCall(ctx, 'git', ['-c', 'core.fsmonitor=false', ...args], ctx.env, LOCAL_TIMEOUT_MS, LINE_MAX_BUFFER, false);
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
 * off, and `--upload-pack` replaces the repository's configured program. Never --filter,
 * never --depth. The name has passed the strict class; this sink holds that precondition.
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
    '--no-show-forced-updates', '--quiet', '--upload-pack=git-upload-pack',
    'origin', '+refs/heads/' + name + ':refs/remotes/origin/' + name,
  ];
}

/**
 * Whether any SSH command is configured: GIT_SSH_COMMAND or GIT_SSH in the caller's
 * environment, or core.sshCommand in the repository's configuration. An answer that cannot
 * be read counts as configured, so a command is never replaced on a guess. No command
 * string is parsed.
 *
 * @param {Context} ctx
 * @returns {boolean}
 */
function sshCommandConfigured(ctx) {
  if (ctx.parentEnv.GIT_SSH_COMMAND !== undefined || ctx.parentEnv.GIT_SSH !== undefined) return true;
  const r = git(ctx, ['config', '--get', 'core.sshCommand']);
  return !(r.answered && r.status === 1);
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
 * @returns {FetchOutcome}
 */
function fetchBase(ctx, name) {
  const env = Object.assign({}, ctx.env);
  if (!sshCommandConfigured(ctx)) env.GIT_SSH_COMMAND = SSH_DEFAULT_COMMAND;
  const r = runCall(ctx, 'git', fetchArgv(name, ctx.platform), env, ctx.timeoutMs, FETCH_MAX_BUFFER, true);
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
 * any other answer, such as unrelated or truncated history, is no merge base.
 *
 * @param {Context} ctx
 * @param {string} sha
 * @returns {{ kind: 'ok', base: string | null } | { kind: 'unknown' }}
 */
function mergeBaseOf(ctx, sha) {
  const r = git(ctx, ['merge-base', sha, 'HEAD']);
  if (!r.answered) return r.errorCode === null ? { kind: 'ok', base: null } : { kind: 'unknown' };
  const out = r.status === 0 ? lineOf(r.stdout) : '';
  return { kind: 'ok', base: HEX_RE.test(out) ? out : null };
}

/**
 * Tri-state ancestry: true (exit 0), false (exit 1), null for anything else.
 *
 * @param {Context} ctx
 * @param {string} older
 * @param {string} newer
 * @returns {boolean | null}
 */
function isAncestor(ctx, older, newer) {
  const r = git(ctx, ['merge-base', '--is-ancestor', older, newer]);
  if (!r.answered) return null;
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
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

// ---------------------------------------------------------------------------
// resolveBase
// ---------------------------------------------------------------------------

/**
 * @typedef {{ mode: 'local' | 'pr', name: string, cross: boolean }} Request
 */

/**
 * Run the checks, the fetch, the choice and the verification for one request. Every path
 * returns a Selection; a git that cannot answer is resolver-unavailable.
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

  if (!isStrictName(name)) return stop('invalid-name');

  const format = git(ctx, ['check-ref-format', 'refs/heads/' + name]);
  if (!format.answered) return stop('resolver-unavailable');
  if (format.status === 1) return stop('invalid-name');
  if (format.status !== 0) return stop('resolver-unavailable');

  const origin = git(ctx, ['config', '--get', 'remote.origin.url']);
  if (!origin.answered) return stop('resolver-unavailable');
  /** @type {null | 'no-origin' | 'fork-origin'} */
  let skip = null;
  if (origin.status === 1 || (origin.status === 0 && lineOf(origin.stdout) === '')) skip = 'no-origin';
  else if (origin.status !== 0) return stop('resolver-unavailable');
  else if (req.cross) skip = 'fork-origin';

  /** @type {FetchOutcome} */
  let fetch = { state: 'skipped', reason: null };
  if (skip === null) {
    fetch = fetchBase(ctx, name);
    fetchState = fetch.state;
  }

  const localTip = tipOf(ctx, 'refs/heads/' + name);
  if (localTip.kind === 'unknown') return stop('resolver-unavailable');
  /** @type {Tip} */
  let remoteTip = { kind: 'absent' };
  if (skip === null && fetch.reason !== 'no-remote-branch') {
    remoteTip = tipOf(ctx, 'refs/remotes/origin/' + name);
    if (remoteTip.kind === 'unknown') return stop('resolver-unavailable');
  }

  /** @type {Side | null} */
  let local = null;
  /** @type {Side | null} */
  let remote = null;
  if (localTip.kind === 'sha') {
    const m = mergeBaseOf(ctx, localTip.sha);
    if (m.kind === 'unknown') return stop('resolver-unavailable');
    local = { base: m.base };
  }
  if (remoteTip.kind === 'sha') {
    const m = mergeBaseOf(ctx, remoteTip.sha);
    if (m.kind === 'unknown') return stop('resolver-unavailable');
    remote = { base: m.base };
  }

  /** @type {boolean | null} */
  let localBehind = null;
  if (req.mode === 'local' && local !== null && remote !== null && local.base !== null && remote.base !== null) {
    localBehind = local.base === remote.base ? true : isAncestor(ctx, local.base, remote.base);
  }

  const chosen = select({ mode: req.mode, skip, fetch, local, remote, localBehind });
  if (chosen.baseRef !== 'none' && !commitResolves(ctx, chosen.baseRef)) return stop('resolver-unavailable');
  return chosen;
}

// ---------------------------------------------------------------------------
// main and the top-level boundary
// ---------------------------------------------------------------------------

/**
 * @typedef {{ spawn?: SpawnFn, env?: NodeJS.ProcessEnv, cwd?: string, timeoutMs?: number, platform?: string,
 *   formatLine?: (r: Selection) => string }} MainDeps  injected by tests only
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
  isStrictName,
  parseArgs,
  select,
  formatLine,
  checkLine,
  fetchArgv,
  childEnv,
  resolveBase,
  main,
});
