---
spec_id: "15"
spec_name: "topic_tree"
title: "Arrange topics in a tree of up to three levels"
status: "active"
created_at: "2026-11-10T07:42:01Z"
intent_hash: "38ccb0f93d90bbfbc4705569513dc05ce6879646bd42837ce59fff540f5e7deb"
schema_version: 3
source: "docs/prd/04-arrange-topics-in-a-hierarchy.md"
---

# Arrange topics in a tree of up to three levels

## Intent

Every link in Alexandria has one topic, and topics are a flat list, so a broad topic that holds hundreds of links no longer tells them apart. This package lets a topic have sub-topics, up to three levels deep: the owner can file a link under a topic at any level, browse the tree, rearrange it with Move, Rename and Merge, and search a topic together with everything beneath it. It is the foundation the next two packages build on, where enrichment files links into the tree and a split breaks up an oversized topic. Tags stay a flat list.

## Goals

- A topic has at most one parent topic. No topic is more than three levels deep: a top-level topic is level 1, and a topic under a level-2 topic is level 3.
- `GET /api/v1/topics` returns every topic with its `parent_id`, the number of links filed directly under it (`count`) and the number filed under it or any topic beneath it (`subtree_count`).
- Every link the API returns carries its `topic_path`, and the owner can set a link's topic by typing a path such as `Software engineering > Testing`.
- `topic:"software engineering"` finds every link filed under "Software engineering" or any topic beneath it.
- The Topics page shows the tree, with siblings in alphabetical order and each topic's `subtree_count`. Beside Rename and Merge it offers **Move under…**.
- A link's card shows its topic's own name. Hovering over it shows the full path, and the link's detail page shows the path as a breadcrumb where each part opens that topic's search.

## Non-goals

- **Filing links by enrichment** (the request without link counts, listing topics as paths, resolving a returned path with near names): package 16 (`enrich_into_topic_tree`), written after this one. Until then enrichment works as today and files a link under a single name, which becomes a top-level topic when it is new.
- **Splitting a topic** (`POST /api/v1/topics/{id}/split` and the Split action on the Topics page): package 17 (`split_a_topic`), written after package 16.
- A tag hierarchy or tag implications. Tags stay flat and nothing about them changes.
- A link with more than one topic.
- Two topics with the same name under different parents. Names stay unique per owner, ignoring case.
- Drag and drop on the Topics page.
- A filter that matches one topic without the topics beneath it.
- Changes to related links, Ask, hybrid search ranking or the MCP tools' parameters.

## Background

Topics were introduced by package 03 (`ai_enrichment`) and made browsable by package 06 (`search_and_browse`).

- **Storage.** Each link has one topic (`links.topic_id`). Topics are a flat per-owner list whose names are unique ignoring case (`topics`, `migrations/0003_ai_enrichment.sql`). A topic whose last link loses it is deleted by the triggers `topics_drop_unused` and `topics_drop_unused_with_link` (`migrations/0006_search_index.sql`). Renamed and merged-away names are kept as aliases (`topic_aliases`). The latest migration is `0013_reindex_passage_kinds.sql`.
- **Reading a link.** `link_views` (last redefined in `migrations/0012_points_and_expiry.sql`) joins a link's topic name as `topic`. `toView` in `src/worker/links/store.ts` builds every link the API returns, with `topic` as one string.
- **The owner's edits.** `PATCH /api/v1/links/{id}` with `topic` sets a link's topic by name, 1 to 100 characters, creating the topic when it does not exist (`parseEdit` and `applyEdit` in `src/worker/enrich/edits.ts`, resolving through `resolveTopic` in `src/worker/enrich/vocabulary.ts`, which matches ignoring case and, only when asked, near names). On the website, the topic field of a link's detail page (`EditableField` in `src/web/pages/LinkDetail.tsx`) is edited this way.
- **Topics API.** `GET /api/v1/topics` lists topics that have a link, newest link first, paged (`listVocabularyItems`). `PATCH /api/v1/topics/{id}` renames a topic and `POST /api/v1/topics/{id}/merge` merges it into another (`renameEntry`, `mergeEntry` in `src/worker/search/vocabulary.ts`; routes in `src/worker/search/routes.ts`; documented in `src/worker/api/openapi.ts`, against which every response in the Worker tests is checked, and in `docs/api.md`).
- **Topics page.** `VocabularyList` (`src/web/components/VocabularyList.tsx`) loads every topic, sorts them by name, and shows each with its count, its search link, Rename, and Merge with a drop-down of the other topics by name. The Tags page uses the same component.
- **Search.** `topic:<name>` (`filterConditions` in `src/worker/search/query.ts`) matches links whose topic has that name. The full-text index (`link_search`, kept by triggers in `migrations/0006_search_index.sql`) stores each link's topic name in its `topic` column, so a word in a topic's name finds the link. The meaning index embeds a link's title, summary, topic, tags and note (`cutPassages` in `src/worker/meaning/cut.ts`, called by `indexLink` in `src/worker/meaning/indexing.ts`); a link's text version (`link_index_state`, `migrations/0011_meaning_index.sql`) moves when its topic or its topic's name changes, and `queueIndexing` queues the stale ones.
- **Display.** `TopicChip` in `src/web/components/LinkCard.tsx` shows a link's topic name and opens its `topic:` search.
- **Export.** `GET /api/v1/export` includes every topic with its link count (`src/worker/account/export.ts`).

## Requirements

### The topic tree

- Every topic has a parent topic or none. A topic with none is a top-level topic (level 1). Its children are level 2, and theirs are level 3. No topic is at level 4 or below.
- A link can be filed under a topic at any level, including one that has children.
- Topic names stay unique per owner, ignoring case, whatever their place in the tree.
- A topic is deleted when it has no links filed under it and no children. When that deletion leaves its parent with no links and no children, the parent is deleted too, and so on up the tree. A topic that has no links but has children is kept and listed.
- `GET /api/v1/topics` returns every topic of the owner, whether or not links are filed directly under it, each as `{"id", "name", "parent_id", "count", "subtree_count", "newest_added_at"}`.
  - `parent_id` is null for a top-level topic.
  - `count` is the number of links filed directly under the topic, in any state.
  - `subtree_count` is the number of links filed under it or under any topic beneath it.
  - `newest_added_at` is the added date of the newest of those links.
  - Paging (`limit`, `cursor`) and the order (newest link first) are unchanged.
- Topic names may no longer contain `>`. A rename to a name holding `>` is refused with `400 {"error": "invalid_name", "field": "name", "message": "a topic name of 1 to 100 characters, without >"}`, and nothing changes.
- Every link the API returns carries `topic_path`: the names from its top-level topic down to its own topic, for example `["Software engineering", "Testing"]`, or `[]` when it has no topic. `topic` stays the name of its own topic.
- The export's `topics` gives each topic's `parent_id` next to its `id`, `name` and `link_count`.

### Moving, renaming and merging topics

- `POST /api/v1/topics/{id}/move` with `{"parent": "<topic id>"}` makes the topic a child of that topic. With `{"parent": null}` it becomes a top-level topic. Its children and their children move with it. It answers `200 {"id", "name", "parent_id", "count", "subtree_count"}`.
  - When the move would put the topic or any topic beneath it at level 4 or below, it is refused with `409 {"error": "too_deep", "message": "topics are at most three levels deep"}`, and nothing changes.
  - When the new parent is the topic itself or a topic beneath it, it is refused with `409 {"error": "invalid_move", "message": "a topic cannot move under itself"}`, and nothing changes.
  - A missing or malformed `parent` key is refused with `400 {"error": "invalid_move", "field": "parent", "message"}`.
  - A topic or parent that is not one of the owner's answers `404 {"error": "not_found"}`.
  - Moving a topic under its current parent answers 200 and changes nothing.
- Renaming a topic is unchanged, and it keeps its place in the tree.
- Merging a topic into another (`POST /api/v1/topics/{id}/merge`) also makes the source's children children of the survivor, before the source is deleted.
  - When that would put any topic at level 4 or below, the merge is refused with `409 {"error": "too_deep", "message": "topics are at most three levels deep"}`, and nothing changes.
  - When the survivor is beneath the source, the merge is refused with `409 {"error": "invalid_merge", "message": "a topic cannot merge into a topic beneath it"}`, and nothing changes.
- A move or merge marks every affected link as changed, so the stream's change feed returns it, and every link whose `topic_path` changed is re-indexed for word search and meaning search.

### Setting a link's topic by hand

- `PATCH /api/v1/links/{id}` with `topic` accepts a path with ` > ` between up to three names, as well as a single name. It is resolved name by name, from the first: a name is matched ignoring case and as an alias, without near names.
  - A name that matches an existing topic uses that topic where it already is in the tree, even when the path puts it under another parent. The next name in the path then belongs under that existing topic.
  - A name that matches nothing is created as typed, under the topic the name before it resolved to, or at the top level when it is the first name.
  - When the resolved place of a new topic would be at level 4 (because an earlier name matched an existing level-3 topic), the new topic is created under that topic's parent instead.
  - The link is filed under the topic the last name resolved to.
  - A path of more than three names, or with an empty name, or a name longer than 100 characters, is refused with `400 {"error": "invalid_topic", "field": "topic", "message": "a topic or a path of up to three topics separated by >, each 1 to 100 characters"}`, and nothing changes.
- The detail page's topic field takes the same input.

### Search

- `topic:<name>` matches every link filed under the named topic or under any topic beneath it. A name that is an alias does not match, as today.
- A word search matches a word of any name in a link's `topic_path`, in the field where the topic name is matched today, with the same weight.
- The meaning index embeds the link's `topic_path` joined with ` > ` where it embeds the topic today.
- Renaming a topic re-indexes every link filed under it or any topic beneath it, for word search and meaning search.

### The Topics page and the link's topic

- The Topics page lists the tree: top-level topics in alphabetical order, each followed by its children in alphabetical order, indented, and theirs below them. Each row shows the topic's name, opening its `topic:` search, and its `subtree_count`.
- Each row offers Rename and Merge as today, and **Move under…**: a drop-down of "Top level" and every topic it can move under (not itself or a topic beneath it), in the page's order, with a button to confirm. A refusal is shown above the list, as a failed rename or merge is today.
- The Tags page is unchanged.
- A link's card shows its topic's own name as today. The chip's tooltip shows the full path, for example "Software engineering › Testing".
- A link's detail page shows the path as a breadcrumb, each name opening the `topic:` search of that topic.

### Changing existing data

- When the change is deployed, every existing topic becomes a top-level topic with its links unchanged.
- Every `>` in an existing topic name is replaced by `-`, and the former name is kept as an alias of the topic. When the new name is already another topic's, ignoring case, the topic is merged into that one, as a merge does today.

### End-to-end flows

1. The owner moves a top-level topic under another with **Move under…** on the Topics page. Its children move with it, the page shows them indented under the new parent with the parent's `subtree_count` grown by their links, and a search for the new parent finds their links.
2. The owner types `Software engineering > Testing` into a link's topic field on its detail page, where "Software engineering" exists and "Testing" does not. The detail page shows the breadcrumb "Software engineering › Testing"; the link's card shows "Testing"; the Topics page lists "Testing" under "Software engineering"; and `topic:"software engineering"` finds the link.

## Design Decisions

1. **One parent per topic, at most three levels.** The owner's decision. Three levels keep the enrichment request short and the Topics page readable.
2. **A link can be filed under a topic at any level.** The owner's decision: a page about software engineering in general belongs to "Software engineering", not to a made-up child.
3. **Names stay unique per owner, ignoring case.** The owner's decision: `topic:` filters and aliases stay unambiguous.
4. **The owner's tree wins over a typed path.** Agreed by the owner: a name that matches an existing topic is used where it is, so typing a path never moves a topic the owner has placed.
5. **Cards show the topic's own name, with the path in a tooltip and on the detail page.** The owner's decision.
6. **Rearranging the tree is a Move under… drop-down, not drag and drop.** The owner's decision, matching Rename and Merge.
7. **`topic:` always includes the topics beneath.** The owner's decision.
8. **` > ` separates the names of a path.** No existing topic name is likely to hold it, unlike `/` ("CI/CD").
9. **The owner can type a path into a link's topic field.** Agreed by the owner: it files the link and creates a sub-topic in one edit. Near names are not matched, so the owner's spelling is kept, as for a single name today.
10. **Existing names with `>` are renamed with `-`, keeping the old name as an alias.** Agreed by the owner: `>` now separates path names.
11. **PRD 04 is written as three packages.** Decided in this run, with the owner: this one (the tree, its API, rearranging, typed paths, search and display), then `enrich_into_topic_tree`, then `split_a_topic`. The one PRD exceeded a package's size.
12. **One path resolver, shared with enrichment.** Decided in this run: the typed path is resolved by a function in `src/worker/enrich/vocabulary.ts` that takes the near-name option `resolveTopic` already takes, so that package 16 resolves enrichment's paths with the same rules plus near names.
13. **The Merge drop-down keeps listing the other topics by name, flat.** Decided in this run: the PRD keeps Merge "as today"; only the new Move under… drop-down follows the page's tree order.
14. **The detail page's topic field opens on the link's path.** Decided in this run: the field is pre-filled with `topic_path` joined with ` > `, so that saving it unchanged keeps the link where it is, and editing the last name files it under a sibling.
15. **A typed path with a name that becomes level 4 is filed one level up.** Decided in this run, from the PRD's rule that a typed path is resolved as enrichment resolves one: the new topic is created under the parent of the existing level-3 topic.

## Dependencies

- Package 03 (`ai_enrichment`, active): the owner's edits of a link's topic and the resolving of topic names change.
- Package 06 (`search_and_browse`, active): the `topic:` filter, the word index's topic column, the topics API, the Topics page, renaming and merging change.
- Package 09 (`export_and_account_deletion`, active): the export's topics gain `parent_id`.
- Package 10 (`meaning_index`, sealed): what is embedded for a link's topic changes, and a link is re-indexed when its path changes.

## Glossary

- **topic**: the single category a link is filed under. It now has a place in the topic tree; package 06's sense ("the single automatically assigned category of a link") otherwise holds.
- **topic tree**: the owner's topics arranged by parent, at most three levels deep.
- **topic path**: the names from a link's top-level topic down to its own topic, written with ` > ` between them in input and in the meaning index, and with ` › ` on the website.
- **level**: a topic's depth in the tree: 1 for a top-level topic, 2 for its children, 3 for theirs.
- **filed directly under**: a link whose own topic is that topic, as opposed to one filed under a topic beneath it.
- **subtree**: a topic together with every topic beneath it.
