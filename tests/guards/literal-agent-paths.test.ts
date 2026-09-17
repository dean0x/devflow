/**
 * Literal-agent-path guard (AC-0.7, P0-S17) and dist-throw contract tests (AC-0.16).
 *
 * AC-0.7 / P0-S17 — no new test file reaches a single agent's source by any route
 * but `resolveAgentSource`. Two shapes are read: a literal `src/assets/agents/`
 * path, and `agentsDir()` composed with one agent's `.md` filename, which contains
 * no literal and so read past the first rule while doing the same thing. Scanning
 * tests/seams/**, tests/goldens/**, and tests/guards/** catches regressions before
 * they accumulate.
 *
 * EXCEPTION / OUT-OF-SCOPE DOCUMENTATION (files not scanned or explicitly excluded):
 *   tests/helpers.ts — resolveAgentSource names the fallback tree in its doc comment;
 *     its resolution paths come from agentSourceDirs(root). extractStatusLines() reads
 *     through the resolver. It is outside the scan scope below.
 *   tests/guards/literal-agent-paths.test.ts — self-excluded: this file defines the
 *     LITERAL constant, the error message strings, and the non-vacuity probe corpus entry,
 *     all of which necessarily contain the literal string.
 *   tests/guards/retired-wording.test.ts — excluded: its removedFrom metadata records
 *     legacy src paths present before Phase-0 renaming (historical documentation only).
 *
 * Comment lines (// and * prefixed) are skipped by the collector: literal mentions in
 * comments are documentation and are not path-resolution code.
 *
 * AC-0.16 — requireDistFile / requireDistFiles / requireBuiltCli throw with a build hint
 * when the artifact is absent. Injectable root parameter (mirroring resolveAgentSource's
 * `root = ROOT`) enables hermetic testing without touching the real dist/.
 *
 * Non-vacuity (mechanic 2, H10): both guards use a synthetic corpus / temp root so that
 * the detection logic is proven live without modifying committed source.
 *
 * Requires a build: the requireBuiltCli GREEN contract test reads the real dist/cli.js, so
 * `npm run build` must run first.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { requireDistFile, requireDistFiles, requireBuiltCli } from '../helpers.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// Files excluded from the live scan — each contains the literal for documented,
// non-code-resolution reasons (guard mechanics, historical metadata).
// See block-comment at top of file for justifications.
// ---------------------------------------------------------------------------
const LITERAL_SCAN_EXCLUSIONS: ReadonlyArray<string> = [
  'tests/guards/literal-agent-paths.test.ts', // guard mechanics: defines LITERAL, error messages, and non-vacuity probe
  'tests/guards/retired-wording.test.ts',      // removedFrom metadata: historical src path before Phase-0 rename
];

// ---------------------------------------------------------------------------
// Helper: collect literal src/assets/agents/ violations from a corpus entry list
// ---------------------------------------------------------------------------

interface CorpusEntry {
  relPath: string;
  content: string;
}

/**
 * Composing a single agent's `.md` path onto `agentsDir()`.
 *
 * The SECOND way to bypass the resolver, and the one the literal ban leaves open:
 * `path.join(agentsDir(ROOT), 'tracker.md')` contains no literal at all, so it
 * reads past this guard while doing exactly what the guard forbids — pinning the
 * `src/` copy of one agent instead of asking `resolveAgentSource` for whichever
 * copy the installer would prefer. Harmless while `dist/agents/` holds one agent;
 * the day a second agent becomes an MDS generator host, a reader composing its
 * path by hand asserts the UNCOMPILED file while its sibling suite asserts the
 * compiled one, and a two-sided seam compares two artifacts while staying green.
 *
 * Narrow on purpose, because `agentsDir()` has legitimate callers this must not
 * report: passing the DIRECTORY to a walker or a parity compare (dist-agents),
 * asserting the resolver's own ordering (agent-source-precedence), and composing
 * an `.mds` GENERATOR HOST path, which `resolveAgentSource` cannot resolve — it
 * reads `.md` only. So the shape required is `agentsDir(` on the line together
 * with a quoted string that ends in `.md` and has a non-empty basename:
 * `'tracker.md'` and `` `${name}.md` `` match; `'.md'` in an extension list and
 * `'git.mds'` do not.
 *
 * DELIBERATE NON-GOAL (PF-064): composition split across lines — `const dir =
 * agentsDir()` on one line and `path.join(dir, 'x.md')` on another — is not read.
 * Tracking the alias would report the directory-walking callers above, which are
 * the majority and are correct. The single-line shape is the one an author
 * actually writes, and it is what both real instances looked like.
 */
const AGENTS_DIR_CALL = /\bagentsDir\s*\(/;
const AGENT_MD_FILENAME = /(['"`])[^'"`]*[^'"`./]\.md\1/;

/**
 * Scan a corpus of file content for resolver bypasses: `src/assets/agents/`
 * string literals, and `agentsDir()` composed with a single agent `.md` filename.
 * Returns a list of violation descriptions. Used by both the live scan and the
 * non-vacuity probes — same function, not an inline re-implementation.
 */
function collectLiteralAgentPathViolations(corpus: CorpusEntry[]): string[] {
  const LITERAL = 'src/assets/agents/';
  const violations: string[] = [];
  for (const { relPath, content } of corpus) {
    // Scan line by line so comment lines can be skipped.
    // Comment lines (// and * prefixed after trimming) contain the literal for
    // documentation purposes only — they are not file-reading code (AC-0.7 intent).
    let charOffset = 0;
    let lineNo = 0;
    for (const line of content.split('\n')) {
      lineNo += 1;
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
        if (AGENTS_DIR_CALL.test(line) && AGENT_MD_FILENAME.test(line)) {
          violations.push(
            `${relPath}:${lineNo}: agentsDir() composed with an agent .md filename — ` +
            `snippet: '${line.trim().slice(0, 80)}'`,
          );
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
    // Added alongside the first file in tests/tracker/ so the guard is
    // non-vacuous over that directory from its first commit (P2-S15).
    [path.join(ROOT, 'tests', 'tracker'), 'tests/tracker'],
    // Same rule, same commit as the first file in tests/dynamic/ (P2-S11).
    [path.join(ROOT, 'tests', 'dynamic'), 'tests/dynamic'],
    // Same rule, same commit as the first file in tests/installer/ (P2-S14).
    [path.join(ROOT, 'tests', 'installer'), 'tests/installer'],
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

  it('known-bad probe: agentsDir() composed with an agent .md filename is caught', () => {
    // The second bypass shape, driven through the SAME collector. Both spellings
    // an author reaches for: a quoted filename and a template one.
    for (const content of [
      "const p = path.join(agentsDir(ROOT), 'tracker.md');\n",
      'const p = path.join(agentsDir(), `${name}.md`);\n',
      "const p = join(agentsDir(ROOT), \"git.md\");\n",
    ]) {
      expect(
        collectLiteralAgentPathViolations([{ relPath: 'tests/seams/synthetic-compose.ts', content }]),
        `resolver bypass by composition must be flagged: ${content.trim()}`,
      ).not.toEqual([]);
    }
  });

  it('the composition rule does NOT report the legitimate agentsDir() callers', () => {
    // Discrimination, not just detection. These are the shapes the live scan
    // actually holds; a rule that reported them would be reverted rather than
    // obeyed, and the bypass it exists to catch would come back with it.
    for (const content of [
      // A directory passed to a walker or a parity compare.
      'const parity = collectAgentParity(agentsDir(), compiledAgentsDir());\n',
      'const dir = agentsDir();\n',
      // The resolver's own ordering, asserted.
      'expect(agentSourceDirs()).toEqual([compiledAgentsDir(), agentsDir()]);\n',
      // An extension list that merely contains the string '.md'.
      "{ label: SRC, dir: agentsDir(ROOT), exts: ['.md', '.mds'] },\n",
      // An .mds GENERATOR HOST — resolveAgentSource resolves .md only, so composing
      // this path is the correct way to reach it.
      "const gitSource = path.join(agentsDir(ROOT), 'git.mds');\n",
      'content: readFileSync(path.join(agentsDir(), `${name}.mds`), \'utf-8\'),\n',
      // A comment naming the shape is documentation, not resolution.
      "// dir comes from agentsDir(), never from a literal 'tracker.md' path\n",
    ]) {
      expect(
        collectLiteralAgentPathViolations([{ relPath: 'tests/guards/synthetic-ok.ts', content }]),
        `legitimate agentsDir() use must not be reported: ${content.trim()}`,
      ).toEqual([]);
    }
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

describe('requireBuiltCli throw contract (AC-0.16)', () => {
  it('RED: throws with a build hint when dist/cli.js is absent under a hermetic root', () => {
    // Creates a temp root with no dist/ subdirectory — hermetic, no real dist/ touched.
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'devflow-cli-test-'));
    try {
      expect(
        () => requireBuiltCli(tmpRoot),
      ).toThrow(/npm run build/);
      expect(
        () => requireBuiltCli(tmpRoot),
      ).toThrow(/dist\/cli\.js is absent/);
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  });

  it('GREEN: resolves to dist/cli.js under the real ROOT when the build artifact exists', () => {
    const cliPath = requireBuiltCli(ROOT);
    expect(cliPath).toBe(path.join(ROOT, 'dist', 'cli.js'));
    expect(existsSync(cliPath)).toBe(true);
  });
});
