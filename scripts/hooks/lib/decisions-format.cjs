// scripts/hooks/lib/decisions-format.cjs
//
// Shared pure formatting helpers for decisions.md and pitfalls.md output.
//
// DESIGN: Extracted from json-helper.cjs so that both decisions-append (via
// json-helper.cjs) and the new render-decisions.cjs share the EXACT same format
// functions. This is the single source of truth for the byte-compat output strings
// — any drift here will break the renderer/session-start-context TL;DR parser.
//
// BYTE-COMPAT CONTRACT (must not change without updating all consumers):
//   Decision heading:  \n## {anchorId}: {title}\n
//   Decision fields:   - **Date**: YYYY-MM-DD\n
//                      - **Status**: Accepted\n
//                      - **Context**: ...\n
//                      - **Decision**: ...\n
//                      - **Consequences**: ...\n
//                      - **Source**: self-learning:{obsId}\n
//   Pitfall heading:   \n## {anchorId}: {title}\n
//   Pitfall fields:    - **Area**: ...\n
//                      - **Issue**: ...\n
//                      - **Impact**: ...\n
//                      - **Resolution**: ...\n
//                      - **Status**: Active\n
//                      - **Source**: self-learning:{obsId}\n
//   TL;DR line:        <!-- TL;DR: N {decisions|pitfalls}. Key: id1, id2 -->
//   File headers:
//     decisions.md: "<!-- TL;DR: 0 decisions. Key: -->\n# Architectural Decisions\n\nAppend-only. Status changes allowed; deletions prohibited.\n"
//     pitfalls.md:  "<!-- TL;DR: 0 pitfalls. Key: -->\n# Known Pitfalls\n\nArea-specific gotchas, fragile areas, and past bugs.\n"
//
// Consumers of these strings:
//   - session-start-context (line 57): reads TL;DR comment via sed
//   - devflow:apply-decisions: reads ## ADR-NNN: / ## PF-NNN: headings
//   - decisions-usage-scan: scans /(ADR|PF)-\d{3}/ anchors
//   - decisions-index.cjs: parses ## heading, - **Status**:, - **Area**: lines

'use strict';

/**
 * Return the initial header content for a new decisions or pitfalls file.
 * Byte-identical to the initDecisionsContent function in json-helper.cjs.
 *
 * @param {'decision'|'pitfall'} kind
 * @returns {string}
 */
function initDecisionsContent(kind) {
  return kind === 'decision'
    ? '<!-- TL;DR: 0 decisions. Key: -->\n# Architectural Decisions\n\nAppend-only. Status changes allowed; deletions prohibited.\n'
    : '<!-- TL;DR: 0 pitfalls. Key: -->\n# Known Pitfalls\n\nArea-specific gotchas, fragile areas, and past bugs.\n';
}

/**
 * Format a decision entry block from structured details.
 * Used when `raw_body` is absent (new entries authored post-migration).
 * Returns the block starting with a leading newline so appends just work.
 *
 * @param {object} row - Ledger row with at minimum: anchor_id, pattern, id, details, date
 * @returns {string}
 */
function formatDecisionBody(row) {
  const detailsStr = row.details || '';
  const obsId = row.id || 'unknown';
  const artDate = row.date || new Date().toISOString().slice(0, 10);
  const anchorId = row.anchor_id || '';
  const pattern = row.pattern || '';

  const contextM = detailsStr.match(/context:\s*([^;]+)/i);
  const decisionM = detailsStr.match(/decision:\s*([^;]+)/i);
  const rationaleM = detailsStr.match(/rationale:\s*([^;]+)/i);

  return (
    `\n## ${anchorId}: ${pattern}\n\n` +
    `- **Date**: ${artDate}\n` +
    `- **Status**: Accepted\n` +
    `- **Context**: ${(contextM || [])[1] || detailsStr}\n` +
    `- **Decision**: ${(decisionM || [])[1] || pattern}\n` +
    `- **Consequences**: ${(rationaleM || [])[1] || ''}\n` +
    `- **Source**: self-learning:${obsId}\n`
  );
}

/**
 * Format a pitfall entry block from structured details.
 * Used when `raw_body` is absent (new entries authored post-migration).
 * Returns the block starting with a leading newline so appends just work.
 *
 * @param {object} row - Ledger row with at minimum: anchor_id, pattern, id, details
 * @returns {string}
 */
function formatPitfallBody(row) {
  const detailsStr = row.details || '';
  const obsId = row.id || 'unknown';
  const anchorId = row.anchor_id || '';
  const pattern = row.pattern || '';

  const areaM = detailsStr.match(/area:\s*([^;]+)/i);
  const issueM = detailsStr.match(/issue:\s*([^;]+)/i);
  const impactM = detailsStr.match(/impact:\s*([^;]+)/i);
  const resM = detailsStr.match(/resolution:\s*([^;]+)/i);

  return (
    `\n## ${anchorId}: ${pattern}\n\n` +
    `- **Area**: ${(areaM || [])[1] || detailsStr}\n` +
    `- **Issue**: ${(issueM || [])[1] || detailsStr}\n` +
    `- **Impact**: ${(impactM || [])[1] || ''}\n` +
    `- **Resolution**: ${(resM || [])[1] || ''}\n` +
    `- **Status**: Active\n` +
    `- **Source**: self-learning:${obsId}\n`
  );
}

/**
 * Build the TL;DR comment line for a rendered decisions or pitfalls file.
 * Format: `<!-- TL;DR: N {decisions|pitfalls}. Key: id1, id2 -->`
 *
 * Key is the last 5 anchor IDs from the provided active rows (sorted by
 * numeric anchor ascending — same order as the rendered file).
 * When rows is empty, Key is empty string (no trailing space before -->).
 *
 * @param {'decisions'|'pitfalls'} kind - label used in the comment
 * @param {object[]} rows - active anchored rows (already filtered + sorted)
 * @returns {string} complete TL;DR comment line (no trailing newline)
 */
function buildTldrLine(kind, rows) {
  const count = rows.length;
  const last5 = rows.slice(-5).map(r => r.anchor_id);
  const keyStr = last5.join(', ');
  return `<!-- TL;DR: ${count} ${kind}. Key: ${keyStr} -->`;
}

module.exports = {
  initDecisionsContent,
  formatDecisionBody,
  formatPitfallBody,
  buildTldrLine,
};
