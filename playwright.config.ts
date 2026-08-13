import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 12_000 },
  reporter: isCi ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    // Next 16 rejects dev assets when a localhost server is opened through the
    // 127.0.0.1 alias. Keep the browser origin canonical while health checks
    // remain pinned to the loopback address.
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @gavel-xi/server dev',
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: !isCi,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '4000',
        CLIENT_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000',
      },
    },
    {
      command: 'pnpm --filter @gavel-xi/web dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !isCi,
      timeout: 120_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_SERVER_URL: 'http://127.0.0.1:4000',
        NEXT_PUBLIC_E2E: 'true',
      },
    },
  ],
});
