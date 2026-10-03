#!/usr/bin/env node
// src/assets/scripts/hooks/lib/render-decisions.cjs
//
// Pure renderer for decisions.md and pitfalls.md from a decisions-ledger.jsonl.
//
// DESIGN: Idempotent, clock-free render from anchored ledger rows. No timestamps
// in output — render is a pure function of the ledger rows. Two consumers:
//   1. renderDecisionsFile(rows, kind) — exported pure function for testing
//   2. CLI: `render <worktree>` and `--check <worktree>` subcommands
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
const path = require('path');

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
  getDecisionsLockDir,
} = require('./project-paths.cjs');
const { acquireMkdirLock, releaseLock } = require('./mkdir-lock.cjs');
const { safePath } = require('./safe-path.cjs');
const { isActive, isV2 } = require('./learning-store.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ledger filename relative to .devflow/learning/ */
const LEDGER_FILENAME = 'decisions-ledger.jsonl';

// ---------------------------------------------------------------------------
// Ledger parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL ledger file into an array of row objects.
 * Skips empty or malformed lines. Returns [] if file is absent.
 *
 * @param {string} ledgerPath
 * @returns {object[]}
 */
function parseLedger(ledgerPath) {
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines
    }
  }
  return rows;
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
  // Build TL;DR line (uses active + sorted rows so last-5 are stable)
  const tldr = buildTldrLine(kind, activeRows);

  // Build header: replace placeholder TL;DR in the init content with the real one.
  // initDecisionsContent returns "<!-- TL;DR: 0 {kind}. Key: -->\n..." so we
  // replace the TL;DR line at position 0.
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
// Lock-free render+write helper (for callers that already hold .decisions.lock)
// ---------------------------------------------------------------------------

/**
 * Render both decisions.md and pitfalls.md from the given ledger rows and write
 * them atomically. Does NOT acquire any lock — callers (assign-anchor, retire-anchor,
 * refresh-anchor) must already hold .decisions.lock. The standalone `render` CLI takes
 * the lock before calling this function.
 *
 * Creates the decisionsDir if it does not exist.
 *
 * @param {string} worktreePath - Absolute path to the worktree root.
 * @param {object[]} rows - All rows from the ledger (unfiltered).
 */
function renderAndWriteAll(worktreePath, rows) {
  const decisionsDir = path.join(worktreePath, '.devflow', 'learning');
  fs.mkdirSync(decisionsDir, { recursive: true });

  const decisionsFilePath = getDecisionsFilePath(worktreePath);
  const pitfallsFilePath = getPitfallsFilePath(worktreePath);
  const indexFilePath = getDecisionsIndexPath(worktreePath);

  // Hoist active-row selection: computed once per kind, reused for both the
  // body render and the index build — avoids two redundant selectActiveRows passes.
  const activeDecisionRows = selectActiveRows(rows, 'decisions');
  const activePitfallRows = selectActiveRows(rows, 'pitfalls');

  // Build per-row blocks once — reused for body files and index so
  // buildIndexContent does not re-render every entry a second time (PERF-2).
  const decisionBlocks = buildBodyBlocks(activeDecisionRows, 'decisions');
  const pitfallBlocks = buildBodyBlocks(activePitfallRows, 'pitfalls');

  const decisionsContent = buildFileFromBlocks(
    activeDecisionRows, decisionBlocks, 'decisions', selectInactiveRows(rows, 'decisions'),
  );
  const pitfallsContent = buildFileFromBlocks(
    activePitfallRows, pitfallBlocks, 'pitfalls', selectInactiveRows(rows, 'pitfalls'),
  );

  // Write body files first; index last. On a crash between body writes and the
  // index write: on the FIRST render the index is absent (reader falls back to
  // (none)); on a RE-render the index is stale — one generation behind the new
  // body files — never corrupt. Both cases are benign and self-heal on the next
  // successful render.
  writeAtomic(decisionsFilePath, decisionsContent);
  writeAtomic(pitfallsFilePath, pitfallsContent);

  // Build and write compact index (write-time artifact; consumed via plain Read)
  // Reuses the pre-computed active rows and pre-rendered blocks — no additional
  // selectActiveRows or format pass.
  const indexContent = buildIndexContent(activeDecisionRows, activePitfallRows, {
    decisionsFilePath,
    pitfallsFilePath,
    decisionBlocks,
    pitfallBlocks,
  });
  const indexLine = indexContent + '\n';
  writeAtomic(indexFilePath, indexLine);

  process.stderr.write(
    `[render-decisions] wrote decisions.md (${Buffer.byteLength(decisionsContent)}B) + pitfalls.md (${Buffer.byteLength(pitfallsContent)}B) + index.md (${Buffer.byteLength(indexLine)}B)\n`
  );
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);

  const USAGE =
    'Usage:\n' +
    '  render-decisions.cjs render <worktree>          Write both .md files\n' +
    '  render-decisions.cjs --check <worktree>         Diff without writing; exit 1 on drift\n';

  // Parse: `render <worktree>` or `--check <worktree>`
  let mode; // 'render' | 'check'
  let worktreePath;

  if (argv[0] === 'render' && argv[1]) {
    mode = 'render';
    worktreePath = path.resolve(argv[1]);
  } else if (argv[0] === '--check' && argv[1]) {
    mode = 'check';
    worktreePath = path.resolve(argv[1]);
  } else {
    process.stderr.write(USAGE);
    process.exit(1);
  }

  // Validate path at trust boundary before any file operations.
  // safePath rejects null bytes, which path.resolve preserves silently.
  try {
    worktreePath = safePath(worktreePath);
  } catch (err) {
    process.stderr.write(`render-decisions: invalid worktree path: ${err.message}\n`);
    process.exit(1);
  }

  const decisionsDir = path.join(worktreePath, '.devflow', 'learning');
  const ledgerPath = path.join(decisionsDir, LEDGER_FILENAME);
  const decisionsFilePath = getDecisionsFilePath(worktreePath);
  const pitfallsFilePath = getPitfallsFilePath(worktreePath);
  const indexFilePath = getDecisionsIndexPath(worktreePath);
  const lockDir = getDecisionsLockDir(worktreePath);

  // Ensure decisionsDir exists (needed before lock acquisition and file reads)
  fs.mkdirSync(decisionsDir, { recursive: true });

  // Read ledger (empty corpus if absent)
  const rows = parseLedger(ledgerPath);

  if (mode === 'check') {
    // Render all three files in memory and compare against on-disk content.
    // Exit non-zero on drift.
    // Hoist active-row selection (mirrors renderAndWriteAll): computed once per kind,
    // reused for both body render and index build.
    const activeDecisionRows = selectActiveRows(rows, 'decisions');
    const activePitfallRows = selectActiveRows(rows, 'pitfalls');
    const decisionsContent = renderDecisionsFile(rows, 'decisions');
    const pitfallsContent = renderDecisionsFile(rows, 'pitfalls');
    const indexContent = buildIndexContent(activeDecisionRows, activePitfallRows, {
      decisionsFilePath,
      pitfallsFilePath,
    }) + '\n';

    let drift = false;
    let existingDecisions = '';
    let existingPitfalls = '';
    let existingIndex = '';
    try { existingDecisions = fs.readFileSync(decisionsFilePath, 'utf8'); } catch { drift = true; }
    try { existingPitfalls = fs.readFileSync(pitfallsFilePath, 'utf8'); } catch { drift = true; }
    // index.md missing is a drift condition (it should always be present after a render)
    try { existingIndex = fs.readFileSync(indexFilePath, 'utf8'); } catch { drift = true; }

    if (!drift) {
      if (existingDecisions !== decisionsContent) {
        process.stderr.write(`[render-decisions] DRIFT: ${decisionsFilePath}\n`);
        drift = true;
      }
      if (existingPitfalls !== pitfallsContent) {
        process.stderr.write(`[render-decisions] DRIFT: ${pitfallsFilePath}\n`);
        drift = true;
      }
      if (existingIndex !== indexContent) {
        process.stderr.write(`[render-decisions] DRIFT: ${indexFilePath}\n`);
        drift = true;
      }
    }

    process.exit(drift ? 1 : 0);
  }

  // mode === 'render': write atomically under lock
  if (!acquireMkdirLock(lockDir, 30000, 60000)) {
    process.stderr.write(`render-decisions: timeout acquiring lock at ${lockDir}\n`);
    process.exit(1);
  }

  try {
    // Use the lock-free helper — we already hold the lock.
    renderAndWriteAll(worktreePath, rows);
  } finally {
    releaseLock(lockDir);
  }

  process.exit(0);
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
