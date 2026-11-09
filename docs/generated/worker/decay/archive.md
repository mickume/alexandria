# worker/decay/archive

## Variables

### expiredRoutes

> `const` **expiredRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The expired links, under /api/v1/expired.

***

### restoreRoutes

> `const` **restoreRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

Restoring one expired link, under /api/v1/links.
