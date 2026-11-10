# worker/api/pagination

## Variables

### DEFAULT\_LIMIT

> `const` **DEFAULT\_LIMIT**: `50` = `50`

The page size of a list when the request names none.

***

### MAX\_LIMIT

> `const` **MAX\_LIMIT**: `100` = `100`

The largest page a list returns.

## Functions

### decodeCursor()

> **decodeCursor**\<`T`\>(`env`, `cursor`): `Promise`\<`T` \| `null`\>

The payload of a cursor this API issued, or null for anything else.

#### Type Parameters

##### T

`T`

#### Parameters

##### env

[`Env`](../env.md#env)

##### cursor

`string`

#### Returns

`Promise`\<`T` \| `null`\>

***

### encodeCursor()

> **encodeCursor**(`env`, `payload`): `Promise`\<`string`\>

An opaque, tamper-evident cursor carrying `payload`: its JSON, base64url, and an HMAC of it.

#### Parameters

##### env

[`Env`](../env.md#env)

##### payload

`unknown`

#### Returns

`Promise`\<`string`\>

***

### parseLimit()

> **parseLimit**(`value`, `fallback?`): `number` \| `null`

The page size a request asks for, or null when `value` is not an integer from 1 to MAX_LIMIT.

#### Parameters

##### value

`string` \| `undefined`

##### fallback?

`number` = `DEFAULT_LIMIT`

#### Returns

`number` \| `null`

***

### readCursor()

> **readCursor**\<`T`\>(`c`, `isOwn`): `Promise`\<`Response` \| `T` \| `null`\>

The payload of a list request's `cursor`, null without one, or the 400 that
refuses a cursor this API did not issue for this list (`isOwn` tells).

#### Type Parameters

##### T

`T`

#### Parameters

##### c

`Context`\<[`AppEnv`](../env.md#appenv)\>

##### isOwn

(`payload`) => `payload is T`

#### Returns

`Promise`\<`Response` \| `T` \| `null`\>

***

### readLimit()

> **readLimit**(`c`, `fallback?`): `number` \| `Response`

The page size a list request asks for with `limit` (`fallback` without one),
or the 400 that refuses a value that is not an integer from 1 to MAX_LIMIT.

#### Parameters

##### c

`Context`\<[`AppEnv`](../env.md#appenv)\>

##### fallback?

`number` = `DEFAULT_LIMIT`

#### Returns

`number` \| `Response`
