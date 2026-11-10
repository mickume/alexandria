# Erratum 17: split an oversized topic into sub-topics

Where the implementation of spec `17_split_a_topic` differs from what the spec
says, and why.

1. **The provider names links by number and lists them under their sub-topics.**
   The spec sends the provider each link's id, title and summary, and has it
   return, for every link, its id with the name of its sub-topic, or an empty
   name to leave it (REQ-1.2, Design Decision 7). An answer of that shape costs
   some 30 to 40 output tokens per link (each id a UUID), about 15,000 to 20,000
   for 500 links: more than the split's answer limit (16,384 tokens) and far
   more than a model writes in the 60 seconds a split waits (issue #39). The
   request now numbers the links from 1 (`n`, beside the title and summary,
   with no id), and the answer gives each sub-topic with the numbers of its
   links: `{"subtopics": [{"name", "links": [<n>, …]}]}` (`SPLIT_SCHEMA` in
   `src/worker/enrich/providers.ts`), a few tokens per link. A link the answer
   leaves out stays under the topic, in place of the empty name.
2. **What makes an answer unusable follows from that shape.** Beside fewer than
   2 or more than 10 sub-topics and a name that is empty, over 100 characters
   or holds `>`, an answer is unusable when it names a link number that was not
   sent, or puts one link under two sub-topics (`usableSplit` in
   `src/worker/search/routes.ts`). A link "filed under a name that is not among
   the proposed sub-topics" can no longer occur. Sub-topics whose names differ
   only in case are taken as one.

The HTTP API is unchanged: the same request, refusals and answer
(`docs/api.md`).
