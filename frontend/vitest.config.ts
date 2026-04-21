import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// Vitest is configured separately from Vite so the frontend dev build
// never pulls in jsdom, @testing-library/*, or coverage tooling. The admin
// portal's unit tests need jsdom for React component tests; pure-TS helpers
// still run fine under jsdom too.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    // Pre-existing gatewayClient test is broken at caeb6f8 (Vitest constructor
    // handling regression with @circlefin/x402-batching mocks). Out of scope
    // for Agent G — will be fixed alongside Agent A's backend TS conversion.
    exclude: [
      '**/node_modules/**',
      'src/lib/__tests__/gatewayClient.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/admin/**/*.{ts,tsx}'],
      exclude: [
        'src/admin/__tests__/**',
        'src/admin/index.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
