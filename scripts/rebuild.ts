/**
 * Rebuilds what Alexandria derives from every link of one library: the page,
 * its snapshot and reader text, its fetched metadata, its enrichment (summary,
 * topic, tags) and its passages for search by meaning. The links themselves
 * stay as they are: their uses and points, pins, workspaces, notes, archive
 * and the fields the owner edited by hand.
 *
 *   ALEXANDRIA_TOKEN=alx_… npm run rebuild -- [--dry-run] [--yes] [--per-minute N]
 *     [--reset-vocabulary]
 *
 * It works through the deployed Worker's API as the token's owner (see
 * docs/cli.md):
 *
 * 0. With --reset-vocabulary, first takes every topic and tag off the links,
 *    except those the owner set by hand, and forgets the former names of
 *    renamed and merged ones, in D1. Tags left without a link, and topics left
 *    with no link and no child topic, are deleted by the database's own
 *    triggers, so enrichment builds the topic tree and the tags again from
 *    nothing. It needs a verified AI key.
 * 1. Refreshes every link that is active, unreachable or archived, at most
 *    --per-minute (default 20) a minute. A successful refresh rewrites the
 *    reader text, which makes the link stale for the index, and enriches the
 *    link again, so the Worker rebuilds all three by itself. Expired links are
 *    not refreshed (a successful refresh would make them active again), nor
 *    pending ones (their first fetch is under way).
 * 2. Waits until every refresh has a fetch event in the link's history.
 * 3. Enriches again, from the text already stored, the expired links and those
 *    whose refresh failed (the page is gone or did not answer); with
 *    --reset-vocabulary, also those refreshed too recently to refresh again.
 * 4. Marks those same links stale for the index with one statement on the D1
 *    database (`wrangler d1 execute --remote`, which needs
 *    CLOUDFLARE_API_TOKEN), so that the every-minute backfill embeds them
 *    again, as migration 0013 did for every link.
 *
 * ALEXANDRIA_URL is the site's origin; without it, PUBLIC_ORIGIN from the
 * environment or the checkout's .env. CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID are taken from .env too when the environment lacks them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

interface Link {
  id: string;
  url: string;
  state: string;
  enrichment_status: string | null;
}

interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

interface LinkEvent {
  kind: string;
  at: string;
  outcome?: string;
}

const MINUTE = 60_000;
/** How often the refreshes still without an outcome are looked up again. */
const POLL_MS = 15_000;
/** How long after the last refresh to wait for the fetches to finish. */
const SETTLE_MS = 20 * MINUTE;
/** Link ids are interpolated into SQL, so they must look like ids. */
const ID = /^[A-Za-z0-9_-]+$/;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { values: flags } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'per-minute': { type: 'string', default: '20' },
    'reset-vocabulary': { type: 'boolean', default: false },
  },
});
const perMinute = Number(flags['per-minute']);
if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > 300) {
  fail('--per-minute must be a whole number from 1 to 300');
}

// The settings this script may take from .env; the rest of the file is the
// deployment's secrets, which it does not need.
const dotenvPath = join(root, '.env');
const dotenv = existsSync(dotenvPath) ? parseEnv(readFileSync(dotenvPath, 'utf8')) : {};
for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name] && dotenv[name]) process.env[name] = dotenv[name];
}
const origin = (process.env.ALEXANDRIA_URL || process.env.PUBLIC_ORIGIN || dotenv.PUBLIC_ORIGIN)
  ?.trim()
  .replace(/\/+$/, '');
const token = process.env.ALEXANDRIA_TOKEN?.trim();
if (!origin) fail('set ALEXANDRIA_URL to the site, such as https://alexandria.example.com');
if (!token) fail('set ALEXANDRIA_TOKEN to a personal access token (Settings on the site)');

function fail(message: string): never {
  console.error(`rebuild: ${message}`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One API request, with the server's time it was answered at. Waits out the
 * API's rate limit and retries a server error or a lost connection a few times.
 */
async function api(
  method: string,
  path: string,
): Promise<{ status: number; body: unknown; date: string }> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${origin}/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch (err) {
      if (attempt >= 5) fail(`${method} ${path}: ${(err as Error).message}`);
      await sleep(attempt * 5000);
      continue;
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 401) fail('the token was refused (401): is it current, and for this site?');
    const code = (body as { error?: string } | null)?.error;
    if (res.status === 429 && code === 'rate_limited') {
      await sleep(Number(res.headers.get('Retry-After') ?? 60) * 1000);
      continue;
    }
    if (res.status >= 500) {
      if (attempt >= 5) fail(`${method} ${path} answered ${res.status}`);
      await sleep(attempt * 5000);
      continue;
    }
    // The Date header is whole seconds, so it is never later than the answer.
    const date = new Date(res.headers.get('Date') ?? Date.now()).toISOString();
    return { status: res.status, body, date };
  }
}

/** Every link of the library, whatever its state. */
async function allLinks(): Promise<Link[]> {
  const links: Link[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const { status, body } = await api('GET', `/links?state=any&limit=100${query}`);
    if (status !== 200) fail(`listing the links answered ${status}`);
    const page = body as Page<Link>;
    links.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return links;
}

/** Runs `step` for each item, at most `perMinute` a minute, printing progress. */
async function paced<T>(label: string, items: T[], step: (item: T) => Promise<void>) {
  const gap = MINUTE / perMinute;
  for (const [i, item] of items.entries()) {
    const started = Date.now();
    await step(item);
    if ((i + 1) % 10 === 0 || i + 1 === items.length) {
      const left = Math.ceil(((items.length - i - 1) * gap) / MINUTE);
      console.log(`  ${label}: ${i + 1}/${items.length}${left ? `, about ${left} min left` : ''}`);
    }
    if (i + 1 < items.length) await sleep(Math.max(0, gap - (Date.now() - started)));
  }
}

/** The outcome of the first fetch at or after `since`, if there is one yet. */
async function fetchOutcome(id: string, since: string): Promise<'ok' | 'failed' | 'gone' | null> {
  const { status, body } = await api('GET', `/links/${id}/history?limit=20`);
  if (status === 404) return 'gone';
  const events = (body as Page<LinkEvent>).items.filter((e) => e.kind === 'fetch' && e.at >= since);
  const first = events.at(-1);
  if (!first) return null;
  return first.outcome === 'ok' ? 'ok' : 'failed';
}

/** Runs SQL on the deployed D1 database. */
function d1(sql: string) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'alexandria', '--remote', '--command', sql], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** The ids as SQL lists of at most 100, so that no statement grows too large. */
function idLists(ids: string[]): string[] {
  const lists: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    lists.push(
      ids
        .slice(i, i + 100)
        .map((id) => `'${id}'`)
        .join(', '),
    );
  }
  return lists;
}

/** Moves the text version of the links, as migration 0013 did for all of them. */
function markStale(ids: string[]) {
  for (const list of idLists(ids)) {
    d1(
      `INSERT INTO link_index_state (link_id, text_version) SELECT id, 1 FROM links WHERE id IN (${list}) ` +
        'ON CONFLICT (link_id) DO UPDATE SET text_version = text_version + 1;',
    );
  }
}

/**
 * Takes the topics and tags off the links, except those the owner set by hand
 * (`edited_fields`), and forgets the owner's aliases. The database's triggers
 * delete every tag left without a link and every topic left with no link and
 * no child topic, with each ancestor left the same way (migrations 0006 and
 * 0014), so a topic the owner set by hand keeps its whole path; they also keep
 * the keyword index and the text version in step.
 */
function resetVocabulary(ids: string[]) {
  const [first] = ids;
  if (!first) return;
  const owner = `(SELECT user_id FROM links WHERE id = '${first}')`;
  d1(
    `DELETE FROM topic_aliases WHERE user_id = ${owner}; ` +
      `DELETE FROM tag_aliases WHERE user_id = ${owner};`,
  );
  for (const list of idLists(ids)) {
    d1(
      `DELETE FROM link_tags WHERE link_id IN (${list}) AND NOT EXISTS (SELECT 1 FROM links l, ` +
        `json_each(l.edited_fields) e WHERE l.id = link_tags.link_id AND e.value = 'tags'); ` +
        `UPDATE links SET topic_id = NULL WHERE id IN (${list}) AND topic_id IS NOT NULL ` +
        `AND NOT EXISTS (SELECT 1 FROM json_each(links.edited_fields) WHERE value = 'topic');`,
    );
  }
}

const links = await allLinks();
const bad = links.find((l) => !ID.test(l.id));
if (bad) fail(`unexpected link id ${JSON.stringify(bad.id)}`);

const toRefresh = links.filter((l) => ['active', 'unreachable', 'archived'].includes(l.state));
const expired = links.filter((l) => l.state === 'expired');
const pending = links.filter((l) => l.state === 'pending');

console.log(`${origin}: ${links.length} links`);
console.log(`  refresh (fetch, enrich and index again): ${toRefresh.length}`);
console.log(`  expired (enrich and index again from the stored text): ${expired.length}`);
console.log(`  pending (left alone, their first fetch is under way): ${pending.length}`);
console.log(
  `At ${perMinute} a minute the refreshes take about ${Math.ceil(toRefresh.length / perMinute)} min.`,
);
const reset = flags['reset-vocabulary'];
if (reset) {
  console.log('Topics and tags are reset first and built again by enrichment.');
  // Without a working key every link would be left with no topic or tags.
  const { body } = await api('GET', '/settings/ai');
  const ai = body as { configured?: boolean; status?: string } | null;
  if (!ai?.configured || ai.status !== 'verified') {
    fail('--reset-vocabulary needs a verified AI key: add one in Settings first');
  }
}
if (flags['dry-run']) process.exit(0);
if (!process.env.CLOUDFLARE_API_TOKEN) {
  fail('set CLOUDFLARE_API_TOKEN (or put it in .env): step 4 runs a statement on the D1 database');
}
if (!flags.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Rebuild them? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

// 0. Reset the vocabulary.
if (reset) {
  console.log('0/4 Resetting topics and tags');
  resetVocabulary(links.map((l) => l.id));
}

// 1. Refresh.
console.log('1/4 Refreshing');
const requested = new Map<string, string>();
const recent: string[] = [];
await paced('refreshed', toRefresh, async (link) => {
  const { status, date } = await api('POST', `/links/${link.id}/refresh`);
  if (status === 202) requested.set(link.id, date);
  else if (status === 429) recent.push(link.id);
  else if (status !== 404) console.warn(`  ${link.url}: refresh answered ${status}`);
});
if (recent.length) {
  console.log(
    `  already refreshed in the last 10 minutes: ${recent.length}` +
      (reset ? ' (enriched again below)' : ', left as they are'),
  );
}

// 2. Wait for every fetch to finish.
console.log('2/4 Waiting for the fetches');
const failed: string[] = [];
const waiting = new Map(requested);
const deadline = Date.now() + SETTLE_MS;
let ok = 0;
while (waiting.size > 0 && Date.now() < deadline) {
  for (const [id, since] of waiting) {
    const outcome = await fetchOutcome(id, since);
    if (outcome) waiting.delete(id);
    if (outcome === 'ok') ok++;
    if (outcome === 'failed') failed.push(id);
  }
  console.log(`  fetched ${ok}, failed ${failed.length}, waiting ${waiting.size}`);
  if (waiting.size > 0) await sleep(POLL_MS);
}
// A fetch that never reported is treated as failed: enriching and indexing it
// again costs a little, missing it would leave it as it was.
failed.push(...waiting.keys());

// 3. Enrich the rest again from what is stored.
const byId = new Map(links.map((l) => [l.id, l]));
const rest = [...expired.map((l) => l.id), ...failed, ...(reset ? recent : [])];
const enrichable = rest.filter((id) => {
  const link = byId.get(id);
  return link && link.state !== 'unreachable' && link.enrichment_status !== 'skipped';
});
console.log(`3/4 Enriching ${enrichable.length} links from their stored text`);
let noKey = false;
await paced('enriched', enrichable, async (id) => {
  if (noKey) return;
  const { status, body } = await api('POST', `/links/${id}/enrich`);
  if ((body as { error?: string } | null)?.error === 'no_ai_key') {
    noKey = true;
    console.warn('  no verified AI key: add one in Settings; enrichment skipped');
  } else if (status !== 202 && status !== 404 && status !== 409) {
    console.warn(`  ${byId.get(id)?.url}: enrich answered ${status}`);
  }
});

// 4. Index the rest again.
console.log(`4/4 Marking ${rest.length} links for indexing again`);
if (rest.length) markStale(rest);

console.log(
  `Done: ${ok} refreshed, ${failed.length} could not be fetched and kept their page. ` +
    'Enrichment and the index catch up in the background (the index at 60 links a minute).',
);
if (reset) {
  console.log(
    'A link whose enrichment fails is left without a topic or tags; Settings offers to enrich those again.',
  );
}
