/**
 * Retired-wording guard (P0-S22, AC-0.14, GAP-32).
 *
 * One shared grep guard with a per-phase allowlist narrowed once per phase.
 * Never a new grep per phase (GAP-32) — adding a new retired literal goes into
 * RETIRED_LITERALS, not into a new describe block.
 *
 * Phase-0 retired literals:
 *   - ISSUE_NUMBERS    (renamed → ISSUE_REFS in A1)
 *   - ISSUE: {issue    (renamed → ISSUE_INPUT: in A1)
 *   - close milestone  (deleted from release.md in A1, AC-0.14)
 *   - may pre-fetch    (removed from _wave.mds in A1)
 *   - issue-first gate (removed from implement.mds in A1; "step 1c" self-reference stays valid in git.md)
 *
 * Non-vacuity: allowlist size and corpus size are both asserted.
 * Known-bad sample (mechanic 2, H10): a seeded retired literal in a synthetic file
 * fails the guard — proven inline without touching committed source.
 *
 * Allowlist format:
 *   { literal, phase, file, justification }
 * "file" is the dist/commands/*.md or src/assets/ path that contained the literal
 * before the A1 fix; it is recorded for traceability, not enforced dynamically.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Phase-0 allowlist — narrowed once per phase
// ---------------------------------------------------------------------------
interface RetiredEntry {
  literal: string;
  phase: string;
  removedFrom: string;
  justification: string;
}

const RETIRED_LITERALS: ReadonlyArray<RetiredEntry> = [
  {
    literal: 'ISSUE_NUMBERS',
    phase: '0',
    removedFrom: 'src/assets/agents/git.md, src/assets/commands/plan.mds',
    justification: 'Renamed to ISSUE_REFS in A1 (AC-0.11)',
  },
  {
    literal: 'ISSUE: {issue',
    phase: '0',
    removedFrom: 'src/assets/commands/debug.mds',
    justification: 'Renamed to ISSUE_INPUT: {issue reference} in A1 (debug.mds spawn key fix)',
  },
  {
    literal: 'close milestone',
    phase: '0',
    removedFrom: 'src/assets/commands/release.md',
    justification: 'Untruthful claim deleted from release.md in A1 (AC-0.14)',
  },
  {
    literal: 'may pre-fetch',
    phase: '0',
    removedFrom: 'src/assets/commands/_partials/_wave.mds',
    justification: 'Weakened "may" replaced with mandatory pre-fetch in A1',
  },
  {
    literal: 'issue-first gate',
    phase: '0',
    removedFrom: 'src/assets/commands/implement.mds',
    justification:
      '"issue-first gate in step 1c" was the stale cross-reference in implement.mds pointing to ' +
      'git.md\'s internal step — replaced in A1 with "Git agent\'s issue-first step in setup-task". ' +
      '"step 1c" itself is still a valid self-reference in git.md (git create-branch step); ' +
      '"issue-first gate" is the unique retired phrase.',
  },
];

// ---------------------------------------------------------------------------
// Corpus: src/assets/ + dist/commands/ + all .md/.mds in the repo root dirs
// ---------------------------------------------------------------------------

function buildCorpus(): Array<{ relPath: string; content: string }> {
  const corpus: Array<{ relPath: string; content: string }> = [];

  function addDir(dir: string, relPrefix: string, exts: string[]): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        addDir(path.join(dir, entry.name), `${relPrefix}/${entry.name}`, exts);
      } else if (exts.some(ext => ext === '' ? !entry.name.includes('.') : entry.name.endsWith(ext))) {
        // M13: ext === '' matches extensionless files (hook scripts in src/assets/scripts/hooks/)
        const absPath = path.join(dir, entry.name);
        try {
          corpus.push({ relPath: `${relPrefix}/${entry.name}`, content: readFileSync(absPath, 'utf-8') });
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  // M13: '' in exts picks up extensionless hook scripts in src/assets/scripts/hooks/ so
  // retired-wording checks are not silently skipped for that corpus (e.g. capture-prompt, ensure-proxy).
  addDir(path.join(ROOT, 'src', 'assets'), 'src/assets', ['.md', '.mds', '.sh', '']);
  addDir(path.join(ROOT, 'dist', 'commands'), 'dist/commands', ['.md']);

  return corpus;
}

// ---------------------------------------------------------------------------
// Named collector — used by both the main guard and the non-vacuity probe (M12a).
// Calling this from both sites proves the probe exercises the real guard logic (pattern:
// collectGhIssueProseViolations in tests/build-mds.test.ts ~:1549 / ~:1571 / ~:1602).
// ---------------------------------------------------------------------------

function collectRetiredLiteralViolations(
  corpus: Array<{ relPath: string; content: string }>,
): string[] {
  const violations: string[] = [];
  for (const { relPath, content } of corpus) {
    for (const entry of RETIRED_LITERALS) {
      if (content.includes(entry.literal)) {
        violations.push(
          `${relPath}: contains retired literal "${entry.literal}" (phase ${entry.phase}; removed from ${entry.removedFrom})`,
        );
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('retired-wording guard — per-phase allowlist (P0-S22, GAP-32)', () => {
  it('allowlist is non-empty and each entry carries a justification (non-vacuity)', () => {
    expect(
      RETIRED_LITERALS.length,
      'RETIRED_LITERALS allowlist must be non-empty',
    ).toBeGreaterThan(0);
    for (const entry of RETIRED_LITERALS) {
      expect(entry.literal.length, `entry literal must be non-empty`).toBeGreaterThan(0);
      expect(entry.justification.length, `entry "${entry.literal}" must carry a justification`).toBeGreaterThan(0);
      expect(entry.removedFrom.length, `entry "${entry.literal}" must record removedFrom`).toBeGreaterThan(0);
    }
  });

  it('no retired literal appears in any src/assets/ or dist/commands/ file (Phase-0 corpus)', () => {
    const corpus = buildCorpus();

    // Non-vacuity: corpus size must be > 0 so the guard is not trivially green.
    expect(
      corpus.length,
      `corpus is empty — check SKILLS_DIR and dist/commands/; guard is vacuous (PF-018)`,
    ).toBeGreaterThan(0);

    // Use the named collector so the probe exercises the same logic (M12a).
    const violations = collectRetiredLiteralViolations(corpus);

    expect(
      violations,
      `Retired literals found in corpus:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a seeded retired literal in a synthetic corpus entry fails the guard (mechanic 2, M12a)', () => {
    // M12a: prior probe re-implemented the violation loop inline — this calls the same
    // named collector as the main guard so the proof tracks the guard rather than shadowing it.
    const retired = RETIRED_LITERALS[0];
    const syntheticCorpus = [
      { relPath: 'synthetic/test.md', content: `# Synthetic\nContains: ${retired.literal}\n` },
    ];
    // Call the same collectRetiredLiteralViolations function used by the main guard.
    const syntheticViolations = collectRetiredLiteralViolations(syntheticCorpus);
    expect(
      syntheticViolations.length,
      `non-vacuity: the guard logic must flag a corpus entry seeded with "${retired.literal}"`,
    ).toBeGreaterThan(0);
  });
});
