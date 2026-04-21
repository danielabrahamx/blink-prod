import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/settlement/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/**/types.ts'],
    },
  },
  resolve: {
    alias: {
      '@settlement': new URL('./src/settlement', import.meta.url).pathname,
      '@db': new URL('./src/db', import.meta.url).pathname,
    },
  },
});
