# worker/stats/routes

## Variables

### HISTORY\_MAX\_DAYS

> `const` **HISTORY\_MAX\_DAYS**: `365` = `365`

The most days GET /api/v1/stats/history answers, and how many without `days`.

***

### statsRoutes

> `const` **statsRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The statistics of the owner's library, under /api/v1/stats.
