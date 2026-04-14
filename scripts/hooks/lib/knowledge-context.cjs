// scripts/hooks/lib/knowledge-context.cjs
// Deterministic project knowledge loader for the resolve pipeline.
//
// DESIGN: The resolve orchestration surfaces (resolve.md, resolve-teams.md,
// resolve:orch/SKILL.md) all instruct the orchestrator to strip Deprecated and
// Superseded knowledge entries before passing KNOWLEDGE_CONTEXT to Resolver agents.
// Having this logic as a pure CJS module gives us:
//   1. Deterministic filtering — not LLM-interpreted, always consistent.
//   2. Real test coverage — tests import this module directly.
//   3. CLI interface — orchestrators can invoke as:
//        node scripts/hooks/lib/knowledge-context.cjs index {worktree}
//      and capture the output as KNOWLEDGE_CONTEXT (index format).
//      The `full` subcommand returns the full corpus (for backwards compatibility).
//      The bare invocation (no subcommand) is deprecated — emits full corpus with
//      a deprecation notice to stderr.
//
// This module is the single source of truth for the D-A filter algorithm
// (strip ## ADR-NNN / ## PF-NNN sections marked Deprecated or Superseded).
//
// CLI dispatch mirrors json-helper.cjs:8-36 subcommand style:
//   node knowledge-context.cjs index  <worktree>  → index format (~250 tokens)
//   node knowledge-context.cjs full   <worktree>  → full corpus
//   node knowledge-context.cjs        <worktree>  → full corpus + deprecation notice
//   node knowledge-context.cjs foo    <worktree>  → exit 1 + usage

'use strict';

const fs = require('fs');
const path = require('path');

/** @typedef {{ id: string, title: string, status: string, area: string|null }} IndexEntry */

/**
 * Filter raw decisions.md / pitfalls.md content, removing any ## ADR-NNN: or
 * ## PF-NNN: section whose body contains `- **Status**: Deprecated` or
 * `- **Status**: Superseded`.
 *
 * Section boundary = next ## ADR/PF heading or end of string.
 * Non-knowledge content before the first section header (e.g., a file-level
 * title) is preserved in sections[0] and always kept.
 *
 * @param {string} raw - raw content from decisions.md or pitfalls.md
 * @returns {string} filtered content (trimmed), or '' if nothing remains
 */
function filterKnowledgeContext(raw) {
  if (!raw.trim()) return '';
  // Split on ADR-NNN / PF-NNN section boundaries using a lookahead so each
  // section includes its own heading.
  const sections = raw.split(/(?=^## (?:ADR|PF)-\d+:)/m);
  const kept = sections.filter(section => {
    const isKnowledgeSection = /^## (?:ADR|PF)-\d+:/m.test(section);
    if (!isKnowledgeSection) return true; // keep preamble / non-knowledge content
    // Drop sections explicitly marked Deprecated or Superseded
    return (
      !/- \*\*Status\*\*: Deprecated/.test(section) &&
      !/- \*\*Status\*\*: Superseded/.test(section)
    );
  });
  return kept.join('').trim();
}

/**
 * Extract index entries from raw decisions.md / pitfalls.md content.
 * Applies the same D-A filter as filterKnowledgeContext before extracting.
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
    if (!headingMatch) continue; // preamble or non-knowledge content

    // Apply D-A filter — skip Deprecated / Superseded
    if (
      /- \*\*Status\*\*: Deprecated/.test(section) ||
      /- \*\*Status\*\*: Superseded/.test(section)
    ) {
      continue;
    }

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
 * Format a single index line for an ADR entry.
 *
 * @param {IndexEntry} entry
 * @returns {string}
 */
function formatAdrLine(entry) {
  const title = truncate(entry.title, 60);
  const knownStatuses = ['Active', 'Deprecated', 'Superseded'];
  const tag = entry.status && knownStatuses.includes(entry.status) ? `[${entry.status}]` : '[unknown]';
  return `  ${entry.id}  ${title}  ${tag}`;
}

/**
 * Format a single index line for a PF entry.
 *
 * @param {IndexEntry} entry
 * @returns {string}
 */
function formatPfLine(entry) {
  const title = truncate(entry.title, 60);
  const knownStatuses = ['Active', 'Deprecated', 'Superseded'];
  const tag = entry.status && knownStatuses.includes(entry.status) ? `[${entry.status}]` : '[unknown]';
  const areaSuffix = entry.area ? `  —  ${truncate(entry.area, 80)}` : '';
  return `  ${entry.id}  ${title}  ${tag}${areaSuffix}`;
}

/**
 * Load a compact index of project knowledge entries for a given worktree.
 *
 * Returns a ~250-token summary listing each ADR/PF entry with ID, truncated
 * title, status, and (for pitfalls) area. Includes a footer describing how to
 * Read full bodies on demand. Returns '(none)' when both files are absent or
 * their filtered content is empty.
 *
 * @param {string} worktreePath - absolute path to the worktree root
 * @param {{ decisionsFile?: string, pitfallsFile?: string }} [opts] - override
 *   file paths for testing (relative paths resolved against worktreePath)
 * @returns {string} compact index string, or '(none)'
 */
function loadKnowledgeIndex(worktreePath, opts = {}) {
  const decisionsFile = opts.decisionsFile
    ? path.resolve(worktreePath, opts.decisionsFile)
    : path.join(worktreePath, '.memory', 'knowledge', 'decisions.md');

  const pitfallsFile = opts.pitfallsFile
    ? path.resolve(worktreePath, opts.pitfallsFile)
    : path.join(worktreePath, '.memory', 'knowledge', 'pitfalls.md');

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
      lines.push(formatAdrLine(entry));
    }
    blocks.push(lines.join('\n'));
  }

  if (pfEntries.length > 0) {
    const lines = [`Pitfalls (${pfEntries.length}):`];
    for (const entry of pfEntries) {
      lines.push(formatPfLine(entry));
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

/**
 * Load and filter project knowledge for a given worktree.
 *
 * Reads `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`
 * from the worktree root, applies D-A filtering, concatenates, and returns the
 * result. Returns the string `'(none)'` when both files are absent or their
 * filtered content is empty.
 *
 * @param {string} worktreePath - absolute path to the worktree root
 * @param {{ decisionsFile?: string, pitfallsFile?: string }} [opts] - override
 *   file paths for testing (relative paths resolved against worktreePath)
 * @returns {string} filtered context string, or '(none)'
 */
function loadKnowledgeContext(worktreePath, opts = {}) {
  const decisionsFile = opts.decisionsFile
    ? path.resolve(worktreePath, opts.decisionsFile)
    : path.join(worktreePath, '.memory', 'knowledge', 'decisions.md');

  const pitfallsFile = opts.pitfallsFile
    ? path.resolve(worktreePath, opts.pitfallsFile)
    : path.join(worktreePath, '.memory', 'knowledge', 'pitfalls.md');

  let parts = [];

  for (const filePath of [decisionsFile, pitfallsFile]) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      // Skip silently if absent
      continue;
    }
    const filtered = filterKnowledgeContext(raw);
    if (filtered) parts.push(filtered);
  }

  if (parts.length === 0) return '(none)';
  return parts.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// CLI interface — subcommand dispatch
//
// Mirrors json-helper.cjs dispatch style (lines 8-36).
//
// Usage:
//   node knowledge-context.cjs index  <worktree>  → index format (preferred)
//   node knowledge-context.cjs full   <worktree>  → full corpus
//   node knowledge-context.cjs        <worktree>  → full corpus (deprecated)
//   node knowledge-context.cjs foo    <worktree>  → exit 1 + usage
// ---------------------------------------------------------------------------

/**
 * Print usage and exit 1.
 */
function usageExit() {
  process.stderr.write(
    'Usage: node knowledge-context.cjs <subcommand> <worktree-path>\n' +
    'Subcommands:\n' +
    '  index  <worktree>  — compact index (~250 tokens)\n' +
    '  full   <worktree>  — full filtered corpus\n'
  );
  process.exit(1);
}

if (require.main === module) {
  const argv = process.argv.slice(2);

  const KNOWN_SUBCOMMANDS = new Set(['index', 'full']);

  // Bare invocation: node knowledge-context.cjs <worktree>
  // Detected when: argv[0] looks like a path (starts with . / ~ or is absolute-ish)
  // OR argv[0] is not a known subcommand and argv[1] is undefined.
  const firstArg = argv[0];

  if (!firstArg) {
    usageExit();
  }

  let mode;
  let worktreeArg;

  if (firstArg === 'index' || firstArg === 'full') {
    mode = firstArg;
    worktreeArg = argv[1];
  } else if (!KNOWN_SUBCOMMANDS.has(firstArg) && (firstArg.startsWith('/') || firstArg.startsWith('.') || firstArg.startsWith('~') || firstArg.includes('/'))) {
    // Bare deprecated form: first arg is a path
    mode = 'bare';
    worktreeArg = firstArg;
  } else if (!KNOWN_SUBCOMMANDS.has(firstArg)) {
    // Unknown subcommand
    usageExit();
  }

  if (!worktreeArg) {
    usageExit();
  }

  const worktreePath = path.resolve(worktreeArg);

  if (mode === 'bare') {
    // Deprecated — emit deprecation notice to stderr, then full corpus
    process.stderr.write(
      '[knowledge-context] DEPRECATED: bare invocation without subcommand. ' +
      'Use `node knowledge-context.cjs index <worktree>` instead.\n'
    );
    const result = loadKnowledgeContext(worktreePath);
    process.stdout.write(result + '\n');
    process.exit(0);
  }

  if (mode === 'index') {
    const result = loadKnowledgeIndex(worktreePath);
    if (result !== '(none)') {
      // Count total entries for observability log
      const adrCount = (result.match(/^\s+ADR-\d+/gm) || []).length;
      const pfCount = (result.match(/^\s+PF-\d+/gm) || []).length;
      const entries = adrCount + pfCount;
      process.stderr.write(
        `[knowledge-context] mode=index worktree=${worktreePath} entries=${entries}\n`
      );
    }
    process.stdout.write(result + '\n');
    process.exit(0);
  }

  if (mode === 'full') {
    const result = loadKnowledgeContext(worktreePath);
    if (result !== '(none)') {
      process.stderr.write(
        `[knowledge-context] mode=full worktree=${worktreePath}\n`
      );
    }
    process.stdout.write(result + '\n');
    process.exit(0);
  }
}

module.exports = { filterKnowledgeContext, loadKnowledgeContext, loadKnowledgeIndex, extractIndexEntries };
