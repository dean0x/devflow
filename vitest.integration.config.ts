import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/integration/**/*.test.ts'],
    // subagent-skill-preload spawns real `claude` sessions against the developer's
    // own ~/.claude with --dangerously-skip-permissions, and has historically made
    // a commit in this repo mid-run, so it is out of the default sweep.
    //
    // The opt-in is an env var, not a command-line path: `exclude` is applied at
    // glob time and a CLI positional only filters the already-globbed set, so
    // naming the file on the command line cannot bring it back. Run it with
    //   DEVFLOW_INTEGRATION_ALL=1 npx vitest run --config vitest.integration.config.ts \
    //     tests/integration/subagent-skill-preload.test.ts
    exclude: process.env['DEVFLOW_INTEGRATION_ALL']
      ? []
      : ['tests/integration/subagent-skill-preload.test.ts'],
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
