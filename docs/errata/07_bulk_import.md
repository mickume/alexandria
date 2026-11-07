# Erratum 07: bulk import

Where the implementation of spec `07_bulk_import` differs from what the spec
says, and why.

1. **The dispatcher counts sends, not slots.** An import sends at most 20 of a
   user's links in any 60 seconds, counted from `import_links.dispatched_at`,
   all at once with no queue delay, as REQ-3.1's check reads it ("lines 41-45
   by t + 120 s"). It does not reserve 3-second slots in `throttle_next_at`
   the way `sendThrottled` does for 'enrich all'.
2. **Sharing the budget with 'enrich all' goes both ways, conservatively.** An
   import run subtracts the 'enrich all' slots that may fall within a minute of
   now, estimated from `throttle_next_at` as if the schedule had started a
   minute earlier, so an import starting while 'enrich all' runs may wait up
   to a minute longer than strictly needed. A dispatch sets
   `users.import_window_end` a minute ahead, and `scheduleThrottled` starts no
   'enrich all' job before it.
3. **The dispatcher runs at the upload and from a new Cron Trigger,**
   `* * * * *`, beside the hourly `0 * * * *` one; `scheduled` tells them apart
   by `controller.cron`. The dispatcher is in `imports/dispatch.ts`, not
   `imports/imports.ts`.
4. **A link already sent by another action is recognised by its row:** it has
   left `pending`, or has `refresh_requested_at`, `fetched_at` or failed fetch
   attempts. It is marked `skipped` in `import_links` and uses no budget. A
   deleted link leaves `import_links` by cascade. The fetch worker itself is
   unchanged.
5. **An import never sorts under a link used just before it.** Line 1 is last
   used at the import time and each later line one millisecond less, as the
   spec says, unless a link was used within that span: then the import's times
   start late enough that its last line is still above that link (the
   end-to-end run found an import of 397 lines sorting around a link opened
   241 ms earlier).
6. **A link added by another request between the plan and the insert counts
   as a duplicate.** The import plans its lines first (duplicates, invalid
   lines, room under the limit), then inserts with `ON CONFLICT DO NOTHING`
   and the limit guard; a URL that turns up meanwhile is reported as a
   duplicate.
7. **The website uploads the file as a multipart form** (the part `file`), so
   that the server checks the file's own type. The Import section is
   `pages/ImportSection.tsx`; the progress view is
   `components/ImportProgress.tsx` and assumes every added link is waiting
   until its first progress answer.
8. **`POST /api/v1/imports` answers the report without `progress`;**
   `GET /api/v1/imports/{id}` adds it. A `no_urls` refusal's message is "the
   file holds no URL: one URL per line is expected".
9. **The OpenAPI document gained request bodies that are not JSON** (`upload`)
   and responses with a non-JSON media type, for the upload and the report
   file.
