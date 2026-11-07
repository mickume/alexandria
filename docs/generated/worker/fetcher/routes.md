# worker/fetcher/routes

## Variables

### aboutRoutes

> `const` **aboutRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The public page the fetcher's User-Agent points site operators at.

***

### REFRESH\_INTERVAL\_MS

> `const` **REFRESH\_INTERVAL\_MS**: `number`

The least time between two refreshes of one link.

***

### snapshotRoutes

> `const` **snapshotRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The stored copies of a user's links, under /api/v1/links: Read and Snapshot.
