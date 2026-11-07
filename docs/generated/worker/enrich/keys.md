# worker/enrich/keys

## Interfaces

### AiSettings

A user's stored AI settings.

#### Properties

##### ciphertext

> **ciphertext**: `string`

##### iv

> **iv**: `string`

##### last4

> **last4**: `string`

##### model

> **model**: `string`

##### provider

> **provider**: [`Provider`](#provider-1)

##### rejectedMessage

> **rejectedMessage**: `string` \| `null`

##### status

> **status**: `"verified"` \| `"rejected"`

## Type Aliases

### Provider

> **Provider** = `"anthropic"` \| `"openrouter"`

The providers a user can choose.

## Variables

### DEFAULT\_ANTHROPIC\_MODEL

> `const` **DEFAULT\_ANTHROPIC\_MODEL**: `"claude-opus-5-5"` = `'claude-opus-5-5'`

The model used with Anthropic when the user names none.

## Functions

### clearAiSettings()

> **clearAiSettings**(`db`, `userId`): `Promise`\<`void`\>

Forgets the user's provider, model and key.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<`void`\>

***

### decryptKey()

> **decryptKey**(`env`, `ciphertext`, `iv`, `userId`): `Promise`\<`string`\>

Decrypts a user's AI key; throws when it was sealed for another user or under another secret.

#### Parameters

##### env

[`Env`](../env.md#env)

##### ciphertext

`string`

##### iv

`string`

##### userId

`string`

#### Returns

`Promise`\<`string`\>

***

### encryptKey()

> **encryptKey**(`env`, `key`, `userId`): `Promise`\<\{ `ciphertext`: `string`; `iv`: `string`; \}\>

Encrypts a user's AI key with AES-GCM under KEY_ENCRYPTION_KEY, with a fresh
IV and the user's id as additional data, so that a ciphertext copied to
another user's row does not decrypt.

#### Parameters

##### env

[`Env`](../env.md#env)

##### key

`string`

##### userId

`string`

#### Returns

`Promise`\<\{ `ciphertext`: `string`; `iv`: `string`; \}\>

***

### getAiSettings()

> **getAiSettings**(`db`, `userId`): `Promise`\<[`AiSettings`](#aisettings) \| `null`\>

The user's AI settings, or null when no key is stored.

#### Parameters

##### db

`D1Database`

##### userId

`string`

#### Returns

`Promise`\<[`AiSettings`](#aisettings) \| `null`\>

***

### markKeyRejected()

> **markKeyRejected**(`db`, `userId`, `message`): `Promise`\<`void`\>

Marks the user's key as rejected by the provider, pausing their enrichment.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### message

`string`

#### Returns

`Promise`\<`void`\>

***

### saveAiSettings()

> **saveAiSettings**(`env`, `userId`, `provider`, `model`, `key`): `Promise`\<`void`\>

Stores a verified key, replacing any earlier settings and lifting a rejection.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### provider

[`Provider`](#provider-1)

##### model

`string`

##### key

`string`

#### Returns

`Promise`\<`void`\>
