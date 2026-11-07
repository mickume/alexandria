# Erratum 09: export and account deletion

Where the implementation of spec `09_export_and_account_deletion` differs from
what the spec says, and why.

1. **The export reads links 100 at a time** from `link_views` in id order and
   serialises each with `toFullView`, the function `GET /api/v1/links/{id}`
   uses, so no change to `links/routes.ts` was needed. A failure part-way calls
   `controller.error` on the response stream; workerd logs the aborted stream.
2. **`reader_url` is set when a snapshot is stored and the link is a PDF or
   has a non-empty reader view.** A page whose reader view came out empty has
   a `snapshot_url` and no `reader_url`; its export reader route answers
   `no_content`, where `GET /api/v1/links/{id}/reader` answers 200 with
   `empty: true`.
3. **The content functions were taken out of the link routes**:
   `readerBody` and `snapshotResponse` in `fetcher/routes.ts` serve both the
   link routes (which then record a use) and the export routes (which do not).
4. **The settings page's export and delete sections are their own
   components** (`ExportSection` in `Settings.tsx`, `pages/DeleteAccountSection.tsx`).
   The email to compare with comes from `GET /api/v1/me`.
5. **The session cookie is expired by replacing the `Set-Cookie` header** the
   authentication middleware set when it renewed the session, so the answer
   carries only the expired cookie.
6. **The deletion job's batch is counted as the rows a statement selects** (at
   most 1,000, by `RETURNING`); the search index rows the link triggers remove
   with each link, and cascades of foreign keys, are not counted.
7. **Tables kept by triggers are left to their triggers.** The job finds its
   tables from `sqlite_master` and `pragma_table_info`, and leaves out
   full-text tables and every table a trigger inserts into
   (`link_search_keys`, `workspace_search_keys`), whose rows go with the links
   and workspaces the triggers follow. The users row goes last, once no link
   of the account is left.
8. **One run deletes one batch from R2 and one from each table,** then queues
   the next run if any batch was full; the links of a run wait only for the
   rows that reference them, not for R2.
9. **The sweep runs the job directly** (and the job queues its next runs),
   rather than only sending a queue message.
10. **The guard is checked twice in the fetch and liveness consumers**: before
    calling the origin and again before writing, for a deletion requested
    while the request was out. The hourly decay evaluation and the liveness
    enqueue select only accounts not marked, in SQL.
11. **Both execution paths are in one end-to-end file,** `e2e/account.spec.ts`,
    the deletion first: the end-to-end specs share one library, and the
    export's "two links, one workspace" holds only in the fresh library the
    deletion leaves. The file sorts first, so every later spec runs in that
    fresh library; the export test gives its pages an AI answer of their own so
    that the later specs are undisturbed.
12. **A sign-in for an account being deleted is checked after the allow-list**,
    so an address that is not allowed still gets `error=private`.
