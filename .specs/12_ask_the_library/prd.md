---
spec_id: "12"
spec_name: "ask_the_library"
title: "Ask the library a question and get an answer from its links"
status: "active"
created_at: "2026-11-09T08:58:18Z"
intent_hash: "39e3632883d3815f80b74a272b6973c3753a2ebc1e27ac0463e178e3e9f4c944"
schema_version: 3
source: "docs/prd/02-find-links-by-meaning-and-ask-the-library.md"
---

# Ask the library a question and get an answer from its links

## Intent

An owner who has saved what they read should be able to ask that library a question and get an answer written from it, with every claim traced back to the links it came from, so that the library becomes something one can ask rather than a list one has to remember the words of. The answer is written by the owner's own AI provider with the owner's own key, from passages of the owner's own links only, and nothing about the question or the answer is kept.

## Goals

- The owner asks a question on the Ask page or with `POST /api/v1/ask` and receives an answer written by their own AI provider from passages of their own links, in which every cited number names a link listed with the answer.
- The answer streams as it is written; the sources are known before its first word.
- A question nothing in the library answers gets "Nothing in your library answers this." without the provider being called.
- Every failure that can be known before calling the provider is answered as the API's usual JSON error, and every failure after it ends the stream with a named error.
- Nothing about a question or an answer is stored.

## Non-goals

- The index, passages and `search_passages` (package `10_meaning_index`), and search by meaning (package `11_hybrid_search`). This package reads passages through package 10's `findPassages`.
- Multi-turn conversation, stored question or answer history, or follow-up questions that refer to earlier answers.
- An MCP tool that asks the library on the owner's key: agents get passages through `search_passages` instead (PRD 02, Design Decision 6).
- Paying for answers with anything but the owner's own key, or answering without one.
- Showing the passages themselves on the Ask page: the sources are listed by title and host, and each opens its link.

## Background

PRD 02 (`docs/prd/02-find-links-by-meaning-and-ask-the-library.md`) was split into three packages; this is the third. Package `10_meaning_index` (active, all tasks done) offers `findPassages(env, userId, words, filters, limit, {deadlineMs, perLink})` (`src/worker/meaning/passages.ts`): the passages of the user's links that best match free words by meaning, at most 3 of one link, scoring at least the similarity threshold, under the query filters, throwing `MeaningUnavailable` when Workers AI or Vectorize fails or takes over 5 seconds.

What exists today:

- **The owner's AI key and providers** (package `03_ai_enrichment`). `getAiSettings` and `decryptKey` (`src/worker/enrich/keys.ts`) read the owner's provider (`anthropic` or `openrouter`), model and encrypted key; `markKeyRejected` marks it `rejected` with the provider's message, which the settings page shows. `src/worker/enrich/providers.ts` calls Anthropic through `@anthropic-ai/sdk` 1.6.0 (`messages.create`, non-streaming) and OpenRouter's `POST {OPENROUTER_BASE_URL}/chat/completions` with `fetch`, with a 60-second timeout (`PROVIDER_TIMEOUT_MS`, `setProviderTimeout` for tests) and the outcomes `rejected` (401, 402, 403), `unavailable` (unreachable, 5xx, timeout) and `failed` (anything else, a rate limit included).
- **The query language** (package `06_search_and_browse`). `parseQuery` (`src/worker/search/query.ts`) splits free words from the prefix filters and refuses a query over 200 characters (`query_too_long`) and a refused filter value (`invalid_filter`).
- **The API.** Every route under `/api/v1/` sits behind authentication and the 600-requests-a-minute rate limit (`src/worker/api/ratelimit.ts`); errors use the envelope of `src/worker/api/errors.ts`; the OpenAPI document (`src/worker/api/openapi.ts`) declares every route and every response the tests receive. A link as the stream lists it is `toView` (`src/worker/links/store.ts`).
- **The website.** The header's tabs are Stream, Workspaces, Topics, Tags, Archive, Settings, then the Import button (`SECTIONS` in `src/web/App.tsx`); `api.ts` is the client; the tests render pages against `FakeApi` (`src/web/test/helpers.tsx`), which answers JSON only.
- **The test fakes of the providers.** `FakeAi` (`src/worker/test/ai.ts`) and `e2e/fake-ai.ts` answer key tests and enrichments, neither of them streaming.

Constraints:

- Constraint: answers run only with the owner's own AI key and model, as enrichment does.
- Constraint: the tests and the end-to-end tests run without a Cloudflare account and without a real provider: the fakes of packages 03 and 10 stand in.
- Constraint: strict per-user separation; the website reaches the library only through the API.

## Requirements

### Asking

- `POST /api/v1/ask` with `{"question": "<text>"}`. The question is written in the search query language: its free words are the question, and its prefix filters narrow the passages, as in `GET /api/v1/passages`. Alexandria retrieves the 8 best passages, as `GET /api/v1/passages` would (at most 3 of one link), sends them and the question to the owner's own AI provider with the owner's key and model, and streams the answer as `text/event-stream`:
  - first one `sources` event: `{"sources": [{"n": 1, "link": <the link as the stream lists it>}]}`, one entry per link the passages came from, numbered from 1 in the order of their best passage;
  - then `delta` events `{"text": "<next part of the answer>"}`, the answer citing sources as `[n]`;
  - finally one `done` event `{}`.
- The provider is instructed to answer from the passages only, to cite every statement with the number of its source, and to answer "Nothing in your library answers this." when the passages do not answer the question.
- When no passage reaches the similarity threshold, the answer is the `sources` event with an empty list, the single `delta` "Nothing in your library answers this." and `done`, and the provider is not called.
- Asking records no use on its sources; opening one does, as everywhere. An ask counts once against the owner's 600 requests a minute.
- No passage of another user's links is ever sent to the provider.

### Refusals before the stream

Each answered as JSON before any stream starts, the provider called in none of them:

- a body that is not a JSON object: `400 invalid_json`, as everywhere;
- a question that is missing, not a string, empty, blank or filters only: `400 {"error": "invalid_question", "field": "question", "message": "ask with at least one word"}`;
- a question over 500 characters: `400 {"error": "question_too_long", "field": "question", "message": "a question of at most 500 characters"}`;
- a filter value search refuses: `400 invalid_filter` with `field: "question"` and search's message;
- no AI key: `409 {"error": "no_ai_key", "message": "add an AI key in settings"}`;
- the key marked rejected: `409 {"error": "ai_key_rejected", "message": "<the provider's message>"}`;
- Workers AI or Vectorize unavailable: `503 {"error": "search_unavailable", "message": "search by meaning is unavailable, try again"}`.

### Failures in the stream

Each ends the stream with one `error` event `{"error", "message"}` and no `done`:

- the provider rejects the key (401, 402, 403): `ai_key_rejected` with the provider's message, and the key is marked rejected exactly as a rejected enrichment marks it;
- the provider is unreachable, answers 5xx or has not finished within 60 seconds: `provider_unavailable`;
- any other provider failure (a rate limit, a refusal, an unusable answer): `provider_failed` with the provider's message.

### Both providers

- Anthropic answers are streamed through `@anthropic-ai/sdk`; OpenRouter answers through its chat completions with `stream: true`.

### The Ask page

- A new **Ask** tab in the website's header, between Tags and Archive, opens the Ask page at `/ask`: one text box for a question (at most 500 characters) and an Ask button.
- The Ask page shows the answer as it streams in, each `[n]` a link to that source's detail page (`/links/{id}`), and the sources listed under the answer (title, host). Asking again replaces the answer. Nothing is stored: leaving the page loses the answer.
- A refusal shows its message on the page; a failure in the stream shows its message under whatever part of the answer arrived.

### End-to-end flows

1. The owner, with an Anthropic key in settings and an indexed article about Durable Object alarms, opens Ask and asks "how do I schedule background work on Cloudflare?"; the sources appear, the answer streams in citing [1], and clicking [1] opens the article's detail page.
2. The owner without an AI key asks a question; the page says "add an AI key in settings", and the provider is not called.
3. The provider rejects the owner's key while answering; the page shows the provider's message under the answer so far, and the settings page shows the key as rejected.

## Design Decisions

5. **Asking is in PRD 02**, as its own package after search by meaning. (PRD 02.)
6. **Agents get passages, not an ask tool.** (PRD 02.)
14. **8 passages per answer, passages of at most 1,500 characters, at most 3 per link.** (PRD 02.)
15. **Answers stream as server-sent events, with refusals as JSON before the stream.** (PRD 02.)
16. **Nothing about asking is stored.** (PRD 02.)
40. **The question is parsed by the query language with a cap of 500 characters**: `parseQuery` takes the cap as an option, its 200 staying the default for search and passages, so that a question may be longer than a search.
41. **Refusals are checked in this order: the body, the question, the key, then the passages.** A malformed question is refused before anything is read, and the provider is called only once every refusal has passed.
42. **The sources are the links of the passages, numbered by their best passage**, each passage sent to the provider headed by its source number, so that `[n]` in the answer and `n` in `sources` are the same link.
43. **The prompt**: a system instruction to answer from the passages only, to cite every statement with `[n]`, and to answer exactly "Nothing in your library answers this." when the passages do not answer the question; then the numbered passages and the question. The answer may be at most 1,024 tokens.
44. **Anthropic streams through `messages.stream`** of `@anthropic-ai/sdk`, its `content_block_delta` text deltas becoming `delta` events; **OpenRouter through `POST /chat/completions` with `stream: true`**, its `data:` lines' `choices[0].delta.content` becoming `delta` events until `data: [DONE]`. Both keep the 60-second limit of enrichment, for the whole answer.
45. **The website reads the stream with `fetch` and the response body's reader**, not `EventSource`, which cannot POST. The website test fake `FakeApi` gains a raw-text answer, so that a test can answer a stream.
46. **The provider fakes learn to stream**: `FakeAi` (Worker tests) and `e2e/fake-ai.ts` answer a streaming request with server-sent events of the provider's format, with an answer and a failure a test can set.

## Dependencies

- `.specs/03_ai_enrichment` (active, all tasks done): asking uses its AI key, its rejected-key handling and its providers.
- `.specs/06_search_and_browse` (active, all tasks done): the question is written in its query language.
- `.specs/10_meaning_index` (active, all tasks done): answers are written from its passages, read through `findPassages`.

## Verified External API

- `@anthropic-ai/sdk` 1.6.0 (installed, `resources/messages/messages.d.ts`): `messages.stream<Params extends MessageStreamParams>(body: Params, options?: RequestOptions): MessageStream`; `MessageStream` is an `AsyncIterable<MessageStreamEvent>` with `finalMessage()`; a `RawContentBlockDeltaEvent` is `{type: 'content_block_delta', index, delta}`, whose `TextDelta` is `{type: 'text_delta', text: string}`. `Anthropic.APIError` carries `status`, as `providers.ts` already reads it.
- **Unverified**: OpenRouter's streaming chat completions (`stream: true`; `data: {"choices": [{"delta": {"content": "..."}}]}` lines ending with `data: [DONE]`), which the repository has never called.

## Glossary

- **ask**: a question answered by the owner's own AI provider from passages of the owner's links, citing them.
- **source**: a link whose passage was sent with a question, numbered from 1 in the answer's `sources` event.
- **passage**: a contiguous piece of a link's indexed text, at most 1,500 characters (package 10).
