#!/usr/bin/env node
// src/assets/scripts/claude-md-audit.cjs
//
// D-CLAUDE-MD-IMPORT-AUDIT: finds the CLAUDE.md `@path` imports that put a large
// file into every thread's always-loaded context, and says so once. Installed as a
// top-level sibling of resolve-settings.cjs under ~/.devflow/scripts/, where the
// SessionStart hook `session-start-context` runs it (Section 6); the CLI reaches
// the same file through the typed facade src/core/claude-md-audit.ts (`devflow
// init`), so the grammar, the bounds, the display text and the stamp format exist
// exactly once, here.
//
// THE AUDIT WRITES NOTHING. `audit()` only stats and reads; the caller (the hook,
// or init) applies every gate and writes the stamp. A test asserts byte and mtime
// equality for every audited file.
//
// Usage (the hook's view):
//   node claude-md-audit.cjs hook <home> <stampFile> <root>...
// stdout, one framed block, or nothing and a non-zero exit on failure:
//   devflow-claude-md-audit 1
//   M <display line>            zero or more; the systemMessage, one line each
//   V 1 / R / P / K / E rows    the new stamp text (D-AUDIT-STAMP), in file order
//   END
// The hook needs ONE node process per changed start and no JSON parse, so the
// block is line-oriented. `audit()` returns the same facts as one JSON-able object.
//
// ── Roots ──────────────────────────────────────────────────────────────────────
// The caller names the roots: `CLAUDE.md` in the Claude config directory, and in a
// git project that is not HOME its `CLAUDE.md`, `.claude/CLAUDE.md` and
// `CLAUDE.local.md` at the toplevel. Not roots (OQ3): ancestor directories, lazily
// loaded subdirectory files, `rules/*.md` and `AGENTS.md`.
//
// ── Import grammar (devflow's specification) ───────────────────────────────────
// An `@` starts an import at the start of a line or after whitespace, so
// `user@example.com` is not one. The path is the run of characters from
// `A-Za-z0-9._/~+-` after it, trailing dots dropped; an empty token is not an
// import. `~/` expands to HOME, an absolute path stays absolute, anything else
// resolves against the importing file's directory. Fenced blocks follow the rules
// of `fenceOpen`/`fenceCloses` in pr-evidence.cjs (up to three spaces of indent; a
// backtick or tilde run of three or more; a backtick fence's info string holds no
// backtick; the closer uses the same character, a run at least as long and nothing
// after it but whitespace; an unclosed fence runs to the end of the scanned text).
// An inline code span is a backtick run closed by the next run of the same length
// on the same line; a run with no closer on its line is literal. Multi-line spans
// are not recognised, and four-space indented code is not exempted (OQ10): a false
// positive costs one line of output.
//
// ── OQ9: agreement with Claude Code's own rules ────────────────────────────────
// Checked 2026-10-10 against https://code.claude.com/docs/en/memory ("Import
// additional files", "How CLAUDE.md files load", "My CLAUDE.md is too large"). It
// agrees on: the `@path/to/import` syntax anywhere in a line; relative paths
// resolving against the FILE CONTAINING the import, not the working directory;
// absolute and `~/` paths; imports being expanded at launch (so an import never
// reduces context); code spans and fenced blocks skipped; a path wrapped in quotes
// not imported; `CLAUDE.local.md` loading beside `CLAUDE.md`; `.claude/CLAUDE.md`
// being a project instruction file. Differences, each a decision here:
//   1. Depth. The current page says "a maximum depth of four hops"
//      (https://code.claude.com/docs/en/memory, fetched 2026-10-10); the older
//      docs.anthropic.com and docs.claude.com snapshots said five. MAX_HOPS follows
//      the current page: the audit measures what Claude Code loads now, and a fifth
//      hop would count bytes it does not load. MAX_HOPS is the one constant to
//      change if upstream moves again.
//   2. Escaped spaces. Upstream follows a path whose spaces are written `\ `. This
//      grammar stops at the backslash, so such an import is not followed (a missed
//      finding, never a false one).
//   3. Size skip. Upstream skips a file over 4 MiB, so it adds nothing to context.
//      SKIP_FILE_BYTES mirrors that: such a file is neither counted nor followed.
//   4. Approval. A project-level import that resolves outside the working
//      directory waits for a one-time approval dialog upstream, and a declined one
//      stays disabled. The audit cannot see that state and counts such an import.
//   5. Roots. Upstream also loads CLAUDE.md files from every ancestor directory and
//      `.claude/rules/`, and `AGENTS.md` where no CLAUDE.md exists; they are not
//      audited (OQ3), as is `claudeMdExcludes`.
//   6. HTML comments. Upstream strips block-level `<!-- -->` comments before the
//      content is injected; whether import parsing sees them first is not
//      documented, so an `@path` inside one is counted here.
//
// ── Files and bounds ───────────────────────────────────────────────────────────
// `stat` follows symlinks. Only regular files are opened: a FIFO, device, socket or
// directory is recorded and contributes nothing, and the open itself is
// non-blocking and re-checked with fstat, so a swap between the two cannot hang the
// run. A missing or unreadable target contributes nothing and fails nothing. The
// visited set is keyed by realpath, so a diamond counts a file once and a cycle
// ends. The caps, not a wall-clock timeout, bound the work: at most
// MAX_PATHS_PER_ROOT paths examined per root (existing or not), the first
// SCAN_BYTES of a file scanned for imports though the whole file is sized, and
// MAX_BYTES_READ bytes read per run. The root is hop 0 and an import of a hop-n
// file is hop n+1; hops 1 to MAX_HOPS are counted, and the files at MAX_HOPS are
// not read (nothing they import would be counted), so a hop MAX_HOPS+1 file is
// neither read nor counted.
//
// ── Thresholds (decimal bytes, as the plan writes sizes) ───────────────────────
// File finding: an import reached in a root's chain whose size is over
// FILE_THRESHOLD_BYTES (a root has none: it is not an import). Chain finding: a
// root's `total` (its size plus each distinct regular file reached through
// imports) over CHAIN_THRESHOLD_BYTES, naming the root, the total and the largest
// member (root included). A walk the caps stopped makes `total` a lower bound:
// `truncated`, and the display says "at least".
//
// ── Display ────────────────────────────────────────────────────────────────────
// A path shown in a systemMessage or an init line must match `^[ -~]+$`
// (printable ASCII); any other is shown as `<path not shown>` with its size. The
// audit reads the SIZE of files a repository's CLAUDE.md names, nothing else of
// theirs, and shows a size only for a finding over a threshold.
//
// ── The stamp (D-AUDIT-STAMP) ──────────────────────────────────────────────────
// One machine-root file, $HOME/.devflow/.claude-md-audit, written by the caller.
// Line-oriented, ASCII control bytes never recorded (a path holding one is simply
// left out, so a setup with one re-audits at every start):
//   V 1                       format version, first line
//   R <root path>             the gated root set, in call order
//   P <flag> <path>           an examined path; flag 0 absent, 1 regular file,
//                             2 exists but is not a regular file
//   K <key>                   a finding already displayed (once-per-key); at most
//                             MAX_KEYS, oldest dropped
//   E <reason>                the audit failed; written with the R rows only
// The hook's fast path reads only R and P rows, with shell builtins. The key of a
// file finding is `file <size> <mtime> <path>` and of a chain finding `chain
// <total> <mtime> <root path>`, mtimes in whole seconds as get-mtime returns them.
// A finding is recorded as displayed only after it was shown, so a lost stamp
// update can repeat a message and can never hide a new finding. A stamp over
// MAX_STAMP_BYTES, or one that is not a regular file, is read as absent.

'use strict';

const fs = require('fs');
const path = require('path');

/** Decimal bytes: an import over this is a file finding. */
const FILE_THRESHOLD_BYTES = 10000;
/** Decimal bytes: a root whose chain totals over this is a chain finding. */
const CHAIN_THRESHOLD_BYTES = 40000;
/** The deepest hop counted; the root is hop 0. */
const MAX_HOPS = 4;
/** Paths examined per root, existing or not. */
const MAX_PATHS_PER_ROOT = 64;
/** Bytes of one file scanned for imports. */
const SCAN_BYTES = 65536;
/** Bytes read in one run. */
const MAX_BYTES_READ = 1048576;
/** A stamp over this is read as absent. */
const MAX_STAMP_BYTES = 262144;
/** Finding keys kept in the stamp. */
const MAX_KEYS = 256;
/** Claude Code skips a file over 4 MiB; so does the audit (OQ9, difference 3). */
const SKIP_FILE_BYTES = 4 * 1024 * 1024;
/** Upper bound on read(2) calls for one file: SCAN_BYTES in chunks of at least one byte per call. */
const MAX_READ_CALLS = 1024;

const NOT_SHOWN = '<path not shown>';
const STAMP_VERSION_ROW = 'V 1';
const HOOK_MAGIC = 'devflow-claude-md-audit 1';
const HOOK_END = 'END';

/** P-row flags. */
const PATH_ABSENT = 0;
const PATH_FILE = 1;
const PATH_OTHER = 2;

const IMPORT_CHARS = /[A-Za-z0-9._/~+-]/;
const CONTROL_BYTE = /[\u0000-\u001f\u007f]/;
const DISPLAYABLE = /^[ -~]+$/;

// ── Pure text helpers ──────────────────────────────────────────────────────────

/** 14220 -> "14,220". */
function formatBytes(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A CommonMark fence opener (the rule of `fenceOpen` in pr-evidence.cjs). */
function fenceOpen(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (m === null) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { ch: m[1][0], len: m[1].length };
}

/** Whether `line` closes `fence` (the rule of `fenceCloses` in pr-evidence.cjs). */
function fenceCloses(line, fence) {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1][0] === fence.ch && m[1].length >= fence.len;
}

/**
 * `line` with each inline code span replaced by a placeholder that is not
 * whitespace (so an `@` right after a span is not read as following whitespace).
 * A backtick run closes at the next run of the same length on the same line; a run
 * with no closer is literal text.
 */
function maskCodeSpans(line) {
  let out = '';
  let i = 0;
  // Each pass consumes at least one character, so the loop ends within line.length passes.
  for (let guard = 0; i < line.length && guard <= line.length; guard++) {
    if (line[i] !== '`') {
      out += line[i];
      i += 1;
      continue;
    }
    let runEnd = i;
    while (runEnd < line.length && line[runEnd] === '`') runEnd += 1;
    const runLength = runEnd - i;
    let close = -1;
    let j = runEnd;
    for (let step = 0; j < line.length && step <= line.length; step++) {
      if (line[j] !== '`') {
        j += 1;
        continue;
      }
      let end = j;
      while (end < line.length && line[end] === '`') end += 1;
      if (end - j === runLength) {
        close = j;
        break;
      }
      j = end;
    }
    if (close === -1) {
      out += line.slice(i, runEnd);
      i = runEnd;
    } else {
      out += '\u0001'.repeat(close + runLength - i);
      i = close + runLength;
    }
  }
  return out;
}

/**
 * The import tokens of `text`, in document order: the path after each `@` that
 * starts a line or follows whitespace, outside fenced blocks and inline code spans.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractImports(text) {
  const tokens = [];
  let fence = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (fence !== null) {
      if (fenceCloses(line, fence)) fence = null;
      continue;
    }
    const opened = fenceOpen(line);
    if (opened !== null) {
      fence = opened;
      continue;
    }
    const masked = maskCodeSpans(line);
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] !== '@') continue;
      if (i > 0 && !/\s/.test(masked[i - 1])) continue;
      let end = i + 1;
      while (end < masked.length && IMPORT_CHARS.test(masked[end])) end += 1;
      let token = masked.slice(i + 1, end);
      while (token.endsWith('.')) token = token.slice(0, -1);
      if (token !== '') tokens.push(token);
    }
  }
  return tokens;
}

/** The absolute path an import token names, from the file that holds it. */
function resolveImport(token, importerPath, home) {
  if (token === '~') return home;
  if (token.startsWith('~/')) return path.join(home, token.slice(2));
  if (path.isAbsolute(token)) return path.normalize(token);
  return path.resolve(path.dirname(importerPath), token);
}

/** Whether `p` may appear in a systemMessage or an init line. */
function isDisplayable(p) {
  return DISPLAYABLE.test(p);
}

function shownPath(p) {
  return isDisplayable(p) ? p : NOT_SHOWN;
}

/** Whether `text` can be one stamp row: no control byte. */
function isRecordable(text) {
  return !CONTROL_BYTE.test(text);
}

// ── File access (read-only) ────────────────────────────────────────────────────

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Up to `limit` bytes of the regular file at `p` as `{ text, bytes }`, or null when
 * it cannot be read or is not a regular file. The open is O_NONBLOCK, so a FIFO
 * swapped in after the stat cannot hang it, and fstat re-checks the type before a
 * byte is read.
 */
function readHead(p, limit) {
  let fd = null;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.allocUnsafe(limit);
    let got = 0;
    for (let call = 0; got < limit && call < MAX_READ_CALLS; call++) {
      const n = fs.readSync(fd, buf, got, limit - got, null);
      if (n === 0) break;
      got += n;
    }
    return { text: buf.toString('utf8', 0, got), bytes: got };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* nothing left to release */ }
    }
  }
}

/**
 * The stamp's text, or null when the path is absent, is a symlink or other
 * non-regular file, is over MAX_STAMP_BYTES or cannot be read.
 */
function readStampFile(stampPath) {
  let st;
  try {
    st = fs.lstatSync(stampPath);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > MAX_STAMP_BYTES) return null;
  const head = readHead(stampPath, Math.max(st.size, 1));
  return head === null ? null : head.text;
}

// ── The walk ───────────────────────────────────────────────────────────────────

/**
 * Walk one root's import chain breadth-first, so a file reached by two routes is
 * judged at its shortest hop count.
 */
function walkRoot(rootPath, ctx) {
  const examined = new Map();
  const seenReal = new Set();
  const members = [];
  const fileFindings = [];
  let total = 0;
  let largest = null;
  let truncated = false;
  let exists = false;
  let rootSize = 0;
  let rootMtime = 0;
  const queue = [{ p: rootPath, hop: 0 }];
  const queued = new Set([rootPath]);

  // The queue grows by at most the imports of each examined path, and examined paths are capped.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { p, hop } = queue[cursor];
    if (examined.has(p)) continue;
    if (examined.size >= MAX_PATHS_PER_ROOT) {
      truncated = true;
      break;
    }
    const st = statOrNull(p);
    if (st === null) {
      examined.set(p, PATH_ABSENT);
      continue;
    }
    if (!st.isFile()) {
      examined.set(p, PATH_OTHER);
      continue;
    }
    examined.set(p, PATH_FILE);
    if (st.size > SKIP_FILE_BYTES) continue;
    const real = realpathOrSelf(p);
    if (seenReal.has(real)) continue;
    seenReal.add(real);
    ctx.counted.add(real);

    const mtime = Math.floor(st.mtimeMs / 1000);
    total += st.size;
    members.push({ path: p, size: st.size, mtime, hop });
    if (hop === 0) {
      exists = true;
      rootSize = st.size;
      rootMtime = mtime;
    }
    if (largest === null || st.size > largest.size) largest = { path: p, size: st.size };
    if (hop >= 1 && st.size > FILE_THRESHOLD_BYTES) {
      fileFindings.push({ kind: 'file', path: p, size: st.size, mtime, hop });
    }
    if (hop >= MAX_HOPS) continue;

    const remaining = MAX_BYTES_READ - ctx.bytesRead;
    const want = Math.min(st.size, SCAN_BYTES, remaining);
    if (remaining < Math.min(st.size, SCAN_BYTES)) {
      // The run's byte budget cuts this scan short: imports may be missed, so the total is a lower bound.
      truncated = true;
      ctx.truncated = true;
    }
    if (want <= 0) continue;
    const head = readHead(p, want);
    if (head === null) continue;
    ctx.bytesRead += head.bytes;
    for (const token of extractImports(head.text)) {
      const next = resolveImport(token, p, ctx.home);
      if (examined.has(next) || queued.has(next)) continue;
      queued.add(next);
      queue.push({ p: next, hop: hop + 1 });
    }
  }

  const findings = [...fileFindings];
  if (total > CHAIN_THRESHOLD_BYTES && largest !== null) {
    findings.push({
      kind: 'chain',
      path: rootPath,
      total,
      mtime: rootMtime,
      largest,
      truncated,
    });
  }
  return {
    path: rootPath,
    exists,
    size: rootSize,
    total,
    largest,
    truncated,
    members,
    examined: [...examined.entries()].map(([p, flag]) => ({ path: p, flag })),
    findings,
  };
}

// ── Findings: keys and display ─────────────────────────────────────────────────

function findingKey(f) {
  return f.kind === 'file'
    ? `file ${f.size} ${f.mtime} ${f.path}`
    : `chain ${f.total} ${f.mtime} ${f.path}`;
}

/** The one display line of a finding. Used by the hook and by init alike. */
function formatFinding(f) {
  if (f.kind === 'file') {
    return `CLAUDE.md import audit: ${shownPath(f.path)} is ${formatBytes(f.size)} bytes `
      + `(over the ${formatBytes(FILE_THRESHOLD_BYTES)}-byte import threshold).`;
  }
  const bound = f.truncated ? 'at least ' : '';
  return `CLAUDE.md import audit: ${shownPath(f.path)} loads ${bound}${formatBytes(f.total)} bytes through its imports `
    + `(over the ${formatBytes(CHAIN_THRESHOLD_BYTES)}-byte chain threshold); the largest file is `
    + `${shownPath(f.largest.path)} at ${formatBytes(f.largest.size)} bytes.`;
}

// ── The stamp ──────────────────────────────────────────────────────────────────

/**
 * Parse stamp text. Unknown rows are ignored; text that does not open with the
 * version row is read as an empty stamp.
 *
 * @returns {{ valid: boolean, roots: string[], examined: {path: string, flag: number}[], keys: string[], error: boolean }}
 */
function parseStamp(text) {
  const out = { valid: false, roots: [], examined: [], keys: [], error: false };
  if (typeof text !== 'string') return out;
  const lines = text.split('\n');
  if (lines[0] !== STAMP_VERSION_ROW) return out;
  out.valid = true;
  for (const line of lines.slice(1)) {
    if (line.startsWith('R ')) out.roots.push(line.slice(2));
    else if (line.startsWith('P ') && /^P [012] /.test(line)) out.examined.push({ path: line.slice(4), flag: Number(line[2]) });
    else if (line.startsWith('K ')) out.keys.push(line.slice(2));
    else if (line.startsWith('E ')) out.error = true;
  }
  return out;
}

/**
 * Render the stamp text (rows joined by "\n", ending in one "\n").
 *
 * @param {{ roots: string[], examined: {path: string, flag: number}[], keys: string[], error?: boolean }} s
 */
function renderStamp(s) {
  const rows = [STAMP_VERSION_ROW];
  for (const root of s.roots) if (isRecordable(root)) rows.push(`R ${root}`);
  for (const e of s.examined) if (isRecordable(e.path)) rows.push(`P ${e.flag} ${e.path}`);
  for (const key of s.keys.slice(-MAX_KEYS)) if (isRecordable(key)) rows.push(`K ${key}`);
  if (s.error === true) rows.push('E audit-failed');
  return `${rows.join('\n')}\n`;
}

// ── The audit ──────────────────────────────────────────────────────────────────

/**
 * Audit `input.roots` and return everything a caller needs, without writing anything.
 *
 * @param {{ roots: string[], home: string, keys?: string[] }} input
 *   `roots` are absolute root FILE paths in call order; `keys` are the stamp's
 *   already-displayed finding keys.
 * @returns {{
 *   ok: true,
 *   roots: object[], findings: object[], examined: {path: string, flag: number}[],
 *   filesExamined: number, pathsExamined: number, bytesRead: number, truncated: boolean,
 *   lines: string[], shown: string[], stamp: string
 * }}
 */
function audit(input) {
  const home = path.resolve(input.home);
  const priorKeys = Array.isArray(input.keys) ? input.keys.filter(k => typeof k === 'string') : [];
  const ctx = { home, bytesRead: 0, counted: new Set(), truncated: false };
  const roots = input.roots.map(root => walkRoot(path.resolve(root), ctx));

  const examinedByPath = new Map();
  for (const root of roots) for (const e of root.examined) if (!examinedByPath.has(e.path)) examinedByPath.set(e.path, e.flag);
  const examined = [...examinedByPath.entries()].map(([p, flag]) => ({ path: p, flag }));

  const findings = roots.flatMap(root => root.findings);
  const already = new Set(priorKeys);
  const lines = [];
  const shown = [];
  for (const f of findings) {
    const key = findingKey(f);
    if (already.has(key)) continue;
    already.add(key);
    lines.push(formatFinding(f));
    shown.push(key);
  }

  const keys = [...priorKeys, ...shown.filter(isRecordable)].slice(-MAX_KEYS);
  // The R rows keep each root as the caller spelled it, so the hook's string comparison
  // of the root set holds even for a root the walk normalised.
  const stamp = renderStamp({ roots: input.roots, examined, keys });
  return {
    ok: true,
    roots: roots.map(({ members: _members, examined: _examined, findings: _findings, ...rest }) => rest),
    findings,
    examined,
    filesExamined: ctx.counted.size,
    pathsExamined: examined.length,
    bytesRead: ctx.bytesRead,
    truncated: ctx.truncated || roots.some(r => r.truncated),
    lines,
    shown,
    stamp,
  };
}

// ── CLI (the hook's view) ──────────────────────────────────────────────────────

/**
 * `hook <home> <stampFile> <root>...` -> the framed block on stdout. Returns the
 * exit code; it never throws.
 */
function main(argv, stdout) {
  const [mode, home, stampFile, ...roots] = argv;
  if (mode !== 'hook' || !home || !stampFile) return 2;
  try {
    const stampText = readStampFile(stampFile);
    const keys = stampText === null ? [] : parseStamp(stampText).keys;
    const result = audit({ roots, home, keys });
    const block = [HOOK_MAGIC, ...result.lines.map(line => `M ${line}`), result.stamp.replace(/\n$/, ''), HOOK_END];
    stdout.write(`${block.join('\n')}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`claude-md-audit: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), process.stdout);
}

module.exports = Object.freeze({
  FILE_THRESHOLD_BYTES,
  CHAIN_THRESHOLD_BYTES,
  MAX_HOPS,
  MAX_PATHS_PER_ROOT,
  SCAN_BYTES,
  MAX_BYTES_READ,
  MAX_STAMP_BYTES,
  MAX_KEYS,
  SKIP_FILE_BYTES,
  NOT_SHOWN,
  HOOK_MAGIC,
  HOOK_END,
  extractImports,
  isDisplayable,
  isRecordable,
  formatFinding,
  findingKey,
  parseStamp,
  renderStamp,
  readStampFile,
  audit,
  main,
});
