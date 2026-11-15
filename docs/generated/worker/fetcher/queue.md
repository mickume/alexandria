# worker/fetcher/queue

## Variables

### MAX\_ATTEMPTS

> `const` **MAX\_ATTEMPTS**: `3` = `3`

Failed attempts of a link's first fetch before it is given up as unreachable.

***

### NO\_ARTICLE\_REASON

> `const` **NO\_ARTICLE\_REASON**: `"no readable content"` = `'no readable content'`

The reason a snapshot of a page without an article fails.

***

### PDF\_TOO\_LARGE

> `const` **PDF\_TOO\_LARGE**: `"PDF too large to store (50 MB limit)"` = `'PDF too large to store (50 MB limit)'`

The note on, and the reason a snapshot fails for, a PDF too large to store.

***

### UNREADABLE\_NOTE

> `const` **UNREADABLE\_NOTE**: `"page could not be read"` = `'page could not be read'`

The note on a page stored without metadata or article text, because it could not be parsed.

## Functions

### handleFetchBatch()

> **handleFetchBatch**(`batch`, `env`): `Promise`\<`void`\>

The FETCH_QUEUE consumer. The messages of a batch are processed
concurrently, so that a wait at one host's gate does not hold up the others.

#### Parameters

##### batch

`MessageBatch`\<[`FetchMessage`](../env.md#fetchmessage)\>

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<`void`\>

***

### lastSegmentOrHost()

> **lastSegmentOrHost**(`url`): `string`

The last path segment of `url`, decoded, or its host when the path has none.

#### Parameters

##### url

`string`

#### Returns

`string`

***

### titleFromUrl()

> **titleFromUrl**(`url`): `string`

A title read from the words of `url`'s last path segment, for a page that
could not be fetched: "/why-git-was-replaced-4f31eae67e00" reads "Why git
was replaced". A file extension and a trailing id (a run of 8 or more hex
digits with a digit among them) are dropped, dashes, underscores and pluses
become spaces, and the first letter is capitalised. A path without a word
in its last segment (an id, a date, nothing) gives the host.

#### Parameters

##### url

`string`

#### Returns

`string`
