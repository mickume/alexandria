# Arrange topics in a hierarchy of up to three levels

## Intent

Every link in Alexandria has one topic, and topics are a flat list. Enrichment is told to prefer the most used topics, so broad topics keep growing: one owner's "Software engineering" holds more than 200 links and no longer tells them apart. This change lets a topic have sub-topics, up to three levels deep. Enrichment files each link under the most specific topic that fits and grows the tree by itself. A one-off split breaks an oversized topic into sub-topics. The owner can browse the tree, rearrange it, and search a topic together with everything beneath it. Tags stay a flat list.

## Goals

- A topic has at most one parent topic. No topic is more than three levels deep: a top-level topic is level 1, and a topic under a level-2 topic is level 3.
- `GET /api/v1/topics` returns every topic with its `parent_id`, the number of links filed directly under it (`count`) and the number filed under it or any topic beneath it (`subtree_count`).
- Enrichment returns a topic path such as `Software engineering > Testing > Property-based testing`. The link is filed under the last topic in the path, and any topic in the path that does not exist yet is created. The request shows the provider no link counts for topics, and asks it for the most specific topic that fits.
- `topic:"software engineering"` finds every link filed under "Software engineering" or any topic beneath it.
- The owner can split a topic with at least 20 links in one action. The provider proposes 2 to 10 sub-topics and files each of those links under one of them or leaves it where it is. Everything is applied at once, without review.
- The Topics page shows the tree, with siblings in alphabetical order and each topic's `subtree_count`. Beside Rename and Merge it offers **Move under…**, and a **Split** action on topics with at least 20 links.
- A link's card shows its topic's own name. Hovering over it shows the full path, and the link's detail page shows the path as a breadcrumb where each part opens that topic's search.

## Non-goals

- A tag hierarchy or tag implications. Tags stay flat, and nothing about them changes: the enrichment request still lists tags with their link counts and asks for the more used ones.
- A link with more than one topic.
- Two topics with the same name under different parents. Names stay unique per owner, ignoring case.
- Reviewing or undoing a split, or reviewing what enrichment creates. A split's result is changed with Rename, Merge and Move, as anything else in the tree is.
- Enrichment moving, renaming or merging existing topics. It only creates new ones and files links.
- Re-enriching existing links in bulk. Existing links keep their topic until they are refreshed, edited, moved by a merge or a move, or re-filed by a split.
- Drag and drop on the Topics page.
- A filter that matches one topic without the topics beneath it.
- Changes to related links, Ask, hybrid search ranking or the MCP tools' parameters.

## Background

Topics were introduced by package 03 (`ai_enrichment`) and made browsable by package 06 (`search_and_browse`).

- **Storage.** Each link has one topic (`links.topic_id`). Topics are a flat per-owner list whose names are unique ignoring case (`migrations/0003_ai_enrichment.sql`). A topic whose last link loses it is deleted by a database trigger (`topics_drop_unused`, `migrations/0006_search_index.sql`). Renamed and merged-away names are kept as aliases (`topic_aliases`).
- **Enrichment.** `buildPrompt` in `src/worker/enrich/enrich.ts` lists up to 100 of the owner's topics (`PROMPT_TOPICS`) and 300 tags (`PROMPT_TAGS`), each with its link count, and says "Reuse an existing topic or tag when one fits, preferring the more used ones". That instruction makes the most used topic the likeliest answer for every new link, which is how one topic reached more than 200 links. `listVocabulary` in `src/worker/enrich/vocabulary.ts` picks the topics with the most links. `storeEnrichment` in `src/worker/enrich/queue.ts` resolves the returned name with `resolveTopic`, which reuses a topic whose name is equal or near (hyphens dropped, singular or plural), and maps aliases to their survivors. It keeps the topic when the owner has edited it (`edited_fields`).
- **The owner's edits.** `PATCH /api/v1/links/{id}` with `topic` sets a link's topic by name, 1 to 100 characters, creating the topic when it does not exist (`src/worker/enrich/edits.ts`). On the website, the topic field of a link's detail page (`src/web/pages/LinkDetail.tsx`) is edited this way.
- **Topics API.** `GET /api/v1/topics` lists topics that have a link, newest link first, paged. `PATCH /api/v1/topics/{id}` renames a topic and `POST /api/v1/topics/{id}/merge` merges it into another (`src/worker/search/vocabulary.ts`, `src/worker/search/routes.ts`, documented in `docs/api.md`).
- **Topics page.** `VocabularyList` (`src/web/components/VocabularyList.tsx`) loads every topic, sorts them by name, and shows each with its count, its search link, Rename, and Merge with a drop-down of the other topics. The Tags page uses the same component.
- **Search.** `topic:<name>` (`filterConditions` in `src/worker/search/query.ts`) matches links whose topic has that name. The full-text index (`link_search`) stores each link's topic name, so a word in a topic's name finds the link. The meaning index embeds a link's title, summary, topic, tags and note (`src/worker/meaning/indexing.ts`) and re-embeds a link whose topic is renamed.
- **Display.** `TopicChip` in `src/web/components/LinkCard.tsx` shows a link's topic name and opens its `topic:` search. The API returns a link's topic as one string, `topic`.
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

### Filing links by enrichment

- The enrichment request lists up to 100 of the owner's topics, each as its full path with ` > ` between the names, for example `Software engineering > Testing`. They are the 100 whose newest link was added most recently. The request gives no link count for any topic.
- The request asks for the topic as a path of one to three names from the most general to the most specific. It tells the provider to file the page under the most specific topic that fits, existing or new, and to put a new topic under the existing topic it belongs to.
- The returned path is resolved name by name, from the first. Each name is matched with today's rules: ignoring case, then aliases, then near names (hyphens dropped, singular or plural).
  - A name that matches an existing topic uses that topic where it already is in the tree, even when the path puts it under another parent. The next name in the path then belongs under that existing topic.
  - A name that matches nothing creates a new topic under the topic the name before it resolved to, or at the top level when it is the first name.
  - The link is filed under the topic the last name resolved to.
- A path of more than three names keeps the first two and the last. When the resolved place of a new topic would be at level 4 (because an earlier name matched an existing level-3 topic), the new topic is created under that topic's parent instead.
- A path with an empty name, or one longer than 100 characters, is an unusable result and is handled as an unusable result is today: the enrichment fails with its reason, and the link keeps what it had.
- A link whose topic the owner edited keeps it, as today.
- The tags part of the request is unchanged: up to 300 tags, each with its link count, and the instruction to reuse an existing tag when one fits, preferring the more used ones.

### Setting a link's topic by hand

- `PATCH /api/v1/links/{id}` with `topic` accepts a path with ` > ` between up to three names, as well as a single name. It is resolved as enrichment resolves a path, but without near names: a name is matched ignoring case and as an alias, and otherwise is created as typed.
  - A path of more than three names, or with an empty name, or a name longer than 100 characters, is refused with `400 {"error": "invalid_topic", "field": "topic", "message": "a topic or a path of up to three topics separated by >, each 1 to 100 characters"}`, and nothing changes.
- The detail page's topic field takes the same input.

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

### Search

- `topic:<name>` matches every link filed under the named topic or under any topic beneath it. A name that is an alias does not match, as today.
- A word search matches a word of any name in a link's `topic_path`, in the field where the topic name is matched today, with the same weight.
- The meaning index embeds the link's `topic_path` joined with ` > ` where it embeds the topic today.
- Renaming a topic re-indexes every link filed under it or any topic beneath it, for word search and meaning search.

### The Topics page and the link's topic

- The Topics page lists the tree: top-level topics in alphabetical order, each followed by its children in alphabetical order, indented, and theirs below them. Each row shows the topic's name, opening its `topic:` search, and its `subtree_count`.
- Each row offers Rename and Merge as today, and **Move under…**: a drop-down of "Top level" and every topic it can move under (not itself or a topic beneath it), in the page's order, with a button to confirm. A refusal is shown above the list, as a failed rename or merge is today.
- A row whose topic has at least 20 links filed directly under it also offers **Split**. While the split runs, the row shows "Splitting…" and its actions are disabled. On success the page reloads the tree. On failure the error's message is shown above the list.
- The Tags page is unchanged.
- A link's card shows its topic's own name as today. The chip's tooltip shows the full path, for example "Software engineering › Testing".
- A link's detail page shows the path as a breadcrumb, each name opening the `topic:` search of that topic.

### Changing existing data

- When the change is deployed, every existing topic becomes a top-level topic with its links unchanged.
- Every `>` in an existing topic name is replaced by `-`, and the former name is kept as an alias of the topic, so enrichment proposing it lands on the renamed topic. When the new name is already another topic's, ignoring case, the topic is merged into that one, as a merge does today.

### End-to-end flows

1. A new link is enriched. The fake provider returns the topic `Software engineering > Testing`, where "Software engineering" exists and "Testing" does not. The link's card shows "Testing"; its detail page shows the breadcrumb "Software engineering › Testing"; the Topics page lists "Testing" under "Software engineering"; and `topic:"software engineering"` finds the link.
2. The owner opens the Topics page, presses **Split** on a topic with 25 links, and the fake provider proposes three sub-topics. The page shows the three under the topic with their counts, and searching for one of them lists the links filed under it.
3. The owner moves a top-level topic under another with **Move under…**. Its children move with it, and a search for the new parent finds their links.

## Design Decisions

1. **One parent per topic, at most three levels.** The owner's decision. Three levels keep the enrichment request short and the Topics page readable.
2. **A link can be filed under a topic at any level.** The owner's decision: a page about software engineering in general belongs to "Software engineering", not to a made-up child.
3. **Enrichment grows the tree freely.** The owner's decision: it may create new topics at any level, including new top-level ones, without review.
4. **Names stay unique per owner, ignoring case.** The owner's decision: `topic:` filters and aliases stay unambiguous.
5. **The owner's tree wins over the provider's paths.** Decided in this run, and agreed by the owner: a name that matches an existing topic is used where it is, so enrichment never moves a topic the owner has placed.
6. **A path longer than three keeps the first two names and the last.** Agreed by the owner: the last name is the most specific and the one that matters.
7. **No link counts in the request.** Agreed by the owner: the counts and the "prefer the more used" instruction are what drew most links into one topic.
8. **Tags stay flat.** The owner's decision.
9. **An oversized topic is broken up by one split that sees all its links at once, applied without review.** The owner's decision: re-enriching links one by one would create inconsistent siblings, and the result can be changed afterwards with Rename, Merge and Move.
10. **Cards show the topic's own name, with the path in a tooltip and on the detail page.** The owner's decision.
11. **Rearranging the tree is a Move under… drop-down, not drag and drop.** The owner's decision, matching Rename and Merge.
12. **`topic:` always includes the topics beneath.** The owner's decision.
13. **` > ` separates the names of a path.** Decided in this run: no existing topic name is likely to hold it, unlike `/` ("CI/CD").
14. **The enrichment request shows the 100 topics with the newest links.** Decided in this run: without counts there is no "most used" ranking to show, and recent topics are the likeliest to fit new links.

15. **Only the topics part of the enrichment request changes.** The owner's decision: tags keep their link counts and the preference for the more used ones.
16. **A split runs only when the owner asks, waits for its answer, and takes at most 500 links.** Agreed by the owner: an automatic split would spend the owner's AI credit unasked, and waiting like Ask shows the result at once; 500 titles and summaries fit one request.
17. **The owner can type a path into a link's topic field.** Agreed by the owner: it files the link and creates a sub-topic in one edit. Near names are not matched, so the owner's spelling is kept, as for a single name today.
18. **Existing names with `>` are renamed with `-`, keeping the old name as an alias.** Agreed by the owner: `>` now separates path names.

## Dependencies

- `03_ai_enrichment` (active): the enrichment request, the resolving of topic names and the owner's edits change.
- `06_search_and_browse` (active): the `topic:` filter, the topics API, the Topics page, renaming and merging change.
- `10_meaning_index` (sealed): what is embedded for a link's topic changes.
- `09_export_and_account_deletion` (active): the export's topics gain `parent_id`.

## Glossary

- **topic**: the single category a link is filed under. It now has a place in the topic tree; package 06's sense ("the single automatically assigned category of a link") otherwise holds.
- **topic tree**: the owner's topics arranged by parent, at most three levels deep.
- **topic path**: the names from a link's top-level topic down to its own topic, written with ` > ` between them.
- **level**: a topic's depth in the tree: 1 for a top-level topic, 2 for its children, 3 for theirs.
- **filed directly under**: a link whose own topic is that topic, as opposed to one filed under a topic beneath it.
- **split**: one AI request that divides the links filed directly under a topic into new or existing sub-topics, applied at once.
