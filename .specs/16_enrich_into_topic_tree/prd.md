---
spec_id: "16"
spec_name: "enrich_into_topic_tree"
title: "File enriched links into the topic tree"
status: "sealed"
created_at: "2026-11-10T09:09:38Z"
intent_hash: "d2d0662212cc4156150aab3a046b25763bd0fa21ee181da3749719970d7fd2e0"
schema_version: 3
source: "docs/prd/04-arrange-topics-in-a-hierarchy.md"
---

# File enriched links into the topic tree

## Intent

Enrichment is told to prefer the most used topics, so broad topics keep growing: one owner's "Software engineering" holds more than 200 links and no longer tells them apart. Package 15 arranged topics in a tree of up to three levels. This package makes enrichment use it: the provider is shown the owner's tree as topic paths, without link counts, is asked for the most specific topic that fits, and answers with a path. The link is filed under the last topic of that path, and enrichment grows the tree by itself, creating the topics the path names that do not exist yet, without ever moving a topic the owner has placed. Tags are unchanged.

## Goals

- The enrichment request lists up to 100 of the owner's topics, each as its full path such as `Software engineering > Testing`, the 100 whose newest link was added most recently, with no link count for any topic.
- The request asks for the topic as a path of one to three names, from the most general to the most specific, and for the most specific topic that fits.
- The returned path is resolved name by name: a name that matches an existing topic uses it where it is, and a name that matches nothing creates a new topic under the one before it. The link is filed under the last topic in the path.
- No enrichment creates a topic whose name holds `>`.

## Non-goals

- **Splitting a topic** (`POST /api/v1/topics/{id}/split` and the Split action on the Topics page): package 17 (`split_a_topic`), written after this one.
- Enrichment moving, renaming or merging existing topics. It only creates new ones and files links.
- Re-enriching existing links in bulk. Existing links keep their topic until they are refreshed, edited, moved by a merge or a move, or re-filed by a split.
- Any change to tags: the request still lists up to 300 tags with their link counts and asks for the more used ones.
- Any change to the owner's own edits, the topics API, the Topics page or search: package 15 (`topic_tree`).

## Background

Topics were introduced by package 03 (`ai_enrichment`) and arranged in a tree by package 15 (`topic_tree`).

- **The request.** `buildPrompt` in `src/worker/enrich/enrich.ts` lists the owner's topics and tags, each as `name (count)`, and says "Reuse an existing topic or tag when one fits, preferring the more used ones". `listVocabulary` in `src/worker/enrich/vocabulary.ts` picks the 100 topics (`PROMPT_TOPICS`) and 300 tags (`PROMPT_TAGS`) with the most links. The structured result asked of the model is `RESULT_SCHEMA` in `src/worker/enrich/providers.ts`, whose `topic` is "The one topic the page belongs to.".
- **The result.** `normalizeResult` in `src/worker/enrich/enrich.ts` collapses the topic's spaces and returns null for an unusable result (no tags, an empty summary or topic). `processEnrichment` in `src/worker/enrich/queue.ts` then records the failure with the reason "the result was not usable" and retries a first automatic attempt once, 10 minutes later.
- **Storing it.** `storeEnrichment` in `src/worker/enrich/queue.ts` maps aliases with `applyAliases` (which compares the whole topic string), keeps a topic the owner edited (`edited_fields`), and resolves the topic with `resolveTopic(…, { near: true })`. Since package 15, `resolveTopic` is `resolveTopicPath` over a one-name path; `resolveTopicPath` (`src/worker/enrich/vocabulary.ts`) already resolves a path name by name, with names, aliases and, when asked, near names, applies the level-4 rule, and deletes the topics it created that end up empty. Because the topic is passed as one name, an answer such as `Programming > Rust` today becomes one topic of that literal name (issue #37).
- **Tests.** `src/worker/enrich/enrich.test.ts` covers the request ("lists the 300 most used tags in the request", "offers the provider only the current names"), the result ("reuses the vocabulary for $label", "a provider’s result", "a failed enrichment") and aliases ("stores the survivor for a tag or topic the provider names by an alias"). `src/worker/enrich/edits.test.ts` covers the owner's edits winning ("keeps the owner’s $field through $op, while the rest updates"). `e2e/topics.spec.ts` holds package 15's end-to-end flows; `e2e/fake-ai.ts` answers enrichments with a result a test sets, by marker.

## Requirements

### The topics in the request

- The enrichment request lists up to 100 of the owner's topics, each as its full path with ` > ` between the names, for example `Software engineering > Testing`. They are the 100 whose newest link, filed under them or under a topic beneath them, was added most recently. The request gives no link count for any topic.
- The request asks for the topic as a path of one to three names from the most general to the most specific, separated by ` > `. It tells the provider to file the page under the most specific topic that fits, existing or new, and to put a new topic under the existing topic it belongs to.
- The tags part of the request is unchanged: up to 300 tags, each with its link count, and the instruction to reuse an existing tag when one fits, preferring the more used ones.

### Filing the link under the returned path

- The returned path is split on `>` and resolved name by name, from the first. Each name is matched ignoring case, then as an alias, then as a near name (hyphens dropped, singular or plural).
  - A name that matches an existing topic uses that topic where it already is in the tree, even when the path puts it under another parent. The next name in the path then belongs under that existing topic.
  - A name that matches nothing creates a new topic under the topic the name before it resolved to, or at the top level when it is the first name.
  - The link is filed under the topic the last name resolved to.
- A path of more than three names keeps the first two and the last. When the resolved place of a new topic would be at level 4 (because an earlier name matched an existing level-3 topic), the new topic is created under that topic's parent instead.
- A path with an empty name, or a name longer than 100 characters, is an unusable result and is handled as an unusable result is today: the enrichment fails with its reason, and the link keeps what it had.
- A link whose topic the owner edited keeps it, as today.

### End-to-end flow

1. A new link is enriched. The fake provider returns the topic `Software engineering > Testing`, where "Software engineering" exists and "Testing" does not. The link's card shows "Testing"; its detail page shows the breadcrumb "Software engineering › Testing"; the Topics page lists "Testing" under "Software engineering"; and `topic:"software engineering"` finds the link.

## Design Decisions

1. **Enrichment grows the tree freely.** The owner's decision: it may create new topics at any level, including new top-level ones, without review.
2. **The owner's tree wins over the provider's paths.** Agreed by the owner: a name that matches an existing topic is used where it is, so enrichment never moves a topic the owner has placed.
3. **A path longer than three keeps the first two names and the last.** Agreed by the owner: the last name is the most specific and the one that matters.
4. **No link counts for topics in the request.** Agreed by the owner: the counts and the "prefer the more used" instruction are what drew most links into one topic.
5. **The request shows the 100 topics with the newest links.** Without counts there is no "most used" ranking to show, and recent topics are the likeliest to fit new links.
6. **Only the topics part of the request changes.** The owner's decision: tags keep their link counts and the preference for the more used ones.
7. **"Newest link" counts the links beneath a topic.** Decided in this run: a topic is ranked by the newest link filed under it or under a topic beneath it, as `GET /api/v1/topics` orders topics, so a parent whose links all sit in its children is still shown.
8. **Each listed topic goes on its own line.** Decided in this run: a path already uses ` > `, and topic names may hold commas, so the topics are listed one per line under "Existing topics:"; the tags keep their one-line list.
9. **The returned path is resolved by package 15's `resolveTopicPath`, with near names.** Decided in this run: one resolver for typed and enriched paths; enrichment adds near names, as it does for single names today, and the per-name alias match replaces `applyAliases`' whole-string match for topics.
10. **The path is split on every `>`, each name trimmed.** Decided in this run, as package 15 splits a typed path, so that `Programming>Rust` and `Programming > Rust` are the same path and no enriched topic name holds `>` (issue #37).

## Dependencies

- Package 03 (`ai_enrichment`, active): the request, the provider's structured result, normalising it and storing it change.
- Package 15 (`topic_tree`, active, all tasks done): the topic tree, `resolveTopicPath`, `topic_path`, the Topics page, the breadcrumb and the `topic:` filter this package files links into.

## Glossary

- **topic path**: the names from a topic at the top level down to a topic, written with ` > ` between them in the request and in the provider's answer.
- **level**: a topic's depth in the tree: 1 for a top-level topic, 2 for its children, 3 for theirs.
- **near name**: a name equal to another once hyphens are dropped and a final word is made singular or plural (`nearKeys` in `src/worker/enrich/enrich.ts`).
