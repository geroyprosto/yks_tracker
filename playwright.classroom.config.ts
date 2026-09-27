import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const baseURL = 'http://127.0.0.1:3200';
export default defineConfig({
  testDir: './tests/classroom-e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: 'tmp/playwright-classroom-results',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1440, height: 1000 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul',
    serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200', url: baseURL,
    reuseExistingServer: false, timeout: 120_000,
    env: {
      CLASSROOM_DEMO_ENABLED: 'true', YKSIM_E2E: '1', CLASSROOM_DEMO_TEST_RUN: randomUUID(), APP_ORIGIN: baseURL,
      NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
      ALLOWED_USER_EMAIL: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_TOKEN_ENCRYPTION_KEY: '',
      OPENAI_API_KEY: '', PDF_VISION_MODEL: '', RESEND_API_KEY: '', CLASSROOM_EMAIL_FROM: '',
    },
  },
});
