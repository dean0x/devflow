import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/integration/**/*.test.ts'],
    // subagent-skill-preload spawns real `claude` sessions against the developer's
    // own ~/.claude with --dangerously-skip-permissions, and has historically made
    // a commit in this repo mid-run. It stays runnable by explicit path:
    //   npx vitest run --config vitest.integration.config.ts \
    //     tests/integration/subagent-skill-preload.test.ts
    exclude: ['tests/integration/subagent-skill-preload.test.ts'],
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
