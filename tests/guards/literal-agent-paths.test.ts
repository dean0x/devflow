/**
 * Literal-agent-path guard (AC-0.7, P0-S17) and dist-throw contract tests (AC-0.16).
 *
 * AC-0.7 / P0-S17 — no new test file contains a literal `src/assets/agents/` path
 * outside the documented src-fallback sites. Scanning tests/seams/**, tests/goldens/**,
 * and tests/guards/** catches regressions before they accumulate.
 *
 * EXCEPTION / OUT-OF-SCOPE DOCUMENTATION (files not scanned or explicitly excluded):
 *   tests/helpers.ts — extractStatusLines() reads src/assets/agents/git.md directly by
 *     design: the github-status-lines fixture is frozen against the *source* file (AC-0.9),
 *     so this function must always read src. It is outside the scan scope below.
 *   tests/installer-new.test.ts — out of scope: it is not a new Phase-0 file and pins
 *     an installer error message, not an agent-path literal used for content resolution.
 *   tests/guards/literal-agent-paths.test.ts — self-excluded: this file defines the
 *     LITERAL constant, the error message strings, and the non-vacuity probe corpus entry,
 *     all of which necessarily contain the literal string.
 *   tests/guards/retired-wording.test.ts — excluded: its removedFrom metadata records
 *     legacy src paths present before Phase-0 renaming (historical documentation only).
 *   tests/goldens/git-agent-golden.test.ts — excluded: its it() test description string
 *     mentions the literal as a human-readable label, not as a file-reading path. The test
 *     uses resolveAgentSource() for all content access (MIS-5a compliant).
 *
 * Comment lines (// and * prefixed) are skipped by the collector: literal mentions in
 * comments are documentation and are not path-resolution code.
 *
 * AC-0.16 — requireDistFile / requireDistFiles throw with a build hint when the artifact
 * is absent. Injectable root parameter (mirroring resolveAgentSource's `root = ROOT`)
 * enables hermetic testing without touching the real dist/.
 *
 * Non-vacuity (mechanic 2, H10): both guards use a synthetic corpus / temp root so that
 * the detection logic is proven live without modifying committed source.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { requireDistFile, requireDistFiles } from '../helpers.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Files excluded from the live scan — each contains the literal for documented,
// non-code-resolution reasons (guard mechanics, historical metadata).
// See block-comment at top of file for justifications.
// ---------------------------------------------------------------------------
const LITERAL_SCAN_EXCLUSIONS: ReadonlyArray<string> = [
  'tests/guards/literal-agent-paths.test.ts', // guard mechanics: defines LITERAL, error messages, and non-vacuity probe
  'tests/guards/retired-wording.test.ts',      // removedFrom metadata: historical src path before Phase-0 rename
  'tests/goldens/git-agent-golden.test.ts',    // test description string: mentions path as a label, not a file-reading path
];

// ---------------------------------------------------------------------------
// Helper: collect literal src/assets/agents/ violations from a corpus entry list
// ---------------------------------------------------------------------------

interface CorpusEntry {
  relPath: string;
  content: string;
}

/**
 * Scan a corpus of file content for `src/assets/agents/` string literals.
 * Returns a list of violation descriptions. Used by both the live scan and the
 * non-vacuity probe — same function, not an inline re-implementation (M12b).
 */
function collectLiteralAgentPathViolations(corpus: CorpusEntry[]): string[] {
  const LITERAL = 'src/assets/agents/';
  const violations: string[] = [];
  for (const { relPath, content } of corpus) {
    // Scan line by line so comment lines can be skipped.
    // Comment lines (// and * prefixed after trimming) contain the literal for
    // documentation purposes only — they are not file-reading code (AC-0.7 intent).
    let charOffset = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
        let searchFrom = 0;
        while (true) {
          const idx = line.indexOf(LITERAL, searchFrom);
          if (idx === -1) break;
          const absIdx = charOffset + idx;
          const snippet = content.slice(absIdx, absIdx + LITERAL.length + 40).replace(/\n/g, '\\n');
          violations.push(`${relPath}: literal '${LITERAL}' at char ${absIdx} — snippet: '${snippet}…'`);
          searchFrom = idx + LITERAL.length;
        }
      }
      charOffset += line.length + 1; // +1 for the \n separator
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Helper: build corpus from a directory tree (non-recursive depth cap at 3)
// ---------------------------------------------------------------------------

function buildTestCorpus(dir: string, relPrefix: string, exts: string[]): CorpusEntry[] {
  const corpus: CorpusEntry[] = [];
  if (!existsSync(dir)) return corpus;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      corpus.push(...buildTestCorpus(absPath, relPath, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      try {
        corpus.push({ relPath, content: readFileSync(absPath, 'utf-8') });
      } catch {
        // Skip unreadable files
      }
    }
  }
  return corpus;
}

// ---------------------------------------------------------------------------
// Guard: no literal src/assets/agents/ path in test directories (AC-0.7, P0-S17)
// ---------------------------------------------------------------------------

describe('literal-agent-path guard: no src/assets/agents/ literals in new test files (AC-0.7, P0-S17)', () => {
  // Build corpus from the three directories Phase-0 new test files live in.
  const SCAN_DIRS: Array<[string, string]> = [
    [path.join(ROOT, 'tests', 'seams'),   'tests/seams'],
    [path.join(ROOT, 'tests', 'goldens'), 'tests/goldens'],
    [path.join(ROOT, 'tests', 'guards'),  'tests/guards'],
  ];

  it('no test file in seams/, goldens/, or guards/ contains a src/assets/agents/ literal (AC-0.7)', () => {
    const corpus: CorpusEntry[] = [];
    for (const [dir, prefix] of SCAN_DIRS) {
      corpus.push(...buildTestCorpus(dir, prefix, ['.ts']));
    }

    expect(
      corpus.length,
      'corpus is empty — scan directories are absent or contain no .ts files; guard is vacuous (PF-018)',
    ).toBeGreaterThan(0);

    // Filter out self-documented exclusions before running the collector.
    // Excluded files contain the literal for guard-mechanic or historical-metadata reasons
    // (see LITERAL_SCAN_EXCLUSIONS and the block-comment at the top of this file).
    const filteredCorpus = corpus.filter(e => !LITERAL_SCAN_EXCLUSIONS.includes(e.relPath));
    const violations = collectLiteralAgentPathViolations(filteredCorpus);

    expect(
      violations,
      `Literal src/assets/agents/ paths found in new test files (use resolveAgentSource instead):\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a synthetic corpus entry with the literal is caught (mechanic 2, H10)', () => {
    // Proves the guard logic fires on a synthetic corpus — without touching any committed file.
    const syntheticCorpus: CorpusEntry[] = [
      {
        relPath: 'tests/seams/synthetic-literal-test.ts',
        content: "const gitPath = 'src/assets/agents/git.md';\n",
      },
    ];
    const violations = collectLiteralAgentPathViolations(syntheticCorpus);
    expect(
      violations.length,
      'non-vacuity: the guard logic must flag a synthetic file containing src/assets/agents/',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Throw-contract tests for requireDistFile / requireDistFiles (AC-0.16)
// ---------------------------------------------------------------------------

describe('requireDistFile throw contract (AC-0.16)', () => {
  it('requireDistFile throws with build hint when the file is absent', () => {
    // Uses the default ROOT — dist/commands/_nonexistent_.md will never exist.
    expect(
      () => requireDistFile('_nonexistent_.md'),
    ).toThrow(/npm run build/);
  });
});

describe('requireDistFiles throw contract (AC-0.16)', () => {
  it('requireDistFiles throws with build hint when dist/commands/ is absent', () => {
    // Creates a temp root with no dist/ subdirectory — hermetic, no real dist/ touched.
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'devflow-dist-test-'));
    try {
      expect(
        () => requireDistFiles(tmpRoot),
      ).toThrow(/npm run build/);
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  });
});
