// Applies the D1 migrations before each test file and installs the outbound router.
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeAll } from 'vitest';
import { setNow } from '../clock';
import { installOutbound, resetOutbound } from './outbound';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  installOutbound();
});

afterEach(() => {
  setNow(null);
  resetOutbound();
});
