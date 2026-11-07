// Applies the D1 migrations before each test file, empties every table before
// each test, installs the outbound router, and checks after each file that every
// API response the tests received is one the OpenAPI document declares.
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { findOperation, responseMismatch } from '../api/openapi';
import { setNow } from '../clock';
import {
  recordedResponses,
  recordEnrichQueue,
  recordFetchQueue,
  recordAccountQueue,
  recordLivenessQueue,
  savedKeys,
} from './helpers';
import { installOutbound, resetOutbound } from './outbound';

let tables: string[] = [];
const fetchQueue = env.FETCH_QUEUE;
const enrichQueue = env.ENRICH_QUEUE;
const livenessQueue = env.LIVENESS_QUEUE;
const accountQueue = env.ACCOUNT_QUEUE;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const rows = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
       -- A full-text index's shadow tables are emptied with the index itself.
       AND sql NOT LIKE 'CREATE TABLE ''%'`,
  ).all<{ name: string }>();
  tables = rows.results.map((r) => r.name);
  installOutbound();
});

beforeEach(async () => {
  // Queue messages are recorded, never delivered on their own; tests deliver them.
  recordFetchQueue();
  recordEnrichQueue();
  recordLivenessQueue();
  recordAccountQueue();
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  ]);
});

afterEach(() => {
  env.FETCH_QUEUE = fetchQueue;
  env.ENRICH_QUEUE = enrichQueue;
  env.LIVENESS_QUEUE = livenessQueue;
  env.ACCOUNT_QUEUE = accountQueue;
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

afterAll(() => {
  // No answer of the API may carry an AI key, beyond its last 4 characters.
  const leaks = recordedResponses.flatMap(({ method, path, body, headers }) => {
    const text = `${JSON.stringify(body)}\n${headers}`;
    return [...savedKeys].filter((key) => text.includes(key)).map(() => `${method} ${path}`);
  });
  expect(leaks).toEqual([]);
});
