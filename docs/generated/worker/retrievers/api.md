# worker/retrievers/api

## Interfaces

### ApiAnswer

A 2xx answer of an API, its body read as text.

#### Properties

##### body

> **body**: `string`

##### headers

> **headers**: `Headers`

##### status

> **status**: `number`

***

### ApiRules

How a site tells a spent rate limit or a refused key from another error of the same status.

#### Methods

##### keyRefused()?

> `optional` **keyRefused**(`status`, `body`): `boolean`

Whether a 400 answer means the key was refused (401 and any other 403 always do).

###### Parameters

###### status

`number`

###### body

`string`

###### Returns

`boolean`

##### rateLimited()?

> `optional` **rateLimited**(`status`, `headers`, `body`): `boolean`

Whether a 400 or 403 answer means the limit or quota is spent.

###### Parameters

###### status

`number`

###### headers

`Headers`

###### body

`string`

###### Returns

`boolean`

## Type Aliases

### ApiResult

> **ApiResult** = \{ `answer`: [`ApiAnswer`](#apianswer); `ok`: `true`; \} \| \{ `failure`: [`RetrieverFailure`](retriever.md#retrieverfailure); `ok`: `false`; \}

## Variables

### API\_TIMEOUT\_MS

> `const` **API\_TIMEOUT\_MS**: `15000` = `15_000`

How long one request to an API may take, from sending it to the last byte of its body.

## Functions

### callApi()

> **callApi**(`env`, `url`, `headers`, `rules?`): `Promise`\<[`ApiResult`](#apiresult)\>

Sends a GET for `url` with `headers`, after waiting for the host gate of the
URL's host. A redirect is not followed (the API's answer is what counts),
and reads as an unusable answer.

#### Parameters

##### env

[`Env`](../env.md#env)

##### url

`string`

##### headers

`Record`\<`string`, `string`\>

##### rules?

[`ApiRules`](#apirules) = `{}`

#### Returns

`Promise`\<[`ApiResult`](#apiresult)\>

***

### parseJson()

> **parseJson**(`body`): `unknown`

A JSON body parsed, or null when it is not JSON.

#### Parameters

##### body

`string`

#### Returns

`unknown`

***

### setApiTimeout()

> **setApiTimeout**(`ms`): `void`

Shortens the request timeout, for tests; null restores it.

#### Parameters

##### ms

`number` \| `null`

#### Returns

`void`
