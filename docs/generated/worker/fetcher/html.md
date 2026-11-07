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

### extractMetadata()

> **extractMetadata**(`html`, `finalUrl`): [`PageMetadata`](#pagemetadata)

Reads a page's metadata: the title from <title>, else og:title, else the
host; the description from og:description, else the meta description; the
favicon from the first link whose rel contains "icon", else /favicon.ico at
the origin; the language from <html lang>. Whitespace is collapsed.

#### Parameters

##### html

`string`

##### finalUrl

`string`

#### Returns

[`PageMetadata`](#pagemetadata)
