import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest config: unit tests co-located as *.test.ts next to modules (per handoff spec).
// `keytar` is aliased to an in-memory mock so tests run on any platform without
// touching the real OS credential store.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['src/renderer/**', 'jsdom'],
      ['src/preload/**', 'jsdom'],
    ],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/session-key/**',
        'src/device-key/**',
        'src/main/**',
        'src/preload/**',
        'src/shared/**',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
      '@preload': resolve(__dirname, 'src/preload'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      keytar: resolve(__dirname, 'src/__mocks__/keytar.ts'),
      'electron-store': resolve(__dirname, 'src/__mocks__/electron-store.ts'),
      electron: resolve(__dirname, 'src/__mocks__/electron.ts'),
    },
  },
});
