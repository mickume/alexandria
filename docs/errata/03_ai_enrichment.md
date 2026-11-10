# Erratum 03: AI enrichment

Where the implementation of spec `03_ai_enrichment` differs from what the
spec says, and why.

1. **OpenRouter is called through its HTTP API**
   (`POST {OPENROUTER_BASE_URL}/chat/completions`), the fallback the spec
   names, not `@openrouter/sdk`. With the SDK loaded in every test isolate,
   workerd's test runner exited unexpectedly across the full Worker suite;
   the SDK also validates replies strictly enough that a reply without
   `system_fingerprint` fails the whole call. Anthropic goes through
   `@anthropic-ai/sdk`, which sends the key as `Authorization: Bearer`.
2. **Links are read through a `link_views` view** (migration 0003) that adds
   the topic's name and the tags in order, so every read of a link carries
   them.
3. **The encryption key is the SHA-256 digest of `KEY_ENCRYPTION_KEY`**, used
   as an AES-256-GCM key.
4. **Throttled starts were claimed when they happened, and no longer are.**
   Slots stay 3 seconds apart as the spec says. Because queue delivery is not
   exact (two jobs once reached the provider 2,999 ms apart), the consumer
   used to record each throttled job's actual start
   (`users.throttle_last_start`) and send a job back when it came within 3
   seconds and a 250 ms margin of the previous start. That margin was wider
   than the slots' own spacing, so a job arriving on its slot was sent back
   at least once and a long "enrich all" re-sent its whole backlog round after
   round. The second gate was removed and migration 0020 dropped the column:
   the slots alone space the jobs, and two starts may come slightly closer
   than 3 seconds when delivery is late.
5. **An enrichment message carries `attempt` and `manual`**, which decide the
   single automatic retry.
6. **The provider timeout can be shortened for tests** (`setProviderTimeout`),
   as the clock can.
7. **PATH-1's end-to-end check pastes `https://news.example/enriched`**
   rather than `https://example.com/article`, which spec 01's sign-in path
   relies on staying unfetched.
8. **An enrichment keeps 1 to 5 tags, not 3 to 8.** A floor of 3 pushed the
   model to invent tags once the good fits were used, which left many tags
   on one or two links. A result is unusable only when it has no tags; the
   first 5 are kept.
9. **The request lists each topic and tag with its link count**
   (`machine-learning (42)`) and asks the model to prefer the more used ones,
   so that it can tell an established name from a one-off.
10. **Enrichment reuses near names, not only equal ones.** A proposed topic
    or tag with no equal name reuses one that matches with the hyphens dropped
    or with its last word made singular or plural (`nearKeys`), so `databases`
    lands on `database` and `webdev` on `web-dev`. The owner's own edits still
    match equal names only.
