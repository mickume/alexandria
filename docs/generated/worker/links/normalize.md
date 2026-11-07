# worker/links/normalize

## Type Aliases

### NormalizeResult

> **NormalizeResult** = \{ `ok`: `true`; `url`: `string`; \} \| \{ `error`: `"invalid_url"`; `ok`: `false`; \}

The outcome of normalising one input.

## Functions

### isFetchable()

> **isFetchable**(`url`): `boolean`

Whether the fetcher may request `url`: an http or https URL whose host is not
localhost, a loopback, private or link-local address. Every redirect target
is checked with this, so a public URL cannot lead the fetcher into a private network.

#### Parameters

##### url

`URL`

#### Returns

`boolean`

***

### isPrivateHost()

> **isPrivateHost**(`hostname`): `boolean`

Whether a URL's hostname is localhost or a loopback, private, link-local or unspecified address.

#### Parameters

##### hostname

`string`

#### Returns

`boolean`

***

### normalizeUrl()

> **normalizeUrl**(`input`): [`NormalizeResult`](#normalizeresult)

Validates and normalises a URL the way every entry point of the library does,
so that duplicates are found by comparing normalised strings:
surrounding whitespace is trimmed, `https://` is added to an input without a
scheme, scheme and host are lower-cased, the fragment, a default port and the
tracking parameters are dropped, the remaining parameters are sorted by name,
and a lone `/` path is dropped when no query follows it.

Inputs that are not http or https URLs, that name a bare word rather than a
dotted host, or that name localhost, a loopback, private or link-local
address, are rejected.

#### Parameters

##### input

`string`

#### Returns

[`NormalizeResult`](#normalizeresult)
