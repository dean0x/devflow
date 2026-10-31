#!/usr/bin/env node
// src/assets/scripts/resolve-root.cjs
//
// Prints the two roots a prompt works from, so a command runs ONE call for them:
// the checkout (where docs artifacts and feature knowledge live) and the ledger
// (where the curation index lives). Installed as a top-level sibling of
// resolve-settings.cjs under ~/.devflow/scripts/, and it requires that file: the git
// call, its default exec and the ledger rule are resolve-settings.cjs's own
// (gitToplevel, defaultExec, ledgerRootOf). The ledger rule is the one the hooks apply
// (hooks/resolve-project-root, and its TypeScript twin src/core/ledger-root.ts).
// The script holds no other judgment.
//
// Usage: node resolve-root.cjs [<dir>]      (<dir> defaults to cwd)
//
// stdout on success is exactly two lines, each ended by "\n":
//   WORKTREE=<absolute path>
//   LEDGER=<absolute path>
// WORKTREE is git's toplevel for <dir>. LEDGER is the main worktree when <dir> is in
// a linked worktree and the main worktree holds a `.devflow/` folder that is not the
// home directory; otherwise it is the toplevel. When git does not know the ledger
// root, LEDGER is the toplevel. Outside a git repository both lines name the absolute
// form of <dir>.
//
// Fail closed: on any failure stdout stays empty, stderr holds one reason line and the
// exit code is not 0. The caller then uses its start directory for both roots.
//
// Exit codes:
//   0  resolved — the two lines above
//   1  usage error — usage on stderr
//   2  input unusable — <dir> is missing or not a directory, or a path holds a control
//      character (any C0 character, such as CR, LF or NUL)
//   4  internal error — or git did not answer
//   (the numbers match resolve-settings.cjs; 3 and 5 are never emitted)
//
// Design constraints (shared with resolve-settings.cjs):
//   - main() returns {code, line} and never calls process.exit or throws; the single
//     `require.main === module` boundary is the only stdout write and the only
//     exitCode assignment
//   - every subprocess is spawned with an argv array (never a shell), stdin ignored,
//     a timeout and a maxBuffer — resolve-settings.cjs's runGit does this
//   - a local read only: no network, nothing written

'use strict';

const fs = require('fs');
const path = require('path');
const settings = require('./resolve-settings.cjs');

const EXIT_CODES = Object.freeze({
  RESOLVED: 0,
  USAGE: 1,
  INPUT_UNUSABLE: 2,
  INTERNAL_ERROR: 4,
});

const USAGE = 'Usage: node resolve-root.cjs [<dir>]';

/** Any C0 control character: a path that holds one cannot be a one-line answer. */
const CONTROL_RE = /[\x00-\x1f]/;

/** The grammar of a successful answer: two absolute paths, one per line, no control character. */
const OUTPUT_RE = /^WORKTREE=\/[^\x00-\x1f]*\nLEDGER=\/[^\x00-\x1f]*$/;

/**
 * @param {readonly string[]} argv  process.argv
 * @returns {{ kind: 'resolve', dir: string } | { kind: 'usage', usage: string }}
 */
function parseArgs(argv) {
  const rest = Array.isArray(argv) ? argv.slice(2) : [];
  /** @type {string[]} */
  const positionals = [];
  for (const arg of rest) {
    if (typeof arg !== 'string' || arg.startsWith('-')) {
      return {
        kind: 'usage',
        usage: 'resolve-root: unrecognised argument ' + JSON.stringify(String(arg)).slice(0, 80) + '\n' + USAGE,
      };
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) return { kind: 'usage', usage: USAGE };
  return { kind: 'resolve', dir: positionals.length === 1 ? positionals[0] : process.cwd() };
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isUsableDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * Print one reason line and return the failure outcome.
 *
 * @param {number} code
 * @param {string} reason
 * @returns {{ code: number, line: string }}
 */
function fail(code, reason) {
  process.stderr.write('resolve-root: ' + reason + ' — failing closed\n');
  return { code, line: '' };
}

/**
 * @param {readonly string[]} argv  process.argv
 * @param {{ exec?: (file: string, args: string[], opts: object) => unknown }} [deps]  tests only
 * @returns {{ code: number, line: string }}
 */
function main(argv, deps) {
  try {
    const exec = deps && typeof deps.exec === 'function' ? deps.exec : settings.defaultExec;
    const args = parseArgs(argv);
    if (args.kind === 'usage') {
      process.stderr.write(args.usage + '\n');
      return { code: EXIT_CODES.USAGE, line: '' };
    }
    const dir = path.resolve(args.dir);
    if (CONTROL_RE.test(dir)) return fail(EXIT_CODES.INPUT_UNUSABLE, 'the directory path holds a control character');
    if (!isUsableDirectory(dir)) {
      return fail(EXIT_CODES.INPUT_UNUSABLE, 'not a usable directory: ' + JSON.stringify(dir).slice(0, 300));
    }
    const toplevel = settings.gitToplevel(exec, dir);
    if (toplevel.kind === 'unknown') return fail(EXIT_CODES.INTERNAL_ERROR, 'git did not answer');
    let worktree = dir;
    let ledger = dir;
    if (toplevel.kind === 'root') {
      worktree = toplevel.root;
      const found = settings.ledgerRootOf(toplevel.root, { exec });
      ledger = found.kind === 'root' ? found.root : toplevel.root;
    }
    if (CONTROL_RE.test(worktree) || CONTROL_RE.test(ledger)) {
      return fail(EXIT_CODES.INPUT_UNUSABLE, 'a root path holds a control character');
    }
    return { code: EXIT_CODES.RESOLVED, line: 'WORKTREE=' + worktree + '\nLEDGER=' + ledger };
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
  if (o.code === EXIT_CODES.RESOLVED) {
    return OUTPUT_RE.test(o.line) ? { code: o.code, line: o.line } : { code: EXIT_CODES.INTERNAL_ERROR, line: '' };
  }
  return { code: o.code === EXIT_CODES.USAGE || o.code === EXIT_CODES.INPUT_UNUSABLE ? o.code : EXIT_CODES.INTERNAL_ERROR, line: '' };
}

// ---------------------------------------------------------------------------
// Top-level boundary — the ONLY stdout write and the ONLY exitCode assignment
// ---------------------------------------------------------------------------

if (require.main === module) {
  let outcome;
  try {
    outcome = main(process.argv);
  } catch (_) {
    process.stderr.write('resolve-root: internal error — failing closed\n');
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
