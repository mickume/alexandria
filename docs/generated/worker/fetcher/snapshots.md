# worker/fetcher/snapshots

## Interfaces

### StoredReader

The stored reader view of a web page.

#### Properties

##### byline

> **byline**: `string` \| `null`

##### html

> **html**: `string` \| `null`

##### title

> **title**: `string` \| `null`

## Functions

### deleteLinkObjects()

> **deleteLinkObjects**(`env`, `userId`, `linkId`): `Promise`\<`void`\>

Deletes every object stored for a link.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<`void`\>

***

### linkPrefix()

> **linkPrefix**(`userId`, `linkId`): `string`

Where a link's stored objects live in SNAPSHOTS.

#### Parameters

##### userId

`string`

##### linkId

`string`

#### Returns

`string`

***

### readerKey()

> **readerKey**(`userId`, `linkId`): `string`

The key of a link's reader view: its title, byline and sanitised HTML, as JSON.

#### Parameters

##### userId

`string`

##### linkId

`string`

#### Returns

`string`

***

### snapshotKey()

> **snapshotKey**(`userId`, `linkId`): `string`

The key of a link's snapshot: the raw HTML, or the whole PDF.

#### Parameters

##### userId

`string`

##### linkId

`string`

#### Returns

`string`
