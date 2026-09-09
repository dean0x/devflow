/**
 * Retired-wording guard (P0-S22, AC-0.14, GAP-32).
 *
 * One shared grep guard with a denylist of retired literals — grows once per phase;
 * never a new grep; never emptied. Adding a new retired literal goes into
 * RETIRED_LITERALS, not into a new describe block.
 *
 * Phase-0 retired literals:
 *   - ISSUE_NUMBERS    (renamed → ISSUE_REFS in A1)
 *   - ISSUE: {issue    (renamed → ISSUE_INPUT: in A1)
 *   - close milestone  (deleted from release.md in A1, AC-0.14)
 *   - may pre-fetch    (removed from _wave.mds in A1)
 *   - issue-first gate (removed from implement.mds in A1; "step 1c" self-reference stays valid in git.md)
 *
 * Phase-1 retired literals:
 *   - no generated copies anywhere (falsified by dist/agents/git.md; CLAUDE.md restated, GAP-53)
 *
 * Non-vacuity: denylist size and corpus size are both asserted.
 * Known-bad sample (mechanic 2, H10): a seeded retired literal in a synthetic file
 * fails the guard — proven inline without touching committed source.
 *
 * Denylist entry format:
 *   { literal, phase, file, justification }
 * "file" is the dist/commands/*.md or src/assets/ path that contained the literal
 * before the A1 fix; it is recorded for traceability, not enforced dynamically.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Phase-0 denylist of retired literals — grows once per phase; never a new grep; never emptied
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
  {
    literal: 'no generated copies anywhere',
    phase: '1',
    removedFrom: 'CLAUDE.md',
    justification:
      'The Build System section claimed src/assets/{skills,agents,rules}/ were the single source ' +
      'of truth with "no generated copies anywhere in the repo". Phase 1 falsified it: ' +
      'dist/agents/git.md is a generated copy of an agent. Restated as "generated files never ' +
      'live in src/" — the rule that is actually true and actually load-bearing (GAP-53).',
  },
];

// ---------------------------------------------------------------------------
// Corpus: src/assets/ + dist/commands/ + the repo's own prose (root .md, docs/)
//
// The corpus widens when a retired literal lives outside the shipping assets —
// a Phase-1 entry was retired from CLAUDE.md, which nothing scanned. Widening is
// the correct response; loosening the denylist is not (R2).
//
// .devflow/features/*/KNOWLEDGE.md is deliberately NOT in the corpus. Those files
// record what each literal WAS and why it was retired; a residue grep must not
// demand that provenance be deleted (PF-040).
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
        // ext === '' matches extensionless files (hook scripts in src/assets/scripts/hooks/)
        const absPath = path.join(dir, entry.name);
        try {
          corpus.push({ relPath: `${relPrefix}/${entry.name}`, content: readFileSync(absPath, 'utf-8') });
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  // '' in exts picks up extensionless hook scripts in src/assets/scripts/hooks/ so
  // retired-wording checks are not silently skipped for that corpus (e.g. capture-prompt, ensure-proxy).
  addDir(path.join(ROOT, 'src', 'assets'), 'src/assets', ['.md', '.mds', '.sh', '']);
  addDir(path.join(ROOT, 'dist', 'commands'), 'dist/commands', ['.md']);
  addDir(path.join(ROOT, 'dist', 'agents'), 'dist/agents', ['.md']);
  addDir(path.join(ROOT, 'docs'), 'docs', ['.md']);

  // Root-level prose. Read individually rather than by walking ROOT, which would
  // pull in node_modules/ and every dot-directory.
  for (const name of ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md']) {
    try {
      corpus.push({ relPath: name, content: readFileSync(path.join(ROOT, name), 'utf-8') });
    } catch {
      // Absent root doc — the corpus-size assertion below is what catches a corpus
      // that has collapsed; a single missing file is not a guard failure.
    }
  }

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

describe('retired-wording guard — denylist of retired literals (P0-S22, GAP-32)', () => {
  it('denylist is non-empty and each entry carries a justification (non-vacuity)', () => {
    expect(
      RETIRED_LITERALS.length,
      'RETIRED_LITERALS denylist must be non-empty',
    ).toBeGreaterThan(0);
    for (const entry of RETIRED_LITERALS) {
      expect(entry.literal.length, `entry literal must be non-empty`).toBeGreaterThan(0);
      expect(entry.justification.length, `entry "${entry.literal}" must carry a justification`).toBeGreaterThan(0);
      expect(entry.removedFrom.length, `entry "${entry.literal}" must record removedFrom`).toBeGreaterThan(0);
    }
  });

  it('no retired literal appears in the shipping assets, the compiled output, or the repo docs', () => {
    const corpus = buildCorpus();

    // Non-vacuity: corpus size must be > 0 so the guard is not trivially green.
    expect(
      corpus.length,
      `corpus is empty — check src/assets/, dist/, and docs/; guard is vacuous (PF-018)`,
    ).toBeGreaterThan(0);
    // …and the doc half specifically, since a Phase-1 entry was retired from CLAUDE.md
    // and would have gone unchecked while the src/assets half kept the corpus non-empty.
    expect(
      corpus.map(e => e.relPath),
      'root prose must be in the corpus — a retired literal lives there',
    ).toContain('CLAUDE.md');

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
