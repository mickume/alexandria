# worker/fetcher/snapshots

## Interfaces

### ReaderResponse

The reader view as the API returns it.

#### Properties

##### byline

> **byline**: `string` \| `null`

##### content\_kind

> **content\_kind**: `"html"` \| `"pdf"`

##### empty

> **empty**: `boolean`

##### html

> **html**: `string` \| `null`

##### text

> **text**: `string`

##### title

> **title**: `string` \| `null`

***

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

### pdfFileName()

> **pdfFileName**(`title`): `string`

A file name for a stored PDF: the link's title without characters a header cannot carry.

#### Parameters

##### title

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

***

### storedText()

> **storedText**(`env`, `userId`, `linkId`): `Promise`\<`string`\>

A link's stored reader-view text, or '' when it has none.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<`string`\>
