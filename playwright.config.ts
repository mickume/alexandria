import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;
const FAKE_GOOGLE_PORT = 8790;
const FAKE_ORIGIN_PORT = 8791;
const FAKE_AI_PORT = 8792;

/**
 * The end-to-end tests run against a production build served by wrangler dev
 * with local D1, and a local fake of Google's OAuth endpoints.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `node e2e/fake-google.ts ${FAKE_GOOGLE_PORT}`,
      url: `http://localhost:${FAKE_GOOGLE_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `node e2e/fake-ai.ts ${FAKE_AI_PORT}`,
      url: `http://localhost:${FAKE_AI_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `node e2e/fake-origin.ts ${FAKE_ORIGIN_PORT}`,
      url: `http://localhost:${FAKE_ORIGIN_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: [
        'rm -rf .wrangler/e2e',
        'npx vite build',
        'npx wrangler d1 migrations apply alexandria --local --persist-to .wrangler/e2e -c dist/alexandria/wrangler.json',
        `npx wrangler dev -c dist/alexandria/wrangler.json --port ${PORT} --persist-to .wrangler/e2e` +
          ` --var ALLOWED_EMAILS:owner@example.test` +
          ` --var GOOGLE_CLIENT_ID:e2e-client` +
          ` --var GOOGLE_CLIENT_SECRET:e2e-secret` +
          ` --var GOOGLE_AUTH_URL:http://localhost:${FAKE_GOOGLE_PORT}/auth` +
          ` --var GOOGLE_TOKEN_URL:http://localhost:${FAKE_GOOGLE_PORT}/token` +
          ` --var PUBLIC_ORIGIN:http://localhost:${PORT}` +
          ` --var ORIGIN_PROXY_URL:http://localhost:${FAKE_ORIGIN_PORT}/` +
          ` --var KEY_ENCRYPTION_KEY:e2e-key-encryption-key` +
          ` --var ANTHROPIC_BASE_URL:http://localhost:${FAKE_AI_PORT}` +
          ` --var OPENROUTER_BASE_URL:http://localhost:${FAKE_AI_PORT}/openrouter`,
      ].join(' && '),
      url: `http://localhost:${PORT}/signin`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
