# worker/links/routes

## Variables

### BATCH\_LIMIT

> `const` **BATCH\_LIMIT**: `100` = `100`

The most URLs one batch may carry.

***

### linkRoutes

> `const` **linkRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The user's links, under /api/v1/links.
