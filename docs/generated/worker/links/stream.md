# worker/links/stream

## Type Aliases

### StreamCursor

> **StreamCursor** = \{ `p`: `number`; `s`: `"p"`; \} \| \{ `i`: `string`; `l`: `string`; `s`: `"u"`; \}

Where a page of the stream ends: in the pinned section at a pin position, or
in the rest of the stream at a (last used, id) pair.

## Functions

### isStreamCursor()

> **isStreamCursor**(`value`): `value is StreamCursor`

Whether a decoded cursor payload has the shape of a stream cursor.

#### Parameters

##### value

`unknown`

#### Returns

`value is StreamCursor`

***

### listStream()

> **listStream**(`db`, `userId`, `limit`, `after`): `Promise`\<\{ `items`: [`LinkRow`](store.md#linkrow)[]; `next`: [`StreamCursor`](#streamcursor) \| `null`; \}\>

One page of the user's stream: the links that are not archived, the pinned
ones first by pin position, then the rest by last use, newest first, with
the id breaking ties. Returns the page and the cursor of the next one, if any.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### limit

`number`

##### after

[`StreamCursor`](#streamcursor) \| `null`

#### Returns

`Promise`\<\{ `items`: [`LinkRow`](store.md#linkrow)[]; `next`: [`StreamCursor`](#streamcursor) \| `null`; \}\>
