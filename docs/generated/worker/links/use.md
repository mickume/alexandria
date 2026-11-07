# worker/links/use

## Interfaces

### HistoryCursor

Where a page of a link's history ends: the last event's time, source and id.

#### Properties

##### at

> **at**: `string`

##### id

> **id**: `number`

##### s

> **s**: `number`

0 for a use, 1 for a fetch event: the two tables number their rows apart.

## Type Aliases

### LinkEvent

> **LinkEvent** = \{ `at`: `string`; `kind`: `"use"`; \} \| \{ `at`: `string`; `http_status`: `number` \| `null`; `kind`: `"fetch"`; `outcome`: `"ok"` \| `"failed"`; `reason`: `string` \| `null`; \}

One event in a link's history: a use, or a fetch attempt with its outcome.

## Functions

### isHistoryCursor()

> **isHistoryCursor**(`value`): `value is HistoryCursor`

Whether a decoded cursor payload has the shape of a history cursor.

#### Parameters

##### value

`unknown`

#### Returns

`value is HistoryCursor`

***

### listHistory()

> **listHistory**(`db`, `linkId`, `limit`, `after`): `Promise`\<\{ `items`: [`LinkEvent`](#linkevent)[]; `next`: [`HistoryCursor`](#historycursor) \| `null`; \}\>

One page of a link's uses and fetch events, newest first, and the cursor of the next page.

#### Parameters

##### db

`D1Database`

##### linkId

`string`

##### limit

`number`

##### after

[`HistoryCursor`](#historycursor) \| `null`

#### Returns

`Promise`\<\{ `items`: [`LinkEvent`](#linkevent)[]; `next`: [`HistoryCursor`](#historycursor) \| `null`; \}\>

***

### recordUse()

> **recordUse**(`db`, `userId`, `linkId`): `Promise`\<`string` \| `null`\>

Records one use of a user's link: increments its use count, sets its last
use to now and stores a use event, in one transaction. Every way of opening
a link (the open endpoint, and later reads, snapshots and MCP) goes through
here. Returns the link's normalised URL, or null when the user has no such link.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<`string` \| `null`\>
