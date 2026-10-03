#!/usr/bin/env node
// src/assets/scripts/hooks/lib/render-decisions.cjs
//
// Pure renderer for decisions.md and pitfalls.md from a decisions-ledger.jsonl.
//
// DESIGN: Idempotent, clock-free render from anchored ledger rows. No timestamps
// in output — render is a pure function of the ledger rows. Two consumers:
//   1. renderDecisionsFile(rows, kind) — exported pure function for testing
//   2. CLI: `render <worktree>` and `--check <worktree>` subcommands, run from the
//      project root: <worktree> names the current directory
//
// Filtering rules (must match AC-F3):
//   - anchor_id must be set (unanchored observing rows are excluded)
//   - type must match kind: 'decision' rows → decisions.md; 'pitfall' rows → pitfalls.md
//   - an active row (isActive from learning-store.cjs, the one status list) renders
//     its body; an inactive one is listed in the file's Inactive table instead
//
// Row shape: a v2 ledger row (schema 2) or a v1 one; see learning-store.cjs.
// Ledger file: .devflow/learning/decisions-ledger.jsonl (anchored rows only).
// If absent, treat as empty corpus.
//
// Byte-compat: formatDecisionBody / formatPitfallBody / formatEntryBodyV2 /
// formatInactiveTable / buildTldrLine / initDecisionsContent — all from
// decisions-format.cjs (single source of truth).

'use strict';

const fs = require('fs');

const {
  initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
  formatEntryBodyV2,
  formatInactiveTable,
  buildTldrLine,
  buildIndexContent,
} = require('./decisions-format.cjs');

const {
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsIndexPath,
  getDecisionsLedgerPath,
} = require('./project-paths.cjs');
const { safePath } = require('./safe-path.cjs');
const {
  isActive,
  isV2,
  readJsonl,
  hasLearningDir,
  withDecisionsLock,
} = require('./learning-store.cjs');

// ---------------------------------------------------------------------------
// Ledger parsing
// ---------------------------------------------------------------------------

/**
 * Read a JSONL ledger file leniently: its rows, skipping any line that is not one
 * JSON object, or [] when the file is absent. Read-only: a skipped line is never
 * quarantined (the store's readJsonl reports it for a caller that counts them).
 *
 * @param {string} ledgerPath
 * @returns {object[]}
 */
function parseLedger(ledgerPath) {
  return readJsonl(ledgerPath).rows;
}

// ---------------------------------------------------------------------------
// Core renderer
// ---------------------------------------------------------------------------

/**
 * Extract the numeric suffix from an anchor_id like "ADR-NNN" or "PF-NNN".
 * Returns Infinity for unparseable values so they sort to the end.
 *
 * @param {string} anchorId
 * @returns {number}
 */
function anchorNumeric(anchorId) {
  if (!anchorId) return Infinity;
  const m = anchorId.match(/\d+$/);
  return m ? parseInt(m[0], 10) : Infinity;
}

/**
 * Select active rows of a given kind from the ledger, sorted by numeric anchor.
 * Exported so callers (renderAndWriteAll, migrations) can build the index without
 * going through renderDecisionsFile.
 *
 * @param {object[]} rows - all rows from the ledger (unfiltered)
 * @param {'decisions'|'pitfalls'} kind
 * @returns {object[]} filtered + sorted active rows
 */
function selectActiveRows(rows, kind) {
  const type = kind === 'decisions' ? 'decision' : 'pitfall';
  return rows
    .filter(r => r.type === type && r.anchor_id && isActive(r))
    .sort((a, b) => anchorNumeric(a.anchor_id) - anchorNumeric(b.anchor_id));
}

/**
 * Select the inactive rows of a given kind, sorted by numeric anchor: the rows a
 * file lists in its Inactive table instead of rendering their bodies.
 *
 * @param {object[]} rows - all rows from the ledger (unfiltered)
 * @param {'decisions'|'pitfalls'} kind
 * @returns {object[]} filtered + sorted inactive rows
 */
function selectInactiveRows(rows, kind) {
  const type = kind === 'decisions' ? 'decision' : 'pitfall';
  return rows
    .filter(r => r.type === type && r.anchor_id && !isActive(r))
    .sort((a, b) => anchorNumeric(a.anchor_id) - anchorNumeric(b.anchor_id));
}

/**
 * Build per-row body blocks from already-filtered + sorted active rows.
 * Each block starts with a leading newline (matching the format contract).
 *
 * Per-row content:
 *   - a v2 row (schema 2) → formatEntryBodyV2 from its fields
 *   - a v1 row with a truthy raw_body → raw_body verbatim (migrated entries)
 *   - any other v1 row → formatDecisionBody / formatPitfallBody from details
 *
 * D-V1-BYTE-STABLE: a v1 ledger row — any row without schema 2 — renders byte for
 * byte as it did before v2: its raw_body verbatim when truthy, else
 * formatDecisionBody or formatPitfallBody, and its index line keeps the v1 shape;
 * only a schema-2 row takes the v2 body and index line. Reason: the ledger stays
 * v1 until each entry is rewritten, and a render that moved v1 bytes would show
 * every untouched entry as changed and alter text nobody revised.
 *
 * Extracted so renderAndWriteAll can compute blocks once and reuse them
 * for both the body files and buildIndexContent, avoiding a second full
 * render pass (PERF-2).
 *
 * @param {object[]} activeRows - already-filtered + sorted active rows
 * @param {'decisions'|'pitfalls'} kind
 * @returns {string[]} per-row rendered blocks
 */
function buildBodyBlocks(activeRows, kind) {
  return activeRows.map(row => {
    if (isV2(row)) return formatEntryBodyV2(row);
    if (row.raw_body) {
      // Migrated entry: emit verbatim. raw_body must start with \n## so
      // it fits seamlessly after the header preamble.
      return row.raw_body;
    }
    return kind === 'decisions'
      ? formatDecisionBody(row)
      : formatPitfallBody(row);
  });
}

/**
 * Assemble the full file content: the header with the file's TL;DR line, the
 * pre-computed active blocks, then the Inactive table.
 * Internal helper — avoids re-computing blocks when the caller already has them.
 *
 * @param {object[]} activeRows - already-filtered + sorted active rows
 * @param {string[]} blocks - pre-rendered per-row blocks (from buildBodyBlocks)
 * @param {'decisions'|'pitfalls'} kind
 * @param {object[]} inactiveRows - already-filtered + sorted inactive rows
 * @returns {string} complete file content
 */
function buildFileFromBlocks(activeRows, blocks, kind, inactiveRows) {
  // The TL;DR line counts the active rows.
  const tldr = buildTldrLine(kind, activeRows);

  // Build header: replace the zero-count TL;DR line that opens the init content
  // ("<!-- TL;DR: 0 {kind} -->\n...") with the real one.
  const initKind = kind === 'decisions' ? 'decision' : 'pitfall';
  const headerWithPlaceholder = initDecisionsContent(initKind);
  // Replace only the first line (the TL;DR comment)
  const header = headerWithPlaceholder.replace(/^<!-- TL;DR:[^\n]*-->/, tldr);

  return header + blocks.join('') + formatInactiveTable(inactiveRows);
}

/**
 * Pure render function. Produces the full content of a decisions.md or
 * pitfalls.md file from the given ledger rows.
 *
 * Filtering:
 *   - row.type must match kind ('decision' → decisions.md, 'pitfall' → pitfalls.md)
 *   - row.anchor_id must be set
 *   - an active row (isActive) renders its body; an inactive one is listed in the
 *     Inactive table
 *
 * Output structure:
 *   TL;DR line (line 1)
 *   File header body (title + preamble)
 *   Per-row blocks (sorted by numeric anchor ASC)
 *   Inactive table (sorted by numeric anchor ASC; omitted when empty)
 *
 * Idempotent and clock-free: no timestamps in output.
 *
 * @param {object[]} rows - all rows from the ledger (unfiltered)
 * @param {'decisions'|'pitfalls'} kind
 * @returns {string} complete file content
 */
function renderDecisionsFile(rows, kind) {
  const activeRows = selectActiveRows(rows, kind);
  return buildFileFromBlocks(activeRows, buildBodyBlocks(activeRows, kind), kind, selectInactiveRows(rows, kind));
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

/**
 * Write content atomically via a .tmp sibling + rename.
 * Uses O_EXCL to prevent TOCTOU symlink attacks, retries once on EEXIST.
 *
 * @param {string} filePath
 * @param {string} content
 */
function writeAtomic(filePath, content) {
  const tmp = filePath + '.tmp';
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    try { fs.unlinkSync(tmp); } catch { /* race */ }
    fs.writeFileSync(tmp, content, { flag: 'wx' });
  }
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// Render and write
// ---------------------------------------------------------------------------

/**
 * Render decisions.md, pitfalls.md and index.md from the ledger rows, in memory,
 * in the order they are written: the body files first, the index last. `render`
 * writes exactly these contents and `--check` compares exactly these.
 *
 * @param {string} worktreePath - Absolute path to the worktree root.
 * @param {object[]} rows - All rows from the ledger (unfiltered).
 * @returns {Array<{ path: string, content: string }>}
 */
function renderLearningFiles(worktreePath, rows) {
  const decisionsFilePath = getDecisionsFilePath(worktreePath);
  const pitfallsFilePath = getPitfallsFilePath(worktreePath);

  // Hoist active-row selection: computed once per kind, reused for both the
  // body render and the index build — avoids two redundant selectActiveRows passes.
  const activeDecisionRows = selectActiveRows(rows, 'decisions');
  const activePitfallRows = selectActiveRows(rows, 'pitfalls');

  // Build per-row blocks once — reused for body files and index so
  // buildIndexContent does not re-render every entry a second time (PERF-2).
  const decisionBlocks = buildBodyBlocks(activeDecisionRows, 'decisions');
  const pitfallBlocks = buildBodyBlocks(activePitfallRows, 'pitfalls');

  return [
    {
      path: decisionsFilePath,
      content: buildFileFromBlocks(activeDecisionRows, decisionBlocks, 'decisions', selectInactiveRows(rows, 'decisions')),
    },
    {
      path: pitfallsFilePath,
      content: buildFileFromBlocks(activePitfallRows, pitfallBlocks, 'pitfalls', selectInactiveRows(rows, 'pitfalls')),
    },
    {
      // Compact index: a write-time artifact consumed via plain Read.
      path: getDecisionsIndexPath(worktreePath),
      content: buildIndexContent(activeDecisionRows, activePitfallRows, {
        decisionsFilePath,
        pitfallsFilePath,
        decisionBlocks,
        pitfallBlocks,
      }) + '\n',
    },
  ];
}

/**
 * Render decisions.md, pitfalls.md and index.md from the given ledger rows and
 * write them atomically. It takes no lock: the caller holds .decisions.lock
 * (D-ONE-LEARNING-LOCK). It writes only into an existing `.devflow/learning/`:
 * without one it throws before writing anything (D-NO-STRAY-TREE).
 *
 * @param {string} worktreePath - Absolute path to the worktree root.
 * @param {object[]} rows - All rows from the ledger (unfiltered).
 * @throws when `<worktreePath>/.devflow/learning/` does not exist, or a write fails
 */
function renderAndWriteAll(worktreePath, rows) {
  if (!hasLearningDir(worktreePath)) {
    throw new Error(`renderAndWriteAll: no .devflow/learning/ under ${worktreePath}`);
  }
  const [decisions, pitfalls, index] = renderLearningFiles(worktreePath, rows);

  // Write body files first; index last. On a crash between body writes and the
  // index write: on the FIRST render the index is absent (reader falls back to
  // (none)); on a RE-render the index is stale — one generation behind the new
  // body files — never corrupt. Both cases are benign and self-heal on the next
  // successful render.
  for (const file of [decisions, pitfalls, index]) writeAtomic(file.path, file.content);

  process.stderr.write(
    `[render-decisions] wrote decisions.md (${Buffer.byteLength(decisions.content)}B) + pitfalls.md (${Buffer.byteLength(pitfalls.content)}B) + index.md (${Buffer.byteLength(index.content)}B)\n`
  );
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/** The name the CLI's messages carry; the lock reports it as the op. */
const CLI_NAME = 'render-decisions';

const USAGE =
  'Usage (run from the project root; <worktree> names the current directory, e.g. "."):\n' +
  '  render-decisions.cjs render <worktree>          Write decisions.md, pitfalls.md and index.md\n' +
  '  render-decisions.cjs --check <worktree>         Compare without writing; exit 1 on drift\n';

/**
 * The project root the CLI works in: the current directory, with symlinks
 * resolved. The CLI runs from the project root, as the json-helper ops do, and
 * `<worktree>` must name that same directory once resolved (safePath refuses a NUL
 * byte). The argument is only compared: every path the CLI reads or writes is
 * built from the current directory, never from argv.
 *
 * @param {string} arg - the `<worktree>` argument
 * @returns {{ ok: true, value: string } | { ok: false, error: { kind: 'invalid-root', message: string } }}
 */
function resolveCliRoot(arg) {
  const invalid = message => ({ ok: false, error: { kind: 'invalid-root', message: `${CLI_NAME}: ${message}` } });
  let cwd;
  let named;
  try {
    cwd = fs.realpathSync(process.cwd());
    named = fs.realpathSync(safePath(arg));
  } catch (err) {
    return invalid(`invalid worktree path: ${err.message}`);
  }
  if (named !== cwd) {
    return invalid(`${named} is not the current directory ${cwd} — run from the project root`);
  }
  return { ok: true, value: cwd };
}

/** Report on stderr how many ledger lines were not one JSON object, when any were. */
function reportMalformed(count, ledgerPath) {
  if (count === 0) return;
  process.stderr.write(
    `[render-decisions] MALFORMED: ${count} ledger line${count === 1 ? '' : 's'} skipped (${ledgerPath})\n`
  );
}

/** The ledger's rows, reporting its malformed lines on stderr. Read-only. */
function readLedgerRows(root) {
  const ledgerPath = getDecisionsLedgerPath(root);
  const { rows, rejected } = readJsonl(ledgerPath);
  reportMalformed(rejected.length, ledgerPath);
  return rows;
}

/** The file's content, or null when it does not exist. */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * `render`: read the ledger under .decisions.lock and write the three files from
 * what it read (D-ONE-LEARNING-LOCK), so a ledger write that lands while it waits
 * is rendered rather than overwritten. Refuses without the learning directory
 * (D-NO-STRAY-TREE).
 *
 * @param {string} root
 * @returns {number} exit code
 */
function renderCommand(root) {
  const result = withDecisionsLock(CLI_NAME, root, () => {
    renderAndWriteAll(root, readLedgerRows(root));
    return { ok: true, value: null };
  });
  if (result.ok) return 0;
  process.stderr.write(`${result.error.message}\n`);
  return 1;
}

/**
 * `--check`: render in memory and compare with the files on disk, naming each
 * file that differs or is missing; exit 1 on any drift. It writes nothing and
 * takes no lock — taking it would create the lock directory — and refuses
 * without the learning directory (D-NO-STRAY-TREE).
 *
 * @param {string} root
 * @returns {number} exit code
 */
function checkCommand(root) {
  if (!hasLearningDir(root)) {
    process.stderr.write(`${CLI_NAME}: no .devflow/learning/ under ${root} — run from the project root\n`);
    return 1;
  }
  let drift = false;
  for (const file of renderLearningFiles(root, readLedgerRows(root))) {
    const onDisk = readIfPresent(file.path);
    if (onDisk !== file.content) {
      process.stderr.write(`[render-decisions] DRIFT: ${file.path}${onDisk === null ? ' (missing)' : ''}\n`);
      drift = true;
    }
  }
  return drift ? 1 : 0;
}

/**
 * Run the CLI on its arguments and return the exit code. Neither mode creates the
 * learning directory (D-NO-STRAY-TREE).
 *
 * @param {string[]} argv - the arguments after the script path
 * @returns {number}
 */
function runCli(argv) {
  const mode = argv[0] === 'render' || argv[0] === '--check' ? argv[0] : null;
  if (mode === null || argv.length !== 2 || !argv[1]) {
    process.stderr.write(USAGE);
    return 1;
  }
  const root = resolveCliRoot(argv[1]);
  if (!root.ok) {
    process.stderr.write(`${root.error.message}\n`);
    return 1;
  }
  return mode === 'render' ? renderCommand(root.value) : checkCommand(root.value);
}

if (require.main === module) {
  // The one exit, outside every lock: withDecisionsLock has released its lock
  // before runCli returns or throws.
  let exitCode;
  try {
    exitCode = runCli(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${CLI_NAME}: ${err && err.message ? err.message : String(err)}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Module exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  renderDecisionsFile,
  renderAndWriteAll,
  selectActiveRows,
  selectInactiveRows,
  parseLedger,
  isActive,
  anchorNumeric,
};
