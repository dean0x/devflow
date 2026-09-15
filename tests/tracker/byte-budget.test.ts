/**
 * Byte budget for the tracker contract/mechanics split (AC-2.5, GAP-01).
 *
 * The split can be "satisfied" while the total gets worse: mechanics leave the
 * always-loaded agent and come back as a reference the same spawn loads anyway.
 * This file pins the budget from the corrected baseline so that cannot happen
 * quietly, and records the four candidate shapes so the shape decision is not
 * re-litigated from memory.
 *
 * THREE ASSERTIONS HERE WERE RED WHEN THE PHASE BRANCHED — deliberately, as its
 * progress meter, and they are named as such at their call sites:
 *   - chars(skills/git/SKILL.md)     <= BUDGET_SKILL_MD   — GREEN since the P2-S7 cut
 *   - chars(dist/agents/git.md)      <= BUDGET_GIT_MD     — red until the op mechanics move
 *   - the worst-case loaded set      <= BUDGET_LOADED_SET — red until the same move
 * None of them is skipped. A skipped budget asserts nothing and reads as "fine"
 * in a CI log (PF-018); a red one is the measurement the phase is steering by.
 *
 * UNIT: characters, not bytes, throughout — `wc -m` semantics. JS `.length`
 * counts UTF-16 code units, which equals `wc -m` for this corpus (every
 * non-ASCII character in it is BMP: em-dashes, arrows, ≤, §). Byte counts are
 * recorded alongside in the table so the two are never confused, but every
 * budget constant is in characters.
 *
 * Every dist read is fail-loud: an absent artifact throws with a build hint
 * rather than making the budget pass by measuring nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

import { skillsDir, compiledSkillRefsDir } from '../../src/core/assets.js';
import { TRACKER_GITHUB_OPS, MIN_VARIANT_PAIRS } from '../../src/core/mds-variants.js';
import { resolveAgentSource } from '../helpers.js';

// ---------------------------------------------------------------------------
// Budget constants — every one carries its derivation. Never a bare number.
// ---------------------------------------------------------------------------

/**
 * Design-time derivation: 65_677 − 9_813 = 55_864, pinned at 55_900 (headroom 36).
 * formula: baseline_ch − projected_cut; the baseline is the post-Phase-0
 * merge-commit capture of dist/agents/git.md (65_677 ch / 66_180 bytes).
 * projected cut: tracker mechanics −9_400 · learn-conventions body −3_300 ·
 * marker legend −1_400 (the D4 and D11 rows stay, E10) · D10 step-order −1_113 ·
 * add-back +5_400.
 *
 * THE RULE: this ceiling is a REGRESSION ALARM, and it is RE-DERIVED ONLY DOWNWARD —
 * lowered after a condensing pass that actually cut the artifact, never raised to fit
 * one that grew. A budget that rises to meet the artifact is a description, not a
 * budget (§14.5).
 *
 * LOWERED 55_900 → 55_750 after the Mechanics-pointer condensing pass: B31 replaced
 * the eleven per-op pointer sentences with `**Mechanics:** load this operation's
 * provider reference.` (55_896 → 55_577 ch) and B32 landed back at 55_664. 55_750
 * leaves 86 ch of headroom over that measurement — deliberately thin, so the next
 * content addition to git.mds must fund itself with a cut elsewhere.
 *
 * Registered as a `ceilings` entry (`budget-git-md`) in
 * tests/fixtures/numeric-floors.json. Lowering re-pins that entry's value AND its
 * pattern in the same commit; that is the permitted direction for a ceiling, and the
 * manifest guard's probe still proves an INCREMENT would go red.
 */
const BUDGET_GIT_MD = 55_750;

/**
 * 9_204 − 2_604 = 6_600.
 * cut: the D3 traceability template, the throttling recipe, the PR-comment
 * section, the releases recipe, and the naming-conventions authority block.
 * (Measured at 9_205 ch on this tree — the file drifts by single characters;
 * the budget is derived from the artifact's 9_204 capture and is not re-derived
 * from whatever the file happens to be today.)
 */
const BUDGET_SKILL_MD = 6_600;

/**
 * The PRE-SPLIT preloaded set, re-measured at pin time on this tree:
 *   dist/agents/git.md                        65_677 ch
 * + src/assets/skills/git/SKILL.md             9_205 ch
 * + src/assets/skills/worktree-support/SKILL.md 2_942 ch
 * =                                           77_824 ch
 * The split must not make a tracker spawn cost more than the monolith did.
 *
 * Deliberately a frozen literal rather than TOTAL_CHARS imported from
 * tests/goldens/github-status-lines.test.ts, even though those constants exist
 * for exactly this arithmetic (C6). Those are EQUALITY baselines that move in
 * each golden-regeneration commit; a budget derived from them would follow the
 * artifact down and end up asserting "the current size is the current size".
 * A budget is a number the artifact must reach, so it is pinned to the
 * historical measurement and cited, not recomputed.
 */
const BUDGET_LOADED_SET = 77_824;

/** AC-2.5 [DR-13(a)] — promoted from a handoff deliverable to an assertion. */
const PREAMBLE_MAX_LINES = 40;

/**
 * EQUALITY BASELINE, not a budget — `src/assets/skills/git/references/github-api.md`.
 *
 * D-LOADED-SET-SCOPE excludes this file from the gate on purpose: it is loaded by
 * `fetch-review-threads`, a NON-tracker op that loaded it long before the split, so
 * it is not a cost the split introduces. ADR-025's amendment is what the exclusion
 * owes in return — the excluded term goes in a RECORDED, non-gating row — and a
 * recorded row with no anchor rots, which is exactly what happened here: the PR body
 * and the feature KB both record 17,259 ch while the file on this branch measures
 * 17,539, drifted 280 ch with nothing tracking it.
 *
 * So this is pinned with `toBe`, never `<=`. It is not a ceiling to stay under; it
 * is the number the file IS. THE ONLY COMMIT THAT MAY CHANGE IT IS THE COMMIT THAT
 * EDITS github-api.md's BYTES, and that commit re-pins it here in the same change —
 * the treatment GIT_MD_CHARS gets in tests/goldens/github-status-lines.test.ts.
 * Later work on this branch DOES edit that file (batches B20 and B23), so each of
 * those is expected to land a new value here; a red equality pin means "re-measure
 * and re-pin", never "relax the assertion".
 *
 * Measured, never hand-typed:
 *   node -e "console.log(require('fs').readFileSync('src/assets/skills/git/references/github-api.md','utf-8').length)"
 */
const GITHUB_API_MD_CHARS = 19_576;

// ---------------------------------------------------------------------------
// Fail-loud measurement
// ---------------------------------------------------------------------------

interface Measurement {
  label: string;
  chars: number;
  bytes: number;
  present: boolean;
}

/** Measure a file that MUST exist; throws with a build hint when it does not. */
function measureRequired(label: string, filePath: string): Measurement {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `${label}: ${filePath} is absent — run \`npm run build\` first\n` +
      '  (the byte budget reads built artifacts and cannot be skipped)',
    );
  }
  return { label, chars: content.length, bytes: Buffer.byteLength(content, 'utf-8'), present: true };
}

/**
 * Measure a file that may not exist yet, as a recorded 0 row.
 *
 * Used only for the four-shape table's NAMED rows (learn-conventions.md,
 * publication-gate.md): they are T2 deliverables, and a table that threw on
 * their absence could not record the cost they are about to add. Tolerating
 * absence here is not tolerating it in the budget — nothing that gates on a
 * number reads a row through this function.
 */
function measureOptional(label: string, filePath: string): Measurement {
  if (!existsSync(filePath)) return { label, chars: 0, bytes: 0, present: false };
  return measureRequired(label, filePath);
}

const GIT_AGENT = resolveAgentSource('git');
const GIT_SKILL_REFS_SRC = path.join(skillsDir(), 'git', 'references');
const REFS_DIR = compiledSkillRefsDir();

const gitMd = measureRequired('dist/agents/git.md', GIT_AGENT.path);
const skillGit = measureRequired(
  'skills/git/SKILL.md',
  path.join(skillsDir(), 'git', 'SKILL.md'),
);
const skillWorktree = measureRequired(
  'skills/worktree-support/SKILL.md',
  path.join(skillsDir(), 'worktree-support', 'SKILL.md'),
);
/**
 * The gate's one written exclusion, measured at its SOURCE path rather than through
 * resolveReference(): the pin below is on the bytes a commit edits, and a file that
 * were ever shadowed by a generated copy would otherwise move the pin without anyone
 * touching the hand-authored file. Recorded in the table, asserted only for equality.
 */
const githubApiMd = measureRequired(
  'references/github-api.md  (excluded from the gate — pinned, not budgeted)',
  path.join(skillsDir(), 'git', 'references', 'github-api.md'),
);

/** The always-preloaded set: what every Git spawn pays before it does anything. */
const PRELOADED = gitMd.chars + skillGit.chars + skillWorktree.chars;

// ---------------------------------------------------------------------------
// Reference resolution — a skill-relative `references/…` name to a real file
// ---------------------------------------------------------------------------
//
// A reference is addressed skill-relatively, and the installed skill directory
// merges two sources: hand-authored files under src/assets/skills/git/references/
// and generated ones under dist/skills/git/references/. Both are loadable in one
// spawn, so both count.

/** Resolve a `references/…`-relative name to the file that would be loaded. */
function resolveReference(rel: string): string | null {
  for (const base of [REFS_DIR, GIT_SKILL_REFS_SRC]) {
    const candidate = path.join(base, ...rel.split('/'));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function referenceChars(rel: string): number {
  const resolved = resolveReference(rel);
  return resolved === null ? 0 : readFileSync(resolved, 'utf-8').length;
}

/** The generated per-op mechanics file for the GitHub path. */
function trackerRefRel(op: string): string {
  return `tracker/github/${op}.md`;
}

// ---------------------------------------------------------------------------
// The compiled agent, sectioned by operation
// ---------------------------------------------------------------------------

const OP_HEADING_RE = /^## Operation: (\S+)/gm;

/** Every `## Operation:` section in the compiled agent, keyed by op name. */
function opSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const starts: Array<{ op: string; index: number }> = [];
  for (const match of content.matchAll(OP_HEADING_RE)) {
    starts.push({ op: match[1], index: match.index! });
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : content.length;
    sections.set(starts[i].op, content.slice(starts[i].index, end));
  }
  return sections;
}

const SECTIONS = opSections(GIT_AGENT.content);

/** Skill-relative `references/…` names literally mentioned in a slice of text. */
const REFERENCE_MENTION_RE = /references\/([A-Za-z0-9._/{}-]+\.md)/g;

function referenceMentions(text: string): string[] {
  return [...text.matchAll(REFERENCE_MENTION_RE)].map(m => m[1]);
}

/**
 * The reference files an operation's load instructions can name in ONE spawn —
 * derived by SCANNING the compiled agent, independently of the model below.
 *
 * Two sources:
 *   - the preamble's single templated load instruction, instantiated for this op
 *     (registered tracker ops only);
 *   - any literal `references/<name>.md` named inside the op's own section.
 * A templated mention inside a section is skipped: it is a restatement of the
 * preamble's instruction, not a second file.
 */
function nameableFrom(op: string): Set<string> {
  const nameable = new Set<string>();
  if ((TRACKER_GITHUB_OPS as readonly string[]).includes(op)) {
    nameable.add(trackerRefRel(op));
  }
  for (const rel of referenceMentions(SECTIONS.get(op) ?? '')) {
    if (rel.includes('{')) continue;
    nameable.add(rel);
  }
  return nameable;
}

// ---------------------------------------------------------------------------
// The CROSS-CUTTING scope — references named outside every op section
// ---------------------------------------------------------------------------
//
// nameableFrom() reads `## Operation:` sections only. A reference named ABOVE the
// first op heading is therefore in neither direction of the bidirectional check
// below: not summed by the model, and not seen by the scan that is supposed to
// catch what the model missed. `references/decision-markers.md` is named exactly
// there (the Decision Marker Legend, above the first op), so until this scope
// existed it was accounted for by nothing at all.
//
// Two scopes, not one widened scan: a name in the always-loaded part is reachable
// from EVERY spawn, and a name inside an op section is reachable from that op.
// Folding them together would attribute a cross-cutting document to whichever op
// happened to sort first.

/** The always-loaded part of the compiled agent: everything before the first `## Operation:`. */
function crossCuttingSlice(content: string): string {
  const first = content.search(/^## Operation: /m);
  if (first === -1) {
    throw new Error(
      'no `## Operation:` heading in the compiled agent — the cross-cutting slice would be the ' +
      'whole file and every op-scoped name would read as cross-cutting',
    );
  }
  return content.slice(0, first);
}

/** Named collector: the literal `references/…` names the always-loaded part spells out. */
function nameableCrossCutting(content: string): Set<string> {
  const nameable = new Set<string>();
  for (const rel of referenceMentions(crossCuttingSlice(content))) {
    if (rel.includes('{')) continue;
    nameable.add(rel);
  }
  return nameable;
}

/**
 * The cross-cutting references the BUDGET MODEL knows the always-loaded part can
 * name — declared, so the scan above has something independent to disagree with.
 *
 * D-CROSS-CUTTING-ON-DEMAND. These are RECORDED, not added to the asserted
 * loaded-set term, and the distinction is the legend's own wording. git.md says
 * D4 and D11 "are defined here because their controls must be loaded before the
 * agent acts. Every other `D{N}` label IS DEFINED IN … references/decision-markers.md."
 * That is a glossary pointer — where to look up a label — not an instruction to
 * load the file, and the module registry says the same thing in
 * GIT_CROSS_CUTTING_DOCS' own comment: "glossary entries a reader consults, not
 * rules a spawn must have". A term added to the asserted worst case would claim
 * every Git spawn pays 1_681 ch it does not pay.
 *
 * What the assertions below DO owe: that the declared set and the scanned set
 * agree in both directions, so a document named cross-cuttingly can never again
 * be invisible to the budget, and that the cost of treating it as mandatory is
 * printed rather than assumed.
 */
const MODEL_CROSS_CUTTING_ON_DEMAND: readonly string[] = ['decision-markers.md'];

/**
 * The cross-cutting references the BUDGET MODEL attributes to each operation,
 * beyond its own generated mechanics file [DR-12].
 *
 * Declared, not scanned — that is the whole point. The bidirectional check below
 * compares this model against what the compiled agent actually lets an op name;
 * deriving both from one source would make the check a tautology.
 *
 * `learn-conventions.md` is attributed to BOTH `setup-task` and the
 * `learn-conventions` op itself, because both can load it inside one spawn:
 * setup-task step 1b invokes `learn-conventions` when `.devflow/conventions.md`
 * is absent. setup-task is the row that gates — it is a tracker op, so its
 * one-spawn load (own mechanics + learn-conventions.md) is the [DR-12] worst case
 * §5 anticipated.
 */
const MODEL_CROSS_CUTTING_REFS: Readonly<Record<string, readonly string[]>> = {
  'fetch-review-threads': ['github-api.md'],
  'setup-task': ['learn-conventions.md'],
  'learn-conventions': ['learn-conventions.md'],
  'post-review-summary': ['publication-gate.md'],
  'post-resolution-summary': ['publication-gate.md'],
};

/** The file set the budget formula sums for an operation. */
function summedFor(op: string): Set<string> {
  const summed = new Set<string>(MODEL_CROSS_CUTTING_REFS[op] ?? []);
  if ((TRACKER_GITHUB_OPS as readonly string[]).includes(op)) {
    summed.add(trackerRefRel(op));
  }
  return summed;
}

const ALL_OPS = [...SECTIONS.keys()];

/** The sum of every reference file an op's load instructions can name in one spawn. */
function oneSpawnLoad(op: string): number {
  return [...summedFor(op)].reduce((n, rel) => n + referenceChars(rel), 0);
}

/** The winning op of a `max over ops` term, and the quantity it measured. */
interface OpMax {
  readonly op: string;
  readonly value: number;
}

/**
 * `max over ops of measure(op)`, as the winning op and its value — the one reducer
 * every `max over ops` term in this file goes through.
 *
 * `value` is deliberately unit-neutral: the three budget terms below measure
 * characters, the recorded round-trip term measures Reads. An empty range, or one
 * where nothing measures above zero, answers `(none)` / 0 — the same vacuous answer
 * the three hand-written loops gave, so the non-vacuity floors that exist to catch
 * it still catch it.
 */
function maxOver(ops: Iterable<string>, measure: (op: string) => number): OpMax {
  let best: OpMax = { op: '(none)', value: 0 };
  for (const op of ops) {
    const value = measure(op);
    if (value > best.value) best = { op, value };
  }
  return best;
}

/**
 * D-LOADED-SET-SCOPE — the `max over ops` term is taken over TRACKER_GITHUB_OPS,
 * not over every operation in the agent.
 *
 * AC-2.5 bounds "the worst-case TRACKER spawn": the question the budget answers is
 * whether the contract/mechanics split makes a tracker operation cost more than the
 * pre-split monolith did. A non-tracker op such as `fetch-review-threads` loads
 * references/github-api.md and always did; it is not a cost the split introduces,
 * and including it would make the budget a measure of a file this phase does not
 * own. Non-tracker ops are RECORDED in the four-shape table below (so the number
 * stays visible and is never quietly dropped) but do not gate.
 */
function worstCaseReferenceLoad(): OpMax {
  return maxOver(TRACKER_GITHUB_OPS, oneSpawnLoad);
}

/** The same maximum over the ops the budget does NOT gate on — recorded, never asserted. */
function worstCaseNonTrackerLoad(): OpMax {
  const nonTracker = ALL_OPS.filter(op => !(TRACKER_GITHUB_OPS as readonly string[]).includes(op));
  return maxOver(nonTracker, oneSpawnLoad);
}

/** max_op chars(references/tracker/github/{op}.md) — the largest single mechanics file. */
function largestTrackerReference(): OpMax {
  return maxOver(TRACKER_GITHUB_OPS, op => referenceChars(trackerRefRel(op)));
}

// ---------------------------------------------------------------------------
// The preamble block
// ---------------------------------------------------------------------------

const PREAMBLE_START = '## Tracker provider resolution';
// P2-S5 cut 2 moved `## Publication gate (D10)` into references/publication-gate.md,
// so the heading that now follows the preamble is the D11 section — the one
// cross-cutting block §14.4 forbids ever moving, which makes it a stabler end
// anchor than the one it replaces.
const PREAMBLE_END = '## Comment-sink scrub (D11)';
const D4_ANCHOR = '**Degradation contract (D4):**';

/**
 * The provider-resolution preamble as it appears in the compiled agent.
 * Throws — never returns a sentinel — when the block is absent or misplaced: a
 * budget that silently measured an empty preamble would report 0 lines and pass.
 */
function preambleBlock(content: string): string {
  const start = content.indexOf(PREAMBLE_START);
  const end = content.indexOf(PREAMBLE_END);
  const d4 = content.indexOf(D4_ANCHOR);
  if (start === -1) {
    throw new Error(
      `preamble heading '${PREAMBLE_START}' not found in ${GIT_AGENT.path} — ` +
      'the provider-resolution preamble is missing or was renamed (AC-2.5, P2-S3)',
    );
  }
  if (end === -1) throw new Error(`'${PREAMBLE_END}' not found in ${GIT_AGENT.path}`);
  if (d4 === -1) throw new Error(`'${D4_ANCHOR}' not found in ${GIT_AGENT.path}`);
  if (!(d4 < start && start < end)) {
    throw new Error(
      'the preamble must sit between the Degradation contract (D4) block and ' +
      `'${PREAMBLE_END}' — found D4@${d4}, preamble@${start}, gate@${end}`,
    );
  }
  return content.slice(start, end).replace(/\n+$/, '');
}

// ---------------------------------------------------------------------------
// 1. The four-shape table — RECORDED, not asserted pass/fail
// ---------------------------------------------------------------------------
//
// EVERY MARGIN QUOTED OFF THIS TABLE NAMES ITS DENOMINATOR. That is why two
// percentage columns are printed: `vs shape 1` divides by the always-loaded
// preloaded set, `vs shape 2` divides by the shipped per-op loaded set. A bare
// "+31%" is unreproducible — it could be either, and the two differ by more than a
// factor of two. (A previous revision of this comment said "+31% to +41%" and the
// feature KB said "+3.3% → +8.0% → +30.3%"; neither named a denominator and neither
// matched the rows.)
//
// The disqualifying comparison is shape 3 against SHAPE 2, because shape 2 is what
// shipped. At HEAD bf4b3f9 the printed rows are shape 3 = 88,302 ch against shape 2
// = 77,719 ch — +13.6% on the worst-case tracker spawn (and +35.5% vs shape 1's
// 65,187 ch, against shape 2's own +19.2%). Read those off a run; do not quote these
// figures forward — they move whenever git.md or a reference does.
//
// Shape 4 is identical to shape 2 in Phase 2 (MCP_TERM = 0, AC-2.7): the saving it
// was projected to net exists only once an MCP-backed provider module does.
//
// Recording the computed rows is what keeps the shape decision from being re-argued
// from memory; asserting them would pin a ratio nobody intends to hold constant.

describe('byte budget: four-shape table (recorded)', () => {
  it('records every shape, with all three cross-cutting documents as named rows', () => {
    const largest = largestTrackerReference();
    const worst = worstCaseReferenceLoad();
    const nonTracker = worstCaseNonTrackerLoad();
    const allTrackerRefs = TRACKER_GITHUB_OPS.reduce((n, op) => n + referenceChars(trackerRefRel(op)), 0);

    // Named rows [DR-12]: recorded so their cost is visible, not merely deducted
    // from git.md. Absent in T1 — they arrive with the bodies T2 moves.
    const learnConventions = measureOptional(
      'references/learn-conventions.md',
      path.join(REFS_DIR, 'learn-conventions.md'),
    );
    const publicationGate = measureOptional(
      'references/publication-gate.md',
      path.join(REFS_DIR, 'publication-gate.md'),
    );
    // The third named row [D-CROSS-CUTTING-ON-DEMAND]. It sat in no row and no
    // term at all until now: named above the first op heading, so invisible to
    // nameableFrom(), and never a deduction from git.md either.
    const decisionMarkers = measureOptional(
      'references/decision-markers.md',
      path.join(REFS_DIR, 'decision-markers.md'),
    );
    const crossCuttingOnDemand = MODEL_CROSS_CUTTING_ON_DEMAND.reduce(
      (n, rel) => n + referenceChars(rel), 0,
    );

    const MCP_TERM = 0; // _mcp.md is not generated in Phase 2 and is 0 on the GitHub path (AC-2.7).

    // The shipped shape, named once so it can serve as BOTH a row and a stated
    // denominator: shape 3's disqualification is a margin over what shipped, not
    // over the baseline, and a margin whose denominator is unnamed is not a figure
    // a later reader can reproduce.
    const perOpLoadedSet = PRELOADED + MCP_TERM + largest.value + worst.value;

    const shapes = [
      {
        // The denominator of the `vs shape 1` column, so its label has to say what it
        // actually measures. It WAS the monolith at T1, when PRELOADED measured the
        // frozen BUDGET_LOADED_SET (77_824); every mechanics move since has shrunk it,
        // so today it is the always-loaded preloaded set, not the pre-split one.
        shape: '1. baseline — today’s always-loaded preloaded set (was the monolith at T1: 77_824)',
        chars: PRELOADED,
      },
      {
        shape: '2. per-op split, GitHub path (the worst-case formula)',
        chars: perOpLoadedSet,
      },
      {
        shape: '3. per-provider single file (DISQUALIFIED — margin over shape 2, see both % columns)',
        chars: PRELOADED + allTrackerRefs,
      },
      {
        shape: '4. per-op without _mcp.md (GitHub path — identical to 2 in Phase 2)',
        chars: PRELOADED + largest.value + worst.value,
      },
      {
        // RECORDED ONLY, never the gate [D-CROSS-CUTTING-ON-DEMAND]. What shape 2
        // would cost if the cross-cutting glossary were treated as a mandatory
        // per-spawn load rather than a pointer a reader follows. Printed so the
        // number is on the record and the classification is a decision someone
        // can re-open with the figure in front of them, not an omission.
        shape: '2b. shape 2 + cross-cutting glossary as if mandatory (RECORDED, not gated)',
        chars: perOpLoadedSet + crossCuttingOnDemand,
      },
    ];

    const rows = [
      // githubApiMd is the gate's written exclusion [D-LOADED-SET-SCOPE]. It is the
      // whole of the NON-tracker row below, but that row is labelled by OP: the file
      // it costs is named here so the excluded term is attributable to the bytes
      // someone edits, and so its equality pin (GITHUB_API_MD_CHARS) has a visible row.
      ...[gitMd, skillGit, skillWorktree, learnConventions, publicationGate, decisionMarkers, githubApiMd].map(m => ({
        row: m.label + (m.present ? '' : '  (absent — recorded as 0)'),
        chars: m.chars,
        bytes: m.bytes,
      })),
      { row: `max_op tracker reference (${largest.op})`, chars: largest.value, bytes: NaN },
      { row: `worst-case one-spawn load, TRACKER ops (${worst.op})`, chars: worst.value, bytes: NaN },
      // Recorded, not gated — D-LOADED-SET-SCOPE at worstCaseReferenceLoad().
      { row: `worst-case one-spawn load, NON-tracker ops (${nonTracker.op})`, chars: nonTracker.value, bytes: NaN },
      { row: 'sum of all GitHub tracker references', chars: allTrackerRefs, bytes: NaN },
      // Recorded, not gated — D-CROSS-CUTTING-ON-DEMAND at MODEL_CROSS_CUTTING_ON_DEMAND.
      {
        row: `cross-cutting glossary named in the always-loaded part (${MODEL_CROSS_CUTTING_ON_DEMAND.join(', ')})`,
        chars: crossCuttingOnDemand,
        bytes: NaN,
      },
    ];

    // Recorded, not asserted: printed so a reviewer reads the numbers the split
    // is being judged on rather than re-deriving them.
    console.table(rows);
    // Both denominators, each named in its own column header: a percentage lifted
    // from this table always carries the basis it was computed against.
    console.table(shapes.map(s => ({
      ...s,
      'vs shape 1 (preloaded set)': `${(((s.chars - PRELOADED) / PRELOADED) * 100).toFixed(1)}%`,
      'vs shape 2 (per-op loaded set)':
        `${(((s.chars - perOpLoadedSet) / perOpLoadedSet) * 100).toFixed(1)}%`,
    })));

    // Structural sanity only — the table must actually have measured something.
    expect(shapes).toHaveLength(5);
    expect(PRELOADED, 'the preloaded set measured 0 — the table is vacuous').toBeGreaterThan(0);
    expect(allTrackerRefs, 'no tracker reference measured — the table is vacuous').toBeGreaterThan(0);
    expect(
      [learnConventions.label, publicationGate.label, decisionMarkers.label],
      'all three named cross-cutting rows must appear in the table even while absent',
    ).toEqual([
      'references/learn-conventions.md',
      'references/publication-gate.md',
      'references/decision-markers.md',
    ]);
    expect(
      crossCuttingOnDemand,
      'the cross-cutting glossary measured 0 — the recorded row would understate the cost of ' +
      'reclassifying it as mandatory',
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 1b. The round-trip term — RECORDED, not gated (#342)
// ---------------------------------------------------------------------------
//
// Everything above this line is denominated in characters, and characters are not
// the whole cost. Each `**Mechanics:**` pointer converts prompt bytes the spawn
// already holds into a fresh, SEQUENTIAL `Read` — an extra tool round trip and an
// extra inference turn, uncached, where the always-loaded half is a cache read under
// `prompt-caching-1h`. PF-026 prices a shared prompt as lines × spawns-per-run; the
// round trip is the term on the other side of that trade, and the budget models none
// of it. For the smallest references the trade is thin: a few hundred characters
// saved against a full extra turn.
//
// This is a MEASUREMENT-MODEL GAP recorded for #342 (the devflow-wide prompt diet),
// NOT a gate. It deliberately sets no ceiling and no floor on the round-trip count:
// the honest answer to a term the model omits is to print it (ADR-025's amendment —
// record rather than raise a constant or widen a scan), not to invent a threshold
// for it. It is also NOT licence to re-inline a reference to make the number
// smaller; that reverses the split decision and spends the budget's headroom.

/** Named collector: the lines that ARE `**Mechanics:**` pointers — one extra Read each. */
function collectMechanicsPointerSites(content: string): string[] {
  return content.split('\n').filter(line => line.startsWith('**Mechanics:**'));
}

describe('byte budget: the round-trip term (recorded)', () => {
  it('records the Reads per spawn and the smallest references the character budget does not price', () => {
    const sites = collectMechanicsPointerSites(GIT_AGENT.content);
    // Reads per spawn is |summedFor(op)| — the SAME set the budget sums characters
    // over, read for its cardinality instead of its size. One file named is one Read.
    // Scoped to TRACKER ops for the same reason the gate is [D-LOADED-SET-SCOPE].
    const worstReads = maxOver(TRACKER_GITHUB_OPS, op => summedFor(op).size);
    const smallest = [...TRACKER_GITHUB_OPS]
      .map(op => ({ op, chars: referenceChars(trackerRefRel(op)) }))
      .sort((a, b) => a.chars - b.chars)
      .slice(0, 3);

    // Its own table, with its own unit column: these are Reads and sites, and printing
    // them under the four-shape table's `chars` heading would read as characters.
    console.table([
      {
        term: '`**Mechanics:**` pointer sites in the agent (1 extra sequential Read each)',
        value: sites.length,
        unit: 'sites',
      },
      {
        term: `mechanics Reads added per spawn, max over TRACKER ops (${worstReads.op})`,
        value: worstReads.value,
        unit: 'Reads',
      },
      ...smallest.map((r, i) => ({
        term: `smallest generated reference #${i + 1} (tracker/github/${r.op}.md)`,
        value: r.chars,
        unit: 'ch',
      })),
    ]);

    // The only assertion here is a vacuity floor, not a budget: an unbuilt
    // dist/skills/git/references/ makes referenceChars() answer 0 for everything, and
    // three zeroes would print as a plausible-looking ranking (PF-018).
    expect(
      smallest[0].chars,
      'the smallest generated reference measured 0 — the round-trip rows are vacuous. ' +
      'Run `npm run build`.',
    ).toBeGreaterThan(0);

    // The pointer-site COUNT is printed and deliberately NOT asserted. It is a property
    // of the agent's prose, already owned by the single-naming-line assertion below and
    // by reference-structure.test.ts; a second authority on how many pointer sites the
    // agent must have would fight them from a budget file, and a count is not a budget.
  });
});

// ---------------------------------------------------------------------------
// 2. The budget gates
// ---------------------------------------------------------------------------

describe('byte budget: component and loaded-set pins (AC-2.5)', () => {
  it('chars(dist/agents/git.md) <= BUDGET_GIT_MD', () => {
    // The always-loaded half of the split. The only legitimate way back under this
    // line is to move text out of the agent — never to raise the constant.
    expect(
      gitMd.chars,
      `dist/agents/git.md is ${gitMd.chars} ch, budget ${BUDGET_GIT_MD} ch ` +
      `(over by ${gitMd.chars - BUDGET_GIT_MD}). Move the mechanics into the operation's ` +
      `generated reference. Do NOT raise BUDGET_GIT_MD — §14.5: no threshold is lowered, and a ` +
      `budget raised to meet the artifact measures nothing.`,
    ).toBeLessThanOrEqual(BUDGET_GIT_MD);
  });

  it('chars(skills/git/SKILL.md) <= BUDGET_SKILL_MD', () => {
    expect(
      skillGit.chars,
      `skills/git/SKILL.md is ${skillGit.chars} ch, budget ${BUDGET_SKILL_MD} ch ` +
      `(over by ${skillGit.chars - BUDGET_SKILL_MD}). The skill carries doctrine, not mechanics: ` +
      `per-operation steps belong in that operation's generated reference. Do NOT raise ` +
      `BUDGET_SKILL_MD.`,
    ).toBeLessThanOrEqual(BUDGET_SKILL_MD);
  });

  it('the worst-case tracker spawn <= BUDGET_LOADED_SET', () => {
    // worst = preloaded set
    //       + 0                                    /* _mcp.md, GitHub path */
    //       + max_op chars(tracker/github/{op}.md)
    //       + max over TRACKER ops of ( sum of every reference that op can name in one
    //         spawn )  [DR-12, scoped by D-LOADED-SET-SCOPE]
    const largest = largestTrackerReference();
    const worst = worstCaseReferenceLoad();
    const total = PRELOADED + 0 + largest.value + worst.value;

    // referenceChars() answers 0 for a file it cannot resolve, so an absent
    // dist/skills/git/references/ drives BOTH terms to 0 and this gate passes by
    // measuring nothing — the PF-018 shape, in the one test whose green is the
    // phase's headline claim. The non-vacuity floor belongs HERE, not in the
    // four-shape table's `it` (which deliberately tolerates absent rows).
    expect(
      largest.value,
      'no tracker mechanics file resolved — the budget summed nothing. Run `npm run build`.',
    ).toBeGreaterThan(0);
    expect(
      worst.value,
      'no one-spawn reference load resolved — the budget summed nothing. Run `npm run build`.',
    ).toBeGreaterThan(0);

    expect(
      total,
      `worst-case tracker spawn is ${total} ch (preloaded ${PRELOADED} + max_op ${largest.value} ` +
      `[${largest.op}] + worst one-spawn load ${worst.value} [${worst.op}]), budget ` +
      `${BUDGET_LOADED_SET} ch. The split only pays for itself while the always-loaded half ` +
      `stays smaller than the references it adds back; Do NOT raise BUDGET_LOADED_SET.`,
    ).toBeLessThanOrEqual(BUDGET_LOADED_SET);
  });
});

// ---------------------------------------------------------------------------
// 3. The preamble — ceiling and single-naming-line [DR-13(a), DR-27(c)]
// ---------------------------------------------------------------------------

describe('byte budget: the provider-resolution preamble', () => {
  it('sits between the D4 block and the publication gate, and is <= 40 lines', () => {
    const block = preambleBlock(GIT_AGENT.content);
    const lines = block.split('\n');
    expect(
      lines.length,
      `the preamble is ${lines.length} lines, ceiling ${PREAMBLE_MAX_LINES} (AC-2.5 [DR-13(a)]). ` +
      `It is preloaded on every Git spawn, so its length is a per-spawn cost, not a style matter.`,
    ).toBeLessThanOrEqual(PREAMBLE_MAX_LINES);
    expect(lines.length, 'an empty preamble would pass the ceiling vacuously').toBeGreaterThan(1);
  });

  it('exactly one line in the compiled agent names a references/tracker/ path, inside the preamble', () => {
    // AC-2.5's scope clause [DR-27(c)]: PF-023 requires ONE convergence point.
    // A second naming line anywhere else is a second place a provider path is
    // composed, which is the ~30-sink shape this phase exists to remove.
    const naming = collectTrackerNamingLines(GIT_AGENT.content);
    expect(
      naming.length,
      `expected exactly 1 line naming a references/tracker/ path, found ${naming.length}:\n  ` +
      naming.join('\n  '),
    ).toBe(1);

    const block = preambleBlock(GIT_AGENT.content);
    expect(
      block.includes(naming[0]),
      'the single reference-naming line must live inside the preamble, not in an op body',
    ).toBe(true);

    // Standing prohibition (§14.5): references are addressed skill-relatively.
    expect(
      naming[0].includes('~/.claude'),
      'no generated reference path literal may begin with ~/.claude — CLAUDE_CODE_DIR and ' +
      'local-scope installs put the skill somewhere else entirely',
    ).toBe(false);
  });

  it('known-bad probe: a seeded second naming line is detected by the same collector', () => {
    const seeded =
      `${GIT_AGENT.content}\n\nSee \`references/tracker/github/setup-task.md\` for the mechanics.\n`;
    expect(
      collectTrackerNamingLines(seeded).length,
      'the collector must see a second naming line — otherwise the single-line assertion is inert',
    ).toBe(2);
  });
});

/** Named collector: lines naming a `references/tracker/` path. */
function collectTrackerNamingLines(content: string): string[] {
  return content.split('\n').filter(line => line.includes('references/tracker/'));
}

// ---------------------------------------------------------------------------
// 4. Bidirectional structural check [DR-12]
// ---------------------------------------------------------------------------
//
// The formula must sum exactly the files a single spawn can be made to load.
// The two sets are derived independently — one from the declared budget model,
// one by scanning the compiled agent — so agreement is evidence rather than a
// restatement. Model: the compliance-compose bidirectional registries, "every
// token here must exist in the template; every template token must be listed
// here".

/**
 * Named collector: the entries of `have` that `want` does not contain, labelled
 * `{op} → {rel}`.
 *
 * Both directions of the bidirectional check and the known-bad probe below call
 * THIS — a probe that re-spells the comparison inline proves the expectation, not
 * the guard, and stays green while the real one is mis-scoped (PF-018).
 */
export function collectMissingFrom(
  op: string,
  have: ReadonlySet<string>,
  want: ReadonlySet<string>,
): string[] {
  return [...have].filter(rel => !want.has(rel)).map(rel => `${op} → ${rel}`);
}

describe('byte budget: formula file-set ↔ nameable file-set (both directions)', () => {
  it('every file the formula sums for an op is nameable from that op (direction 1)', () => {
    const unnameable: string[] = [];
    for (const op of ALL_OPS) {
      unnameable.push(...collectMissingFrom(op, summedFor(op), nameableFrom(op)));
    }
    expect(
      unnameable,
      `the budget sums file(s) no load instruction can name — the model is counting cost that ` +
      `is never paid:\n  ${unnameable.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every file nameable from an op is summed by the formula (direction 2)', () => {
    const uncounted: string[] = [];
    for (const op of ALL_OPS) {
      uncounted.push(...collectMissingFrom(op, nameableFrom(op), summedFor(op)));
    }
    expect(
      uncounted,
      `an op can name reference file(s) the budget never counts — AC-2.5 would pass while a real ` +
      `spawn exceeds the pre-split set (GAP-01, P2-h). Add the row to MODEL_CROSS_CUTTING_REFS ` +
      `and re-record the table:\n  ${uncounted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the check is non-vacuous: enough ops, and a non-empty file set on both sides', () => {
    expect(ALL_OPS.length, 'no operation sections found in the compiled agent').toBeGreaterThanOrEqual(
      MIN_VARIANT_PAIRS,
    );
    const summedTotal = ALL_OPS.reduce((n, op) => n + summedFor(op).size, 0);
    const nameableTotal = ALL_OPS.reduce((n, op) => n + nameableFrom(op).size, 0);
    expect(summedTotal, 'the formula sums no files at all — both directions are vacuous')
      .toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);
    expect(nameableTotal, 'no op can name a reference — both directions are vacuous')
      .toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length);
  });

  it('the cross-cutting scope agrees with the model in both directions (direction 3)', () => {
    // The scope nameableFrom() cannot see. Before this existed, a reference named
    // above the first `## Operation:` heading was summed by nothing and scanned by
    // nothing — the one place a file could be added to every user's install with
    // no term anywhere in the budget.
    const scanned = nameableCrossCutting(GIT_AGENT.content);
    const modelled = new Set(MODEL_CROSS_CUTTING_ON_DEMAND);

    expect(
      collectMissingFrom('(always-loaded)', scanned, modelled),
      'the always-loaded part of the agent names reference file(s) the budget model has never ' +
      'heard of. Every Git spawn can reach them, so their cost must at least be RECORDED — add ' +
      'the row to MODEL_CROSS_CUTTING_ON_DEMAND and re-record the table',
    ).toEqual([]);
    expect(
      collectMissingFrom('(always-loaded)', modelled, scanned),
      'the model declares a cross-cutting reference the agent no longer names — the file is ' +
      'generated and installed and nothing can load it (ADR-003)',
    ).toEqual([]);
    expect(scanned.size, 'the cross-cutting scan found nothing — direction 3 is vacuous')
      .toBeGreaterThan(0);
  });

  it('known-bad probe: the cross-cutting scope is scanned live, in the right half of the file', () => {
    // Two failure modes, one probe. (a) A name seeded into the always-loaded part
    // is seen — so the empty-difference assertions above are not green because the
    // slice was empty. (b) A name seeded AFTER the first op heading is NOT seen —
    // so the slice is really the always-loaded half and not the whole file, which
    // would silently absorb every op-scoped name into the cross-cutting term.
    const opAt = GIT_AGENT.content.search(/^## Operation: /m);
    expect(opAt, 'the compiled agent must have an op heading for this probe').toBeGreaterThan(0);

    const seededAbove =
      GIT_AGENT.content.slice(0, opAt) +
      'See the `devflow:git` skill\'s `references/smuggled.md`.\n\n' +
      GIT_AGENT.content.slice(opAt);
    expect(
      collectMissingFrom('(always-loaded)', nameableCrossCutting(seededAbove), new Set(MODEL_CROSS_CUTTING_ON_DEMAND)),
      'a reference newly named in the always-loaded part must be reported as unmodelled',
    ).toEqual(['(always-loaded) → smuggled.md']);

    const seededBelow = `${GIT_AGENT.content}\n\nSee \`references/smuggled.md\`.\n`;
    expect(
      nameableCrossCutting(seededBelow).has('smuggled.md'),
      'a name below the first op heading must NOT land in the cross-cutting scope — otherwise ' +
      'the two scopes are one scan wearing two names',
    ).toBe(false);
  });

  it('known-bad probe: an unmodelled nameable file is reported by direction 2', () => {
    // Drives collectMissingFrom — the SAME collector both directions above call —
    // over a seeded pair of sets, so a collector that stopped reporting extras
    // takes this probe red with the guards it backs.
    const summed = new Set(['tracker/github/setup-task.md']);
    const nameable = new Set(['tracker/github/setup-task.md', 'learn-conventions.md']);
    expect(collectMissingFrom('setup-task', nameable, summed))
      .toEqual(['setup-task → learn-conventions.md']);
    // …and the symmetric direction reports nothing when nothing is extra.
    expect(collectMissingFrom('setup-task', summed, nameable)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Written exclusions asserted (SG-8, §C.5 rule 1)
// ---------------------------------------------------------------------------

describe('byte budget: written exclusions', () => {
  it('## Comment-sink scrub (D11) never moves out of the always-loaded agent', () => {
    // Making the containment control loadable is precisely PF-027's failure mode:
    // the control that decides whether a body may be posted cannot itself be a
    // file the spawn might not have.
    expect(
      GIT_AGENT.content,
      '## Comment-sink scrub (D11) must stay in the agent — it is never moved to a reference',
    ).toContain('## Comment-sink scrub (D11)');
  });

  it('the two summary ops keep their mechanics in the agent (SG-8)', () => {
    // Both are D10 AND D11 sinks and may move only in a PR that moves their
    // guards — never as a size optimisation.
    for (const op of ['post-review-summary', 'post-resolution-summary']) {
      expect(SECTIONS.has(op), `${op} must still be a section of the agent`).toBe(true);
      expect(
        (TRACKER_GITHUB_OPS as readonly string[]).includes(op),
        `${op} must not be a generated tracker reference (SG-8 written exclusion)`,
      ).toBe(false);
    }
  });

  it(`references/github-api.md is exactly ${GITHUB_API_MD_CHARS} ch (the excluded term's anchor)`, () => {
    // The gate's exclusion of this file is correct (D-LOADED-SET-SCOPE), and this is
    // what the exclusion owes in return: the excluded term gets a recorded row with an
    // anchor, so it cannot drift untracked the way it already did once (+280 ch inside
    // this branch, against 17,259 recorded in the PR body and the feature KB).
    //
    // EQUALITY, not a ceiling. When this goes red, the fix is to re-measure the file
    // and re-pin GITHUB_API_MD_CHARS in the SAME commit that edited its bytes — never
    // to relax the comparison, and never to re-pin it in a later commit, which is how
    // an equality baseline stops being evidence of anything.
    expect(
      githubApiMd.chars,
      `references/github-api.md is ${githubApiMd.chars} ch, pinned at ${GITHUB_API_MD_CHARS} ` +
      `(drift ${githubApiMd.chars - GITHUB_API_MD_CHARS}). This file is EXCLUDED from ` +
      `BUDGET_LOADED_SET, so nothing else notices it growing. If this commit edits ` +
      `github-api.md, re-measure and re-pin GITHUB_API_MD_CHARS here; if it does not, the ` +
      `file drifted and the change belongs in the commit that made it.`,
    ).toBe(GITHUB_API_MD_CHARS);
  });
});

// ---------------------------------------------------------------------------
// 6. The preamble's provider normalisation (P2-S3 Verify, GAP-10)
// ---------------------------------------------------------------------------
//
// Lives here rather than in a file of its own: byte-budget.test.ts is the one
// tracker test file this subtask owns, and §14.10's naming scheme reserves the
// other four names for guards that come later.
//
// What can be asserted mechanically about a prompt: that the rule is stated
// exactly once, that the static map it points at is real, and that the rule AS
// WRITTEN rejects every hostile token and never yields a path derived from the
// input. The hostile table mirrors compliance-install.test.ts AC-35.

/** The token → directory map, parsed out of the preamble rather than retyped. */
function parseProviderMap(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/^\|\s*`([a-z]+)`\s*\|\s*`([a-z/]+\/)`\s*\|\s*$/gm)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * The preamble's normalisation, implemented exactly as it is written:
 * trim → strip one pair of surrounding quotes → reject any character outside
 * [A-Za-z] → ASCII-lowercase → exact membership in the static map.
 *
 * Returns the mapped DIRECTORY, never anything built from the input — which is
 * the property that matters: a rejected token cannot become a path, and an
 * accepted one selects a hardcoded string rather than being concatenated.
 */
function resolveProviderAsSpecified(raw: string, map: ReadonlyMap<string, string>): string | null {
  const trimmed = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  if (!/^[A-Za-z]*$/.test(trimmed)) return null;
  return map.get(trimmed.toLowerCase()) ?? null;
}

describe('preamble: provider normalisation (one convergence point, PF-023)', () => {
  const block = preambleBlock(GIT_AGENT.content);
  const map = parseProviderMap(block);

  it('states the normalisation rule exactly once, over a real three-entry map', () => {
    const occurrences = GIT_AGENT.content.split('**Normalise `TRACKER_PROVIDER`:**').length - 1;
    expect(
      occurrences,
      'the normalisation rule must be stated exactly ONCE — a second statement is a second ' +
      'authority on what a provider token may be (PF-023 requires one convergence point)',
    ).toBe(1);

    expect([...map.keys()].sort()).toEqual(['github', 'jira', 'linear']);
    expect([...map.values()]).toEqual(['tracker/github/', 'tracker/jira/', 'tracker/linear/']);
  });

  it('accepts only the three tokens, after trimming, quote-stripping and lowercasing', () => {
    const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
      ['github', 'tracker/github/'],
      ['GitHub', 'tracker/github/'],
      ['  jira  ', 'tracker/jira/'],
      ['jira ', 'tracker/jira/'],
      ['"linear"', 'tracker/linear/'],
      ["'github'", 'tracker/github/'],
    ];
    for (const [raw, expected] of ACCEPTED) {
      expect(resolveProviderAsSpecified(raw, map), `'${raw}' must resolve to ${expected}`)
        .toBe(expected);
    }
  });

  it('known-bad table: every hostile token is REJECTED, and none produces a path', () => {
    // Reject, never repair. `jira-cloud` is the instructive one: a "closest
    // match" rule would map it onto jira, which is exactly the repair the
    // preamble forbids.
    const HOSTILE: readonly string[] = [
      '../../../etc/passwd',
      'github/../../rules/devflow',
      'jira-cloud',
      '`id`',
      'github ' + String.fromCharCode(36) + '(id)',
      '',
      ' ',
      'a'.repeat(200),
      'github jira',
      'github;linear',
    ];
    expect(HOSTILE.length, 'hostile corpus must be non-empty (PF-018)').toBeGreaterThan(0);

    const accepted = HOSTILE.filter(raw => resolveProviderAsSpecified(raw, map) !== null);
    expect(
      accepted,
      `hostile provider token(s) were accepted: ${accepted.join(', ')}`,
    ).toEqual([]);
  });

  it('every accepted token yields a map VALUE — never a path built from the input', () => {
    const values = new Set(map.values());
    for (const raw of ['github', 'GitHub', ' jira ', '"linear"']) {
      const resolved = resolveProviderAsSpecified(raw, map);
      expect(resolved, `${raw} must resolve`).not.toBeNull();
      expect(values.has(resolved!), `${raw} must resolve to a mapped directory`).toBe(true);
    }
  });

  it('no reference path in the compiled agent is addressed through ~/.claude', () => {
    // A hardcoded ~/.claude/... is simply absent for CLAUDE_CODE_DIR users and
    // for local-scope installs, and the fail-closed neutral value would then
    // cost such a GitHub user their traceability entirely.
    const offenders = GIT_AGENT.content
      .split('\n')
      .filter(line => line.includes('references/') && line.includes('~/.claude'));
    expect(
      offenders,
      `reference(s) addressed absolutely instead of skill-relatively:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
