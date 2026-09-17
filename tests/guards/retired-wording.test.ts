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
 *   - no generated copies anywhere         (falsified by dist/agents/git.md; CLAUDE.md restated, GAP-53)
 *   - The only intermediate build step     (docs/reference/file-organization.md — dist/agents/ is a second one)
 *   - No build step distributes agents     (docs/reference/agent-design.md — a generator host is compiled first)
 *
 * A widened corpus only raises detection when the vocabulary widens with it: the two
 * Phase-1 doc literals above survived the CLAUDE.md sweep purely by being spelled
 * differently, in files the corpus already scanned (PF-025).
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
  /**
   * Corpus path prefixes this literal is retired FROM, spelled as the corpus spells
   * them (`dist/commands/`, `src/assets/skills/git/`, …). Absent means the whole
   * corpus.
   *
   * Phase 2 needed this: `gh issue` is RETIRED from the command layer and
   * LEGITIMATE in `git.md` and its generated references — those files are the
   * mechanics. A denylist without scopes could only express the weaker of the two
   * rules, and the weaker one is the one that forbids nothing where it matters.
   */
  scope?: readonly string[];
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
  {
    literal: 'The only intermediate build step',
    phase: '1',
    removedFrom: 'docs/reference/file-organization.md',
    justification:
      'The Asset Distribution section named compiling .mds command sources to dist/commands/ as the ' +
      'sole intermediate build step. Phase 1 falsified it: an .mds agent generator host compiles to ' +
      'dist/agents/ in the same build. Restated as the two host kinds the build serves. Registered ' +
      'because the claim outlived the CLAUDE.md sweep purely by being spelled differently, in a file ' +
      'the corpus already scanned.',
  },
  {
    literal: 'No build step distributes agents',
    phase: '1',
    removedFrom: 'docs/reference/agent-design.md',
    justification:
      'agent-design.md asserted src/assets/agents/ was the single source of truth for every agent and ' +
      'that no build step distributes them. Phase 1 falsified both: src/assets/agents/git.mds compiles ' +
      'to dist/agents/git.md, which the installer prefers over the src tree. Restated as the ' +
      'hand-authored vs generator-host split.',
  },

  // -------------------------------------------------------------------------
  // Phase-2 denylist (AC-2.8, §14.9). Four scoped literals plus §14.2's retired
  // DEGRADED synonyms. The denylist grows by the phase's retired literals; it is
  // never a new grep and never emptied.
  // -------------------------------------------------------------------------
  {
    literal: 'gh issue',
    phase: '2',
    removedFrom: 'src/assets/commands/**.mds (the command layer)',
    scope: ['dist/commands/'],
    justification:
      'A command that names a provider CLI has re-composed provider mechanics at the caller — the ' +
      '~30-sink shape GAP-10 names. The literal stays LEGITIMATE in git.md and in the generated ' +
      'references, which is why this entry is scoped to the compiled command layer. Strictly ' +
      'stronger than build-mds.test.ts\'s prose-only rule, which permits it inside a Git spawn fence.',
  },
  {
    literal: 'sleep 60',
    phase: '2',
    removedFrom: 'src/assets/skills/git/SKILL.md:196, references/github-api.md:20 and :467',
    scope: ['src/assets/skills/git/', 'dist/agents/git.md', 'dist/skills/git/references/'],
    justification:
      'GAP-25. Sleeping out an active secondary rate limit extends the provider\'s penalty window, ' +
      'which is why D4 says STOP. Three sites held it and all three were rewritten in P2-S7/P2-S8; ' +
      'scoped to the files a Git spawn preloads or can load, because an unrelated example elsewhere ' +
      'is not a second rate-limit policy in the agent\'s context.',
  },
  {
    literal: '<!-- devflow:',
    phase: '2',
    removedFrom: 'src/assets/commands/dynamic-build.mds and code-review.mds',
    scope: ['dist/commands/'],
    justification:
      'GAP-20: the operation owns the marker; a caller restating the literal already diverged once ' +
      'and produced duplicate comments. Scoped to the compiled commands because the marker must ' +
      'keep living in git.md and in the generated post-wave-report reference — the rule is ' +
      'relocated, not deleted.',
  },
  {
    literal: '{issue}',
    phase: '2',
    removedFrom: 'src/assets/skills/docs-framework/SKILL.md:45, :106, :144',
    scope: ['src/assets/skills/docs-framework/SKILL.md'],
    justification:
      'P2-S11 replaced the GitHub-bound placeholder with the provider-neutral {ISSUE_ID}. Scoped to ' +
      'the one file: `{issue}` is an ordinary template token elsewhere and a repo-wide entry would ' +
      'be a grep rather than a rule.',
  },

  // §14.2's retired DEGRADED synonyms. Unscoped — a DEGRADED reason is user-visible
  // wherever it is written, and the canonical table admits exactly one spelling per
  // condition (GAP-13: thirteen reasons with three synonyms for one condition is how
  // a caller ends up matching on a string no op emits).
  ...([
    ['provider mechanics unavailable', 'superseded by `tracker mechanics unavailable`'],
    ['provider {x} not installed', 'names an installation state the agent cannot observe'],
    ['no MCP tool for', '"MCP" is transport and stays out of user-facing text'],
    ['no tool available for', 'superseded by `no tracker tool for {capability}`'],
    ['no jira tools in session', 'session-scoped phrasing of a capability fact'],
    ['jira tools unavailable', 'same condition, third spelling'],
    ['tracker not reachable', 'conflates an unconfigured tracker with an unreachable one'],
    ['interactive setup required', 'no question step exists — the phrasing promises a prompt that never comes'],
    ['delete .devflow/tracker.md and re-learn', 'superseded; the file is never the remedy'],
  ] as const).map(([literal, why]): RetiredEntry => ({
    literal,
    phase: '2',
    removedFrom: '§14.2 canonical DEGRADED reason table (retired synonym)',
    justification: `Retired DEGRADED synonym — ${why}. The canonical table admits one reason per condition.`,
  })),

  // -------------------------------------------------------------------------
  // Phase-3 denylist (AC-3.10). §14.2's three retired status headings.
  //
  // AC-3.10's wording is exact: the denylist GROWS by the phase's retired
  // literals; never a new grep. These three arrived in a second list inside
  // tests/tracker/schema-scope.test.ts — which is a new grep, and a weaker one:
  // that corpus is `dist/agents/git.md` ∪ `dist/skills/git/references/**` ∪ the
  // two command trees. This corpus is a strict superset of all four AND reaches
  // `src/assets/agents/`, `src/assets/skills/`, `src/assets/mds/`, `docs/` and
  // the root prose — which is exactly where a retired heading survives a sweep by
  // being restated in documentation rather than in an op body (PF-025, the
  // Phase-1 lesson). The narrower list is deleted rather than kept alongside: it
  // asserted no property this does not, and two lists is how one goes stale.
  //
  // `.devflow/features/*/KNOWLEDGE.md` stays out of the corpus (see the note
  // above buildCorpus), so the knowledge bases may keep recording what these
  // headings were and why they went.
  // -------------------------------------------------------------------------
  ...([
    ['## Tracker Discovery', 'the discovery report of a question step §3.3 deleted'],
    ['## Tracker Learned', 'the confirmation half of the same step'],
    ['## Tracker Learning Required', 'the prompt half — it promised an interactive setup that never comes'],
  ] as const).map(([literal, why]): RetiredEntry => ({
    literal,
    phase: '3',
    removedFrom: '§14.2 retired status headings — no op emits them',
    justification:
      `Retired status heading — ${why}. A heading with no emitter is residue; a heading an op ` +
      `still emits is a user-visible section describing a flow that no longer exists.`,
  })),
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
  // Phase 2 generates a third build output. Without it the scoped `sleep 60` entry
  // would be retired from a tree nothing scanned — the GAP-25 contradiction could
  // move into a generated reference and stay green.
  addDir(path.join(ROOT, 'dist', 'skills'), 'dist/skills', ['.md']);
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
      if (entry.scope && !entry.scope.some(prefix => relPath.startsWith(prefix))) continue;
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
      if (entry.scope) {
        expect(entry.scope.length, `entry "${entry.literal}" has an empty scope — omit the field instead`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('every scoped entry names a scope the corpus actually reaches (no silently dead scope)', () => {
    // A scope that matches no corpus path silences its entry completely and leaves
    // a denylist row that forbids nothing — the same failure as an exemption nobody
    // notices going stale. Checked against the real corpus, not the literal strings.
    const paths = buildCorpus().map(e => e.relPath);
    expect(paths.length, 'empty corpus').toBeGreaterThan(0);
    const dead: string[] = [];
    for (const entry of RETIRED_LITERALS) {
      if (!entry.scope) continue;
      for (const prefix of entry.scope) {
        if (!paths.some(p => p.startsWith(prefix))) dead.push(`"${entry.literal}" → ${prefix}`);
      }
    }
    expect(
      dead,
      `scope prefix(es) matching no corpus file — the entry is retired from a tree nothing scans:\n  ` +
      dead.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a scope confines its entry to the named tree (mechanic 2)', () => {
    const scoped = RETIRED_LITERALS.find(e => e.scope !== undefined);
    expect(scoped, 'at least one entry must be scoped, or the scope arm is untested').toBeDefined();
    const prefix = scoped!.scope![0];
    const inside = collectRetiredLiteralViolations([
      { relPath: `${prefix}probe.md`, content: `seeded ${scoped!.literal} here\n` },
    ]);
    const outside = collectRetiredLiteralViolations([
      { relPath: 'docs/probe.md', content: `seeded ${scoped!.literal} here\n` },
    ]);
    expect(
      inside.length,
      `the collector must flag "${scoped!.literal}" inside ${prefix}`,
    ).toBeGreaterThan(0);
    expect(
      outside.filter(v => v.includes(scoped!.literal)),
      `the collector must NOT flag "${scoped!.literal}" outside its scope — that is what the scope is for`,
    ).toEqual([]);
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
