# worker/links/stream

## Type Aliases

### StreamCursor

> **StreamCursor** = \{ `p`: `number`; `s`: `"p"`; `t`: `number`; \} \| \{ `i`: `string`; `l`: `string`; `n`: `number`; `s`: `"r"`; `t`: `number`; \} \| \{ `i`: `string`; `l`: `string`; `s`: `"a"`; `t`: `number`; \}

Where a page of the stream ends, with `t`, the time of the first page, so
that every later page orders the links by their points at that time: in the
pinned section at a pin position, in the ranked rest of the stream at a
(points, last used, id) triple, or among the archived links, which have no
points and come last, at a (last used, id) pair.

## Variables

### CHANGES\_LIMIT

> `const` **CHANGES\_LIMIT**: `500` = `500`

The most changed links one change-feed answer carries.

***

### IN\_STREAM

> `const` **IN\_STREAM**: [`Conditions`](../search/query.md#conditions)

The stream's own restriction: every link but the expired and the archived ones.

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

The user's links that are neither expired nor archived and changed at or after `since`,
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

> **listStream**(`db`, `userId`, `limit`, `after`, `where?`): `Promise`\<\{ `items`: [`LinkRow`](store.md#linkrow)[]; `next`: [`StreamCursor`](#streamcursor) \| `null`; \}\>

One page of the user's stream: the links that satisfy `where` (by default,
those neither expired nor archived), the pinned ones first by pin position,
then the rest by points descending, then last use descending, with the id
breaking ties, then the archived ones by last use and id descending.
Points are computed at the time of the first page, which the cursor
carries, so a link that does not change is listed exactly once however
long the paging takes. Returns the page and the cursor of the next one, if
any.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### limit

`number`

##### after

[`StreamCursor`](#streamcursor) \| `null`

##### where?

[`Conditions`](../search/query.md#conditions) = `IN_STREAM`

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
