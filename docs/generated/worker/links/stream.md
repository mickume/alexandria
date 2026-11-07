# worker/links/stream

## Type Aliases

### StreamCursor

> **StreamCursor** = \{ `p`: `number`; `s`: `"p"`; \} \| \{ `i`: `string`; `l`: `string`; `s`: `"u"`; \}

Where a page of the stream ends: in the pinned section at a pin position, or
in the rest of the stream at a (last used, id) pair.

## Variables

### CHANGES\_LIMIT

> `const` **CHANGES\_LIMIT**: `500` = `500`

The most changed links one change-feed answer carries.

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

### listChanged()

> **listChanged**(`db`, `userId`, `since`): `Promise`\<[`LinkRow`](store.md#linkrow)[]\>

The user's links that are not archived and changed at or after `since`,
oldest change first. A link changed in the very millisecond of `since` may
come again; the website replaces cards in place, so a repeat is harmless,
while a missed change would leave a card pending.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### since

`Date`

#### Returns

`Promise`\<[`LinkRow`](store.md#linkrow)[]\>

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

***

### parseTimestamp()

> **parseTimestamp**(`value`): `Date` \| `null`

The instant an ISO 8601 timestamp names, or null when it is not one (or names no real date).

#### Parameters

##### value

`string`

#### Returns

`Date` \| `null`
