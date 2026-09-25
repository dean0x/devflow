/**
 * Byte budget for the tracker contract/mechanics split (AC-2.5, GAP-01).
 *
 * The split can be "satisfied" while the total gets worse: mechanics leave the
 * always-loaded agent and come back as a reference the same spawn loads anyway.
 * This file pins the budget from the corrected baseline so that cannot happen
 * quietly, and records the four candidate shapes so the shape decision is not
 * re-litigated from memory.
 *
 * WHAT IS HERE: the ceilings, each with the derivation that justifies it, and the
 * assertions they gate. HOW each term is measured, resolved and maximised lives
 * in tests/tracker/budget-model.ts — so a reviewer asking "what does this ceiling
 * gate, and may it move?" reads one file rather than tracing the machinery that
 * produces the number past the number itself.
 *
 * Every ceiling here is GREEN and is the number the artifact is held to; none is
 * skipped. A skipped budget asserts nothing and reads as "fine" in a CI log
 * (PF-018), so a ceiling that goes red is answered by cutting the artifact, never
 * by raising the ceiling or disabling its gate. Each ceiling's own JSDoc records
 * its measurement and its headroom.
 *
 * UNIT: characters, not bytes, throughout — `wc -m` semantics. JS `.length`
 * counts UTF-16 code units, which equals `wc -m` for this corpus (every
 * non-ASCII character in it is BMP: em-dashes, arrows, ≤, §). Byte counts are
 * recorded alongside in the table so the two are never confused, but every
 * budget constant is in characters.
 *
 * Every dist read is fail-loud — the model's own guarantee: an absent artifact
 * throws with a build hint rather than making the budget pass by measuring
 * nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { MIN_VARIANT_PAIRS, PR_HOST_OPS, TRACKER_GITHUB_OPS } from '../../src/core/mds-variants.js';
import { collectTrackerNamingLines, prHostRel } from '../helpers.js';
import {
  ALL_OPS,
  GIT_AGENT,
  LOADED_SET_WRITTEN_EXCLUSIONS,
  isPrHostOp,
  MCP_BACKED_PROVIDERS,
  MCP_CONTRACT_REL,
  MODEL_CROSS_CUTTING_ON_DEMAND,
  MODEL_CROSS_CUTTING_ASSERTED,
  PRELOADED,
  REFS_DIR,
  SECTIONS,
  githubApiMd,
  gitMd,
  largestProviderReference,
  largestTrackerReference,
  maxOver,
  measureOptional,
  nameableCrossCutting,
  nameableFrom,
  preambleBlock,
  providerLoadedSet,
  referenceChars,
  resolveReference,
  skillGit,
  skillWorktree,
  summedFor,
  trackerRefRel,
  worstCaseNonTrackerLoad,
  worstCasePrHostLoad,
  worstCaseProviderLoad,
  worstCaseReferenceLoad,
} from './budget-model.js';

// ---------------------------------------------------------------------------
// Budget constants — every one carries its derivation. Never a bare number.
// ---------------------------------------------------------------------------

/*
 * THE RESERVATION LEDGER — 2,200 ch, spoken for by name.
 *
 * Every ceiling below that carries dist/agents/git.md (`BUDGET_GIT_MD` and the four
 * `BUDGET_LOADED_SET*` rows) was re-derived by #358 as `measured actual + 2,300`,
 * then by #359 (PR1, which spent its 100-ch line) as `measured actual + 2,200`:
 * headroom reserved for the always-loaded text the rest of the SDLC-evidence
 * series (#357) is scoped to add —
 *
 *   PR2  (#360) pre-existing bugs ....... 150
 *   PR3b (#362) policy wiring ........... 250
 *   PR4  (#363) test-plan evidence ...... 900
 *   PR5  (#364) release ................. 900
 *
 * git.md growth lands in every loaded-set row, so every row reserves the whole
 * ledger rather than a share of it. The reserved headroom is not slack: a PR in
 * the series spends only its own line, and any addition outside the ledger still
 * funds itself with a cut. The ceilings remain regression alarms that are
 * LOWERED, NEVER RAISED.
 */

/**
 * THE git.md CEILING — the one gate on the always-loaded half of the split.
 *
 * Derived from a measured 42_763 ch — with the eight PR-host operations'
 * `**Process:**` bodies in `references/pr/{op}.md`, #358's moves out of the
 * agent and #359's condensed release-evidence step — plus the 2,200 ch
 * RESERVATION LEDGER above: 44_963. Outside the ledger,
 * the next content addition to git.mds must fund itself with a cut elsewhere.
 *
 * THE RULE: this ceiling is a REGRESSION ALARM, and it is RE-DERIVED ONLY DOWNWARD —
 * lowered after a pass that actually cut the artifact, never raised to fit one that
 * grew. A budget that rises to meet the artifact is a description, not a budget
 * (§14.5). The only legitimate way back under this line is to move text out of the
 * agent.
 *
 * NO PER-COMPONENT DECOMPOSITION of the cut is recorded here, and none is welcome:
 * three successive re-derivations of such components disagreed once already
 * (PF-057), and no printed row produces them. Measure the artifact instead —
 *
 *   npm run build && node -e "process.stdout.write(String(require('fs').readFileSync('dist/agents/git.md','utf8').length))"
 *
 * — and read the shape table this file prints for everything the measurement feeds.
 *
 * Registered as a `ceilings` entry (`budget-git-md`) in
 * tests/fixtures/numeric-floors.json. Lowering re-pins that entry's value AND its
 * pattern in the same commit; that is the permitted direction for a ceiling, and the
 * manifest guard's probe still proves an INCREMENT would go red.
 */
const BUDGET_GIT_MD = 44_963;

/**
 * Design-time derivation: the PRE-SPLIT capture of skills/git/SKILL.md, less the
 * cut — the D3 traceability template, the throttling recipe, the PR-comment
 * section, the releases recipe, and the naming-conventions authority block.
 *
 * Pinned to that derivation and deliberately NOT re-derived from whatever the
 * file measures today, which drifts by single characters: a budget that follows
 * the artifact asserts "the current size is the current size". Re-run this file
 * for the current measurement — the printed table is the record.
 */
const BUDGET_SKILL_MD = 6_600;

/**
 * THE GITHUB-PATH loaded-set ceiling — the worst-case cost of a tracker spawn
 * that resolves to github, where `bytes(tracker/_mcp.md)` is 0 by construction.
 *
 * The formula the gate below states term by term:
 *   the always-preloaded set
 *   + 0                                          — tracker/_mcp.md, on the GitHub path
 *   + max_op chars(references/tracker/github/{op}.md)
 *   + max over TRACKER ops of the one-spawn load [DR-12, D-LOADED-SET-SCOPE]
 *
 * That this row's contract term is 0 is PROVEN, not assumed: the re-scoped AC-2.7
 * arm in tests/guards/provider-scope.test.ts asserts no `tracker/github/{op}.md`
 * names the tool-call contract, and a gate in this file repeats the check against
 * every github mechanics file. A provider that DOES load it is priced on its own
 * row, so this number can never drift into billing every GitHub user for bytes
 * they never receive (GAP-02).
 *
 * Derived from a measured 63_929 plus the 2,200 ch RESERVATION LEDGER above:
 * 66_129. Outside the ledger, the next addition to the agent or to a github
 * mechanics file must fund itself with a cut.
 *
 * MAY BE LOWERED, NEVER RAISED. Registered as `budget-loaded-set` in
 * tests/fixtures/numeric-floors.json; lowering re-pins the value AND the pattern
 * in the same commit.
 */
const BUDGET_LOADED_SET = 66_129;

/**
 * THE JIRA-SCOPED loaded-set ceiling — a spawn under the Jira provider.
 *
 * WHY A SECOND ROW AND NOT A RAISED FIRST ONE. `BUDGET_LOADED_SET` above answers
 * "what does a tracker spawn cost on the GitHub path?", and a provider's cost does
 * not change that answer: no github operation file names the tool-call contract, so
 * that row's `MCP_TERM` stays 0 by construction and keeps its own headroom. Folding
 * a provider that DOES load the contract into that number would have billed every
 * GitHub user for bytes they never receive — the exact defect GAP-02 recorded — and
 * would have done it by raising a ratcheted ceiling, which §14.5 forbids outright.
 *
 * So the cost of a provider is priced per provider. Each MCP-backed provider gets
 * its own row and its own ceiling; none of them can move the GitHub one, and the
 * GitHub one cannot absorb theirs.
 *
 * The formula, term by term:
 *   the always-preloaded set
 *   + chars(references/tracker/_mcp.md)          — per-spawn under this provider
 *   + max_op chars(references/tracker/jira/{op}.md)
 *   + max over TRACKER ops of the one-spawn load [DR-12, D-LOADED-SET-SCOPE]
 *
 * Derived from a measured 74_225 plus the 2,200 ch RESERVATION LEDGER above:
 * 76_425. Outside the ledger, the next addition to the contract or to a Jira
 * mechanics file must fund itself with a cut rather than reach for slack. Trimming
 * `references/tracker/_mcp.md` is the honest first move: it is contract prose, it
 * is the single largest term this row adds over the GitHub one, and a pass over it
 * is cheaper than another ceiling.
 *
 * MAY BE LOWERED, NEVER RAISED. Registered as `budget-loaded-set-jira` in
 * tests/fixtures/numeric-floors.json.
 */
const BUDGET_LOADED_SET_JIRA = 76_425;

/**
 * THE LINEAR-SCOPED loaded-set ceiling — a spawn under the Linear provider.
 *
 * THE THIRD ROW, for the reason the second one exists (D-LOADED-SET-PER-PROVIDER):
 * each MCP-backed provider is priced on its own row, none of them can move the
 * GitHub one, and the GitHub one cannot absorb theirs.
 *
 * Derived from a measured 76_184 plus the 2,200 ch RESERVATION LEDGER above:
 * 78_384. This is the LARGEST of the four ceilings but not the binding one: a
 * character added to git.md is a character added to every row, and every row
 * reserves the same ledger. Re-run this file for each row's current headroom.
 *
 * WHY THIS PROVIDER'S max_op IS THE LARGEST OF THE THREE, recorded so the number is
 * not read as bloat. `backlink-shipped-issues` is where the dedup LADDER is stated,
 * and on this provider the ladder's conclusion is that three of its four rungs are
 * unreachable on a stock server (OD-12). Each rung's unavailability is a fact a
 * reader needs in order to not treat rank 4 as a misconfiguration — and the rank-4
 * marker predicate then needs BOTH halves written down, the first-line binding and
 * the second discriminator, because with no author column to compare against the
 * marker is the only evidence a comment is devflow's. That is what makes this
 * provider's `max_op` the largest of the three in the printed table, and it is
 * content rather than slack.
 *
 * MAY BE LOWERED, NEVER RAISED. Registered as `budget-loaded-set-linear` in
 * tests/fixtures/numeric-floors.json.
 */
const BUDGET_LOADED_SET_LINEAR = 78_384;

/**
 * THE PR-HOST loaded-set ceiling — the worst-case cost of a spawn that runs one of
 * the eight operations whose mechanics live under `references/pr/`.
 *
 * ITS OWN ROW, for the reason each provider has one (D-LOADED-SET-PER-PROVIDER).
 * `references/pr/` is installed under EVERY tracker, because pull requests, PR
 * reviews and PR checks stay on GitHub whatever issues the project files
 * elsewhere. A PR operation therefore costs the same bytes on all three paths:
 * folding it into the per-provider rows would price one cost three times over
 * while leaving the question a reader actually asks — what does a PR spawn load? —
 * answered nowhere. And it cannot ride the GitHub row, which is scoped to TRACKER
 * ops by D-LOADED-SET-SCOPE and would have to widen its own scope to carry it.
 *
 * The formula, term by term:
 *   the always-preloaded set
 *   + max over PR_HOST_OPS of ( chars(references/pr/{op}.md)
 *                               + every reference that op's own section names )
 *
 * No `max_op` term of its own: unlike the tracker rows, an op's PR-host mechanics
 * file is already inside its one-spawn load, so a separate largest-file term would
 * count the same document twice.
 *
 * THE ONE WRITTEN EXCLUSION is `references/github-api.md`, declared as
 * LOADED_SET_WRITTEN_EXCLUSIONS in tests/tracker/budget-model.ts with the reason
 * beside it: it is a file two of these ops loaded long before any split existed,
 * this work moved the line that names it without changing a byte a spawn pays, and
 * charging 21_355 ch of it here would bury the `pr/` bodies this row exists to
 * measure. What the exclusion owes in return (ADR-025) is shape `2c-ex` of the
 * four-shape table — the same maximum, RECORDED with the file charged — plus the
 * equality pin GITHUB_API_MD_CHARS, which is what stops an excluded term growing
 * unwatched.
 *
 * Derived from a measured 56_728 (`post-review-summary`: its PR-host body plus
 * references/publication-gate.md) plus the 2,200 ch RESERVATION LEDGER above:
 * 58_928.
 *
 * MAY BE LOWERED, NEVER RAISED. Registered as `budget-loaded-set-pr-host` in
 * tests/fixtures/numeric-floors.json.
 */
const BUDGET_LOADED_SET_PR_HOST = 58_928;

/**
 * Every MCP-backed provider and the ceiling that prices it.
 *
 * ONE table, read by three arms: the two per-provider gates below are generated
 * from it, and the completeness arm asks it about every provider the registry
 * carries. A provider registered in MCP_BACKED_PROVIDER_SUBDIRS with no entry here
 * is a per-spawn cost nothing gates, and that arm fails naming it — which is how
 * this table came to have a second row rather than the third provider shipping
 * unpriced.
 *
 * Deliberately NOT derived from the registry: the ceiling is a number somebody
 * measured and justified in a JSDoc, and a derived default would be a ceiling
 * nobody chose.
 */
const PRICED_PROVIDERS: Readonly<Record<string, number>> = {
  jira: BUDGET_LOADED_SET_JIRA,
  linear: BUDGET_LOADED_SET_LINEAR,
};

/**
 * AC-2.5 [DR-13(a)] — the bound on how much always-loaded prose the provider
 * resolution may occupy, in lines.
 *
 * LOWERED 40 → 36 against a measured 35, which is the permitted direction and the
 * one this ceiling has ever moved in: an earlier proposal to raise it to 70 was
 * refused because a `<= 70` assertion is strictly weaker than the one already in
 * place and buys nothing. One line of headroom is deliberate — the preamble is
 * preloaded on every Git spawn, so its length is a per-spawn cost, not a style
 * matter, and the next rule added to it must retire one.
 */
const PREAMBLE_MAX_LINES = 36;

/**
 * EQUALITY BASELINE, not a budget — `src/assets/skills/git/references/github-api.md`.
 *
 * D-LOADED-SET-SCOPE excludes this file from the gate on purpose: it is loaded by
 * `fetch-review-threads`, a NON-tracker op that loaded it long before the split, so
 * it is not a cost the split introduces. ADR-025's amendment is what the exclusion
 * owes in return — the excluded term goes in a RECORDED, non-gating row — and THIS
 * CONSTANT IS THAT ROW'S ANCHOR. Without one the row rots: a figure transcribed into
 * a PR body or a KNOWLEDGE.md is true when written and silent afterwards, so the
 * excluded term drifts with nothing tracking it.
 *
 * So it is pinned with `toBe`, never `<=`. It is not a ceiling to stay under; it is
 * the number the file IS, and no figure is recorded here beside it — the assertion
 * is the record (PF-057). THE ONLY COMMIT THAT MAY CHANGE IT IS THE COMMIT THAT
 * EDITS github-api.md's BYTES, and that commit re-pins it here in the same change —
 * the treatment GIT_MD_CHARS gets in tests/goldens/github-status-lines.test.ts. A
 * red equality pin means "re-measure and re-pin", never "relax the assertion".
 *
 * Measured, never hand-typed:
 *   node -e "console.log(require('fs').readFileSync('src/assets/skills/git/references/github-api.md','utf-8').length)"
 */
const GITHUB_API_MD_CHARS = 21_355;

// ---------------------------------------------------------------------------
// 1. The four-shape table — RECORDED, not asserted pass/fail
// ---------------------------------------------------------------------------
//
// EVERY MARGIN QUOTED OFF THIS TABLE NAMES ITS DENOMINATOR. That is why two
// percentage columns are printed: `vs shape 1` divides by the always-loaded
// preloaded set, `vs shape 2` divides by the shipped per-op loaded set. A bare
// percentage is unreproducible — it could be either, and the two differ by more than
// a factor of two. (An earlier revision of this comment and the feature KB each
// quoted margins with no denominator named, and neither matched the rows.)
//
// The disqualifying comparison is shape 3 against SHAPE 2, because shape 2 is what
// shipped. Read both percentage columns off a run rather than quoting figures
// forward from prose: they move whenever git.md or a reference does, and the table
// printed below is the record.
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

    // `_mcp.md` IS generated on this tree — a provider that needs it is registered —
    // and is still billed at 0 HERE, because this row is the GitHub path and no
    // github operation file names it. That is proven rather than assumed: the
    // re-scoped AC-2.7 arm in tests/guards/provider-scope.test.ts asserts no
    // `tracker/github/{op}.md` contains the string. A provider that DOES load it is
    // priced on its own row (BUDGET_LOADED_SET_JIRA), so this term cannot drift into
    // charging every GitHub user for bytes they never receive (GAP-02).
    const MCP_TERM = 0;

    // The shipped shape, named once so it can serve as BOTH a row and a stated
    // denominator: shape 3's disqualification is a margin over what shipped, not
    // over the baseline, and a margin whose denominator is unnamed is not a figure
    // a later reader can reproduce.
    const perOpLoadedSet = PRELOADED + MCP_TERM + largest.value + worst.value;

    const shapes = [
      {
        // The denominator of the `vs shape 1` column, so its label has to say what it
        // actually measures: the always-loaded preloaded set as it stands on this tree,
        // not BUDGET_LOADED_SET, which is the ceiling over the shipped shape-2 row.
        shape: '1. baseline — the always-loaded preloaded set',
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
      // One row per MCP-backed provider — the shapes the GitHub rows deliberately do
      // not describe. Printed beside shape 2 so the comparison a reviewer actually
      // needs (what does the second provider cost?) is on the same table.
      ...MCP_BACKED_PROVIDERS.map(provider => ({
        shape: `2-${provider}. per-op split, ${provider} path (loads the tool-call contract)`,
        chars: providerLoadedSet(provider),
      })),
      {
        // The PR-host path — the shape the three tracker rows deliberately do not
        // describe, since references/pr/ is installed under every provider and costs
        // the same bytes on each. Gated by BUDGET_LOADED_SET_PR_HOST.
        shape: '2c. PR-host spawn (the eight pr/ ops — same cost under every tracker)',
        chars: PRELOADED + worstCasePrHostLoad().value,
      },
      {
        // RECORDED ONLY, never gated [D-LOADED-SET-SCOPE]. The same maximum with the
        // written exclusion CHARGED — what the PR-host row would be if
        // references/github-api.md were treated as a cost this work introduced. This
        // is what the exclusion owes in return for being excluded (ADR-025): the
        // term stays visible and attributable instead of vanishing from the record.
        shape: '2c-ex. PR-host spawn + the written exclusion charged (RECORDED, not gated)',
        chars: PRELOADED + worstCasePrHostLoad([]).value,
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
      // The contract document's own size, recorded as a row rather than only as a
      // term: it is the single largest thing a provider row adds, so a trimming pass
      // is judged against this number.
      {
        row: `references/${MCP_CONTRACT_REL}  (0 on the GitHub path, per-spawn elsewhere)`,
        chars: referenceChars(MCP_CONTRACT_REL),
        bytes: NaN,
      },
      ...MCP_BACKED_PROVIDERS.flatMap(provider => [
        {
          row: `max_op ${provider} reference (${largestProviderReference(provider).op})`,
          chars: largestProviderReference(provider).value,
          bytes: NaN,
        },
        {
          row: `worst-case one-spawn load, ${provider} ops (${worstCaseProviderLoad(provider).op})`,
          chars: worstCaseProviderLoad(provider).value,
          bytes: NaN,
        },
      ]),
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
    // Seven fixed shapes plus one per MCP-backed provider, derived so a provider
    // registered later cannot be silently dropped from the record.
    expect(shapes).toHaveLength(7 + MCP_BACKED_PROVIDERS.length);
    expect(
      MCP_BACKED_PROVIDERS.length,
      'no MCP-backed provider is registered, so every provider row and the contract term below ' +
      'are vacuous — the table would print the GitHub path twice',
    ).toBeGreaterThan(0);
    expect(
      referenceChars(MCP_CONTRACT_REL),
      'the tool-call contract measured 0 — a provider row that omits its largest term understates ' +
      'the per-spawn cost of every provider that loads it',
    ).toBeGreaterThan(0);
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

/**
 * Named collector: the lines that ARE load pointers under `prefix` — one extra
 * sequential Read each.
 *
 * Parameterised over the prefix rather than fixed to `**Mechanics:**`, because
 * the agent has a SECOND pointer vocabulary: an operation whose mechanics
 * live under `references/pr/` points at them with `**PR mechanics:**`, and a
 * collector that only knew the first spelling would report a falling round-trip
 * count for a change that raised it.
 */
function collectPointerSites(content: string, prefix: string): string[] {
  return content.split('\n').filter(line => line.startsWith(prefix));
}

describe('byte budget: the round-trip term (recorded)', () => {
  it('records the Reads per spawn and the smallest references the character budget does not price', () => {
    const mechanicsSites = collectPointerSites(GIT_AGENT.content, '**Mechanics:**');
    const prMechanicsSites = collectPointerSites(GIT_AGENT.content, '**PR mechanics:**');
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
        value: mechanicsSites.length,
        unit: 'sites',
      },
      {
        term: '`**PR mechanics:**` pointer sites in the agent (1 extra sequential Read each)',
        value: prMechanicsSites.length,
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

    // BOTH pointer-site COUNTS are printed and deliberately NOT asserted. They are a
    // property of the agent's prose, already owned by the single-naming-line assertion
    // below and by reference-structure.test.ts; a second authority on how many pointer
    // sites the agent must have would fight them from a budget file, and a count is not
    // a budget.
  });
});

// ---------------------------------------------------------------------------
// 2. The budget gates
// ---------------------------------------------------------------------------

describe('byte budget: component and loaded-set pins (AC-2.5)', () => {
  it('chars(dist/agents/git.md) <= BUDGET_GIT_MD', () => {
    // The always-loaded half of the split, and the term every loaded-set row below
    // carries. The only legitimate way back under this line is to move text out of
    // the agent — never to raise the constant.
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
      `${BUDGET_LOADED_SET} ch. The split only pays for itself while the always-loaded half stays ` +
      `smaller than the references it adds back. Do NOT raise BUDGET_LOADED_SET — a ceiling is ` +
      `re-derived DOWNWARD or not at all; move text out of the agent, or condense the github ` +
      `mechanics, instead.`,
    ).toBeLessThanOrEqual(BUDGET_LOADED_SET);
  });

  it('the worst-case PR-host spawn <= BUDGET_LOADED_SET_PR_HOST', () => {
    // worst = preloaded set
    //       + max over PR_HOST_OPS of ( chars(pr/{op}.md) + every reference that op's
    //         own section names ), less LOADED_SET_WRITTEN_EXCLUSIONS
    //
    // No max_op term: a PR-host op's own mechanics file is already inside its
    // one-spawn load, so a separate largest-file term would count it twice.
    const worst = worstCasePrHostLoad();
    const total = PRELOADED + worst.value;

    // referenceChars() answers 0 for a file it cannot resolve, so an unbuilt
    // dist/skills/git/references/ drives the term to 0 and this gate passes by
    // measuring nothing (PF-018).
    expect(
      worst.value,
      'no PR-host reference load resolved — the budget summed nothing. Run `npm run build`.',
    ).toBeGreaterThan(0);

    // Every written exclusion has to be EXERCISED, or it is a declaration about
    // nothing that would stay green after the file it names stopped being
    // reachable (PF-064). Each is asserted as the ops that actually reach it,
    // named rather than counted: a count of 2 is equally satisfied by losing one
    // of these and gaining an unrelated op. Keyed per exclusion, so a new entry
    // on the list cannot ride through unexercised.
    const REACHED_BY: Readonly<Record<string, readonly string[]>> = {
      'github-api.md': ['fetch-review-threads', 'resolve-review-threads'],
    };
    expect(
      [...LOADED_SET_WRITTEN_EXCLUSIONS].sort(),
      'every LOADED_SET_WRITTEN_EXCLUSIONS entry needs the ops that reach it recorded here — an ' +
      'exclusion with no expected reach is one nothing proves is exercised',
    ).toEqual(Object.keys(REACHED_BY).sort());
    for (const excluded of LOADED_SET_WRITTEN_EXCLUSIONS) {
      const reaching = PR_HOST_OPS.filter(op => summedFor(op).has(excluded));
      expect(
        [...reaching].sort(),
        `no PR-host op names ${excluded} as expected, so LOADED_SET_WRITTEN_EXCLUSIONS excludes ` +
        'nothing there and shape 2c-ex records the same figure as this gate. Retire the ' +
        'exclusion, or find out what stopped reaching the file.',
      ).toEqual(REACHED_BY[excluded]);
    }

    expect(
      total,
      `worst-case PR-host spawn is ${total} ch (preloaded ${PRELOADED} + worst one-spawn load ` +
      `${worst.value} [${worst.op}]), budget ${BUDGET_LOADED_SET_PR_HOST} ch. references/pr/ is ` +
      `installed under EVERY tracker, so a character added to a pr/ body is a character every ` +
      `user pays on every path. Do NOT raise BUDGET_LOADED_SET_PR_HOST — §14.5: a ceiling is ` +
      `re-derived DOWNWARD or not at all; condense the pr/ mechanics instead.`,
    ).toBeLessThanOrEqual(BUDGET_LOADED_SET_PR_HOST);
  });

  it('the written exclusion is load-bearing — charging it would take the PR-host row over', () => {
    // What the recorded 2c-ex row is FOR, asserted rather than left to the table: the
    // exclusion is not a rounding convenience. If some later commit decides
    // github-api.md should be charged here, this arm states the consequence in
    // advance — the ceiling would have to move, which §14.5 does not allow, so the
    // decision is "re-scope the row", never "raise the number".
    const gated = PRELOADED + worstCasePrHostLoad().value;
    const unexcluded = PRELOADED + worstCasePrHostLoad([]).value;
    expect(
      unexcluded,
      'charging the written exclusion changes nothing — either the exclusion is inert or the ' +
      'file shrank to nothing, and shape 2c-ex is recording the gated figure twice',
    ).toBeGreaterThan(gated);
    expect(
      unexcluded,
      `the unexcluded PR-host row is ${unexcluded} ch and would fit under ` +
      `${BUDGET_LOADED_SET_PR_HOST}. The exclusion is then buying nothing and should be retired ` +
      `rather than defended.`,
    ).toBeGreaterThan(BUDGET_LOADED_SET_PR_HOST);
  });

  // One gate per priced provider, generated from PRICED_PROVIDERS rather than
  // written out twice. The claim is per-provider and identical in shape — the row
  // is under its ceiling — so a second hand-written copy would be two places a
  // message, a term or a non-vacuity floor could drift apart while both stayed
  // green.
  //
  // Each row is pinned FROM MEASUREMENT plus the named reservation ledger, so the
  // companion "the ceiling is a re-derivation of the GitHub one" arm that used to
  // sit beside this one is retired: it held the delta over a GitHub ceiling that
  // was itself derived, and neither row is derived any more. What stops a provider
  // ceiling being a free number now is the measurement and ledger recorded in its
  // JSDoc plus the downward-only rule, which this gate's own message states.
  for (const [provider, ceiling] of Object.entries(PRICED_PROVIDERS)) {
    const NAME = `BUDGET_LOADED_SET_${provider.toUpperCase()}`;

    it(`the worst-case ${provider} tracker spawn <= ${NAME}`, () => {
      // worst = preloaded set
      //       + chars(tracker/_mcp.md)               /* per-spawn, this provider loads it */
      //       + max_op chars(tracker/{provider}/{op}.md)
      //       + max over TRACKER ops of ( sum of every reference that op can name in one
      //         spawn )  [DR-12, scoped by D-LOADED-SET-SCOPE]
      expect(
        MCP_BACKED_PROVIDERS,
        `the ${provider} provider must be registered, or this gate measures an absent tree`,
      ).toContain(provider);

      const largest = largestProviderReference(provider);
      const worst = worstCaseProviderLoad(provider);
      const contract = referenceChars(MCP_CONTRACT_REL);
      const total = providerLoadedSet(provider);

      // referenceChars() answers 0 for a file it cannot resolve, so an absent
      // dist/skills/git/references/ drives every term to 0 and this gate passes by
      // measuring nothing — the PF-018 shape, in the gate whose green is this
      // subtask's headline claim.
      expect(
        contract,
        'the tool-call contract did not resolve — the provider row omits its own largest term. ' +
        'Run `npm run build`.',
      ).toBeGreaterThan(0);
      expect(
        largest.value,
        `no ${provider} mechanics file resolved — the budget summed nothing. Run \`npm run build\`.`,
      ).toBeGreaterThan(0);
      expect(
        worst.value,
        'no one-spawn reference load resolved — the budget summed nothing. Run `npm run build`.',
      ).toBeGreaterThan(0);

      expect(
        total,
        `worst-case ${provider} tracker spawn is ${total} ch (preloaded ${PRELOADED} + contract ` +
        `${contract} + max_op ${largest.value} [${largest.op}] + worst one-spawn load ${worst.value} ` +
        `[${worst.op}]), budget ${ceiling} ch. Do NOT raise ` +
        `${NAME} — §14.5: a ceiling is re-derived DOWNWARD or not at all. The ` +
        `honest first move is trimming references/${MCP_CONTRACT_REL}, this row's largest single ` +
        `addition and pure contract prose; the second is condensing the ${provider} mechanics. ` +
        `Neither is "give the provider more room".`,
      ).toBeLessThanOrEqual(ceiling);
    });
  }

  it('every MCP-backed provider has a ceiling, and no provider is priced on the GitHub row', () => {
    // The arm that keeps the per-provider model honest as providers are added: a
    // provider with generated mechanics and no registered ceiling would be a cost
    // nothing gates. It is a list membership check, not a count, so the message
    // names the provider that is missing one.
    for (const provider of MCP_BACKED_PROVIDERS) {
      expect(
        PRICED_PROVIDERS[provider],
        `provider "${provider}" has generated mechanics but no loaded-set ceiling. Add a ` +
        `BUDGET_LOADED_SET_${provider.toUpperCase()} constant with its derivation, register it in ` +
        `tests/fixtures/numeric-floors.json, and add it here — never fold it into the GitHub row, ` +
        `which prices a path that does not load the tool-call contract.`,
      ).toBeDefined();
    }
    // …and the GitHub row is unaffected by any of them: its contract term is 0.
    for (const op of TRACKER_GITHUB_OPS) {
      expect(
        readFileSync(resolveReference(trackerRefRel(op))!, 'utf-8').includes(MCP_CONTRACT_REL),
        `tracker/github/${op}.md names the tool-call contract, so the GitHub row's 0 contract ` +
        `term is wrong by ${referenceChars(MCP_CONTRACT_REL)} ch`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The preamble — ceiling and single-naming-line [DR-13(a), DR-27(c)]
// ---------------------------------------------------------------------------

describe('byte budget: the provider-resolution preamble', () => {
  it(`sits between the D4 block and the publication gate, and is <= ${PREAMBLE_MAX_LINES} lines`, () => {
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
    //
    // ONE LINE, TWO PATHS — and the count stays 1 deliberately. That line composes
    // the per-operation mechanics path from the validated provider token AND names
    // the tool-call contract, which is a FIXED literal composed from nothing. The
    // convergence point PF-023 is about is the COMPOSITION, so a fixed name riding
    // on the same line adds no second place a path is built. The arm below is the
    // other half: it holds the fixed literal to that same line, so the two claims
    // cannot be satisfied by two lines between them.
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

    expect(
      /references\/tracker\/\\?\{provider\\?\}/.test(naming[0]),
      'the single naming line must COMPOSE the mechanics path from the provider token — an ' +
      'instruction that hard-codes a provider cannot reach the tree the registry emits',
    ).toBe(true);

    // Standing prohibition (§14.5): references are addressed skill-relatively.
    expect(
      naming[0].includes('~/.claude'),
      'no generated reference path literal may begin with ~/.claude — CLAUDE_CODE_DIR and ' +
      'local-scope installs put the skill somewhere else entirely',
    ).toBe(false);
  });

  it('the tool-call contract is named as a fixed literal on that same line', () => {
    // The contract is read once per SPAWN under every non-github provider, so its
    // naming site has to be the always-loaded preamble. It used to be the
    // per-operation mechanics that named it, and only five of ten did — the other
    // five ran tracker calls with no transport prohibition and no trust discipline
    // (PF-058). The reachability suite owns the inverse (no generated op file names
    // it); this arm owns the byte-budget half: it rides the existing line, so the
    // fix costs one clause rather than a second preloaded naming line.
    const naming = collectTrackerNamingLines(GIT_AGENT.content);
    expect(
      naming.length,
      'the composition arm above is the precondition for this one',
    ).toBe(1);
    expect(
      naming[0],
      'the preamble must name references/tracker/_mcp.md on the SAME line that composes the ' +
      'mechanics path. A line of its own would be a second preloaded naming line; a naming site ' +
      'inside an operation would make a per-spawn load look per-operation.',
    ).toContain('references/tracker/_mcp.md');
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
    // Both declared halves: the glossary the agent may consult and the contract it
    // must have. The scope question is 'does the model know the agent can name this',
    // and a name in either half is a name the model knows about.
    const modelled = new Set([...MODEL_CROSS_CUTTING_ON_DEMAND, ...MODEL_CROSS_CUTTING_ASSERTED]);

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
      collectMissingFrom(
        '(always-loaded)',
        nameableCrossCutting(seededAbove),
        new Set([...MODEL_CROSS_CUTTING_ON_DEMAND, ...MODEL_CROSS_CUTTING_ASSERTED]),
      ),
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

  it('the ONE hop into a pr/ body is live — github-api.md reaches fetch-review-threads only through it', () => {
    // nameableFrom's PR-host hop, asserted where it bites rather than in prose.
    // `fetch-review-threads` step 1 — the only place the operation names
    // github-api.md — lives in references/pr/fetch-review-threads.md. Without the
    // hop the model sums a file the scan cannot see the op name, and direction 1
    // goes red for a reason that is not a regression.
    expect(
      SECTIONS.get('fetch-review-threads') ?? '',
      'this arm only means something while git.md itself does NOT name github-api.md for this op ' +
      '— if the mention came back, the hop is no longer what makes direction 1 pass',
    ).not.toContain('references/github-api.md');
    expect(
      [...nameableFrom('fetch-review-threads')],
      'github-api.md must be reachable through the pr/ reference the op names',
    ).toContain('github-api.md');
  });

  it('known-bad probe: a file named only inside a pr/ body is reported by direction 2', () => {
    // Seeds the hop's own reader rather than writing into dist/ (PF-055), and
    // drives the SAME collector both live directions call. Without this, the hop
    // could stop resolving and every direction-2 assertion would stay green —
    // an absence check over a corpus nobody perturbs (PF-064).
    const op = 'post-review-summary';
    const seededNameable = nameableFrom(op, rel =>
      rel === prHostRel(op) ? 'Then read `references/smuggled.md` for the rest.\n' : null);
    expect(
      collectMissingFrom(op, seededNameable, summedFor(op)),
      'a reference named only inside the PR-host body must be reported as unmodelled — otherwise ' +
      'the hop is declared and never taken',
    ).toEqual([`${op} → smuggled.md`]);
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

  it('the two summary ops are PR-host, never tracker, and keep their D10 naming line in the agent (SG-8)', () => {
    // SG-8 as shipped: the two summary ops' step order lives in
    // references/pr/{op}.md under the condition SG-8 imposes — each guard reading
    // it carries a known-bad probe, and the D10/D11 controls stay answerable from
    // the agent.
    //
    // The END STATE, asserted rather than the prohibition it replaced:
    //   1. the op is still a section of the agent (its contract did not move);
    //   2. it still names the publication gate from git.md — [DR-20](i) reads
    //      git.md ALONE, so an op that stopped naming it there would take the
    //      scope property with it;
    //   3. it is a PR-host op, not a tracker op — these two are never generated
    //      per provider, which is the half of the original exclusion that was
    //      always about correctness rather than size;
    //   4. the PR-host reference it names is real and non-empty, so "the step
    //      order moved" names a file that exists rather than nothing.
    for (const op of ['post-review-summary', 'post-resolution-summary']) {
      expect(SECTIONS.has(op), `${op} must still be a section of the agent`).toBe(true);
      expect(
        SECTIONS.get(op) ?? '',
        `${op} must still name references/publication-gate.md from git.md — [DR-20](i) reads the ` +
        'agent alone, and the D10 scope property lives or dies there',
      ).toContain('references/publication-gate.md');
      expect(
        (TRACKER_GITHUB_OPS as readonly string[]).includes(op),
        `${op} must not be a generated tracker reference (SG-8 written exclusion)`,
      ).toBe(false);
      expect(
        isPrHostOp(op),
        `${op} must be a PR-host op — PR comments are posted on GitHub under every tracker`,
      ).toBe(true);
      expect(
        referenceChars(prHostRel(op)),
        `${prHostRel(op)} must exist and carry its mechanics — an empty file would make the move ` +
        'a deletion wearing a pointer',
      ).toBeGreaterThan(0);
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
