# worker/enrich/providers

## Interfaces

### ProviderCall

The provider and credentials one call runs with: always the user's own.

#### Properties

##### apiKey

> **apiKey**: `string`

##### model

> **model**: `string`

##### provider

> **provider**: [`Provider`](keys.md#provider-1)

## Type Aliases

### ProviderOutcome

> **ProviderOutcome**\<`T`\> = \{ `ok`: `true`; `value`: `T`; \} \| \{ `kind`: `"rejected"`; `message`: `string`; `ok`: `false`; `status`: `number`; \} \| \{ `kind`: `"unavailable"`; `message`: `string`; `ok`: `false`; \} \| \{ `kind`: `"failed"`; `message`: `string`; `ok`: `false`; \}

What a provider call came to.

#### Type Parameters

##### T

`T`

#### Union Members

##### Type Literal

\{ `ok`: `true`; `value`: `T`; \}

***

##### Type Literal

\{ `kind`: `"rejected"`; `message`: `string`; `ok`: `false`; `status`: `number`; \}

The key was refused: HTTP 401, 402 or 403, with the provider's message.

***

##### Type Literal

\{ `kind`: `"unavailable"`; `message`: `string`; `ok`: `false`; \}

The provider could not be reached, answered 5xx, or did not answer in time.

***

##### Type Literal

\{ `kind`: `"failed"`; `message`: `string`; `ok`: `false`; \}

Any other failure: a 4xx, a rate limit, a refusal, an unusable answer.

## Variables

### PROVIDER\_TIMEOUT\_MS

> `const` **PROVIDER\_TIMEOUT\_MS**: `60000` = `60_000`

How long a provider call may take before it is abandoned.

***

### RESULT\_SCHEMA

> `const` **RESULT\_SCHEMA**: `object`

The structured result asked of the model.

#### Type Declaration

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### properties

> `readonly` **properties**: `object`

###### properties.summary

> `readonly` **summary**: `object`

###### properties.summary.description

> `readonly` **description**: `"What the page is about, in at most 60 words."` = `'What the page is about, in at most 60 words.'`

###### properties.summary.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.tags

> `readonly` **tags**: `object`

###### properties.tags.description

> `readonly` **description**: `"3 to 8 lower-case tags: single words or hyphenated phrases."` = `'3 to 8 lower-case tags: single words or hyphenated phrases.'`

###### properties.tags.items

> `readonly` **items**: `object`

###### properties.tags.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.tags.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.topic

> `readonly` **topic**: `object`

###### properties.topic.description

> `readonly` **description**: `"The one topic the page belongs to."` = `'The one topic the page belongs to.'`

###### properties.topic.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"summary"`, `"tags"`, `"topic"`\]

##### type

> `readonly` **type**: `"object"` = `'object'`

## Functions

### enrichWith()

> **enrichWith**(`env`, `call`, `prompt`): `Promise`\<[`ProviderOutcome`](#provideroutcome)\<`unknown`\>\>

Asks the user's provider for a structured {summary, tags, topic}: a forced
tool call through Anthropic's Messages API, a JSON-schema response format
through OpenRouter's chat completions. The value is the model's raw object.

#### Parameters

##### env

[`Env`](../env.md#env)

##### call

[`ProviderCall`](#providercall)

##### prompt

`string`

#### Returns

`Promise`\<[`ProviderOutcome`](#provideroutcome)\<`unknown`\>\>

***

### setProviderTimeout()

> **setProviderTimeout**(`ms`): `void`

Shortens the provider timeout, for tests; null restores the 60 seconds.

#### Parameters

##### ms

`number` \| `null`

#### Returns

`void`

***

### testKey()

> **testKey**(`env`, `call`): `Promise`\<[`ProviderOutcome`](#provideroutcome)\<`void`\>\>

Sends one minimal completion with the user's key and model, to see whether the provider accepts them.

#### Parameters

##### env

[`Env`](../env.md#env)

##### call

[`ProviderCall`](#providercall)

#### Returns

`Promise`\<[`ProviderOutcome`](#provideroutcome)\<`void`\>\>
