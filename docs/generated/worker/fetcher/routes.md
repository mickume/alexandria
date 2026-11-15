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

### SNAPSHOT\_INTERVAL\_MS

> `const` **SNAPSHOT\_INTERVAL\_MS**: `number`

The least time between two snapshots of one link the owner asks for.

***

### snapshotRoutes

> `const` **snapshotRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The stored copies of a user's links, under /api/v1/links: the snapshot and the text.

## Functions

### snapshotBody()

> **snapshotBody**(`env`, `link`, `base`): `Promise`\<[`SnapshotResponse`](snapshots.md#snapshotresponse) \| `null`\>

The stored snapshot of a link as GET /api/v1/links/{id}/snapshot serves it,
its image and file addresses under `base` (the link's own address, or the
export's); null when nothing is stored.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

[`LinkRow`](../links/store.md#linkrow)

##### base

`string`

#### Returns

`Promise`\<[`SnapshotResponse`](snapshots.md#snapshotresponse) \| `null`\>

***

### snapshotFileResponse()

> **snapshotFileResponse**(`env`, `link`, `download`): `Promise`\<`Response` \| `null`\>

A link's stored PDF snapshot, inline or as an attachment; null when none is stored.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

[`LinkRow`](../links/store.md#linkrow)

##### download

`boolean`

#### Returns

`Promise`\<`Response` \| `null`\>

***

### snapshotImageResponse()

> **snapshotImageResponse**(`env`, `link`, `name`): `Promise`\<`Response` \| `null`\>

One stored image of a link's snapshot; null when the snapshot holds no image of that name.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

[`LinkRow`](../links/store.md#linkrow)

##### name

`string`

#### Returns

`Promise`\<`Response` \| `null`\>

***

### textBody()

> **textBody**(`env`, `link`): `Promise`\<\{ `id`: `string`; `text`: `string`; \} \| `null`\>

A link's stored article text as GET /api/v1/links/{id}/text serves it; null when there is none.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

[`LinkRow`](../links/store.md#linkrow)

#### Returns

`Promise`\<\{ `id`: `string`; `text`: `string`; \} \| `null`\>
