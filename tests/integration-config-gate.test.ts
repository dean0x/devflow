/**
 * Guard for the DEVFLOW_INTEGRATION_ALL opt-in in vitest.integration.config.ts.
 *
 * The excluded file spawns live `claude` sessions against the developer's own
 * ~/.claude with --dangerously-skip-permissions and has previously committed to
 * this repo mid-run (PF-060, PF-055). A gate that opts in on any non-empty
 * string turns `DEVFLOW_INTEGRATION_ALL=0` — the spelling a developer reaches
 * for to say "no" — into a live run, so the gate is asserted directly here
 * rather than left to the shape of the expression.
 *
 * These tests exercise the pure functions only. They never set the env var and
 * never run the integration suite.
 */

import { describe, it, expect } from 'vitest';
import { configDefaults } from 'vitest/config';
import integrationConfig, {
  isAffirmative,
  integrationExclude,
  LIVE_CLAUDE_TEST,
} from '../vitest.integration.config.js';

describe('DEVFLOW_INTEGRATION_ALL gate (isAffirmative)', () => {
  const AFFIRMATIVE = ['1', 'true', 'yes', 'TRUE', 'Yes', ' 1 '];
  const NEGATIVE: (string | undefined)[] = ['0', 'false', 'no', 'off', '', '   ', undefined, 'maybe'];

  it.each(AFFIRMATIVE)('opts in on %o', value => {
    expect(isAffirmative(value), `${JSON.stringify(value)} must opt in`).toBe(true);
  });

  it.each(NEGATIVE)('does NOT opt in on %o', value => {
    expect(
      isAffirmative(value),
      `${JSON.stringify(value)} must NOT opt in — bare truthiness would enable a live-claude run here`,
    ).toBe(false);
  });
});

describe('integration exclude list', () => {
  it('excludes the live-claude test for every non-affirmative value', () => {
    for (const value of ['0', 'false', 'no', 'off', '', undefined]) {
      expect(
        integrationExclude(value),
        `${JSON.stringify(value)} must leave ${LIVE_CLAUDE_TEST} excluded`,
      ).toContain(LIVE_CLAUDE_TEST);
    }
  });

  it('drops the exclusion only for an explicit affirmative', () => {
    for (const value of ['1', 'true', 'yes']) {
      expect(
        integrationExclude(value),
        `${JSON.stringify(value)} must opt the live-claude test back in`,
      ).not.toContain(LIVE_CLAUDE_TEST);
    }
  });

  it('keeps vitest\'s own exclude defaults in BOTH branches', () => {
    // Setting `exclude` replaces vitest's defaults rather than merging with
    // them, so an unspread list silently drops the **/node_modules/** and
    // **/dist/** guards.
    expect(configDefaults.exclude.length, 'configDefaults.exclude is empty — guard is vacuous')
      .toBeGreaterThan(0);
    for (const value of ['1', '0']) {
      expect(
        integrationExclude(value),
        `${JSON.stringify(value)} branch must keep configDefaults.exclude`,
      ).toEqual(expect.arrayContaining([...configDefaults.exclude]));
    }
  });

  it('the exported config wires the gate (defaults present in its exclude)', () => {
    // Branch-independent: whatever the ambient env says, the config's exclude
    // must be the gate's output and therefore carry the defaults.
    const exclude = integrationConfig.test?.exclude;
    expect(exclude, 'vitest.integration.config.ts must declare test.exclude').toBeDefined();
    expect(exclude).toEqual(expect.arrayContaining([...configDefaults.exclude]));
  });
});
