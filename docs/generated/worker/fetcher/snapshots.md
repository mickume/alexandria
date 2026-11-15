# worker/fetcher/snapshots

## Interfaces

### SnapshotColumns

What a link row says about its snapshot.

#### Properties

##### id

> **id**: `string`

##### snapshot\_at

> **snapshot\_at**: `string` \| `null`

##### snapshot\_id

> **snapshot\_id**: `string` \| `null`

##### snapshot\_kind

> **snapshot\_kind**: `string` \| `null`

##### user\_id

> **user\_id**: `string`

***

### SnapshotResponse

The snapshot as the API returns it.

#### Properties

##### byline

> **byline**: `string` \| `null`

##### content\_kind

> **content\_kind**: `"html"` \| `"pdf"`

##### file\_url?

> `optional` **file\_url?**: `string`

A PDF snapshot's file.

##### html

> **html**: `string` \| `null`

##### notes

> **notes**: `string`[]

##### taken\_at

> **taken\_at**: `string`

##### title

> **title**: `string` \| `null`

***

### StoredArticle

A web page's snapshot as stored: the article, its byline and the notes taken with it.

#### Properties

##### byline

> **byline**: `string` \| `null`

##### html

> **html**: `string`

The sanitised article, its stored images at the addresses imageAddressPrefix gives.

##### notes

> **notes**: `string`[]

##### title

> **title**: `string` \| `null`

## Variables

### ARTICLE\_OBJECT

> `const` **ARTICLE\_OBJECT**: `"article.json"` = `'article.json'`

The name of a web page snapshot's article in its folder.

***

### PDF\_OBJECT

> `const` **PDF\_OBJECT**: `"file.pdf"` = `'file.pdf'`

The name of a PDF snapshot's file in its folder.

## Functions

### articleKey()

> **articleKey**(`link`): `string` \| `null`

The key of a link's stored article, or null when it has no web page snapshot.

#### Parameters

##### link

[`SnapshotColumns`](#snapshotcolumns)

#### Returns

`string` \| `null`

***

### deleteFolder()

> **deleteFolder**(`env`, `folder`): `Promise`\<`void`\>

Deletes every object under one folder.

#### Parameters

##### env

[`Env`](../env.md#env)

##### folder

`string`

#### Returns

`Promise`\<`void`\>

***

### deleteLinkObjects()

> **deleteLinkObjects**(`env`, `userId`, `linkId`, `keep?`): `Promise`\<`void`\>

Deletes every object stored for a link, except those whose keys start with `keep`.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkId

`string`

##### keep?

`string`

#### Returns

`Promise`\<`void`\>

***

### imageAddressPrefix()

> **imageAddressPrefix**(`linkId`): `string`

The address prefix under which the API serves a link's snapshot images, ending in '/'.

#### Parameters

##### linkId

`string`

#### Returns

`string`

***

### imageKey()

> **imageKey**(`link`, `name`): `string` \| `null`

The key of one stored image of a link's snapshot, or null when the name cannot be one.

#### Parameters

##### link

[`SnapshotColumns`](#snapshotcolumns)

##### name

`string`

#### Returns

`string` \| `null`

***

### legacyPdfKey()

> **legacyPdfKey**(`userId`, `linkId`): `string`

The key of a PDF stored before snapshots had folders. Such a PDF stays the
link's snapshot, read from here, while the link has no snapshot id.

#### Parameters

##### userId

`string`

##### linkId

`string`

#### Returns

`string`

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

### pdfKey()

> **pdfKey**(`link`): `string`

The key of a link's stored PDF snapshot.

#### Parameters

##### link

[`SnapshotColumns`](#snapshotcolumns)

#### Returns

`string`

***

### snapshotFolder()

> **snapshotFolder**(`userId`, `linkId`, `snapshotId`): `string`

The folder of one snapshot of a link: its article and images, or its PDF.

#### Parameters

##### userId

`string`

##### linkId

`string`

##### snapshotId

`string`

#### Returns

`string`

***

### storedText()

> **storedText**(`env`, `userId`, `linkId`): `Promise`\<`string`\>

A link's stored article text, or '' when it has none.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### linkId

`string`

#### Returns

`Promise`\<`string`\>
