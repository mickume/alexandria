# worker/enrich/keys

## Interfaces

### AiConfig

The deployment's AI provider, model and key.

#### Properties

##### apiKey

> **apiKey**: `string`

##### model

> **model**: `string`

##### provider

> **provider**: [`Provider`](#provider-1)

## Type Aliases

### AiState

> **AiState** = \{ `status`: `"none"`; \} \| \{ `config`: [`AiConfig`](#aiconfig); `status`: `"verified"`; \} \| \{ `config`: [`AiConfig`](#aiconfig); `message`: `string`; `status`: `"rejected"`; \}

The deployment's AI key as owners meet it: none, usable, or refused with the provider's message.

***

### KeyService

> **KeyService** = `"ai"` \| `"firecrawl"`

The services whose key the deployment holds.

***

### Provider

> **Provider** = `"anthropic"` \| `"openrouter"`

The AI providers a deployment can use.

## Variables

### DEFAULT\_ANTHROPIC\_MODEL

> `const` **DEFAULT\_ANTHROPIC\_MODEL**: `"claude-opus-5-5"` = `'claude-opus-5-5'`

The model used with Anthropic when AI_MODEL names none.

***

### NO\_AI\_KEY\_MESSAGE

> `const` **NO\_AI\_KEY\_MESSAGE**: `"this deployment has no AI key"` = `'this deployment has no AI key'`

The message of the refusal of an AI request when the deployment has no AI key.

***

### REJECTION\_RETRY\_MS

> `const` **REJECTION\_RETRY\_MS**: `number`

How long a refused key is left alone before it is tried again.

## Functions

### aiConfig()

> **aiConfig**(`env`): [`AiConfig`](#aiconfig) \| `null`

The deployment's AI configuration: AI_API_KEY with AI_PROVIDER (Anthropic
when unset) and AI_MODEL (DEFAULT_ANTHROPIC_MODEL with Anthropic when
unset). Null without a key, with a provider that is neither 'anthropic' nor
'openrouter', or with OpenRouter and no model, as then nothing can be asked.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

[`AiConfig`](#aiconfig) \| `null`

***

### aiState()

> **aiState**(`env`): `Promise`\<[`AiState`](#aistate)\>

The deployment's AI configuration and whether the provider refused its key.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`Promise`\<[`AiState`](#aistate)\>

***

### firecrawlKey()

> **firecrawlKey**(`env`): `string` \| `null`

The deployment's Firecrawl key, or null without one.

#### Parameters

##### env

[`Env`](../env.md#env)

#### Returns

`string` \| `null`

***

### keyRejection()

> **keyRejection**(`db`, `service`, `key`): `Promise`\<`string` \| `null`\>

The message `service` refused `key` with, while the refusal holds: the key
is the one refused and the refusal is under an hour old. Null otherwise.

#### Parameters

##### db

`D1Database`

##### service

[`KeyService`](#keyservice)

##### key

`string`

#### Returns

`Promise`\<`string` \| `null`\>

***

### markAiKeyRejected()

> **markAiKeyRejected**(`env`, `config`, `message`): `Promise`\<`void`\>

Records that the AI provider refused the deployment's key, pausing enrichment.

#### Parameters

##### env

[`Env`](../env.md#env)

##### config

[`AiConfig`](#aiconfig)

##### message

`string`

#### Returns

`Promise`\<`void`\>

***

### markKeyRejected()

> **markKeyRejected**(`db`, `service`, `key`, `message`): `Promise`\<`void`\>

Records that `service` refused `key`, with its message, replacing any earlier refusal.

#### Parameters

##### db

`D1Database`

##### service

[`KeyService`](#keyservice)

##### key

`string`

##### message

`string`

#### Returns

`Promise`\<`void`\>
