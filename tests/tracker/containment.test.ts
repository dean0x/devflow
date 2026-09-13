/**
 * Containment oracle for the tracker contract/mechanics split (AC-2.1, P2-S6, C13).
 *
 * The split moves text out of `dist/agents/git.md` and `skills/git/SKILL.md` into
 * generated per-op references. The failure mode that review cannot catch by reading
 * a diff is text that is *lost* rather than *moved* — a paraphrase, a dropped step,
 * a fence that lost its indentation. This file is the mechanical half of AC-2.1:
 * every line the branch started with is either still present somewhere the agent can
 * reach, or is named in CONTAINMENT_EXEMPTIONS with a reason.
 *
 * BASELINES — byte copies of the tree at `101bda7`, the commit Phase 2 branched from:
 *   tests/fixtures/tracker/baseline/git-agent.md   ← tests/fixtures/golden/git-agent.md
 *   tests/fixtures/tracker/baseline/SKILL.md       ← src/assets/skills/git/SKILL.md
 *   tests/fixtures/tracker/baseline/github-api.md  ← src/assets/skills/git/references/github-api.md
 * Captured once, with `git show 101bda7:<path>`, by the subtask that created this file.
 * They are NEVER regenerated. In particular they must OUTLIVE T5's regeneration of
 * `tests/fixtures/golden/git-agent.md`: once that golden is re-captured from the split
 * tree it can no longer answer "what did the branch start with", which is the only
 * question this file asks. This test never shells out to git — the fixtures are the
 * record.
 *
 * NORMALISATION RULE (`isStructuralLine`) — the only lines a baseline contributes
 * nothing for are (a) lines that are empty after trimming and (b) lines whose trimmed
 * form is exactly `---`. Blank lines and horizontal rules carry no content, occur
 * thousands of times, and would make the scan report "contained" for reasons that have
 * nothing to do with the text. EVERY other line is compared BYTE-IDENTICALLY, leading
 * whitespace included: an MDS move that re-indents a fence changes bytes the agent
 * reads, so an indentation-insensitive comparison would hide exactly the [DR-07] escape
 * asymmetry this phase is most likely to get wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { skillsDir, compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  TRACKER_GITHUB_OPS,
  GIT_CROSS_CUTTING_DOCS,
  MIN_VARIANT_PAIRS,
  VARIANT_MODULES,
  expandVariants,
} from '../../src/core/mds-variants.js';
import { ROOT, resolveAgentSource, walkFiles } from '../helpers.js';

// ---------------------------------------------------------------------------
// Fail-loud reads
// ---------------------------------------------------------------------------

/**
 * Read a file that MUST exist. Throws with a build hint rather than returning
 * an empty string: a containment scan over an absent target reports every line
 * as unaccounted, and a containment scan over an absent BASELINE reports zero
 * (PF-018 — a guard that passes when its corpus is missing is not a guard).
 */
function requireFile(label: string, filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `${label}: ${filePath} is absent — run \`npm run build\` first\n` +
      '  (the containment oracle reads built artifacts and committed sources; it cannot be skipped)',
    );
  }
}

const BASELINE_DIR = path.join(ROOT, 'tests', 'fixtures', 'tracker', 'baseline');

interface Baseline {
  /** Basename, and the key CONTAINMENT_EXEMPTIONS entries address. */
  readonly file: string;
  readonly lines: readonly string[];
}

function loadBaseline(file: string): Baseline {
  const text = requireFile(`baseline ${file}`, path.join(BASELINE_DIR, file));
  return { file, lines: text.split('\n') };
}

const BASELINES: readonly Baseline[] = [
  loadBaseline('git-agent.md'),
  loadBaseline('SKILL.md'),
  loadBaseline('github-api.md'),
];

// ---------------------------------------------------------------------------
// Targets — everywhere a moved line is allowed to land
// ---------------------------------------------------------------------------
//
// The union is exactly what one Git spawn can reach: the compiled agent, the
// generated references, and the hand-authored skill files. A line that survives
// only in `src/assets/agents/git.mds` does NOT count — the agent reads the
// compiled artifact, and an MDS escape that fails to round-trip is precisely the
// loss this oracle exists to catch.

const GIT_SKILL_REFS_SRC = path.join(skillsDir(), 'git', 'references');

interface Target {
  readonly label: string;
  readonly content: string;
}

function loadTargets(): Target[] {
  const targets: Target[] = [];

  const git = resolveAgentSource('git');
  targets.push({ label: git.path, content: git.content });

  const generated = walkFiles(compiledSkillRefsDir(), f => f.endsWith('.md'));
  if (generated.length === 0) {
    throw new Error(
      `no generated references under ${compiledSkillRefsDir()} — run \`npm run build\` first\n` +
      '  (an empty reference tree would make every moved line read as lost)',
    );
  }
  for (const file of generated) {
    targets.push({ label: file, content: requireFile('generated reference', file) });
  }

  targets.push({
    label: 'src/assets/skills/git/SKILL.md',
    content: requireFile('skills/git/SKILL.md', path.join(skillsDir(), 'git', 'SKILL.md')),
  });

  for (const file of walkFiles(GIT_SKILL_REFS_SRC, f => f.endsWith('.md'), 1)) {
    targets.push({ label: file, content: requireFile('skill reference', file) });
  }

  return targets;
}

const TARGETS = loadTargets();

/** Every line of every target, byte-exact, for O(1) membership. */
function targetLineSet(targets: readonly Target[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const target of targets) {
    for (const line of target.content.split('\n')) set.add(line);
  }
  return set;
}

const TARGET_LINES = targetLineSet(TARGETS);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * True for a line that carries no content of its own: blank, or a horizontal
 * rule. Named so the rule is one thing with one definition rather than an
 * inline predicate repeated at each call site.
 */
function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed === '---';
}

// ---------------------------------------------------------------------------
// The exemption list [DR-17]
// ---------------------------------------------------------------------------

/**
 * Baseline line ranges that are deliberately NOT present byte-identically in any
 * target, each with the reason. 1-based, inclusive on both ends, addressed by the
 * baseline's basename.
 *
 * This is the other half of AC-2.1 [DR-27(b)]: "the diff contains only intended
 * moves" stops being a reviewer's attention span and becomes a list someone had to
 * write a sentence for. A rewrite with no entry here is reported as a lost line.
 *
 * P2-S7 filled it. Three of the SKILL.md entries below go beyond the cut table in
 * the plan and are marked BEYOND-TABLE: the plan's `9,204 − 2,604 = 6,600`
 * derivation did not budget for the pointers P2-S7 itself mandates (the naming
 * pointer, the Extended-References row, the heredoc sentence, the protected-branch
 * pointer, the GitHub-API pointer), which cost roughly 700 characters of add-back.
 * Each BEYOND-TABLE cut removes a section that RESTATES rules already stated once
 * in the same preloaded file — the single-convergence-point rule (PF-023) the phase
 * is built on — rather than removing any rule.
 */
interface ContainmentExemption {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly rationale: string;
}

export const CONTAINMENT_EXEMPTIONS: readonly ContainmentExemption[] = [
  // ── skills/git/SKILL.md (P2-S7) ────────────────────────────────────────────
  {
    file: 'SKILL.md',
    startLine: 24,
    endLine: 28,
    rationale:
      'BEYOND-TABLE. The five activation bullets restate the frontmatter `description:` ' +
      'field one-for-one, and `description:` is what actually drives activation. ' +
      'Compressed to a single line; the heading survives so the skill keeps the ' +
      'template shape every other skill has.',
  },
  {
    file: 'SKILL.md',
    startLine: 73,
    endLine: 73,
    rationale:
      'The protected-branch list is duplicated from devflow:worktree-support, which is ' +
      'the canonical list (that skill is preloaded on the same spawns). Replaced by a ' +
      'pointer, so the list has one owner.',
  },
  {
    file: 'SKILL.md',
    startLine: 152,
    endLine: 152,
    rationale:
      'Related-Issues row moved to {ISSUE_REF} vocabulary. The GitHub rendering (`#N`) ' +
      'is unchanged; the row no longer hardcodes a provider-specific reference shape.',
  },
  {
    file: 'SKILL.md',
    startLine: 190,
    endLine: 190,
    rationale:
      '"remaining < 10 wait 60s" is the same D4 contradiction as :196 in prose form: D4 ' +
      'says STOP the fan-out and report THROTTLED. Rewritten to state D4\'s rule. ' +
      'Deleting :196 while leaving this line would have fixed the recipe and kept the ' +
      'contradiction.',
  },
  {
    file: 'SKILL.md',
    startLine: 196,
    endLine: 196,
    rationale:
      'DELETED, not moved: `if [ "$REMAINING" -lt 10 ]; then sleep 60; fi` directly ' +
      'contradicts the D4 degradation contract\'s STOP clause (GAP-25). Two opposed ' +
      'rate-limit policies were preloaded in one context; sleeping out an active ' +
      'secondary limit extends GitHub\'s penalty window.',
  },
  {
    file: 'SKILL.md',
    startLine: 200,
    endLine: 200,
    rationale:
      'Heading renamed `### PR Comments` → `### Comment Rules` on the move, because its ' +
      'destination in references/github-api.md already has a `## PR Comments` section ' +
      'and a same-named child would read as a second one. The three rule bullets ' +
      'underneath moved byte-identically.',
  },
  {
    file: 'SKILL.md',
    startLine: 211,
    endLine: 211,
    rationale:
      '`gh release create … --notes "$NOTES"` is an inline-body recipe in a file that is ' +
      'preloaded on every spawn, while create-release mandates --notes-file after a D11 ' +
      'scrub whose failure is a HARD fail. Rewritten as the --notes-file form; this is ' +
      'the known-bad sample the widened INLINE_BODY_RE was proven red against.',
  },
  {
    file: 'SKILL.md',
    startLine: 214,
    endLine: 214,
    rationale:
      'The "See references/github-api.md" pointer was rewritten to name what actually ' +
      'moved there (throttling, PR-comment rules, releases) instead of the generic ' +
      '"extended API, CLI, and GraphQL patterns".',
  },
  {
    file: 'SKILL.md',
    startLine: 218,
    endLine: 228,
    rationale:
      'BEYOND-TABLE. Every row of the Anti-Patterns table restates a rule already stated ' +
      'in its own section above (Sequential Operations, Atomic Grouping, Sensitive File ' +
      'Detection, Branch Safety, GitHub API, Description Sections) — and ' +
      'references/violations.md, already listed under Extended References, is the named ' +
      'authority for git/PR anti-patterns. A third copy in the preloaded file is what ' +
      'PF-023 forbids.',
  },
  {
    file: 'SKILL.md',
    startLine: 252,
    endLine: 261,
    rationale:
      'The Naming Conventions Authority block is replaced by a one-line pointer to ' +
      'learn-conventions, which owns .devflow/conventions.md. The `≤50 branches` bound ' +
      'survives in that pointer so it is stated exactly once across git.md ∪ ' +
      'skills/git/** (GAP-25).',
  },

  // ── dist/agents/git.md (P2-S4 — the invariant/detector split) ──────────────
  //
  // These seven ranges are the ONLY deliberate rewrites of always-loaded text in
  // the phase. Each one carried BOTH halves of P2-S4's table in a single sentence:
  // an invariant that must stay and a GitHub detector that must not. No relocation
  // of verbatim text can split a sentence, so the invariant half is rewritten in
  // place and the detector half is restated in the GitHub provider reference.
  // These bytes are the reason the github-status-lines re-capture was authorised.
  {
    file: 'git-agent.md',
    startLine: 24,
    endLine: 25,
    rationale:
      'D4 remote-unavailable and secondary-rate-limit conditions. `:24` named `gh` as the ' +
      'authentication that can fail and `:25` carried the GitHub signal (403/429 with a ' +
      'rate-limit body, `X-RateLimit-Remaining` header < 10) inside the same sentence as the ' +
      'STOP/THROTTLED invariant. Rewritten provider-neutrally ("a provider-signalled secondary ' +
      'rate limit"); the STOP clause, the THROTTLED report and the DEGRADED reason are ' +
      'byte-unchanged, and the signal is now stated once in the GitHub reference.',
  },
  {
    file: 'git-agent.md',
    startLine: 28,
    endLine: 28,
    rationale:
      'D4 backpressure rung. The `X-RateLimit-Remaining` < 50 threshold is a GitHub signal; the ' +
      '1s → 3s delay it triggers is a policy bound and §14.3 keeps policy bounds in the contract ' +
      'layer. The sentence is rewritten so the bound stays and the signal moves.',
  },
  {
    file: 'git-agent.md',
    startLine: 45,
    endLine: 45,
    rationale:
      'D11 scope sentence said "posts or edits a body to GitHub". The scrub is unconditional for ' +
      'EVERY provider, so naming one made the rule read as GitHub-only the moment a second ' +
      'provider exists. Rewritten to "to the tracker"; "unconditionally" and the rest are unchanged.',
  },
  {
    file: 'git-agent.md',
    startLine: 50,
    endLine: 50,
    rationale:
      'The `&& gh …` half of the D11 shell-discipline fence. The scrubber invocation on `:49` ' +
      'STAYS — making the containment control loadable is PF-027\'s failure mode — and only the ' +
      'provider\'s post command becomes a placeholder. The concrete GitHub chain is stated once ' +
      'in the GitHub reference, where the `&&` discipline is restated with it.',
  },
  {
    file: 'git-agent.md',
    startLine: 968,
    endLine: 968,
    rationale:
      '`## Principles` item 1 restated both rate-limit thresholds in prose, in a cross-cutting ' +
      'section every spawn loads. Rewritten to keep the 1s/3s policy bounds and the STOP rule ' +
      'and to defer both signals to the provider — otherwise the D4 cut would have been half a fix.',
  },
  {
    file: 'git-agent.md',
    startLine: 990,
    endLine: 990,
    rationale:
      '`## Boundaries` suggested `gh pr create` to the orchestrator. A provider CLI named in ' +
      'always-loaded escalation text is a detector like any other; the advice is kept, the tool ' +
      'name dropped.',
  },

  // ── dist/agents/git.md (P2-S6) ─────────────────────────────────────────────
  {
    file: 'git-agent.md',
    startLine: 541,
    endLine: 541,
    rationale:
      'DR-17 commit B: gather-release-evidence step 4 REWRITTEN, not relocated. The ' +
      'pre-split line resolves closing references with one `gh api` call PER COMMIT — up ' +
      'to 100 remote calls for a 100-commit range (GAP-26). Commit A moved it verbatim; ' +
      'commit B replaced it in the reference with a batch-first `closing_refs_for_commits` ' +
      'query, PR-number dedup and a ≤25 bounded sequential fallback. This is the phase\'s ' +
      'ONE deliberate rewrite of moved text, and its RED proof is the collector at the ' +
      'foot of this file, driven over this same baseline.',
  },

  {
    file: 'SKILL.md',
    startLine: 232,
    endLine: 232,
    rationale:
      'The D3 template heading moved into the ensure-traceable-issue reference DEMOTED to ' +
      '`###`. extractOpSectionFromCorpus slices an op section at the next `\\n## `, so this ' +
      'level-2 heading hid the rest of that reference from every union-mode guard — the ' +
      'hazard T2a recorded and T2b was told to repair in the commit that touches this op. ' +
      'The template body, its fence and its Rules bullets moved byte-identically.',
  },

  // ── skills/git/references/github-api.md (P2-S7 fallout) ────────────────────
  {
    file: 'github-api.md',
    startLine: 19,
    endLine: 20,
    rationale:
      'check_rate_limit\'s "wait, then continue" is the same D4 contradiction the ' +
      'SKILL.md sleep-60 line was cut for, in a file the Git agent loads. Rewritten to ' +
      'emit TRACEABILITY: DEGRADED (rate limited) and return non-zero so the caller STOPs.',
  },
  {
    file: 'github-api.md',
    startLine: 24,
    endLine: 24,
    rationale:
      'The `check_rate_limit` call site now honours the STOP: `check_rate_limit || exit 1`. ' +
      'Leaving the bare call would have made the rewritten function advisory.',
  },
  {
    file: 'github-api.md',
    startLine: 250,
    endLine: 250,
    rationale:
      'Complete Release Flow posted release notes inline (`--notes "$changelog"`). It sits ' +
      'in the same file as the --notes-file recipe moved in from SKILL.md, so leaving it ' +
      'would have re-created the two-authorities defect one section apart. The multi-line ' +
      'form is invisible to INLINE_BODY_RE, which is why it needed fixing by hand.',
  },

  // ── skills/git/references/github-api.md → per-op tracker references (P2-S8) ─
  {
    file: 'github-api.md',
    startLine: 137,
    endLine: 137,
    rationale:
      'The `## Issue Operations` container heading has no single destination: its four ' +
      'subsections went to four different operations (fetch-issue, ensure-traceable-issue, ' +
      'manage-debt). Carrying the heading into one of them would have implied the other ' +
      'three live there too.',
  },
  {
    file: 'github-api.md',
    startLine: 184,
    endLine: 184,
    rationale:
      'Tech-debt add: `gh issue comment … --body "$new_item"` became `--body-file ' +
      '"$DEVFLOW_BODY"` on the move. manage-debt is a D11 posting sink, and moving the ' +
      'inline form verbatim would have created a NEW D11 bypass inside the tracker ' +
      'reference tree — the widened INLINE_BODY_RE freezes the pre-existing github-api.md ' +
      'sites only, so a moved copy is a new offender by construction.',
  },
  {
    file: 'github-api.md',
    startLine: 202,
    endLine: 202,
    rationale:
      'Tech-debt archive back-link: same rewrite, same reason as :184.',
  },
  {
    file: 'github-api.md',
    startLine: 283,
    endLine: 283,
    rationale:
      '`## Branch Name from Issue` moved into the setup-task reference DEMOTED to `###`. ' +
      'extractOpSectionFromCorpus slices an op section to the next `\\n## `, so a second ' +
      'level-2 heading inside a generated reference truncates every union-mode guard at ' +
      'that point. The recipe itself moved byte-identically.',
  },
  {
    file: 'github-api.md',
    startLine: 466,
    endLine: 467,
    rationale:
      'batch_api_calls had the third `sleep 60` wait-and-continue. Rewritten to break out ' +
      'of the fan-out after emitting the DEGRADED line, which is what D4 requires and what ' +
      'the caller reports as THROTTLED ({n} not processed).',
  },
];

/** Exemptions grouped by baseline file, as a set of 1-based line numbers. */
function exemptedLines(
  exemptions: readonly ContainmentExemption[],
): ReadonlyMap<string, ReadonlySet<number>> {
  const byFile = new Map<string, Set<number>>();
  for (const entry of exemptions) {
    let lines = byFile.get(entry.file);
    if (lines === undefined) {
      lines = new Set<number>();
      byFile.set(entry.file, lines);
    }
    for (let n = entry.startLine; n <= entry.endLine; n++) lines.add(n);
  }
  return byFile;
}

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

interface UnaccountedLine {
  readonly file: string;
  /** 1-based line number in the baseline. */
  readonly line: number;
  readonly text: string;
}

interface ContainmentScan {
  readonly unaccounted: readonly UnaccountedLine[];
  /** Non-structural, non-exempt baseline lines actually compared. */
  readonly linesScanned: number;
}

/**
 * Named collector: every baseline line that is neither structural, nor exempt,
 * nor present byte-identically in some target.
 *
 * Parameterised on all three inputs so the known-bad probe below drives the SAME
 * code path the real assertion does — a probe that re-implements the comparison
 * proves only that the probe works.
 */
function collectUnaccountedLines(
  baselines: readonly Baseline[],
  targetLines: ReadonlySet<string>,
  exemptions: readonly ContainmentExemption[],
): ContainmentScan {
  const exempt = exemptedLines(exemptions);
  const unaccounted: UnaccountedLine[] = [];
  let linesScanned = 0;

  for (const baseline of baselines) {
    const exemptHere = exempt.get(baseline.file);
    baseline.lines.forEach((text, index) => {
      const lineNumber = index + 1;
      if (isStructuralLine(text)) return;
      if (exemptHere?.has(lineNumber)) return;
      linesScanned++;
      if (!targetLines.has(text)) {
        unaccounted.push({ file: baseline.file, line: lineNumber, text });
      }
    });
  }

  return { unaccounted, linesScanned };
}

function renderUnaccounted(lines: readonly UnaccountedLine[]): string {
  return lines
    .slice(0, 40)
    .map(u => `  ${u.file}:${u.line}  ${JSON.stringify(u.text)}`)
    .join('\n') + (lines.length > 40 ? `\n  …and ${lines.length - 40} more` : '');
}

// ---------------------------------------------------------------------------
// 1. Zero unaccounted lines
// ---------------------------------------------------------------------------

describe('containment: baseline ∪ exemptions — zero unaccounted lines (AC-2.1)', () => {
  it('every baseline line survives byte-identically in git.md, a generated reference, or the git skill', () => {
    const scan = collectUnaccountedLines(BASELINES, TARGET_LINES, CONTAINMENT_EXEMPTIONS);
    expect(
      scan.unaccounted.length,
      `${scan.unaccounted.length} baseline line(s) exist in no target and no exemption — ` +
      `each is either a lost move or a rewrite that owes CONTAINMENT_EXEMPTIONS an entry:\n` +
      renderUnaccounted(scan.unaccounted),
    ).toBe(0);
  });

  it('the scan is non-vacuous: it compared a real corpus against real targets', () => {
    const scan = collectUnaccountedLines(BASELINES, TARGET_LINES, CONTAINMENT_EXEMPTIONS);
    expect(scan.linesScanned, 'no baseline line was compared — the oracle is inert').toBeGreaterThan(0);
    expect(TARGET_LINES.size, 'the target corpus is empty — every line would read as lost').toBeGreaterThan(0);
    expect(
      BASELINES.map(b => b.file),
      'all three baselines must be loaded',
    ).toEqual(['git-agent.md', 'SKILL.md', 'github-api.md']);
  });

  it('known-bad probe: a baseline line present in no target is reported by the same collector', () => {
    const seeded: Baseline[] = [
      { file: 'probe.md', lines: ['This sentence exists in no devflow artifact whatsoever.'] },
    ];
    const scan = collectUnaccountedLines(seeded, TARGET_LINES, CONTAINMENT_EXEMPTIONS);
    expect(
      scan.unaccounted.map(u => `${u.file}:${u.line}`),
      'the collector must see a line that is absent from every target — otherwise ' +
      'the zero-unaccounted assertion is satisfied by a scan that looks at nothing',
    ).toEqual(['probe.md:1']);
  });

  it('known-bad probe: an exemption silences exactly its own range and nothing else', () => {
    const seeded: Baseline[] = [
      { file: 'probe.md', lines: ['absent line one', 'absent line two'] },
    ];
    const scan = collectUnaccountedLines(seeded, TARGET_LINES, [
      { file: 'probe.md', startLine: 1, endLine: 1, rationale: 'probe' },
    ]);
    expect(scan.unaccounted.map(u => u.line)).toEqual([2]);
    expect(scan.linesScanned, 'the exempted line must not be counted as scanned').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The exemption list is well-formed
// ---------------------------------------------------------------------------

describe('containment: rewrite exemption list — justified [DR-17]', () => {
  it('is non-empty — AC-2.1\'s "only intended moves" half has something to check', () => {
    expect(
      CONTAINMENT_EXEMPTIONS.length,
      'the exemption list is empty while deliberate rewrites exist — the zero-unaccounted ' +
      'assertion would then be passing for the wrong reason',
    ).toBeGreaterThan(0);
  });

  it('every entry names a real baseline range and gives a reason', () => {
    const problems: string[] = [];
    const byName = new Map(BASELINES.map(b => [b.file, b]));
    for (const entry of CONTAINMENT_EXEMPTIONS) {
      const baseline = byName.get(entry.file);
      const where = `${entry.file}:${entry.startLine}-${entry.endLine}`;
      if (baseline === undefined) {
        problems.push(`${where}: no such baseline fixture`);
        continue;
      }
      if (entry.startLine < 1 || entry.endLine < entry.startLine) {
        problems.push(`${where}: range is inverted or below line 1`);
      }
      if (entry.endLine > baseline.lines.length) {
        problems.push(`${where}: past the end of the baseline (${baseline.lines.length} lines)`);
      }
      if (entry.rationale.trim().length === 0) {
        problems.push(`${where}: empty rationale — an exemption without a reason is a deletion`);
      }
    }
    expect(problems, `malformed exemption entries:\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  it('no entry exempts a range that is in fact still contained', () => {
    // An exemption that is not needed is an exemption nobody will notice going
    // stale, and it silences the one line a later edit might genuinely lose.
    const byName = new Map(BASELINES.map(b => [b.file, b]));
    const unnecessary: string[] = [];
    for (const entry of CONTAINMENT_EXEMPTIONS) {
      const baseline = byName.get(entry.file);
      if (baseline === undefined) continue;
      const covered = baseline.lines
        .slice(entry.startLine - 1, entry.endLine)
        .filter(line => !isStructuralLine(line));
      if (covered.length > 0 && covered.every(line => TARGET_LINES.has(line))) {
        unnecessary.push(`${entry.file}:${entry.startLine}-${entry.endLine}`);
      }
    }
    expect(
      unnecessary,
      `exemption(s) covering ranges that are still fully contained — remove them:\n  ${unnecessary.join('\n  ')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Structural parity and per-file non-emptiness
// ---------------------------------------------------------------------------

const REFS_DIR = compiledSkillRefsDir();

/** The generated GitHub mechanics files, keyed by op. */
function generatedTrackerFiles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walkFiles(path.join(REFS_DIR, 'tracker', 'github'), f => f.endsWith('.md'), 1)) {
    found.set(path.basename(file, '.md'), requireFile('generated reference', file));
  }
  return found;
}

/**
 * Minimum characters a generated reference must carry.
 *
 * A zero-byte file is already refused by splitVariantSections' empty-section arm;
 * this floor catches the next shape up — a file that kept its heading and lost its
 * body, which compiles and ships and reads downstream as "mechanics unavailable".
 */
const MIN_REFERENCE_CHARS = 80;

describe('containment: structural parity — every op has a file and every file has an op', () => {
  const files = generatedTrackerFiles();

  it('the registry and the emitted tree agree in both directions', () => {
    expect([...files.keys()].sort()).toEqual([...TRACKER_GITHUB_OPS].sort());
  });

  it('the parity check is non-vacuous: enough pairs to discriminate', () => {
    const expansion = expandVariants();
    expect(expansion.ok, 'the variant registry must expand').toBe(true);
    if (!expansion.ok) return;
    expect(
      expansion.value.length,
      `only ${expansion.value.length} (module, op) pair(s) — a list short enough to enumerate ` +
      `by hand satisfies any implementation that returns something (GAP-42)`,
    ).toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
    expect(VARIANT_MODULES.length, 'at least one reference module must be registered').toBeGreaterThan(0);
    expect(files.size, 'no generated reference was found at all').toBeGreaterThan(0);
  });

  it('every generated reference is non-empty and opens with its own `## Operation:` anchor', () => {
    // The anchor is not decoration: the D11 forward/reverse guards find moved
    // mechanics through `extractOpSectionFromCorpus(..., { mode: 'union' })`, which
    // keys on exactly this heading. A reference titled anything else is invisible
    // to the sink-class guards the moment its mechanics arrive.
    const problems: string[] = [];
    for (const op of TRACKER_GITHUB_OPS) {
      const content = files.get(op);
      if (content === undefined) {
        problems.push(`${op}: no generated file`);
        continue;
      }
      if (content.length < MIN_REFERENCE_CHARS) {
        problems.push(`${op}: ${content.length} ch, floor ${MIN_REFERENCE_CHARS}`);
      }
      if (!content.startsWith(`## Operation: ${op}\n`)) {
        problems.push(
          `${op}: must begin with "## Operation: ${op}" — got ${JSON.stringify(content.split('\n')[0])}`,
        );
      }
    }
    expect(problems, `generated reference problems:\n  ${problems.join('\n  ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. gather-release-evidence — the batch-first rewrite [DR-17 commit B, H12]
// ---------------------------------------------------------------------------
//
// Commit A moved the step byte-identically; commit B replaced the per-commit
// fan-out (up to 100 `gh api` calls for a 100-commit range, the N+1 GAP-26
// names) with a batch-first resolution plus a bounded sequential fallback.
// It is the ONE deliberate rewrite of moved text in this phase, which is why
// its baseline range is the entry CONTAINMENT_EXEMPTIONS exists for.
//
// The probe is permanent rather than anecdotal: it runs the SAME collector over
// tests/fixtures/tracker/baseline/git-agent.md, which still holds the pre-split
// line byte-exactly. H10 — the fix is never un-landed to show red.

/** Named collector: per-commit fan-out lines in a release-evidence mechanics text. */
function collectPerCommitFanout(text: string): string[] {
  return text.split('\n').filter(line => /each commit/i.test(line) && /gh api/i.test(line));
}

describe('gather-release-evidence: batch-first, never one call per commit [DR-17]', () => {
  const RELEASE_EVIDENCE = path.join(REFS_DIR, 'tracker', 'github', 'gather-release-evidence.md');

  it('the moved mechanics state the ≤25 sequential sub-bound', () => {
    const text = requireFile('generated reference', RELEASE_EVIDENCE);
    expect(
      text,
      'the bounded sequential fallback must name its own limit — an unbounded fallback is the ' +
      'N+1 fan-out with an extra step in front of it',
    ).toContain('≤25');
  });

  it('the moved mechanics carry no per-commit `gh api` loop', () => {
    const text = requireFile('generated reference', RELEASE_EVIDENCE);
    expect(
      collectPerCommitFanout(text),
      'a per-commit `gh api` loop resolves a 100-commit range with 100 remote calls, which is ' +
      'the exposure GAP-26 names and what commit B replaced',
    ).toEqual([]);
  });

  it('known-bad probe: the pre-rewrite line is reported by the same collector', () => {
    const baseline = BASELINES.find(b => b.file === 'git-agent.md');
    expect(baseline, 'the git-agent.md baseline must be loaded').toBeDefined();
    expect(
      collectPerCommitFanout(baseline!.lines.join('\n')).length,
      'the collector must see the pre-split fan-out line in the committed baseline — otherwise ' +
      'the assertion above is satisfied by a scan that recognises nothing',
    ).toBe(1);
  });

  it('H12: the D4 item-degradation clause stays with the operation in git.md', () => {
    // The rewrite introduces new remote failure modes (a batch call that 4xx\'s
    // where 100 individual calls previously item-degraded per D4), so the clause
    // that says "degrade the item, continue" must remain in the always-loaded file.
    const git = resolveAgentSource('git');
    const start = git.content.indexOf('## Operation: gather-release-evidence');
    expect(start, 'gather-release-evidence must still be an operation of the agent').toBeGreaterThan(-1);
    const next = git.content.indexOf('\n## Operation:', start + 1);
    const section = next === -1 ? git.content.slice(start) : git.content.slice(start, next);
    expect(section, 'gather-release-evidence: **Degradation (D4):** clause missing').toContain(
      '**Degradation (D4):**',
    );
    expect(
      section,
      'gather-release-evidence: the per-item degrade rule must stay in git.md (H12)',
    ).toContain('for any GitHub signal that could not be fetched');
  });
});

// ---------------------------------------------------------------------------
// 5. The shared-literal registry [DR-19]
// ---------------------------------------------------------------------------
//
// The three cross-cutting references — publication-gate.md, learn-conventions.md
// and decision-markers.md — exist so a rule is stated ONCE and named from wherever
// it applies. The failure that re-creates the defect they were built to remove is
// a provider reference RESTATING one of their sentences: the rule then has two
// authorities again, and the second one varies per provider.
//
// Both arms, per [DR-19]:
//   positive — every registry sentence appears in exactly one of the three files,
//              and in the one the registry names;
//   negative — no registry sentence appears in any references/tracker/{provider}/
//              {op}.md.
//
// The MCP arm lands in Phase 3 (P3c-S6); `_mcp.md` does not exist here.

interface SharedLiteral {
  /** Basename of the cross-cutting reference that owns the sentence. */
  readonly owner: string;
  /** The normative sentence, byte-exact. */
  readonly sentence: string;
  /** Why this sentence is normative — an entry without one is a grep, not a rule. */
  readonly justification: string;
}

export const SHARED_LITERAL_REGISTRY: readonly SharedLiteral[] = [
  {
    owner: 'publication-gate.md',
    sentence:
      'Applies to **`post-review-summary` and `post-resolution-summary` only.** No other op probes repo visibility.',
    justification:
      'The D10 scope rule. A provider reference restating it would let that provider decide ' +
      'which of its ops may probe visibility, which is exactly the scope property [DR-20] pins.',
  },
  {
    owner: 'publication-gate.md',
    sentence: '**Fail-closed rule: on any error or unrecognised value, treat as PUBLIC (mode STUB).**',
    justification:
      'The fail-closed default. Restated per provider it becomes fail-OPEN the first time one ' +
      'copy is edited, and the failure mode is a full review summary posted on a public repo.',
  },
  {
    owner: 'learn-conventions.md',
    sentence: '**The scanned strings are UNTRUSTED third-party input.**',
    justification:
      'The security premise of the whole bounded scan. DR-15 generates this file precisely so ' +
      'this paragraph never exists in a second, independently maintained copy.',
  },
  {
    owner: 'learn-conventions.md',
    sentence:
      "- Branches: `git branch -r --format='%(refname:short)' | head -50` — detect prefix/separator patterns",
    justification:
      'One of the four bounded-scan literals Guard 2 pins. A second statement of the bound is a ' +
      'second authority on how much history the scan may read (GAP-25).',
  },
  {
    owner: 'learn-conventions.md',
    sentence:
      '1. Check if `.devflow/conventions.md` already exists. If yes: return `Status: ALREADY_EXISTS` — do not overwrite.',
    justification:
      'The never-overwrite rule for a git-tracked, team-shared file. A provider copy that omitted ' +
      'it would silently rewrite conventions the team agreed on.',
  },
  {
    owner: 'decision-markers.md',
    sentence:
      '| D9 | Thread-resolution gate — `resolveReviewThread` is called only when `VERIFICATION_STATUS == PASS` AND verdict `FIXED` AND `commit_sha` non-empty |',
    justification:
      'The D9 gate definition. Its single authority is the reason the D9 caller guard can compare ' +
      'resolve.mds against one fragment rather than a per-provider family of them.',
  },
  {
    owner: 'decision-markers.md',
    sentence:
      '| D10 | Publication gate — probe repo visibility before posting summary comments; fail-closed to STUB on public repo or any error (`post-review-summary` and `post-resolution-summary` only) |',
    justification:
      'The D10 label definition, distinct from the gate mechanics it labels. Two definitions of one ' +
      'marker is the D9 divergence Phase 0 exists to repair, reproduced on a new label.',
  },
];

/** The generated cross-cutting reference files, keyed by basename. */
function crossCuttingFiles(): Map<string, string> {
  const found = new Map<string, string>();
  for (const doc of GIT_CROSS_CUTTING_DOCS) {
    const file = path.join(REFS_DIR, `${doc}.md`);
    found.set(`${doc}.md`, requireFile('cross-cutting reference', file));
  }
  return found;
}

/** Named collector: files (labelled) that contain a given sentence. */
function collectRestatements(
  sentence: string,
  corpus: ReadonlyArray<{ label: string; content: string }>,
): string[] {
  return corpus.filter(entry => entry.content.includes(sentence)).map(entry => entry.label);
}

/** The generated per-provider mechanics files, as a labelled corpus. */
function providerReferenceCorpus(): Array<{ label: string; content: string }> {
  return walkFiles(path.join(REFS_DIR, 'tracker'), f => f.endsWith('.md')).map(file => ({
    label: path.relative(REFS_DIR, file).split(path.sep).join('/'),
    content: requireFile('generated reference', file),
  }));
}

describe('shared-literal registry — one authority per normative sentence [DR-19]', () => {
  it('is non-empty, covers every cross-cutting document, and justifies every entry', () => {
    expect(
      SHARED_LITERAL_REGISTRY.length,
      'an empty registry makes both arms below pass by checking nothing (PF-018)',
    ).toBeGreaterThan(0);
    expect(
      [...new Set(SHARED_LITERAL_REGISTRY.map(e => e.owner))].sort(),
      'every cross-cutting document must contribute at least one normative sentence — a document ' +
      'with none is a document the negative arm cannot protect',
    ).toEqual(GIT_CROSS_CUTTING_DOCS.map(d => `${d}.md`).sort());
    expect(
      SHARED_LITERAL_REGISTRY.filter(e => e.justification.trim().length === 0).map(e => e.sentence),
      'a registry entry with no justification is a grep, not a rule',
    ).toEqual([]);
  });

  it('positive arm: every registry sentence lives in exactly one cross-cutting document, the one named', () => {
    const corpus = [...crossCuttingFiles()].map(([label, content]) => ({ label, content }));
    const problems: string[] = [];
    for (const entry of SHARED_LITERAL_REGISTRY) {
      const owners = collectRestatements(entry.sentence, corpus);
      if (owners.length !== 1 || owners[0] !== entry.owner) {
        problems.push(
          `${JSON.stringify(entry.sentence.slice(0, 60))} → expected [${entry.owner}], found [${owners.join(', ')}]`,
        );
      }
    }
    expect(problems, `shared-literal ownership problems:\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  it('negative arm: no registry sentence is restated in any provider mechanics file', () => {
    const providers = providerReferenceCorpus();
    expect(
      providers.length,
      'no provider reference was read — the negative arm would be vacuous',
    ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);

    const restatements: string[] = [];
    for (const entry of SHARED_LITERAL_REGISTRY) {
      for (const file of collectRestatements(entry.sentence, providers)) {
        restatements.push(`${file}: ${JSON.stringify(entry.sentence.slice(0, 60))}`);
      }
    }
    expect(
      restatements,
      'a provider mechanics file restates a sentence that has a single authority — the rule now ' +
      'has two homes and the second one varies per provider:\n  ' + restatements.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a seeded restatement in a provider file is reported by the same collector', () => {
    const seeded = [
      ...providerReferenceCorpus(),
      { label: 'tracker/github/probe.md', content: `prelude\n${SHARED_LITERAL_REGISTRY[0].sentence}\ntail\n` },
    ];
    expect(
      collectRestatements(SHARED_LITERAL_REGISTRY[0].sentence, seeded),
      'the collector must see a restatement in a provider file — otherwise the negative arm is inert',
    ).toEqual(['tracker/github/probe.md']);
  });
});
