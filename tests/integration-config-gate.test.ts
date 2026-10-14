/**
 * Guard for the DEVFLOW_INTEGRATION_ALL opt-in in vitest.integration.config.ts.
 *
 * Two integration files start live `claude` sessions: they need a credential and
 * spend real tokens. Without the opt-in the integration config excludes both, so
 * `npm run test:integration` starts no session and runs no live `init`. With an
 * explicit affirmative (1, true or yes) both are collected. A gate that opts in on
 * any non-empty string turns `DEVFLOW_INTEGRATION_ALL=0` — the spelling a developer
 * reaches for to say "no" — into a live run, so the gate is asserted directly here
 * rather than left to the shape of the expression.
 *
 * These tests exercise the pure functions only. They never set the env var and
 * never run the integration suite.
 *
 * What a green run does NOT prove: that a live file added later is on the list.
 * A third integration file that starts `claude` joins LIVE_CLAUDE_TESTS by hand.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import * as path from 'path';
import { configDefaults } from 'vitest/config';
import integrationConfig, {
  isAffirmative,
  integrationExclude,
  LIVE_AMBIENT_TEST,
  LIVE_CLAUDE_TEST,
  LIVE_CLAUDE_TESTS,
} from '../vitest.integration.config.js';
import { ROOT } from './helpers.js';

/**
 * A glob reduced to what the integration `include` list uses: `**` crossing
 * directories and `*` inside one path segment. Anything else throws, so a richer
 * pattern cannot be read as a match it is not.
 */
function globToRegExp(glob: string): RegExp {
  if (/[{}()[\]!?]/.test(glob)) throw new Error(`unsupported glob syntax in include pattern: ${glob}`);
  const body = glob
    .split('**/')
    .map(segment => segment.replace(/[.+^$|\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('(?:.*/)?');
  return new RegExp(`^${body}$`);
}

/** True when the config's include list covers `file` and the opt-in leaves it out of the exclude list. */
function isCollected(file: string, optIn: string | undefined, include: readonly string[]): boolean {
  const included = include.some(pattern => globToRegExp(pattern).test(file));
  return included && !integrationExclude(optIn).includes(file);
}

const INCLUDE: readonly string[] = integrationConfig.test?.include ?? [];

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
  it('names both live-claude files, and both exist', () => {
    expect([...LIVE_CLAUDE_TESTS].sort()).toEqual([LIVE_AMBIENT_TEST, LIVE_CLAUDE_TEST].sort());
    for (const file of LIVE_CLAUDE_TESTS) {
      expect(existsSync(path.join(ROOT, file)), `${file} is on the live list but is not a file`).toBe(true);
    }
  });

  it('excludes both live-claude files for every non-affirmative value', () => {
    for (const value of ['0', 'false', 'no', 'off', '', undefined]) {
      for (const file of LIVE_CLAUDE_TESTS) {
        expect(
          integrationExclude(value),
          `${JSON.stringify(value)} must leave ${file} excluded`,
        ).toContain(file);
        expect(
          isCollected(file, value, INCLUDE),
          `${JSON.stringify(value)} must not collect ${file}`,
        ).toBe(false);
      }
    }
  });

  it('collects both live-claude files only for an explicit affirmative', () => {
    for (const value of ['1', 'true', 'yes']) {
      for (const file of LIVE_CLAUDE_TESTS) {
        expect(
          integrationExclude(value),
          `${JSON.stringify(value)} must opt ${file} back in`,
        ).not.toContain(file);
        expect(
          isCollected(file, value, INCLUDE),
          `${JSON.stringify(value)} must collect ${file}: the include list has to cover it`,
        ).toBe(true);
      }
    }
  });

  it('leaves the other integration files collected in both branches', () => {
    const others = ['tests/integration/helpers.test.ts', 'tests/integration/pack-install.test.ts'];
    for (const file of others) {
      expect(existsSync(path.join(ROOT, file)), `${file} is the probe file for this arm`).toBe(true);
      for (const value of ['1', '0', undefined]) {
        expect(isCollected(file, value, INCLUDE), `${JSON.stringify(value)} must collect ${file}`).toBe(true);
      }
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

describe('include-list matcher used by the collection arms', () => {
  const PATTERN = 'tests/integration/**/*.test.ts';

  it('matches a test file at any depth under tests/integration', () => {
    expect(globToRegExp(PATTERN).test('tests/integration/ambient-activation.test.ts')).toBe(true);
    expect(globToRegExp(PATTERN).test('tests/integration/deep/er/x.test.ts')).toBe(true);
  });

  it('does not match files outside the pattern', () => {
    expect(globToRegExp(PATTERN).test('tests/integration-config-gate.test.ts')).toBe(false);
    expect(globToRegExp(PATTERN).test('tests/integration/helpers.ts')).toBe(false);
    expect(globToRegExp(PATTERN).test('tests/other/x.test.ts')).toBe(false);
  });

  it('refuses glob syntax it cannot read', () => {
    expect(() => globToRegExp('tests/{a,b}/*.test.ts')).toThrow(/unsupported glob syntax/);
  });

  it('reads the real include list as at least one supported pattern', () => {
    expect(INCLUDE.length, 'the integration config declares no include pattern — the collection arms are vacuous')
      .toBeGreaterThan(0);
  });
});
