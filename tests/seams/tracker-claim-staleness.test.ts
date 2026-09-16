/**
 * Agent ↔ shell seam: the claim-file staleness bound is ONE number with TWO deciders.
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
 * guard in this repo: the hook's literal is pinned in `tests/shell-hooks.test.ts`
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
 * Non-vacuity: both collectors are driven by the guard AND by an inline known-bad
 * sample in the same `it`, so neither negative can pass because an extractor
 * silently stopped returning anything (PF-018). A side that states no number
 * yields `null` / `[]` and is REPORTED as unstated rather than read as agreement.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import { resolveAgentSource } from '../helpers.js';

const CONTEXT_HOOK = path.join(scriptsDir(), 'hooks', 'session-start-context');

/** The shell variable that carries the bound. Named once. */
const STALE_SECS_VAR = 'TRACKER_PROCESSING_STALE_SECS';

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/**
 * Named collector: the value the hook ASSIGNS to the staleness variable.
 *
 * Comment lines are skipped on the same terms as `collectKeyPathReadSites` in
 * `tests/seams/tracker-key-path.test.ts` — the variable is named in Section 3's
 * derivation comment, and that mention is documentation, not a second assignment.
 * Returns `null` when no live assignment exists, so a hook that lost the literal
 * is reported rather than compared against `undefined`.
 */
export function collectHookStaleSecs(source: string, varName: string): number | null {
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

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('tracker claim-staleness seam: the hook and the Tracker agent agree on one bound', () => {
  const hookSource = readFileSync(CONTEXT_HOOK, 'utf-8');
  const agentSource = resolveAgentSource('tracker').content;

  it('the hook assigns a staleness bound (collector is live)', () => {
    const hookValue = collectHookStaleSecs(hookSource, STALE_SECS_VAR);
    expect(
      hookValue,
      `${STALE_SECS_VAR} has no live assignment in session-start-context — ` +
        'the hook lost its claim-staleness bound, or the variable was renamed ' +
        'without updating this seam.',
    ).not.toBeNull();
    expect(hookValue).toBeGreaterThan(0);

    // Known-bad, same it: a source where the only mention is a comment must not
    // be read as an assignment, and a source with none must report null.
    expect(collectHookStaleSecs(`# ${STALE_SECS_VAR}=600 explains the number\n`, STALE_SECS_VAR))
      .toBeNull();
    expect(collectHookStaleSecs('TRACKER_ATTEMPTS_MAX=5\n', STALE_SECS_VAR)).toBeNull();
    expect(collectHookStaleSecs(`  ${STALE_SECS_VAR}=900\n`, STALE_SECS_VAR)).toBe(900);
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

  it('the agent\'s stated bound equals the hook\'s TRACKER_PROCESSING_STALE_SECS', () => {
    const hookValue = collectHookStaleSecs(hookSource, STALE_SECS_VAR);
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
