import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('migrations');

/** The variables every Worker test runs with; tests change them through env. */
export const testBindings = {
  ALLOWED_EMAILS: 'owner@example.test',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_AUTH_URL: 'https://google.test/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://google.test/token',
  PUBLIC_ORIGIN: 'https://alexandria.test',
  KEY_ENCRYPTION_KEY: 'test-key-encryption-key',
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            main: './src/worker/index.ts',
            // The Workers AI binding is always remote; the tests replace it with a fake.
            remoteBindings: false,
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: { ...testBindings, TEST_MIGRATIONS: migrations },
              assets: { directory: './src/worker/test/assets', binding: 'ASSETS' },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['src/worker/**/*.test.ts'],
          setupFiles: ['./src/worker/test/setup.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['src/web/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/web/test/setup.ts'],
        },
      },
    ],
    coverage: { provider: 'istanbul', include: ['src/**'], exclude: ['src/**/test/**'] },
  },
});
