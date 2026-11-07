# worker/auth/tokens

## Interfaces

### TokenView

A token as the API shows it: never with its secret.

#### Properties

##### created\_at

> **created\_at**: `string`

##### id

> **id**: `string`

##### last\_used\_at

> **last\_used\_at**: `string` \| `null`

##### name

> **name**: `string`

## Variables

### SECRET\_PREFIX

> `const` **SECRET\_PREFIX**: `"alx_"` = `'alx_'`

Every secret starts with this, so that a leaked one is recognisable.

***

### TOKEN\_LIMIT

> `const` **TOKEN\_LIMIT**: `20` = `20`

The most unrevoked tokens one user may hold.

***

### TOKEN\_NAME\_MAX

> `const` **TOKEN\_NAME\_MAX**: `100` = `100`

The longest token name, in characters.

## Functions

### createToken()

> **createToken**(`db`, `userId`, `name`): `Promise`\<[`TokenView`](#tokenview) & `object` \| `null`\>

Creates a token for `userId` and returns it with its secret, which is shown
this once and stored only as its SHA-256 hash. Returns null when the user
already holds TOKEN_LIMIT unrevoked tokens.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### name

`string`

#### Returns

`Promise`\<[`TokenView`](#tokenview) & `object` \| `null`\>

***

### listTokens()

> **listTokens**(`db`, `userId`): `Promise`\<[`TokenView`](#tokenview)[]\>

The user's unrevoked tokens, newest first.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`TokenView`](#tokenview)[]\>

***

### revokeToken()

> **revokeToken**(`db`, `userId`, `id`): `Promise`\<`boolean`\>

Revokes one of the user's tokens. Returns false when the user has no such unrevoked token.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

***

### useToken()

> **useToken**(`db`, `secret`): `Promise`\<[`AuthUser`](../env.md#authuser) \| `null`\>

The user an unrevoked token's secret authenticates, recording its use; null otherwise.

#### Parameters

##### db

`D1Database`

##### secret

`string`

#### Returns

`Promise`\<[`AuthUser`](../env.md#authuser) \| `null`\>

***

### validTokenName()

> **validTokenName**(`name`): `string` \| `null`

Validates a token name: 1 to 100 characters once trimmed. Returns the trimmed name or null.

#### Parameters

##### name

`unknown`

#### Returns

`string` \| `null`
