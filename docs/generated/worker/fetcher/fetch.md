# worker/fetcher/fetch

## Interfaces

### FetchFailed

A fetch that failed, with the reason shown on the link.

#### Properties

##### ok

> **ok**: `false`

##### reason

> **reason**: `string`

##### status?

> `optional` **status?**: `number`

The HTTP status of a 4xx or 5xx answer.

***

### FetchOk

A fetch that reached a 2xx response.

#### Properties

##### body

> **body**: `Uint8Array`\<`ArrayBufferLike`\> \| `null`

The body read, or null for a kind that is not stored or a PDF over PDF_LIMIT.

##### contentType

> **contentType**: `string`

The response's media type, without parameters, such as text/html.

##### finalUrl

> **finalUrl**: `string`

##### kind

> **kind**: [`ContentKind`](#contentkind)

##### ok

> **ok**: `true`

##### status

> **status**: `number`

##### tooLarge

> **tooLarge**: `boolean`

A PDF longer than PDF_LIMIT, of which nothing is kept.

##### truncated

> **truncated**: `boolean`

A web page longer than PAGE_LIMIT, of which only the first PAGE_LIMIT bytes were read.

## Type Aliases

### ContentKind

> **ContentKind** = `"html"` \| `"pdf"` \| `"other"`

What a response turned out to be.

***

### FetchResult

> **FetchResult** = [`FetchOk`](#fetchok) \| [`FetchFailed`](#fetchfailed)

## Variables

### FETCH\_TIMEOUT\_MS

> `const` **FETCH\_TIMEOUT\_MS**: `15000` = `15_000`

How long one request may take, from sending it to the last byte of its body.

***

### MAX\_REDIRECTS

> `const` **MAX\_REDIRECTS**: `5` = `5`

Redirects followed before a fetch fails.

***

### PAGE\_LIMIT

> `const` **PAGE\_LIMIT**: `number`

The most of a web page that is read; the rest is cut off.

***

### PDF\_LIMIT

> `const` **PDF\_LIMIT**: `number`

The largest PDF that is stored.

## Functions

### fetchPage()

> **fetchPage**(`env`, `url`, `__namedParameters?`): `Promise`\<[`FetchResult`](#fetchresult)\>

Fetches the page at `url` as the fetcher does: GET with Alexandria's Accept
and User-Agent headers through requestFollowing. A web page is read up to
5 MB and a PDF up to 50 MB; any other kind is not read; a 4xx or 5xx is a
failure.

#### Parameters

##### env

[`Env`](../env.md#env)

##### url

`string`

##### \_\_namedParameters?

###### timeoutMs?

`number` = `FETCH_TIMEOUT_MS`

#### Returns

`Promise`\<[`FetchResult`](#fetchresult)\>

***

### requestFollowing()

> **requestFollowing**\<`T`\>(`env`, `url`, `__namedParameters`, `onFinal`): `Promise`\<[`FetchFailed`](#fetchfailed) \| `T`\>

Sends `method` to `url` as the fetcher does: through the host gate before
every request, following at most 5 redirects by hand and refusing any target
that is not a public http(s) address, each request within `timeoutMs`; the
last response is handed to `onFinal` inside the same time limit. A failure of
Alexandria's own (the host gate) is thrown, not turned into a reason.

#### Type Parameters

##### T

`T`

#### Parameters

##### env

[`Env`](../env.md#env)

##### url

`string`

##### \_\_namedParameters

###### method

`"GET"` \| `"HEAD"`

###### timeoutMs

`number`

##### onFinal

(`response`, `finalUrl`, `signal`) => `Promise`\<`T`\>

#### Returns

`Promise`\<[`FetchFailed`](#fetchfailed) \| `T`\>
