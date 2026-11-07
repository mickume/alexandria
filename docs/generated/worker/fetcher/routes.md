# worker/fetcher/routes

## Variables

### aboutRoutes

> `const` **aboutRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The public page the fetcher's User-Agent points site operators at.

***

### snapshotRoutes

> `const` **snapshotRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The stored copies of a user's links, under /api/v1/links: Read and Snapshot.
