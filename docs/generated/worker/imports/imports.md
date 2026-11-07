# worker/imports/imports

## Interfaces

### ImportCounts

How many of each kind of URL line an import had.

#### Properties

##### added

> **added**: `number`

##### duplicates

> **duplicates**: `number`

##### invalid

> **invalid**: `number`

##### not\_imported

> **not\_imported**: `number`

##### url\_lines

> **url\_lines**: `number`

***

### ImportProgress

Where an import's added links stand.

#### Properties

##### done

> **done**: `number`

Fetched (or given up on): no longer pending.

##### enriched

> **enriched**: `number`

Done and enriched.

##### in\_progress

> **in\_progress**: `number`

Sent, and still pending.

##### waiting

> **waiting**: `number`

Not yet sent to the fetch worker.

***

### ImportReport

An import's report, as the API returns it.

#### Properties

##### counts

> **counts**: [`ImportCounts`](#importcounts)

##### created\_at

> **created\_at**: `string`

##### duplicates

> **duplicates**: `object`[]

###### line

> **line**: `number`

###### url

> **url**: `string`

##### id

> **id**: `string`

##### invalid

> **invalid**: `object`[]

###### line

> **line**: `number`

###### text

> **text**: `string`

##### stopped\_at\_limit

> **stopped\_at\_limit**: \{ `line`: `number`; \} \| `null`

## Functions

### getImport()

> **getImport**(`db`, `userId`, `id`): `Promise`\<[`ImportReport`](#importreport) \| `null`\>

One of the user's imports' reports, or null when the user has no such import.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<[`ImportReport`](#importreport) \| `null`\>

***

### importLines()

> **importLines**(`db`, `userId`, `lines`): `Promise`\<[`ImportReport`](#importreport)\>

Adds an import's lines to the user's library and records the import:
every new URL as a pending link, last used from the import time downwards
one millisecond per line, so that the stream lists them in file order;
duplicates and invalid lines reported, nothing boosted; the library limit
stopping the import at a line. The links are not sent to the fetch worker
here: the import's dispatcher sends them through the throttle.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### lines

[`ImportLine`](parse.md#importline)[]

#### Returns

`Promise`\<[`ImportReport`](#importreport)\>

***

### importProgress()

> **importProgress**(`db`, `importId`): `Promise`\<[`ImportProgress`](#importprogress)\>

The progress of one import's links still in the library.

#### Parameters

##### db

`D1Database`

##### importId

`string`

#### Returns

`Promise`\<[`ImportProgress`](#importprogress)\>

***

### reportText()

> **reportText**(`report`): `string`

The report as the downloadable text file says it.

#### Parameters

##### report

[`ImportReport`](#importreport)

#### Returns

`string`
