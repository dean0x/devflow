// src/assets/scripts/hooks/lib/decisions-format.cjs
//
// Shared pure formatting helpers for decisions.md and pitfalls.md output.
//
// DESIGN: Shared pure formatting helpers used by assign-anchor (via json-helper.cjs)
// and render-decisions.cjs so both share the EXACT same format functions. This is
// the single source of truth for the byte-compat output strings — any drift here
// will break the renderer/session-start-context TL;DR parser.
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
// Field parsing: both formatters use segmentDetails() which splits on ';' and
// anchors key detection to the START of each trimmed segment — so 'reissue:'
// does NOT match 'issue:', and embedded semicolons inside a field value are
// preserved (the segment is treated as a continuation of the prior field).
//
// Consumers of these strings:
//   - session-start-context (line 57): reads TL;DR comment via sed
//   - devflow:apply-decisions: reads ## ADR-NNN: / ## PF-NNN: headings
//   - decisions-usage-scan: scans /(ADR|PF)-\d{3}/ anchors
//   - buildIndexContent (below): parses ## heading, - **Status**:, - **Area**: lines from rendered blocks

'use strict';

/**
 * Segment-parse a details string into key→value pairs using anchored key
 * detection.  Splits on ';' and checks whether each trimmed segment begins
 * with one of the recognised keys (e.g. 'area:').  If a segment does NOT
 * begin with a recognised key it is treated as a continuation of the
 * previous field — this preserves embedded semicolons inside a field value.
 *
 * Key detection is anchored to the START of the trimmed segment so that
 * 'reissue:' does NOT match 'issue:', 'precontext:' does NOT match
 * 'context:', etc.  All matching is case-insensitive.
 *
 * Newlines inside values are collapsed to a single space so the formatted
 * output lines remain single-line.
 *
 * D001 (details-parsing): This is the SINGLE parser for structured details
 * strings — both formatDecisionBody and formatPitfallBody delegate here.
 * applies PF-042 (delimiter-regex truncation).
 *
 * @param {string} detailsStr - raw details string from an observation row
 * @param {readonly string[]} keys - recognised field names in priority order
 * @returns {Record<string, string>} map of field name → extracted value
 */
function segmentDetails(detailsStr, keys) {
  /** @type {Record<string, string>} */
  const result = {};
  if (!detailsStr) return result;

  const segments = detailsStr.split(';');
  let currentKey = null;

  for (const seg of segments) {
    const trimmed = seg.trim();
    let matched = false;

    for (const key of keys) {
      const prefix = key + ':';
      // Anchored: does the trimmed segment START with '<key>:'?
      // Lower-casing both sides gives case-insensitive matching without regex.
      if (trimmed.toLowerCase().startsWith(prefix)) {
        currentKey = key;
        result[key] = trimmed.slice(prefix.length).trim().replace(/\n/g, ' ');
        matched = true;
        break;
      }
    }

    if (!matched && currentKey !== null) {
      // Continuation of the previous field's value (embedded semicolons)
      result[currentKey] = result[currentKey] + '; ' + trimmed.replace(/\n/g, ' ');
    }
  }

  return result;
}

/** Recognised field keys for decision entries. */
const ADR_KEYS = /** @type {const} */ (['context', 'decision', 'rationale']);

/** Recognised field keys for pitfall entries. */
const PF_KEYS = /** @type {const} */ (['area', 'issue', 'impact', 'resolution']);

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
  // D5: render purity — never clock-read inside a formatter.  Absent date
  // renders as an empty string so the output is deterministic and idempotent.
  const artDate = row.date || '';
  const anchorId = row.anchor_id || '';
  const pattern = row.pattern || '';

  const fields = segmentDetails(detailsStr, ADR_KEYS);

  return (
    `\n## ${anchorId}: ${pattern}\n\n` +
    `- **Date**: ${artDate}\n` +
    `- **Status**: Accepted\n` +
    `- **Context**: ${fields.context || detailsStr}\n` +
    `- **Decision**: ${fields.decision || pattern}\n` +
    `- **Consequences**: ${fields.rationale || ''}\n` +
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

  const fields = segmentDetails(detailsStr, PF_KEYS);

  return (
    `\n## ${anchorId}: ${pattern}\n\n` +
    `- **Area**: ${fields.area || detailsStr}\n` +
    `- **Issue**: ${fields.issue || detailsStr}\n` +
    `- **Impact**: ${fields.impact || ''}\n` +
    `- **Resolution**: ${fields.resolution || ''}\n` +
    `- **Status**: Active\n` +
    `- **Source**: self-learning:${obsId}\n`
  );
}

/**
 * Project a full observation row into the canonical committed-ledger shape.
 * Whitelists ONLY the fields that belong in decisions-ledger.jsonl:
 *   { id, type, pattern, details, anchor_id, decisions_status, date?, raw_body?, amendments? }
 *
 * All observation-lifecycle fields (evidence, confidence, quality_ok, count,
 * first_seen, last_seen, artifact_path, status, …) are intentionally excluded
 * from the committed ledger — they are log-only state.
 *
 * D001: The projected shape is a DISTINCT COMMITTED shape, not a full obs copy.
 * This function is the single source of truth for that projection so both the
 * add-path (assign-anchor) and the migration's preserve-verbatim path produce
 * byte-identical committed shapes. applies ADR-008.
 *
 * @param {object} obs - Full observation row from decisions-log.jsonl
 * @param {{ anchorId: string, status: string, date?: string }} opts
 * @returns {object} Canonical ledger row
 */
function toLedgerRow(obs, { anchorId, status, date }) {
  /** @type {Record<string, unknown>} */
  const row = {
    id: obs.id,
    type: obs.type,
    pattern: obs.pattern,
    details: obs.details,
    anchor_id: anchorId,
    decisions_status: status,
  };
  // Optional fields — include only when present in the observation or explicitly provided
  if (date !== undefined) row.date = date;
  if (obs.raw_body !== undefined) row.raw_body = obs.raw_body;
  if (obs.amendments !== undefined) row.amendments = obs.amendments;
  return row;
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
  // Byte-compat: an empty key list must render `Key: -->` (single space) so the
  // empty-corpus render is byte-identical to initDecisionsContent's header. A
  // trailing space before `-->` would diverge from the documented contract and
  // break the assertion that the render is the SOLE format authority.
  if (!keyStr) return `<!-- TL;DR: ${count} ${kind}. Key: -->`;
  return `<!-- TL;DR: ${count} ${kind}. Key: ${keyStr} -->`;
}

// ---------------------------------------------------------------------------
// Index content builder
// ---------------------------------------------------------------------------

/**
 * Statuses recognised by the index formatter — everything else renders as
 * [unknown]. Only Active (pitfalls) and Accepted (decisions) appear in
 * rendered .md files; the renderer excludes Deprecated/Superseded/Retired
 * before writing.
 */
const INDEX_KNOWN_STATUSES = ['Active', 'Accepted'];

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
 * ADR entries have area: null, so the area suffix is naturally omitted.
 *
 * @param {{ id: string, title: string, status: string|null, area: string|null }} entry
 * @returns {string}
 */
function formatIndexEntryLine(entry) {
  const title = truncate(entry.title, 60);
  const tag = entry.status && INDEX_KNOWN_STATUSES.includes(entry.status) ? `[${entry.status}]` : '[unknown]';
  const areaSuffix = entry.area ? `  —  ${truncate(entry.area, 80)}` : '';
  return `  ${entry.id}  ${title}  ${tag}${areaSuffix}`;
}

/**
 * Build the compact index content from in-memory active ledger rows.
 * Empty corpus (both arrays empty) → '(none)'.
 * No trailing newline (caller adds '\n' before writing).
 *
 * Strategy: for each row, obtain its rendered block (truthy raw_body || format*Body(row)),
 * then extract heading/Status/Area with the same regexes.
 * This preserves byte-compat for migrated rows that carry Area/Status only in raw_body.
 * Note: raw_body === "" is treated as absent (falsy); both predicates align with the
 * truthy check in renderDecisionsFile so index and body files never drift on this edge.
 *
 * @param {object[]} activeDecisionRows - Active decision rows (type='decision', sorted by anchor)
 * @param {object[]} activePitfallRows - Active pitfall rows (type='pitfall', sorted by anchor)
 * @param {{ decisionsFilePath: string, pitfallsFilePath: string }} opts - absolute file paths for footer
 * @returns {string} compact index string, or '(none)'
 */
function buildIndexContent(activeDecisionRows, activePitfallRows, { decisionsFilePath, pitfallsFilePath }) {
  /**
   * Extract an index entry from a rendered block string.
   * @param {string} block
   * @returns {{ id: string, title: string, status: string|null, area: string|null }|null}
   */
  function extractEntryFromBlock(block) {
    const headingMatch = block.match(/^## ((?:ADR|PF)-\d+): (.+)/m);
    if (!headingMatch) return null;
    const id = headingMatch[1];
    const rawTitle = headingMatch[2].trim();
    const statusMatch = block.match(/- \*\*Status\*\*: (.+)/);
    const status = statusMatch ? statusMatch[1].trim() : null;
    const areaMatch = block.match(/- \*\*Area\*\*: (.+)/);
    const area = areaMatch ? areaMatch[1].trim() : null;
    return { id, title: rawTitle, status, area };
  }

  /** @type {Array<{ id: string, title: string, status: string|null, area: string|null }>} */
  const adrEntries = [];
  for (const row of activeDecisionRows) {
    const block = row.raw_body ? row.raw_body : formatDecisionBody(row);
    const entry = extractEntryFromBlock(block);
    if (entry) adrEntries.push(entry);
  }

  /** @type {Array<{ id: string, title: string, status: string|null, area: string|null }>} */
  const pfEntries = [];
  for (const row of activePitfallRows) {
    const block = row.raw_body ? row.raw_body : formatPitfallBody(row);
    const entry = extractEntryFromBlock(block);
    if (entry) pfEntries.push(entry);
  }

  if (adrEntries.length === 0 && pfEntries.length === 0) return '(none)';

  const blocks = [];

  if (adrEntries.length > 0) {
    const lines = [`Decisions (${adrEntries.length}):`];
    for (const entry of adrEntries) {
      lines.push(formatIndexEntryLine(entry));
    }
    blocks.push(lines.join('\n'));
  }

  if (pfEntries.length > 0) {
    const lines = [`Pitfalls (${pfEntries.length}):`];
    for (const entry of pfEntries) {
      lines.push(formatIndexEntryLine(entry));
    }
    blocks.push(lines.join('\n'));
  }

  // Footer: explain how to read full bodies
  const footerLines = [];
  if (adrEntries.length > 0) {
    footerLines.push(`ADR-NNN entries live in ${decisionsFilePath}`);
  }
  if (pfEntries.length > 0) {
    footerLines.push(`PF-NNN  entries live in ${pitfallsFilePath}`);
  }
  footerLines.push(
    'Read the relevant file and locate the matching `## ADR-NNN:` or `## PF-NNN:` heading for the full body.'
  );
  blocks.push(footerLines.join('\n'));

  return blocks.join('\n\n');
}

module.exports = {
  initDecisionsContent,
  segmentDetails,
  formatDecisionBody,
  formatPitfallBody,
  buildTldrLine,
  toLedgerRow,
  buildIndexContent,
};
