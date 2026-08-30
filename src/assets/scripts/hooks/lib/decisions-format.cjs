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
//   Decision fields:   - **Date**: YYYY-MM-DD\n          (empty string when absent — D5)
//                      - **Status**: Accepted\n
//                      - **Context**: ...\n
//                      - **Decision**: ...\n
//                      - **Consequences**: ...\n
//                      - **Source**: self-learning:{obsId}\n
//                      - **Amendments**: text1; text2\n   (omitted when absent or empty)
//   Pitfall heading:   \n## {anchorId}: {title}\n
//   Pitfall fields:    - **Area**: ...\n
//                      - **Issue**: ...\n
//                      - **Impact**: ...\n
//                      - **Resolution**: ...\n
//                      - **Status**: Active\n
//                      - **Source**: self-learning:{obsId}\n
//                      - **Amendments**: text1; text2\n   (omitted when absent or empty)
//   TL;DR line:        <!-- TL;DR: N {decisions|pitfalls}. Key: id1, id2 -->
//   File headers:
//     decisions.md: "<!-- TL;DR: 0 decisions. Key: -->\n# Architectural Decisions\n\nAppend-only. Status changes allowed; deletions prohibited.\n"
//     pitfalls.md:  "<!-- TL;DR: 0 pitfalls. Key: -->\n# Known Pitfalls\n\nArea-specific gotchas, fragile areas, and past bugs.\n"
//
// Field parsing: both formatters use segmentDetails() which splits on ';' and
// anchors key detection to the START of each trimmed segment — so 'reissue:'
// does NOT match 'issue:', and embedded semicolons inside a field value are
// preserved (the segment is treated as a continuation of the prior field).
// Recovery pass: for any key the anchored pass left unset, an unanchored
// regex ('(?:^|[.;\\s])key:\\s*([^;]+)') is tried against the full details
// string — handles legacy corpus rows written before the ';'-delimited grammar
// was documented, where fields are separated by '. ' rather than ';' (applies
// PF-044). The recovery pass never overrides an anchored match.
// LineTerminators (\r, \n, \u2028, \u2029) in field values are collapsed to a
// single space at all five collapse sites (segmentDetails ×2, amendmentToString
// ×3) — guards the single-line field contract against the full JS LineTerminator
// set, not just \n.
//
// Index extraction: extractEntryFromBlock uses line-anchored regexes
// (/^- \*\*Status\*\*:/m, /^- \*\*Area\*\*:/m) to guard against amendment
// text that accidentally contains those patterns as substrings.
//
// Amendments shape: the row's `amendments` array accepts BOTH the
// { date, note } objects declared by LearningObservation/LedgerRow in
// src/core/observations.ts (rendered as `[date] note`) and pre-rendered
// strings.  formatAmendmentsLine normalises per entry — never a bare join,
// which would emit `[object Object]` for the schema-declared shape.
//
// Consumers of these strings:
//   - session-start-context (line 57): reads TL;DR comment via sed
//   - devflow:apply-decisions: reads ## ADR-NNN: / ## PF-NNN: headings
//   - decisions-usage-scan: scans /(ADR|PF)-\d{3}/ anchors
//   - buildIndexContent (below): parses ## heading, - **Status**:, - **Area**: lines from rendered blocks

'use strict';

/** JS LineTerminator set — /m `^` matches after each of these and `.` excludes them. */
const LINE_TERMINATORS = /[\r\n\u2028\u2029]/g;

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
 * JS LineTerminators (\r, \n,  ,  ) inside values are collapsed to a
 * single space so the formatted output lines remain single-line (guards the
 * full LineTerminator set, not only \n).
 *
 * DUPLICATE KEY POLICY: if the same key appears more than once in the
 * details string the LAST occurrence wins — each new segment-start match
 * overwrites the prior value. This is last-match-wins, not priority-ordered
 * first-match-wins.
 *
 * RECOVERY PASS: after the anchored segment pass, any key still unset is
 * searched for with an unanchored regex ('(?:^|[.;\\s])key:\\s*([^;]+)') so
 * that legacy corpus rows written before the ';'-delimited grammar was
 * documented (which embed field keys mid-segment after '. ') are still
 * parsed correctly. The recovery pass never overrides a value the anchored
 * pass already set. applies PF-044 (divergence/migration: legacy rows exist
 * written under the old contract that embedded keys after '. ').
 *
 * D001 (details-parsing): This is the SINGLE parser for structured details
 * strings — both formatDecisionBody and formatPitfallBody delegate here.
 * applies PF-042 (delimiter-regex truncation).
 *
 * @param {string} detailsStr - raw details string from an observation row
 * @param {readonly string[]} keys - recognised field names
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
    // Hoist toLowerCase — avoids one allocation per key per segment (PERF-3).
    const lowered = trimmed.toLowerCase();
    let matched = false;

    for (const key of keys) {
      const prefix = key + ':';
      // Anchored: does the trimmed segment START with '<key>:'?
      // Lower-casing both sides gives case-insensitive matching without regex.
      if (lowered.startsWith(prefix)) {
        currentKey = key;
        result[key] = trimmed.slice(prefix.length).trim().replace(LINE_TERMINATORS, ' ');
        matched = true;
        break;
      }
    }

    if (!matched && currentKey !== null) {
      // Continuation of the previous field's value (embedded semicolons)
      result[currentKey] = result[currentKey] + '; ' + trimmed.replace(LINE_TERMINATORS, ' ');
    }
  }

  // Recovery pass: a key the anchored pass never matched may still appear
  // mid-segment in legacy corpus rows (written before the ';'-delimited
  // grammar was documented) where fields are separated by '. ' rather than
  // ';'. The unanchored regex requires the key to be preceded by a
  // word-boundary character (^, '.', ';', or whitespace) so that 'reissue:'
  // still does NOT match 'issue:', and it only fills keys the anchored pass
  // left unset — never overrides an anchored match. applies PF-044.
  for (const key of keys) {
    if (result[key] !== undefined) continue;
    const m = detailsStr.match(new RegExp('(?:^|[.;\\s])' + key + ':\\s*([^;]+)', 'i'));
    if (m) result[key] = m[1].trim().replace(LINE_TERMINATORS, ' ');
  }

  return result;
}

/**
 * Normalise one amendment entry to its rendered string form.
 *
 * TWO SHAPES are accepted because two authorities define this field:
 *   - `{ date, note }` — the shape declared by LearningObservation /
 *     LedgerRow in src/core/observations.ts, and the ONLY shape its
 *     isLearningObservation type guard accepts. Renders as `[date] note`
 *     (bare `note` when date is absent/blank).
 *   - `string` — a pre-rendered `[date] note` line, the convenience form.
 *
 * A plain `join` over the object shape would emit `[object Object]`, so the
 * normalisation is load-bearing rather than defensive. Unrecognised or
 * note-less entries collapse to '' and are dropped by the caller — a
 * formatter running under the .decisions.lock must never throw.
 *
 * Newlines are collapsed to spaces to preserve the single-line field contract.
 *
 * @param {unknown} entry
 * @returns {string} rendered amendment, or '' when unrenderable
 */
function amendmentToString(entry) {
  if (typeof entry === 'string') return entry.replace(LINE_TERMINATORS, ' ').trim();
  if (entry && typeof entry === 'object') {
    const note = typeof entry.note === 'string' ? entry.note.replace(LINE_TERMINATORS, ' ').trim() : '';
    if (!note) return '';
    const date = typeof entry.date === 'string' ? entry.date.replace(LINE_TERMINATORS, ' ').trim() : '';
    return date ? `[${date}] ${note}` : note;
  }
  return '';
}

/**
 * Format the Amendments line for a decision or pitfall body.
 * Returns an empty string when the amendments array is absent, empty, or
 * contains nothing renderable, so callers can concatenate unconditionally
 * without leaving a blank line.
 *
 * Format: `- **Amendments**: text1; text2\n`
 * A single amendment has no trailing semicolon.
 *
 * @param {Array<string | { date?: string, note?: string }> | undefined | null} amendments
 * @returns {string} formatted line with trailing newline, or '' if empty
 */
function formatAmendmentsLine(amendments) {
  if (!Array.isArray(amendments) || amendments.length === 0) return '';
  const parts = amendments.map(amendmentToString).filter(Boolean);
  if (parts.length === 0) return '';
  return `- **Amendments**: ${parts.join('; ')}\n`;
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
    `- **Source**: self-learning:${obsId}\n` +
    formatAmendmentsLine(row.amendments)
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
    `- **Source**: self-learning:${obsId}\n` +
    formatAmendmentsLine(row.amendments)
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
 * Strategy: for each row, obtain its rendered block (pre-rendered block when
 * provided, else truthy raw_body || format*Body(row)), then extract
 * heading/Status/Area with the same regexes.
 * This preserves byte-compat for migrated rows that carry Area/Status only in raw_body.
 * Note: raw_body === "" is treated as absent (falsy); both predicates align with the
 * truthy check in renderDecisionsFile so index and body files never drift on this edge.
 *
 * @param {object[]} activeDecisionRows - Active decision rows (type='decision', sorted by anchor)
 * @param {object[]} activePitfallRows - Active pitfall rows (type='pitfall', sorted by anchor)
 * @param {{ decisionsFilePath: string, pitfallsFilePath: string, decisionBlocks?: string[], pitfallBlocks?: string[] }} opts
 *   decisionsFilePath / pitfallsFilePath — absolute file paths for footer.
 *   decisionBlocks / pitfallBlocks — optional pre-rendered per-row blocks (one entry per
 *   active row, same order as the row arrays). When provided, each block is used directly
 *   instead of re-rendering the row, so callers that already built blocks for the body
 *   files avoid a second full render pass (PERF-2). The fallback expression
 *   (raw_body || format*Body(row)) is used when the arrays are absent.
 * @returns {string} compact index string, or '(none)'
 */
function buildIndexContent(activeDecisionRows, activePitfallRows, { decisionsFilePath, pitfallsFilePath, decisionBlocks, pitfallBlocks }) {
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
    // Line-anchored regexes prevent amendment text that contains "- **Status**:"
    // or "- **Area**:" as a substring from hijacking the extracted values.
    // The /m (multiline) flag makes ^ match at the start of any line in the block.
    const statusMatch = block.match(/^- \*\*Status\*\*: (.+)/m);
    const status = statusMatch ? statusMatch[1].trim() : null;
    const areaMatch = block.match(/^- \*\*Area\*\*: (.+)/m);
    const area = areaMatch ? areaMatch[1].trim() : null;
    return { id, title: rawTitle, status, area };
  }

  /** @type {Array<{ id: string, title: string, status: string|null, area: string|null }>} */
  const adrEntries = [];
  for (let i = 0; i < activeDecisionRows.length; i++) {
    const row = activeDecisionRows[i];
    const block = decisionBlocks ? decisionBlocks[i] : (row.raw_body ? row.raw_body : formatDecisionBody(row));
    const entry = extractEntryFromBlock(block);
    if (entry) adrEntries.push(entry);
  }

  /** @type {Array<{ id: string, title: string, status: string|null, area: string|null }>} */
  const pfEntries = [];
  for (let i = 0; i < activePitfallRows.length; i++) {
    const row = activePitfallRows[i];
    const block = pitfallBlocks ? pitfallBlocks[i] : (row.raw_body ? row.raw_body : formatPitfallBody(row));
    const entry = extractEntryFromBlock(block);
    if (entry) pfEntries.push(entry);
  }

  if (adrEntries.length === 0 && pfEntries.length === 0) return '(none)';

  const blocks = [];

  if (adrEntries.length > 0) {
    blocks.push([`Decisions (${adrEntries.length}):`, ...adrEntries.map(formatIndexEntryLine)].join('\n'));
  }

  if (pfEntries.length > 0) {
    blocks.push([`Pitfalls (${pfEntries.length}):`, ...pfEntries.map(formatIndexEntryLine)].join('\n'));
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
  formatAmendmentsLine,
  formatDecisionBody,
  formatPitfallBody,
  buildTldrLine,
  toLedgerRow,
  buildIndexContent,
};
