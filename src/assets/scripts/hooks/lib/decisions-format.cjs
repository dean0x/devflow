// src/assets/scripts/hooks/lib/decisions-format.cjs
//
// Shared pure formatting helpers for decisions.md and pitfalls.md output.
//
// DESIGN: Shared pure formatting helpers for render-decisions.cjs, the one
// renderer: its CLI and every learning-store writer render through it, so all of
// them share the EXACT same format functions. This is the single source of truth
// for the byte-compat output strings — any drift here will break the
// renderer/session-start-context TL;DR parser.
//
// BYTE-COMPAT CONTRACT (must not change without updating all consumers):
//   v1 entries — ledger rows without schema 2 — keep these bytes (D-V1-BYTE-STABLE):
//   Decision heading:  \n## {anchorId}: {title}\n
//   Decision fields:   - **Date**: YYYY-MM-DD\n          (empty string when absent — render purity: never clock-read in a formatter)
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
//   v2 entries — rows with schema 2 — render from their fields (formatEntryBodyV2):
//     \n## {anchorId}: {title}\n\n
//     - **Status**: {Accepted|Active}\n             (+ " · verified {last_verified}" when the row has one)
//     - **Scope**: `{scope1}`, `{scope2}`\n
//     - **{Decision|Rule}**: {rule}\n              (Decision for decisions, Rule for pitfalls)
//     - **Why**: {why}\n
//     - **Source**: {provenance}\n
//   Inactive table, after the active bodies and omitted when no entry is inactive:
//     \n## Inactive\n\n| ID | Status | Note |\n|---|---|---|\n   then "| {anchorId} | {status} | {note} |\n" per entry
//   TL;DR line:        <!-- TL;DR: N {decisions|pitfalls} -->   (N = the file's active entries)
//   File headers (the renderer swaps in the real TL;DR line):
//     decisions.md: "<!-- TL;DR: 0 decisions -->\n# Architectural Decisions\n\n{GENERATED_NOTICE}\n"
//     pitfalls.md:  "<!-- TL;DR: 0 pitfalls -->\n# Known Pitfalls\n\n{GENERATED_NOTICE}\n"
//   Index lines:
//     v1: "  {anchorId}  {title cut to 60}  [{status}]"     (+ "  —  {area cut to 80}" when it has one)
//     v2: "  {anchorId}  {title}"                           (+ "  —  {scope joined ', ' cut to 80}" when it has one)
//
// Field parsing: both formatters use segmentDetails() which splits on ';' and
// anchors key detection to the START of each trimmed segment — so 'reissue:'
// does NOT match 'issue:', and embedded semicolons inside a field value are
// preserved (the segment is treated as a continuation of the prior field).
// Recovery pass: for any key the anchored pass left unset, an unanchored
// regex ('(?:^|[.;\\s])key:\\s*([^;]+)') is tried against the full details
// string — handles legacy corpus rows written before the ';'-delimited grammar
// was documented, where fields are separated by '. ' rather than ';'.
// The recovery pass never overrides an anchored match.
// LineTerminators (\r, \n, \u2028, \u2029) in field values are collapsed to a
// single space at all five collapse sites (segmentDetails ×2, amendmentToString
// ×3) — guards the single-line field contract against the full JS LineTerminator
// set, not just \n. A v2 field is structured, never parsed: each run of control
// characters in it collapses to one space (the store's singleLine), so no field
// value can add a line, a heading or a table row.
//
// Index extraction: extractEntryFromBlock uses line-anchored regexes
// (/^- \*\*Status\*\*:/m, /^- \*\*Area\*\*:/m) to guard against amendment
// text that accidentally contains those patterns as substrings. It reads v1
// blocks only; a v2 index line is built from the row's fields.
//
// Amendments shape: a v1 row's `amendments` array accepts BOTH the
// { date, note } objects the v1 corpus holds (rendered as `[date] note`) and
// pre-rendered strings.  formatAmendmentsLine normalises per entry — never a
// bare join, which would emit `[object Object]` for the object shape.
//
// Consumers of these strings:
//   - session-start-context (Section 1): injects the TL;DR comment's text via sed
//   - devflow:apply-decisions: reads ## ADR-NNN: / ## PF-NNN: headings
//   - buildIndexContent (below): parses ## heading, - **Status**:, - **Area**: lines from rendered v1 blocks

'use strict';

const {
  ACTIVE_STATUSES,
  activeStatusFor,
  isV2,
  singleLine,
  inactiveNote,
} = require('./learning-store.cjs');

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
 * pass already set.
 *
 * D002 (details-parsing): This is the SINGLE parser for structured details
 * strings — both formatDecisionBody and formatPitfallBody delegate here.
 * A per-field delimiter regex would silently truncate any value containing ';'.
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
  // left unset — never overrides an anchored match.
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
 * TWO SHAPES are accepted:
 *   - `{ date, note }` — the shape every amendment in the v1 corpus has.
 *     Renders as `[date] note` (bare `note` when date is absent/blank).
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

/** The line under each rendered file's title: who writes the file and what it lists. */
const GENERATED_NOTICE =
  'Generated from the local learning ledger by devflow; do not edit. ' +
  'Active entries follow; retired ones are listed under Inactive.';

/**
 * Return the header of a rendered decisions or pitfalls file: the zero-count
 * TL;DR line, the title and the generated-file notice. It is the whole file of an
 * empty corpus; the renderer swaps in the file's real TL;DR line.
 *
 * @param {'decision'|'pitfall'} kind
 * @returns {string}
 */
function initDecisionsContent(kind) {
  return kind === 'decision'
    ? `${buildTldrLine('decisions', [])}\n# Architectural Decisions\n\n${GENERATED_NOTICE}\n`
    : `${buildTldrLine('pitfalls', [])}\n# Known Pitfalls\n\n${GENERATED_NOTICE}\n`;
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
  // Render purity: never clock-read inside a formatter.  Absent date
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

// ---------------------------------------------------------------------------
// v2 entries and the Inactive table
// ---------------------------------------------------------------------------

/** Per-type labels of a v2 body: the active status it shows and the name of its rule field. */
const V2_LABELS = Object.freeze({
  decision: Object.freeze({ status: activeStatusFor('decision'), rule: 'Decision' }),
  pitfall: Object.freeze({ status: activeStatusFor('pitfall'), rule: 'Rule' }),
});

/** A row field on one line: a string with each control-character run collapsed to a space, '' for anything else. */
function oneLine(value) {
  return typeof value === 'string' ? singleLine(value) : '';
}

/** A v2 row's scope entries, each on one line; an entry that is not a non-empty string is skipped. */
function scopeEntries(row) {
  return Array.isArray(row.scope)
    ? row.scope.filter(entry => typeof entry === 'string' && entry !== '').map(singleLine)
    : [];
}

/**
 * Format the body block of a v2 entry (schema 2) from its row fields. Returns the
 * block starting with a leading newline, like the v1 formatters.
 *
 * The Status line shows the active status of the entry's type — Accepted for a
 * decision, Active for a pitfall; only active entries render — and then
 * ` · verified {last_verified}` when the row has that date. Scope entries are code
 * spans joined by ', ', and the rule is labelled Decision or Rule by type. A field
 * that is not a string renders empty: a row is validated when it is written, but a
 * hand edit can leave anything, and a formatter that runs under the lock must not
 * throw.
 *
 * @param {object} row - a v2 ledger row
 * @returns {string}
 */
function formatEntryBodyV2(row) {
  const labels = row.type === 'pitfall' ? V2_LABELS.pitfall : V2_LABELS.decision;
  const verified = oneLine(row.last_verified);
  const scope = scopeEntries(row).map(entry => `\`${entry}\``).join(', ');
  return (
    `\n## ${oneLine(row.anchor_id)}: ${oneLine(row.title)}\n\n` +
    `- **Status**: ${labels.status}${verified ? ` · verified ${verified}` : ''}\n` +
    `- **Scope**: ${scope}\n` +
    `- **${labels.rule}**: ${oneLine(row.rule)}\n` +
    `- **Why**: ${oneLine(row.why)}\n` +
    `- **Source**: ${oneLine(row.provenance)}\n`
  );
}

/** A table cell: one line, trimmed, with `|` escaped so a value adds no column. */
function tableCell(value) {
  return oneLine(value).trim().replace(/\|/g, '\\|');
}

/**
 * Format the Inactive table of a rendered file: one row per inactive entry, v1 or
 * v2, in the order given (the renderer sorts them by number), or '' when there are
 * none.
 *
 * The Note column says why the entry is inactive, as `list` does (inactiveNote):
 * `encoded in {path}`, else `superseded by {anchor}`, else the status note, else
 * `—`. Every cell is one line with `|` escaped as `\|`, so no value adds a line or
 * a column. index.md never carries this table.
 *
 * @param {object[]} rows - inactive ledger rows
 * @returns {string}
 */
function formatInactiveTable(rows) {
  if (rows.length === 0) return '';
  const lines = rows.map(row =>
    `| ${tableCell(row.anchor_id)} | ${tableCell(row.decisions_status)} | ${tableCell(inactiveNote(row)) || '—'} |`
  );
  return `\n## Inactive\n\n| ID | Status | Note |\n|---|---|---|\n${lines.join('\n')}\n`;
}

/**
 * Build the TL;DR comment line of a rendered decisions or pitfalls file:
 * `<!-- TL;DR: N {decisions|pitfalls} -->`, N being the active entries the file
 * renders. It names no entry: session-start-context injects its text into every
 * session, and the index lists the entries.
 *
 * @param {'decisions'|'pitfalls'} kind - label used in the comment
 * @param {object[]} rows - the file's active rows
 * @returns {string} complete TL;DR comment line (no trailing newline)
 */
function buildTldrLine(kind, rows) {
  return `<!-- TL;DR: ${rows.length} ${kind} -->`;
}

// ---------------------------------------------------------------------------
// Index content builder
// ---------------------------------------------------------------------------

/**
 * Statuses a v1 index line tags as they are — everything else renders as
 * [unknown]. They are the store's active statuses: the index lists active
 * entries only.
 */
const INDEX_KNOWN_STATUSES = ACTIVE_STATUSES;

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
 * `text` cut to its first `maxChars` characters (code points) plus '…' when it is
 * longer, so a cut never splits a surrogate pair.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateChars(text, maxChars) {
  const chars = Array.from(text);
  return chars.length <= maxChars ? text : chars.slice(0, maxChars).join('') + '…';
}

/**
 * Format the index line of a v2 entry from its row fields: `  {anchor}  {title}`
 * and, when the entry has a scope, `  —  ` and its entries joined by ', ', cut to
 * 80 characters plus '…'. The title is whole, since a v2 title is at most 120
 * characters, and there is no status tag: the index lists active entries only.
 *
 * @param {object} row - a v2 ledger row
 * @returns {string}
 */
function formatIndexEntryLineV2(row) {
  const scope = scopeEntries(row).join(', ');
  const scopeSuffix = scope ? `  —  ${truncateChars(scope, 80)}` : '';
  return `  ${oneLine(row.anchor_id)}  ${oneLine(row.title)}${scopeSuffix}`;
}

/**
 * Build the compact index content from in-memory active ledger rows.
 * Empty corpus (both arrays empty) → '(none)'.
 * No trailing newline (caller adds '\n' before writing).
 *
 * Strategy: a v2 row's line is built from its fields (formatIndexEntryLineV2).
 * For a v1 row, obtain its rendered block (pre-rendered block when provided, else
 * truthy raw_body || format*Body(row)), then extract heading/Status/Area with the
 * same regexes (D-V1-BYTE-STABLE).
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

  /**
   * The index lines of one kind's active rows, in row order. A v1 row whose block
   * has no entry heading has no line.
   * @param {object[]} rows
   * @param {string[]|undefined} rowBlocks - pre-rendered blocks, one per row
   * @param {(row: object) => string} formatV1Body
   * @returns {string[]}
   */
  function indexLines(rows, rowBlocks, formatV1Body) {
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isV2(row)) {
        lines.push(formatIndexEntryLineV2(row));
        continue;
      }
      const block = rowBlocks ? rowBlocks[i] : (row.raw_body ? row.raw_body : formatV1Body(row));
      const entry = extractEntryFromBlock(block);
      if (entry) lines.push(formatIndexEntryLine(entry));
    }
    return lines;
  }

  const adrLines = indexLines(activeDecisionRows, decisionBlocks, formatDecisionBody);
  const pfLines = indexLines(activePitfallRows, pitfallBlocks, formatPitfallBody);

  if (adrLines.length === 0 && pfLines.length === 0) return '(none)';

  const blocks = [];

  if (adrLines.length > 0) {
    blocks.push([`Decisions (${adrLines.length}):`, ...adrLines].join('\n'));
  }

  if (pfLines.length > 0) {
    blocks.push([`Pitfalls (${pfLines.length}):`, ...pfLines].join('\n'));
  }

  // Footer: explain how to read full bodies
  const footerLines = [];
  if (adrLines.length > 0) {
    footerLines.push(`ADR-NNN entries live in ${decisionsFilePath}`);
  }
  if (pfLines.length > 0) {
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
  formatEntryBodyV2,
  formatInactiveTable,
  formatIndexEntryLineV2,
  buildTldrLine,
  buildIndexContent,
};
