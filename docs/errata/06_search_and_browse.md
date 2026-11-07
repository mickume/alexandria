# Erratum 06: search and browse

Where the implementation of spec `06_search_and_browse` differs from what
the spec says, and why.

1. **Index rows are found through key tables.** Links and workspaces have
   text ids, and an FTS5 update by an unindexed column scans the whole index,
   so `link_search_keys` and `workspace_search_keys` give each link and
   workspace the integer rowid of its index row. The link id is still kept
   in the row, unindexed, as the spec says.
2. **The owner term is `u` and the user's id without hyphens**, so that it is
   one token, and the `owner` column comes after the text columns, so that
   FTS5's automatic snippet column is never the owner's.
3. **A snippet is at most 32 FTS5 tokens** with no ellipsis, so the
   concatenated segments are a verbatim passage of the column.
4. **Ranked results page with a signed offset cursor;** a query of filters
   only pages with the stream's cursor, as the link list does.
5. **A free word without a letter or digit matches nothing:** the index keeps
   no such token, so a query of punctuation only answers 200 with no links.
   An empty `tag:`, `topic:`, `host:` or `in:` is a free word; an empty
   `state:` or `is:` is `invalid_filter`. Empty link-list parameters other
   than `state` and `is` are ignored.
6. **Tag writes keep kept tags.** Because a trigger deletes a tag whose last
   link loses it, edits and enrichment no longer empty a link's tags before
   setting them: `setTagsStatements` (`enrich/vocabulary.ts`) removes only
   the tags a link loses and upserts the rest.
7. **Alias mapping is split between `enrich/vocabulary.ts` and
   `enrich/enrich.ts`:** `listAliases` reads the aliases (it needs D1),
   `applyAliases` replaces them in the result, and `storeEnrichment` calls
   both. A current name wins over an alias of the same name, aliases apply to
   enrichment only (an owner typing a former name gets that name), and a
   survivor's aliases go with it when its last link loses it.
8. **Renames and merges mark the links that carry the item as changed**
   (`updated_at`), so the stream's change feed shows the new names.
9. **The Archive page's search is addressed as `/archive?q=`,** and the
   Search page loads further results with a 'More results' button rather
   than by scrolling.
10. **The Topics and Tags pages share `components/VocabularyList.tsx`** and
    show their items as a table of name, count and actions.
11. **Matching workspaces are capped at 50** per search.
12. **Tag names take ASCII letters and digits**, as enrichment's
    `normalizeTag` stores them.
13. **Enrichment keeps a result only with at least 3 tags** (package 03), so
    the end-to-end paths' fake provider answers three tags: `cloudflare`,
    `queues`, `messaging` and `kafka`, `streaming`, `logs` for PATH-1, and
    `js`, `frontend`, `react` for the new link of PATH-2, whose tags end as
    `javascript`, `frontend` and `react`. The fake provider answers by a
    marker in the request (`POST /__answer_when`).
14. **Two checks landed with the task that made them testable:** REQ-4.3's
    (filters follow pins, workspaces and the archive) with the filters in
    task 4, and REQ-5.3's search-request half with the Search page in task 7.
