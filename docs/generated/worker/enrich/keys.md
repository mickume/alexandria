# worker/enrich/keys

## Interfaces

### AiSettings

A user's stored AI settings.

#### Extends

- [`StoredKey`](#storedkey)

#### Properties

##### ciphertext

> **ciphertext**: `string`

###### Inherited from

[`StoredKey`](#storedkey).[`ciphertext`](#ciphertext-1)

##### iv

> **iv**: `string`

###### Inherited from

[`StoredKey`](#storedkey).[`iv`](#iv-1)

##### last4

> **last4**: `string`

###### Inherited from

[`StoredKey`](#storedkey).[`last4`](#last4-1)

##### model

> **model**: `string`

##### provider

> **provider**: [`Provider`](#provider-1)

##### rejectedMessage

> **rejectedMessage**: `string` \| `null`

###### Inherited from

[`StoredKey`](#storedkey).[`rejectedMessage`](#rejectedmessage-1)

##### status

> **status**: `"verified"` \| `"rejected"`

###### Inherited from

[`StoredKey`](#storedkey).[`status`](#status-1)

***

### StoredKey

A key a user stored: encrypted, with its last 4 characters and whether its service still takes it.

#### Extended by

- [`AiSettings`](#aisettings)

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

### KeyColumns

> **KeyColumns** = `"ai_key"` \| `"firecrawl_key"`

The users columns a stored key is kept in: `ai_key_…` or `firecrawl_key_…`.

***

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

### clearStoredKey()

> **clearStoredKey**(`db`, `userId`, `columns`, `extra?`): `Promise`\<`void`\>

Forgets the user's key stored under `columns`, and the `extra` users columns with it.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### columns

[`KeyColumns`](#keycolumns)

##### extra?

`string`[] = `[]`

#### Returns

`Promise`\<`void`\>

***

### decryptKey()

> **decryptKey**(`env`, `ciphertext`, `iv`, `userId`): `Promise`\<`string`\>

Decrypts a user's API key; throws when it was sealed for another user or under another secret.

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

Encrypts a user's API key (for an AI provider or Firecrawl) with AES-GCM
under KEY_ENCRYPTION_KEY, with a fresh IV and the user's id as additional
data, so that a ciphertext copied to another user's row does not decrypt.

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

### getStoredKey()

> **getStoredKey**(`db`, `userId`, `columns`, `extra?`): `Promise`\<\{ `key`: [`StoredKey`](#storedkey); `row`: `Record`\<`string`, `string` \| `null`\>; \} \| `null`\>

The user's key stored under `columns`, with the `extra` users columns read
beside it, or null when none is stored.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### columns

[`KeyColumns`](#keycolumns)

##### extra?

`string`[] = `[]`

#### Returns

`Promise`\<\{ `key`: [`StoredKey`](#storedkey); `row`: `Record`\<`string`, `string` \| `null`\>; \} \| `null`\>

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

### markStoredKeyRejected()

> **markStoredKeyRejected**(`db`, `userId`, `columns`, `message`): `Promise`\<`void`\>

Marks the user's key under `columns` as rejected by its service, with the service's message.

#### Parameters

##### db

`D1Database`

##### userId

`string`

##### columns

[`KeyColumns`](#keycolumns)

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

***

### saveStoredKey()

> **saveStoredKey**(`env`, `userId`, `columns`, `key`, `extra?`): `Promise`\<`void`\>

Stores a verified key under `columns`, replacing any earlier one and lifting
a rejection, and sets the `extra` users columns with it.

#### Parameters

##### env

[`Env`](../env.md#env)

##### userId

`string`

##### columns

[`KeyColumns`](#keycolumns)

##### key

`string`

##### extra?

`Record`\<`string`, `string`\> = `{}`

#### Returns

`Promise`\<`void`\>
