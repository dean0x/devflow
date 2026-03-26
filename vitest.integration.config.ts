import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/integration/**/*.test.ts'],
    globals: false,
    environment: 'node',
    restoreMocks: true,
    testTimeout: 300000,
  },
  resolve: {
    alias: {
      '#cli': new URL('./src/cli/', import.meta.url).pathname,
    },
  },
});
