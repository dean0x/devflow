#!/usr/bin/env node
// src/assets/scripts/plan-files.cjs
//
// The checks a plan run makes before agents pass report files by path instead of by
// pasted text: claim the run folder, check one report path before an agent writes it, and
// hash a plan file (/implement checks that it did not change). Installed as a top-level
// sibling of resolve-settings.cjs under ~/.devflow/scripts/, and it requires that file,
// lib/project-config.cjs and hooks/lib/tracked-areas.cjs: the git toplevel call and its
// default exec are resolve-settings.cjs's own (gitToplevel, defaultExec), the bounded file
// read is lib/project-config.cjs's (readBoundedRegularFile), and the `.devflow` folder
// spellings and the git environment without redirects are tracked-areas.cjs's
// (DEVFLOW_SPELLINGS, gitEnvWithoutRedirects). The script holds no other judgment
// and writes nothing except the folders `claim` makes. No network.
//
// Usage: node plan-files.cjs claim
//        node plan-files.cjs check <path>
//        node plan-files.cjs hash <file>
//
// stdout on success is exactly one line, ended by "\n":
//   claim  RUN_DIR=<absolute path>   a new stamp folder (YYYY-MM-DD_HHMM) under
//                                    <root>/.devflow/docs/plan; the root is the git toplevel
//                                    of the working directory; no title enters the path
//   check  OK=<path>                 <path> may be written: a new <word>-<n>.md file in a
//                                    stamp folder under the root's own plan folder
//   hash   SHA256=<hex>              the sha256 of a regular file
//
// `claim` takes no argument. It refuses a root whose path holds a character that `check`
// refuses, and refuses when git tracks anything under the plan folder. It walks `.devflow`,
// `docs` and `plan` with lstat: each is absent or a real folder, never a link. It makes each
// missing folder on its own, never recursively, then the stamp folder with a plain mkdir. A
// clash is retried once with seconds in the stamp (YYYY-MM-DD_HHMMSS); a second failure is an
// error.
//
// `check` refuses a path unless: it is absolute with no `.`, `..` or empty part; it holds
// none of ' " $ ` \ * ? [ ] { } and no control character; its name matches <letters>-<1 to 3
// digits>.md; its folder is a stamp; the folder above that is <root>/.devflow/docs/plan and
// <root> is its own git toplevel; `.devflow`, `docs`, `plan` and the stamp folder each stand
// as a real folder, never a link (a `claim` made them); nothing stands at the path (a dangling
// link counts); git tracks nothing under the plan folder.
//
// The tracking question of `claim` and `check` is asked without regard to letter case: a
// tracked `.DEVFLOW/docs/plan`, `.devflow/docſ/plan` or `.devﬂow/docs/plan` entry counts, as
// a case-folding file system opens it as the plan folder.
//
// `hash` refuses a path unless it is absolute with the same character rule, and lstat shows
// a regular file (never a link) of at most MAX_HASH_BYTES. The bytes come from one open of the
// file with no link followed and no wait on a FIFO, checked again by fstat
// (readBoundedRegularFile of lib/project-config.cjs), so the file hashed is the file checked.
//
// Fail closed: on any failure stdout stays empty, stderr holds one reason line and the exit
// code is not 0.
//
// Exit codes:
//   0  done — the line above
//   1  usage error
//   2  input refused — a path, a folder or git's index fails a rule above
//   4  internal error — or git did not answer, or a folder could not be made
//   (the numbers match resolve-root.cjs; 3 and 5 are never emitted)
//
// Design constraints (shared with resolve-root.cjs):
//   - main() returns {code, line} and never calls process.exit or throws; the single
//     `require.main === module` boundary is the only stdout write and the only exitCode
//     assignment
//   - every subprocess is spawned with an argv array (never a shell), stdin ignored and a
//     maxBuffer, with no time limit
//   - a process that runs as the user can change a path between the check and the write;
//     such a process already runs as the user, and the hooks take the same stance
//   - tests inject the clock, the exec and the working directory

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const projectConfig = require('./lib/project-config.cjs');
const settings = require('./resolve-settings.cjs');
const trackedAreas = require('./hooks/lib/tracked-areas.cjs');

const EXIT_CODES = Object.freeze({
  OK: 0,
  USAGE: 1,
  REFUSED: 2,
  INTERNAL_ERROR: 4,
});

const USAGE = 'usage: node plan-files.cjs claim | check <path> | hash <file>';

/** The plan folder, relative to the root. */
const PLAN_PATHSPEC = '.devflow/docs/plan';

/** The folders below the root that lead to the run folders, in walk order. */
const PLAN_PARTS = Object.freeze(PLAN_PATHSPEC.split('/'));

/**
 * The plan folder in every spelling a case-folding file system opens as PLAN_PATHSPEC, each a
 * literal path matched without regard to ASCII letter case: an index entry at the folder, or
 * anywhere below it, matches. git's `icase` folds ASCII letters only, but APFS (the macOS
 * default) also folds U+FB02 to "fl" and U+017F to "s", so `.devﬂow` (DEVFLOW_SPELLINGS of
 * tracked-areas.cjs) and `docſ` open the same folders. The code is written with escapes, so
 * each code point is named.
 */
const DOCS_SPELLINGS = Object.freeze(['docs', 'doc\u{17F}']);
const PLAN_LISTING_PATHSPECS = Object.freeze(
  trackedAreas.DEVFLOW_SPELLINGS.flatMap(dir => DOCS_SPELLINGS.map(docs => ':(icase,literal)' + dir + '/' + docs + '/plan')),
);

/** A character no plan path may hold: shell and glob specials, and any control character (C0 and DEL). */
const PATH_BAD_RE = /['"$`\\*?[\]{}\x00-\x1f\x7f]/;

/** A report file name: lower-case letters, a dash, one to three digits, `.md`. */
const NAME_RE = /^[a-z]+-[0-9]{1,3}\.md$/;

/** A run folder name: a date and a time, with or without seconds. */
const STAMP_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}(?:[0-9]{2})?$/;

/** The grammar of a successful answer: one line, an absolute path or a digest, no control character. */
const OUTPUT_RE = /^(?:(?:RUN_DIR|OK)=\/[^\x00-\x1f\x7f]*|SHA256=[0-9a-f]{64})$/;

const MAX_PATH_CHARS = 4096;
const MAX_SEGMENTS = 64;
const MAX_HASH_BYTES = 16 * 1024 * 1024;
const LISTING_MAX_BUFFER = 4096;

/**
 * @param {unknown} argv  process.argv
 * @returns {{ kind: 'claim' } | { kind: 'check' | 'hash', target: string } | { kind: 'usage' }}
 */
function parseArgs(argv) {
  const rest = Array.isArray(argv) ? argv.slice(2) : [];
  if (rest.some(arg => typeof arg !== 'string')) return { kind: 'usage' };
  if (rest.length === 1 && rest[0] === 'claim') return { kind: 'claim' };
  if (rest.length === 2 && (rest[0] === 'check' || rest[0] === 'hash')) {
    return { kind: rest[0], target: rest[1] };
  }
  return { kind: 'usage' };
}

/**
 * The parts of an absolute path made of plain names, or null: the path must start with `/`,
 * hold no character PATH_BAD_RE names, and have no empty, `.` or `..` part.
 *
 * @param {string} p
 * @returns {string[] | null}
 */
function plainParts(p) {
  if (typeof p !== 'string' || p.length < 2 || p.length > MAX_PATH_CHARS || p[0] !== '/') return null;
  if (PATH_BAD_RE.test(p)) return null;
  const parts = p.slice(1).split('/');
  if (parts.length > MAX_SEGMENTS) return null;
  return parts.some(part => part === '' || part === '.' || part === '..') ? null : parts;
}

/**
 * What stands at `p`, never following a link: nothing, a real folder, or anything else (a
 * link, a file, or a path that lstat cannot answer for).
 *
 * @param {string} p
 * @returns {'absent' | 'folder' | 'other'}
 */
function standingAt(p) {
  try {
    return fs.lstatSync(p).isDirectory() ? 'folder' : 'other';
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'absent' : 'other';
  }
}

/**
 * Whether git tracks anything under the plan folder of `root`, in any spelling a case-folding
 * file system opens (PLAN_LISTING_PATHSPECS). One `git ls-files` over those pathspecs; it
 * reads the index with the repository's fsmonitor command turned off (D-NO-FSMONITOR) and
 * without the variables that redirect git to another repository.
 *   tracked    at least one entry listed, whatever the exit status
 *   untracked  exit 0 with nothing listed
 *   unknown    git did not answer, its listing overflowed, or it exited non-zero with nothing listed
 *
 * @param {(file: string, args: string[], opts: object) => any} exec
 * @param {string} root
 * @returns {'tracked' | 'untracked' | 'unknown'}
 */
function planTracking(exec, root) {
  const res = exec('git', ['--no-literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '-z', '--', ...PLAN_LISTING_PATHSPECS], {
    cwd: root,
    env: Object.assign({}, trackedAreas.gitEnvWithoutRedirects(process.env), { GIT_TERMINAL_PROMPT: '0' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: LISTING_MAX_BUFFER,
    windowsHide: true,
    shell: false,
  });
  if (!res || res.error || typeof res.status !== 'number') return 'unknown';
  if (res.stdout && res.stdout.length > 0) return 'tracked';
  return res.status === 0 ? 'untracked' : 'unknown';
}

/**
 * Print one reason line and return the failure outcome.
 *
 * @param {number} code
 * @param {string} reason
 * @returns {{ code: number, line: string }}
 */
function fail(code, reason) {
  process.stderr.write('plan-files: ' + reason + ' — failing closed\n');
  return { code, line: '' };
}

/**
 * The two stamps of a clock reading, minute first, or null when they are not stamps.
 *
 * @param {Date} date
 * @returns {string[] | null}
 */
function stampsOf(date) {
  const two = n => String(n).padStart(2, '0');
  const minute = String(date.getFullYear()).padStart(4, '0') + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate())
    + '_' + two(date.getHours()) + two(date.getMinutes());
  const stamps = [minute, minute + two(date.getSeconds())];
  return stamps.every(s => STAMP_RE.test(s)) ? stamps : null;
}

/**
 * Make `dir` when nothing stands there, then say whether a real folder stands there. A
 * failed or raced mkdir is judged by what stands there afterwards.
 *
 * @param {string} dir
 * @returns {boolean}
 */
function ensureFolder(dir) {
  if (standingAt(dir) === 'absent') {
    try {
      fs.mkdirSync(dir);
    } catch (_) {
      // what stands at `dir` now decides
    }
  }
  return standingAt(dir) === 'folder';
}

/**
 * @param {(file: string, args: string[], opts: object) => any} exec
 * @param {() => Date} now
 * @param {string} cwd
 * @returns {{ code: number, line: string }}
 */
function claim(exec, now, cwd) {
  const top = settings.gitToplevel(exec, cwd);
  if (top.kind === 'unknown') return fail(EXIT_CODES.INTERNAL_ERROR, 'git did not answer');
  if (top.kind === 'none') return fail(EXIT_CODES.REFUSED, 'not inside a git repository');
  const root = top.root;
  if (plainParts(root) === null) return fail(EXIT_CODES.REFUSED, 'the checkout root path holds a character that plan paths refuse');
  const stamps = stampsOf(now());
  if (stamps === null) return fail(EXIT_CODES.INTERNAL_ERROR, 'the clock gave no usable date');
  const tracking = planTracking(exec, root);
  if (tracking === 'tracked') return fail(EXIT_CODES.REFUSED, 'git tracks files under the plan folder');
  if (tracking === 'unknown') return fail(EXIT_CODES.INTERNAL_ERROR, 'git did not answer for the plan folder');
  let dir = root;
  for (const part of PLAN_PARTS) {
    dir += '/' + part;
    if (!ensureFolder(dir)) {
      return fail(EXIT_CODES.REFUSED, 'a link or a file stands at, or no folder can be made at, ' + JSON.stringify(dir).slice(0, 300));
    }
  }
  for (const stamp of stamps) {
    try {
      fs.mkdirSync(dir + '/' + stamp);
      return { code: EXIT_CODES.OK, line: 'RUN_DIR=' + dir + '/' + stamp };
    } catch (_) {
      // a clash: the next stamp has seconds
    }
  }
  return fail(EXIT_CODES.INTERNAL_ERROR, 'the run folder could not be made');
}

/**
 * @param {(file: string, args: string[], opts: object) => any} exec
 * @param {string} target
 * @returns {{ code: number, line: string }}
 */
function check(exec, target) {
  const parts = plainParts(target);
  if (parts === null) return fail(EXIT_CODES.REFUSED, 'the path is not an absolute path of plain names');
  const last = parts.length - 1;
  if (last < 5) return fail(EXIT_CODES.REFUSED, 'the path is not below a checkout root');
  const stamp = parts[last - 1];
  if (!NAME_RE.test(parts[last])) return fail(EXIT_CODES.REFUSED, 'the file name is not <letters>-<number>.md');
  if (!STAMP_RE.test(stamp)) return fail(EXIT_CODES.REFUSED, 'the folder is not a run stamp');
  if (parts.slice(last - 4, last - 1).join('/') !== PLAN_PATHSPEC) {
    return fail(EXIT_CODES.REFUSED, 'the run folder is not under .devflow/docs/plan');
  }
  const root = '/' + parts.slice(0, last - 4).join('/');
  try {
    if (!fs.statSync(root).isDirectory()) return fail(EXIT_CODES.REFUSED, 'the root is not a folder');
  } catch (_) {
    return fail(EXIT_CODES.REFUSED, 'the root does not exist');
  }
  let dir = root;
  for (const part of [...PLAN_PARTS, stamp]) {
    dir += '/' + part;
    const standing = standingAt(dir);
    if (standing === 'absent') return fail(EXIT_CODES.REFUSED, 'no run folder was claimed: nothing stands at ' + JSON.stringify(dir).slice(0, 300));
    if (standing === 'other') return fail(EXIT_CODES.REFUSED, 'a link or a file stands at ' + JSON.stringify(dir).slice(0, 300));
  }
  if (standingAt(target) !== 'absent') return fail(EXIT_CODES.REFUSED, 'something stands at the path already');
  const top = settings.gitToplevel(exec, root);
  if (top.kind === 'unknown') return fail(EXIT_CODES.INTERNAL_ERROR, 'git did not answer');
  if (top.kind === 'none') return fail(EXIT_CODES.REFUSED, 'the root is not inside a git repository');
  if (top.root !== root) return fail(EXIT_CODES.REFUSED, 'the root is not its own git toplevel');
  const tracking = planTracking(exec, root);
  if (tracking === 'tracked') return fail(EXIT_CODES.REFUSED, 'git tracks files under the plan folder');
  if (tracking === 'unknown') return fail(EXIT_CODES.INTERNAL_ERROR, 'git did not answer for the plan folder');
  return { code: EXIT_CODES.OK, line: 'OK=' + target };
}

/**
 * @param {string} file
 * @returns {{ code: number, line: string }}
 */
function hash(file) {
  if (plainParts(file) === null) return fail(EXIT_CODES.REFUSED, 'the path is not an absolute path of plain names');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (_) {
    return fail(EXIT_CODES.REFUSED, 'the file cannot be read');
  }
  if (!stat.isFile()) return fail(EXIT_CODES.REFUSED, 'the path is not a regular file');
  if (stat.size > MAX_HASH_BYTES) return fail(EXIT_CODES.REFUSED, 'the file is over ' + MAX_HASH_BYTES + ' bytes');
  // The lstat above only names the reason. The read opens the file once, never through a link
  // and never waiting on a FIFO, and checks the opened file again, so a file changed after the
  // lstat is refused, not hashed.
  const read = projectConfig.readBoundedRegularFile(file, MAX_HASH_BYTES, false);
  if (read.kind !== 'ok') return fail(EXIT_CODES.REFUSED, 'the file cannot be read');
  return { code: EXIT_CODES.OK, line: 'SHA256=' + crypto.createHash('sha256').update(read.bytes).digest('hex') };
}

/**
 * @param {readonly string[]} argv  process.argv
 * @param {{ exec?: (file: string, args: string[], opts: object) => unknown, now?: () => Date, cwd?: string }} [deps]  tests only
 * @returns {{ code: number, line: string }}
 */
function main(argv, deps) {
  try {
    const base = deps && typeof deps.exec === 'function' ? deps.exec : settings.defaultExec;
    // git runs with no devflow time limit, as resolve-root.cjs runs it; the Bash tool's own
    // timeout bounds the call. runGit's limit is removed here.
    const exec = (file, gitArgs, opts) => base(file, gitArgs, { ...opts, timeout: undefined });
    const now = deps && typeof deps.now === 'function' ? deps.now : () => new Date();
    const cwd = deps && typeof deps.cwd === 'string' ? deps.cwd : process.cwd();
    const args = parseArgs(argv);
    switch (args.kind) {
      case 'claim': return claim(exec, now, cwd);
      case 'check': return check(exec, args.target);
      case 'hash': return hash(args.target);
      default: return fail(EXIT_CODES.USAGE, USAGE);
    }
  } catch (_) {
    return fail(EXIT_CODES.INTERNAL_ERROR, 'internal error');
  }
}

/**
 * Settle whatever main() returned into what the boundary may print: a success carries
 * a line that passes the grammar, and every other outcome prints nothing.
 *
 * @param {unknown} outcome
 * @returns {{ code: number, line: string }}
 */
function settleOutcome(outcome) {
  const o = /** @type {any} */ (outcome);
  if (o === null || typeof o !== 'object' || typeof o.line !== 'string' || typeof o.code !== 'number') {
    return { code: EXIT_CODES.INTERNAL_ERROR, line: '' };
  }
  if (o.code === EXIT_CODES.OK) {
    return OUTPUT_RE.test(o.line) ? { code: o.code, line: o.line } : { code: EXIT_CODES.INTERNAL_ERROR, line: '' };
  }
  return { code: o.code === EXIT_CODES.USAGE || o.code === EXIT_CODES.REFUSED ? o.code : EXIT_CODES.INTERNAL_ERROR, line: '' };
}

// ---------------------------------------------------------------------------
// Top-level boundary — the ONLY stdout write and the ONLY exitCode assignment
// ---------------------------------------------------------------------------

if (require.main === module) {
  let outcome;
  try {
    outcome = main(process.argv);
  } catch (_) {
    process.stderr.write('plan-files: internal error — failing closed\n');
    outcome = { code: EXIT_CODES.INTERNAL_ERROR, line: '' };
  }
  const settled = settleOutcome(outcome);
  if (settled.line !== '') process.stdout.write(settled.line + '\n');
  process.exitCode = settled.code;
}

module.exports = Object.freeze({
  EXIT_CODES,
  OUTPUT_RE,
  parseArgs,
  settleOutcome,
  main,
});
