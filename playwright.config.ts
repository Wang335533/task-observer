import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests/ui', timeout: 30000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:1420', browserName: 'chromium', channel: 'msedge', viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI,
    env: { OBSERVER_UI_TEST: '1' } },
  reporter: [['list']], outputDir: 'test-results' })
