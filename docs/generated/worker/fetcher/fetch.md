# worker/fetcher/fetch

## Interfaces

### FetchFailed

A fetch that failed, with the reason shown on the link.

#### Properties

##### final?

> `optional` **final?**: `boolean`

Trying again later will not help: the site answered with a bot check,
which only a browser running JavaScript can pass.

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

##### charset?

> `optional` **charset?**: `string`

The character encoding the response declared for a web page, lower-cased, if it declared one.

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

##### truncated

> **truncated**: `boolean`

A web page longer than PAGE_LIMIT, of which only the first PAGE_LIMIT bytes were read.

##### via?

> `optional` **via?**: `"firecrawl"`

Set when the page came through the owner's Firecrawl key instead of a direct fetch.

## Type Aliases

### ContentKind

> **ContentKind** = `"html"` \| `"pdf"` \| `"other"`

What a response turned out to be.

***

### FetchResult

> **FetchResult** = [`FetchOk`](#fetchok) \| [`FetchFailed`](#fetchfailed)

## Variables

### BOT\_CHECK\_REASON

> `const` **BOT\_CHECK\_REASON**: `"blocked by a bot check"` = `'blocked by a bot check'`

The reason given for a site that answers with a bot check instead of its page.

***

### DNS\_QUERY\_URL

> `const` **DNS\_QUERY\_URL**: `"https://cloudflare-dns.com/dns-query"` = `'https://cloudflare-dns.com/dns-query'`

The DNS-over-HTTPS endpoint (JSON) that tells an unknown host from a bad certificate.

***

### FETCH\_TIMEOUT\_MS

> `const` **FETCH\_TIMEOUT\_MS**: `15000` = `15_000`

How long one request may take, from sending it to the last byte of its body.

***

### MAX\_REDIRECTS

> `const` **MAX\_REDIRECTS**: `5` = `5`

Redirects followed before a fetch fails.

***

### PAGE\_ACCEPT

> `const` **PAGE\_ACCEPT**: `"text/html, application/pdf"` = `'text/html, application/pdf'`

What the fetcher accepts for a page.

***

### PAGE\_LIMIT

> `const` **PAGE\_LIMIT**: `number`

The most of a web page that is read; the rest is cut off.

***

### PDF\_LIMIT

> `const` **PDF\_LIMIT**: `number`

The largest PDF that is stored.

## Functions

### decodeHtml()

> **decodeHtml**(`bytes`, `declared?`): `object`

A web page's bytes as text, in the encoding the response declared, else the
one its byte order mark or its first <meta charset> names, else UTF-8, as a
browser reads it. An encoding the runtime does not know reads as UTF-8;
`utf8` says whether the bytes were read as UTF-8.

#### Parameters

##### bytes

`Uint8Array`

##### declared?

`string`

#### Returns

`object`

##### html

> **html**: `string`

##### utf8

> **utf8**: `boolean`

***

### fetchPage()

> **fetchPage**(`env`, `url`, `__namedParameters?`): `Promise`\<[`FetchResult`](#fetchresult)\>

Fetches the page at `url` as the fetcher does: GET with Alexandria's Accept
and User-Agent headers through requestFollowing. A web page is read up to
5 MB and a PDF up to 50 MB; any other kind is not read; a 4xx or 5xx is a
failure, and a final one when it is a bot check.

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

### isBotCheck()

> **isBotCheck**(`response`): `boolean`

Whether `response` is a bot check (Cloudflare's "Just a moment…" page, or
any challenge it marks with cf-mitigated: challenge) rather than an answer
of the site's own.

#### Parameters

##### response

`Response`

#### Returns

`boolean`

***

### readLimited()

> **readLimited**(`body`, `limit`, `signal`, `declared?`): `Promise`\<\{ `bytes`: `Uint8Array`; `over`: `boolean`; \}\>

Reads at most `limit` bytes of `body`; `over` says whether there was more.
With the length the response declared, the bytes are read straight into one
buffer of that size, so a large body is held once, not twice.

#### Parameters

##### body

`ReadableStream`\<`Uint8Array`\<`ArrayBufferLike`\>\> \| `null`

##### limit

`number`

##### signal

`AbortSignal`

##### declared?

`number` = `NaN`

#### Returns

`Promise`\<\{ `bytes`: `Uint8Array`; `over`: `boolean`; \}\>

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

###### accept?

`string`

###### method

`"GET"` \| `"HEAD"`

###### timeoutMs

`number`

##### onFinal

(`response`, `finalUrl`, `signal`) => `Promise`\<`T`\>

#### Returns

`Promise`\<[`FetchFailed`](#fetchfailed) \| `T`\>

***

### statusReason()

> **statusReason**(`response`): `Promise`\<`string`\>

The reason for a final answer that is not a success, consuming its body:
a bot check is named as one; an error status Cloudflare itself answers for
an origin it could not reach (Server: cloudflare) is named as that failure,
a 530 with error 1016 as 'host not found'; any other status is
'HTTP <status>'.

#### Parameters

##### response

`Response`

#### Returns

`Promise`\<`string`\>

***

### userAgent()

> **userAgent**(`env`): `string`

The fetcher's User-Agent, naming the page that explains it when the
deployment names its address.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`string`
