// scripts/hooks/lib/decisions-index.cjs
// Deterministic project decisions loader for orchestration surfaces.
//
// DESIGN: Orchestration surfaces (resolve.md, plan.md, code-review.md, etc.)
// instruct the orchestrator to strip Deprecated and Superseded decisions entries
// before passing DECISIONS_CONTEXT to consumer agents.
// Having this logic as a pure CJS module gives us:
//   1. Deterministic filtering — not LLM-interpreted, always consistent.
//   2. Real test coverage — tests import this module directly.
//   3. CLI interface — orchestrators invoke as:
//        node scripts/hooks/lib/decisions-index.cjs index {worktree}
//      and capture the output as DECISIONS_CONTEXT (compact index format).
//
// This module is the single source of truth for the D-A filter algorithm
// (strip ## ADR-NNN / ## PF-NNN sections marked Deprecated or Superseded).

'use strict';

const fs = require('fs');
const path = require('path');

/** @typedef {{ id: string, title: string, status: string, area: string|null }} IndexEntry */

/** Statuses recognised by the index formatter — everything else renders as [unknown]. */
const KNOWN_STATUSES = ['Active', 'Deprecated', 'Superseded'];

/**
 * Return true when a markdown section is marked Deprecated or Superseded.
 * This is the single predicate backing the D-A filter algorithm described in
 * the DESIGN comment above — every call-site that needs to strip inactive
 * decisions entries should use this function.
 *
 * @param {string} section - raw text of one ## ADR-NNN / ## PF-NNN section
 * @returns {boolean}
 */
function isDeprecatedOrSuperseded(section) {
  return (
    /- \*\*Status\*\*: Deprecated/.test(section) ||
    /- \*\*Status\*\*: Superseded/.test(section)
  );
}

/**
 * Filter raw decisions.md / pitfalls.md content, removing any ## ADR-NNN: or
 * ## PF-NNN: section whose body contains `- **Status**: Deprecated` or
 * `- **Status**: Superseded`.
 *
 * Section boundary = next ## ADR/PF heading or end of string.
 * Non-decisions content before the first section header (e.g., a file-level
 * title) is preserved in sections[0] and always kept.
 *
 * @param {string} raw - raw content from decisions.md or pitfalls.md
 * @returns {string} filtered content (trimmed), or '' if nothing remains
 */
function filterDecisionsContext(raw) {
  if (!raw.trim()) return '';
  // Split on ADR-NNN / PF-NNN section boundaries using a lookahead so each
  // section includes its own heading.
  const sections = raw.split(/(?=^## (?:ADR|PF)-\d+:)/m);
  const kept = sections.filter(section => {
    const isDecisionsSection = /^## (?:ADR|PF)-\d+:/m.test(section);
    if (!isDecisionsSection) return true; // keep preamble / non-decisions content
    return !isDeprecatedOrSuperseded(section);
  });
  return kept.join('').trim();
}

/**
 * Extract index entries from raw decisions.md / pitfalls.md content.
 * Applies the same D-A filter as filterDecisionsContext before extracting.
 *
 * @param {string} raw - raw content from decisions.md or pitfalls.md
 * @returns {IndexEntry[]} array of index entries (empty if none survive filter)
 */
function extractIndexEntries(raw) {
  if (!raw.trim()) return [];
  const sections = raw.split(/(?=^## (?:ADR|PF)-\d+:)/m);
  /** @type {IndexEntry[]} */
  const entries = [];

  for (const section of sections) {
    const headingMatch = section.match(/^## ((?:ADR|PF)-\d+): (.+)/m);
    if (!headingMatch) continue; // preamble or non-decisions content

    if (isDeprecatedOrSuperseded(section)) continue;

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
    : path.join(worktreePath, '.memory', 'decisions', 'decisions.md');

  const pitfallsFile = opts.pitfallsFile
    ? path.resolve(worktreePath, opts.pitfallsFile)
    : path.join(worktreePath, '.memory', 'decisions', 'pitfalls.md');

  /** @type {IndexEntry[]} */
  let adrEntries = [];
  /** @type {IndexEntry[]} */
  let pfEntries = [];
  let hasDecisionsFile = false;
  let hasPitfallsFile = false;

  try {
    const raw = fs.readFileSync(decisionsFile, 'utf8');
    hasDecisionsFile = true;
    adrEntries = extractIndexEntries(raw);
  } catch {
    // Skip silently if absent
  }

  try {
    const raw = fs.readFileSync(pitfallsFile, 'utf8');
    hasPitfallsFile = true;
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

module.exports = { filterDecisionsContext, loadDecisionsIndex, extractIndexEntries };
