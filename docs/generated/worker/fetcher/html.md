# worker/fetcher/html

## Interfaces

### PageMetadata

What a web page says about itself.

#### Properties

##### description

> **description**: `string` \| `null`

##### faviconUrl

> **faviconUrl**: `string`

##### language

> **language**: `string` \| `null`

##### title

> **title**: `string`

## Functions

### collapse()

> **collapse**(`text`): `string`

Text with its runs of whitespace made one space each, and trimmed.

#### Parameters

##### text

`string` \| `null` \| `undefined`

#### Returns

`string`

***

### extractMetadata()

> **extractMetadata**(`page`, `finalUrl`): [`PageMetadata`](#pagemetadata)

Reads a page's metadata: the title from <title>, else og:title, else the
host; the description from og:description, else the meta description; the
favicon from the first link whose rel contains "icon", else /favicon.ico at
the origin; the language from <html lang>. Whitespace is collapsed.

#### Parameters

##### page

`string` \| `Document`

##### finalUrl

`string`

#### Returns

[`PageMetadata`](#pagemetadata)

***

### parsePage()

> **parsePage**(`html`): `Document`

The DOM of a page's HTML, to read its metadata and then its reader view from one parse.

#### Parameters

##### html

`string`

#### Returns

`Document`
