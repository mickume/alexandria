# worker/enrich/routes

## Variables

### enrichLinkRoutes

> `const` **enrichLinkRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

Asking for enrichment of the user's links, under /api/v1/links.

***

### UNENRICHED\_STATES

> `const` **UNENRICHED\_STATES**: `string`[]

Enrichment states that count as waiting to be enriched.
