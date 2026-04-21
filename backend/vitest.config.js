// Backend vitest config. Runs the admin-portal route + allowlist + csv
// tests. Agent A's Wave 3 TS conversion will replace this with a shared
// tsconfig-driven setup.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/__tests__/**/*.test.{js,mjs}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/admin/**/*.js'],
      exclude: ['src/admin/__tests__/**', 'src/admin/index.js'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
