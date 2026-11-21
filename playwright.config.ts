import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath =
  process.env.CHROME_EXECUTABLE_PATH ||
  (!existsSync(chromium.executablePath()) && existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5273',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    env: { PORT: '8887', WEB_PORT: '5273' },
    url: 'http://127.0.0.1:5273/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
