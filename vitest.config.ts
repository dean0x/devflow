import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    // D-TEST-HOME-ISOLATION: a per-file temp HOME with DEVFLOW_DIR/CLAUDE_* unset, so no
    // test can aim its writes at the developer's real ~/.claude or ~/.devflow.
    setupFiles: ['tests/setup/isolate-env.ts'],
    globals: false,
    environment: 'node',
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '#cli': new URL('./src/cli/', import.meta.url).pathname,
      '#core': new URL('./src/core/', import.meta.url).pathname,
    },
  },
});
