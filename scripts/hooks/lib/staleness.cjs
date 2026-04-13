// scripts/hooks/lib/staleness.cjs
// Staleness detection for learning log entries (D16).
//
// Extracts file path references from an entry's details and evidence fields,
// then checks whether those files still exist on disk. Entries referencing
// missing files are flagged with mayBeStale=true and a staleReason string.
//
// This module is the single source of truth for the staleness algorithm —
// background-learning delegates to it via `node lib/staleness.cjs` rather
// than re-implementing the logic in shell. Tests import it directly to test
// the real implementation.

'use strict';

const fs = require('fs');
const path = require('path');

// Matches file path tokens ending in recognised source extensions.
// Mirrors the grep pattern in background-learning:
//   grep -oE '[A-Za-z0-9_/.-]+\.(ts|tsx|js|cjs|md|sh|py|go|java|rs)'
const FILE_REF_RE = /[A-Za-z0-9_/.-]+\.(ts|tsx|js|cjs|md|sh|py|go|java|rs)/g;

/**
 * Apply staleness detection to an array of log entries.
 *
 * @param {Record<string, unknown>[]} entries - parsed learning-log entries
 * @param {string} cwd - project root; relative refs are resolved against this
 * @returns {Record<string, unknown>[]} entries with mayBeStale/staleReason added where applicable
 */
function checkStaleEntries(entries, cwd) {
  return entries.map(entry => {
    const combined = `${entry.details || ''} ${(entry.evidence || []).join(' ')}`;
    const refs = combined.match(FILE_REF_RE) || [];
    const uniqueRefs = [...new Set(refs)];

    let staleRef = null;
    for (const ref of uniqueRefs) {
      const absPath = ref.startsWith('/') ? ref : path.join(cwd, ref);
      if (!fs.existsSync(absPath)) {
        staleRef = ref;
        break;
      }
    }

    if (staleRef !== null) {
      return {
        ...entry,
        mayBeStale: true,
        staleReason: `code-ref-missing:${staleRef}`,
      };
    }
    return entry;
  });
}

// CLI interface: invoked by background-learning as
//   node lib/staleness.cjs <log-file> <cwd>
// Reads the JSONL log, applies staleness check, writes updated lines back.
// Exits 0 always (staleness failures are non-fatal).
if (require.main === module) {
  const [, , logFile, cwd] = process.argv;

  if (!logFile || !cwd) {
    process.stderr.write('Usage: node lib/staleness.cjs <log-file> <cwd>\n');
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(logFile, 'utf8');
  } catch {
    // Log file missing — nothing to do
    process.exit(0);
  }

  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) process.exit(0);

  let entries;
  try {
    entries = lines.map(l => JSON.parse(l));
  } catch (err) {
    process.stderr.write(`staleness.cjs: failed to parse log: ${err.message}\n`);
    process.exit(0);
  }

  const updated = checkStaleEntries(entries, cwd);

  const flagged = updated.filter(e => e.mayBeStale).length;
  if (flagged > 0) {
    const out = updated.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(logFile, out, 'utf8');
    process.stdout.write(`Staleness pass: ${flagged} entries flagged\n`);
  }

  process.exit(0);
}

module.exports = { checkStaleEntries, FILE_REF_RE };
