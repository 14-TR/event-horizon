import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/event-horizon/',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: process.env.EH_PREVIEW ? 'npm run preview -- --port 4173 --strictPort' : 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/event-horizon/',
    reuseExistingServer: !process.env.CI,
  },
});
