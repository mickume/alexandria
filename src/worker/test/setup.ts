// Applies the D1 migrations before each test file, empties every table before
// each test, installs the outbound router, and checks after each file that every
// API response the tests received is one the OpenAPI document declares.
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { findOperation, responseMismatch } from '../api/openapi';
import { setNow } from '../clock';
import { recordedResponses, recordFetchQueue } from './helpers';
import { installOutbound, resetOutbound } from './outbound';

let tables: string[] = [];
const fetchQueue = env.FETCH_QUEUE;

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
  // Fetch messages are recorded, never delivered on their own; tests deliver them.
  recordFetchQueue();
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  ]);
});

afterEach(() => {
  env.FETCH_QUEUE = fetchQueue;
  setNow(null);
  resetOutbound();
});

afterAll(() => {
  const mismatches = recordedResponses.flatMap(({ method, path, status, body }) => {
    const op = findOperation(method, path);
    const why = op && responseMismatch(op, status, body);
    return why ? [`${method} ${path}: ${why}`] : [];
  });
  expect(mismatches).toEqual([]);
});
