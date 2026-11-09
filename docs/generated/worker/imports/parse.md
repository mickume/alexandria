# worker/imports/parse

## Interfaces

### ImportLine

One URL line of an import file: its 1-based line number and the address found in it.

#### Properties

##### line

> **line**: `number`

##### url

> **url**: `string`

## Type Aliases

### ParsedFile

> **ParsedFile** = \{ `lines`: [`ImportLine`](#importline)[]; `ok`: `true`; \} \| \{ `error`: `"unsupported_file"` \| `"import_too_large"` \| `"no_urls"`; `ok`: `false`; \}

The URL lines of an accepted file, or why the file was refused.

## Variables

### MAX\_IMPORT\_BYTES

> `const` **MAX\_IMPORT\_BYTES**: `2097152` = `2_097_152`

The largest import file, in bytes (2 MB).

***

### MAX\_IMPORT\_URLS

> `const` **MAX\_IMPORT\_URLS**: `5000` = `5_000`

The most URL lines one import may hold.

## Functions

### findUrl()

> **findUrl**(`line`): `string` \| `null`

The first http or https address in a line, or null when it has none. The
address runs to the first whitespace, quote, bracket, backtick or pipe;
trailing punctuation and an unbalanced closing parenthesis are dropped, so
that `[docs](https://a.example/x).` and `<https://a.example/x>` both give
`https://a.example/x`.

#### Parameters

##### line

`string`

#### Returns

`string` \| `null`

***

### parseImportFile()

> **parseImportFile**(`bytes`, `declaredType`, `fileName?`): [`ParsedFile`](#parsedfile)

Reads an import file. Refuses a declared type other than text/plain or
text/markdown (unless the file is named *.txt or *.md), bytes that are not
UTF-8 and a NUL byte (unsupported_file); a file over 2 MB or 5,000 URL lines
(import_too_large); and a file with no URL line (no_urls). Otherwise drops
a byte-order mark and reads the URL lines (urlLines).

#### Parameters

##### bytes

`Uint8Array`

##### declaredType

`string` \| `null`

##### fileName?

`string` \| `null` = `null`

#### Returns

[`ParsedFile`](#parsedfile)

***

### urlLines()

> **urlLines**(`text`): [`ImportLine`](#importline)[]

The URL lines of a text: split at '\n' (a '\r' before it ends the address
like any whitespace), lines whose first non-blank character is '#' skipped,
and from each other line its first http or https address (findUrl), with
its 1-based line number. Lines without one are left out. An import file and
a paste into the website's add input are both read this way.

#### Parameters

##### text

`string`

#### Returns

[`ImportLine`](#importline)[]
