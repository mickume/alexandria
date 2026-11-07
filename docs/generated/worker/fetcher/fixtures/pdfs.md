# worker/fetcher/fixtures/pdfs

## Variables

### PAPER\_FIRST\_SENTENCE

> `const` **PAPER\_FIRST\_SENTENCE**: `"Links are the threads that hold the web together."` = `'Links are the threads that hold the web together.'`

The first sentence of the paper fixture.

## Functions

### longPdf()

> **longPdf**(`chars`): `Uint8Array`

A PDF whose text is at least `chars` characters long.

#### Parameters

##### chars

`number`

#### Returns

`Uint8Array`

***

### makePdf()

> **makePdf**(`__namedParameters`): `Uint8Array`

A PDF whose pages hold `pages` (each a list of lines), or a drawing when a page is null.

#### Parameters

##### \_\_namedParameters

###### pages

(`string`[] \| `null`)[]

###### title?

`string`

#### Returns

`Uint8Array`

***

### paperPdf()

> **paperPdf**(`title?`): `Uint8Array`

The paper fixture: two pages of text, optionally titled.

#### Parameters

##### title?

`string`

#### Returns

`Uint8Array`

***

### scannedPdf()

> **scannedPdf**(): `Uint8Array`

A PDF of one scanned page: a drawing and no text layer.

#### Returns

`Uint8Array`

***

### truncatedPdf()

> **truncatedPdf**(): `Uint8Array`

A PDF cut off after its first 200 bytes.

#### Returns

`Uint8Array`
