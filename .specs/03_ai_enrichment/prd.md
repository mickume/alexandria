---
spec_id: "03"
spec_name: "ai_enrichment"
title: "Summarise, tag and file every link with the owner's own AI key"
status: "active"
created_at: "2026-11-07T14:23:44Z"
intent_hash: "0e24f0ea07443a67520fe075702656ec450d3094fc399e8252343b1604e31aed"
schema_version: 3
source: "docs/prd/01-build-the-alexandria-link-library.md"
---

# Summarise, tag and file every link with the owner's own AI key

## Intent

A library of hundreds of links is only navigable if each one says what it is. This package has every fetched link summarised, tagged and given a topic by an AI provider, running only on the key the owner has entered themselves (Anthropic by default, or OpenRouter), with a vocabulary of tags and topics that converges instead of fragmenting, background work paced so that large batches never flood the provider, failures and rejected keys reported plainly, and the owner's own edits of title, summary, tags and topic always winning over anything automatic. Without a key, the library works fully and simply leaves links unenriched.

## Goals

- For a reachable page and a user with a verified key, the card shows title, summary, tags and topic without reload within 60 seconds of the link being added.
- Enrichment runs only with the user's own AI provider key, entered once in settings; without one, everything else works and links are simply not enriched.
- The stored key is encrypted at rest and never shown again beyond its last 4 characters, nor returned by any API response.
- Imports and "enrich all" never process more than 20 links per minute per user.
- A field the owner has edited is never overwritten by later enrichment or re-fetch.

## Non-goals

- Fetching, snapshots and the reader view: package 02 (`fetch_and_snapshot`), whose reader-view text this package reads.
- The Topics and Tags pages, renaming and merging topics and tags, and search over summary, tags and topic: package 06 (`search_and_browse`).
- Bulk import: package 07 (`bulk_import`), which schedules its fetches through this package's throttle. Export of tags, topics and summaries: package 09; the AI key is never exported.
- A shared or deployment-wide AI key, and Workers AI as a provider: rejected by the owner (source PRD decisions 5 and 9).
- Re-enriching existing links when the provider, model or key changes.
- Semantic / vector search.

## Background

Package 01 (`accounts_links_and_stream`) provides the users, links, the API conventions (error envelope, 409 limits, 429 rate limits, the OpenAPI document kept in step with the routes), the settings page, the stream card `LinkCard.tsx`, the link detail page and the test helpers. Package 02 (`fetch_and_snapshot`) fetches each link through `FETCH_QUEUE` and its consumer (the fetch worker), stores the reader-view text in `link_texts` (empty when extraction yields under 200 characters), the title and description on the link, notes such as "not a web page", "no text in this PDF" and "PDF too large to store (50 MB limit)", refreshes a link on request, and updates the stream in place by polling `GET /api/v1/links?changed_since=` while a card is pending or refreshing. Nothing yet produces a summary, tags or a topic.

Constraints the owner has set:

- Constraint: **bring your own key.** Enrichment is only ever run with an AI provider key the user has entered on the settings page. Each user chooses a provider, the **Anthropic Claude API** (default, through the official `@anthropic-ai/sdk`) or **OpenRouter** (through its API, so any model it hosts can be used), enters their API key, and optionally a model identifier (default `claude-opus-5-5` for Anthropic; for OpenRouter the user must name a model).
- Constraint: page text sent to the provider is the cleaned reader-view text, truncated to the first 20,000 characters, never the raw HTML, cookies or the user's identity. The provider is called with the user's key and nothing shared between users.
- Constraint: strict per-user separation of data and processing.

## Requirements

### AI provider and key

- On the settings page the user chooses the provider (Anthropic, the default, or OpenRouter), enters their API key and optionally a model identifier (default `claude-opus-5-5` for Anthropic; for OpenRouter a model is required). Saving the key runs a test request; a key the provider rejects is refused with the provider's message and not stored, and the page says "key verified" for one it accepts. The stored key is encrypted at rest, shown only as its last 4 characters afterwards, can be replaced or removed, and is never included in the export, the API or MCP responses. Changing provider, model or key does not re-enrich existing links.

### Enrichment

- Enrichment: from the cleaned text, an LLM produces a summary of at most 60 words, 3 to 8 tags (lower-case, single words or hyphenated phrases), and one topic. Tags and topic are drawn from the user's existing tags and topics where one fits and new ones are created where none does, so that vocabulary converges rather than fragments. These are stored on the link and shown in the stream.
- From a PDF, enrichment runs on its extracted text as for a page; a PDF with no extractable text, a link that is not a web page and a PDF too large to store are not enriched. When the reader view yields fewer than 200 characters, enrichment uses the page title and description only.
- Without a stored key, fetch and snapshot run as normal and every link skips enrichment; the stream shows such links with "not enriched: add an AI key in settings" once as a banner, not per link. When a key is added later, the user can trigger "enrich all unenriched links" from settings, which processes them at the background rate below.
- Background processing (imports and "enrich all") runs at no more than 20 links per minute per user (a 600-link batch completes in about 30 minutes).
- Failures: when enrichment fails (provider error, rate limit, model refusal, empty text), the link is `active` with its fetched title and description, no summary/tags/topic, and a "re-run enrichment" action; the enrichment is retried once after 10 minutes automatically. A key the provider starts rejecting (revoked, out of credit) is reported once on the settings page as "your AI key was rejected: <provider message>" and enrichment pauses until the key is replaced; links added meanwhile wait in the unenriched state.
- Re-fetch (refresh) re-runs enrichment as well as the fetch, and keeps manual edits.

### Manual edits

- Manual edits win: a user can edit title, summary, tags and topic on the link detail view. A field a user has edited is never overwritten by later automatic enrichment or re-fetch.

### End-to-end flows

1. The owner enters an Anthropic API key in settings and sees "key verified", pastes `https://example.com/article?utm_source=x`, sees it at the top as `example.com` / pending; within a minute the card shows the title, summary, tags and topic.
2. The owner, without a key, pastes a link; it is fetched but not enriched and the stream shows the banner once; the owner adds a key, chooses "enrich all unenriched links", and the card gains its summary, tags and topic.
3. The owner edits a link's tags and topic, then refreshes it; the summary is renewed but the edited tags and topic stay.

## Design Decisions

1. **Enrichment runs on the Anthropic Claude API by default, with OpenRouter as the alternative provider**, chosen per user in settings together with the model; default model `claude-opus-5-5`. Owner's decision (source PRD decision 5).
2. **Bring your own key.** Enrichment never runs on a shared or deployment-wide key. Owner's decision (source PRD decision 9).
3. **Background processing is throttled to 20 links per minute per user** for imports and "enrich all". Owner's decision (source PRD decision 15). The throttle spaces a user's jobs 3 seconds apart by giving each queue message a delivery delay; a slot more than 12 hours ahead (the queue's longest delay) is sent with that delay and deferred again on arrival. Mechanism decided in this run: it needs no long-running process and keeps users independent.
4. **Enrichment runs on its own queue** (`ENRICH_QUEUE`, consumed by the enrichment worker): the fetch worker sends a message when a fetch makes a link `active` with text to enrich and the user has a verified key. Adding a single link or a paste is not throttled; only imports and "enrich all" are. Decided in this run, from the source PRD's 60-second goal for a pasted link.
5. **The key is encrypted with AES-GCM** under the deployment secret `KEY_ENCRYPTION_KEY`, with a fresh IV per save and the user's id as additional authenticated data, so a ciphertext copied to another user's row does not decrypt. Decided in this run.
6. **The test request on save** is one minimal completion with the chosen model (a one-word answer); a provider that cannot be reached answers 502 `provider_unavailable` and nothing is stored. Decided in this run.
7. **A rejected key** is a provider answer of HTTP 401, 402 or 403 to an enrichment request. The key is marked `rejected` with the provider's message, the user's enrichment pauses, and the link (and every link reaching enrichment meanwhile) waits as `waiting_for_key`. Saving a key that verifies lifts the pause; waiting links are enriched by "enrich all unenriched links", as the source PRD says they wait. Decided in this run.
8. **The structured result.** The provider is asked for `{summary, tags, topic}` (Anthropic: a forced tool call; OpenRouter: a JSON-schema response format). Tags are lower-cased, spaces become hyphens, characters outside `a-z`, `0-9` and `-` are dropped, empties and repeats removed and the first 8 kept; the summary is cut to 60 words. A result with fewer than 3 tags, an empty summary or topic, or one that does not parse is an enrichment failure. Decided in this run: the source PRD fixes the bounds, not what to do when a model misses them.
9. **Converging vocabulary.** The request lists the user's topics (up to 100, most used first) and tags (up to 300, most used first); a returned name equal to an existing one ignoring case, with spaces read as hyphens, reuses it. Decided in this run, to bound the request size.
10. **Enrichment status** is one of `no_key`, `queued`, `enriched`, `failed`, `skipped` and `waiting_for_key`, shown on the link, so the owner always sees why a link has no summary. Decided in this run.
11. **Timeouts.** A provider call is abandoned after 60 seconds and counts as a failure. Decided in this run.
12. **Edit limits.** A title is 1 to 500 characters, a summary at most 2,000, at most 20 tags each normalised as above, a topic 1 to 100 characters. Editing a field records it as edited for good; there is no "revert to automatic" in this package. Decided in this run: the source PRD sets no limits.
13. **Test seam.** `ANTHROPIC_BASE_URL` and `OPENROUTER_BASE_URL` default to the providers' and are pointed at `e2e/fake-ai.ts` in the end-to-end tests. Decided in this run.

## Dependencies

- Package 01 `accounts_links_and_stream` (draft): users, links, the settings page, the card and detail page, the API conventions and the test helpers.
- Package 02 `fetch_and_snapshot` (draft): the fetch worker, the reader-view text in `link_texts`, the notes that mark a link as having nothing to enrich, refresh, and the stream's change feed. This package changes the fetch worker so that a fetch sends an enrichment message and never overwrites an edited title.
- External: the Anthropic Claude API and OpenRouter, each called with the user's own key; Cloudflare Queues.

## Verified External API

Read from the published packages on 2026-11-07:

- `@anthropic-ai/sdk` 1.6.0: `new Anthropic({ apiKey, baseURL, ... }: ClientOptions)`; `client.messages.create(params: MessageCreateParamsNonStreaming, options?: RequestOptions): APIPromise<Message>`.
- `@openrouter/sdk` 1.5.64: `new OpenRouter(options?: SDKOptions)`; `client.chat.send(request: SendChatCompletionRequestRequest, options?: RequestOptions): Promise<SendChatCompletionRequestResponse>`. If the SDK does not run on Workers, OpenRouter's HTTP API (`POST /api/v1/chat/completions`) is the fallback.
- `hono` 4.13.17 and `@cloudflare/vitest-pool-workers` 0.23.0 as in package 01.

## Glossary

- **enrichment**: the background step that produces summary, tags and topic.
- **topic**: the single automatically assigned category of a link; **tag**: one of several automatically or manually assigned labels.
- **AI key**: the user's own Anthropic or OpenRouter API key, stored for enrichment (bring your own key).
- **throttle**: the pacing of a user's background jobs, at most 20 per minute.
- **edited field**: a title, summary, tags or topic the owner has set by hand, which automatic work never overwrites.
