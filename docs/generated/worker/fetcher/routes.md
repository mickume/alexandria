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

## Functions

### readerBody()

> **readerBody**(`env`, `link`): `Promise`\<[`ReaderResponse`](snapshots.md#readerresponse)\>

The reader view of a link with a stored snapshot, as GET /api/v1/links/{id}/reader serves it.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

[`LinkRow`](../links/store.md#linkrow)

#### Returns

`Promise`\<[`ReaderResponse`](snapshots.md#readerresponse)\>

***

### snapshotResponse()

> **snapshotResponse**(`env`, `link`, `download`): `Promise`\<`Response` \| `null`\>

The stored snapshot of a link as GET /api/v1/links/{id}/snapshot serves it:
the HTML sandboxed, or the PDF inline (or as an attachment); null when no
object is stored.

#### Parameters

##### env

[`Env`](../env.md#env)

##### link

[`LinkRow`](../links/store.md#linkrow)

##### download

`boolean`

#### Returns

`Promise`\<`Response` \| `null`\>
