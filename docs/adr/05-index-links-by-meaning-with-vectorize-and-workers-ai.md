# 05. Index links by meaning with Vectorize and Workers AI

## Status

Accepted (2026-11-09).

## Context

Keyword search (FTS5 in D1) finds a link only when the query shares words with
it. Alexandria should also find links by what they mean, and the owner should
be able to ask the library questions, without sending the library anywhere the
owner has not chosen and without one user's library ever informing another's.
D1 cannot load a vector extension, so the vectors need somewhere else to live.

## Decision

Alexandria builds and deletes its own index, with two Cloudflare services bound
to the one Worker (ADR 01):

- **Vectorize** holds the vectors, in the index `alexandria-passages`: 1,024
  dimensions, cosine metric. `scripts/provision.sh` creates it.
- **Workers AI** computes the embeddings with `@cf/baai/bge-m3`, which is
  multilingual (links come in any language) and takes a whole passage. They run
  on the deployment's own account and are paid by it. This amends PRD 01's
  decision that every AI call runs on the owner's own key, for embeddings only:
  Anthropic offers no embeddings API, so the owner's key cannot cover them.
  Answers to questions stay on the owner's key.
- Cloudflare AI Search (the managed indexing service) was considered and
  rejected: it indexes an R2 bucket on a schedule, which holds raw HTML and not
  the stored reader text, summary and note; it separates users by path filters
  rather than by the authenticated user; and it deletes later than the account
  deletion promise.

How the index is kept:

- **Passages in D1.** A link is cut into passages of at most 1,500 characters
  (`meaning/cut.ts`): its title, summary, topic, tags and note first, then the
  first 50,000 characters of its reader text, each cut at the last paragraph
  break, else sentence end, else space, in the window before the limit, but
  never in the first third of it (so a break right after a heading does not
  leave a passage of a few characters). The passages are rows of
  `link_passages`, each with the id of its vector, `{link_id}:{version}:{n}`.
  They can be returned, filtered and deleted with the links.
- **A text version per link, kept by triggers.** `link_index_state.text_version`
  moves whenever the title, summary, topic, tags, note or reader text changes,
  including a rename of its topic or tags. A link is stale when no passage of it
  carries its current version, which is also true of a link never indexed, so
  the links stored before the index needed no migration.
- **Versioned vector ids.** A new version has new vector ids, so a vector made
  from older text matches no current passage and is never returned, whether or
  not it has been deleted from the index yet.
- **A queue and a worker.** Every write that can change the text queues the
  link on `alexandria-index` if it is stale; the index worker embeds, upserts
  into the owner's namespace and replaces the passages in one D1 batch whose
  every write depends on the link still existing, its account not being deleted
  and its version being the one the job read. When that no longer holds, the
  vectors the job stored are queued for deletion. A failing Workers AI or
  Vectorize hands the message back (5 retries); after the last, the link is left
  as it was and the backfill picks it up.
- **The backfill** runs in the every-minute Cron Trigger: for each user not
  marked for deletion, at most 60 stale links, most recently used first, none
  queued in the last 10 minutes. Users are independent. A library of 10,000
  links is queued in under 3 hours.
- **Deleting vectors.** Deleting a passage, however it is deleted (the owner,
  decay, re-indexing, account deletion), queues its vector id in
  `vector_deletions` through a trigger; the every-minute run drains the table,
  a thousand ids to a call and at most 20 calls a run. A failed call leaves the
  ids queued. The table has no foreign key, and the account deletion job leaves
  it alone because a trigger fills it, so the queue outlives the account.
- **Isolation twice.** Each user has a Vectorize namespace named by their id,
  and every query reads only that namespace. The index is only a guide to which
  passages to look at: a passage request reads every passage it returns from the
  user's own D1 rows, so the vector of another user's link, or of a deleted
  link, is never returned.
- **The similarity threshold is one constant, 0.5 (cosine), provisional.** A
  passage must reach it to be returned. It has not been tuned against a real
  library; it is the constant `SIMILARITY_THRESHOLD` in `meaning/backend.ts`,
  and changing it changes nothing else.
- **Fakes.** Neither service is reachable from the tests. The Worker tests
  install fake `AI` and `VECTORIZE` bindings (`src/worker/test/meaning.ts`)
  and the end-to-end tests set `MEANING_FAKE_URL`, which makes the backend speak
  HTTP to `e2e/fake-meaning.ts`. Both embed with the same deterministic
  word-group embedder (`src/worker/test/embedder.ts`), so what is near in
  meaning is the same in both. `wrangler dev --local` runs without remote
  bindings, because an `ai` binding is otherwise always remote and needs a
  Cloudflare login; the Vitest plugin runs with `remoteBindings: false`.

## Consequences

- The text of every link (title, summary, topic, tags, note and the first
  50,000 characters of its reader text) is sent to Workers AI on the
  deployment's account to be embedded, and its embedding is stored in Vectorize.
  It is text the deployment already stores, on the same account.
- Embedding and the index are billed to the deployment's account, not the
  owner's AI key. A library of 10,000 links is embedded once and again for each
  change of a link's text.
- A deploy needs the Vectorize index to exist: `scripts/provision.sh` creates it
  and the API token needs Account > Vectorize > Edit. A Preview build gets no
  binding and so no index.
- A passage request takes the 100 nearest vectors and then applies the filters
  in D1, so a question narrowed by a filter that few of the nearest passages
  satisfy returns fewer passages than exist. Accepted for a personal library.
- Vectors whose index job fails after storing them, and never succeeds, stay in
  the index unreferenced: they are never returned, and a later deletion of the
  link does not reach them. Rare, and small.
- Search by meaning and asking the library are built on this index and the
  passages route, in two further packages.
