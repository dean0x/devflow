import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    environment: 'node',
    restoreMocks: true,
    testTimeout: 60000,
    retry: 2,
  },
  resolve: {
    alias: {
      '#cli': new URL('./src/cli/', import.meta.url).pathname,
    },
  },
});
