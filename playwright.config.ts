import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8080',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['html', { outputFolder: 'tests/e2e/results' }]],
  webServer: {
    command: 'cd frontend && npm run dev',
    port: 8080,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
