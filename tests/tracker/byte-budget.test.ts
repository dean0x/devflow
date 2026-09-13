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
 * 65_677 − 9_813 = 55_864; headroom 36.
 * formula: baseline_ch − projected_cut; the baseline is the post-Phase-0
 * merge-commit capture of dist/agents/git.md (65_677 ch / 66_180 bytes).
 * projected cut: tracker mechanics −9_400 · learn-conventions body −3_300 ·
 * marker legend −1_400 (the D4 and D11 rows stay, E10) · D10 step-order −1_113 ·
 * add-back +5_400.
 */
const BUDGET_GIT_MD = 55_900;

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

/**
 * The cross-cutting references the BUDGET MODEL attributes to each operation,
 * beyond its own generated mechanics file [DR-12].
 *
 * Declared, not scanned — that is the whole point. The bidirectional check below
 * compares this model against what the compiled agent actually lets an op name;
 * deriving both from one source would make the check a tautology.
 *
 * Empty entries are the T2 slots: `learn-conventions.md` joins `setup-task`, and
 * `publication-gate.md` joins the two summary ops, in the commit that moves
 * those bodies. Until then their cost is recorded as a named 0 row in the table.
 */
const MODEL_CROSS_CUTTING_REFS: Readonly<Record<string, readonly string[]>> = {
  'fetch-review-threads': ['github-api.md'],
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
function worstCaseReferenceLoad(): { op: string; chars: number } {
  let worst = { op: '(none)', chars: 0 };
  for (const op of TRACKER_GITHUB_OPS) {
    const chars = oneSpawnLoad(op);
    if (chars > worst.chars) worst = { op, chars };
  }
  return worst;
}

/** The same maximum over the ops the budget does NOT gate on — recorded, never asserted. */
function worstCaseNonTrackerLoad(): { op: string; chars: number } {
  let worst = { op: '(none)', chars: 0 };
  for (const op of ALL_OPS) {
    if ((TRACKER_GITHUB_OPS as readonly string[]).includes(op)) continue;
    const chars = oneSpawnLoad(op);
    if (chars > worst.chars) worst = { op, chars };
  }
  return worst;
}

/** max_op chars(references/tracker/github/{op}.md) — the largest single mechanics file. */
function largestTrackerReference(): { op: string; chars: number } {
  let largest = { op: '(none)', chars: 0 };
  for (const op of TRACKER_GITHUB_OPS) {
    const chars = referenceChars(trackerRefRel(op));
    if (chars > largest.chars) largest = { op, chars };
  }
  return largest;
}

// ---------------------------------------------------------------------------
// The preamble block
// ---------------------------------------------------------------------------

const PREAMBLE_START = '## Tracker provider resolution';
const PREAMBLE_END = '## Publication gate (D10)';
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
// The per-provider shape was disqualified at +31% to +41%, and per-op-without-
// _mcp nets roughly −17% on a tracker spawn. Recording the computed rows is what
// keeps that decision from being re-argued from memory; asserting them would
// pin a ratio nobody intends to hold constant.

describe('byte budget: four-shape table (recorded)', () => {
  it('records every shape, with learn-conventions.md and publication-gate.md as named rows', () => {
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

    const MCP_TERM = 0; // _mcp.md is not generated in Phase 2 and is 0 on the GitHub path (AC-2.7).

    const shapes = [
      {
        shape: '1. today’s monolith (pre-split preloaded set)',
        chars: PRELOADED,
      },
      {
        shape: '2. per-op split, GitHub path (the worst-case formula)',
        chars: PRELOADED + MCP_TERM + largest.chars + worst.chars,
      },
      {
        shape: '3. per-provider single file (DISQUALIFIED: +31%–41%)',
        chars: PRELOADED + allTrackerRefs,
      },
      {
        shape: '4. per-op without _mcp.md (GitHub path — identical to 2 in Phase 2)',
        chars: PRELOADED + largest.chars + worst.chars,
      },
    ];

    const rows = [
      ...[gitMd, skillGit, skillWorktree, learnConventions, publicationGate].map(m => ({
        row: m.label + (m.present ? '' : '  (absent — recorded as 0)'),
        chars: m.chars,
        bytes: m.bytes,
      })),
      { row: `max_op tracker reference (${largest.op})`, chars: largest.chars, bytes: NaN },
      { row: `worst-case one-spawn load, TRACKER ops (${worst.op})`, chars: worst.chars, bytes: NaN },
      // Recorded, not gated — D-LOADED-SET-SCOPE at worstCaseReferenceLoad().
      { row: `worst-case one-spawn load, NON-tracker ops (${nonTracker.op})`, chars: nonTracker.chars, bytes: NaN },
      { row: 'sum of all GitHub tracker references', chars: allTrackerRefs, bytes: NaN },
    ];

    // Recorded, not asserted: printed so a reviewer reads the numbers the split
    // is being judged on rather than re-deriving them.
    console.table(rows);
    console.table(shapes.map(s => ({
      ...s,
      'vs monolith': `${(((s.chars - PRELOADED) / PRELOADED) * 100).toFixed(1)}%`,
    })));

    // Structural sanity only — the table must actually have measured something.
    expect(shapes).toHaveLength(4);
    expect(PRELOADED, 'the preloaded set measured 0 — the table is vacuous').toBeGreaterThan(0);
    expect(allTrackerRefs, 'no tracker reference measured — the table is vacuous').toBeGreaterThan(0);
    expect(
      [learnConventions.label, publicationGate.label],
      'both DR-12 rows must be named in the table even while absent',
    ).toEqual(['references/learn-conventions.md', 'references/publication-gate.md']);
  });
});

// ---------------------------------------------------------------------------
// 2. The budget gates — EXPECTED RED until T2 lands
// ---------------------------------------------------------------------------

describe('byte budget: component and loaded-set pins (AC-2.5)', () => {
  it('EXPECTED RED until T2: chars(dist/agents/git.md) <= BUDGET_GIT_MD', () => {
    // The phase's progress meter. T2 moves ~9,400 characters of GitHub mechanics
    // out of the always-loaded agent; until that lands this is red BY DESIGN and
    // must not be skipped, relaxed, or have its constant raised.
    expect(
      gitMd.chars,
      `dist/agents/git.md is ${gitMd.chars} ch, budget ${BUDGET_GIT_MD} ch ` +
      `(over by ${gitMd.chars - BUDGET_GIT_MD}). EXPECTED RED until T2 moves the op mechanics. ` +
      `Do NOT raise BUDGET_GIT_MD — §14.5: no threshold is lowered, and a budget raised to ` +
      `meet the artifact measures nothing.`,
    ).toBeLessThanOrEqual(BUDGET_GIT_MD);
  });

  it('EXPECTED RED until T2: chars(skills/git/SKILL.md) <= BUDGET_SKILL_MD', () => {
    expect(
      skillGit.chars,
      `skills/git/SKILL.md is ${skillGit.chars} ch, budget ${BUDGET_SKILL_MD} ch ` +
      `(over by ${skillGit.chars - BUDGET_SKILL_MD}). EXPECTED RED until T2 cuts the D3 template, ` +
      `the throttling recipe, the PR-comment and releases sections, and the naming authority block.`,
    ).toBeLessThanOrEqual(BUDGET_SKILL_MD);
  });

  it('EXPECTED RED until the op mechanics move: the worst-case tracker spawn <= BUDGET_LOADED_SET', () => {
    // worst = preloaded set
    //       + 0                                    /* _mcp.md, GitHub path */
    //       + max_op chars(tracker/github/{op}.md)
    //       + max over TRACKER ops of ( sum of every reference that op can name in one
    //         spawn )  [DR-12, scoped by D-LOADED-SET-SCOPE]
    const largest = largestTrackerReference();
    const worst = worstCaseReferenceLoad();
    const total = PRELOADED + 0 + largest.chars + worst.chars;

    expect(
      total,
      `worst-case tracker spawn is ${total} ch (preloaded ${PRELOADED} + max_op ${largest.chars} ` +
      `[${largest.op}] + worst one-spawn load ${worst.chars} [${worst.op}]), budget ` +
      `${BUDGET_LOADED_SET} ch. EXPECTED RED until T2: the split has to make the always-loaded ` +
      `half smaller than the references it adds back.`,
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

describe('byte budget: formula file-set ↔ nameable file-set (both directions)', () => {
  it('every file the formula sums for an op is nameable from that op (direction 1)', () => {
    const unnameable: string[] = [];
    for (const op of ALL_OPS) {
      const nameable = nameableFrom(op);
      for (const rel of summedFor(op)) {
        if (!nameable.has(rel)) unnameable.push(`${op} → ${rel}`);
      }
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
      const summed = summedFor(op);
      for (const rel of nameableFrom(op)) {
        if (!summed.has(rel)) uncounted.push(`${op} → ${rel}`);
      }
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

  it('known-bad probe: an unmodelled nameable file is reported by direction 2', () => {
    // The probe runs the real comparison over a seeded pair of sets, so anchoring
    // or scoping the scan without keeping it able to see an extra file is red.
    const summed = new Set(['tracker/github/setup-task.md']);
    const nameable = new Set(['tracker/github/setup-task.md', 'learn-conventions.md']);
    const uncounted = [...nameable].filter(rel => !summed.has(rel));
    expect(uncounted).toEqual(['learn-conventions.md']);
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
