// Applies the D1 migrations before each test file, empties every table before
// each test, and installs the outbound router.
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import { setNow } from '../clock';
import { installOutbound, resetOutbound } from './outbound';

let tables: string[] = [];

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const rows = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
  ).all<{ name: string }>();
  tables = rows.results.map((r) => r.name);
  installOutbound();
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  ]);
});

afterEach(() => {
  setNow(null);
  resetOutbound();
});
