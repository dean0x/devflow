/**
 * Agent ↔ shell seams: the two numbers the tracker inference lifecycle shares.
 *
 * The lifecycle is driven by two files under `~/.devflow` — the claim
 * `.tracker.processing` and the counter `.tracker.attempts` — and each is governed
 * by one number that TWO parties spell separately, in two languages, with nothing
 * at runtime reconciling them. Both seams live here because they are one mechanism:
 * a disagreement about either number is spent against the other, and the symptom of
 * both is the same silent closure of inference.
 *
 *   1. the claim-staleness bound (below) — `TRACKER_PROCESSING_STALE_SECS` vs the
 *      agent's Step 0;
 *   2. the attempt cap (bottom of the file) — `TRACKER_ATTEMPTS_MAX` vs the agent's
 *      `## Finishing`, with `src/core/tracker.ts`'s exported constant as a third
 *      side because `devflow tracker --status` quotes it back to the user.
 *
 * Seam 1: the claim-file staleness bound is ONE number with TWO deciders.
 *
 * `~/.devflow/.tracker.processing` is classified as live-or-crashed twice, in two
 * languages, by two parties that never talk to each other:
 *
 *   - shell — `session-start-context`'s Section 3 compares the claim file's age
 *     against `TRACKER_PROCESSING_STALE_SECS` and decides whether to emit the
 *     background-setup directive at all;
 *   - the Tracker agent — Step 0 compares the same file's age and decides whether
 *     to exit silently (a live sibling owns the run) or re-claim it (the previous
 *     run crashed).
 *
 * Nothing at runtime reconciles the two. If the hook's number is the larger, the
 * hook suppresses while the agent would have re-claimed — inference stalls for a
 * session with no signal. If the agent's is the larger, the hook re-arms and the
 * spawned agent exits silently against a claim it considers fresh — an attempt is
 * burned against the OD-14 cap on every session until the cap closes the feature
 * permanently. Both failures are silent, and both are invisible to every other
 * guard in this repo: the hook's literal is pinned in `tests/shell-hooks-tracker.test.ts`
 * and the agent's prose is pinned in `tests/tracker-agent.test.ts`, but neither
 * file reads the other side. This is the only place they are compared.
 *
 * This is the Learning-900s gotcha with the parties swapped, and it is why the
 * hook's comment names 600 as "its OWN literal, deliberately NOT shared with
 * Learning's 900": two features must not share the constant, and the two halves of
 * ONE feature must not disagree about it.
 *
 * The agent is read through `resolveAgentSource` (dist-preferred, src-fallback,
 * fail-loud), never through a literal agent path (AC-0.7).
 *
 * Non-vacuity: every collector is driven by the guard AND by an inline known-bad
 * sample in the same `it`, so no negative can pass because an extractor silently
 * stopped returning anything (PF-018). A side that states no number yields `null` /
 * `[]` and is REPORTED as unstated rather than read as agreement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import { TRACKER_ATTEMPTS_MAX } from '../../src/core/tracker.js';
import { resolveAgentSource } from '../helpers.js';

const CONTEXT_HOOK = path.join(scriptsDir(), 'hooks', 'session-start-context');

/** The shell variable that carries the staleness bound. Named once. */
const STALE_SECS_VAR = 'TRACKER_PROCESSING_STALE_SECS';
/** The shell variable that carries the attempt cap. Named once. */
const ATTEMPTS_MAX_VAR = 'TRACKER_ATTEMPTS_MAX';

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/**
 * Named collector: the integer the hook ASSIGNS to a named shell variable.
 *
 * Shared by both seams below — the staleness bound and the attempt cap are the
 * same shape of literal in the same file, and one extractor driven by two known-bad
 * samples is one extractor to keep honest rather than two.
 *
 * Comment lines are skipped on the same terms as `collectKeyPathReadSites` in
 * `tests/seams/tracker-key-path.test.ts` — both variables are named in Section 3's
 * derivation comments, and those mentions are documentation, not second
 * assignments. Returns `null` when no live assignment exists, so a hook that lost
 * the literal is reported rather than compared against `undefined`.
 */
export function collectHookIntAssignment(source: string, varName: string): number | null {
  const assignment = new RegExp(`^\\s*${varName}=(\\d+)\\s*$`);
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const m = assignment.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Named collector: every second-count the agent states as a bold literal.
 *
 * The agent is prose, so the bound cannot be read from an assignment. `**N
 * seconds**` is the shape Step 0 states it in — bold, because the number is a
 * contract with the hook rather than an illustration. Every occurrence is
 * returned (not the first), so an agent that states the bound twice and disagrees
 * with itself fails here instead of passing on whichever arm is read first.
 */
export function collectAgentSecondLiterals(source: string): number[] {
  return [...source.matchAll(/\*\*(\d+) seconds\*\*/g)].map(m => Number(m[1]));
}

/**
 * Named collector: every attempt cap the agent states as a bold literal.
 *
 * Same shape, and for the same reason, as `collectAgentSecondLiterals`: the agent
 * is prose, so the cap cannot be read from an assignment, and `**N attempts**` is
 * bold because the number is a contract with the hook rather than an illustration.
 * A bare `**5**` is deliberately NOT matched — an unqualified bold integer in a
 * prompt is any number at all, and a collector that accepted one would bind this
 * seam to whichever bold digit the agent happens to carry next.
 *
 * Every occurrence is returned (not the first), so an agent that states the cap
 * twice and disagrees with itself fails here instead of passing on whichever arm is
 * read first.
 */
export function collectAgentAttemptCaps(source: string): number[] {
  return [...source.matchAll(/\*\*(\d+) attempts?\*\*/g)].map(m => Number(m[1]));
}

/** How far past `**Heartbeat**` the refresh may be stated. Bounded (PF-018). */
const HEARTBEAT_WINDOW_CHARS = 400;

/**
 * Named collector: how the agent states its claim refresh — as ONE point, or as a
 * repeating cadence.
 *
 * The bound above is only a liveness bound if something refreshes the claim file
 * while the run is alive, and the question this seam asks is WHERE. The refresh is
 * stated as a single point at the probe → compose boundary: the probe phase is
 * network-bound and its duration is not the agent's to predict, so the clock that
 * matters is the one composition runs against, and one touch there re-arms the
 * bound for exactly the phase that could otherwise outlive it.
 *
 * A CADENCE — "once per capability probed, and once per section composed" — is
 * reported instead of accepted. It reads as strictly safer and is not: it is an
 * instruction with no observable count, so nothing distinguishes a run that
 * followed it from one that touched once and moved on, and every extra touch is a
 * write to the very file the next session's gate stats. The single point is the
 * form a prompt can actually be held to.
 *
 * Returns the cadence units it found, so `[]` means "no repetition stated" — the
 * shape the agent must have — and a non-empty list names what to delete. The
 * boundary itself is asserted separately, so an agent that states NEITHER is
 * caught rather than read as compliant.
 *
 * Whitespace is normalised first because the agent hard-wraps: `once per` lands
 * across a line break in the shipped text, and pinning where a sentence happens to
 * break is what PF-057 warns against.
 */
export function collectHeartbeatCadenceUnits(source: string): string[] {
  const block = heartbeatBlock(source);
  return [...block.matchAll(/once per ([a-z]+(?: [a-z]+)?)/g)].map(m => m[1]);
}

/** The `**Heartbeat**` step's own text, whitespace-normalised and bounded. */
function heartbeatBlock(source: string): string {
  const normalized = source.replace(/\s+/g, ' ');
  const at = normalized.indexOf('**Heartbeat**');
  if (at === -1) return '';
  return normalized.slice(at, at + HEARTBEAT_WINDOW_CHARS);
}

/** The boundary the single refresh is pinned to, as both sides of this seam name it. */
const REFRESH_POINT = /probe\s*(?:→|->)\s*compose/i;

/** Named collector: whether the heartbeat names the one point it refreshes at. */
export function collectHeartbeatRefreshPoint(source: string): string | null {
  const match = REFRESH_POINT.exec(heartbeatBlock(source));
  return match === null ? null : match[0];
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('tracker claim-staleness seam: the hook and the Tracker agent agree on one bound', () => {
  const hookSource = readFileSync(CONTEXT_HOOK, 'utf-8');
  const agentSource = resolveAgentSource('tracker').content;

  it('the hook assigns a staleness bound (collector is live)', () => {
    const hookValue = collectHookIntAssignment(hookSource, STALE_SECS_VAR);
    expect(
      hookValue,
      `${STALE_SECS_VAR} has no live assignment in session-start-context — ` +
        'the hook lost its claim-staleness bound, or the variable was renamed ' +
        'without updating this seam.',
    ).not.toBeNull();
    expect(hookValue).toBeGreaterThan(0);

    // Known-bad, same it: a source where the only mention is a comment must not
    // be read as an assignment, and a source with none must report null.
    expect(collectHookIntAssignment(`# ${STALE_SECS_VAR}=600 explains the number\n`, STALE_SECS_VAR))
      .toBeNull();
    expect(
      collectHookIntAssignment(`${ATTEMPTS_MAX_VAR}=${TRACKER_ATTEMPTS_MAX}\n`, STALE_SECS_VAR),
      'the neighbouring cap assignment is not this bound — the two live four lines apart in the ' +
        'same gate, and a collector that answered on either would make both seams read one number',
    ).toBeNull();
    expect(collectHookIntAssignment(`  ${STALE_SECS_VAR}=900\n`, STALE_SECS_VAR)).toBe(900);
  });

  it('the Tracker agent states the claim-staleness bound exactly once (collector is live)', () => {
    const stated = collectAgentSecondLiterals(agentSource);
    expect(
      stated,
      'The Tracker agent states no `**N seconds**` bound. Step 0 must name the ' +
        'claim-staleness threshold explicitly: an agent that says only ' +
        '"Fresh"/"Stale" leaves live-vs-crashed classification to whatever the ' +
        'model guesses, and it will not guess the hook\'s number.',
    ).not.toHaveLength(0);
    expect(
      stated,
      `The Tracker agent states more than one \`**N seconds**\` bound (${stated.join(', ')}). ` +
        'There is one claim-staleness threshold; stating it once is what keeps the ' +
        'two arms of the Fresh/Stale pair from disagreeing.',
    ).toHaveLength(1);

    // Known-bad, same it: an agent stating nothing, and one stating two values.
    expect(collectAgentSecondLiterals('- **Fresh** — a sibling is live.\n')).toEqual([]);
    expect(
      collectAgentSecondLiterals('under **600 seconds** … at or over **900 seconds** …'),
    ).toEqual([600, 900]);
  });

  it('the Tracker agent refreshes the claim at exactly ONE named point, never on a cadence', () => {
    expect(
      collectHeartbeatRefreshPoint(agentSource),
      'The Tracker agent names no refresh point. The bound is then measured from the create for ' +
        'the whole run, so a probe phase that outlives it self-classifies as a crash while the ' +
        'agent is still working — and the hook re-arms against a live sibling.',
    ).not.toBeNull();
    const cadence = collectHeartbeatCadenceUnits(agentSource);
    expect(
      cadence,
      `The Tracker agent states a repeating heartbeat (${cadence.join(', ')}). A per-unit ` +
        'cadence in a prompt has no observable count: nothing distinguishes a run that followed ' +
        'it from one that touched once, and every extra touch writes to the file the gate stats. ' +
        'One refresh at the probe → compose boundary is the form this seam can hold the agent to.',
    ).toEqual([]);

    // Known-bad, same it: the retired cadence must be REPORTED and must name no
    // single point, and an agent with no heartbeat at all must come back null/[]
    // rather than throw.
    const retired =
      '3. **Heartbeat**: `touch` the claim file **repeatedly** while you work — once per\n' +
      '   capability probed, and once per section composed.';
    expect(collectHeartbeatCadenceUnits(retired)).toEqual(['capability probed', 'section composed']);
    expect(
      collectHeartbeatRefreshPoint(retired),
      'the retired cadence named no single point either — the two collectors must disagree about it',
    ).toBeNull();
    expect(collectHeartbeatCadenceUnits('The agent states no heartbeat.')).toEqual([]);
    expect(collectHeartbeatRefreshPoint('The agent states no heartbeat.')).toBeNull();
  });

  it('the agent\'s stated bound equals the hook\'s TRACKER_PROCESSING_STALE_SECS', () => {
    const hookValue = collectHookIntAssignment(hookSource, STALE_SECS_VAR);
    const [agentValue] = collectAgentSecondLiterals(agentSource);

    expect(
      agentValue,
      `The Tracker agent states ${agentValue}s as the claim-staleness bound and ` +
        `session-start-context uses ${hookValue}s. The two must be equal or ` +
        'live-vs-crashed classification diverges silently: the larger side ' +
        'suppresses what the smaller side re-arms, and every mismatched session ' +
        'either stalls inference or burns an OD-14 attempt for nothing.',
    ).toBe(hookValue);
  });
});

// ---------------------------------------------------------------------------
// Seam 2: the attempt cap is ONE number with THREE spellings
// ---------------------------------------------------------------------------
//
// `~/.devflow/.tracker.attempts` bounds how many times the feature may try to infer
// conventions before it closes permanently (OD-14). Three parties state that bound
// and none reads another:
//
//   - shell — `session-start-context` Section 3 ENFORCES it: `TRACKER_ATTEMPTS_MAX`
//     is what the counter is compared against before a directive is emitted;
//   - TypeScript — `src/core/tracker.ts` exports `TRACKER_ATTEMPTS_MAX`, which is
//     the number `devflow tracker --status` QUOTES BACK to the user when it re-arms
//     the counter;
//   - the Tracker agent — `## Finishing` step 1 declines to spend an attempt of its
//     own *because* the gate's cap engages without it, and names the cap to say
//     which budget it is relying on [DR-02].
//
// Only two of the three pairs were pinned before this seam: tests/core/tracker.test.ts
// compares the exported constant against the hook literal. The agent was pinned
// independently by a `/\b5\b/` match in tests/tracker-agent.test.ts — a pattern that
// a page of prose satisfies by accident and that says nothing about the other two
// sides. Lowering the hook to 3 and updating its own tests therefore left the agent
// telling the model a budget the gate no longer grants, silently: the agent skips an
// increment on the strength of a cap that is smaller than it believes, and inference
// closes earlier than the prompt says it will, with no user-visible error.
//
// This is the staleness seam two constants over, so it is asserted the same way —
// an unstated bound is REPORTED as unstated rather than read as agreement (PF-018),
// and every collector is driven by a known-bad sample in the same `it`.

describe('tracker attempt-cap seam: the hook, the Tracker agent and src/core agree on one cap', () => {
  const hookSource = readFileSync(CONTEXT_HOOK, 'utf-8');
  const agentSource = resolveAgentSource('tracker').content;

  it('the hook assigns an attempt cap (collector is live)', () => {
    const hookValue = collectHookIntAssignment(hookSource, ATTEMPTS_MAX_VAR);
    expect(
      hookValue,
      `${ATTEMPTS_MAX_VAR} has no live assignment in session-start-context — the hook lost the ` +
        'cap it enforces, or the variable was renamed without updating this seam.',
    ).not.toBeNull();
    expect(hookValue).toBeGreaterThan(0);

    // Known-bad, same it: the derivation comment that names the variable is not an
    // assignment, and the neighbouring staleness bound is not this cap.
    expect(collectHookIntAssignment(`# ${ATTEMPTS_MAX_VAR}=3 explains the cap\n`, ATTEMPTS_MAX_VAR))
      .toBeNull();
    expect(collectHookIntAssignment(`${STALE_SECS_VAR}=600\n`, ATTEMPTS_MAX_VAR)).toBeNull();
    expect(collectHookIntAssignment(`  ${ATTEMPTS_MAX_VAR}=3\n`, ATTEMPTS_MAX_VAR)).toBe(3);
  });

  it('the Tracker agent states the attempt cap exactly once (collector is live)', () => {
    const stated = collectAgentAttemptCaps(agentSource);
    expect(
      stated,
      'The Tracker agent states no `**N attempts**` cap. `## Finishing` step 1 tells the model to ' +
        'spend NO attempt of its own; the only thing that makes that safe is the gate\'s cap, so ' +
        'the agent has to name the budget it is declining to spend from — otherwise the next ' +
        'reader restores an agent-side increment and every failed cycle costs two.',
    ).not.toHaveLength(0);
    expect(
      stated,
      `The Tracker agent states more than one \`**N attempts**\` cap (${stated.join(', ')}). ` +
        'There is one cap; stating it once is what keeps the write-less-exit clause from ' +
        'disagreeing with whatever else in the prompt quotes a budget.',
    ).toHaveLength(1);

    // Known-bad, same it: an agent stating nothing, one stating two values, and the
    // bare bold integer the collector deliberately does not accept as a cap.
    expect(collectAgentAttemptCaps('- leave the counter exactly as you found it.\n')).toEqual([]);
    expect(collectAgentAttemptCaps('a cap of **3 attempts** … raised to **5 attempts** …'))
      .toEqual([3, 5]);
    expect(
      collectAgentAttemptCaps('the cap of **5** engages without you'),
      'an unqualified bold integer is any number at all; the unit is what makes it this cap',
    ).toEqual([]);
    expect(collectAgentAttemptCaps('the cap of **1 attempt** engages')).toEqual([1]);
  });

  it("the agent's stated cap equals the hook's literal AND src/core's exported constant", () => {
    const hookValue = collectHookIntAssignment(hookSource, ATTEMPTS_MAX_VAR);
    const [agentValue] = collectAgentAttemptCaps(agentSource);

    expect(
      agentValue,
      `The Tracker agent states a cap of ${agentValue} attempts and session-start-context ` +
        `enforces ${hookValue}. The two must be equal: the agent skips its own increment on the ` +
        'strength of the gate\'s cap [DR-02], so a smaller hook value closes inference before the ' +
        'prompt says it will, and a larger one leaves the crash-loop case running longer than ' +
        'OD-14 allows — both silently.',
    ).toBe(hookValue);
    expect(
      agentValue,
      `The Tracker agent states a cap of ${agentValue} attempts and src/core/tracker.ts exports ` +
        `${TRACKER_ATTEMPTS_MAX}, which is the number \`devflow tracker --status\` quotes back ` +
        'when it re-arms the counter. A user told they have N tries must have N tries.',
    ).toBe(TRACKER_ATTEMPTS_MAX);
  });
});
