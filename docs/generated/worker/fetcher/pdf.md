# worker/fetcher/pdf

## Interfaces

### PdfContent

What a PDF says about itself.

#### Properties

##### text

> **text**: `string`

Its text, pages joined, whitespace collapsed; '' when it has none.

##### title

> **title**: `string` \| `null`

The Title of its document information, if it has one.

## Functions

### readPdf()

> **readPdf**(`bytes`): `Promise`\<[`PdfContent`](#pdfcontent)\>

Reads a PDF's title and text with pdf.js (through unpdf). A PDF that cannot
be parsed reads as one without title or text.

#### Parameters

##### bytes

`Uint8Array`

#### Returns

`Promise`\<[`PdfContent`](#pdfcontent)\>
