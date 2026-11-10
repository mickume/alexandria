# worker/fetcher/reader

## Interfaces

### ReaderView

The reader view of a page: its article alone, safe to show.

#### Properties

##### byline

> **byline**: `string` \| `null`

##### empty

> **empty**: `boolean`

Too little text was extracted to make a reader view of.

##### html

> **html**: `string` \| `null`

The article's sanitised HTML, or null when the view is empty.

##### text

> **text**: `string`

The article's plain text, whitespace collapsed; '' when the view is empty.

##### title

> **title**: `string` \| `null`

## Variables

### MAX\_DEPTH

> `const` **MAX\_DEPTH**: `256` = `256`

The deepest nesting of elements a page may have to be read. Readability's
time grows steeply with depth: a page nested thousands deep would use the
whole CPU limit and never be stored. No page written to be read comes near.

***

### MAX\_TEXT

> `const` **MAX\_TEXT**: `500000` = `500_000`

The most reader-view text stored per link, in characters.

***

### MIN\_TEXT

> `const` **MIN\_TEXT**: `200` = `200`

Less article text than this makes the reader view empty.

## Functions

### capText()

> **capText**(`text`): `string`

The part of a reader view's text that is stored: its first MAX_TEXT characters.

#### Parameters

##### text

`string`

#### Returns

`string`

***

### extractReader()

> **extractReader**(`html`, `finalUrl`): [`ReaderView`](#readerview)

The reader view of a stored page: Readability's article over a DOM of the
HTML, sanitised by an allow-list, with every link and image address made
absolute against the page's final URL. Under 200 characters of article text
the view is empty.

#### Parameters

##### html

`string`

##### finalUrl

`string`

#### Returns

[`ReaderView`](#readerview)
