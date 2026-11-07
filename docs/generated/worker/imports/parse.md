# worker/imports/parse

## Interfaces

### ImportLine

One URL line of an import file: its 1-based line number and its first word.

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

### parseImportFile()

> **parseImportFile**(`bytes`, `declaredType`): [`ParsedFile`](#parsedfile)

Reads an import file. Refuses a declared type other than text/plain, bytes
that are not UTF-8, a NUL byte, markup and JSON (unsupported_file); a file
over 2 MB or 5,000 URL lines (import_too_large); and a file with no URL line
(no_urls). Otherwise drops a byte-order mark, splits at '\n' or '\r\n',
skips blank lines and lines whose first non-blank character is '#', and
takes each other line's first whitespace-separated word, with its line number.

#### Parameters

##### bytes

`Uint8Array`

##### declaredType

`string` \| `null`

#### Returns

[`ParsedFile`](#parsedfile)
