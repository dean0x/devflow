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
  generatedReferenceManifest,
} from '../../src/core/mds-variants.js';
import { ROOT, resolveAgentSource, walkFiles } from '../helpers.js';
import {
  CONTAINMENT_EXEMPTIONS,
  type ContainmentExemption,
} from '../fixtures/containment-exemptions.js';

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
//
// The table itself — 48 entries and their rationales — is data, and lives in
// tests/fixtures/containment-exemptions.ts so this file holds the oracle rather
// than the list it reads. The three arms that police the list are here: zero
// unaccounted baseline lines, no entry for a range that is in fact still
// contained, and every rationale at or above the floor below.

/**
 * Minimum characters a rationale must carry.
 *
 * An emptiness-only check is cleared by `rationale: 'x'`, which records that
 * someone typed something — not why a line the oracle would otherwise report as
 * lost is allowed to be missing. 40 characters is roughly one clause: enough to
 * name what was rewritten and what replaced it, which is the sentence [DR-17]
 * asks for. It is a floor on effort, not on prose quality; every entry in the
 * table clears it by a wide margin.
 */
const MIN_RATIONALE_CHARS = 40;

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
      const rationale = entry.rationale.trim();
      if (rationale.length < MIN_RATIONALE_CHARS) {
        problems.push(
          `${where}: rationale is ${rationale.length} ch, floor ${MIN_RATIONALE_CHARS} — ` +
          'an exemption without a reason is a deletion',
        );
      }
    }
    expect(problems, `malformed exemption entries:\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  it('known-bad probe: a token rationale is reported by the same length rule', () => {
    // Emptiness-only was satisfied by `rationale: 'x'` — a string that records a
    // keystroke, not a reason. The probe drives the SAME predicate over seeded
    // entries so the floor is proven live rather than asserted about (PF-018).
    const seeded: readonly ContainmentExemption[] = [
      { file: 'probe.md', startLine: 1, endLine: 1, rationale: '' },
      { file: 'probe.md', startLine: 2, endLine: 2, rationale: 'x' },
      { file: 'probe.md', startLine: 3, endLine: 3, rationale: 'moved on purpose' },
      { file: 'probe.md', startLine: 4, endLine: 4, rationale: 'a'.repeat(MIN_RATIONALE_CHARS) },
    ];
    const tooShort = seeded
      .filter(e => e.rationale.trim().length < MIN_RATIONALE_CHARS)
      .map(e => e.startLine);
    expect(
      tooShort,
      'the length rule must reject the empty, the single-character and the 16-character ' +
      'rationales and accept only the one that clears the floor',
    ).toEqual([1, 2, 3]);
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

// ---------------------------------------------------------------------------
// 6. AC-2.7 (positive form) — every generated reference is reachable on the gh path
// ---------------------------------------------------------------------------
//
// AC-2.7 was amended from "no orphan" to the positive claim: every generated
// Phase-2 reference line is REACHABLE. "Reachable" is defined structurally so the
// check is mechanical rather than a reading of the preamble:
//
//   a generated file is reachable ⇔ instantiating the preamble's SINGLE load
//   instruction with provider `github` and an op from TRACKER_GITHUB_OPS yields
//   that file's path.
//
// Both directions, because either one alone is satisfiable by an accident: a file
// nothing can name is dead weight installed on every user's machine (ADR-003), and
// an op the instruction can name with no file behind it is the
// `tracker mechanics unavailable` degradation shipped as the normal path.
//
// The instruction is read out of the compiled agent rather than restated here —
// restating it would let the two drift and still pass (PF-018).

/** The `{provider}` / `{op}` template the preamble's one load instruction composes. */
const LOAD_INSTRUCTION_TEMPLATE = 'references/tracker/{provider}/{op}.md';

/** Named collector: lines of the compiled agent that name a `references/tracker/` path. */
function collectTrackerNamingLines(content: string): string[] {
  return content.split('\n').filter(line => line.includes('references/tracker/'));
}

/**
 * Named collector: the relative paths the load instruction can reach for a
 * provider, given a roster of ops. Derived from the template, never hand-listed.
 */
function reachablePaths(template: string, provider: string, ops: readonly string[]): string[] {
  return ops.map(op => template.replace('{provider}', provider).replace('{op}', op)
    .replace('references/', ''));
}

/**
 * Named collector: every literal `references/<name>.md` the compiled agent spells
 * out, as a manifest-relative path.
 *
 * The templated tracker instruction is skipped — it is handled by reachablePaths
 * above, and a `{provider}`/`{op}` path is not a name any one file answers to.
 * This is the OTHER half of reachability: the three cross-cutting documents are
 * not reached by instantiating a template, they are named individually at exactly
 * one site each [GIT_CROSS_CUTTING_DOCS, 'named' module kind].
 */
function collectLiteralReferenceNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const match of content.matchAll(/references\/([A-Za-z0-9._/{}-]+\.md)/g)) {
    if (match[1].includes('{')) continue;
    names.add(match[1]);
  }
  return names;
}

describe('containment: every generated GitHub reference is reachable on the gh path (AC-2.7)', () => {
  const agent = resolveAgentSource('git');

  it('the preamble states exactly one load instruction, and it is the template', () => {
    const naming = collectTrackerNamingLines(agent.content);
    expect(
      naming.length,
      `expected exactly one line naming a references/tracker/ path, found ${naming.length}:\n  ` +
      naming.join('\n  '),
    ).toBe(1);
    expect(
      naming[0],
      'the single load instruction must compose the path from BOTH placeholders — an instruction ' +
      'that hard-codes either one cannot reach the tree the registry emits',
    ).toContain(LOAD_INSTRUCTION_TEMPLATE);
  });

  it('every op in the registry is reachable, and every emitted file is reachable (both directions)', () => {
    // Scope: the WHOLE manifest, not the tracker/ subtree. Walking only
    // tracker/ excluded the three GIT_CROSS_CUTTING_DOCS from BOTH directions —
    // decision-markers.md, learn-conventions.md and publication-gate.md are
    // generated, installed on every machine and shipped in the tarball, and were
    // in neither "is it named" nor "is it emitted". A cross-cutting document that
    // lost its one naming line was exactly as invisible here as an orphan file.
    const reachable = new Set([
      ...reachablePaths(LOAD_INSTRUCTION_TEMPLATE, 'github', TRACKER_GITHUB_OPS),
      // The 'named' module kind: reachable ⇔ the compiled agent spells the path
      // out literally. Read out of the agent, never restated here (PF-018).
      ...[...collectLiteralReferenceNames(agent.content)].filter(rel =>
        (GIT_CROSS_CUTTING_DOCS as readonly string[]).includes(path.basename(rel, '.md')),
      ),
    ]);

    const emitted = walkFiles(REFS_DIR, f => f.endsWith('.md'))
      .map(f => path.relative(REFS_DIR, f).split(path.sep).join('/'));

    // The walk must see the whole manifest — a narrowed walk is how this check
    // lost the cross-cutting docs in the first place.
    expect(
      [...emitted].sort(),
      'the emitted tree and the install manifest must be the same set — a file in one and not ' +
      'the other is either shipped unreachable or named and absent',
    ).toEqual([...generatedReferenceManifest()].sort());

    const unreachable = emitted.filter(rel => !reachable.has(rel));
    expect(
      unreachable,
      'generated reference file(s) no load instruction can name — installed on every machine and ' +
      'read by nothing (ADR-003):\n  ' + unreachable.join('\n  '),
    ).toEqual([]);

    const missing = [...reachable].filter(rel => !emitted.includes(rel));
    expect(
      missing,
      'the agent can name file(s) the build does not emit — every spawn that runs those ops takes ' +
      'the `tracker mechanics unavailable` degradation as its normal path:\n  ' +
      missing.join('\n  '),
    ).toEqual([]);
  });

  it('the reachability check is non-vacuous on both sides', () => {
    expect(TRACKER_GITHUB_OPS.length, 'empty op roster').toBeGreaterThanOrEqual(MIN_VARIANT_PAIRS);
    expect(GIT_CROSS_CUTTING_DOCS.length, 'empty cross-cutting roster').toBeGreaterThan(0);
    expect(
      walkFiles(REFS_DIR, f => f.endsWith('.md')).length,
      'no generated reference files at all — run `npm run build`',
    ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length + GIT_CROSS_CUTTING_DOCS.length);
  });

  it('known-bad probe: an emitted file outside the registry is reported as unreachable', () => {
    const reachable = new Set(reachablePaths(LOAD_INSTRUCTION_TEMPLATE, 'github', TRACKER_GITHUB_OPS));
    const emitted = ['tracker/github/setup-task.md', 'tracker/github/smuggled.md'];
    expect(emitted.filter(rel => !reachable.has(rel))).toEqual(['tracker/github/smuggled.md']);
  });

  it('known-bad probe: a cross-cutting doc whose naming line is removed is reported', () => {
    // The direction the tracker-only walk could not express. Strip one document's
    // single naming line from a COPY of the agent and drive the SAME collector:
    // the file is still emitted, still installed, and now reachable by nothing.
    const target = 'decision-markers.md';
    const stripped = agent.content
      .split('\n')
      .filter(line => !line.includes(`references/${target}`))
      .join('\n');
    expect(stripped, 'the strip must actually change the agent copy').not.toBe(agent.content);

    const namedInReal = collectLiteralReferenceNames(agent.content);
    const namedInStripped = collectLiteralReferenceNames(stripped);
    expect(
      namedInReal.has(target),
      `${target} must be named in the real agent — otherwise this probe proves nothing`,
    ).toBe(true);
    expect(
      namedInStripped.has(target),
      'the collector must stop seeing the name once its line is gone — otherwise the reachability ' +
      'direction is green for a document nothing can load (PF-018)',
    ).toBe(false);

    // …and the same set difference the live check computes now reports it.
    const reachable = new Set([
      ...reachablePaths(LOAD_INSTRUCTION_TEMPLATE, 'github', TRACKER_GITHUB_OPS),
      ...[...namedInStripped].filter(rel =>
        (GIT_CROSS_CUTTING_DOCS as readonly string[]).includes(path.basename(rel, '.md')),
      ),
    ]);
    expect(generatedReferenceManifest().filter(rel => !reachable.has(rel))).toEqual([target]);
  });

  it('known-bad probe: a seeded 14th manifest entry is reported against the emitted tree', () => {
    const emitted = walkFiles(REFS_DIR, f => f.endsWith('.md'))
      .map(f => path.relative(REFS_DIR, f).split(path.sep).join('/'));
    const seededManifest = [...generatedReferenceManifest(), 'tracker/github/smuggled.md'];
    expect(
      seededManifest.filter(rel => !emitted.includes(rel)),
      'a manifest entry with no emitted file must be reported — the install would copy nothing ' +
      'and the agent would name a path that does not exist',
    ).toEqual(['tracker/github/smuggled.md']);
  });
});
