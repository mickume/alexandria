# worker/fetcher/firecrawl

## Interfaces

### FirecrawlSettings

A user's stored Firecrawl key.

#### Properties

##### ciphertext

> **ciphertext**: `string`

##### iv

> **iv**: `string`

##### last4

> **last4**: `string`

##### rejectedMessage

> **rejectedMessage**: `string` \| `null`

##### status

> **status**: `"verified"` \| `"rejected"`

## Type Aliases

### FirecrawlOutcome

> **FirecrawlOutcome**\<`T`\> = \{ `ok`: `true`; `value`: `T`; \} \| \{ `kind`: `"rejected"`; `message`: `string`; `ok`: `false`; \} \| \{ `kind`: `"unavailable"`; `message`: `string`; `ok`: `false`; \} \| \{ `kind`: `"failed"`; `message`: `string`; `ok`: `false`; \}

What a call to Firecrawl came to.

#### Type Parameters

##### T

`T`

#### Union Members

##### Type Literal

\{ `ok`: `true`; `value`: `T`; \}

***

##### Type Literal

\{ `kind`: `"rejected"`; `message`: `string`; `ok`: `false`; \}

The key was refused: HTTP 401, 402 (no credits left) or 403.

***

##### Type Literal

\{ `kind`: `"unavailable"`; `message`: `string`; `ok`: `false`; \}

Firecrawl could not be reached, timed out, was rate limited or answered 5xx: worth a retry.

***

##### Type Literal

\{ `kind`: `"failed"`; `message`: `string`; `ok`: `false`; \}

Anything else: Firecrawl could not load the page, or answered unusably.

## Variables

### FIRECRAWL\_NOTE

> `const` **FIRECRAWL\_NOTE**: `"fetched through Firecrawl"` = `'fetched through Firecrawl'`

The note a page fetched through Firecrawl carries.

***

### firecrawlSettingsRoutes

> `const` **firecrawlSettingsRoutes**: `Hono`\<[`AppEnv`](../env.md#appenv), `BlankSchema`, `"/"`\>

The owner's Firecrawl key, under /api/v1/settings.

***

### SCRAPE\_TIMEOUT\_MS

> `const` **SCRAPE\_TIMEOUT\_MS**: `60000` = `60_000`

How long Firecrawl may take to load a page, sent as its own time limit.

## Functions

### clearFirecrawlKey()

> **clearFirecrawlKey**(`db`, `userId`): `Promise`\<`void`\>

Forgets the user's Firecrawl key.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### fetchThroughFirecrawl()

> **fetchThroughFirecrawl**(`env`, `userId`, `url`, `failure`): `Promise`\<[`FetchOk`](fetch.md#fetchok) \| [`FetchFailed`](fetch.md#fetchfailed)\>

The fallback after a direct fetch of `url` met a bot check: with the user's
verified Firecrawl key, the page as Firecrawl fetched it; otherwise the
failure as it was. A refused key is marked rejected; a failure Firecrawl may
get over is no longer final, so the link's fetch is retried.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### url

`string`

##### failure

[`FetchFailed`](fetch.md#fetchfailed)

#### Returns

`Promise`\<[`FetchOk`](fetch.md#fetchok) \| [`FetchFailed`](fetch.md#fetchfailed)\>

***

### getFirecrawlSettings()

> **getFirecrawlSettings**(`db`, `userId`): `Promise`\<[`FirecrawlSettings`](#firecrawlsettings) \| `null`\>

The user's Firecrawl settings, or null when no key is stored.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`FirecrawlSettings`](#firecrawlsettings) \| `null`\>

***

### saveFirecrawlKey()

> **saveFirecrawlKey**(`env`, `userId`, `key`): `Promise`\<`void`\>

Stores a verified key, replacing any earlier one and lifting a rejection.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### key

`string`

#### Returns

`Promise`\<`void`\>

***

### scrape()

> **scrape**(`env`, `apiKey`, `url`): `Promise`\<[`FirecrawlOutcome`](#firecrawloutcome)\<[`FetchOk`](fetch.md#fetchok)\>\>

Asks Firecrawl for the page at `url` as its browser received it (rawHtml),
leaving Firecrawl to choose its proxy. The page is read up to PAGE_LIMIT,
like a direct fetch. An answer of the site's that is not a success, a final
address that is not public http(s), or no HTML is a failure.

#### Parameters

##### env

[`Env`](../env.md#env)

##### apiKey

`string`

##### url

`string`

#### Returns

`Promise`\<[`FirecrawlOutcome`](#firecrawloutcome)\<[`FetchOk`](fetch.md#fetchok)\>\>

***

### setFirecrawlTimeout()

> **setFirecrawlTimeout**(`ms`): `void`

Shortens the call timeout, for tests; null restores it.

#### Parameters

##### ms

`number` \| `null`

#### Returns

`void`

***

### testFirecrawlKey()

> **testFirecrawlKey**(`env`, `apiKey`): `Promise`\<[`FirecrawlOutcome`](#firecrawloutcome)\<`null`\>\>

Tests `apiKey` with a request that costs no credits: the team's credit usage.

#### Parameters

##### env

[`Env`](../env.md#env)

##### apiKey

`string`

#### Returns

`Promise`\<[`FirecrawlOutcome`](#firecrawloutcome)\<`null`\>\>
