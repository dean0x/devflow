#!/usr/bin/env node
// scripts/hooks/lib/render-decisions.cjs
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
//   - decisions_status: undefined|'Accepted'|'Active' → included
//     'Deprecated'|'Superseded'|'Retired' → excluded
//
// Row shape: see LearningObservation in src/cli/utils/observations.ts.
// Ledger file: .devflow/decisions/decisions-ledger.jsonl (COMMITTED, anchored rows only).
// If absent, treat as empty corpus.
//
// Byte-compat: formatDecisionBody / formatPitfallBody / buildTldrLine /
// initDecisionsContent — all from decisions-format.cjs (single source of truth).

'use strict';

const fs = require('fs');
const path = require('path');

const {
  initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Statuses that indicate an anchored entry should be HIDDEN from the render. */
const INACTIVE_STATUSES = new Set(['Deprecated', 'Superseded', 'Retired']);

/** Ledger filename relative to .devflow/decisions/ */
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
 * Determine whether a row is "active" for render purposes.
 * Active = decisions_status is undefined OR is one of 'Accepted'/'Active'.
 *
 * @param {object} row
 * @returns {boolean}
 */
function isActive(row) {
  if (!row.decisions_status) return true;
  return !INACTIVE_STATUSES.has(row.decisions_status);
}

/**
 * Extract the numeric suffix from an anchor_id like "ADR-016" or "PF-007".
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
 * Build the full file content from already-filtered + sorted active rows.
 * Internal helper — callers that have already run selectActiveRows can pass
 * the result here directly to avoid re-filtering the ledger.
 *
 * Per-row content:
 *   - If row.raw_body is truthy → emit verbatim (migrated entries)
 *   - Otherwise → formatDecisionBody / formatPitfallBody from details
 *
 * @param {object[]} activeRows - already-filtered + sorted active rows
 * @param {'decisions'|'pitfalls'} kind
 * @returns {string} complete file content
 */
function renderBodyFromActive(activeRows, kind) {
  // Build per-row blocks
  const blocks = activeRows.map(row => {
    if (row.raw_body) {
      // Migrated entry: emit verbatim. raw_body must start with \n## so
      // it fits seamlessly after the header preamble.
      return row.raw_body;
    }
    return kind === 'decisions'
      ? formatDecisionBody(row)
      : formatPitfallBody(row);
  });

  // Build TL;DR line (uses active + sorted rows so last-5 are stable)
  const tldr = buildTldrLine(kind, activeRows);

  // Build header: replace placeholder TL;DR in the init content with the real one.
  // initDecisionsContent returns "<!-- TL;DR: 0 {kind}. Key: -->\n..." so we
  // replace the TL;DR line at position 0.
  const initKind = kind === 'decisions' ? 'decision' : 'pitfall';
  const headerWithPlaceholder = initDecisionsContent(initKind);
  // Replace only the first line (the TL;DR comment)
  const header = headerWithPlaceholder.replace(/^<!-- TL;DR:[^\n]*-->/, tldr);

  return header + blocks.join('');
}

/**
 * Pure render function. Produces the full content of a decisions.md or
 * pitfalls.md file from the given ledger rows.
 *
 * Filtering:
 *   - row.type must match kind ('decision' → decisions.md, 'pitfall' → pitfalls.md)
 *   - row.anchor_id must be set
 *   - row must be active (decisions_status not in INACTIVE_STATUSES)
 *
 * Output structure:
 *   TL;DR line (line 1)
 *   File header body (title + preamble)
 *   Per-row blocks (sorted by numeric anchor ASC)
 *   (no trailing newline beyond what the blocks naturally include)
 *
 * Idempotent and clock-free: no timestamps in output.
 *
 * @param {object[]} rows - all rows from the ledger (unfiltered)
 * @param {'decisions'|'pitfalls'} kind
 * @returns {string} complete file content
 */
function renderDecisionsFile(rows, kind) {
  return renderBodyFromActive(selectActiveRows(rows, kind), kind);
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
 * them atomically. Does NOT acquire any lock — callers (assign-anchor, retire-anchor)
 * must already hold .decisions.lock. The standalone `render` CLI takes the lock
 * before calling this function.
 *
 * Creates the decisionsDir if it does not exist.
 *
 * @param {string} worktreePath - Absolute path to the worktree root.
 * @param {object[]} rows - All rows from the ledger (unfiltered).
 */
function renderAndWriteAll(worktreePath, rows) {
  const decisionsDir = path.join(worktreePath, '.devflow', 'decisions');
  fs.mkdirSync(decisionsDir, { recursive: true });

  const decisionsFilePath = getDecisionsFilePath(worktreePath);
  const pitfallsFilePath = getPitfallsFilePath(worktreePath);
  const indexFilePath = getDecisionsIndexPath(worktreePath);

  // Hoist active-row selection: computed once per kind, reused for both the
  // body render and the index build — avoids two redundant selectActiveRows passes.
  const activeDecisionRows = selectActiveRows(rows, 'decisions');
  const activePitfallRows = selectActiveRows(rows, 'pitfalls');

  const decisionsContent = renderBodyFromActive(activeDecisionRows, 'decisions');
  const pitfallsContent = renderBodyFromActive(activePitfallRows, 'pitfalls');

  // Write body files first; index last. On a crash between body writes and the
  // index write: on the FIRST render the index is absent (reader falls back to
  // (none)); on a RE-render the index is stale — one generation behind the new
  // body files — never corrupt. Both cases are benign and self-heal on the next
  // successful render.
  writeAtomic(decisionsFilePath, decisionsContent);
  writeAtomic(pitfallsFilePath, pitfallsContent);

  // Build and write compact index (write-time artifact; consumed via plain Read)
  // Reuses the pre-computed active rows — no additional selectActiveRows pass.
  const indexContent = buildIndexContent(activeDecisionRows, activePitfallRows, {
    decisionsFilePath,
    pitfallsFilePath,
  });
  writeAtomic(indexFilePath, indexContent + '\n');

  process.stderr.write(
    `[render-decisions] wrote decisions.md (${decisionsContent.length}B) + pitfalls.md (${pitfallsContent.length}B) + index.md (${indexContent.length}B)\n`
  );
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    process.stderr.write(
      'Usage:\n' +
      '  render-decisions.cjs render <worktree>          Write both .md files\n' +
      '  render-decisions.cjs --check <worktree>         Diff without writing; exit 1 on drift\n'
    );
    process.exit(1);
  }

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
    process.stderr.write(
      'Usage:\n' +
      '  render-decisions.cjs render <worktree>          Write both .md files\n' +
      '  render-decisions.cjs --check <worktree>         Diff without writing; exit 1 on drift\n'
    );
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

  const decisionsDir = path.join(worktreePath, '.devflow', 'decisions');
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
    const decisionsContent = renderBodyFromActive(activeDecisionRows, 'decisions');
    const pitfallsContent = renderBodyFromActive(activePitfallRows, 'pitfalls');
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
  parseLedger,
  isActive,
  anchorNumeric,
};
