import { defineConfig, configDefaults } from 'vitest/config';

/**
 * The one integration test that drives live `claude` sessions against the
 * developer's own ~/.claude with --dangerously-skip-permissions, and that has
 * previously made a commit in this repo mid-run (PF-055, PF-060). It is out of
 * the default sweep and only an explicit affirmative brings it back.
 */
export const LIVE_CLAUDE_TEST = 'tests/integration/subagent-skill-preload.test.ts';

/** The only spellings of DEVFLOW_INTEGRATION_ALL that opt in. */
const AFFIRMATIVE = new Set(['1', 'true', 'yes']);

/**
 * True only for an explicit affirmative. Bare truthiness would read
 * `DEVFLOW_INTEGRATION_ALL=0` — and `false`, `no`, `off` — as an opt-IN, since
 * every one of them is a non-empty string.
 */
export function isAffirmative(value: string | undefined): boolean {
  return AFFIRMATIVE.has((value ?? '').trim().toLowerCase());
}

/**
 * Setting `exclude` REPLACES vitest's own defaults rather than merging with
 * them, so both branches spread `configDefaults.exclude` back to keep the
 * built-in `**\/node_modules/**` and `**\/dist/**` guards.
 *
 * The opt-in is an env var, not a command-line path: `exclude` is applied at
 * glob time and a CLI positional only filters the already-globbed set, so
 * naming the file on the command line cannot bring it back. Run it with
 *   DEVFLOW_INTEGRATION_ALL=1 npx vitest run --config vitest.integration.config.ts \
 *     tests/integration/subagent-skill-preload.test.ts
 */
export function integrationExclude(optIn: string | undefined): string[] {
  return isAffirmative(optIn)
    ? [...configDefaults.exclude]
    : [...configDefaults.exclude, LIVE_CLAUDE_TEST];
}

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/integration/**/*.test.ts'],
    exclude: integrationExclude(process.env['DEVFLOW_INTEGRATION_ALL']),
    globals: false,
    environment: 'node',
    restoreMocks: true,
    testTimeout: 300000,
  },
  resolve: {
    alias: {
      '#cli': new URL('./src/cli/', import.meta.url).pathname,
      '#core': new URL('./src/core/', import.meta.url).pathname,
    },
  },
});
