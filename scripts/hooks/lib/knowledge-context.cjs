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
//        node scripts/hooks/lib/knowledge-context.cjs {worktree}
//      and capture the output as KNOWLEDGE_CONTEXT.
//
// This module is the single source of truth for the D-A filter algorithm
// (strip ## ADR-NNN / ## PF-NNN sections marked Deprecated or Superseded).

'use strict';

const fs = require('fs');
const path = require('path');

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
  const combined = parts.join('\n\n').trim();
  return combined || '(none)';
}

// CLI interface: invoked by orchestrators as
//   node scripts/hooks/lib/knowledge-context.cjs {worktree}
// Writes the filtered KNOWLEDGE_CONTEXT to stdout.
// Exits 0 always (missing knowledge files are non-fatal).
if (require.main === module) {
  const [, , worktree] = process.argv;

  if (!worktree) {
    process.stderr.write('Usage: node scripts/hooks/lib/knowledge-context.cjs <worktree-path>\n');
    process.exit(1);
  }

  const result = loadKnowledgeContext(path.resolve(worktree));
  process.stdout.write(result + '\n');
  process.exit(0);
}

module.exports = { filterKnowledgeContext, loadKnowledgeContext };
