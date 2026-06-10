// scripts/hooks/lib/decisions-index.cjs
// Deterministic project decisions loader for orchestration surfaces.
//
// DESIGN: Orchestration surfaces (resolve.md, plan.md, code-review.md, etc.)
// instruct the orchestrator to pass DECISIONS_CONTEXT to consumer agents.
// Having this logic as a pure CJS module gives us:
//   1. Deterministic parsing — not LLM-interpreted, always consistent.
//   2. Real test coverage — tests import this module directly.
//   3. CLI interface — orchestrators invoke as:
//        node scripts/hooks/lib/decisions-index.cjs index {worktree}
//      and capture the output as DECISIONS_CONTEXT (compact index format).
//
// NOTE: Deprecated/Superseded/Retired entries are excluded at render time
// (render-decisions.cjs). The .md files this module parses contain only
// active entries — no in-memory filtering needed here.

'use strict';

const fs = require('fs');
const path = require('path');
const { getDecisionsFilePath, getPitfallsFilePath } = require('./project-paths.cjs');

/** @typedef {{ id: string, title: string, status: string, area: string|null }} IndexEntry */

/**
 * Statuses recognised by the index formatter — everything else renders as
 * [unknown].  Post-render the .md files only ever contain active entries
 * (Accepted for decisions, Active for pitfalls), so this list no longer needs
 * Deprecated / Superseded — they are hidden by the renderer before writing.
 */
const KNOWN_STATUSES = ['Active', 'Accepted'];

/**
 * Extract index entries from raw decisions.md / pitfalls.md content.
 * The .md files are a pure render of the active ledger — no in-memory
 * filtering is needed; all sections present are already active entries.
 *
 * @param {string} raw - raw content from decisions.md or pitfalls.md
 * @returns {IndexEntry[]} array of index entries
 */
function extractIndexEntries(raw) {
  if (!raw.trim()) return [];
  const sections = raw.split(/(?=^## (?:ADR|PF)-\d+:)/m);
  /** @type {IndexEntry[]} */
  const entries = [];

  for (const section of sections) {
    const headingMatch = section.match(/^## ((?:ADR|PF)-\d+): (.+)/m);
    if (!headingMatch) continue; // preamble or non-decisions content

    const id = headingMatch[1];
    const rawTitle = headingMatch[2].trim();

    // Extract status line
    const statusMatch = section.match(/- \*\*Status\*\*: (.+)/);
    const status = statusMatch ? statusMatch[1].trim() : null;

    // Extract area line (pitfalls only, optional)
    const areaMatch = section.match(/- \*\*Area\*\*: (.+)/);
    const area = areaMatch ? areaMatch[1].trim() : null;

    entries.push({ id, title: rawTitle, status, area });
  }

  return entries;
}

/**
 * Truncate a string to maxLen characters, appending '…' if truncated.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

/**
 * Format a single index line for an ADR or PF entry.
 * ADR entries have `area: null`, so the area suffix is naturally omitted.
 *
 * @param {IndexEntry} entry
 * @returns {string}
 */
function formatEntryLine(entry) {
  const title = truncate(entry.title, 60);
  const tag = entry.status && KNOWN_STATUSES.includes(entry.status) ? `[${entry.status}]` : '[unknown]';
  const areaSuffix = entry.area ? `  —  ${truncate(entry.area, 80)}` : '';
  return `  ${entry.id}  ${title}  ${tag}${areaSuffix}`;
}

/**
 * Load a compact index of project decisions entries for a given worktree.
 *
 * Returns a compact index listing each ADR/PF entry with ID, truncated
 * title, status, and (for pitfalls) area. Includes a footer describing how to
 * Read full bodies on demand. Returns '(none)' when both files are absent or
 * their filtered content is empty.
 *
 * @param {string} worktreePath - absolute path to the worktree root
 * @param {{ decisionsFile?: string, pitfallsFile?: string }} [opts] - override
 *   file paths for testing (relative paths resolved against worktreePath)
 * @returns {string} compact index string, or '(none)'
 */
function loadDecisionsIndex(worktreePath, opts = {}) {
  const decisionsFile = opts.decisionsFile
    ? path.resolve(worktreePath, opts.decisionsFile)
    : getDecisionsFilePath(worktreePath);

  const pitfallsFile = opts.pitfallsFile
    ? path.resolve(worktreePath, opts.pitfallsFile)
    : getPitfallsFilePath(worktreePath);

  /** @type {IndexEntry[]} */
  let adrEntries = [];
  /** @type {IndexEntry[]} */
  let pfEntries = [];

  try {
    const raw = fs.readFileSync(decisionsFile, 'utf8');
    adrEntries = extractIndexEntries(raw);
  } catch {
    // Skip silently if absent
  }

  try {
    const raw = fs.readFileSync(pitfallsFile, 'utf8');
    pfEntries = extractIndexEntries(raw);
  } catch {
    // Skip silently if absent
  }

  if (adrEntries.length === 0 && pfEntries.length === 0) return '(none)';

  const blocks = [];

  if (adrEntries.length > 0) {
    const lines = [`Decisions (${adrEntries.length}):`];
    for (const entry of adrEntries) {
      lines.push(formatEntryLine(entry));
    }
    blocks.push(lines.join('\n'));
  }

  if (pfEntries.length > 0) {
    const lines = [`Pitfalls (${pfEntries.length}):`];
    for (const entry of pfEntries) {
      lines.push(formatEntryLine(entry));
    }
    blocks.push(lines.join('\n'));
  }

  // Footer: explain how to read full bodies
  const footerLines = [];
  if (adrEntries.length > 0) {
    footerLines.push(
      `ADR-NNN entries live in ${decisionsFile}`
    );
  }
  if (pfEntries.length > 0) {
    footerLines.push(
      `PF-NNN  entries live in ${pitfallsFile}`
    );
  }
  footerLines.push(
    'Read the relevant file and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading for the full body.'
  );

  blocks.push(footerLines.join('\n'));

  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// CLI interface
//
// Usage:
//   node decisions-index.cjs index <worktree>  → compact index
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);

  if (argv[0] !== 'index' || !argv[1]) {
    process.stderr.write(
      'Usage: node decisions-index.cjs index <worktree-path>\n'
    );
    process.exit(1);
  }

  const worktreePath = path.resolve(argv[1]);
  const result = loadDecisionsIndex(worktreePath);
  if (result !== '(none)') {
    const adrCount = (result.match(/^\s+ADR-\d+/gm) || []).length;
    const pfCount = (result.match(/^\s+PF-\d+/gm) || []).length;
    const entries = adrCount + pfCount;
    process.stderr.write(
      `[decisions-index] mode=index worktree=${worktreePath} entries=${entries}\n`
    );
  }
  process.stdout.write(result + '\n');
  process.exit(0);
}

module.exports = { loadDecisionsIndex, extractIndexEntries };
