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
} = require('./decisions-format.cjs');

const {
  getDecisionsFilePath,
  getPitfallsFilePath,
  getDecisionsLockDir,
} = require('./project-paths.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Statuses that indicate an anchored entry should be HIDDEN from the render. */
const INACTIVE_STATUSES = new Set(['Deprecated', 'Superseded', 'Retired']);

/** Ledger filename relative to .devflow/decisions/ */
const LEDGER_FILENAME = 'decisions-ledger.jsonl';

// ---------------------------------------------------------------------------
// Locking helpers (reused from json-helper.cjs pattern)
// ---------------------------------------------------------------------------

/**
 * Acquire a mkdir-based lock. Returns true on success, false on timeout.
 * Same semantics as acquireMkdirLock in json-helper.cjs.
 *
 * @param {string} lockDir
 * @param {number} [timeoutMs=30000]
 * @param {number} [staleMs=60000]
 * @returns {boolean}
 */
function acquireMkdirLock(lockDir, timeoutMs = 30000, staleMs = 60000) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockDir);
        const age = Date.now() - stat.mtimeMs;
        if (age > staleMs) {
          try { fs.rmdirSync(lockDir); } catch { /* already gone */ }
          continue;
        }
      } catch { /* lock gone between check and stat */ }
      if (Date.now() - start >= timeoutMs) return false;
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      } catch {
        const end = Date.now() + 50;
        while (Date.now() < end) { /* spin */ }
      }
    }
  }
}

function releaseLock(lockDir) {
  try { fs.rmdirSync(lockDir); } catch { /* already released */ }
}

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
 * Pure render function. Produces the full content of a decisions.md or
 * pitfalls.md file from the given ledger rows.
 *
 * Filtering:
 *   - row.type must match kind ('decision' → decisions.md, 'pitfall' → pitfalls.md)
 *   - row.anchor_id must be set
 *   - row must be active (decisions_status not in INACTIVE_STATUSES)
 *
 * Per-row content:
 *   - If row.raw_body is present → emit verbatim (migrated entries)
 *   - Otherwise → formatDecisionBody / formatPitfallBody from details
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
  const type = kind === 'decisions' ? 'decision' : 'pitfall';

  // Filter and sort
  const active = rows
    .filter(r => r.type === type && r.anchor_id && isActive(r))
    .sort((a, b) => anchorNumeric(a.anchor_id) - anchorNumeric(b.anchor_id));

  // Build per-row blocks
  const blocks = active.map(row => {
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
  const tldr = buildTldrLine(kind, active);

  // Build header: replace placeholder TL;DR in the init content with the real one.
  // initDecisionsContent returns "<!-- TL;DR: 0 {kind}. Key: -->\n..." so we
  // replace the TL;DR line at position 0.
  const initKind = kind === 'decisions' ? 'decision' : 'pitfall';
  const headerWithPlaceholder = initDecisionsContent(initKind);
  // Replace only the first line (the TL;DR comment)
  const header = headerWithPlaceholder.replace(/^<!-- TL;DR:[^\n]*-->/, tldr);

  return header + blocks.join('');
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

  const decisionsContent = renderDecisionsFile(rows, 'decisions');
  const pitfallsContent = renderDecisionsFile(rows, 'pitfalls');

  writeAtomic(decisionsFilePath, decisionsContent);
  writeAtomic(pitfallsFilePath, pitfallsContent);

  process.stderr.write(
    `[render-decisions] wrote decisions.md (${decisionsContent.length}B) + pitfalls.md (${pitfallsContent.length}B)\n`
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

  const decisionsDir = path.join(worktreePath, '.devflow', 'decisions');
  const ledgerPath = path.join(decisionsDir, LEDGER_FILENAME);
  const decisionsFilePath = getDecisionsFilePath(worktreePath);
  const pitfallsFilePath = getPitfallsFilePath(worktreePath);
  const lockDir = getDecisionsLockDir(worktreePath);

  // Ensure decisionsDir exists (needed before lock acquisition and file reads)
  fs.mkdirSync(decisionsDir, { recursive: true });

  // Read ledger (empty corpus if absent)
  const rows = parseLedger(ledgerPath);

  // Render both files in memory
  const decisionsContent = renderDecisionsFile(rows, 'decisions');
  const pitfallsContent = renderDecisionsFile(rows, 'pitfalls');

  if (mode === 'check') {
    // Compare in-memory render against on-disk content. Exit non-zero on drift.
    let drift = false;
    let existingDecisions = '';
    let existingPitfalls = '';
    try { existingDecisions = fs.readFileSync(decisionsFilePath, 'utf8'); } catch { drift = true; }
    try { existingPitfalls = fs.readFileSync(pitfallsFilePath, 'utf8'); } catch { drift = true; }

    if (!drift) {
      if (existingDecisions !== decisionsContent) {
        process.stderr.write(`[render-decisions] DRIFT: ${decisionsFilePath}\n`);
        drift = true;
      }
      if (existingPitfalls !== pitfallsContent) {
        process.stderr.write(`[render-decisions] DRIFT: ${pitfallsFilePath}\n`);
        drift = true;
      }
    }

    if (drift) {
      process.exit(1);
    }
    process.exit(0);
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
  parseLedger,
  isActive,
  anchorNumeric,
};
