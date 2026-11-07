# Erratum 05: decay and liveness

Where the implementation of spec `05_decay_and_liveness` differs from what
the spec says, and why.

1. **`link_views` carries the decay inputs.** Migration 0005 recreates the
   view with each link's use count, its distinct UTC use days and its user's
   `remove_days`, so `sticky`, `removal_at` and `decay_note` come with every
   link read.
2. **Archiving by decay is part of the first evaluation task.** REQ-2.3's
   check expects a non-sticky link to be archived after 400 days, so the
   evaluation archives from the start; removal, the hourly run and failure
   isolation follow.
3. **`GET /api/v1/archive` came with the archiving by decay**, because
   REQ-3.1's check reads it.
4. **Removal is set-based and transactional.** One user's evaluation
   (dormancy, archiving, removal and `last_decay_at`) is a single D1
   transaction whose statements carry their own conditions; the removed
   links' R2 objects are deleted after it commits, from the ids the
   `DELETE … RETURNING` gave.
5. **The fetch path's redirect loop is shared.** `requestFollowing` in
   `fetcher/fetch.ts` sends GET or HEAD with the blocked-address checks,
   `ORIGIN_PROXY_URL` and the host gate; `fetchPage` and `checkLink` both
   use it.
6. **The race and failure checks use `decayHooks.afterSelect`**, the test
   hook the spec names.
7. **wrangler 4 serves scheduled events at `/cdn-cgi/local/scheduled`**, not
   `/__scheduled` as the spec's pseudocode says; the end-to-end tests use it.
