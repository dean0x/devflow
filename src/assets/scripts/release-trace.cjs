#!/usr/bin/env node
// src/assets/scripts/release-trace.cjs
//
// Release traceability plumbing for `gather-release-evidence` (SDLC-evidence PR5,
// #364). It makes git calls only, so it runs offline, and it turns a commit range
// into closed-vocabulary counts: no commit message, author e-mail or path ever
// reaches stdout or stderr. Installed as a top-level sibling of hud.sh and
// redact-secrets.cjs under ~/.devflow/scripts/.
//
// Usage:
//   node release-trace.cjs last-tag
//   node release-trace.cjs map --from <ref> --grammar github|jira|linear
//        [--key <KEY>] [--traced-file <file>]
//
// Both run git in the process's working directory (the repository to trace).
//
// stdout (D-TRACE-STDOUT) is empty on every non-zero exit, otherwise:
//   last-tag  exactly `LAST_TAG <tag>` or `LAST_TAG none`
//   map       line 1: TRACE from:<ref> scanned:<n> traced:<n> untraced:<n>
//                     exempt:<n> unmatched:<n> bound:<ok|hit>   (one line; wrapped here)
//             then, per listed class in the order untraced, exempt:release,
//             exempt:revert, exempt:bot — newest first, at most 100 lines each:
//               - <sha12> <class> author:<name>
//             and, after a class with more than 100 members, `- …and <n> more`.
// <name> is the commit's author name when it passes AUTHOR_RE, else
// `(unprintable)`. Traced commits are counted, never listed. The boundary
// re-checks every stdout line against these shapes before writing it.
//
// Exit codes (a caller treats EVERY non-zero code as "no trace"):
//   0  ok — the stdout above
//   1  usage error — stdout entirely empty, usage on stderr
//   2  input unusable — --from is not a release tag or a commit SHA (or names
//      no commit), --key fails its grammar, or the --traced-file is not a
//      regular file of 40-hex lines
//   3  write failed — stdout could not be written; discard whatever arrived
//   4  git failure — git missing, timed out, killed, not a repository, no HEAD,
//      or it answered in a shape this script does not recognise; also any
//      internal error
//   5  output gate refused — the composed output failed its grammar, or its
//      counts do not sum (traced + untraced + exempt ≠ scanned)
//
// Design constraints (binding):
//   - main() returns {code, stdout} and never calls process.exit; the single
//     `require.main === module` boundary is the only stdout write and the only
//     exitCode assignment
//   - every subprocess is git, spawned through git() with an argv array (never a
//     shell), stdin ignored, a timeout and a maxBuffer; every loop is bounded by
//     a constant or by the length of a bounded buffer
//   - a revision reaches git only as a SHA git itself printed, or as a --from
//     that passed its gate (so it never starts with `-`)
//   - stderr carries fixed REASONS only (D-TRACE-STDERR): an input is never echoed

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// Closed vocabularies and bounds
// ---------------------------------------------------------------------------

/** Exit codes by meaning (see the header). */
const EXIT_CODES = Object.freeze({
  OK: 0,
  USAGE: 1,
  INPUT_UNUSABLE: 2,
  WRITE_FAILED: 3,
  GIT_FAILURE: 4,
  OUTPUT_GATE_REFUSED: 5,
});

/**
 * D-TRACE-BOUNDS:
 *   SCAN_BOUND        first-parent commits classified; the walk asks git for one
 *                     more, and seeing it is `bound:hit`
 *   LIST_CAP          listed lines per class; the rest is `- …and <n> more`
 *   MAX_TRACED_BYTES  the --traced-file size (1,598 SHA lines fit)
 *   AUTHOR_MAX        code points of an author name printed as-is
 */
const LIMITS = Object.freeze({
  SCAN_BOUND: 500,
  LIST_CAP: 100,
  MAX_TRACED_BYTES: 65536,
  AUTHOR_MAX: 64,
});

const GIT_SHORT_TIMEOUT_MS = 10000;
const GIT_WALK_TIMEOUT_MS = 30000;
/** rev-parse prints one SHA. */
const LINE_MAX_BUFFER = 4096;
/** Tag names are ≤ 4 KiB each; an overflow is ENOBUFS ⇒ exit 4, never a partial list. */
const TAGS_MAX_BUFFER = 4 * 1024 * 1024;
/** 501 SHA lines. */
const REV_LIST_MAX_BUFFER = 65536;
/** 500 messages or path lists; an overflow is ENOBUFS ⇒ exit 4 (coverage unknown). */
const LOG_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * D-TRACE-LAST-TAG: a release tag. The same fixed `^v?X.Y.Z$` shape create-release
 * validates (D8), so a prerelease (`v1.1.0-rc.1`) or a marker tag
 * (`sdlc-baseline-2026-09-24`) never matches.
 */
const RELEASE_TAG_RE = /^v?[0-9]+\.[0-9]+\.[0-9]+$/;

/** A --from that is not a tag: an abbreviated or full commit SHA. */
const HEX_REF_RE = /^[0-9a-f]{7,40}$/;

/** A full SHA as git prints it (SHA-1 repositories). */
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/** A --key, after ASCII-upper normalisation. */
const KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/;

/**
 * Step 3a's closing-keyword regex, byte-for-byte the literal the built
 * `gather-release-evidence` references state, applied case-insensitively WITHOUT
 * the `u` flag — so a non-ASCII letter (`ſ`, the Kelvin sign) never folds onto an
 * ASCII keyword letter. A parity test pins `.source` and `.flags` to the built text.
 */
const KEYWORD_RE = /^\(?(close[sd]?|fix(e[sd])?|resolve[sd]?|refs):?$/i;

/** Step 3a's trailing-strip class, byte-for-byte the built literal (parity-pinned). */
const TRAILING_CLASS = '[.,;:)\\]!?]';

/**
 * One character of TRAILING_CLASS. The strip walks back from the end one
 * character at a time, so a hostile token (a long run of `.` ending in a letter)
 * costs linear time — a `+$` regex over it backtracks quadratically.
 */
const TRAILING_CHAR_RE = new RegExp('^' + TRAILING_CLASS + '$');

/**
 * The anchored history grammars the gather references state, per provider
 * (parity-pinned to the built text).
 */
const GRAMMARS = Object.freeze({
  github: /^#[1-9][0-9]{0,8}$/,
  jira: /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$/,
  linear: /^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$/,
});

/**
 * D-TRACE-NORMALISE: what each grammar's gate adds beyond the regex, as the
 * gather references state it. `keyed` — the KEY segment must equal --key.
 * `upcase` — ASCII-upper-normalise the candidate first (linear's pre-flight does;
 * jira's does not, so a lowercase jira reference stays untraced). The
 * normalisation maps [a-z] only: String#toUpperCase would turn `ſ` into `S` and
 * `ı` into `I`, admitting a reference nobody wrote in ASCII.
 */
const GRAMMAR_RULES = Object.freeze({
  github: Object.freeze({ keyed: false, upcase: false }),
  jira: Object.freeze({ keyed: true, upcase: false }),
  linear: Object.freeze({ keyed: true, upcase: true }),
});

/** Every --grammar value. */
const GRAMMAR_NAMES = Object.freeze(/** @type {Grammar[]} */ (['github', 'jira', 'linear']));

/**
 * D-TRACE-EXEMPT: the three exempt classes, each a rule over fields the commit
 * itself asserts — which is why every exempt commit is LISTED, never hidden.
 *   release  the `/release` commit's strict subject, or a commit whose changed
 *            paths are ALL named CHANGELOG.md — and there is at least one: an
 *            empty commit is never "CHANGELOG-only" (D-TRACE-EXEMPT-EMPTY)
 *   revert   a `Revert "…"` subject AND a message naming what it reverts, in
 *            git's own words or GitHub's revert-PR body
 *   bot      a `[bot]` author name AND a GitHub noreply bot address (D3)
 */
const EXEMPT = Object.freeze({
  release: Object.freeze({
    subject: /^chore\(release\): v?[0-9]+\.[0-9]+\.[0-9]+$/,
    basename: 'CHANGELOG.md',
  }),
  revert: Object.freeze({
    subject: /^Revert ".+"( \(#[1-9][0-9]*\))?$/,
    body: Object.freeze([
      /This reverts commit [0-9a-f]{40}/,
      /Reverts [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*/,
    ]),
  }),
  bot: Object.freeze({
    nameSuffix: '[bot]',
    email: /^([0-9]+\+)?[A-Za-z0-9-]+\[bot\]@users\.noreply\.github\.com$/,
  }),
});

/** Every class, in classification order (first match wins). */
const CLASSES = Object.freeze(/** @type {TraceClass[]} */ ([
  'traced', 'exempt:release', 'exempt:revert', 'exempt:bot', 'untraced',
]));

/** The classes stdout lists, in print order. */
const LISTED_CLASSES = Object.freeze(/** @type {TraceClass[]} */ ([
  'untraced', 'exempt:release', 'exempt:revert', 'exempt:bot',
]));

/** An author name printed as-is: letters, marks, digits, space and `._[]-`. */
const AUTHOR_RE = /^[\p{L}\p{M}\p{N} ._\[\]-]{1,64}$/u;

const UNPRINTABLE = '(unprintable)';

/** D-TRACE-STDOUT: the `map` header — anchored, closed alternations, named groups. */
const TRACE_HEADER_RE = /^TRACE from:(?<from>v?[0-9]+\.[0-9]+\.[0-9]+|[0-9a-f]{7,40}) scanned:(?<scanned>0|[1-9][0-9]{0,4}) traced:(?<traced>0|[1-9][0-9]{0,4}) untraced:(?<untraced>0|[1-9][0-9]{0,4}) exempt:(?<exempt>0|[1-9][0-9]{0,4}) unmatched:(?<unmatched>0|[1-9][0-9]{0,4}) bound:(?<bound>ok|hit)$/;

/** D-TRACE-STDOUT: one listed commit. */
const TRACE_ENTRY_RE = /^- (?<sha>[0-9a-f]{12}) (?<cls>untraced|exempt:release|exempt:revert|exempt:bot) author:(?<author>[\p{L}\p{M}\p{N} ._\[\]-]{1,64}|\(unprintable\))$/u;

/** D-TRACE-STDOUT: the overflow line closing a class past LIST_CAP. */
const TRACE_MORE_RE = /^- …and (?<n>[1-9][0-9]{0,4}) more$/;

/** D-TRACE-STDOUT: the `last-tag` line. */
const LAST_TAG_LINE_RE = /^LAST_TAG (?:none|v?[0-9]+\.[0-9]+\.[0-9]+)$/;

/**
 * D-TRACE-STDERR: every diagnostic this script prints. Fixed strings — a ref, a
 * key, a path or a git answer is never interpolated, so nothing hostile reaches
 * the calling agent's context through stderr either.
 */
const REASONS = Object.freeze({
  BAD_REF: '--from is not a release tag (v?X.Y.Z) or a 7-40 character lowercase commit SHA',
  UNKNOWN_REF: '--from names no commit in this repository',
  BAD_KEY: '--key does not match ^[A-Z][A-Z0-9_]{1,9}$ after ASCII-upper normalisation',
  BAD_TRACED_FILE: '--traced-file is not a regular file of lowercase 40-hex lines',
  NO_HEAD: 'git could not resolve HEAD (not a repository, no commit yet, or git unavailable)',
  GIT_FAILED: 'a git call failed, timed out, or answered in an unrecognised shape',
  GATE_REFUSED: 'the output gate refused the composed output',
  INTERNAL: 'internal error',
});

const USAGE = [
  'Usage: node release-trace.cjs last-tag',
  '       node release-trace.cjs map --from <ref> --grammar github|jira|linear [--key <KEY>] [--traced-file <file>]',
].join('\n');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {'github' | 'jira' | 'linear'} Grammar
 * @typedef {'traced' | 'exempt:release' | 'exempt:revert' | 'exempt:bot' | 'untraced'} TraceClass
 *
 * @typedef {{ sha: string, name: string, email: string, subject: string, message: string, paths: readonly string[] }} Commit
 *   One first-parent commit: author name/e-mail, subject (`%s`, which git folds
 *   onto one line — read by the exempt rules only), the whole message (`%B`, the
 *   lines step 3a reads — D-TRACE-FULL-MESSAGE), and the paths it changes against
 *   its first parent.
 *
 * @typedef {{ grammar: Grammar, key: string | null, traced: ReadonlySet<string> }} ClassifyContext
 *
 * @typedef {{ sha: string, cls: TraceClass, author: string }} TraceRecord
 *
 * @typedef {{ from: string, bound: 'ok' | 'hit', unmatched: number, records: readonly TraceRecord[] }} TraceSummary
 *   `records` newest first; `records.length` is `scanned`.
 *
 * @typedef {{ from: string, scanned: number, bound: 'ok' | 'hit', unmatched: number }} ExpectedHeader
 *
 * @typedef {{ status: number | null, stdout?: Buffer | string, stderr?: Buffer | string, error?: { code?: string } }} ExecResult
 * @typedef {(file: string, args: string[], opts: object) => ExecResult} ExecFn
 *
 * @typedef {{ exec: ExecFn, env: NodeJS.ProcessEnv, cwd: string, stderr: (text: string) => void }} Io
 *
 * @typedef {{ kind: 'usage' }
 *   | { kind: 'last-tag' }
 *   | { kind: 'map', from: string, grammar: Grammar, key: string | null, tracedFile: string | null }} ParsedArgs
 *
 * @typedef {{ exec?: ExecFn, cwd?: string, stderr?: (text: string) => void, render?: (s: TraceSummary) => unknown }} MainDeps
 *   `render` is injected by tests only, to reach the output gate.
 *
 * @typedef {{ code: number, stdout: string }} Outcome
 */

// ---------------------------------------------------------------------------
// Pure core — tags
// ---------------------------------------------------------------------------

/**
 * A numeric string without its leading zeros (`''` ⇒ `'0'`), compared exactly at
 * any length — Number() loses precision past 2^53.
 *
 * @param {string} digits
 * @returns {string}
 */
function stripZeros(digits) {
  const s = digits.replace(/^0+/, '');
  return s === '' ? '0' : s;
}

/**
 * @param {string} a  digits without leading zeros
 * @param {string} b
 * @returns {number}
 */
function compareDigits(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * D-TRACE-LAST-TAG: the highest release tag among `names`, or null. Versions
 * compare numerically, component by component. git's `--sort=-v:refname` is not
 * used: it ranks `v1.0.0` above `1.2.0` (a letter sorts after a digit), which
 * would pick the wrong tag in a repository that mixes the two spellings. Equal
 * versions (`v1.2.0` and `1.2.0`, `1.02.0`) tie-break on the larger string, so
 * the answer never depends on input order.
 *
 * @param {readonly string[]} names
 * @returns {string | null}
 */
function selectLastTag(names) {
  /** @type {string | null} */
  let best = null;
  /** @type {string[]} */
  let bestParts = [];
  for (const name of names) {
    if (typeof name !== 'string' || !RELEASE_TAG_RE.test(name)) continue;
    const parts = name.replace(/^v/, '').split('.').map(stripZeros);
    let cmp = 0;
    if (best === null) {
      cmp = 1;
    } else {
      for (let i = 0; i < 3 && cmp === 0; i++) cmp = compareDigits(parts[i], bestParts[i]);
      if (cmp === 0) cmp = name > best ? 1 : -1;
    }
    if (cmp > 0) {
      best = name;
      bestParts = parts;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pure core — classification
// ---------------------------------------------------------------------------

/**
 * D-TRACE-NORMALISE: [a-z] ⇒ [A-Z], nothing else.
 *
 * @param {string} s
 * @returns {string}
 */
function asciiUpper(s) {
  return s.replace(/[a-z]/g, c => String.fromCharCode(c.charCodeAt(0) - 32));
}

/**
 * Strip one leading `(` and every trailing TRAILING_CLASS character, in linear time.
 *
 * @param {string} part
 * @returns {string}
 */
function stripCandidate(part) {
  const start = part.startsWith('(') ? 1 : 0;
  let end = part.length;
  while (end > start && TRAILING_CHAR_RE.test(part[end - 1])) end--;
  return part.slice(start, end);
}

/**
 * Whether one step-3a candidate survives the grammar's gate.
 *
 * @param {string} candidate
 * @param {Grammar} grammar
 * @param {string | null} key
 * @returns {string | null}  the reference as gated, or null
 */
function gateCandidate(candidate, grammar, key) {
  const rules = GRAMMAR_RULES[grammar];
  const value = rules.upcase ? asciiUpper(candidate) : candidate;
  if (!GRAMMARS[grammar].test(value)) return null;
  if (rules.keyed && value.slice(0, value.indexOf('-')) !== key) return null;
  return value;
}

/**
 * Step 3a, executed, then the grammar's gate: the first reference `message`
 * yields, or null. Per line, a whitespace token matching KEYWORD_RE opens a run:
 * the next token, plus each further token while the previous one ends in `,`.
 * Each run token splits on `,`, is stripped, and non-empty parts are gated.
 *
 * Linear in the message: a keyword token never ends in `,` (KEYWORD_RE is
 * anchored), so every comma run is walked by at most the one keyword before it.
 *
 * @param {string} message
 * @param {Grammar} grammar
 * @param {string | null} key
 * @returns {string | null}
 */
function findReference(message, grammar, key) {
  for (const line of message.split('\n')) {
    const tokens = line.split(/\s+/).filter(t => t !== '');
    for (let i = 0; i < tokens.length; i++) {
      if (!KEYWORD_RE.test(tokens[i])) continue;
      for (let j = i + 1; j < tokens.length; j++) {
        for (const part of tokens[j].split(',')) {
          const stripped = stripCandidate(part);
          if (stripped === '') continue;
          const ref = gateCandidate(stripped, grammar, key);
          if (ref !== null) return ref;
        }
        if (!tokens[j].endsWith(',')) break;
      }
    }
  }
  return null;
}

/**
 * D-TRACE-EXEMPT-EMPTY: at least one path, and every one named CHANGELOG.md.
 *
 * @param {readonly string[]} paths
 * @returns {boolean}
 */
function isChangelogOnly(paths) {
  return paths.length > 0
    && paths.every(p => p.slice(p.lastIndexOf('/') + 1) === EXEMPT.release.basename);
}

/**
 * D-TRACE-CLASSIFY: one first-parent commit's class. First match wins, in
 * CLASSES order, and the terminal arm is `untraced` — an input no rule
 * recognises surfaces in the confirm rather than passing silently (avoids PF-075).
 *
 * @param {Commit} commit
 * @param {ClassifyContext} ctx
 * @returns {TraceClass}
 */
function classify(commit, ctx) {
  if (ctx.traced.has(commit.sha)) return 'traced';
  if (findReference(commit.message, ctx.grammar, ctx.key) !== null) return 'traced';
  if (EXEMPT.release.subject.test(commit.subject) || isChangelogOnly(commit.paths)) return 'exempt:release';
  if (EXEMPT.revert.subject.test(commit.subject) && EXEMPT.revert.body.some(re => re.test(commit.message))) {
    return 'exempt:revert';
  }
  if (commit.name.endsWith(EXEMPT.bot.nameSuffix) && EXEMPT.bot.email.test(commit.email)) return 'exempt:bot';
  return 'untraced';
}

// ---------------------------------------------------------------------------
// Pure core — rendering and the output gate
// ---------------------------------------------------------------------------

/**
 * An author name as stdout may carry it.
 *
 * @param {string} name
 * @returns {string}
 */
function authorLabel(name) {
  return typeof name === 'string' && AUTHOR_RE.test(name) ? name : UNPRINTABLE;
}

/**
 * D-TRACE-STDOUT: compose the `map` output. Counts come from `records` alone, so
 * they sum by construction; the gate below re-checks that independently.
 *
 * @param {TraceSummary} summary
 * @returns {string}
 */
function render(summary) {
  /** @type {Record<string, number>} */
  const counts = { traced: 0, 'exempt:release': 0, 'exempt:revert': 0, 'exempt:bot': 0, untraced: 0 };
  for (const r of summary.records) counts[r.cls]++;
  const exempt = counts['exempt:release'] + counts['exempt:revert'] + counts['exempt:bot'];
  const lines = ['TRACE from:' + summary.from
    + ' scanned:' + summary.records.length
    + ' traced:' + counts.traced
    + ' untraced:' + counts.untraced
    + ' exempt:' + exempt
    + ' unmatched:' + summary.unmatched
    + ' bound:' + summary.bound];
  for (const cls of LISTED_CLASSES) {
    const members = summary.records.filter(r => r.cls === cls);
    for (const r of members.slice(0, LIMITS.LIST_CAP)) {
      lines.push('- ' + r.sha.slice(0, 12) + ' ' + cls + ' author:' + authorLabel(r.author));
    }
    if (members.length > LIMITS.LIST_CAP) lines.push('- …and ' + (members.length - LIMITS.LIST_CAP) + ' more');
  }
  return lines.join('\n') + '\n';
}

/**
 * D-TRACE-GATE: whether `text` is a well-formed, internally coherent `map`
 * output — and, when `expected` is given, one describing THIS run.
 *   - the header matches TRACE_HEADER_RE, traced + untraced + exempt = scanned,
 *     scanned ≤ SCAN_BOUND, and `bound:hit` only at scanned = SCAN_BOUND
 *   - every further line is an entry or an overflow line, grouped by class in
 *     LISTED_CLASSES order, ≤ LIST_CAP entries per class, an overflow line only
 *     after a full class
 *   - listed + overflow = the header's untraced count, and the three exempt
 *     classes together = its exempt count
 *
 * @param {unknown} text
 * @param {ExpectedHeader} [expected]
 * @returns {boolean}
 */
function checkTraceOutput(text, expected) {
  if (typeof text !== 'string' || !text.endsWith('\n')) return false;
  const lines = text.slice(0, -1).split('\n');
  const header = TRACE_HEADER_RE.exec(lines[0]);
  if (header === null || header.groups === undefined) return false;
  const g = header.groups;
  const n = {
    scanned: Number(g.scanned), traced: Number(g.traced), untraced: Number(g.untraced),
    exempt: Number(g.exempt), unmatched: Number(g.unmatched),
  };
  if (n.traced + n.untraced + n.exempt !== n.scanned) return false;
  if (n.scanned > LIMITS.SCAN_BOUND) return false;
  if (g.bound === 'hit' && n.scanned !== LIMITS.SCAN_BOUND) return false;
  if (expected !== undefined && (g.from !== expected.from || n.scanned !== expected.scanned
      || g.bound !== expected.bound || n.unmatched !== expected.unmatched)) {
    return false;
  }

  /** @type {Record<string, number>} */
  const totals = {};
  let i = 1;
  for (const cls of LISTED_CLASSES) {
    let listed = 0;
    let more = 0;
    for (; i < lines.length; i++) {
      const entry = TRACE_ENTRY_RE.exec(lines[i]);
      if (entry === null || entry.groups === undefined || entry.groups.cls !== cls) break;
      listed++;
    }
    const overflow = i < lines.length ? TRACE_MORE_RE.exec(lines[i]) : null;
    if (overflow !== null && overflow.groups !== undefined) {
      if (listed !== LIMITS.LIST_CAP) return false;
      more = Number(overflow.groups.n);
      i++;
    }
    if (listed > LIMITS.LIST_CAP) return false;
    totals[cls] = listed + more;
  }
  if (i !== lines.length) return false;
  if (totals.untraced !== n.untraced) return false;
  return totals['exempt:release'] + totals['exempt:revert'] + totals['exempt:bot'] === n.exempt;
}

// ---------------------------------------------------------------------------
// Pure core — parsing git's answers
// ---------------------------------------------------------------------------

/**
 * `git for-each-ref --format=%(refname)%00` ⇒ tag names, or null when a record is
 * not a refs/tags/ ref. Records end `\0\n`; a ref name holds neither byte.
 *
 * @param {string} text
 * @returns {string[] | null}
 */
function parseTagRefs(text) {
  if (text === '') return [];
  if (!text.endsWith('\0\n')) return null;
  /** @type {string[]} */
  const names = [];
  for (const record of text.slice(0, -2).split('\0\n')) {
    if (!record.startsWith('refs/tags/') || record.length === 'refs/tags/'.length) return null;
    names.push(record.slice('refs/tags/'.length));
  }
  return names;
}

/**
 * `git rev-list` ⇒ full SHAs, or null when any line is not one.
 *
 * @param {string} text
 * @returns {string[] | null}
 */
function parseShaLines(text) {
  if (text === '') return [];
  if (!text.endsWith('\n')) return null;
  const shas = text.slice(0, -1).split('\n');
  return shas.every(s => FULL_SHA_RE.test(s)) ? shas : null;
}

/**
 * D-TRACE-PARSE (messages): split `--format=%H%x00%an%x00%ae%x00%s%x00%B%x1e`
 * output for exactly the commits `shas` names, in order, or null.
 *
 * Positional and exact: git stops printing a field at a NUL (a crafted object
 * cannot smuggle one into a message or an ident), so the output's only NULs are
 * the four per record the format writes, and the total is checked. The message
 * token of record k ends with `\x1e\n` plus record k+1's SHA — a fixed-length
 * suffix checked against the rev-list answer — so a message holding `\x1e\n` and
 * a SHA cannot move a record boundary.
 *
 * @param {string} text
 * @param {readonly string[]} shas
 * @returns {Array<Omit<Commit, 'paths'>> | null}
 */
function parseMessageLog(text, shas) {
  const tokens = text.split('\0');
  if (shas.length === 0 || tokens.length !== 4 * shas.length + 1) return null;
  if (tokens[0] !== shas[0]) return null;
  const out = [];
  for (let k = 0; k < shas.length; k++) {
    const tail = tokens[4 * k + 4];
    const last = k === shas.length - 1;
    const suffix = last ? '\x1e\n' : '\x1e\n' + shas[k + 1];
    if (!tail.endsWith(suffix)) return null;
    out.push({
      sha: shas[k],
      name: tokens[4 * k + 1],
      email: tokens[4 * k + 2],
      subject: tokens[4 * k + 3],
      message: tail.slice(0, tail.length - suffix.length),
    });
  }
  return out;
}

/**
 * D-TRACE-PARSE (paths): split `-z --name-only --format=%x00%H` output for exactly
 * the commits `shas` names, in order, or null.
 *
 * Layout per commit: `\0<sha>\0`, then — when it changes anything — `\n` and each
 * path NUL-terminated. A path is never empty and never holds a NUL, so an EMPTY
 * token can only be the boundary the format writes: whatever bytes a hostile file
 * name carries (`\x1e`, a newline, a whole SHA), it cannot open a record.
 *
 * @param {string} text
 * @param {readonly string[]} shas
 * @returns {string[][] | null}
 */
function parsePathLog(text, shas) {
  const tokens = text.split('\0');
  if (shas.length === 0 || tokens[0] !== '' || tokens[tokens.length - 1] !== '') return null;
  /** @type {string[][]} */
  const out = [];
  let i = 1;
  for (let k = 0; k < shas.length; k++) {
    if (i > 1) {
      if (tokens[i] !== '') return null;
      i++;
    }
    if (tokens[i] !== shas[k]) return null;
    i++;
    /** @type {string[]} */
    const paths = [];
    for (; i < tokens.length - 1 && tokens[i] !== ''; i++) {
      const p = paths.length === 0 ? tokens[i].slice(1) : tokens[i];
      if ((paths.length === 0 && !tokens[i].startsWith('\n')) || p === '') return null;
      paths.push(p);
    }
    out.push(paths);
  }
  return i === tokens.length - 1 ? out : null;
}

/**
 * The --traced-file's SHAs, or null: lowercase 40-hex lines, `\n`-separated, one
 * optional final newline, nothing else (no blank line, no CR). Empty is none.
 *
 * @param {Buffer} bytes
 * @returns {Set<string> | null}
 */
function parseTracedFile(bytes) {
  const text = bytes.toString('latin1');
  if (text === '') return new Set();
  const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  return lines.every(l => FULL_SHA_RE.test(l)) ? new Set(lines) : null;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/** The map flags, each taking one value. */
const MAP_FLAGS = Object.freeze(['--from', '--grammar', '--key', '--traced-file']);

/**
 * Parse argv. Anything outside the synopsis is a usage error: an unknown or
 * repeated flag, `--flag=value`, a flag with no value, a missing --from or
 * --grammar, a grammar outside GRAMMAR_NAMES, --key missing for a keyed grammar
 * or given for github. The VALUES of --from and --key are gated in main() (exit 2).
 *
 * @param {readonly string[]} argv  process.argv
 * @returns {ParsedArgs}
 */
function parseArgs(argv) {
  const rest = Array.isArray(argv) ? argv.slice(2) : [];
  if (rest.length === 1 && rest[0] === 'last-tag') return { kind: 'last-tag' };
  if (rest[0] !== 'map') return { kind: 'usage' };

  /** @type {Map<string, string>} */
  const flags = new Map();
  for (let i = 1; i < rest.length; i += 2) {
    const name = rest[i];
    const value = rest[i + 1];
    if (!MAP_FLAGS.includes(name) || typeof value !== 'string' || flags.has(name)) return { kind: 'usage' };
    flags.set(name, value);
  }
  const from = flags.get('--from');
  const grammar = /** @type {Grammar | undefined} */ (flags.get('--grammar'));
  if (from === undefined || grammar === undefined || !GRAMMAR_NAMES.includes(grammar)) return { kind: 'usage' };
  const key = flags.get('--key');
  if (GRAMMAR_RULES[grammar].keyed !== (key !== undefined)) return { kind: 'usage' };
  const tracedFile = flags.get('--traced-file');
  return {
    kind: 'map',
    from,
    grammar,
    key: key === undefined ? null : key,
    tracedFile: tracedFile === undefined ? null : tracedFile,
  };
}

// ---------------------------------------------------------------------------
// Imperative shell — git, files
// ---------------------------------------------------------------------------

/** @param {unknown} value @returns {Buffer} */
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.alloc(0);
}

/**
 * @typedef {{ ok: boolean, answered: boolean, stdout: string }} GitResult
 *   `ok` — exit 0 with no spawn error. `answered` — git ran to completion and
 *   exited on its own (an answered non-zero is a real "no": no such ref); a
 *   timeout, ENOBUFS, a kill or a missing git is NOT an answer.
 */

/**
 * THE subprocess call: git, argv array, no shell, stdin ignored, bounded.
 *
 * @param {Io} io
 * @param {readonly string[]} args
 * @param {number} timeout
 * @param {number} maxBuffer
 * @returns {GitResult}
 */
function git(io, args, timeout, maxBuffer) {
  const res = io.exec('git', [...args], {
    cwd: io.cwd,
    env: io.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer,
    windowsHide: true,
    shell: false,
  });
  const errored = Boolean(res && res.error);
  const status = res && typeof res.status === 'number' ? res.status : null;
  return {
    ok: !errored && status === 0,
    answered: !errored && status !== null,
    stdout: asBuffer(res && res.stdout).toString('utf8'),
  };
}

/**
 * A commit revision for git's argv: HEAD, a tag under refs/tags/ (so a branch
 * that shares a release tag's name is never picked), or a gated SHA prefix —
 * each peeled to a commit.
 *
 * @param {{ kind: 'head' } | { kind: 'tag', tag: string } | { kind: 'sha', sha: string }} ref
 * @returns {string}
 */
function commitRev(ref) {
  if (ref.kind === 'head') return 'HEAD^{commit}';
  if (ref.kind === 'tag') return 'refs/tags/' + ref.tag + '^{commit}';
  return ref.sha + '^{commit}';
}

/**
 * A range between two full SHAs git printed.
 *
 * @param {string} base
 * @param {string} head
 * @returns {string}
 */
function rangeRev(base, head) {
  if (!FULL_SHA_RE.test(base) || !FULL_SHA_RE.test(head)) throw new Error('rangeRev: not a full SHA');
  return base + '..' + head;
}

/**
 * Resolve a revision to its full commit SHA.
 *
 * @param {Io} io
 * @param {string} rev  from commitRev()
 * @returns {{ kind: 'sha', sha: string } | { kind: 'unknown' } | { kind: 'failed' }}
 */
function resolveCommit(io, rev) {
  const r = git(io, ['rev-parse', '--verify', '--quiet', rev], GIT_SHORT_TIMEOUT_MS, LINE_MAX_BUFFER);
  if (!r.answered) return { kind: 'failed' };
  if (!r.ok) return { kind: 'unknown' };
  const sha = r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout;
  return FULL_SHA_RE.test(sha) ? { kind: 'sha', sha } : { kind: 'failed' };
}

/**
 * Read a regular file of at most `maxBytes` without following a final symlink,
 * or null. The lstat decides before any open (a FIFO, directory, device or
 * symlink is refused unopened); the open adds O_NONBLOCK and O_NOFOLLOW, and the
 * fstat re-checks what was opened. The read loop is bounded by the byte count.
 *
 * @param {string} filePath
 * @param {number} maxBytes
 * @returns {Buffer | null}
 */
function readBoundedRegularFile(filePath, maxBytes) {
  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (_) {
    return null;
  }
  if (!st.isFile() || st.size > maxBytes) return null;
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0));
  } catch (_) {
    return null;
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile() || fst.size > maxBytes) return null;
    // One byte past the stat'd size: a file that grew after the stat is refused.
    const buf = Buffer.alloc(fst.size + 1);
    let total = 0;
    for (let i = 0; i < buf.length; i++) {
      const n = fs.readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
      if (total === buf.length) break;
    }
    return total > fst.size ? null : buf.subarray(0, total);
  } catch (_) {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch (_) { /* the read already decided */ }
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/**
 * @param {Io} io
 * @param {number} code
 * @param {string} reason  a REASONS value
 * @returns {Outcome}
 */
function refuse(io, code, reason) {
  io.stderr('release-trace: ' + reason + '\n');
  return { code, stdout: '' };
}

/**
 * D-TRACE-LAST-TAG: the highest release tag merged into HEAD.
 *
 * @param {Io} io
 * @returns {Outcome}
 */
function runLastTag(io) {
  const r = git(io, ['for-each-ref', '--merged=HEAD', '--format=%(refname)%00', 'refs/tags/'],
    GIT_SHORT_TIMEOUT_MS * 2, TAGS_MAX_BUFFER);
  if (!r.ok) return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.NO_HEAD);
  const names = parseTagRefs(r.stdout);
  if (names === null) return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.GIT_FAILED);
  const tag = selectLastTag(names);
  return { code: EXIT_CODES.OK, stdout: 'LAST_TAG ' + (tag === null ? 'none' : tag) + '\n' };
}

/**
 * D-TRACE-PATHS: the path-log flags. Each pins a behaviour a repository's own
 * config could otherwise change: no rename pairing (a rename INTO CHANGELOG.md
 * still lists the source path it deleted), no relative-path filter
 * (`diff.relative`), no ignored submodules, no external diff or textconv, the
 * first-parent diff for merges, and a root commit's paths (`log.showRoot`).
 */
const PATH_LOG_FLAGS = Object.freeze([
  '--first-parent', '--no-color', '--no-show-signature', '--no-notes', '--no-renames', '--no-relative',
  '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--diff-merges=first-parent',
  '--name-only', '-z', '--format=%x00%H',
]);

/**
 * D-TRACE-MAILMAP: the message-log flags. A repository's `.mailmap` is committed
 * content, and honouring it would let a later commit re-attribute an earlier one
 * to a `[bot]` identity. The format therefore reads the RAW ident — `%an`/`%ae`,
 * never `%aN`/`%aE`, which apply the mailmap (git 2.50 leaves `%an` raw even under
 * `--use-mailmap`) — and `--no-use-mailmap` also disarms `log.mailmap` for a git
 * that rewrites the ident itself.
 *
 * D-TRACE-FULL-MESSAGE: references are scanned in `%B`, the raw message, never in
 * `%s` + `%b`. git folds a wrapped subject paragraph onto ONE `%s` line, so a
 * keyword ending the subject's first line and a reference opening its second
 * would read as one line here and as two to step 3a, which reads each message as
 * `git log --format=%B` lines — the script would trace a commit whose reference
 * the gather step never collects. `%s` stays for the exempt rules, which match
 * the subject as git renders it. The parity test pins both sides.
 */
const MESSAGE_LOG_FLAGS = Object.freeze([
  '--first-parent', '--no-color', '--no-show-signature', '--no-notes', '--no-use-mailmap', '--encoding=UTF-8',
  '--format=%H%x00%an%x00%ae%x00%s%x00%B%x1e',
]);

/**
 * D-TRACE-SCAN: trace the first-parent commits of `<from>..HEAD` (D4).
 *
 * HEAD and --from are each resolved to a full SHA ONCE, and every later call
 * walks that pinned range, so a commit landing mid-run cannot shift the lists.
 * rev-list names the commits (at most SCAN_BOUND + 1; seeing the extra one is
 * `bound:hit`); the two logs must describe exactly those, in that order.
 *
 * @param {Io} io
 * @param {{ from: string, grammar: Grammar, key: string | null, tracedFile: string | null }} args
 * @param {MainDeps} deps
 * @returns {Outcome}
 */
function runMap(io, args, deps) {
  /** @type {{ kind: 'tag', tag: string } | { kind: 'sha', sha: string } | null} */
  const fromRef = RELEASE_TAG_RE.test(args.from) ? { kind: 'tag', tag: args.from }
    : HEX_REF_RE.test(args.from) ? { kind: 'sha', sha: args.from } : null;
  if (fromRef === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, REASONS.BAD_REF);
  const key = args.key === null ? null : asciiUpper(args.key);
  if (key !== null && !KEY_RE.test(key)) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, REASONS.BAD_KEY);

  /** @type {Set<string>} */
  let traced = new Set();
  if (args.tracedFile !== null) {
    const bytes = readBoundedRegularFile(path.resolve(io.cwd, args.tracedFile), LIMITS.MAX_TRACED_BYTES);
    const parsed = bytes === null ? null : parseTracedFile(bytes);
    if (parsed === null) return refuse(io, EXIT_CODES.INPUT_UNUSABLE, REASONS.BAD_TRACED_FILE);
    traced = parsed;
  }

  const head = resolveCommit(io, commitRev({ kind: 'head' }));
  if (head.kind !== 'sha') return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.NO_HEAD);
  const base = resolveCommit(io, commitRev(fromRef));
  if (base.kind === 'failed') return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.GIT_FAILED);
  // A SHA prefix must resolve to a commit it prefixes — never to a ref that
  // happens to be spelled in hex.
  if (base.kind === 'unknown' || (fromRef.kind === 'sha' && !base.sha.startsWith(fromRef.sha))) {
    return refuse(io, EXIT_CODES.INPUT_UNUSABLE, REASONS.UNKNOWN_REF);
  }
  const range = rangeRev(base.sha, head.sha);

  const walk = git(io, ['rev-list', '--first-parent', '--max-count=' + (LIMITS.SCAN_BOUND + 1), range],
    GIT_WALK_TIMEOUT_MS, REV_LIST_MAX_BUFFER);
  const listed = walk.ok ? parseShaLines(walk.stdout) : null;
  if (listed === null || listed.length > LIMITS.SCAN_BOUND + 1) return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.GIT_FAILED);
  const bound = listed.length > LIMITS.SCAN_BOUND ? 'hit' : 'ok';
  const shas = listed.slice(0, LIMITS.SCAN_BOUND);

  /** @type {TraceRecord[]} */
  const records = [];
  if (shas.length > 0) {
    const count = '--max-count=' + shas.length;
    const messages = git(io, ['log', count, ...MESSAGE_LOG_FLAGS, range], GIT_WALK_TIMEOUT_MS, LOG_MAX_BUFFER);
    const parsedMessages = messages.ok ? parseMessageLog(messages.stdout, shas) : null;
    const pathLog = git(io, ['-c', 'log.showRoot=true', 'log', count, ...PATH_LOG_FLAGS, range],
      GIT_WALK_TIMEOUT_MS, LOG_MAX_BUFFER);
    const parsedPaths = pathLog.ok ? parsePathLog(pathLog.stdout, shas) : null;
    if (parsedMessages === null || parsedPaths === null) return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.GIT_FAILED);
    /** @type {ClassifyContext} */
    const ctx = { grammar: args.grammar, key, traced };
    for (let k = 0; k < shas.length; k++) {
      const commit = { ...parsedMessages[k], paths: parsedPaths[k] };
      records.push({ sha: commit.sha, cls: classify(commit, ctx), author: commit.name });
    }
  }

  const scannedSet = new Set(shas);
  let unmatched = 0;
  for (const sha of traced) if (!scannedSet.has(sha)) unmatched++;

  /** @type {TraceSummary} */
  const summary = { from: args.from, bound, unmatched, records };
  const compose = typeof deps.render === 'function' ? deps.render : render;
  const text = compose(summary);
  if (!checkTraceOutput(text, { from: args.from, scanned: shas.length, bound, unmatched })) {
    return refuse(io, EXIT_CODES.OUTPUT_GATE_REFUSED, REASONS.GATE_REFUSED);
  }
  return { code: EXIT_CODES.OK, stdout: /** @type {string} */ (text) };
}

// ---------------------------------------------------------------------------
// main — returns {code, stdout}; never calls process.exit
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
 * @param {readonly string[]} argv  process.argv
 * @param {MainDeps} [deps]
 * @returns {Outcome}
 */
function main(argv, deps) {
  const d = deps || {};
  /** @type {Io} */
  const io = {
    exec: typeof d.exec === 'function' ? d.exec : defaultExec,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }),
    cwd: typeof d.cwd === 'string' ? d.cwd : process.cwd(),
    stderr: typeof d.stderr === 'function' ? d.stderr : (text => { process.stderr.write(text); }),
  };
  const args = parseArgs(argv);
  if (args.kind === 'usage') {
    io.stderr(USAGE + '\n');
    return { code: EXIT_CODES.USAGE, stdout: '' };
  }
  try {
    return args.kind === 'last-tag' ? runLastTag(io) : runMap(io, args, d);
  } catch (err) {
    // An injected exec that throws, or a broken invariant: no trace.
    return refuse(io, EXIT_CODES.GIT_FAILURE, REASONS.INTERNAL + ' (' + errorLabel(err) + ')');
  }
}

/**
 * D-TRACE-STDOUT: settle whatever main() returned into what the boundary may
 * print. A non-zero code prints nothing; code 0 prints only a LAST_TAG line or a
 * `map` output that passes the gate. Anything else prints nothing and exits 4
 * (malformed outcome) or 5 (a success whose text fails its gate).
 *
 * @param {unknown} outcome
 * @returns {Outcome}
 */
function settleOutcome(outcome) {
  const o = /** @type {any} */ (outcome);
  const failed = { code: EXIT_CODES.GIT_FAILURE, stdout: '' };
  if (o === null || typeof o !== 'object' || typeof o.stdout !== 'string') return failed;
  if (!Object.values(EXIT_CODES).includes(o.code)) return failed;
  if (o.code !== EXIT_CODES.OK) return { code: o.code, stdout: '' };
  const lastTag = o.stdout.endsWith('\n') && LAST_TAG_LINE_RE.test(o.stdout.slice(0, -1));
  if (lastTag || checkTraceOutput(o.stdout)) return { code: o.code, stdout: o.stdout };
  return { code: EXIT_CODES.OUTPUT_GATE_REFUSED, stdout: '' };
}

// ---------------------------------------------------------------------------
// Top-level boundary — the ONLY stdout write and exitCode assignment
//
// A write that fails (a closed pipe, an unwritable descriptor) sets exit 3,
// whether it fails synchronously, through the write callback, or as a stream
// 'error' event — which would otherwise crash the process with exit 1.
// ---------------------------------------------------------------------------

if (require.main === module) {
  let outcome;
  try {
    outcome = main(process.argv);
  } catch (err) {
    process.stderr.write('release-trace: ' + REASONS.INTERNAL + ' (' + errorLabel(err) + ')\n');
    outcome = { code: EXIT_CODES.GIT_FAILURE, stdout: '' };
  }
  const settled = settleOutcome(outcome);
  process.exitCode = settled.code;
  if (settled.stdout !== '') {
    const writeFailed = () => { process.exitCode = EXIT_CODES.WRITE_FAILED; };
    process.stdout.on('error', writeFailed);
    try {
      process.stdout.write(settled.stdout, err => { if (err) writeFailed(); });
    } catch (_) {
      writeFailed();
    }
  }
}

// ---------------------------------------------------------------------------
// Exports — the unit tests and the parity test are the consumers
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  EXIT_CODES,
  LIMITS,
  RELEASE_TAG_RE,
  KEYWORD_RE,
  TRAILING_CLASS,
  GRAMMARS,
  GRAMMAR_RULES,
  EXEMPT,
  CLASSES,
  AUTHOR_RE,
  TRACE_HEADER_RE,
  TRACE_ENTRY_RE,
  TRACE_MORE_RE,
  LAST_TAG_LINE_RE,
  REASONS,
  MESSAGE_LOG_FLAGS,
  selectLastTag,
  findReference,
  classify,
  render,
  checkTraceOutput,
  parseMessageLog,
  parsePathLog,
  parseArgs,
  main,
  settleOutcome,
});
