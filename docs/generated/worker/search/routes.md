# worker/search/routes

## Variables

### RANKING\_KEPT\_MS

> `const` **RANKING\_KEPT\_MS**: `number`

How long a hybrid search's ranking is kept for its later pages, in milliseconds.

***

### searchRoutes

> `const` **searchRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

GET /api/v1/search.

***

### tagRoutes

> `const` **tagRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The tags, at /api/v1/tags.

***

### topicRoutes

> `const` **topicRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The topics, at /api/v1/topics.

## Functions

### sweepRankings()

> **sweepRankings**(`db`): `Promise`\<`void`\>

Removes the rankings kept longer than RANKING_KEPT_MS; the every-minute run calls it.

#### Parameters

##### db

`D1Database`

#### Returns

`Promise`\<`void`\>
