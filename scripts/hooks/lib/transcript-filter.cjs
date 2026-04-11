// scripts/hooks/lib/transcript-filter.cjs
//
// Channel-based transcript filter for the self-learning pipeline.
//
// DESIGN: D1 — two-channel filter separates USER_SIGNALS (workflow/procedural detection)
// from DIALOG_PAIRS (decision/pitfall detection). These two channels serve different
// upstream purposes: USER_SIGNALS need only clean user text; DIALOG_PAIRS need both
// the preceding assistant context AND the user correction to identify pitfalls and
// decisions with rationale.
//
// DESIGN: D2 — filter rules reject five classes of pollution:
//   1. isMeta:true  — hook/system messages
//   2. sourceToolUseID / toolUseResult — tool invocation scaffolding
//   3. Wrapped framework noise (<command-name>, <system-reminder>, etc.)
//   4. tool_result content items in user turns
//   5. Empty turns (<5 chars after trim)
//
// DESIGN: D10 — this module is pure data transformation (no I/O). Called once per batch.
// Kept in a separate testable CJS module so unit tests can import it directly
// without spawning a shell process.

'use strict';

/**
 * Regex for framework-injected XML wrappers we must reject.
 * Covers: <command-name>, <local-command-*>, <system-reminder>, <example>
 */
const FRAMEWORK_NOISE_RE = /^\s*<(command-|local-command-|system-reminder|example)/;

const CAP_TURNS = 80;
const CAP_TEXT_CHARS = 1200;
const MIN_TEXT_CHARS = 5;

/**
 * Returns true if a string contains framework-injected noise.
 * @param {string} text
 * @returns {boolean}
 */
function isNoisyText(text) {
  return FRAMEWORK_NOISE_RE.test(text);
}

/**
 * Cleans text content from a user turn.
 * For string content: reject if noisy.
 * For array content: filter out tool_result items and noisy text items, join remainder.
 *
 * @param {unknown} content - raw content field from transcript JSON
 * @returns {{ ok: boolean, text: string }}
 */
function cleanContent(content) {
  if (typeof content === 'string') {
    if (isNoisyText(content)) return { ok: false, text: '' };
    const trimmed = content.trim();
    if (trimmed.length < MIN_TEXT_CHARS) return { ok: false, text: '' };
    return { ok: true, text: trimmed };
  }

  if (Array.isArray(content)) {
    // Reject entire turn if any item is a tool_result
    if (content.some(item => item && item.type === 'tool_result')) {
      return { ok: false, text: '' };
    }
    // Join text items, excluding noisy ones
    const texts = content
      .filter(item => item && item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .filter(t => !isNoisyText(t))
      .join('\n')
      .trim();

    if (texts.length < MIN_TEXT_CHARS) return { ok: false, text: '' };
    return { ok: true, text: texts };
  }

  return { ok: false, text: '' };
}

/**
 * Checks whether a transcript line represents a polluted source we should reject.
 * DESIGN: D2 — pollution sources listed here must be kept in sync with the spec.
 *
 * @param {object} entry - parsed JSONL entry
 * @returns {boolean} true if the entry should be skipped entirely
 */
function isRejectedEntry(entry) {
  if (!entry || typeof entry !== 'object') return true;
  // Reject meta/system lines
  if (entry.isMeta === true) return true;
  // Reject tool scaffolding
  if (entry.sourceToolUseID != null) return true;
  if (entry.toolUseResult != null) return true;
  return false;
}

/**
 * extractChannels — main export.
 *
 * Parses JSONL transcript content and returns two channels:
 *   - userSignals: clean user-turn texts (for workflow/procedural detection)
 *   - dialogPairs: [{prior, user}] tuples (for decision/pitfall detection)
 *
 * Processing:
 *   1. Parse each JSONL line, reject polluted entries (D2)
 *   2. Collect user/assistant turns with clean text content
 *   3. Cap to last 80 turns, 1200 chars per turn text
 *   4. Build USER_SIGNALS from user turns only
 *   5. Build DIALOG_PAIRS from (assistant, user) adjacent pairs in the tail
 *
 * @param {string} jsonlContent - raw JSONL string from transcript file(s)
 * @returns {{ userSignals: string[], dialogPairs: Array<{prior: string, user: string}> }}
 */
function extractChannels(jsonlContent) {
  const lines = jsonlContent.split('\n').filter(line => line.trim().length > 0);

  /** @type {Array<{role: 'user'|'assistant', text: string, turnId: number}>} */
  const turns = [];
  let turnId = 0;

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (isRejectedEntry(entry)) continue;

    // Extract the actual message from transcript envelope format
    // Transcripts may have: { type, message: { role, content } }
    // or direct: { type, content }
    const messageType = entry.type;
    const message = entry.message || entry;
    const role = message.role || messageType;
    const content = message.content;

    if (role === 'user') {
      const { ok, text } = cleanContent(content);
      if (!ok) continue;
      const capped = text.length > CAP_TEXT_CHARS ? text.slice(0, CAP_TEXT_CHARS) : text;
      turns.push({ role: 'user', text: capped, turnId: ++turnId });
    } else if (role === 'assistant') {
      // For assistant turns: accept string content or text-array content
      const { ok, text } = cleanContent(content);
      if (!ok) continue;
      const capped = text.length > CAP_TEXT_CHARS ? text.slice(0, CAP_TEXT_CHARS) : text;
      // Assistant turn inherits current turnId (not incremented)
      turns.push({ role: 'assistant', text: capped, turnId });
    }
  }

  // Cap to last 80 turns
  const tail = turns.length > CAP_TURNS ? turns.slice(turns.length - CAP_TURNS) : turns;

  // Build USER_SIGNALS: texts from user turns only
  const userSignals = tail.filter(t => t.role === 'user').map(t => t.text);

  // Build DIALOG_PAIRS: adjacent (assistant, user) pairs in tail
  /** @type {Array<{prior: string, user: string}>} */
  const dialogPairs = [];
  for (let i = 1; i < tail.length; i++) {
    if (tail[i].role === 'user' && tail[i - 1].role === 'assistant') {
      dialogPairs.push({ prior: tail[i - 1].text, user: tail[i].text });
    }
  }

  return { userSignals, dialogPairs };
}

module.exports = { extractChannels };
