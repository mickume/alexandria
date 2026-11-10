---
spec_id: "17"
spec_name: "split_a_topic"
title: "Split an oversized topic into sub-topics in one action"
status: "sealed"
created_at: "2026-11-10T09:51:33Z"
intent_hash: "e55d352b9c53a5bf0e2a0af6ed232a14345690dc745b1861bdb361d7e60ba0c7"
schema_version: 3
source: "docs/prd/04-arrange-topics-in-a-hierarchy.md"
---

# Split an oversized topic into sub-topics in one action

## Intent

Before the topic tree existed, enrichment preferred the most used topics, so a broad topic such as one owner's "Software engineering" grew past 200 links that no longer tell each other apart. Packages 15 and 16 arranged topics in a tree and made enrichment file new links into it, but the links already filed under a broad topic stay where they are. This package lets the owner break such a topic up in one action: the owner's AI provider sees every link filed directly under the topic at once, proposes sub-topics, and files each link under one of them or leaves it where it is. The result is applied at once, without review, and is changed afterwards with Rename, Merge and Move like anything else in the tree.

## Goals

- The owner can split a topic with at least 20 links filed directly under it in one action, from the API or the Topics page.
- The provider proposes 2 to 10 sub-topics and files each of those links under one of them or leaves it where it is. Everything is applied at once, without review, and the request answers with the result.
- A split happens only when the owner asks for one.

## Non-goals

- Reviewing or undoing a split. A split's result is changed with Rename, Merge and Move, as anything else in the tree is.
- Splitting a topic automatically, however many links it has.
- Splitting the links filed under a topic's children together with its own.
- Re-enriching existing links in bulk, or changing enrichment: package 16 (`enrich_into_topic_tree`).
- Any change to tags.

## Background

- **The tree.** Package 15 (`topic_tree`) gave topics a parent (`topics.parent_id`, at most three levels), `GET /api/v1/topics` with each topic's `count` (links filed directly under it) and `subtree_count`, `POST /api/v1/topics/{id}/move`, and the tree on the Topics page (`VocabularyList` in `src/web/components/VocabularyList.tsx`, with Rename, Merge and Move under… sharing `PickForm`). Its routes are `topicRoutes` in `src/worker/search/routes.ts`, its store functions `moveTopic`, `mergeEntry` and `getTopic` in `src/worker/search/vocabulary.ts`, and a move marks the moved links changed and queues them for meaning indexing (`queueIndexing`), while triggers keep the word index's topic paths current.
- **Resolving names.** `resolveTopicPath(db, userId, names, { near })` in `src/worker/enrich/vocabulary.ts` resolves a path of names: a name equal to a topic's name or alias, or with `near` a near name, is that topic wherever it is; any other name is created under the topic before it; topics it created that end up empty are deleted. Package 16 (`enrich_into_topic_tree`) resolves enrichment's paths with it, with near names.
- **The provider.** `src/worker/enrich/providers.ts` calls the owner's provider with their own key and model (`ProviderCall`): `enrichWith` asks for a structured result through a JSON schema (`RESULT_SCHEMA`) on Anthropic (structured outputs) and OpenRouter (`response_format`), within `PROVIDER_TIMEOUT_MS` (60 seconds), and sorts failures into `ProviderOutcome` kinds `rejected`, `unavailable` and `failed`. Keys are read with `getAiSettings` and `decryptKey`, and a key the provider rejects is marked with `markKeyRejected` (`src/worker/enrich/keys.ts`).
- **Ask's errors.** `POST /api/v1/ask` (`src/worker/meaning/ask.ts`, package 12 `ask_the_library`) answers `409 {"error": "no_ai_key", "message": "add an AI key in settings"}` without a key, `409 {"error": "ai_key_rejected", "message": <the provider's message>}` while the key is marked rejected, and reports a provider failure as `ai_key_rejected` (marking the key), `provider_unavailable` (unreachable, 5xx, or no answer within 60 seconds) or `provider_failed`.
- **Tests.** Worker tests answer the providers with `FakeAi` (`src/worker/test/ai.ts`), which tells an enrichment from a key test by the structured-output field of the request; the end-to-end tests use `e2e/fake-ai.ts` the same way, scripted through `fakeAi` in `e2e/helpers.ts`. Topic tests live in `src/worker/search/vocabulary.test.ts` and `src/web/pages/Topics.test.tsx`; the topic tree's end-to-end flows in `e2e/topics.spec.ts`.

## Requirements

### Splitting a topic

- `POST /api/v1/topics/{id}/split` asks the owner's AI provider to divide the links filed directly under the topic into sub-topics. A split happens only when the owner asks for one: no topic is split automatically, however many links it has.
- The request waits for the provider's answer and applies it before it answers. The provider has 60 seconds to answer, as for Ask.
- The provider is sent each such link's title and summary, and the names of the topic's existing children. It returns 2 to 10 sub-topic names and, for each link, the name it belongs under, or none to leave it under the topic.
- The result is applied at once: each sub-topic name is resolved as an enrichment name is (an existing child or any existing topic is reused where it is; otherwise a new child of the topic is created), and each link is filed under its sub-topic. Links whose topic the owner edited are not sent and not moved.
- It answers `200 {"topic": {…}, "children": [{"id", "name", "count"}], "moved": <n>}`.
- Failures, each leaving every link and topic as it was:
  - fewer than 20 links filed directly under the topic: `409 {"error": "too_few_links", "message": "a topic needs at least 20 links to be split"}`;
  - more than 500 links filed directly under the topic: `409 {"error": "too_many_links", "message": "a topic with more than 500 links cannot be split at once"}`;
  - the topic is at level 3: `409 {"error": "too_deep", "message": "topics are at most three levels deep"}`;
  - no verified AI key: `409 {"error": "no_ai_key", "message": "add an AI key in settings"}`, as Ask answers today;
  - the provider's errors as Ask reports them: `ai_key_rejected` (the key is marked rejected), `provider_unavailable` (unreachable, 5xx, or no answer within 60 seconds), `provider_failed`;
  - an answer that is not usable (fewer than 2 or more than 10 sub-topics, a name that is empty or longer than 100 characters, or a link id that was not sent): `502 {"error": "provider_failed", "message": "the provider's split could not be used"}`;
  - a topic that is not the owner's: `404 {"error": "not_found"}`.

### The Split action on the Topics page

- A row whose topic has at least 20 links filed directly under it also offers **Split**. While the split runs, the row shows "Splitting…" and its actions are disabled. On success the page reloads the tree. On failure the error's message is shown above the list.

### End-to-end flow

1. The owner opens the Topics page, presses **Split** on a topic with 25 links, and the fake provider proposes three sub-topics. The page shows the three under the topic with their counts, and searching for one of them lists the links filed under it.

## Design Decisions

1. **An oversized topic is broken up by one split that sees all its links at once, applied without review.** The owner's decision: re-enriching links one by one would create inconsistent siblings, and the result can be changed afterwards with Rename, Merge and Move.
2. **A split runs only when the owner asks, waits for its answer, and takes at most 500 links.** Agreed by the owner: an automatic split would spend the owner's AI credit unasked, and waiting like Ask shows the result at once; 500 titles and summaries fit one request.
3. **The 20 and 500 limits count every link filed directly under the topic.** Decided in this run, from the PRD's wording; links whose topic the owner edited count toward them but are neither sent nor moved.
4. **The refusals are checked in this order: not the owner's (404), level 3, fewer than 20, more than 500, no key, a key marked rejected.** Decided in this run, so that the cheapest checks come first and no provider is called for a split that cannot happen.
5. **A key already marked rejected is refused as Ask refuses it.** Decided in this run: `409 {"error": "ai_key_rejected", "message": <the provider's message>}` without calling the provider, as `POST /api/v1/ask` answers.
6. **The provider's failures take Ask's codes with HTTP statuses of their own.** Decided in this run, since Ask reports them inside its event stream: a rejected key is `409 ai_key_rejected` with the provider's message (and the key is marked rejected), `provider_unavailable` is `503` and `provider_failed` is `502`, each with the provider outcome's message.
7. **"None" is an empty sub-topic name.** Decided in this run: each link of the answer carries the name of its sub-topic, or `""` to stay under the topic, which keeps the structured result's schema free of nullable fields.
8. **An answer is also unusable when a link names a sub-topic that is not among the proposed names, or a name holds `>`.** Decided in this run: the first cannot be applied as proposed, and `>` separates the names of a topic path.
9. **A sub-topic name is resolved as the last name of the topic's own path, with near names.** Decided in this run: `resolveTopicPath` over the topic's path followed by the name reuses an existing child or any existing topic where it is and otherwise creates a child of the topic, exactly as the PRD's rule and package 16's enrichment.
10. **Only the sub-topics that receive a link are created.** Decided in this run: a proposed name no link is filed under would be an empty topic, which the tree deletes anyway.
11. **The moved links are marked changed and re-indexed.** Decided in this run, as a move does in package 15: their topic path changes, so the stream's change feed returns them and word and meaning search follow.
12. **`children` lists every child of the topic after the split, by name; `moved` counts the links whose topic changed; `topic` is the topic as a move answers it.** Decided in this run: `{"id", "name", "parent_id", "count", "subtree_count"}`, so that the caller sees the whole new level.

## Dependencies

- Package 03 (`ai_enrichment`, active): the owner's AI provider, key and model, and the structured-result call this package adds a second schema to.
- Package 12 (`ask_the_library`, sealed): the key checks and provider error codes the split answers with.
- Package 15 (`topic_tree`, active, all tasks done): the topic tree, the topics routes, the Topics page and its row actions.
- Package 16 (`enrich_into_topic_tree`, active, all tasks done): resolving a name with near names as enrichment does.

## Glossary

- **split**: one AI request that divides the links filed directly under a topic into new or existing sub-topics, applied at once.
- **filed directly under**: a link whose own topic is that topic, as opposed to one filed under a topic beneath it.
- **level**: a topic's depth in the tree: 1 for a top-level topic, 2 for its children, 3 for theirs.
